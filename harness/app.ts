// The app a qa or prototype unit looks at. The runner owns the server from start to stop; the agent only browses.
// The runner picks a free port, starts the project's `app.start` in its own process group,
// waits until the URL answers, and stops exactly that group after the unit — whatever the unit's outcome. A record
// per started app lets the next run stop a group whose runner died (only groups this harness started).

import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { AppConfig } from './config.ts';

export interface RunningApp {
  pid: number;
  port: number;
  url: string;
  /** `trace/unit-NNNN.app.json`: the pid, the port and the runner that owns it. */
  record: string;
  log: string;
}

export type AppStart = { ok: true; app: RunningApp } | { ok: false; reason: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The app's environment: the runner's, minus the variables that say "an AI agent runs here" and the agent session's
 * own keys. The app is a dev server for the reviewer, not an agent session — Next 16 writes `AGENTS.md` into the
 * project on start when it detects an agent, which the scope contract then counts as the unit's stray file.
 */
export function appEnv(env: NodeJS.ProcessEnv, port: number): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, PORT: String(port) };
  for (const key of Object.keys(out)) if (/^(CLAUDECODE|CLAUDE_CODE.*|AI_AGENT)$/.test(key)) delete out[key];
  return out;
}

/** A port nothing listens on right now (the OS picks it). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Whether anything accepts connections on the port. */
export function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(true));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(false)));
  });
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // already gone
  }
}

const lastLine = (file: string) =>
  existsSync(file) ? (readFileSync(file, 'utf8').trimEnd().split('\n').at(-1) ?? '').slice(0, 200) : '';

/**
 * Starts `app.start` with `{port}` filled in, in its own process group, and waits until `http://127.0.0.1:<port><ready>`
 * answers anything. Not ready in time, or exited first: the group is stopped and the reason returned.
 */
export async function startApp(
  app: AppConfig,
  cwd: string,
  files: { log: string; record: string },
  options: { graceMs?: number; pollMs?: number } = {},
): Promise<AppStart> {
  const port = await freePort();
  const command = app.start.replaceAll('{port}', String(port));
  const url = `http://${app.host}:${port}`;
  mkdirSync(dirname(files.log), { recursive: true });
  const out = openSync(files.log, 'a');
  let child: ChildProcess;
  try {
    child = spawn('sh', ['-c', command], {
      cwd,
      detached: true,
      stdio: ['ignore', out, out],
      env: appEnv(process.env, port),
    });
  } finally {
    closeSync(out);
  }
  const pid = child.pid;
  if (!pid) return { ok: false, reason: `could not start \`${command}\`` };
  let exited: number | null = null;
  child.on('exit', (code) => (exited = code ?? 1));
  child.unref();
  writeFileSync(files.record, `${JSON.stringify({ pid, port, runner: process.pid, command })}\n`);
  const running: RunningApp = { pid, port, url, record: files.record, log: files.log };

  const deadline = Date.now() + app.timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (exited !== null) {
      await stopApp(running, options.graceMs);
      return { ok: false, reason: `exited ${exited} before it was ready: ${lastLine(files.log) || '(no output)'}` };
    }
    try {
      await fetch(`${url}${app.ready}`, { signal: AbortSignal.timeout(1000), redirect: 'manual' });
      return { ok: true, app: running };
    } catch {
      await sleep(options.pollMs ?? 250);
    }
  }
  await stopApp(running, options.graceMs);
  return { ok: false, reason: `not ready after ${app.timeoutSeconds}s: ${lastLine(files.log) || '(no output)'}` };
}

/** SIGTERM to the group the runner started, SIGKILL after the grace period; then the record goes. */
export async function stopApp(app: Pick<RunningApp, 'pid' | 'record'>, graceMs = 5000): Promise<void> {
  signalGroup(app.pid, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (groupAlive(app.pid) && Date.now() < deadline) await sleep(50);
  if (groupAlive(app.pid)) {
    signalGroup(app.pid, 'SIGKILL');
    const hard = Date.now() + 2000;
    while (groupAlive(app.pid) && Date.now() < hard) await sleep(50);
  }
  rmSync(app.record, { force: true });
}

/**
 * Stops app groups whose runner is gone (a crash between start and stop). Only groups recorded in `trace/` — that is,
 * started by this harness — are touched. Returns one note per group stopped.
 */
export async function stopOrphanApps(traceDir: string): Promise<string[]> {
  if (!existsSync(traceDir)) return [];
  const notes: string[] = [];
  for (const name of readdirSync(traceDir).filter((file) => file.endsWith('.app.json'))) {
    const record = join(traceDir, name);
    let entry: { pid?: number; runner?: number };
    try {
      entry = JSON.parse(readFileSync(record, 'utf8')) as { pid?: number; runner?: number };
    } catch {
      rmSync(record, { force: true });
      continue;
    }
    if (entry.runner && entry.runner !== process.pid && runnerAlive(entry.runner)) continue;
    if (entry.pid && groupAlive(entry.pid)) {
      await stopApp({ pid: entry.pid, record });
      notes.push(`stopped an orphaned app (pid ${entry.pid}) left by ${name.replace('.app.json', '')}`);
    } else rmSync(record, { force: true });
  }
  return notes;
}

function runnerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
