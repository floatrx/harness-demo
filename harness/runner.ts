// One unit of work: pick → branch → snapshot → spawn → scope → task-file → trace → gate → closing →
// transition → commit. The agent is the least trusted part; every check here is code, not instruction.
//
// Exit codes are a vocabulary for the supervisor:
//   0 the step is done · 1 a hard stop fired (the task is parked) · 2 broken configuration ·
//   3 nothing left to take · 4 the agent could not run (usage limit, network, login, probe)

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { runClosing, uncallableCommands } from './contracts/closing.ts';
import { runGate } from './contracts/gate.ts';
import { judgeScope, outsideHarness, quarantine, snapshot } from './contracts/scope.ts';
import { limitResetAt, readUsage, readVerdict, resultEvent } from './contracts/trace.ts';
import { type RunningApp, startApp, stopApp, stopOrphanApps } from './app.ts';
import {
  type AgentDef,
  agentsForStage,
  loadRegistry,
  registryProblems,
  standingRules,
  standingRulesDrift,
  writeAgentsFile,
} from './agents.ts';
import { buildMemory } from './memory.ts';
import { deliverTask } from './deliver.ts';
import { noticeFor, notify } from './notify.ts';
import { branchExists, commitsBetween, currentBranch, dirty, git, head, sh } from './git.ts';
import {
  type TracePaths,
  appendHandoff,
  appendProgress,
  ensureTrace,
  nextUnitNumber,
  readRunning,
  tracePaths,
} from './paths.ts';
import { nextStep, stageFor } from './queue.ts';
import { type TaskDoc, getSection, openQuestions, parseCriteria, parseTask, setField } from './task/parse.ts';
import {
  type LoadedTask,
  type TaskFields,
  listTaskFiles,
  loadTask,
  saveTask,
  slugify,
  taskFields,
} from './task/task.ts';
import { type Status, findTransition } from './task/transitions.ts';
import { validateTask } from './task/validate.ts';
import { SECTION_OWNERS, appendLog, moveTo, taskWriteViolations } from './task/write.ts';

