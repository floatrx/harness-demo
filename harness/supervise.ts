// The supervisor: policy over time. It runs units one at a time and decides what each exit code means.
//
// - one loop per checkout (`trace/supervisor.lock`, a dead holder is taken over);
// - `trace/PAUSE` and `trace/STOP` are files read at the unit boundary, never mid-turn;
// - exit 2 stops (waiting fixes nothing); 4 waits for the agent to come back, up to a ceiling;
// - `barrenUnits` units in a row that moved nothing stop the loop instead of spinning;
// - an optional deadline.
//
// Supervisor exit codes: 0 stopped or drained · 2 broken configuration · 3 barren · 4 gave up waiting.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type HarnessConfig, ConfigError, loadConfig } from './config.ts';
import { sh } from './git.ts';
import { appendProgress, ensureTrace, tracePaths } from './paths.ts';
import { type RunOptions, type UnitResult, EXIT, runUnit } from './runner.ts';

export interface SuperviseOptions extends RunOptions {
  /** Exit 0 when nothing is left to take instead of idling for new work. */
  onceThrough?: boolean;
  /** Epoch ms; no unit starts after it. */
  deadline?: number;
  /** Safety cap on units per run (tests). */
  maxUnits?: number;
  /** Replaces the runner (tests of the supervisor policy alone). */
  unitRunner?: typeof runUnit;
}

export interface SuperviseResult {
  exit: 0 | 2 | 3 | 4;
  reason: string;
  units: UnitResult[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function lockHolder(project: string): number | null {
  const { lock } = tracePaths(project);
  if (!existsSync(lock)) return null;
  const pid = Number(JSON.parse(readFileSync(lock, 'utf8')).pid);
  return Number.isInteger(pid) && alive(pid) ? pid : null;
}

export async function supervise(project: string, options: SuperviseOptions = {}): Promise<SuperviseResult> {
  const paths = tracePaths(project);
  ensureTrace(paths);
  const say = (line: string) => {
    appendProgress(paths, `supervisor · ${line}`);
    options.log?.(`supervisor · ${line}`);
  };
  let config: HarnessConfig;
  try {
    config = loadConfig(project);
  } catch (error) {
    if (error instanceof ConfigError) return { exit: 2, reason: error.message, units: [] };
    throw error;
  }
  const holder = lockHolder(project);
  if (holder && holder !== process.pid)
    return { exit: 2, reason: `another supervisor runs this checkout (pid ${holder})`, units: [] };
  writeFileSync(paths.lock, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  // A STOP left by an earlier run would end this one before it starts.
  rmSync(paths.stop, { force: true });

  const s = config.supervisor;
  const units: UnitResult[] = [];
  let barren = 0;
  let waitedForAgent = 0;
  let signalled = false;
  const onSignal = () => {
    signalled = true;
    say('signal received — stopping at the unit boundary');
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const stopRequested = () => signalled || existsSync(paths.stop);

  /** Sleeps up to `ms`, waking early for STOP. Returns false when a stop was requested. */
  const nap = async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (stopRequested()) return false;
      await sleep(Math.min(s.pausePollSeconds * 1000, until - Date.now()));
    }
    return !stopRequested();
  };

  const finish = (exit: SuperviseResult['exit'], reason: string): SuperviseResult => {
    say(`exit ${exit} · ${reason}`);
    return { exit, reason, units };
  };

  say(`start · pid ${process.pid}${options.onceThrough ? ' · once-through' : ''}`);
  try {
    for (;;) {
      if (stopRequested()) return finish(0, 'stopped');
      if (existsSync(paths.pause)) {
        say('paused at the unit boundary');
        while (existsSync(paths.pause) && !stopRequested()) await sleep(s.pausePollSeconds * 1000);
        if (stopRequested()) return finish(0, 'stopped while paused');
        say('resumed');
      }
      if (options.deadline && Date.now() >= options.deadline) return finish(0, 'deadline reached');
      if (options.maxUnits !== undefined && units.length >= options.maxUnits)
        return finish(0, `max units (${options.maxUnits})`);

      const result = await (options.unitRunner ?? runUnit)(project, options);
      units.push(result);
      switch (result.exit) {
        case EXIT.done:
        case EXIT.hardStop:
          waitedForAgent = 0;
          barren = result.moved ? 0 : barren + 1;
          if (barren >= s.barrenUnits) return finish(3, `${barren} units in a row moved nothing`);
          break;
        case EXIT.config:
          return finish(2, result.message);
        case EXIT.idle:
          if (options.onceThrough) return finish(0, 'drained: nothing left to take');
          if (!(await nap(s.idlePollSeconds * 1000))) return finish(0, 'stopped while idle');
          break;
        case EXIT.agentDown: {
          if (waitedForAgent >= s.usageCeilingSeconds) return finish(4, `agent still down after ${waitedForAgent}s`);
          say(`agent could not run (${result.message}) — waiting`);
          const started = Date.now();
          const ok = await waitForAgent(project, config, nap);
          waitedForAgent += Math.round((Date.now() - started) / 1000);
          if (!ok) return finish(0, 'stopped while waiting for the agent');
          break;
        }
      }
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    const lock = existsSync(paths.lock) ? JSON.parse(readFileSync(paths.lock, 'utf8')) : null;
    if (lock?.pid === process.pid) rmSync(paths.lock, { force: true });
  }
}

/** With a probe: poll it until green. Without: one long nap. False = a stop was requested. */
async function waitForAgent(
  project: string,
  config: HarnessConfig,
  nap: (ms: number) => Promise<boolean>,
): Promise<boolean> {
  const s = config.supervisor;
  if (!config.probe) return nap(s.usageNapSeconds * 1000);
  const until = Date.now() + s.usageNapSeconds * 1000;
  while (Date.now() < until) {
    if (sh(config.probe, project).code === 0) return true;
    if (!(await nap(s.usageProbeSeconds * 1000))) return false;
  }
  return true;
}

// ---- control files (the CLI and the dashboard write the same ones) -------

export function requestPause(project: string): void {
  const paths = tracePaths(project);
  ensureTrace(paths);
  writeFileSync(paths.pause, `${new Date().toISOString()}\n`);
}

export function requestResume(project: string): boolean {
  const { pause } = tracePaths(project);
  const was = existsSync(pause);
  rmSync(pause, { force: true });
  return was;
}

export function requestStop(project: string): void {
  const paths = tracePaths(project);
  ensureTrace(paths);
  writeFileSync(paths.stop, `${new Date().toISOString()}\n`);
}
