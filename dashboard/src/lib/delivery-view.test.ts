/* What the dashboard shows of delivery: the PR on the card, the drawer and the dock; "PR next" before it. */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { addProject } from '@harness/core/projects';
import { supervise } from '@harness/core/supervise';
import { makeSandbox, seedTask, type Sandbox } from '@harness/core/testkit/sandbox';
import { loadAgentsPage } from './agents-view.ts';
import { loadBoard } from './board.ts';
import { liveSnapshot } from './live.ts';
import { loadTaskDetail } from './task-detail.ts';

let sandbox: Sandbox;
let home: string;
let projectId: string;
const saved = process.env.HARNESS_HOME;
const READY = { status: 'ready' as const, scope: ['src/**'], closes: ['test -f src/feature.txt'] };

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'harness-delivery-home-'));
  process.env.HARNESS_HOME = home;
  sandbox = makeSandbox({ autonomy: { mode: 'full' }, deliver: { pr: true } });
  projectId = addProject(sandbox.project).id;
  seedTask(sandbox, READY);
  seedTask(sandbox, { ...READY, id: 'T-002', title: 'Second' });
  // T-001 and T-002 go to done; only T-001 is delivered (the cap stops before T-002's pull request).
  await supervise(sandbox.project, { ...sandbox.agent, onceThrough: true, maxUnits: 7 });
});

after(() => {
  sandbox.cleanup();
  rmSync(home, { recursive: true, force: true });
  if (saved === undefined) delete process.env.HARNESS_HOME;
  else process.env.HARNESS_HOME = saved;
});

test('a delivered card carries its pull request; a done one says PR next and waits for the loop', () => {
  const board = loadBoard(projectId);
  const byId = Object.fromEntries(board.cards.map((card) => [card.id, card]));
  assert.equal(byId['T-001']?.status, 'delivered');
  assert.match(byId['T-001']?.pr ?? '', /\/pull\/1$/);
  assert.equal(byId['T-002']?.status, 'done');
  assert.match(byId['T-002']?.meta ?? '', /PR next$/);
  assert.equal(byId['T-002']?.agentNext, true);
  assert.equal(board.dock.upNext, 'T-002 · pull request');
});

test('the drawer links the pull request; the dock lists the deliver step without a unit number', () => {
  assert.match(loadTaskDetail(projectId, 'T-001')?.pr ?? '', /\/pull\/1$/);
  const step = liveSnapshot(projectId).recent.find((record) => record.stage === 'deliver');
  assert.equal(step?.unit, undefined);
  assert.match(step?.pr ?? '', /\/pull\/1$/);
});

test('the agents page says where delivery goes and that Telegram is off in the sandbox', () => {
  const { outbound } = loadAgentsPage(projectId);
  assert.deepEqual(outbound, { pr: true, remote: 'origin', telegram: null });
});
