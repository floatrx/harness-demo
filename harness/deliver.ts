// Delivery (`deliver.pr: true`): the runner pushes a done task's branch and opens its pull request. No agent takes
// part and no token is spent: the body is composed from the task file, the handoffs and git. Nothing ever merges —
// the only `gh` verbs here are `auth status`, `pr view` and `pr create`, and the self-test checks that.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessConfig } from './config.ts';
import { checkBranch } from './contracts/branch.ts';
import { type RunResult, run, tryGit } from './git.ts';
import { type HandoffRecord, type TracePaths, appendHandoff, readHandoffs } from './paths.ts';
import { scrubSecrets } from './secrets.ts';
import { criterionLabel, getSection, parseCriteria, setField } from './task/parse.ts';
import { type LoadedTask, saveTask } from './task/task.ts';
import { appendLog, moveTo } from './task/write.ts';

export interface DeliverOptions {
  /** Replaces `gh` (tests use `node harness/testkit/fake-gh.ts`). Env `HARNESS_GH` does too. */
  gh?: string;
  /** How the PR footer names the agent: `claude`, or `stand-in` when AGENT_CMD / agent.command replaced it. */
  agent: 'claude' | 'stand-in';
}

export interface DeliverResult {
  ok: boolean;
  /** The pull request URL (also on success when it already existed). */
  pr: string | null;
  reason: string | null;
}

/** Runs `gh` (or its stand-in) with arguments passed as-is: `sh -c '<cmd> "$@"'` keeps them unsplit. */
function gh(project: string, args: string[], override?: string): RunResult {
  const command = override ?? process.env.HARNESS_GH;
  return command ? run('sh', ['-c', `${command} "$@"`, 'gh', ...args], project) : run('gh', args, project);
}

const firstLine = (result: RunResult) => (result.stderr.trim() || result.stdout.trim()).split('\n')[0] ?? '';

/**
 * Checked when a supervisor starts with `deliver.pr` on: a missing remote or a logged-out `gh` is a configuration
 * problem (exit 2, with the fix), not something to discover at the end of a task.
 */
export function deliveryPreflight(project: string, config: HarnessConfig, override?: string): string | null {
  const { remote } = config.deliver;
  if (tryGit(project, ['remote', 'get-url', remote]).code !== 0)
    return `deliver.pr is on but the project has no remote "${remote}" — add it (git remote add ${remote} <url>)`;
  const auth = gh(project, ['auth', 'status'], override);
  if (auth.code === 127) return 'deliver.pr is on but `gh` is not installed — https://cli.github.com';
  if (auth.code !== 0)
    return `deliver.pr is on but \`gh auth status\` fails — run \`gh auth login\` (${firstLine(auth)})`;
  const base = tryGit(project, ['ls-remote', '--heads', remote, config.baseBranch]);
  if (base.code !== 0) return `cannot reach ${remote}: ${firstLine(base)}`;
  if (!base.stdout.trim())
    return `${remote} has no ${config.baseBranch} branch — push it first (git push -u ${remote} ${config.baseBranch})`;
  return null;
}

/** One criterion line of the QA report: `- 7 PASS · browser · qa-7-toast.png`. */
export interface QaLine {
  n: number;
  result: 'PASS' | 'FAIL' | 'REVIEWER';
  how: 'browser' | 'command' | 'code';
  evidence: string | null;
}

/** The criterion lines of `qa-report.md` (agents/qa.md fixes the form). Other lines are prose and are skipped. */
export function readQaLines(report: string): Map<number, QaLine> {
  const lines = new Map<number, QaLine>();
  for (const match of report.matchAll(
    /^-\s*(\d+)\s+(PASS|FAIL|REVIEWER)\s*·\s*(browser|command|code)(?:\s*·\s*(\S+))?/gm,
  )) {
    const evidence = match[4] && match[4] !== '-' ? match[4] : null;
    lines.set(Number(match[1]), {
      n: Number(match[1]),
      result: match[2] as QaLine['result'],
      how: match[3] as QaLine['how'],
      evidence,
    });
  }
  return lines;
}

