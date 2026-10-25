// Contract self-test: every case runs the real runner and supervisor on a throwaway project with the
// fake agent. Shared by `harness self-test` and `node --test`.

import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirty } from './git.ts';
import { type UnitResult, runUnit } from './runner.ts';
import { supervise } from './supervise.ts';
import { type Sandbox, makeSandbox, readLog, seedTask } from './testkit/sandbox.ts';
import { accept, addReview, answerQuestion, approve, comment, submit } from './task/write.ts';
import { loadTask, saveTask } from './task/task.ts';

export interface Case {
  name: string;
  /** Throws (an assertion) on failure; returns the evidence line. */
  run: () => Promise<string>;
}

class CaseFailure extends Error {
  override name = 'CaseFailure';
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CaseFailure(message);
}

async function withSandbox(config: Record<string, unknown>, body: (sandbox: Sandbox) => Promise<string>) {
  const sandbox = makeSandbox(config);
  try {
    return await body(sandbox);
  } finally {
    sandbox.cleanup();
  }
}

const READY = { status: 'ready' as const, scope: ['src/**'], closes: ['test -f src/feature.txt'] };

/** One implement unit with a scripted step; the unit must hard-stop and park the task. */
function hardStop(name: string, actions: unknown[], match: RegExp, config: Record<string, unknown> = {}): Case {
  return {
    name,
    run: () =>
      withSandbox(config, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        sandbox.scenario({ steps: { implement: [actions as never] } });
        const result = await runUnit(sandbox.project, sandbox.agent);
        const task = sandbox.task(id).fields;
        expect(result.exit === 1, `exit ${result.exit}, expected 1 (${result.message})`);
        expect(task.status === 'parked', `status ${task.status}, expected parked`);
        expect(match.test(task.parked ?? ''), `parked reason "${task.parked}" does not match ${match}`);
        const left = dirty(sandbox.project).filter((entry) => !entry.path.startsWith('.harness/'));
        expect(left.length === 0, `tree not clean after quarantine: ${left.map((entry) => entry.path).join(', ')}`);
        expect(
          sandbox.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim() === task.branch,
          'not back on the task branch',
        );
        return `exit 1 · parked: ${task.parked}`;
      }),
  };
}

const statusTrail = (log: string) =>
  [...log.matchAll(/ (\S+) → (\S+) · /g)].map((match) => `${match[1]}→${match[2]}`).join(' ');

