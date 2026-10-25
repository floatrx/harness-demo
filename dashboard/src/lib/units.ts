/* Server-only: every unit a project has run, from handoffs.jsonl, with its duration. Shared by /live and /stats. */

import { existsSync, readFileSync } from 'node:fs';
import { tracePaths } from '@harness/core/paths';
import { type Handoff, readHandoffs } from './board.ts';

export interface UnitRecord extends Handoff {
  unit: number;
  startedAt: string | null;
  durationMs: number | null;
}

/* Units run before the runner recorded startedAt: take the first stamped line of their trace. */
const traceStart = (file: string): string | null => {
  if (!existsSync(file)) return null;
  const first = readFileSync(file, 'utf8').slice(0, 400).split('\n')[0] ?? '';
  return /"harness_ts":"([^"]+)"/.exec(first)?.[1] ?? null;
};

export function listUnits(projectPath: string): UnitRecord[] {
  const paths = tracePaths(projectPath);
  return readHandoffs(projectPath).flatMap((handoff) => {
    if (handoff.stage === 'advance' || typeof handoff.unit !== 'number') return [];
    const startedAt = (handoff as Handoff & { startedAt?: string }).startedAt ?? traceStart(paths.unit(handoff.unit));
    const durationMs =
      handoff.usage?.durationMs ??
      (startedAt ? Math.max(0, new Date(handoff.at).getTime() - new Date(startedAt).getTime()) : null);
    return [{ ...handoff, unit: handoff.unit, startedAt, durationMs }];
  });
}

export const EXIT_LABEL: Record<number, string> = {
  0: 'done',
  1: 'hard stop',
  2: 'config',
  3: 'idle',
  4: 'agent down',
};
