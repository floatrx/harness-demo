#!/usr/bin/env node
// The dashboard walkthrough (plan criterion 5), end to end, zero tokens: a fresh copy of the example project, the
// built dashboard on a free port with its own registry, the fake agent, and Chrome. Every step leaves a screenshot.
//
//   pnpm -C dashboard build                       (once — it drives the production build)
//   pnpm dashboard:e2e [--out <dir>] [--docs] [--keep] [--headed]
//
//   --out      where the step screenshots go (default dashboard/e2e/shots/)
//   --docs     also write the named set for the docs site to docs/screenshots/, at device scale 2
//   --keep     keep the temporary project, registry and server log (printed at the end)
//   --headed   show the browser
//
// Chrome comes from the system (`channel: 'chrome'`). Set HARNESS_E2E_CHROMIUM=1 to use Playwright's own Chromium
// instead (`pnpm -C dashboard exec playwright-core install chromium` first).
//
// The script stops only what it started: the dashboard by its child PID, the supervisor through its STOP file.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Page, chromium } from 'playwright-core';
import { REPO_ROOT, createExample } from '@harness/core/example';
import { readRunning, tracePaths } from '@harness/core/paths';
import { lockHolder, requestStop } from '@harness/core/supervise';
import { loadTask } from '@harness/core/task/task';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    docs: { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
  },
});

const DASHBOARD = join(REPO_ROOT, 'dashboard');
const FAKE = join(REPO_ROOT, 'harness', 'testkit', 'fake-agent.ts');
const OUT = resolve(args.out ?? join(DASHBOARD, 'e2e', 'shots'));
const DOCS = join(REPO_ROOT, 'docs', 'screenshots');
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 950, height: 800 };

if (!existsSync(join(DASHBOARD, '.next', 'BUILD_ID'))) {
  console.error('no production build — run `pnpm -C dashboard build` first');
  process.exit(2);
}

// ---- the project ------------------------------------------------------------

/* A short path reads better in the screenshots than macOS's /var/folders/…; mkdtemp keeps it unique. */
const root = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'harness-e2e-'));
const dest = join(root, 'bookmarks');
const home = join(root, 'home');
const scenario = join(root, 'scenario.json');
const serverLog = join(root, 'dashboard.log');

const say = (line: string) => console.log(`· ${line}`);

say(`example copy in ${dest}`);
process.env.HARNESS_HOME = join(root, 'setup-home'); // createExample registers the copy; the dashboard must not see it
createExample(dest, { name: 'bookmarks' });
delete process.env.HARNESS_HOME;

