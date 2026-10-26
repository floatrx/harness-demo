// Telegram notifications: one-way, optional, never in the way. The loop tells the human what needs them (a question, a
// plan to approve, a prototype to review, a parked task) and what ended (done, a pull request, the supervisor). It
// only calls `sendMessage`: no updates are read, so a bot that does other work keeps working.
//
// Keys: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. The first source that DEFINES the token decides, in this order:
// the process environment, `<project>/.env`, `$HARNESS_HOME/.env` (default ~/.harness/.env). An empty token in an
// earlier source switches notifications off (the test sandbox and the e2e walkthrough do that).
//
// A failure never fails a unit: one line in progress.log, with every secret scrubbed out.
//
// Only unique messages (user, 2026-10-26, after a test loop sent the same line dozens of times): the same text for the
// same project is sent once per DEDUPE_MS, and the whole chat gets at most BURST_MAX messages per BURST_MS. A project
// whose folder no longer exists sends nothing — that is how a deleted test sandbox reached the real chat.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { HarnessConfig, NotifyEvent } from './config.ts';
import { type TracePaths, appendProgress } from './paths.ts';
import { harnessHome, listProjects } from './projects.ts';
import { scrubSecrets } from './secrets.ts';
import { type TaskFields, atomicWrite } from './task/task.ts';

const TIMEOUT_MS = 5000;
const DEDUPE_MS = 6 * 3_600_000;
const BURST_MS = 60_000;
const BURST_MAX = 6;

export interface TelegramKeys {
  token: string;
  chatId: string;
  /** Where the keys came from — printed by `harness notify --test`; the token never is. */
  source: string;
}

/** KEY=VALUE lines; `#` comments, optional `export`, single or double quotes. No expansion, no `source`. */
export function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!match || raw.trimStart().startsWith('#')) continue;
    const value = match[2] ?? '';
    out[match[1] as string] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value.replace(/\s+#.*$/, '');
  }
  return out;
}

export function telegramKeys(project: string | null): TelegramKeys | null {
  const sources: [string, Record<string, string | undefined>][] = [
    ['the environment', process.env],
    ...(project
      ? [[join(project, '.env'), readDotEnv(join(project, '.env'))] as [string, Record<string, string>]]
      : []),
    [join(harnessHome(), '.env'), readDotEnv(join(harnessHome(), '.env'))],
  ];
  for (const [source, values] of sources) {
    if (!('TELEGRAM_BOT_TOKEN' in values) || values.TELEGRAM_BOT_TOKEN === undefined) continue;
    const token = values.TELEGRAM_BOT_TOKEN.trim();
    const chatId = (values.TELEGRAM_CHAT_ID ?? '').trim();
    return token && chatId ? { token, chatId, source } : null;
  }
  return null;
}

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function projectName(project: string): string {
  return listProjects().find((item) => item.path === project)?.name ?? basename(project);
}

export interface Notice {
  event: NotifyEvent;
  /** Plain text after the project name; escaped here. */
  text: string;
  /** A link that works on a phone (a pull request). Never the local dashboard. */
  url?: string;
}

