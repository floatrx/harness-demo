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
