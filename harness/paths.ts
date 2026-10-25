// Where loop state lives. Everything under `trace/` is local (gitignored) and safe to delete between runs.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    running: join(dir, 'running.json'),
    progress: join(dir, 'progress.log'),
    handoffs: join(dir, 'handoffs.jsonl'),
    unitSeq: join(dir, 'unit-seq'),
    unit: (n: number) => join(dir, `unit-${String(n).padStart(4, '0')}.jsonl`),
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

export function readRunning(paths: TracePaths): Running | null {
  if (!existsSync(paths.running)) return null;
  try {
    return JSON.parse(readFileSync(paths.running, 'utf8')) as Running;
  } catch {
    return null;
  }
}

export function appendProgress(paths: TracePaths, line: string): void {
  ensureTrace(paths);
  appendFileSync(paths.progress, `${new Date().toISOString()} ${line}\n`);
}

export function appendHandoff(paths: TracePaths, record: Record<string, unknown>): void {
  ensureTrace(paths);
  appendFileSync(paths.handoffs, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

export function countLines(path: string): number {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
}