/** The pull-request body. The task file is gitignored in every project, so the reviewer sees only this. */
export function prBody(
  task: LoadedTask,
  handoffs: readonly HandoffRecord[],
  commits: readonly string[],
  agent: string,
  /** QA's report: a `[found]` criterion it walked in the browser is marked done, not left for the reviewer. */
  qaReport = '',
): string {
  const { doc, fields } = task;
  const mine = handoffs.filter((record) => record.task === fields.id);
  const units = mine.filter((record) => typeof record.unit === 'number');
  const verdictOf = (stage: string) => [...units].reverse().find((record) => record.stage === stage && record.verdict);
  const criteria = parseCriteria(getSection(doc, 'Acceptance criteria'));
  const qa = readQaLines(qaReport);
  const walkedCount = criteria.filter(
    (c) => c.tag === 'found' && qa.get(c.n)?.how === 'browser' && qa.get(c.n)?.result === 'PASS',
  ).length;
  const section = (name: string) => getSection(doc, name)?.trim() || '_(empty)_';
  const review = ['qa', 'judge'].flatMap((stage) => {
    const record = verdictOf(stage);
    return record ? [`- ${stage}: **${record.verdict}** (unit ${record.unit})`] : [];
  });
  return [
    `## Goal`,
    section('Spec'),
    ``,
    `## Plan`,
    section('Plan'),
    ``,
    `## Acceptance`,
    ...criteria.map((criterion) => {
      if (criterion.tag === 'closes')
        return `- ✓ \`${criterion.command ?? '?'}\` — ${criterionLabel(criterion) || 'exits 0'}`;
      const walked = qa.get(criterion.n);
      if (criterion.tag === 'found' && walked?.result === 'PASS' && walked.how === 'browser') {
        const shot = walked.evidence ? ` (\`${walked.evidence}\`)` : '';
        return `- ✓ [found] ${criterion.text} — walked in the browser by QA${shot}`;
      }
      return `- [ ] [${criterion.tag}] ${criterion.text} — for a human to check`;
    }),
    ...(criteria.some((criterion) => criterion.tag === 'closes')
      ? ['', '_Every `[closes]` command was re-run green by the loop before the task was marked done._']
      : []),
    ...(walkedCount
      ? [
          `_QA walked ${walkedCount} \`[found]\` criteri${walkedCount === 1 ? 'on' : 'a'} in a browser on the running app; its screenshots are in the loop's artifacts folder._`,
        ]
      : []),
    ``,
    `## Review`,
    ...(review.length ? review : ['- _(no verdicts recorded)_']),
    ``,
    `## Commits`,
    ...commits.map((line) => `- ${line}`),
    ``,
    `---`,
    `Opened by [harness-demo](https://github.com/floatrx/harness-demo) · ${units.length} unit${units.length === 1 ? '' : 's'} · agent: ${agent}. Merging is yours.`,
    ``,
  ].join('\n');
}

/** Parks a done task with the delivery failure; Reopen sends it back to `done`, which retries. */
function park(task: LoadedTask, paths: TracePaths, reason: string): DeliverResult {
  const { doc, fields } = task;
  setField(doc, 'parked', `deliver: ${reason}`);
  setField(doc, 'parkedFrom', 'done');
  moveTo(doc, 'parked', 'runner · deliver');
  saveTask(task.path, doc);
  appendHandoff(paths, { task: fields.id, stage: 'deliver', from: 'done', to: 'parked', exit: 1, reason });
  return { ok: false, pr: null, reason };
}

export function deliverTask(
  project: string,
  paths: TracePaths,
  config: HarnessConfig,
  task: LoadedTask,
  options: DeliverOptions,
): DeliverResult {
  const { doc, fields } = task;
  const branch = checkBranch(project, fields.branch, config.baseBranch, fields.id);
  if (!branch.ok || !fields.branch) return park(task, paths, `branch contract: ${branch.reason}`);

  const artifacts = join(paths.artifacts, fields.id);
  mkdirSync(artifacts, { recursive: true });
  const bodyFile = join(artifacts, 'pr-body.md');
  const qaFile = join(artifacts, 'qa-report.md');
  const qaReport = existsSync(qaFile) ? readFileSync(qaFile, 'utf8') : '';
  writeFileSync(bodyFile, scrubSecrets(prBody(task, readHandoffs(paths), branch.commits, options.agent, qaReport)));

  const push = tryGit(project, ['push', '--quiet', '--set-upstream', config.deliver.remote, fields.branch]);
  if (push.code !== 0) return park(task, paths, `push failed: ${scrubSecrets(firstLine(push))}`);

  /* Idempotent: a crash between the push and the record must not open a second pull request. */
  const view = gh(
    project,
    ['pr', 'view', fields.branch, '--json', 'url,state', '--jq', 'select(.state == "OPEN") | .url'],
    options.gh,
  );
  let url = view.code === 0 ? view.stdout.trim() : '';
  if (!url) {
    const create = gh(
      project,
      [
        'pr',
        'create',
        '--base',
        config.baseBranch,
        '--head',
        fields.branch,
        '--title',
        `${fields.id}: ${fields.title}`,
        '--body-file',
        bodyFile,
      ],
      options.gh,
    );
    if (create.code !== 0) return park(task, paths, `gh pr create failed: ${scrubSecrets(firstLine(create))}`);
    url = /https?:\/\/\S+/.exec(create.stdout)?.[0] ?? create.stdout.trim();
  }

  setField(doc, 'pr', url);
  appendLog(doc, `  ↳ pull request ${url}`);
  moveTo(doc, 'delivered', 'runner · deliver');
  saveTask(task.path, doc);
  appendHandoff(paths, { task: fields.id, stage: 'deliver', from: 'done', to: 'delivered', exit: 0, pr: url });
  return { ok: true, pr: url, reason: null };
}
