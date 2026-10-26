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

/**
 * Plan-time check: each `[closes]` command must start with something the shell can call. A criterion whose command
 * span is a name (`formatRelativeTime`) or a path fails here, at the plan, instead of after implement, qa and judge
 * (pilot lesson 4). Narrow: a first word that is not a plain word (a subshell, a quote) is not judged.
 */
export function uncallableCommands(project: string, criteria: readonly Criterion[]): string[] {
  return criteria.flatMap((criterion) => {
    if (criterion.tag !== 'closes' || !criterion.command) return [];
    const word = criterion.command
      .replace(/^\s*!\s*/, '')
      .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '')
      .split(/\s+/)[0];
    if (!word || !/^[\w./@+-]+$/.test(word)) return [];
    return sh(`command -v ${word}`, project).code === 0
      ? []
      : [`criterion ${criterion.n}: \`${word}\` is not a command here — end the criterion with ": \`<command>\`"`];
  });
}
