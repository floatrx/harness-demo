import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { loadConfig } from './config.ts';
import { notify, readDotEnv, telegramKeys } from './notify.ts';
import { tracePaths } from './paths.ts';
import { runUnit } from './runner.ts';
import { supervise } from './supervise.ts';
import { type Sandbox, makeSandbox, seedTask } from './testkit/sandbox.ts';

/* Built at run time so that `pnpm provenance` (which fails on token shapes in the repository) stays green. */
const TOKEN = ['4242424242', 'AAF-notify-test-token-not-real_000000'].join(':');
const READY = { status: 'ready' as const, scope: ['src/**'], closes: ['test -f src/feature.txt'] };

interface Received {
  path: string;
  body: { chat_id: string; text: string; parse_mode: string };
}

let server: Server;
let received: Received[] = [];
let status = 200;
const saved = { api: process.env.HARNESS_TELEGRAM_API, home: process.env.HARNESS_HOME };
let home: string;

before(async () => {
  server = createServer((request, response) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => {
      received.push({ path: request.url ?? '', body: JSON.parse(data || '{}') as Received['body'] });
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(status === 200 ? '{"ok":true}' : '{"ok":false,"description":"Internal Server Error"}');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  process.env.HARNESS_TELEGRAM_API = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  home = mkdtempSync(join(tmpdir(), 'harness-notify-home-'));
  process.env.HARNESS_HOME = home;
});

after(() => {
  server.close();
  rmSync(home, { recursive: true, force: true });
  for (const [key, value] of [
    ['HARNESS_TELEGRAM_API', saved.api],
    ['HARNESS_HOME', saved.home],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** A sandbox whose project .env turns Telegram on, pointed at the local fake Bot API. */
function withKeys(config: Record<string, unknown> = {}): Sandbox {
  const sandbox = makeSandbox(config);
  writeFileSync(join(sandbox.project, '.env'), `TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_CHAT_ID="-100777"\n`);
  received = [];
  status = 200;
  // Each test starts with an empty dedupe ledger: the burst cap must not carry over from the test before.
  rmSync(join(home, 'notify-sent.json'), { force: true });
  return sandbox;
}

const texts = () => received.map((message) => message.body.text);

/** Every file the loop wrote under .harness/trace — the token must be in none of them. */
function traceText(sandbox: Sandbox): string {
  const dir = join(sandbox.project, '.harness', 'trace');
  return readdirSync(dir)
    .map((file) => {
      try {
        return readFileSync(join(dir, file), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

test('readDotEnv: comments, export, quotes and trailing comments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-dotenv-'));
  try {
    const file = join(dir, '.env');
    writeFileSync(file, '# a comment\nexport A=1\nB="two words"\nC=\'x#y\'\nD=plain # note\nE=\n');
    assert.deepEqual(readDotEnv(file), { A: '1', B: 'two words', C: 'x#y', D: 'plain', E: '' });
    assert.deepEqual(readDotEnv(join(dir, 'missing')), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keys: the first source that defines the token decides; an empty token switches Telegram off', () => {
  const sandbox = makeSandbox();
  try {
    writeFileSync(join(home, '.env'), `TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_CHAT_ID=1\n`);
    // The sandbox writes TELEGRAM_BOT_TOKEN= into the project .env: off, even though ~/.harness/.env has keys.
    assert.equal(telegramKeys(sandbox.project), null);
    writeFileSync(join(sandbox.project, '.env'), '# nothing about telegram here\n');
    assert.equal(telegramKeys(sandbox.project)?.source, join(home, '.env'));
    process.env.TELEGRAM_BOT_TOKEN = '';
    assert.equal(telegramKeys(sandbox.project), null);
  } finally {
    delete process.env.TELEGRAM_BOT_TOKEN;
    rmSync(join(home, '.env'), { force: true });
    sandbox.cleanup();
  }
});

test('a delivered task tells the human: done, the pull request, and how the run ended', async () => {
  const sandbox = withKeys({ autonomy: { mode: 'full' }, deliver: { pr: true } });
  try {
    seedTask(sandbox, READY);
    const result = await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
    assert.equal(result.exit, 0);
    const sent = texts();
    assert.equal(sent.length, 3, sent.join(' | '));
    assert.match(sent[0] ?? '', /^<b>project<\/b> · T-001 Add the feature file — done ✓ · pull request next$/);
    assert.match(sent[1] ?? '', /pull request opened\n<a href="https:\/\/github\.com\/example\/bookmarks\/pull\/1">/);
    assert.match(sent[2] ?? '', /supervisor stopped \(exit 0\): drained: nothing left to take/);
    assert.ok(received.every((message) => message.body.chat_id === '-100777' && message.body.parse_mode === 'HTML'));
    assert.ok(received.every((message) => message.path === `/bot${TOKEN}/sendMessage`));
    assert.ok(!traceText(sandbox).includes(TOKEN));
  } finally {
    sandbox.cleanup();
  }
});

test('a question for the human is announced with its count', async () => {
  const sandbox = withKeys();
  try {
    seedTask(sandbox, { status: 'spec' });
    sandbox.scenario({
      steps: {
        spec: [
          [
            { default: true },
            { question: 'Which list?', options: ['The main one — recommended: it exists', 'A new one'] },
          ],
        ],
      },
    });
    await runUnit(sandbox.project, sandbox.agent);
    assert.equal(sandbox.task('T-001').fields.status, 'needs-input');
    assert.deepEqual(texts(), ['<b>project</b> · T-001 Add the feature file — 1 question for you']);
  } finally {
    sandbox.cleanup();
  }
});

test('Telegram down: the unit stays green, one log line, no token in it', async () => {
  const sandbox = withKeys();
  try {
    seedTask(sandbox, { status: 'spec' });
    sandbox.scenario({ steps: { spec: [[{ default: true }, { question: 'Which list?', options: ['Main', 'New'] }]] } });
    status = 500;
    const result = await runUnit(sandbox.project, sandbox.agent);
    assert.equal(result.exit, 0);
    assert.equal(sandbox.task('T-001').fields.status, 'needs-input');
    const progress = readFileSync(join(sandbox.project, '.harness/trace/progress.log'), 'utf8');
    assert.match(progress, /notify · needs-input not sent: HTTP 500/);
    assert.ok(!progress.includes(TOKEN));
  } finally {
    sandbox.cleanup();
  }
});

test('notify.events narrows what is sent', async () => {
  const sandbox = withKeys({ autonomy: { mode: 'full' }, deliver: { pr: true }, notify: { events: ['delivered'] } });
  try {
    seedTask(sandbox, READY);
    await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
    assert.equal(texts().length, 1);
    assert.match(texts()[0] ?? '', /pull request opened/);
  } finally {
    sandbox.cleanup();
  }
});

test('only unique messages: a repeat is held back, a burst is capped, a deleted project sends nothing', async () => {
  const sandbox = withKeys();
  const config = loadConfig(sandbox.project);
  const paths = tracePaths(sandbox.project);
  try {
    const down = { event: 'supervisor' as const, text: 'the agent could not run (limit) — waiting, then retrying' };
    for (let i = 0; i < 5; i++) await notify(sandbox.project, config, paths, down);
    assert.equal(texts().length, 1);
    // An id or a timestamp alone does not make a message new.
    await notify(sandbox.project, config, paths, {
      ...down,
      text: `${down.text} 376a3317-dc91-4923-bad7-327d60220248`,
    });
    await notify(sandbox.project, config, paths, {
      ...down,
      text: `${down.text} 9f1e2d3c-0000-4923-bad7-327d60220248`,
    });
    assert.equal(texts().length, 2);
    for (let i = 0; i < 10; i++)
      await notify(sandbox.project, config, paths, { event: 'supervisor', text: `distinct ${i}` });
    assert.equal(texts().length, 6, 'the burst cap holds the chat at 6 a minute');
    assert.match(readFileSync(paths.progress, 'utf8'), /notify · supervisor held back: same message sent 0 min ago/);
    assert.match(readFileSync(paths.progress, 'utf8'), /held back: burst cap/);
  } finally {
    sandbox.cleanup();
  }
  received = [];
  rmSync(join(home, 'notify-sent.json'), { force: true });
  await notify(sandbox.project, config, paths, {
    event: 'supervisor',
    text: 'after cleanup',
  });
  assert.equal(texts().length, 0, 'a project folder that is gone never notifies');
});
