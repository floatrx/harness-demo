// Contract self-test: every case runs the real runner and supervisor on a throwaway project with the
// fake agent. Shared by `harness self-test` and `node --test`.

import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.ts';
import { createExample } from './example.ts';
import { listProjects } from './projects.ts';
import { validateTask } from './task/validate.ts';
import { baseAgentsDir } from './agents.ts';
import { join } from 'node:path';
import { dirty } from './git.ts';
import { type UnitResult, runUnit } from './runner.ts';
import { supervise } from './supervise.ts';
import { type Sandbox, makeSandbox, readLog, seedTask } from './testkit/sandbox.ts';
import { accept, addReview, answerQuestion, approve, comment, reopen, submit } from './task/write.ts';
import { listTaskFiles, loadTask, saveTask } from './task/task.ts';

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
        // The runner makes the artifacts folder: `mkdir` is not on the agent's allowlist.
        expect(existsSync(join(sandbox.project, '.harness/artifacts/T-002')), 'no artifacts folder');
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
    name: 'plan contract: a [closes] criterion whose command span is a name parks the plan (pilot lesson 4)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, { status: 'plan', scope: ['src/**'] });
        sandbox.scenario({
          steps: {
            plan: [
              [
                { default: true },
                {
                  section: 'Acceptance criteria',
                  content: [
                    '1. [closes] `formatThing` is exported from `src/x.ts`',
                    '2. [closes] `src/x.test.ts` passes: `test -f src/x.ts`',
                  ].join('\n'),
                },
              ],
            ],
          },
        });
        const result = await runUnit(sandbox.project, sandbox.agent);
        const task = sandbox.task(id).fields;
        expect(result.exit === 1 && task.status === 'parked', `exit ${result.exit}, status ${task.status}`);
        expect(/criterion 1: `formatThing` is not a command/.test(task.parked ?? ''), `parked: ${task.parked}`);
        expect(!/criterion 2/.test(task.parked ?? ''), `criterion 2 picked the wrong span: ${task.parked}`);
        return `parked: ${task.parked}`;
      }),
  },
  hardStop(
    'implement: a first round with no change is barren and parks',
    [{ say: 'Nothing to do.' }],
    /no change inside scope/,
  ),
  {
    name: 'reopened round: the branch holds the work, no change → qa → done; Reopen reset bounces (pilot lesson 4)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        sandbox.scenario({
          steps: {
            implement: [[{ default: true }], [{ exit: 1 }], [{ say: 'The code already meets every criterion.' }]],
            qa: [[{ say: 'qa: FAIL' }]],
          },
        });
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        expect(
          sandbox.task(id).fields.status === 'parked',
          `status ${sandbox.task(id).fields.status}, expected parked`,
        );
        const path = sandbox.taskPath(id);
        saveTask(path, reopen(loadTask(path).doc));
        expect(sandbox.task(id).fields.bounces === 0, 'Reopen kept the bounces');
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        const task = sandbox.task(id).fields;
        expect(task.status === 'done', `status ${task.status}`);
        expect(/no change this round/.test(readLog(sandbox, id)), 'the no-change round is not in the log');
        return 'FAIL → crash → parked → Reopen (bounces 0) → no change → qa → judge → done';
      }),
  },
  {
    name: "a human approves another task during a unit: not the unit's doing, kept by quarantine (pilot lesson 7)",
    run: () =>
      withSandbox({}, async (sandbox) => {
        seedTask(sandbox, { id: 'T-001', status: 'planned', scope: ['src/**'], closes: ['true'] });
        seedTask(sandbox, { id: 'T-002', status: 'spec' });
        seedTask(sandbox, { id: 'T-003', status: 'spec' });
        const write = new URL('./task/write.ts', import.meta.url).pathname;
        const task = new URL('./task/task.ts', import.meta.url).pathname;
        const other = '"$HARNESS_PROJECT/.harness/tasks/T-001.md"';
        // A human write at the same time as the unit: through the core, so it lands in the ledger.
        const human = `node --input-type=module -e "import { approve } from '${write}'; import { loadTask, saveHumanTask } from '${task}'; const p = process.argv[1]; saveHumanTask(p, approve(loadTask(p).doc));" ${other}`;
        // An agent edit of the same file: no ledger line, so it is still the unit's fault.
        const agent = `node -e "require('node:fs').appendFileSync(process.argv[1], 'agent was here')" ${other}`;
        sandbox.scenario({
          steps: {
            'T-002:spec': [[{ default: true }, { exec: human }]],
            'T-003:spec': [[{ default: true }, { exec: agent }]],
          },
        });
        const first = await runUnit(sandbox.project, sandbox.agent);
        expect(first.exit === 0, `unit 1 exit ${first.exit}: ${first.message}`);
        expect(sandbox.task('T-002').fields.status === 'plan', `T-002 ${sandbox.task('T-002').fields.status}`);
        expect(sandbox.task('T-001').fields.status === 'ready', `T-001 ${sandbox.task('T-001').fields.status}`);
        // Finishing beats starting: T-001 (now ready) and T-002's plan run before T-003's spec.
        let second = await runUnit(sandbox.project, sandbox.agent);
        for (let n = 0; second.task !== 'T-003' && n < 8; n++) second = await runUnit(sandbox.project, sandbox.agent);
        const parked = sandbox.task('T-003').fields;
        expect(second.exit === 1 && parked.status === 'parked', `T-003 unit exit ${second.exit}, ${parked.status}`);
        expect(/loop-owned file: \.harness\/tasks\/T-001\.md/.test(parked.parked ?? ''), `parked: ${parked.parked}`);
        expect(sandbox.task('T-001').fields.status !== 'planned', 'quarantine undid the human approve');
        expect(!readFileSync(sandbox.taskPath('T-001'), 'utf8').includes('agent was here'), 'the agent edit survived');
        return 'human approve during unit 1 kept · agent edit in unit 2 parked and restored to the human state';
      }),
  },
  {
    name: 'an unread `1a.` criterion parks a plan, and a revised plan unit still runs to fix it (pilot lesson 8)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, { status: 'plan', scope: ['src/**'] });
        const bad =
          '1. [closes] The file exists: `test -f src/feature.txt`\n1a. [closes] It is not empty: `test -s src/feature.txt`';
        sandbox.scenario({ steps: { plan: [[{ default: true }, { section: 'Acceptance criteria', content: bad }]] } });
        const first = await runUnit(sandbox.project, sandbox.agent);
        const parked = sandbox.task(id).fields;
        expect(
          first.exit === 1 && /not read as a criterion.*1a\./.test(parked.parked ?? ''),
          `parked: ${parked.parked}`,
        );
        const path = sandbox.taskPath(id);
        saveTask(path, reopen(loadTask(path).doc));
        // The reopened plan still carries the bad line; the unit must run anyway (the default plan rewrites it).
        const second = await runUnit(sandbox.project, sandbox.agent);
        expect(second.exit === 0, `second plan unit exit ${second.exit}: ${second.message}`);
        expect(sandbox.task(id).fields.status === 'planned', `status ${sandbox.task(id).fields.status}`);
        return `parked on 1a. → reopened → the plan unit ran and wrote a readable list → planned`;
      }),
  },
  {
    name: 'bounce round: no change after a wrong reject goes back to qa, and the judge decides again (pilot lesson 4)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        sandbox.scenario({
          steps: {
            implement: [[{ default: true }], [{ say: 'Nothing to fix: the code meets every criterion.' }]],
            judge: [[{ say: 'judge: REJECTED' }]],
          },
        });
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        const task = sandbox.task(id).fields;
        expect(task.status === 'done' && task.bounces === 1, `status ${task.status} bounces ${task.bounces}`);
        expect(/no change this round/.test(readLog(sandbox, id)), 'the no-change round is not in the log');
        const commits = sandbox
          .git(['rev-list', `main..${task.branch}`])
          .trim()
          .split('\n')
          .filter(Boolean);
        expect(commits.length === 1, `${commits.length} commits`);
        return `REJECTED → implement, no change → qa → judge CONFIRMED → done · 1 commit`;
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
    name: "stream-json: the verdict is the coordinator's final result, not a quoted specialist",
    run: () =>
      withSandbox({}, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        sandbox.scenario({
          steps: {
            qa: [
              [
                {
                  stream: { quoted: 'specialist says qa: PASS', result: 'Criterion 1 is red.\nqa: FAIL', tokens: 4200 },
                },
              ],
            ],
          },
        });
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true, maxUnits: 2 });
        const task = sandbox.task(id).fields;
        expect(task.status === 'implementing' && task.bounces === 1, `status ${task.status} bounces ${task.bounces}`);
        const handoffs = readFileSync(join(sandbox.project, '.harness/trace/handoffs.jsonl'), 'utf8');
        expect(/"usage":\{"inputTokens":4200/.test(handoffs), 'usage not recorded in handoffs.jsonl');
        return `qa: FAIL read from the result event · bounce 1 · usage 4200 input tokens recorded`;
      }),
  },
  {
    name: 'standing rules: a drifted copy in an agent file refuses the run (exit 2)',
    run: () =>
      withSandbox({}, async (sandbox) => {
        seedTask(sandbox, READY);
        const base = join(sandbox.root, 'agents');
        cpSync(baseAgentsDir(), base, { recursive: true });
        const file = join(base, 'implementer.md');
        writeFileSync(file, readFileSync(file, 'utf8').replace('Do not commit, push', 'Commit when you like, push'));
        const previous = process.env.HARNESS_AGENTS_DIR;
        process.env.HARNESS_AGENTS_DIR = base;
        try {
          const result = await runUnit(sandbox.project, sandbox.agent);
          expect(
            result.exit === 2 && /standing rules drifted/.test(result.message),
            `exit ${result.exit}: ${result.message}`,
          );
          expect(sandbox.task('T-001').fields.status === 'ready', 'the task moved');
          return `exit 2 · ${result.message}`;
        } finally {
          if (previous === undefined) delete process.env.HARNESS_AGENTS_DIR;
          else process.env.HARNESS_AGENTS_DIR = previous;
        }
      }),
  },
  {
    name: "models: a judge on the implementer's model refuses the run (exit 2)",
    run: () =>
      withSandbox({ roles: { models: { judge: 'sonnet' } } }, async (sandbox) => {
        seedTask(sandbox, READY);
        const result = await runUnit(sandbox.project, sandbox.agent);
        expect(
          result.exit === 2 && /judge and implementer share/.test(result.message),
          `exit ${result.exit}: ${result.message}`,
        );
        return `exit 2 · ${result.message}`;
      }),
  },
  {
    name: 'merged review: qa PASS closes the task, and the closing contract still runs',
    run: () =>
      withSandbox({ roles: { mergeQaJudge: true } }, async (sandbox) => {
        const green = seedTask(sandbox, { ...READY, id: 'T-001' });
        const red = seedTask(sandbox, { ...READY, id: 'T-002', closes: ['test -f src/missing.txt'] });
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true, maxUnits: 4 });
        const a = sandbox.task(green).fields;
        const b = sandbox.task(red).fields;
        expect(a.status === 'done', `T-001 ${a.status}`);
        expect(!/judge/.test(statusTrail(readLog(sandbox, green))), 'a judge stage ran under merged review');
        expect(b.status === 'implementing' && b.bounces === 1, `T-002 ${b.status} bounces ${b.bounces}`);
        return `T-001 qa→done (no judge unit) · T-002 qa PASS overruled by a red [closes] → implementing`;
      }),
  },
  {
    name: 'example: `harness example` makes a clean, registered, standalone project with three valid seeds',
    run: async () => {
      const root = mkdtempSync(join(tmpdir(), 'harness-example-'));
      const saved = { ...process.env };
      Object.assign(process.env, {
        HARNESS_HOME: join(root, 'home'),
        GIT_AUTHOR_NAME: 'Harness Test',
        GIT_AUTHOR_EMAIL: 'harness-test@example.invalid',
        GIT_COMMITTER_NAME: 'Harness Test',
        GIT_COMMITTER_EMAIL: 'harness-test@example.invalid',
      });
      try {
        const dest = join(root, 'bookmarks');
        const project = createExample(dest, { install: false });
        expect(project.path === dest && listProjects().some((item) => item.path === dest), 'not registered');
        const left = dirty(dest);
        expect(left.length === 0, `dirty after create: ${left.map((entry) => entry.path).join(', ')}`);
        const seeds = listTaskFiles(join(dest, '.harness/tasks')).map((file) => loadTask(file));
        expect(seeds.length === 3, `${seeds.length} seeds`);
        for (const seed of seeds)
          expect(validateTask(seed.doc).length === 0, `${seed.fields.id}: ${JSON.stringify(validateTask(seed.doc))}`);
        expect(
          seeds.map((seed) => `${seed.fields.id}:${seed.fields.kind}`).join(' ') === 'T-001:ui T-002:logic T-003:null',
          'seed kinds',
        );
        expect(loadConfig(dest).gate === 'pnpm typecheck && pnpm test', 'example gate');
        let refused = '';
        try {
          createExample(dest, { install: false });
        } catch (error) {
          refused = (error as Error).message;
        }
        expect(/not empty/.test(refused), 'a non-empty destination was accepted');
        return `1 commit, clean tree, registered, seeds T-001 ui · T-002 logic · T-003 vague, non-empty dest refused`;
      } finally {
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
        rmSync(root, { recursive: true, force: true });
      }
    },
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
    name: 'deliver: done → delivered through one pull request; the branch is on origin; nothing merges',
    run: () =>
      withSandbox({ autonomy: { mode: 'full' }, deliver: { pr: true } }, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        const result = await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
        const task = sandbox.task(id).fields;
        expect(result.exit === 0, `supervisor exit ${result.exit}: ${result.reason}`);
        expect(task.status === 'delivered', `status ${task.status} (${task.parked ?? ''})`);
        expect(/\/pull\/1$/.test(task.pr ?? ''), `pr field "${task.pr}"`);
        const remote = sandbox.git(['ls-remote', '--heads', 'origin', task.branch ?? '?']).trim();
        expect(remote.length > 0, `${task.branch} is not on origin`);
        const verbs = sandbox.ghCalls().map((call) => call.slice(0, 2).join(' '));
        expect(verbs.filter((verb) => verb === 'pr create').length === 1, `gh calls: ${verbs.join(', ')}`);
        expect(!verbs.some((verb) => /merge|close|review/.test(verb)), `gh was asked to ${verbs.join(', ')}`);
        const body = readFileSync(join(sandbox.project, '.harness/artifacts', id, 'pr-body.md'), 'utf8');
        expect(
          /✓ `test -f src\/feature\.txt`/.test(body) && /agent: stand-in/.test(body),
          'pr body misses a criterion',
        );
        return `delivered · ${task.pr} · gh: ${verbs.join(', ')}`;
      }),
  },
  {
    name: 'deliver: a commit the runner did not make parks the task and nothing is pushed',
    run: () =>
      withSandbox({ autonomy: { mode: 'full' }, deliver: { pr: true } }, async (sandbox) => {
        const id = seedTask(sandbox, READY);
        await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true, maxUnits: 3 });
        const done = sandbox.task(id).fields;
        expect(done.status === 'done', `status ${done.status}, expected done after implement · qa · judge`);
        sandbox.git(['checkout', '--quiet', done.branch ?? '?']);
        writeFileSync(join(sandbox.project, 'src', 'hand.txt'), 'by hand\n');
        sandbox.git(['add', 'src/hand.txt']);
        sandbox.git(['commit', '--quiet', '-m', 'tweak by hand']);
        sandbox.git(['checkout', '--quiet', 'main']);
        const result = await runUnit(sandbox.project, sandbox.agent);
        const task = sandbox.task(id).fields;
        expect(result.exit === 1 && task.status === 'parked', `exit ${result.exit}, status ${task.status}`);
        expect(/commits the runner did not make/.test(task.parked ?? ''), `parked "${task.parked}"`);
        expect(task.parkedFrom === 'done', `parkedFrom ${task.parkedFrom}`);
        const remote = sandbox.git(['ls-remote', '--heads', 'origin', done.branch ?? '?']).trim();
        expect(remote === '', 'the branch was pushed');
        return `parked · ${task.parked}`;
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