/* The loop picks up a human action within a second instead of the default 30 s idle poll. */
const configPath = join(dest, '.harness', 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
writeFileSync(
  configPath,
  `${JSON.stringify({ ...config, supervisor: { idlePollSeconds: 1, pausePollSeconds: 0.5 } }, null, 2)}\n`,
);
execFileSync('git', ['commit', '--quiet', '-am', 'e2e: poll the queue every second'], { cwd: dest });

type Call = { tool: string; file?: string };
const crew = (role: string, calls: Call[], stepMs = 150) => ({ dispatch: { role, calls, stepMs } });
const result = (text: string, tokens: number, costUsd: number, denials?: { tool: string; command?: string }[]) => ({
  stream: { result: text, tokens, costUsd, ...(denials ? { denials } : {}) },
});
const read = (file: string): Call => ({ tool: 'Read', file });
const edit = (file: string): Call => ({ tool: 'Edit', file });
const LIB = 'src/lib/bookmarks.ts';
const TEST = 'src/lib/bookmarks.test.ts';
const PAGE = 'src/app/page.tsx';
const LIST = 'src/components/bookmark-list.tsx';

/* Like the demo seed: each first unit of a stage dispatches the specialists that stage offers. Tokens and costs are
   SYNTHETIC — the fake agent spends nothing. The qa unit of T-001 is slow on purpose: the screenshots of a working
   card, the live trace and the pause land inside it. */
writeFileSync(
  scenario,
  JSON.stringify({
    defaults: { scope: ['src/**'], closes: 'test -f src/feature.txt' },
    steps: {
      spec: [
        [
          { default: true },
          crew('writer', [read(PAGE), { tool: 'Grep' }, read(LIB)]),
          result('Spec written.', 18_400, 0.19),
        ],
      ],
      plan: [
        [
          { default: true },
          crew('explorer', [read(LIB), read(TEST), { tool: 'Glob' }]),
          crew('planner', [read(LIB), read(PAGE)]),
          result('Plan written.', 26_100, 0.27),
        ],
      ],
      prototype: [
        [
          { default: true },
          crew('designer', [read(PAGE), read('src/app/globals.css'), { tool: 'Write', file: 'prototype.svg' }]),
          result('Round ready.', 34_800, 0.41),
        ],
      ],
      implement: [
        [
          { default: true },
          crew('tester', [read(TEST), edit(TEST), { tool: 'Bash' }]),
          crew('implementer', [read(LIB), edit(LIB), edit(LIST), { tool: 'Bash' }]),
          result('Implemented.', 61_200, 0.88),
        ],
      ],
      qa: [
        [
          { default: true },
          crew('qa', [{ tool: 'Bash' }, read(TEST), { tool: 'Bash' }]),
          result('qa: PASS', 22_300, 0.24),
        ],
      ],
      judge: [
        [{ default: true }, crew('judge', [{ tool: 'Bash' }, read(LIB)]), result('judge: CONFIRMED', 15_800, 0.31)],
      ],
      'T-001:qa': [
        [
          { default: true },
          crew(
            'qa',
            [
              { tool: 'Bash' },
              read(TEST),
              { tool: 'Bash' },
              read(LIB),
              { tool: 'Grep' },
              read(PAGE),
              { tool: 'Bash' },
              read(LIST),
              { tool: 'Bash' },
              { tool: 'Bash' },
            ],
            1300,
          ),
          result('qa: PASS', 29_700, 0.33),
        ],
      ],
      'T-003:spec': [
        [
          { default: true },
          {
            question: 'What should “better” mean first?',
            options: [
              'Faster to find a bookmark: search and tags — recommended: the list grows past one screen',
              'Nicer to look at: favicons and a denser layout',
              'Safer: export and import',
            ],
          },
          {
            question: 'Where should the bookmarks be stored?',
            options: [
              'Keep localStorage — recommended: no backend is in scope',
              'A JSON file written by a server action',
            ],
          },
          crew('writer', [read(PAGE), read(LIB)]),
          result('Two questions for the human.', 12_900, 0.14),
        ],
      ],
      'T-004:implement': [
        [
          { default: true },
          { append: 'README.md', content: '\nSorted by title.\n' },
          crew('implementer', [read(LIB), edit(LIB), { tool: 'Edit', file: 'README.md' }]),
          result('Implemented.', 47_500, 0.66, [
            { tool: 'Bash', command: 'curl -s https://registry.npmjs.org/sort-by' },
          ]),
        ],
      ],
    },
  }),
);

const paths = tracePaths(dest);
const statusOf = (id: string) => loadTask(join(paths.tasks, `${id}.md`)).fields;
const progress = () => (existsSync(paths.progress) ? readFileSync(paths.progress, 'utf8') : '');

async function until(what: string, check: () => boolean, ms = 120_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms / 1000} s waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

const statusIs = (id: string, status: string) => () => {
  try {
    return statusOf(id).status === status;
  } catch {
    return false;
  }
};

// ---- the dashboard ----------------------------------------------------------

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const nextBin = createRequire(join(DASHBOARD, 'package.json')).resolve('next/dist/bin/next');
const log = openSync(serverLog, 'a');
const server: ChildProcess = spawn(process.execPath, [nextBin, 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: DASHBOARD,
  stdio: ['ignore', log, log],
  /* The supervisor that Start spawns inherits these: it drives the fake agent, never `claude`. */
  env: {
    ...process.env,
    HARNESS_HOME: home,
    AGENT_CMD: `node ${JSON.stringify(FAKE)}`,
    HARNESS_FAKE_SCENARIO: scenario,
    TELEGRAM_BOT_TOKEN: '', // a walkthrough never pings the real chat
  },
});
say(`dashboard pid ${server.pid} on ${base} (log ${serverLog})`);

const shots: string[] = [];
const problems: string[] = [];
let step = 0;

async function shot(page: Page, name: string, docsName?: string): Promise<void> {
  await page.waitForTimeout(400); // let the SSE snapshot and the spinner settle
  const file = join(OUT, `${String(++step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  if (args.docs && docsName) {
    mkdirSync(DOCS, { recursive: true });
    copyFileSync(file, join(DOCS, `${docsName}.png`));
    shots.push(join(DOCS, `${docsName}.png`));
  }
  say(`shot ${file.slice(OUT.length + 1)}${docsName && args.docs ? ` → docs/screenshots/${docsName}.png` : ''}`);
}

/* dnd-kit starts a drag after 6 px; the empty rail widens once a drag starts, so the target is measured after that. */
async function drag(page: Page, id: string, target: string): Promise<void> {
  const card = await page.locator(`[data-task="${id}"]`).boundingBox();
  if (!card) throw new Error(`no card ${id}`);
  await page.mouse.move(card.x + card.width / 2, card.y + 20);
  await page.mouse.down();
  await page.mouse.move(card.x + card.width / 2 + 12, card.y + 30, { steps: 4 });
  const drop = await page
    .locator(`[data-testid="column-${target}"], [data-testid="empty-rail"][data-statuses~="${target}"]`)
    .first()
    .boundingBox();
  if (!drop) throw new Error(`no drop target for ${target}`);
  await page.mouse.move(drop.x + drop.width / 2, drop.y + 60, { steps: 16 });
  await page.mouse.up();
}

const board = (projectId: string, query = '') => `${base}/p/${projectId}${query}`;

const browser = await chromium.launch({
  headless: !args.headed,
  ...(process.env.HARNESS_E2E_CHROMIUM ? {} : { channel: 'chrome' }),
});

try {
  await until(
    'the dashboard to answer',
    () => existsSync(serverLog) && readFileSync(serverLog, 'utf8').includes('Ready'),
    30_000,
  );
  mkdirSync(OUT, { recursive: true });
  /* Reduced motion freezes the spinner on ✻ (its reduced-motion frame): every run gives the same screenshots. */
  /* The docs site shows the named set on retina screens: --docs renders at device scale 2 (2880 × 1800). */
  const page = await browser.newPage({ viewport: WIDE, reducedMotion: 'reduce', deviceScaleFactor: args.docs ? 2 : 1 });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

  // 1. Add a project.
  await page.goto(`${base}/projects`);
  await page.getByTestId('projects-empty').waitFor();
  await shot(page, 'projects-empty');
  await page.getByTestId('project-path').fill(dest);
  await page.getByTestId('add-project').click();
  await page.getByTestId('project-row').waitFor();
  await shot(page, 'project-added');
  await page.getByTestId('open-board').click();
  await page.getByTestId('board').waitFor();
  const projectId = new URL(page.url()).pathname.split('/')[2] ?? '';

  // 2. Create a task.
  await page.getByTestId('create-task').click();
  const form = page.getByTestId('create-task-form');
  await form.locator('input[name="title"]').fill('Sort bookmarks by title');
  await form.locator('textarea[name="draft"]').fill('A toggle sorts the list by title instead of by date.');
  await form.locator('select[name="kind"]').selectOption('logic');
  await form.getByRole('button', { name: 'Create draft' }).click();
  await page.waitForURL(/\?t=T-004/);
  await page.getByTestId('task-drawer').waitFor();
  await shot(page, 'task-created');

  // 3. Submit the drafts.
  await page.goto(board(projectId));
  for (const id of ['T-001', 'T-002', 'T-003', 'T-004']) {
    await page.locator(`[data-task="${id}"] [data-testid="card-action"]`).click();
    await until(`${id} to leave draft`, statusIs(id, 'spec'), 10_000);
  }
  await page.waitForTimeout(600);
  await shot(page, 'submitted');

  // 4. Start the loop: specs, plans, two questions.
  await page.getByTestId('supervisor-start').click();
  await until('T-003 to ask its questions', statusIs('T-003', 'needs-input'));
  for (const id of ['T-001', 'T-002', 'T-004']) await until(`${id} to be planned`, statusIs(id, 'planned'));
  await page.goto(board(projectId));
  await shot(page, 'planned-and-questions');
  await page.goto(board(projectId, '?t=T-003'));
  await page.getByTestId('interview').waitFor();
  await shot(page, 'interview', 'task-questions');

  // 5. Drag planned → ready; the implementer edits a file outside the scope, the contracts park the task.
  await page.goto(board(projectId));
  await drag(page, 'T-004', 'ready');
  await until('T-004 to be approved by the drop', () => statusOf('T-004').status !== 'planned', 10_000);
  await until('T-004 to be parked by the scope contract', statusIs('T-004', 'parked'));
  await page.goto(board(projectId));
  await shot(page, 'dragged-then-parked');

  // 6. A UI task: approve the plan, review the prototype, comment, accept.
  await page.locator('[data-task="T-001"] [data-testid="card-action"]').click();
  await until('the first prototype round', () => statusOf('T-001').prototype === 'review');
  await page.goto(board(projectId, '?t=T-001'));
  await page.getByTestId('prototype-review').waitFor();
  await shot(page, 'prototype-round-1', 'prototype-review');
  await page.getByLabel('Comment for the designer').fill('Make the search field wider and keep it above the list.');
  await page.getByRole('button', { name: 'Send comment' }).click();
  await until(
    'the second prototype round',
    () =>
      /Round 2/.test(readFileSync(join(paths.tasks, 'T-001.md'), 'utf8')) && statusOf('T-001').prototype === 'review',
  );
  await page.goto(board(projectId, '?t=T-001'));
  await page.getByTestId('prototype-review').waitFor();
  await shot(page, 'prototype-round-2');
  await page.getByRole('button', { name: 'Accept' }).click();

  // 7. Watch it through QA: the board, the live trace and the project list while the qa unit runs; then pause.
  await until(
    'the qa unit of T-001',
    () => readRunning(paths)?.task === 'T-001' && readRunning(paths)?.stage === 'qa',
    180_000,
  );
  await page.goto(board(projectId));
  /* The dock shows the qa specialist with the tool in its hand, a few seconds into the unit. */
  await page.waitForFunction(
    () => /Bash|Read|Grep/.test(document.querySelector('[data-testid="agent-row"]')?.textContent ?? ''),
    null,
    { timeout: 15_000 },
  );
  await shot(page, 'working-in-qa', 'board');
  await page.goto(`${base}/p/${projectId}/live`);
  await page.getByText('qa working').waitFor();
  /* The page re-renders every 2 s while the unit runs: wait for a few tool calls in the lane. */
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="agent-lane"] li').length >= 5, null, {
    timeout: 15_000,
  });
  await shot(page, 'live-trace', 'live');
  await page.goto(`${base}/projects`);
  await shot(page, 'projects-running', 'projects');
  await page.goto(board(projectId));
  await page.getByTestId('supervisor-pause').click();
  await until('the pause at the unit boundary', () => progress().includes('paused at the unit boundary'), 60_000);
  await page.goto(board(projectId));
  await shot(page, 'paused');
  if (statusOf('T-001').status !== 'judge')
    problems.push(`after the pause T-001 is ${statusOf('T-001').status}, not judge`);
  await page.getByTestId('supervisor-resume').click();
  await until('T-001 to be done', statusIs('T-001', 'done'));
  await page.goto(board(projectId));
  await shot(page, 'judged-done');

  // 8. Answer the interview; the writer finishes the spec.
  await page.goto(board(projectId, '?t=T-003'));
  await page.getByTestId('send-answers').click();
  await until('T-003 to be planned after the answers', statusIs('T-003', 'planned'));
  await page.goto(board(projectId));
  await shot(page, 'answered-planned');

  // 9. Stats, agents.
  await page.goto(`${base}/p/${projectId}/stats`);
  await page.getByTestId('stats-by-stage').waitFor();
  await shot(page, 'stats', 'stats');
  await page.goto(`${base}/p/${projectId}/agents`);
  const status = await page.getByTestId('agents-status').innerText();
  if (status !== 'All checks pass') problems.push(`agents: ${status}`);
  await shot(page, 'agents', 'agents');

  // 10. Stop the loop.
  await page.goto(board(projectId));
  await page.getByTestId('supervisor-stop').click();
  await until('the supervisor to stop', () => lockHolder(dest) === null, 60_000);
  await page.goto(board(projectId));
  await shot(page, 'stopped');

  // 11. The 950 px check: nothing scrolls sideways at the page level (the board scrolls inside its own lane).
  await page.setViewportSize(NARROW);
  for (const [name, url] of [
    ['projects', `${base}/projects`],
    ['board', board(projectId)],
    ['live', `${base}/p/${projectId}/live`],
    ['stats', `${base}/p/${projectId}/stats`],
    ['agents', `${base}/p/${projectId}/agents`],
  ] as const) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) problems.push(`${name} at 950 px scrolls sideways by ${overflow} px`);
    await shot(page, `w950-${name}`);
  }
} catch (error) {
  problems.push((error as Error).message);
} finally {
  await browser.close();
  if (lockHolder(dest)) {
    requestStop(dest);
    await until('the supervisor to stop', () => lockHolder(dest) === null, 60_000).catch((error: Error) =>
      problems.push(error.message),
    );
  }
  server.kill('SIGTERM');
  if (!args.keep && !problems.length) rmSync(root, { recursive: true, force: true });
}

console.log(`\n${shots.length} screenshots in ${OUT}${args.docs ? ` and ${DOCS}` : ''}`);
if (problems.length) {
  console.error(
    `\n✕ ${problems.length} problem(s) — kept ${root} for a look:\n${problems.map((line) => `  - ${line}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(args.keep ? `✓ walkthrough passed — kept ${root}` : '✓ walkthrough passed');
