// Trace contract: a stage that needs a verdict must leave the token in its output (`qa: PASS`).
//
// With `claude -p --output-format stream-json` the verdict is read from the final `result` event only — a
// specialist quoting `qa: PASS` inside a tool result must not count as the coordinator's verdict. Plain-text
// output (the fake agent, a wrapper) is read whole. The search is unanchored and runs after JSON escapes are
// undone: inside a JSON string a line break is the two characters `\n`, so `^…$` would never match.

import type { VerdictRule } from '../config.ts';

export interface TraceVerdict {
  ok: boolean;
  /** The last verdict the unit printed; a later one overrides an earlier one. */
  verdict: string | null;
  reason: string | null;
}

export interface UnitUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  durationMs: number | null;
  turns: number | null;
  /** Tool calls the permission mode refused — a hint for tuning `agent.allowedTools`. */
  permissionDenials: string[];
}

interface ResultEvent {
  type: 'result';
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  permission_denials?: { tool_name?: string; tool_input?: { command?: string } }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** The last `{"type":"result"}` event of a stream-json trace, or null for plain output. */
export function resultEvent(output: string): ResultEvent | null {
  let found: ResultEvent | null = null;
  for (const line of output.split('\n')) {
    if (!line.startsWith('{') || !line.includes('"result"')) continue;
    try {
      const event = JSON.parse(line) as { type?: string };
      if (event.type === 'result') found = event as ResultEvent;
    } catch {
      // not JSON: plain text that happens to start with a brace
    }
  }
  return found;
}

/** What the coordinator said last: the final result text, or the whole output when there is none. */
export function finalText(output: string): string {
  return resultEvent(output)?.result ?? output.replaceAll('\\n', '\n');
}

export function readVerdict(output: string, rule: VerdictRule | undefined): TraceVerdict {
  if (!rule) return { ok: true, verdict: null, reason: null };
  const values = rule.values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`\\b${rule.token}\\s*:\\s*\\**(${values})\\b`, 'g');
  const found = [...finalText(output).matchAll(pattern)].map((match) => match[1] as string);
  const verdict = found.at(-1) ?? null;
  return verdict
    ? { ok: true, verdict, reason: null }
    : { ok: false, verdict: null, reason: `missing verdict: expected \`${rule.token}: ${rule.values.join('|')}\`` };
}

export function readUsage(output: string): UnitUsage | null {
  const event = resultEvent(output);
  if (!event) return null;
  return {
    inputTokens: event.usage?.input_tokens ?? 0,
    outputTokens: event.usage?.output_tokens ?? 0,
    cacheReadTokens: event.usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: event.usage?.cache_creation_input_tokens ?? 0,
    costUsd: event.total_cost_usd ?? null,
    durationMs: event.duration_ms ?? null,
    turns: event.num_turns ?? null,
    permissionDenials: (event.permission_denials ?? []).map(
      (denial) => `${denial.tool_name ?? '?'}${denial.tool_input?.command ? `(${denial.tool_input.command})` : ''}`,
    ),
  };
}

/** The wall clock of `at` in an IANA zone, as UTC milliseconds — so wall − at is the zone's offset then. */
function wallClock(at: Date, zone: string): { ms: number; year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const [year, month, day] = [get('year'), get('month'), get('day')];
  return { ms: Date.UTC(year, month - 1, day, get('hour'), get('minute'), get('second')), year, month, day };
}

/**
 * When a usage limit lifts, from Claude Code's message: "You've hit your session limit · resets 9:10pm
 * (Europe/Kiev)". Null when the text names no time of day or the zone is unknown — the supervisor then naps as
 * configured. Pilot lesson 9: it napped 30 min blind, twice, while the message said exactly when to come back.
 */
export function limitResetAt(text: string, now = new Date()): Date | null {
  const match = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i.exec(text);
  if (!match) return null;
  const clock = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (clock < 1 || clock > 12 || minute > 59) return null;
  const hour = (clock % 12) + ((match[3] as string).toLowerCase() === 'pm' ? 12 : 0);
  let wall: ReturnType<typeof wallClock>;
  try {
    wall = wallClock(now, (match[4] as string).trim());
  } catch {
    return null;
  }
  const offset = Math.round((wall.ms - now.getTime()) / 60_000) * 60_000;
  let at = Date.UTC(wall.year, wall.month - 1, wall.day, hour, minute) - offset;
  if (at <= now.getTime()) at += 86_400_000;
  return new Date(at);
}
