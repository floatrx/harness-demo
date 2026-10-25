import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { tracePaths } from '@harness/core/paths';
import { addProject } from '@harness/core/projects';
import { lockHolder } from '@harness/core/supervise';
import { FAKE_AGENT, makeSandbox, seedTask, type Sandbox } from '@harness/core/testkit/sandbox';
import { liveSnapshot } from './live.ts';
import { handleSupervisor } from './supervisor-control.ts';

let sandbox: Sandbox;
let home: string;
let projectId: string;
const saved = { home: process.env.HARNESS_HOME, agent: process.env.AGENT_CMD };

before(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-live-home-'));
  process.env.HARNESS_HOME = home;
  /* The spawned supervisor inherits this: if it ever took a task, it would run the fake agent, not claude. */
  process.env.AGENT_CMD = `node ${JSON.stringify(FAKE_AGENT)}`;
  sandbox = makeSandbox();
  projectId = addProject(sandbox.project).id;
});

after(() => {
  sandbox.cleanup();
  rmSync(home, { recursive: true, force: true });
  for (const [key, value] of [
    ['HARNESS_HOME', saved.home],
    ['AGENT_CMD', saved.agent],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const post = (header = true) =>
  new Request('http://127.0.0.1/api', { method: 'POST', headers: header ? { 'x-harness': '1' } : {} });
const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
};

test('supervisor control: header guard, start, a second start, pause, resume, stop', async () => {
  assert.equal((await handleSupervisor(post(false), projectId, 'start')).status, 403);
  assert.equal((await handleSupervisor(post(), projectId, 'pause')).status, 409);
  assert.equal((await handleSupervisor(post(), projectId, 'restart')).status, 404);

  const started = await handleSupervisor(post(), projectId, 'start');
  assert.equal(started.status, 200);
  const { pid } = (await started.json()) as { pid: number };
  try {
    assert.equal(lockHolder(sandbox.project), pid);
    assert.equal(liveSnapshot(projectId).supervisor.state, 'running');
    assert.equal((await handleSupervisor(post(), projectId, 'start')).status, 409);

    assert.equal((await handleSupervisor(post(), projectId, 'pause')).status, 200);
    assert.ok(existsSync(tracePaths(sandbox.project).pause));
    assert.equal(liveSnapshot(projectId).supervisor.state, 'paused');
    assert.equal((await handleSupervisor(post(), projectId, 'resume')).status, 200);
    assert.equal(liveSnapshot(projectId).supervisor.state, 'running');

    assert.equal((await handleSupervisor(post(), projectId, 'stop')).status, 200);
    assert.ok(await until(() => lockHolder(sandbox.project) === null), 'the supervisor did not stop');
    assert.equal(liveSnapshot(projectId).supervisor.state, 'stopped');
  } finally {
    /* Only the process this test started, by its exact pid, and only if STOP did not end it. */
    if (lockHolder(sandbox.project) === pid) process.kill(pid, 'SIGTERM');
  }
});

test('the live snapshot carries the unit in flight without tool arguments or message text (criterion 6)', () => {
  const SECRET = 'sk-live-THIS-MUST-NOT-LEAK';
  seedTask(sandbox, { id: 'T-001', status: 'implementing', scope: ['src/**'], closes: ['true'] });
  const paths = tracePaths(sandbox.project);
  writeFileSync(
    paths.running,
    JSON.stringify({
      task: 'T-001',
      stage: 'implement',
      role: 'implementer',
      unit: 4,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }),
  );
  writeFileSync(
    paths.unit(4),
    [
      {
        harness_ts: new Date().toISOString(),
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [
            { type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'implementer', prompt: SECRET } },
          ],
        },
      },
      {
        harness_ts: new Date().toISOString(),
        type: 'assistant',
        parent_tool_use_id: 'a1',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `echo ${SECRET}` } }] },
      },
      {
        harness_ts: new Date().toISOString(),
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: SECRET }] },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n'),
  );
  try {
    const snapshot = liveSnapshot(projectId);
    assert.equal(snapshot.running?.task, 'T-001');
    assert.deepEqual(
      snapshot.running?.trace?.agents.map((agent) => [agent.role, agent.tool]),
      [['implementer', 'Bash']],
    );
    assert.ok(!JSON.stringify(snapshot).includes(SECRET));
  } finally {
    rmSync(paths.running, { force: true });
  }
});
