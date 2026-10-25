// One unit of work: pick → branch → snapshot → spawn → scope → task-file → trace → gate → closing →
// transition → commit. The agent is the least trusted part; every check here is code, not instruction.
//
// Exit codes are a vocabulary for the supervisor:
//   0 the step is done · 1 a hard stop fired (the task is parked) · 2 broken configuration ·
//   3 nothing left to take · 4 the agent could not run (usage limit, network, login, probe)

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type HarnessConfig,
  type UnitStage,
  ConfigError,
  STAGE_ROLE,
  loadConfig,
  transitionContext,
} from './config.ts';
import { runClosing } from './contracts/closing.ts';
import { runGate } from './contracts/gate.ts';
import { judgeScope, outsideHarness, quarantine, snapshot } from './contracts/scope.ts';
import { readVerdict } from './contracts/trace.ts';
import { branchExists, currentBranch, dirty, git, head, sh } from './git.ts';
import {
  type TracePaths,
  appendHandoff,
  appendProgress,
  ensureTrace,
  nextUnitNumber,
  readRunning,
  tracePaths,
} from './paths.ts';
import { nextStep } from './queue.ts';
import { type TaskDoc, getSection, openQuestions, parseCriteria, parseTask, setField } from './task/parse.ts';
import { type LoadedTask, listTaskFiles, loadTask, saveTask, slugify, taskFields } from './task/task.ts';
import { type Status, findTransition } from './task/transitions.ts';
import { validateTask } from './task/validate.ts';
import { appendLog, moveTo, taskWriteViolations } from './task/write.ts';

