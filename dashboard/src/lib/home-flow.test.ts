/* /home and /flow on a sandbox: empty states before any unit, numbers that match `harness stats`, and a Flow lane that
   draws only what handoffs.jsonl and the unit trace record. */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { appendHandoff, markRunning, tracePaths } from '@harness/core/paths';
import { addProject } from '@harness/core/projects';
import { runUnit } from '@harness/core/runner';
import { projectStats } from '@harness/core/stats';
import { makeSandbox, seedTask, type Sandbox } from '@harness/core/testkit/sandbox';
import { loadFlow } from './flow-view.ts';
import { loadHome } from './home-view.ts';

let sandbox: Sandbox;
let home: string;
let projectId: string;
const saved = process.env.HARNESS_HOME;

before(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-home-flow-'));
  process.env.HARNESS_HOME = home;
  sandbox = makeSandbox();
  projectId = addProject(sandbox.project).id;
});

after(() => {
  sandbox.cleanup();
  rmSync(home, { recursive: true, force: true });
  if (saved === undefined) delete process.env.HARNESS_HOME;
  else process.env.HARNESS_HOME = saved;
});

test('no tasks, no units: every widget is empty, none shows a zero it cannot source', () => {
  const model = loadHome(projectId);
  assert.equal(model.waiting.count, 0);
  assert.equal(model.done.total, 0);
  assert.equal(model.running, null);
  assert.deepEqual(model.health, []);
  assert.equal(model.spend, null);
  assert.deepEqual(model.verdicts, []);
  const flow = loadFlow(projectId);
  assert.equal(flow.lane, null);
  assert.deepEqual(flow.lastRuns, []);
});

test('waiting counts the cards the human acts on, with their reasons', async () => {
  seedTask(sandbox, { id: 'T-001', status: 'ready', scope: ['src/**'], closes: ['test -f src/feature.txt'] });
  seedTask(sandbox, { id: 'T-002', status: 'planned', scope: ['src/**'] });
  seedTask(sandbox, { id: 'T-003', status: 'draft' });
  const result = await runUnit(sandbox.project, sandbox.agent);
  assert.equal(result.exit, 0);
  const model = loadHome(projectId);
  // A ready task is the runner's next step, not the human's: it is not counted.
  assert.equal(model.waiting.count, 2);
  assert.deepEqual(model.waiting.reasons, [
    { label: 'plan to approve', count: 1 },
    { label: 'draft to submit', count: 1 },
  ]);
  assert.deepEqual(
    model.health.map((cell) => [cell.task, cell.stage, cell.exit]),
    [['T-001', 'implement', 0]],
  );
  assert.equal(model.spend, null, 'no task is done yet');
});

test('done, spend and verdicts match harness stats', () => {
  seedTask(sandbox, { id: 'T-004', status: 'done', scope: ['src/**'] });
  appendHandoff(tracePaths(sandbox.project), {
    task: 'T-004',
    stage: 'judge',
    unit: 90,
    from: 'judge',
    to: 'done',
    exit: 0,
    verdict: 'CONFIRMED',
    usage: { costUsd: 0.3, inputTokens: 100, outputTokens: 50 },
  });
  const model = loadHome(projectId);
  const stats = projectStats(sandbox.project);
  assert.equal(model.done.finished, 1);
  assert.equal(model.done.total, 4);
  assert.equal(model.done.lastWeek, 1);
  assert.equal(model.done.perDay.at(-1)?.count, 1);
  const row = stats.byTask.find((task) => task.key === 'T-004');
  assert.equal(model.spend?.costUsd, row?.costUsd);
  assert.equal(model.spend?.tokens, row?.tokens);
  assert.deepEqual(model.verdicts, stats.verdicts);
});

test('flow: the lane follows the expected path and draws only recorded steps', () => {
  const paths = tracePaths(sandbox.project);
  const startedAt = new Date().toISOString();
  markRunning(
    paths,
    ({ task: 'T-001', stage: 'qa', role: 'qa', unit: 91, pid: process.pid, startedAt }),
  );
  try {
    const flow = loadFlow(projectId, 'qa');
    const lane = flow.lane;
    assert.ok(lane);
    assert.equal(lane.key, `T-001:qa:${startedAt}`);
    assert.deepEqual(
      lane.expected.map((node) => node.status),
      ['draft', 'spec', 'plan', 'planned', 'ready', 'implementing', 'qa', 'judge', 'done'],
    );
    // One implement unit ran, implementing → qa: both are passed; nothing before it is.
    assert.equal(lane.trail.length, 1);
    assert.deepEqual([lane.trail[0]?.stage, lane.trail[0]?.from, lane.trail[0]?.to], ['implement', 'implementing', 'qa']);
    const passed = lane.expected.filter((node) => node.passed).map((node) => node.status);
    // `ready` was a human approve: no handoff names it, so it stays hollow.
    assert.deepEqual(passed, ['implementing', 'qa']);
    assert.equal(lane.expected.find((node) => node.isCurrent)?.status, 'qa');
    // No trace file yet: the chain is the coordinator alone, never an invented specialist.
    assert.deepEqual(
      lane.roles.map((role) => role.role),
      ['qa'],
    );
    assert.equal(flow.agent?.name, 'qa');
    assert.ok(!flow.lastRuns.some((run) => run.unit === 91));
  } finally {
    rmSync(paths.running, { recursive: true, force: true });
  }
});

test('flow: a role without an agent file opens an honest drawer', () => {
  const flow = loadFlow(projectId, 'nobody');
  assert.equal(flow.agent, null);
  assert.equal(flow.missingAgent, 'nobody');
});
