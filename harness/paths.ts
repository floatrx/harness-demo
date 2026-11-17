// Where loop state lives. Everything under `trace/` is local (gitignored) and safe to delete between runs.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { UnitUsage } from './contracts/trace.ts';
import { join } from 'node:path';

export function tracePaths(project: string) {
  const harness = join(project, '.harness');
  const dir = join(harness, 'trace');
  return {
    harness,
    tasks: join(harness, 'tasks'),
    artifacts: join(harness, 'artifacts'),
    journal: join(harness, 'JOURNAL.md'),
    dir,
    lock: join(dir, 'supervisor.lock'),
    pause: join(dir, 'PAUSE'),
    stop: join(dir, 'STOP'),
    /** One file per unit in flight: `running/<unit>.json` (see `listRunning`). */
    running: join(dir, 'running'),
    runningUnit: (n: number) => join(dir, 'running', `${String(n).padStart(4, '0')}.json`),
    progress: join(dir, 'progress.log'),
    handoffs: join(dir, 'handoffs.jsonl'),
    /** One line per recorded task-file write — a human's (CLI, dashboard) or the runner's: path, sha256, who. */
    humanWrites: join(dir, 'human-writes.jsonl'),
    unitSeq: join(dir, 'unit-seq'),
    unit: (n: number) => join(dir, `unit-${String(n).padStart(4, '0')}.jsonl`),
    /** The app the runner started for a unit: its record (pid, port, runner) and its output. */
    app: (n: number) => join(dir, `unit-${String(n).padStart(4, '0')}.app.json`),
    appLog: (n: number) => join(dir, `unit-${String(n).padStart(4, '0')}.app.log`),
    /** The MCP config a browser unit received (Playwright MCP). */
    mcp: (n: number) => join(dir, `unit-${String(n).padStart(4, '0')}.mcp.json`),
    /** The `claude --agents` JSON a unit received. */
    agents: (n: number) => join(dir, `unit-${String(n).padStart(4, '0')}.agents.json`),
  };
}

export type TracePaths = ReturnType<typeof tracePaths>;

export function ensureTrace(paths: TracePaths): void {
  mkdirSync(paths.dir, { recursive: true });
}

export function nextUnitNumber(paths: TracePaths): number {
  ensureTrace(paths);
  const current = existsSync(paths.unitSeq) ? Number(readFileSync(paths.unitSeq, 'utf8').trim()) || 0 : 0;
  writeFileSync(paths.unitSeq, `${current + 1}\n`);
  return current + 1;
}

export interface Running {
  task: string;
  stage: string;
  role: string;
  unit: number;
  pid: number;
  startedAt: string;
}

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * The units in flight, oldest first. A file whose process is gone was left by a crash: it is removed, and the tree
 * checks catch its dirt. A pre-W2 `running.json` is read once and removed the same way.
 */
export function listRunning(paths: TracePaths): Running[] {
  const legacy = join(paths.dir, 'running.json');
  const files = [
    ...(existsSync(legacy) ? [legacy] : []),
    ...(existsSync(paths.running) ? readdirSync(paths.running).filter((name) => name.endsWith('.json')) : []).map(
      (name) => join(paths.running, name),
    ),
  ];
  const units: Running[] = [];
  for (const file of files) {
    let entry: Running | null = null;
    try {
      entry = JSON.parse(readFileSync(file, 'utf8')) as Running;
    } catch {
      // Half-written: the writer is still on it, or it crashed. Either way not a unit to show.
    }
    if (entry && pidAlive(entry.pid)) units.push(entry);
    else if (entry) rmSync(file, { force: true });
  }
  return units.sort((a, b) => a.unit - b.unit);
}

/** The first unit in flight (the dashboard shows one until W3), or null. */
export function readRunning(paths: TracePaths): Running | null {
  return listRunning(paths)[0] ?? null;
}

export function markRunning(paths: TracePaths, entry: Running): void {
  mkdirSync(paths.running, { recursive: true });
  writeFileSync(paths.runningUnit(entry.unit), `${JSON.stringify(entry)}\n`);
}

export function clearRunning(paths: TracePaths, unit: number): void {
  rmSync(paths.runningUnit(unit), { force: true });
}

export function appendProgress(paths: TracePaths, line: string): void {
  ensureTrace(paths);
  appendFileSync(paths.progress, `${new Date().toISOString()} ${line}\n`);
}

export function appendHandoff(paths: TracePaths, record: Record<string, unknown>): void {
  ensureTrace(paths);
  appendFileSync(paths.handoffs, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

/** One line of `handoffs.jsonl`. Units carry `unit`; runner steps (advance, deliver) do not. */
export interface HandoffRecord {
  at: string;
  task?: string;
  stage?: string;
  unit?: number;
  from?: string;
  to?: string;
  exit?: number;
  verdict?: string | null;
  reason?: string;
  commit?: string | null;
  pr?: string;
  /** Set by the runner from P5.4 on; older units fall back to the first stamp of their trace. */
  startedAt?: string;
  /** An advance step: what moved the task. */
  action?: string;
  /** From the unit's stream-json result (readUsage); null when the agent printed none. */
  usage?: Partial<UnitUsage> | null;
}

/* A refused command can carry a token or a URL (`Bash(curl -H "Authorization: …")`). Every reader gets the tool name
   only — the dashboard sends these over SSE to the browser, and `harness stats` prints them. */
const withoutCommands = (record: HandoffRecord): HandoffRecord =>
  record.usage?.permissionDenials
    ? {
        ...record,
        usage: {
          ...record.usage,
          permissionDenials: record.usage.permissionDenials.map((denial) => denial.split('(')[0]?.trim() || '?'),
        },
      }
    : record;

export function readHandoffs(paths: TracePaths): HandoffRecord[] {
  if (!existsSync(paths.handoffs)) return [];
  return readFileSync(paths.handoffs, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [withoutCommands(JSON.parse(line) as HandoffRecord)];
      } catch {
        return [];
      }
    });
}

export function countLines(path: string): number {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
}