export const EXIT = { done: 0, hardStop: 1, config: 2, idle: 3, agentDown: 4 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface UnitResult {
  exit: ExitCode;
  message: string;
  task?: string;
  stage?: UnitStage | 'advance';
  from?: Status;
  to?: Status;
  unit?: number;
  commit?: string;
  /** A status changed or a commit landed: the supervisor's progress measure. */
  moved: boolean;
}

export interface RunOptions {
  /** Overrides config `agent.command` and the built-in `claude -p` command. Env `AGENT_CMD` does too. */
  agentCommand?: string;
  /** Extra environment for the agent (the fake agent's scenario path, for one). */
  env?: Record<string, string>;
  log?: (line: string) => void;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(HERE, 'prompts');

/** Output that means "the agent could not run", not "the agent did bad work". */
const AGENT_DOWN =
  /usage limit|rate[ -]limit|\b429\b|overloaded|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|not logged in|\/login/i;

export const DEFAULT_AGENT_COMMAND = 'claude -p --output-format stream-json --verbose --model {model}';

// ---------------------------------------------------------------------------

export async function runUnit(project: string, options: RunOptions = {}): Promise<UnitResult> {
  const paths = tracePaths(project);
  ensureTrace(paths);
  const say = (line: string) => {
    appendProgress(paths, line);
    options.log?.(line);
  };
  let config: HarnessConfig;
  try {
    config = loadConfig(project);
  } catch (error) {
    if (error instanceof ConfigError) return { exit: EXIT.config, message: error.message, moved: false };
    throw error;
  }
  const running = readRunning(paths);
  if (running)
    return { exit: EXIT.config, message: `a unit is already running: ${running.task} ${running.stage}`, moved: false };

  if (config.probe) {
    const probe = sh(config.probe, project);
    if (probe.code !== 0) return { exit: EXIT.agentDown, message: `probe red: ${config.probe}`, moved: false };
  }

  const loaded: LoadedTask[] = [];
  const skip = new Set<string>();
  for (const file of listTaskFiles(paths.tasks)) {
    try {
      const task = loadTask(file);
      const issues = validateTask(task.doc);
      if (issues.length) {
        skip.add(task.fields.id);
        say(`skip ${task.fields.id}: ${issues.map((issue) => issue.message).join('; ')}`);
      }
      loaded.push(task);
    } catch (error) {
      say(`skip ${relative(project, file)}: ${(error as Error).message}`);
    }
  }
  const ctx = transitionContext(config);
  const step = nextStep(
    loaded.map((task) => task.fields),
    ctx,
    skip,
  );
  if (!step) return { exit: EXIT.idle, message: 'nothing left to take', moved: false };

  const foreign = dirty(project)
    .map((entry) => entry.path)
    .filter(outsideHarness);
  if (foreign.length)
    return {
      exit: EXIT.config,
      message: `the tree is dirty and the loop did not make it: ${foreign.slice(0, 5).join(', ')}`,
      moved: false,
    };

  const task = loaded.find((item) => item.fields.id === step.task.id) as LoadedTask;
  if (step.kind === 'advance') return advance(project, paths, task, step.action, step.target, say);
  return agentUnit(project, paths, config, task, step.stage, options, say);
}

function advance(
  _project: string,
  paths: TracePaths,
  task: LoadedTask,
  action: string,
  target: Status,
  say: (line: string) => void,
): UnitResult {
  const { doc, fields } = task;
  if (action === 'auto-approve' && target === 'prototype') setField(doc, 'prototype', 'drafting');
  if (action === 'auto-accept') setField(doc, 'prototype', null);
  moveTo(doc, target, `runner · ${action}`);
  saveTask(task.path, doc);
  appendHandoff(paths, { task: fields.id, stage: 'advance', action, from: fields.status, to: target, exit: 0 });
  say(`${fields.id} ${fields.status} → ${target} (${action})`);
  return {
    exit: EXIT.done,
    message: action,
    task: fields.id,
    stage: 'advance',
    from: fields.status,
    to: target,
    moved: true,
  };
}

// ---------------------------------------------------------------------------

interface AgentRun {
  code: number;
  output: string;
  timedOut: boolean;
  spawnError: string | null;
}

async function agentUnit(
  project: string,
  paths: TracePaths,
  config: HarnessConfig,
  task: LoadedTask,
  stage: UnitStage,
  options: RunOptions,
  say: (line: string) => void,
): Promise<UnitResult> {
  const role = STAGE_ROLE[stage];
  const unit = nextUnitNumber(paths);
  const id = task.fields.id;
  const taskRel = relative(project, task.path);
  const artifacts = `.harness/artifacts/${id}`;
  const writesCode = stage === 'implement' || stage === 'prototype';
  const ctx = transitionContext(config);
  const who = `${role} · unit ${unit}`;
  const statusAtPick = task.fields.status;

  // -- branch: spec/plan run on the base branch; code-writing and reviewing units on the task branch.
  let branch = config.baseBranch;
  try {
    if (stage === 'spec' || stage === 'plan') {
      checkout(project, config.baseBranch);
    } else {
      branch = task.fields.branch ?? `harness/${id}-${slugify(task.fields.title)}`;
      if (!branchExists(project, branch)) {
        if (!writesCode) throw new ConfigError(`${id} is in ${statusAtPick} but has no branch ${branch}`);
        git(project, ['checkout', '--quiet', '-b', branch, config.baseBranch]);
      } else {
        checkout(project, branch);
      }
      setField(task.doc, 'branch', branch);
    }
  } catch (error) {
    return { exit: EXIT.config, message: (error as Error).message, task: id, moved: false };
  }
  if (statusAtPick === 'ready') {
    const found = findTransition(task.fields, 'agent', 'start', ctx);
    if (found) moveTo(task.doc, found.target, `runner · unit ${unit}`);
  }
  saveTask(task.path, task.doc);

  const before = snapshot(project);
  const beforeText = readFileSync(task.path, 'utf8');
  const beforeDoc = parseTask(beforeText);
  const status = taskFields(beforeDoc).status;
  writeFileSync(
    paths.running,
    `${JSON.stringify({ task: id, stage, role, unit, pid: process.pid, startedAt: new Date().toISOString() })}\n`,
  );
  say(`unit ${unit} · ${id} · ${stage} · ${role} · start`);

  let run: AgentRun;
  try {
    run = await spawnAgent({
      command: agentCommand(config, role, options),
      prompt: buildPrompt(stage, role, task, taskRel, branch, artifacts, config),
      cwd: project,
      tracePath: paths.unit(unit),
      timeoutMs: config.limits.unitTimeoutMinutes * 60_000,
      env: {
        ...process.env,
        ...options.env,
        HARNESS_LOOP: '1',
        HARNESS_STAGE: stage,
        HARNESS_ROLE: role,
        HARNESS_TASK_ID: id,
        HARNESS_TASK_FILE: task.path,
        HARNESS_PROJECT: project,
        HARNESS_UNIT: String(unit),
        HARNESS_BRANCH: branch,
        HARNESS_ARTIFACTS: join(project, artifacts),
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      },
    });
  } finally {
    rmSync(paths.running, { force: true });
  }

  const base = { task: id, stage, unit, from: status } as const;

  // -- the agent command does not exist: configuration, waiting fixes nothing.
  if (run.code === 127) {
    const note = quarantine(project, before, `${id} unit ${unit}`, [], []);
    writeFileSync(task.path, beforeText);
    const message = `agent command not found: ${lastLine(run.output) || agentCommand(config, role, options)}`;
    say(`unit ${unit} · ${id} · exit 2 · ${message}${note ? ` · ${note}` : ''}`);
    return { ...base, exit: EXIT.config, message, to: status, moved: false };
  }

  // -- the agent could not run: put everything back, the task is untouched, the supervisor waits.
  if (run.spawnError || (run.code !== 0 && AGENT_DOWN.test(run.output))) {
    const note = quarantine(project, before, `${id} unit ${unit}`, [], []);
    writeFileSync(task.path, beforeText);
    const message = `agent could not run: ${run.spawnError ?? lastLine(run.output)}`;
    say(`unit ${unit} · ${id} · exit 4 · ${message}${note ? ` · ${note}` : ''}`);
    appendHandoff(paths, { ...base, to: status, exit: EXIT.agentDown, reason: message });
    return { ...base, exit: EXIT.agentDown, message, to: status, moved: false };
  }

  // -- contracts that do not depend on the stage.
  const violations: string[] = [];
  const scope = judgeScope(project, before, {
    branch,
    allowed: writesCode ? task.fields.scope : [],
    harnessAllowed: [taskRel, `${artifacts}/**`, '.harness/JOURNAL.md'],
  });
  violations.push(...scope.violations);
  let afterDoc: TaskDoc = beforeDoc;
  try {
    afterDoc = parseTask(readFileSync(task.path, 'utf8'));
    violations.push(...taskWriteViolations(beforeDoc, afterDoc, role).map((v) => `task file: ${v}`));
  } catch (error) {
    violations.push(`task file: ${(error as Error).message}`);
  }
  if (run.timedOut) violations.push(`unit timeout (${config.limits.unitTimeoutMinutes} min)`);
  else if (run.code !== 0) violations.push(`agent exited ${run.code}`);
  const verdict = readVerdict(run.output, config.verdicts[stage]);
  if (!verdict.ok && verdict.reason) violations.push(verdict.reason);

  const park = (reasons: string[], restore: boolean): UnitResult => {
    let note = '';
    if (restore) {
      note = quarantine(project, before, `${id} unit ${unit}`, [], [`${artifacts}/**`]);
      writeFileSync(task.path, beforeText);
    }
    const doc = parseTask(readFileSync(task.path, 'utf8'));
    const reason = `${stage} unit ${unit}: ${reasons.join('; ')}`;
    setField(doc, 'parked', reason);
    setField(doc, 'parkedFrom', status);
    moveTo(doc, 'parked', who);
    for (const line of reasons) appendLog(doc, `  ↳ ${line}`);
    if (note) appendLog(doc, `  ↳ quarantine: ${note}`);
    saveTask(task.path, doc);
    say(`unit ${unit} · ${id} · exit 1 · parked · ${reasons.join('; ')}`);
    appendHandoff(paths, { ...base, to: 'parked', exit: EXIT.hardStop, reason });
    return { ...base, exit: EXIT.hardStop, message: reason, to: 'parked', moved: true };
  };
  if (violations.length) return park(violations, true);

  // -- the stage's own outcome.
  const doc = afterDoc;
  // An agent asks by writing an open question; the runner owns the status move.
  setField(doc, 'status', status);
  let commit: string | undefined;
  let target: Status = status;
  const bounce = (action: 'qa-fail' | 'rejected', reason: string): Status => {
    const fields = taskFields(doc);
    const found = findTransition(fields, 'agent', action, ctx);
    const next = found?.target ?? 'parked';
    setField(doc, 'bounces', fields.bounces + 1);
    if (next === 'parked') {
      setField(doc, 'parked', `bounce cap ${ctx.bounceCap} reached: ${reason}`);
      setField(doc, 'parkedFrom', 'implementing');
    }
    appendLog(doc, `  ↳ ${reason} (bounce ${fields.bounces + 1}/${ctx.bounceCap})`);
    return next;
  };

  switch (stage) {
    case 'spec':
    case 'plan': {
      if (openQuestions(doc).length) {
        setField(doc, 'resume', stage);
        target = 'needs-input';
        break;
      }
      setField(doc, 'resume', null);
      if (stage === 'spec') {
        target = 'plan';
        break;
      }
      const fields = taskFields(doc);
      const criteria = parseCriteria(getSection(doc, 'Acceptance criteria'));
      const problems: string[] = [];
      if (fields.scope.length === 0) problems.push('plan contract: no scope');
      if (!criteria.some((criterion) => criterion.tag === 'closes' && criterion.command))
        problems.push('plan contract: no [closes] criterion with a command');
      const issues = validateTask(doc).filter(
        (issue) => issue.field === 'scope' || issue.field === 'Acceptance criteria',
      );
      problems.push(...issues.map((issue) => `plan contract: ${issue.message}`));
      if (problems.length) return park(problems, false);
      target = 'planned';
      break;
    }
    case 'prototype': {
      if (scope.changed.length) commit = commitUnit(project, scope.changed, `${id}: ${task.fields.title} (prototype)`);
      setField(doc, 'prototype', 'review');
      appendLog(doc, `prototype drafting → review · ${who}`);
      target = 'prototype';
      break;
    }
    case 'implement': {
      if (scope.changed.length === 0) return park(['implement: no change inside scope'], true);
      const gate = runGate(project, task.fields.gate ?? config.gate, before.head);
      if (!gate.ok)
        return park(
          [
            `gate red: \`${gate.command}\``,
            ...gate.output
              .split('\n')
              .filter((line) => line.trim())
              .slice(-5),
          ],
          true,
        );
      if (gate.collateral) appendLog(doc, `  ↳ gate red at base too — inherited, not this unit's: \`${gate.command}\``);
      const round = taskFields(doc).bounces + 1;
      commit = commitUnit(project, scope.changed, `${id}: ${task.fields.title} (round ${round})`);
      target = 'qa';
      break;
    }
    case 'qa': {
      if (verdict.verdict === 'PASS')
        target = findTransition(taskFields(doc), 'agent', 'qa-pass', ctx)?.target ?? 'judge';
      else if (verdict.verdict === 'FAIL') target = bounce('qa-fail', 'qa: FAIL');
      else return park(['qa: CANNOT_VERIFY'], false);
      break;
    }
    case 'judge': {
      if (verdict.verdict === 'CONFIRMED') {
        const closing = runClosing(project, parseCriteria(getSection(doc, 'Acceptance criteria')));
        if (closing.ok) target = 'done';
        else target = bounce('rejected', `judge CONFIRMED but ${closing.reason}`);
      } else {
        target = bounce('rejected', 'judge: REJECTED');
      }
      break;
    }
  }

  if (target !== status) moveTo(doc, target, who);
  if (commit) appendLog(doc, `  ↳ commit ${commit.slice(0, 7)} on ${branch}`);
  saveTask(task.path, doc);
  const message = `${status} → ${target}${commit ? ` · commit ${commit.slice(0, 7)}` : ''}`;
  say(`unit ${unit} · ${id} · ${stage} · exit 0 · ${message}`);
  appendHandoff(paths, { ...base, to: target, exit: EXIT.done, commit: commit ?? null, verdict: verdict.verdict });
  const moved = target !== status || Boolean(commit) || stage === 'prototype';
  return { ...base, exit: EXIT.done, message, to: target, ...(commit ? { commit } : {}), moved };
}

// ---------------------------------------------------------------------------

function checkout(project: string, branch: string): void {
  if (currentBranch(project) !== branch) git(project, ['checkout', '--quiet', branch]);
}

/** The runner commits, never the agent: only the unit's own files, never `.harness/`. */
function commitUnit(project: string, files: readonly string[], message: string): string {
  git(project, ['add', '--all', '--', ...files]);
  git(project, ['commit', '--quiet', '--no-verify', '-m', message]);
  return head(project);
}

function agentCommand(config: HarnessConfig, role: string, options: RunOptions): string {
  const command = options.agentCommand ?? process.env.AGENT_CMD ?? config.agent.command ?? DEFAULT_AGENT_COMMAND;
  const model = config.roles.models[role as keyof HarnessConfig['roles']['models']] ?? 'sonnet';
  return command.replaceAll('{model}', model);
}

function lastLine(text: string): string {
  return text.trimEnd().split('\n').at(-1)?.slice(0, 200) ?? '';
}

export function buildPrompt(
  stage: UnitStage,
  role: string,
  task: LoadedTask,
  taskRel: string,
  branch: string,
  artifacts: string,
  config: HarnessConfig,
): string {
  const read = (name: string) => (existsSync(join(PROMPTS, name)) ? readFileSync(join(PROMPTS, name), 'utf8') : '');
  const stagePrompt = read(`${stage}.md`) || `You are the ${role} coordinator for the ${stage} stage of a task.\n`;
  const verdict = config.verdicts[stage];
  const facts = [
    `- Task: ${task.fields.id} — ${task.fields.title}`,
    `- Task file: ${taskRel} (write only the sections your role owns)`,
    `- Stage: ${stage} · role: ${role} · branch: ${branch}`,
    `- Scope: ${task.fields.scope.length ? task.fields.scope.join(', ') : '(none yet)'}`,
    `- Artifacts folder: ${artifacts}/`,
    `- Bounces so far: ${task.fields.bounces} of ${config.limits.bounces}`,
    verdict ? `- Required verdict line: \`${verdict.token}: ${verdict.values.join('|')}\`` : '',
    '- Do not commit, push or switch branches: the runner does that after its checks.',
  ].filter(Boolean);
  return `${stagePrompt}\n${read('STANDING-RULES.md')}\n## This run\n\n${facts.join('\n')}\n`;
}

interface SpawnInput {
  command: string;
  prompt: string;
  cwd: string;
  tracePath: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}

function isJsonObject(line: string): boolean {
  if (!line.startsWith('{')) return false;
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

/** Spawns the agent through `sh -c`, prompt on stdin, and records every output line to the unit trace. */
function spawnAgent(input: SpawnInput): Promise<AgentRun> {
  return new Promise((resolve) => {
    const trace = createWriteStream(input.tracePath, { flags: 'a' });
    const record = (stream: 'stdout' | 'stderr', chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (!line) continue;
        trace.write(isJsonObject(line) ? `${line}\n` : `${JSON.stringify({ type: 'text', stream, text: line })}\n`);
      }
    };
    let output = '';
    let timedOut = false;
    let spawnError: string | null = null;
    const child = spawn('sh', ['-c', input.command], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, input.timeoutMs);
    let pending = { stdout: '', stderr: '' };
    const onData = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = pending[stream] + data.toString('utf8');
      const cut = text.lastIndexOf('\n');
      pending = { ...pending, [stream]: cut === -1 ? text : text.slice(cut + 1) };
      if (cut !== -1) record(stream, text.slice(0, cut));
      output += data.toString('utf8');
    };
    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));
    child.on('error', (error) => {
      spawnError = error.message;
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input.prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      record('stdout', pending.stdout);
      record('stderr', pending.stderr);
      trace.end(() => resolve({ code: code ?? (spawnError ? 127 : 1), output, timedOut, spawnError }));
    });
  });
}

/** For `harness status`: the snapshot of the queue without running anything. */
export function describeQueue(project: string): { id: string; status: Status; title: string; parked: string | null }[] {
  return listTaskFiles(tracePaths(project).tasks).flatMap((file) => {
    try {
      const { fields } = loadTask(file);
      return [{ id: fields.id, status: fields.status, title: fields.title, parked: fields.parked }];
    } catch {
      return [];
    }
  });
}
