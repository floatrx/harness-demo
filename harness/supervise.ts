// The supervisor: policy over time. It runs up to `limits.parallel` units at once and decides what each exit code means.
//
// - one loop per checkout (`trace/supervisor.lock`, a dead holder is taken over);
// - up to `limits.parallel` steps in flight, one per task, one in the main checkout (the runner's pick enforces both);
// - `trace/PAUSE` and `trace/STOP` are files read at the unit boundary, never mid-turn: no new unit starts, the units
//   in flight finish;
// - exit 2 stops (waiting fixes nothing); 4 waits for the agent to come back, up to a ceiling;
// - `barrenUnits` units in a row that moved nothing stop the loop instead of spinning;
// - an optional deadline.
//
// Supervisor exit codes: 0 stopped or drained · 2 broken configuration · 3 barren · 4 gave up waiting.

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { type HarnessConfig, ConfigError, loadConfig } from './config.ts';
import { deliveryPreflight } from './deliver.ts';
import { notify } from './notify.ts';
import { sh } from './git.ts';
import { appendProgress, ensureTrace, tracePaths } from './paths.ts';
import { type Claim, type RunOptions, type UnitResult, EXIT, billing, runUnit } from './runner.ts';

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
  if (config.deliver.pr) {
    const problem = deliveryPreflight(project, config, options.gh);
    if (problem) {
      say(`exit 2 · ${problem}`);
      return { exit: 2, reason: problem, units: [] };
    }
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
  // Milliseconds, not rounded seconds: with sub-second naps a rounded counter stayed 0, the ceiling never came and the
  // "agent could not run" notice went out on every turn of the loop (2026-10-26).
  let waitedMs = 0;
  let downNotified = false;
  let signalled = false;
  const onSignal = () => {
    signalled = true;
    say('signal received — stopping at the unit boundary');
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const stopRequested = () => signalled || existsSync(paths.stop);

  /** Sleeps up to `ms`, waking early for STOP, or when `wake` says so. Returns false when a stop was requested. */
  const nap = async (ms: number, wake?: () => boolean) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (stopRequested()) return false;
      if (wake?.()) break;
      await sleep(Math.min(s.pausePollSeconds * 1000, until - Date.now()));
    }
    return !stopRequested();
  };

  /* The human hears how a run ended, unless they ended it themselves (Stop, a signal). */
  const finish = async (exit: SuperviseResult['exit'], reason: string): Promise<SuperviseResult> => {
    say(`exit ${exit} · ${reason}`);
    if (!/^stopped|^signal/.test(reason))
      await notify(project, config, paths, {
        event: 'supervisor',
        text: `supervisor stopped (exit ${exit}): ${reason}`,
      });
    return { exit, reason, units };
  };

  say(`start · pid ${process.pid}${options.onceThrough ? ' · once-through' : ''}`);
  say(`billing: ${billing(config, options).note}`);

  // The units in flight. Each settles to itself, so the one that ended can be taken out of the pool.
  type Flying = Promise<{ flying: Flying; result: UnitResult }>;
  const pool = new Set<Flying>();
  const parallel = config.limits.parallel;
  const halt: {
    /** The run ends once the pool is empty (a config error, barren). */
    ending: { exit: SuperviseResult['exit']; reason: string } | null;
    /** The agent could not run: no new start; the wait begins once the pool is empty. */
    down: UnitResult | null;
  } = { ending: null, down: null };

  /* One step: start it, and wait only until it has taken its task — or ended without one. */
  const start = async (): Promise<UnitResult | null> => {
    let claimed: (claim: Claim | null) => void = () => {};
    const picked = new Promise<Claim | null>((resolve) => (claimed = resolve));
    const run = (options.unitRunner ?? runUnit)(project, { ...options, onClaim: (claim) => claimed(claim) });
    const claim = await Promise.race([picked, run.then(() => null)]);
    if (!claim) return run;
    const flying: Flying = run.then((result) => ({ flying, result }));
    pool.add(flying);
    return null;
  };

  /* What a finished unit means for the run; the same policy as one unit at a time, applied as each one ends. */
  const settle = (result: UnitResult) => {
    units.push(result);
    switch (result.exit) {
      case EXIT.done:
      case EXIT.hardStop:
        waitedMs = 0;
        downNotified = false;
        barren = result.moved ? 0 : barren + 1;
        if (barren >= s.barrenUnits) halt.ending ??= { exit: 3, reason: `${barren} units in a row moved nothing` };
        break;
      case EXIT.config:
        halt.ending ??= { exit: 2, reason: result.message };
        break;
      case EXIT.agentDown:
        halt.down ??= result;
        break;
    }
  };

  const landOne = async () => {
    const { flying, result } = await Promise.race(pool);
    pool.delete(flying);
    settle(result);
  };

  /** The agent could not run: wait for it as before. False = a stop was requested meanwhile. */
  const waitForDown = async (result: UnitResult): Promise<SuperviseResult | null> => {
    if (waitedMs >= s.usageCeilingSeconds * 1000)
      return finish(4, `agent still down after ${Math.round(waitedMs / 1000)}s`);
    // A limit that names its reset: nap until then (+1 min), unless that runs past the ceiling.
    const left = s.usageCeilingSeconds * 1000 - waitedMs;
    const until = result.retryAt && result.retryAt - Date.now() < left ? result.retryAt + 60_000 : undefined;
    say(`agent could not run (${result.message}) — waiting${until ? ` until ${new Date(until).toISOString()}` : ''}`);
    if (!downNotified) {
      downNotified = true;
      await notify(project, config, paths, {
        event: 'supervisor',
        text: `the agent could not run (${result.message}) — waiting, then retrying`,
      });
    }
    const started = Date.now();
    const ok = until ? await nap(Math.max(0, until - Date.now())) : await waitForAgent(project, config, nap);
    waitedMs += Date.now() - started;
    return ok ? null : finish(0, 'stopped while waiting for the agent');
  };

  try {
    for (;;) {
      // A reason not to start another unit now. The units in flight always finish first.
      const hold = halt.ending
        ? 'ending'
        : halt.down
          ? 'down'
          : stopRequested()
            ? 'stop'
            : existsSync(paths.pause)
              ? 'pause'
              : options.deadline && Date.now() >= options.deadline
                ? 'deadline'
                : options.maxUnits !== undefined && units.length + pool.size >= options.maxUnits
                  ? 'max'
                  : pool.size >= parallel
                    ? 'full'
                    : null;
      if (hold && pool.size) {
        await landOne();
        continue;
      }
      if (halt.ending) return finish(halt.ending.exit, halt.ending.reason);
      if (halt.down) {
        const result = halt.down;
        halt.down = null;
        const stop = await waitForDown(result);
        if (stop) return stop;
        continue;
      }
      if (hold === 'stop') return finish(0, 'stopped');
      if (hold === 'pause') {
        say('paused at the unit boundary');
        while (existsSync(paths.pause) && !stopRequested()) await sleep(s.pausePollSeconds * 1000);
        if (stopRequested()) return finish(0, 'stopped while paused');
        say('resumed');
        continue;
      }
      if (hold === 'deadline') return finish(0, 'deadline reached');
      if (hold === 'max') return finish(0, `max units (${options.maxUnits})`);

      const result = await start();
      if (!result) continue; // it took a task and runs; try to start another beside it
      if (result.exit !== EXIT.idle) {
        settle(result);
        continue;
      }
      // Nothing to start beside the units in flight: wait for one of them to end, then pick again. Not a unit: it is
      // not counted (maxUnits, the result list).
      if (pool.size) {
        await landOne();
        continue;
      }
      units.push(result);
      if (options.onceThrough) return finish(0, 'drained: nothing left to take');
      // Every human action (CLI or dashboard) appends to the write ledger: wake on it instead of sleeping out the idle
      // poll, or an Approve sat unanswered for up to 30 s (quickstart review).
      const ledger = () => (existsSync(paths.humanWrites) ? statSync(paths.humanWrites).size : 0);
      const seen = ledger();
      if (!(await nap(s.idlePollSeconds * 1000, () => ledger() !== seen))) return finish(0, 'stopped while idle');
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
