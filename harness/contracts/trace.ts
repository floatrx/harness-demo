// Trace contract: a stage that needs a verdict must leave the token in its output (`qa: PASS`).
//
// The search is unanchored on purpose: in a `claude -p --output-format stream-json` trace the text lives
// inside JSON strings, where a line break is the two characters `\n`, so `^…$` would never match.

import type { VerdictRule } from '../config.ts';

export interface TraceVerdict {
  ok: boolean;
  /** The last verdict the unit printed; a later one overrides an earlier one. */
  verdict: string | null;
  reason: string | null;
}

export function readVerdict(output: string, rule: VerdictRule | undefined): TraceVerdict {
  if (!rule) return { ok: true, verdict: null, reason: null };
  const values = rule.values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`\\b${rule.token}\\s*:\\s*(${values})\\b`, 'g');
  // Undo JSON escaping first: `…checked\\njudge: OK` must read as two lines, not as the word `njudge`.
  const text = output.replaceAll('\\n', '\n');
  const found = [...text.matchAll(pattern)].map((match) => match[1] as string);
  const verdict = found.at(-1) ?? null;
  return verdict
    ? { ok: true, verdict, reason: null }
    : { ok: false, verdict: null, reason: `missing verdict: expected \`${rule.token}: ${rule.values.join('|')}\`` };
}