export const CASES: Case[] = [
  {
    name: 'happy path: spec → … → done, one commit, full autonomy (criterion 3)',
    run: () =>
      withSandbox({ autonomy: { mode: 'full' } }, async (sandbox) => {
        seedTask(sandbox, { id: 'T-002', status: 'draft' });
        const path = sandbox.taskPath('T-002');
        saveTask(path, submit(loadTask(path).doc));
        const result = await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        const task = sandbox.task('T-002').fields;
        expect(result.exit === 0, `supervisor exit ${result.exit}: ${result.reason}`);
        expect(task.status === 'done', `status ${task.status}`);
        const trail = statusTrail(readLog(sandbox, 'T-002'));
        const want =
          'draft→spec spec→plan plan→planned planned→ready ready→implementing implementing→qa qa→judge judge→done';
        expect(trail === want, `trail: ${trail}`);
        const commits = sandbox
          .git(['rev-list', `main..${task.branch}`])
          .trim()
          .split('\n')
          .filter(Boolean);
        expect(commits.length === 1, `${commits.length} commits on ${task.branch}`);
        return `${trail} · 1 commit on ${task.branch}`;
      }),
  },
  {
    name: 'bounce cap: qa FAIL then judge REJECTED parks at bounces 2 (criterion 3a)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        sandbox.scenario({
          steps: { qa: [[{ say: 'qa: FAIL' }], [{ say: 'qa: PASS' }]], judge: [[{ say: 'judge: REJECTED' }]] },
        });
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        const task = sandbox.task(id).fields;
        expect(task.status === 'parked', `status ${task.status}`);
        expect(task.bounces === 2, `bounces ${task.bounces}`);
        expect(/bounce cap 2/.test(task.parked ?? ''), `parked: ${task.parked}`);
        const commits = sandbox
          .git(['rev-list', `main..${task.branch}`])
          .trim()
          .split('\n')
          .filter(Boolean);
        expect(commits.length === 2, `${commits.length} commits`);
        return `parked · bounces 2 · 2 commits · ${task.parked}`;
      }),
  },
  {
    name: 'prototype: review → Comment → drafting → review → Accept → ready (criterion 3b)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, { ...READY, status: 'planned', kind: 'ui' });
        const path = sandbox.taskPath(id);
        const step = async () => supervise(sandbox.project, { ...sandbox.agent, onceThrough: true, maxUnits: 1 });
        saveTask(path, approve(loadTask(path).doc));
        await step();
        let task = sandbox.task(id).fields;
        expect(
          task.status === 'prototype' && task.prototype === 'review',
          `after round 1: ${task.status}/${task.prototype}`,
        );
        saveTask(path, comment(loadTask(path).doc, 'move the button left', 3));
        expect(sandbox.task(id).fields.prototype === 'drafting', 'comment did not send it back to drafting');
        await step();
        task = sandbox.task(id).fields;
        expect(task.prototype === 'review', `after round 2: ${task.prototype}`);
        saveTask(path, accept(loadTask(path).doc));
        task = sandbox.task(id).fields;
        expect(task.status === 'ready', `after accept: ${task.status}`);
        return `planned→prototype(drafting→review) comment→drafting→review accept→ready`;
      }),
  },
  {
    name: 'interview: an open question parks the task in needs-input; the answer resumes it',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, { status: 'spec' });
        sandbox.scenario({
          steps: { spec: [[{ default: true }, { question: 'Where should it live?', options: ['header', 'footer'] }]] },
        });
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        let task = sandbox.task(id).fields;
        expect(task.status === 'needs-input' && task.resume === 'spec', `status ${task.status} resume ${task.resume}`);
        const path = sandbox.taskPath(id);
        saveTask(path, answerQuestion(loadTask(path).doc, 'Q1', 'a', 'header'));
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        task = sandbox.task(id).fields;
        expect(task.status === 'planned', `after the answer: ${task.status}`);
        return `spec→needs-input · answer Q1 (a) · needs-input→spec→plan→planned`;
      }),
  },
  hardStop(
    'out-of-scope edit: a tracked file outside scope (criterion 4)',
    [{ default: true }, { append: 'README.md', content: 'sneaky\n' }],
    /out-of-scope edit: README\.md/,
  ),
  hardStop(
    'stray file: an untracked file outside scope',
    [{ default: true }, { write: 'notes.txt', content: 'x' }],
    /stray file: notes\.txt/,
  ),
  hardStop(
    'extra commit: the agent commits by itself',
    [{ default: true }, { exec: 'git add -A src && git commit -q -m sneaky' }],
    /extra commit/,
  ),
  hardStop(
    'push: the agent pushes to the remote',
    [{ default: true }, { exec: 'git push -q origin HEAD:refs/heads/sneaky' }],
    /push: refs\/remotes\/origin\/sneaky moved/,
  ),
  hardStop(
    'branch switch: the agent leaves the task branch',
    [{ default: true }, { exec: 'git checkout -q -b elsewhere' }],
    /branch switch: on elsewhere/,
  ),
  hardStop(
    'task file: the implementer writes a section it does not own',
    [{ default: true }, { section: 'Draft', content: 'rewritten' }],
    /task file: wrote ## Draft/,
  ),
  hardStop(
    'loop-owned file: the agent edits .harness/config.json',
    [{ default: true }, { append: '.harness/config.json', content: ' ' }],
    /loop-owned file: \.harness\/config\.json/,
  ),
  hardStop('gate red: the unit breaks the gate', [{ default: true }], /gate red/, {
    gate: 'test ! -f src/feature.txt',
  }),
  hardStop(
    'agent crash: a non-zero exit that is not a usage limit',
    [{ default: true }, { exit: 3 }],
    /agent exited 3/,
  ),
  {
    name: 'task file: the designer overwrites the human ### Review block',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, { ...READY, status: 'prototype', kind: 'ui' });
        const path = sandbox.taskPath(id);
        const doc = loadTask(path).doc;
        addReview(doc, 'comment: bigger');
        saveTask(path, doc);
        sandbox.scenario({ steps: { prototype: [[{ section: 'Prototype', content: 'Round 2, review gone' }]] } });
        const result = await runUnit(sandbox.project, sandbox.agent);
        const task = sandbox.task(id).fields;
        expect(result.exit === 1 && /wrote ### Review/.test(task.parked ?? ''), `exit ${result.exit}: ${task.parked}`);
        return `exit 1 · parked: ${task.parked}`;
      }),
  },
  {
    name: 'missing verdict: a qa unit without `qa: …` hard-stops',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        sandbox.scenario({ steps: { qa: [[{ say: 'it looks fine to me' }]] } });
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        const task = sandbox.task(id).fields;
        expect(task.status === 'parked', `status ${task.status}`);
        expect(/missing verdict/.test(task.parked ?? ''), `parked: ${task.parked}`);
        return `parked: ${task.parked}`;
      }),
  },
  {
    name: 'red [closes]: a CONFIRMED judge is overruled by a failing criterion',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, { ...READY, closes: ['test -f src/feature.txt', 'test -f src/missing.txt'] });
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true, maxUnits: 3 });
        const task = sandbox.task(id).fields;
        expect(task.status === 'implementing' && task.bounces === 1, `status ${task.status} bounces ${task.bounces}`);
        const log = readLog(sandbox, id);
        expect(/criterion 2 `test -f src\/missing\.txt` exit 1/.test(log), 'closing reason missing from the log');
        return `judge CONFIRMED → closing red (criterion 2) → implementing · bounces 1`;
      }),
  },
  {
    name: 'gate narrowing: red at base too is inherited and does not fail the unit',
    run: () =>
      withSandbox({ gate: 'test -f src/never.txt' }, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        const result = await runUnit(sandbox.project, sandbox.agent);
        const task = sandbox.task(id).fields;
        expect(result.exit === 0 && task.status === 'qa', `exit ${result.exit} status ${task.status}`);
        expect(/inherited/.test(readLog(sandbox, id)), 'no collateral note in the log');
        return `exit 0 · implementing → qa · gate red at base too (inherited)`;
      }),
  },
  {
    name: 'usage limit: exit 4, the tree and the task are put back',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        sandbox.scenario({ steps: { implement: [[{ default: true }, { usageLimit: true }]] } });
        const result: UnitResult = await runUnit(sandbox.project, sandbox.agent);
        const left = dirty(sandbox.project).filter((entry) => !entry.path.startsWith('.harness/'));
        expect(result.exit === 4, `exit ${result.exit}`);
        expect(left.length === 0, `dirty: ${left.map((entry) => entry.path).join(', ')}`);
        expect(sandbox.task(id).fields.status === 'implementing', `status ${sandbox.task(id).fields.status}`);
        return `exit 4 · ${result.message}`;
      }),
  },
  {
    name: 'supervisor: usage limit waits and retries, then the unit completes',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        sandbox.scenario({ steps: { implement: [[{ usageLimit: true }]] } });
        const result = await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        const task = sandbox.task(id).fields;
        expect(result.units[0]?.exit === 4 && result.units[1]?.exit === 0, `exits ${result.units.map((u) => u.exit)}`);
        expect(task.status === 'done', `status ${task.status}`);
        return `units ${result.units.map((unit) => unit.exit).join(',')} · done`;
      }),
  },
  {
    name: 'supervisor: three units in a row that move nothing stop the loop (exit 3)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        let calls = 0;
        // Every real unit moves a status; a stub runner isolates the policy.
        const unitRunner = async (): Promise<UnitResult> => {
          calls++;
          return { exit: 0, message: 'did nothing', moved: false };
        };
        const result = await supervise(sandbox.project, { onceThrough: true, maxUnits: 10, unitRunner });
        expect(result.exit === 3 && calls === 3, `exit ${result.exit} after ${calls} units: ${result.reason}`);
        return `exit 3 after ${calls} units · ${result.reason}`;
      }),
  },
  {
    name: 'supervisor: a dirty tree it did not make stops it (exit 2)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        seedTask(sandbox, READY);
        appendFileSync(join(sandbox.project, 'README.md'), 'local edit\n');
        const result = await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        expect(result.exit === 2 && /dirty/.test(result.reason), `exit ${result.exit}: ${result.reason}`);
        return `exit 2 · ${result.reason}`;
      }),
  },
  {
    name: 'supervisor: one loop per checkout (lock)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        // pid 1 is always alive and never this process.
        writeFileSync(join(sandbox.project, '.harness/trace/supervisor.lock'), JSON.stringify({ pid: 1 }));
        const result = await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        expect(result.exit === 2 && /another supervisor/.test(result.reason), `exit ${result.exit}: ${result.reason}`);
        expect(existsSync(join(sandbox.project, '.harness/trace/supervisor.lock')), 'the foreign lock was removed');
        return `exit 2 · ${result.reason}`;
      }),
  },
];

export interface CaseOutcome {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runCases(
  cases: Case[] = CASES,
  onResult?: (outcome: CaseOutcome) => void,
): Promise<CaseOutcome[]> {
  const outcomes: CaseOutcome[] = [];
  for (const item of cases) {
    let outcome: CaseOutcome;
    try {
      outcome = { name: item.name, ok: true, detail: await item.run() };
    } catch (error) {
      outcome = { name: item.name, ok: false, detail: (error as Error).message };
    }
    outcomes.push(outcome);
    onResult?.(outcome);
  }
  return outcomes;
}