/** Sends one message. Resolves to what happened; never throws. */
export async function sendTelegram(keys: TelegramKeys, html: string): Promise<{ ok: boolean; detail: string }> {
  const api = process.env.HARNESS_TELEGRAM_API ?? 'https://api.telegram.org';
  try {
    const response = await fetch(`${api}/bot${keys.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: keys.chatId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { ok: true, detail: 'sent' };
    const body = (await response.text().catch(() => '')).slice(0, 200);
    return { ok: false, detail: scrubSecrets(`HTTP ${response.status} ${body}`, [keys.token]) };
  } catch (error) {
    return { ok: false, detail: scrubSecrets((error as Error).message, [keys.token]) };
  }
}

/** Ids and clock times that make two copies of one message look different. */
export function messageKey(project: string, text: string): string {
  const normal = text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?/g, '<time>');
  return createHash('sha256').update(`${project}\n${normal}`).digest('hex').slice(0, 32);
}

type SentLedger = { sent: Record<string, number>; burst: number[] };

/** Whether this message may go now; records it when it may. The ledger is `$HARNESS_HOME/notify-sent.json`. */
export function admitMessage(key: string, now = Date.now()): { ok: true } | { ok: false; why: string } {
  const file = join(harnessHome(), 'notify-sent.json');
  let ledger: SentLedger = { sent: {}, burst: [] };
  try {
    if (existsSync(file)) {
      const read = JSON.parse(readFileSync(file, 'utf8')) as Partial<SentLedger>;
      ledger = { sent: read.sent ?? {}, burst: read.burst ?? [] };
    }
  } catch {
    // a broken ledger starts over: worst case, one repeat
  }
  const sent = Object.fromEntries(Object.entries(ledger.sent).filter(([, at]) => now - at < DEDUPE_MS));
  const burst = ledger.burst.filter((at) => now - at < BURST_MS);
  const last = sent[key];
  const verdict =
    last !== undefined
      ? ({ ok: false, why: `same message sent ${Math.round((now - last) / 60_000)} min ago` } as const)
      : burst.length >= BURST_MAX
        ? ({ ok: false, why: `burst cap: ${BURST_MAX} messages in the last minute` } as const)
        : ({ ok: true } as const);
  if (verdict.ok) {
    sent[key] = now;
    burst.push(now);
  }
  mkdirSync(harnessHome(), { recursive: true });
  atomicWrite(file, `${JSON.stringify({ sent, burst })}\n`);
  return verdict;
}

/** The one entry point the loop uses. Off (no keys, or the event is not in `notify.events`) → nothing happens. */
export async function notify(project: string, config: HarnessConfig, paths: TracePaths, notice: Notice): Promise<void> {
  if (!config.notify.events.includes(notice.event)) return;
  if (!existsSync(project)) return;
  const keys = telegramKeys(project);
  if (!keys) return;
  const link = notice.url ? `\n<a href="${escape(notice.url)}">${escape(notice.url)}</a>` : '';
  const html = scrubSecrets(`<b>${escape(projectName(project))}</b> · ${escape(notice.text)}${link}`, [keys.token]);
  const admitted = admitMessage(messageKey(project, html));
  if (!admitted.ok) {
    appendProgress(paths, `notify · ${notice.event} held back: ${admitted.why}`);
    return;
  }
  const sent = await sendTelegram(keys, html);
  if (!sent.ok) appendProgress(paths, `notify · ${notice.event} not sent: ${sent.detail}`);
}

/** What a task's new state means to the human, if anything. `null` → no message. */
export function noticeFor(task: TaskFields, from: string | undefined, config: HarnessConfig): Notice | null {
  if (from === task.status && !(task.status === 'prototype' && task.prototype === 'review')) return null;
  const head = `${task.id} ${task.title}`;
  switch (task.status) {
    case 'needs-input':
      return {
        event: 'needs-input',
        text: `${head} — ${task.openQuestions} question${task.openQuestions === 1 ? '' : 's'} for you`,
      };
    case 'planned':
      return config.autonomy.mode === 'gated'
        ? { event: 'planned', text: `${head} — the plan waits for your approval` }
        : null;
    case 'prototype':
      return task.prototype === 'review' && config.autonomy.mode === 'gated'
        ? { event: 'prototype', text: `${head} — a prototype round is ready to review` }
        : null;
    case 'parked':
      return { event: 'parked', text: `${head} — parked: ${task.parked ?? 'no reason recorded'}` };
    case 'done':
      return { event: 'done', text: `${head} — done ✓${config.deliver.pr ? ' · pull request next' : ''}` };
    case 'delivered':
      return { event: 'delivered', text: `${head} — pull request opened`, ...(task.pr ? { url: task.pr } : {}) };
    default:
      return null;
  }
}
