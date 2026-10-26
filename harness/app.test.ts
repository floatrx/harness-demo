import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { portBusy, startApp, stopApp, stopOrphanApps } from './app.ts';
import { APP_DEFAULTS, type AppConfig } from './config.ts';

const FAKE_APP = fileURLToPath(new URL('./testkit/fake-app.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'harness-app-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const app = (mode: string, extra: Partial<AppConfig> = {}): AppConfig => ({
  ...APP_DEFAULTS,
  start: `node ${JSON.stringify(FAKE_APP)} {port} ${mode}`,
  timeoutSeconds: 5,
  ...extra,
});
const files = (name: string) => ({ log: join(dir, `${name}.log`), record: join(dir, `${name}.app.json`) });

test('an app starts on a free port, answers, and is gone after stopApp', async () => {
  const started = await startApp(app('ok'), dir, files('ok'));
  assert.ok(started.ok, started.ok ? '' : started.reason);
  const response = await fetch(`${started.app.url}/`);
  assert.match(await response.text(), /^fake app · \//);
  assert.ok(existsSync(started.app.record), 'the record exists while it runs');
  await stopApp(started.app);
  assert.equal(await portBusy(started.app.port), false, 'the port is free again');
  assert.equal(existsSync(started.app.record), false, 'the record is removed');
});

test('a slow app is waited for; one that never answers is stopped with the reason', async () => {
  const slow = await startApp(app('slow:600'), dir, files('slow'));
  assert.ok(slow.ok);
  await stopApp(slow.app);
  const never = await startApp(app('slow:60000', { timeoutSeconds: 1 }), dir, files('never'));
  assert.equal(never.ok, false);
  assert.match(never.ok ? '' : never.reason, /^not ready after 1s/);
});

test('an app that exits first reports its last output line', async () => {
  const failed = await startApp(app('fail'), dir, files('fail'));
  assert.equal(failed.ok, false);
  assert.match(failed.ok ? '' : failed.reason, /exited 1 before it was ready: fake-app: failed to compile/);
});

test('an app that ignores SIGTERM is killed after the grace period', async () => {
  const stubborn = await startApp(app('stubborn'), dir, files('stubborn'));
  assert.ok(stubborn.ok);
  const at = Date.now();
  await stopApp(stubborn.app, 300);
  assert.ok(Date.now() - at >= 300, 'it waited the grace period first');
  assert.equal(await portBusy(stubborn.app.port), false);
});

test("an app whose runner died is stopped by the next run; a live runner's app is left alone", async () => {
  const orphan = await startApp(app('ok'), dir, files('orphan'));
  const owned = await startApp(app('ok'), dir, files('owned'));
  assert.ok(orphan.ok && owned.ok);
  // The orphan's runner: a process that has exited. The owned one's runner: a live process that is not this one.
  const dead = spawnSync('true').pid;
  const record = JSON.parse(readFileSync(orphan.app.record, 'utf8')) as Record<string, unknown>;
  writeFileSync(orphan.app.record, JSON.stringify({ ...record, runner: dead }));
  const ownedRecord = JSON.parse(readFileSync(owned.app.record, 'utf8')) as Record<string, unknown>;
  writeFileSync(owned.app.record, JSON.stringify({ ...ownedRecord, runner: process.ppid }));
  const notes = await stopOrphanApps(dir);
  assert.equal(notes.length, 1);
  assert.match(notes[0] ?? '', /stopped an orphaned app \(pid \d+\) left by orphan/);
  assert.equal(await portBusy(orphan.app.port), false);
  assert.equal(await portBusy(owned.app.port), true, 'an app with a live runner is not touched');
  await stopApp(owned.app);
});

test('the app starts without agent markers, so a dev server does not write agent files into the project', async () => {
  const saved = { code: process.env.CLAUDECODE, agent: process.env.AI_AGENT };
  process.env.CLAUDECODE = '1';
  process.env.AI_AGENT = 'claude';
  try {
    const started = await startApp(app('env'), dir, files('env'));
    assert.ok(started.ok);
    await stopApp(started.app);
    assert.match(readFileSync(started.app.log, 'utf8'), /fake-app: agent markers none/);
  } finally {
    for (const [key, value] of [
      ['CLAUDECODE', saved.code],
      ['AI_AGENT', saved.agent],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
