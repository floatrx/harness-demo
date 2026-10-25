// Executable closing: a judge's CONFIRMED is re-checked by code. Every `[closes]` criterion is a shell
// command; the runner runs each one and only exit 0 closes it.

import { sh } from '../git.ts';
import type { Criterion } from '../task/parse.ts';

export interface ClosingResult {
  ok: boolean;
  results: { n: number; command: string; code: number }[];
  reason: string | null;
}

export function runClosing(project: string, criteria: readonly Criterion[]): ClosingResult {
  const closes = criteria.filter((criterion) => criterion.tag === 'closes');
  if (closes.length === 0) return { ok: false, results: [], reason: 'closing: no [closes] criterion to check' };
  const results = closes.map((criterion) => {
    const command = criterion.command ?? '';
    return { n: criterion.n, command, code: command ? sh(command, project).code : 1 };
  });
  const red = results.filter((result) => result.code !== 0);
  return {
    ok: red.length === 0,
    results,
    reason: red.length
      ? `closing: ${red.map((r) => `criterion ${r.n} \`${r.command}\` exit ${r.code}`).join(', ')}`
      : null,
  };
}
