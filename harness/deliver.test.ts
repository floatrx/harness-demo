import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from './config.ts';
import { deliveryPreflight } from './deliver.ts';
import { runUnit } from './runner.ts';
import { scrubSecrets } from './secrets.ts';
import { supervise } from './supervise.ts';
import { normalizeBody, putSection, setField } from './task/parse.ts';
import { loadTask, saveTask } from './task/task.ts';
import { reopen } from './task/write.ts';
import { type Sandbox, makeSandbox, seedTask } from './testkit/sandbox.ts';

const READY = { status: 'ready' as const, scope: ['src/**'], closes: ['test -f src/feature.txt'] };
/* Built at run time so that `pnpm provenance` (which fails on token shapes in the repository) stays green. */
const TOKEN = ['1234567890', 'AAH-fake-token-for-tests-only_0123456'].join(':');

/** A sandbox whose seed task went implement → qa → judge and now rests in `done`, delivery on. */
async function doneTask(config: Record<string, unknown> = {}): Promise<{ sandbox: Sandbox; id: string }> {
  const sandbox = makeSandbox({ autonomy: { mode: 'full' }, deliver: { pr: true }, ...config });
  const id = seedTask(sandbox, READY);
  await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true, maxUnits: 3 });
  assert.equal(sandbox.task(id).fields.status, 'done');
  return { sandbox, id };
}

test('a crash after the pull request was opened does not open a second one', async () => {
  const { sandbox, id } = await doneTask();
  try {
    await runUnit(sandbox.project, sandbox.agent);
    const first = sandbox.task(id).fields.pr;
    // As if the runner died after `gh pr create` and before it saved the task.
    const path = sandbox.taskPath(id);
    const { doc } = loadTask(path);
    setField(doc, 'status', 'done');
    setField(doc, 'pr', null);
    saveTask(path, doc);
    await runUnit(sandbox.project, sandbox.agent);
    assert.equal(sandbox.task(id).fields.status, 'delivered');
    assert.equal(sandbox.task(id).fields.pr, first);
    const creates = sandbox.ghCalls().filter((call) => call[0] === 'pr' && call[1] === 'create');
    assert.equal(creates.length, 1);
  } finally {
    sandbox.cleanup();
  }
});

test('a failed `gh pr create` parks the task from done; Reopen retries and delivers', async () => {
  const { sandbox, id } = await doneTask();
  try {
    process.env.HARNESS_FAKE_GH_FAIL = 'create';
    const failed = await runUnit(sandbox.project, sandbox.agent);
    delete process.env.HARNESS_FAKE_GH_FAIL;
    const parked = sandbox.task(id).fields;
    assert.equal(failed.exit, 1);
    assert.equal(parked.status, 'parked');
    assert.equal(parked.parkedFrom, 'done');
    assert.match(parked.parked ?? '', /^deliver: gh pr create failed/);
    const path = sandbox.taskPath(id);
    saveTask(path, reopen(loadTask(path).doc));
    assert.equal(sandbox.task(id).fields.status, 'done');
    await runUnit(sandbox.project, sandbox.agent);
    assert.equal(sandbox.task(id).fields.status, 'delivered');
  } finally {
    delete process.env.HARNESS_FAKE_GH_FAIL;
    sandbox.cleanup();
  }
});

test('a push that fails parks the task with the reason', async () => {
  const { sandbox, id } = await doneTask();
  try {
    sandbox.git(['remote', 'set-url', 'origin', join(sandbox.root, 'no-such-origin.git')]);
    const result = await runUnit(sandbox.project, sandbox.agent);
    assert.equal(result.exit, 1);
    assert.match(sandbox.task(id).fields.parked ?? '', /^deliver: push failed/);
    assert.equal(sandbox.ghCalls().filter((call) => call[1] === 'create').length, 0);
  } finally {
    sandbox.cleanup();
  }
});

test('preflight: no remote, a logged-out gh, or a base branch missing on the remote stop the supervisor (exit 2)', () => {
  const sandbox = makeSandbox({ deliver: { pr: true } });
  try {
    const config = loadConfig(sandbox.project);
    assert.equal(deliveryPreflight(sandbox.project, config, sandbox.agent.gh), null);
    process.env.HARNESS_FAKE_GH_FAIL = 'auth';
    assert.match(deliveryPreflight(sandbox.project, config, sandbox.agent.gh) ?? '', /gh auth login/);
    delete process.env.HARNESS_FAKE_GH_FAIL;
    assert.match(
      deliveryPreflight(sandbox.project, { ...config, baseBranch: 'trunk' }, sandbox.agent.gh) ?? '',
      /origin has no trunk branch/,
    );
    sandbox.git(['remote', 'remove', 'origin']);
    assert.match(deliveryPreflight(sandbox.project, config, sandbox.agent.gh) ?? '', /no remote "origin"/);
  } finally {
    delete process.env.HARNESS_FAKE_GH_FAIL;
    sandbox.cleanup();
  }
});

test('the supervisor refuses to start when delivery is on and the preflight fails', async () => {
  const sandbox = makeSandbox({ deliver: { pr: true } });
  try {
    sandbox.git(['remote', 'remove', 'origin']);
    const result = await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
    assert.equal(result.exit, 2);
    assert.match(result.reason, /no remote "origin"/);
  } finally {
    sandbox.cleanup();
  }
});

test('with deliver.pr off, done is the end: nothing is pushed, gh is never called', async () => {
  const sandbox = makeSandbox({ autonomy: { mode: 'full' } });
  try {
    const id = seedTask(sandbox, READY);
    const result = await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true });
    assert.equal(result.exit, 0);
    assert.equal(sandbox.task(id).fields.status, 'done');
    assert.deepEqual(sandbox.ghCalls(), []);
  } finally {
    sandbox.cleanup();
  }
});

test('the pull-request body carries no secret, even one an agent wrote into the spec', async () => {
  const { sandbox, id } = await doneTask();
  try {
    const path = sandbox.taskPath(id);
    const { doc } = loadTask(path);
    putSection(doc, 'Spec', normalizeBody(`Goal. Use the bot ${TOKEN} and ghp_${'a'.repeat(36)} to test.`));
    saveTask(path, doc);
    await runUnit(sandbox.project, sandbox.agent);
    const body = readFileSync(join(sandbox.project, '.harness/artifacts', id, 'pr-body.md'), 'utf8');
    assert.ok(!body.includes(TOKEN));
    assert.ok(!body.includes('ghp_aaaa'));
    assert.match(body, /\[secret\]/);
  } finally {
    sandbox.cleanup();
  }
});

test('scrubSecrets removes token shapes and known live values', () => {
  assert.equal(scrubSecrets(`a ${TOKEN} b`), 'a [secret] b');
  assert.equal(scrubSecrets('chat 12345678 key hunter2-long', ['hunter2-long']), 'chat 12345678 key [secret]');
  assert.equal(scrubSecrets('plain text'), 'plain text');
});
