/* Server-only: what /stats shows — units, time, tokens and cost per stage and per task, from handoffs.jsonl.

   Honesty rules: a unit whose agent printed no stream-json result has NO usage. Its cost is unknown, not zero, so
   a row whose units all lack usage shows null, and the page says how many units reported. Permission denials keep the
   tool name only; the refused command never leaves this module (it can carry a token or a URL). */

import { STAGE_ROLE, UNIT_STAGES, type UnitStage } from '@harness/core/config';
import type { UnitRecord } from './units.ts';

export interface StatRow {
  key: string;
  units: number;
  /** Units that ended with exit 0. */
  ok: number;
  /** Units that ended in a hard stop (exit 1): the contracts parked the task. */
  stops: number;
  /** Units in this row that reported usage. */
  reported: number;
  /** Sum over the reporting units; null when none reported. */
  costUsd: number | null;
  /** Input + output tokens; cache reads are counted apart (they are cheap and large). */
  tokens: number;
  cacheReadTokens: number;
  durationMs: number;
}

export interface TaskInfo {
  id: string;
  title: string;
  status: string;
}

export interface ProjectStats {
  total: StatRow;
  byStage: (StatRow & { role: string })[];
  byTask: (StatRow & { title: string | null; status: string | null })[];
  verdicts: { stage: string; verdict: string; count: number }[];
  denials: { tool: string; count: number; units: number[] }[];
  firstAt: string | null;
  lastAt: string | null;
}

const emptyRow = (key: string): StatRow => ({
  key,
  units: 0,
  ok: 0,
  stops: 0,
  reported: 0,
  costUsd: null,
  tokens: 0,
  cacheReadTokens: 0,
  durationMs: 0,
});

function add(row: StatRow, unit: UnitRecord): void {
  row.units++;
  if (unit.exit === 0) row.ok++;
  if (unit.exit === 1) row.stops++;
  row.durationMs += unit.durationMs ?? 0;
  const usage = unit.usage;
  if (!usage) return;
  row.reported++;
  if (typeof usage.costUsd === 'number') row.costUsd = (row.costUsd ?? 0) + usage.costUsd;
  row.tokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  row.cacheReadTokens += usage.cacheReadTokens ?? 0;
}

/** `Bash(curl -H "Authorization: …")` → `Bash`. */
const toolOf = (denial: string) => denial.split('(')[0]?.trim() || '?';

export function computeStats(units: readonly UnitRecord[], tasks: readonly TaskInfo[]): ProjectStats {
  const total = emptyRow('all');
  const stages = new Map<string, StatRow>(UNIT_STAGES.map((stage) => [stage, emptyRow(stage)]));
  const byTask = new Map<string, StatRow>();
  const verdicts = new Map<string, number>();
  const denials = new Map<string, { count: number; units: number[] }>();
  for (const unit of units) {
    add(total, unit);
    const stage = unit.stage ?? '?';
    if (!stages.has(stage)) stages.set(stage, emptyRow(stage));
    add(stages.get(stage) as StatRow, unit);
    const task = unit.task ?? '?';
    if (!byTask.has(task)) byTask.set(task, emptyRow(task));
    add(byTask.get(task) as StatRow, unit);
    if (unit.verdict)
      verdicts.set(`${stage}\u0000${unit.verdict}`, (verdicts.get(`${stage}\u0000${unit.verdict}`) ?? 0) + 1);
    for (const denial of unit.usage?.permissionDenials ?? []) {
      const tool = toolOf(denial);
      const entry = denials.get(tool) ?? { count: 0, units: [] };
      entry.count++;
      if (!entry.units.includes(unit.unit)) entry.units.push(unit.unit);
      denials.set(tool, entry);
    }
  }
  const titles = new Map(tasks.map((task) => [task.id, task]));
  const weight = (row: StatRow) => row.costUsd ?? 0;
  return {
    total,
    byStage: [...stages.values()].map((row) => ({ ...row, role: STAGE_ROLE[row.key as UnitStage] ?? row.key })),
    byTask: [...byTask.values()]
      .map((row) => ({
        ...row,
        title: titles.get(row.key)?.title ?? null,
        status: titles.get(row.key)?.status ?? null,
      }))
      .sort((a, b) => weight(b) - weight(a) || b.durationMs - a.durationMs || a.key.localeCompare(b.key)),
    verdicts: [...verdicts.entries()].map(([key, count]) => {
      const [stage = '?', verdict = '?'] = key.split('\u0000');
      return { stage, verdict, count };
    }),
    denials: [...denials.entries()].map(([tool, entry]) => ({ tool, ...entry })).sort((a, b) => b.count - a.count),
    firstAt: units[0]?.startedAt ?? units[0]?.at ?? null,
    lastAt: units.at(-1)?.at ?? null,
  };
}
