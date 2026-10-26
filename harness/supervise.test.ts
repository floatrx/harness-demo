// Pause, resume and stop through the real CLI: a supervisor in a child process, controlled by files.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tracePaths } from './paths.ts';
import { FAKE_AGENT, makeSandbox, seedTask } from './testkit/sandbox.ts';

const CLI = fileURLToPath(new URL('./bin/harness.ts', import.meta.url));

async function until(check: () => boolean, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('pause lands at the unit boundary, resume continues, stop ends the supervisor', async () => {
  const sandbox = makeSandbox();
  const paths = tracePaths(sandbox.project);
  const env = {
    ...process.env,
    AGENT_CMD: `node ${JSON.stringify(FAKE_AGENT)}`,
    HARNESS_FAKE_SCENARIO: sandbox.scenarioPath,
  };
  const cli = (...args: string[]) =>
    spawnSync('node', [CLI, ...args, '--project', sandbox.project], { env, encoding: 'utf8' });
  const progress = () => (existsSync(paths.progress) ? readFileSync(paths.progress, 'utf8') : '');
  seedTask(sandbox, { status: 'ready', scope: ['src/**'], closes: ['test -f src/feature.txt'] });
  // The implement unit takes long enough to pause it mid-flight.
  sandbox.scenario({ steps: { implement: [[{ default: true }, { sleep: 800 }]] } });

  const child = spawn('node', [CLI, 'run', '--project', sandbox.project], { env, stdio: 'ignore' });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  try {
    await until(() => existsSync(paths.running), 'the implement unit to start');
    assert.equal(cli('pause').status, 0);
    await until(() => progress().includes('paused at the unit boundary'), 'the pause');
    const log = progress();
    // The unit in flight finished first; nothing started after the pause.
    assert.ok(log.indexOf('implement · exit 0') < log.indexOf('paused at the unit boundary'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(sandbox.task('T-001').fields.status, 'qa');
    assert.equal(existsSync(paths.running), false);

    assert.equal(cli('resume').stdout.trim(), 'resumed');
    await until(() => sandbox.task('T-001').fields.status === 'done', 'the task to finish after resume');

    assert.equal(cli('stop').status, 0);
    assert.equal(await exited, 0);
    assert.match(progress(), /supervisor · exit 0 · stopped/);
    assert.equal(existsSync(paths.lock), false);
  } finally {
    if (child.exitCode === null && child.pid) process.kill(child.pid, 'SIGTERM');
    sandbox.cleanup();
  }
});

/** An in-process supervisor whose units are all "agent down"; always stopped before the sandbox goes away. */
async function downLoop(retryAt: number, ceilingSeconds: number, check: (log: string) => void): Promise<void> {
  const { supervise, requestStop } = await import('./supervise.ts');
  const { EXIT } = await import('./runner.ts');
  const { FAST_SUPERVISOR } = await import('./testkit/sandbox.ts');
  const sandbox = makeSandbox({ supervisor: { ...FAST_SUPERVISOR, usageCeilingSeconds: ceilingSeconds } });
  const paths = tracePaths(sandbox.project);
  const progress = () => (existsSync(paths.progress) ? readFileSync(paths.progress, 'utf8') : '');
  const running = supervise(sandbox.project, {
    onceThrough: true,
    unitRunner: async () => ({ exit: EXIT.agentDown, message: 'agent could not run: limit', moved: false, retryAt }),
  });
  try {
    await until(() => progress().includes('— waiting'), 'the wait line');
    check(progress());
  } finally {
    // Stop it before cleanup, pass or fail: a loop left running outlives its sandbox (2026-10-26).
    requestStop(sandbox.project);
    await running;
    sandbox.cleanup();
  }
}

test('a usage limit that names its reset: the supervisor naps until then plus a minute (pilot lesson 9)', async () => {
  const retryAt = Date.now() + 3_600_000;
  await downLoop(retryAt, 7200, (log) => {
    assert.ok(log.includes(`— waiting until ${new Date(retryAt + 60_000).toISOString()}`), log);
  });
});

test('a reset past the usage ceiling falls back to the configured nap', async () => {
  await downLoop(Date.now() + 7 * 24 * 3_600_000, 7200, (log) => {
    assert.ok(!log.includes('waiting until'), log);
  });
});

test('agent down with sub-second naps: the ceiling still ends the loop (exit 4)', async () => {
  const { supervise } = await import('./supervise.ts');
  const { EXIT } = await import('./runner.ts');
  const sandbox = makeSandbox();
  try {
    const result = await supervise(sandbox.project, {
      unitRunner: async () => ({ exit: EXIT.agentDown, message: 'agent could not run: limit', moved: false }),
    });
    assert.equal(result.exit, 4);
  } finally {
    sandbox.cleanup();
  }
});

test('a human action wakes an idle supervisor at once, not after the idle poll (quickstart review)', async () => {
  const { supervise, requestStop } = await import('./supervise.ts');
  const { FAST_SUPERVISOR } = await import('./testkit/sandbox.ts');
  const { submit } = await import('./task/write.ts');
  const { loadTask, saveHumanTask } = await import('./task/task.ts');
  // An idle poll of an hour: only the wake-up can start the spec unit inside this test.
  const sandbox = makeSandbox({ supervisor: { ...FAST_SUPERVISOR, idlePollSeconds: 3600, pausePollSeconds: 0.05 } });
  const paths = tracePaths(sandbox.project);
  const progress = () => (existsSync(paths.progress) ? readFileSync(paths.progress, 'utf8') : '');
  seedTask(sandbox, { id: 'T-001', status: 'draft' });
  const running = supervise(sandbox.project, { ...sandbox.agent });
  try {
    await until(() => progress().includes('supervisor · start'), 'the supervisor to start');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const path = sandbox.taskPath('T-001');
    saveHumanTask(path, submit(loadTask(path).doc));
    await until(() => progress().includes('unit 1 · T-001 · spec · exit 0'), 'the spec unit after Submit', 5_000);
  } finally {
    requestStop(sandbox.project);
    await running;
    sandbox.cleanup();
  }
});