export const EXIT = { done: 0, hardStop: 1, config: 2, idle: 3, agentDown: 4 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface UnitResult {
  exit: ExitCode;
  message: string;
  task?: string;
  stage?: UnitStage | 'advance' | 'deliver';
  from?: Status;
  to?: Status;
  unit?: number;
  commit?: string;
  /** A status changed or a commit landed: the supervisor's progress measure. */
  moved: boolean;
  /** Agent down with a known end: when the usage limit lifts (epoch ms). The supervisor naps until then. */
  retryAt?: number;
}

export interface RunOptions {
  /** Overrides config `agent.command` and the built-in `claude -p` command. Env `AGENT_CMD` does too. */
  agentCommand?: string;
  /** Extra environment for the agent (the fake agent's scenario path, for one). */
  env?: Record<string, string>;
  /** Replaces `gh` for delivery (tests). Env `HARNESS_GH` does too. */
  gh?: string;
  log?: (line: string) => void;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(HERE, 'prompts');

/** Output that means "the agent could not run", not "the agent did bad work". */
const AGENT_DOWN =
  /usage limit|session limit|weekly limit|rate[ -]limit|\b429\b|overloaded|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|not logged in|\/login/i;

/** How the agent is started: the built-in `claude` argv (no shell), or an override command through `sh -c`. */
export interface Invocation {
  file: string;
  args: string[];
  /** For logs and errors. */
  display: string;
}

export function invocation(
  config: HarnessConfig,
  model: string,
  agentsFile: string,
  options: Pick<RunOptions, 'agentCommand'> = {},
): Invocation {
  const override = options.agentCommand ?? process.env.AGENT_CMD ?? config.agent.command;
  if (override) {
    const command = override.replaceAll('{model}', model);
    return { file: 'sh', args: ['-c', command], display: command };
  }
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    '--permission-mode',
    config.agent.permissionMode,
    '--setting-sources',
    config.agent.settingSources,
    '--agents',
    agentsFile,
    // Variadic: it must stay last.
    '--allowedTools',
    ...config.agent.allowedTools,
  ];
  return { file: 'claude', args, display: `claude ${args.slice(0, 12).join(' ')} --allowedTools …` };
}

/**
 * Who pays for the units: a stand-in (AGENT_CMD / agent.command, no tokens), an API key (`claude -p` bills it per
 * token), or the subscription login (usage limits; the cost figures are API-equivalent, not a bill). No value is read
 * beyond "is it set".
 */
export function billing(
  config: HarnessConfig,
  options: Pick<RunOptions, 'agentCommand'> = {},
): { mode: 'stand-in' | 'api-key' | 'subscription'; note: string } {
  if (options.agentCommand ?? process.env.AGENT_CMD ?? config.agent.command)
    return { mode: 'stand-in', note: 'a stand-in replaces claude — no tokens' };
  if (process.env.ANTHROPIC_API_KEY?.trim())
    return { mode: 'api-key', note: 'ANTHROPIC_API_KEY is set — claude -p bills the API per token' };
  return {
    mode: 'subscription',
    note: 'subscription login — usage limits, not a per-token bill; costs shown are API-equivalent',
  };
}

/** The stage's specialists; under merged review the qa unit also gets the judge. */
export function stageSpecialists(registry: readonly AgentDef[], stage: UnitStage, config: HarnessConfig): AgentDef[] {
  const agents = agentsForStage(registry, stage);
  if (stage !== 'qa' || !config.roles.mergeQaJudge) return agents;
  return [...agents, ...registry.filter((agent) => agent.name === 'judge' && !agents.includes(agent))];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// ---------------------------------------------------------------------------

export async function runUnit(project: string, options: RunOptions = {}): Promise<UnitResult> {
  // Apps the step started; stopped here, after the step, whatever way it ended (done, park, crash, timeout).
  const apps: RunningApp[] = [];
  let result: UnitResult;
  try {
    result = await runStep(project, options, apps);
  } finally {
    for (const app of apps) await stopApp(app);
  }
  if (result.task && result.moved) await notifyAfter(project, result);
  return result;
}

/** Tells the human what the step left them (notify.ts). A notification never fails or delays a unit beyond 5 s. */
async function notifyAfter(project: string, result: UnitResult): Promise<void> {
  try {
    const config = loadConfig(project);
    const paths = tracePaths(project);
    const file = join(paths.tasks, `${result.task}.md`);
    if (!existsSync(file)) return;
    const notice = noticeFor(loadTask(file).fields, result.from, config);
    if (notice) await notify(project, config, paths, notice);
  } catch {
    // The unit's outcome is already recorded; a broken config or task file shows up in the next step instead.
  }
}

async function runStep(project: string, options: RunOptions, apps: RunningApp[]): Promise<UnitResult> {
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
  if (running && alive(running.pid))
    return { exit: EXIT.config, message: `a unit is already running: ${running.task} ${running.stage}`, moved: false };
  // A running.json whose process is gone is left by a crash: the tree check below catches its dirt.
  if (running) rmSync(paths.running, { force: true });
  for (const note of await stopOrphanApps(paths.dir)) say(note);

  const drift = standingRulesDrift();
  if (drift.length)
    return {
      exit: EXIT.config,
      message: `standing rules drifted in ${drift.length} agent file(s) — run \`harness agents --sync\``,
      moved: false,
    };
  let registry: AgentDef[];
  try {
    registry = loadRegistry(project);
  } catch (error) {
    return { exit: EXIT.config, message: (error as Error).message, moved: false };
  }
  const problems = registryProblems(registry, config);
  if (problems.length) return { exit: EXIT.config, message: problems.join('; '), moved: false };

  if (config.probe) {
    const probe = sh(config.probe, project);
    if (probe.code !== 0) return { exit: EXIT.agentDown, message: `probe red: ${config.probe}`, moved: false };
  }

  const loaded: LoadedTask[] = [];
  const skip = new Set<string>();
  for (const file of listTaskFiles(paths.tasks)) {
    try {
      const task = loadTask(file);
      // A spec or plan unit rewrites the criteria and the scope, and the plan contract checks them after it: issues
      // there must not keep that unit from running, or a plan sent back to fix them deadlocks (pilot lesson 8).
      const writes = task.fields.status === 'spec' || task.fields.status === 'plan';
      const issues = validateTask(task.doc).filter(
        (issue) => !(writes && (issue.field === 'Acceptance criteria' || issue.field === 'scope')),
      );
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
  if (step.kind === 'deliver') return deliver(project, paths, config, task, options, say);
  return agentUnit(project, paths, config, registry, task, step.stage, options, say, apps);
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

/** Any picture a prototype round left in its artifacts folder (the dashboard shows prototype.png first). */
function hasImage(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).some((name) => /\.(png|webp|jpe?g|svg)$/i.test(name));
}

/** `deliver.pr`: push the done task's branch and open its pull request (harness/deliver.ts). */
function deliver(
  project: string,
  paths: TracePaths,
  config: HarnessConfig,
  task: LoadedTask,
  options: RunOptions,
  say: (line: string) => void,
): UnitResult {
  const id = task.fields.id;
  const standIn = options.agentCommand ?? process.env.AGENT_CMD ?? config.agent.command;
  const result = deliverTask(project, paths, config, task, {
    agent: standIn ? 'stand-in' : 'claude',
    ...(options.gh ? { gh: options.gh } : {}),
  });
  const to = result.ok ? 'delivered' : 'parked';
  say(`${id} done → ${to} (deliver)${result.ok ? ` · ${result.pr}` : ` · ${result.reason}`}`);
  return {
    exit: result.ok ? EXIT.done : EXIT.hardStop,
    message: result.ok ? `pull request ${result.pr}` : (result.reason ?? 'delivery failed'),
    task: id,
    stage: 'deliver',
    from: 'done',
    to,
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
  registry: readonly AgentDef[],
  task: LoadedTask,
  stage: UnitStage,
  options: RunOptions,
  say: (line: string) => void,
  /** Filled with the app this unit starts; `runUnit` stops it after the unit. */
  apps: RunningApp[],
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
  // -- the app (qa, prototype): started before the snapshot, so what the server writes at start is not the unit's.
  let appUrl: string | null = null;
  if (config.app?.stages.includes(stage)) {
    const started = await startApp(config.app, project, { log: paths.appLog(unit), record: paths.app(unit) });
    if (started.ok) {
      apps.push(started.app);
      appUrl = started.app.url;
    } else {
      // Not a stop: a broken dev server must not park every task. The unit runs as it would without an app.
      appendLog(task.doc, `  ↳ app did not start: ${started.reason}`);
      say(`unit ${unit} · ${id} · app did not start: ${started.reason}`);
    }
  }
  if (statusAtPick === 'ready') {
    const found = findTransition(task.fields, 'agent', 'start', ctx);
    if (found) moveTo(task.doc, found.target, `runner · unit ${unit}`);
  }
  saveTask(task.path, task.doc);

  const startedAt = new Date().toISOString();
  const before = snapshot(project);
  const beforeText = readFileSync(task.path, 'utf8');
  const beforeDoc = parseTask(beforeText);
  const status = taskFields(beforeDoc).status;
  writeFileSync(paths.running, `${JSON.stringify({ task: id, stage, role, unit, pid: process.pid, startedAt })}\n`);
  say(`unit ${unit} · ${id} · ${stage} · ${role} · start`);

  const specialists = stageSpecialists(registry, stage, config);
  const agentsFile = paths.agents(unit);
  writeAgentsFile(agentsFile, specialists, config);
  const model = config.roles.models[role] ?? 'sonnet';
  const how = invocation(config, model, agentsFile, options);
  const memory = buildMemory(project, paths, task.fields, stage, config.baseBranch);
  // The folder exists before the agent starts: `mkdir` is not on the allowlist (pilot lesson 3).
  mkdirSync(join(project, artifacts), { recursive: true });

  let run: AgentRun;
  try {
    run = await spawnAgent({
      invocation: how,
      prompt: buildPrompt({
        stage,
        role,
        task: task.fields,
        taskRel,
        branch,
        artifacts,
        config,
        specialists,
        memory,
        appUrl,
      }),
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
        ...(appUrl ? { HARNESS_APP_URL: appUrl } : {}),
        HARNESS_AGENTS_FILE: agentsFile,
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      },
    });
  } finally {
    rmSync(paths.running, { force: true });
  }

  const base = { task: id, stage, unit, from: status, startedAt } as const;

  // -- the agent command does not exist: configuration, waiting fixes nothing.
  if (run.code === 127 || /ENOENT/.test(run.spawnError ?? '')) {
    const note = quarantine(project, before, `${id} unit ${unit}`, [], []);
    writeFileSync(task.path, beforeText);
    const message = `agent command not found: ${lastLine(run.output) || how.display}`;
    say(`unit ${unit} · ${id} · exit 2 · ${message}${note ? ` · ${note}` : ''}`);
    return { ...base, exit: EXIT.config, message, to: status, moved: false };
  }

  // -- the agent could not run: put everything back, the task is untouched, the supervisor waits.
  if (run.spawnError || (run.code !== 0 && AGENT_DOWN.test(run.output))) {
    const note = quarantine(project, before, `${id} unit ${unit}`, [], []);
    writeFileSync(task.path, beforeText);
    // The result text says why ("You've hit your session limit · resets 9:10pm (…)"); the last stream-json line
    // is often a bare session_state_changed event (pilot lesson 9).
    const why = run.spawnError ?? (resultEvent(run.output)?.result || lastLine(run.output));
    const message = `agent could not run: ${why.replace(/\s+/g, ' ').slice(0, 200)}`;
    const retryAt = limitResetAt(why)?.getTime();
    say(`unit ${unit} · ${id} · exit 4 · ${message}${note ? ` · ${note}` : ''}`);
    appendHandoff(paths, { ...base, to: status, exit: EXIT.agentDown, reason: message });
    return { ...base, exit: EXIT.agentDown, message, to: status, moved: false, ...(retryAt ? { retryAt } : {}) };
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
    appendHandoff(paths, { ...base, to: 'parked', exit: EXIT.hardStop, reason, usage: readUsage(run.output) });
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
      problems.push(...uncallableCommands(project, criteria).map((problem) => `plan contract: ${problem}`));
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
      // Not a hard stop — a route alone is reviewable — but the human should know why the dashboard shows no picture.
      if (!hasImage(join(project, artifacts))) appendLog(doc, `  ↳ no image in ${artifacts}/ — review the route`);
      target = 'prototype';
      break;
    }
    case 'implement': {
      if (scope.changed.length === 0) {
        // A later round may find nothing to fix in the code (a wrong reject, a broken check): when the branch already
        // holds this task's commits, qa and the judge decide again. A round with no work on the branch is barren.
        // Not `bounces`: Reopen resets it, and the pilot's reopened round was parked here (lesson 4).
        if (commitsBetween(project, config.baseBranch, 'HEAD').length === 0)
          return park(['implement: no change inside scope'], true);
        appendLog(doc, '  ↳ no change this round — the implementer found nothing to fix; the branch already holds the work');
        target = 'qa';
        break;
      }
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
      if (verdict.verdict === 'PASS') {
        target = findTransition(taskFields(doc), 'agent', 'qa-pass', ctx)?.target ?? 'judge';
        // Merged review closes the task here, so the closing contract runs here too.
        if (target === 'done') {
          const closing = runClosing(project, parseCriteria(getSection(doc, 'Acceptance criteria')));
          if (!closing.ok) target = bounce('qa-fail', `qa PASS but ${closing.reason}`);
        }
      } else if (verdict.verdict === 'FAIL') target = bounce('qa-fail', 'qa: FAIL');
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
  appendHandoff(paths, {
    ...base,
    to: target,
    exit: EXIT.done,
    commit: commit ?? null,
    verdict: verdict.verdict,
    usage: readUsage(run.output),
  });
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

function lastLine(text: string): string {
  return text.trimEnd().split('\n').at(-1)?.slice(0, 200) ?? '';
}

export interface PromptInput {
  stage: UnitStage;
  role: string;
  task: TaskFields;
  taskRel: string;
  branch: string;
  artifacts: string;
  config: HarnessConfig;
  specialists: readonly AgentDef[];
  memory: string;
  /** The app the runner started for this unit, if any. */
  appUrl?: string | null;
}

/** Stage prompt + standing rules + the specialists this stage may dispatch + memory + `## This run`. */
/**
 * The `##` sections this role may write, from the same table the task-file contract checks (pilot lesson: a real
 * planner wrote `## Risks` and `## Tests` and was parked — the prompt now says where such content goes).
 */
function ownedSections(role: string): string {
  const owned = Object.entries(SECTION_OWNERS)
    .filter(([, owners]) => (owners as readonly string[]).includes(role))
    .map(([name]) => `\`## ${name}\``);
  if (!owned.length) return '- Task-file sections you may write: none — this stage changes no section.';
  return `- Task-file sections you may write: ${owned.join(', ')}. Put anything else (risks, tests, notes) inside them as \`###\` subsections; any other \`##\` heading stops the unit.`;
}

export function buildPrompt(input: PromptInput): string {
  const { stage, role, task, config } = input;
  const stagePath = join(PROMPTS, `${stage}.md`);
  const stagePrompt = existsSync(stagePath)
    ? readFileSync(stagePath, 'utf8').trim()
    : `You coordinate the ${stage} stage of a task as the ${role}.`;
  const verdict = config.verdicts[stage];
  const specialists = input.specialists.length
    ? input.specialists
        .map((agent) => `- \`${agent.name}\` — ${agent.when || 'any time'}. ${agent.description}`)
        .join('\n')
    : '- (none registered for this stage — do the work yourself)';
  const facts = [
    `- Task: ${task.id} — ${task.title} (kind: ${task.kind ?? 'unset'})`,
    `- Task file: ${input.taskRel}`,
    `- Stage: ${stage} · you coordinate as: ${role} · branch: ${input.branch} · base: ${config.baseBranch}`,
    `- Scope: ${task.scope.length ? task.scope.join(', ') : '(none yet — the plan sets it)'}`,
    `- Gate: ${task.gate ?? config.gate ?? '(none)'}`,
    `- Artifacts folder: ${input.artifacts}/`,
    input.appUrl
      ? `- App: ${input.appUrl} — the runner started it and stops it after this unit; do not start or stop a server.`
      : '',
    ownedSections(role),
    `- Bounces so far: ${task.bounces} of ${config.limits.bounces}`,
    stage === 'qa' && config.roles.mergeQaJudge
      ? '- Merged review: there is no judge stage. After qa, dispatch `judge` too and PASS only if it would CONFIRM.'
      : '',
    verdict
      ? `- Required verdict line: \`${verdict.token}: ${verdict.values.join('|')}\``
      : '- No verdict line is needed.',
  ];
  return [
    stagePrompt,
    standingRules(),
    `## Specialists you may dispatch\n\n${specialists}`,
    input.memory,
    `## This run\n\n${facts.filter(Boolean).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
}

interface SpawnInput {
  invocation: Invocation;
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

/** Spawns the agent (prompt on stdin) and records every output line to the unit trace. */
function spawnAgent(input: SpawnInput): Promise<AgentRun> {
  return new Promise((resolve) => {
    const trace = createWriteStream(input.tracePath, { flags: 'a' });
    const record = (stream: 'stdout' | 'stderr', chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (!line) continue;
        /* Every line carries the time it arrived (stream-json events have none), so a viewer can time each agent. */
        const ts = new Date().toISOString();
        trace.write(
          isJsonObject(line)
            ? `{"harness_ts":"${ts}"${/^\{\s*\}$/.test(line) ? '' : ','}${line.slice(1)}\n`
            : `${JSON.stringify({ type: 'text', harness_ts: ts, stream, text: line })}\n`,
        );
      }
    };
    let output = '';
    let timedOut = false;
    let spawnError: string | null = null;
    const child = spawn(input.invocation.file, input.invocation.args, {
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

export interface Preview {
  task: string;
  /** Set when the task is not where the unit would run yet, e.g. a draft previewed as if submitted. */
  note?: string;
  stage: UnitStage;
  role: string;
  invocation: Invocation;
  specialists: string[];
  prompt: string;
}

/**
 * What the next unit for a task would receive — stage, argv, specialists, the full prompt — without running
 * anything, switching a branch or spending a token. The agents JSON is written to `trace/preview.agents.json`.
 */
export function previewUnit(project: string, id: string): Preview {
  const config = loadConfig(project);
  const paths = tracePaths(project);
  ensureTrace(paths);
  const task = loadTask(join(paths.tasks, `${id}.md`));
  // A draft has no unit yet; show the spec unit Submit would give it, so the prompt is visible before any token
  // (the README's quickstart previews a seed draft — it used to fail here).
  const draft = task.fields.status === 'draft';
  const fields: TaskFields = draft ? { ...task.fields, status: 'spec' } : task.fields;
  const stage = stageFor(fields);
  if (!stage) throw new ConfigError(`${id} is in ${task.fields.status}: no agent unit runs there`);
  const role = STAGE_ROLE[stage];
  const registry = loadRegistry(project);
  const specialists = stageSpecialists(registry, stage, config);
  const agentsFile = join(paths.dir, 'preview.agents.json');
  writeAgentsFile(agentsFile, specialists, config);
  const branch =
    stage === 'spec' || stage === 'plan'
      ? config.baseBranch
      : (fields.branch ?? `harness/${id}-${slugify(fields.title)}`);
  const memory = buildMemory(project, paths, fields, stage, config.baseBranch);
  return {
    task: id,
    ...(draft ? { note: `${id} is a draft: this is the spec unit it gets after Submit` } : {}),
    stage,
    role,
    invocation: invocation(config, config.roles.models[role] ?? 'sonnet', agentsFile),
    specialists: specialists.map((agent) => agent.name),
    prompt: buildPrompt({
      stage,
      role,
      task: fields,
      taskRel: relative(project, task.path),
      branch,
      artifacts: `.harness/artifacts/${id}`,
      config,
      specialists,
      memory,
      appUrl: config.app?.stages.includes(stage) ? 'http://127.0.0.1:<port>' : null,
    }),
  };
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
