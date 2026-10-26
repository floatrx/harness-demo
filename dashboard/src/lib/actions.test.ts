import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { tracePaths } from '@harness/core/paths';
import { addProject } from '@harness/core/projects';
import { getSection, normalizeBody, putSection, setField } from '@harness/core/task/parse';
import { loadTask, saveTask } from '@harness/core/task/task';
import { makeSandbox, seedTask, type Sandbox } from '@harness/core/testkit/sandbox';
import { handleCreateTask, handleTaskAction } from './actions.ts';

let sandbox: Sandbox;
let home: string;
let projectId: string;
const saved = process.env.HARNESS_HOME;

before(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-dash-home-'));
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

const post = (body?: unknown, header = true) =>
  new Request('http://127.0.0.1/api', {
    method: 'POST',
    headers: header ? { 'x-harness': '1', 'content-type': 'application/json' } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('a mutation without the x-harness header is refused', async () => {
  seedTask(sandbox, { id: 'T-001', status: 'draft' });
  const response = await handleTaskAction(post(undefined, false), projectId, 'T-001', 'submit');
  assert.equal(response.status, 403);
  assert.equal(sandbox.task('T-001').fields.status, 'draft');
});

test('submit moves a draft to spec; an illegal move is 409 and changes nothing', async () => {
  seedTask(sandbox, { id: 'T-002', status: 'draft' });
  assert.equal((await handleTaskAction(post(), projectId, 'T-002', 'approve')).status, 409);
  const response = await handleTaskAction(post(), projectId, 'T-002', 'submit');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'T-002', status: 'spec', prototype: null });
});

test('unknown project, task or action is 404', async () => {
  assert.equal((await handleTaskAction(post(), 'nope', 'T-001', 'submit')).status, 404);
  assert.equal((await handleTaskAction(post(), projectId, 'T-999', 'submit')).status, 404);
  assert.equal((await handleTaskAction(post(), projectId, 'T-001', 'merge')).status, 404);
});

test('a task in the running unit is refused', async () => {
  seedTask(sandbox, { id: 'T-003', status: 'draft' });
  const paths = tracePaths(sandbox.project);
  writeFileSync(
    paths.running,
    JSON.stringify({
      task: 'T-003',
      stage: 'spec',
      role: 'writer',
      unit: 7,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }),
  );
  try {
    const response = await handleTaskAction(post(), projectId, 'T-003', 'submit');
    assert.equal(response.status, 409);
    assert.match(((await response.json()) as { error: string }).error, /unit 7/);
  } finally {
    rmSync(paths.running, { force: true });
  }
});

test('answers land in one write and close every question', async () => {
  seedTask(sandbox, { id: 'T-004', status: 'needs-input' });
  const path = sandbox.taskPath('T-004');
  const doc = loadTask(path).doc;
  setField(doc, 'resume', 'spec');
  putSection(
    doc,
    'Questions',
    normalizeBody(
      '### Q1 · Where? · open\n- (a) Header\n- (b) Footer\n> **Answer:**\n\n### Q2 · Store? · open\n- (a) Local\n- (b) File\n> **Answer:**',
    ),
  );
  saveTask(path, doc);
  const response = await handleTaskAction(
    post({
      answers: [
        { id: 'Q1', letter: 'b', note: 'quieter' },
        { id: 'Q2', letter: 'a' },
      ],
    }),
    projectId,
    'T-004',
    'answer',
  );
  assert.equal(response.status, 200);
  const questions = getSection(loadTask(path).doc, 'Questions') ?? '';
  assert.match(questions, /Q1 · Where\? · answered[\s\S]*\(b\) — quieter[\s\S]*Q2 · Store\? · answered[\s\S]*\(a\)/);
  assert.equal(loadTask(path).fields.openQuestions, 0);
  assert.equal(
    (await handleTaskAction(post({ answers: [{ id: 'Q1', letter: 'z' }] }), projectId, 'T-004', 'answer')).status,
    409,
  );
});

test('prototype review: an empty comment is 400, a comment sends it back, accept moves it to ready', async () => {
  seedTask(sandbox, { id: 'T-005', status: 'prototype', kind: 'ui', scope: ['src/**'], closes: ['true'] });
  const path = sandbox.taskPath('T-005');
  const doc = loadTask(path).doc;
  setField(doc, 'prototype', 'review');
  saveTask(path, doc);
  assert.equal((await handleTaskAction(post({ text: ' ' }), projectId, 'T-005', 'comment')).status, 400);
  assert.equal((await handleTaskAction(post({ text: 'bigger button' }), projectId, 'T-005', 'comment')).status, 200);
  assert.equal(loadTask(path).fields.prototype, 'drafting');
  assert.equal((await handleTaskAction(post(), projectId, 'T-005', 'accept')).status, 409);
  const again = loadTask(path).doc;
  setField(again, 'prototype', 'review');
  saveTask(path, again);
  const accepted = await handleTaskAction(post(), projectId, 'T-005', 'accept');
  assert.deepEqual(await accepted.json(), { id: 'T-005', status: 'ready', prototype: null });
});

test('plan revise: an empty comment is 400, a comment returns the plan to the planner with the note', async () => {
  seedTask(sandbox, { id: 'T-006', status: 'planned', kind: 'logic', scope: ['src/**'], closes: ['true'] });
  const path = sandbox.taskPath('T-006');
  assert.equal((await handleTaskAction(post({ text: '' }), projectId, 'T-006', 'revise')).status, 400);
  const response = await handleTaskAction(post({ text: 'invert criterion 2' }), projectId, 'T-006', 'revise');
  assert.equal(response.status, 200);
  assert.equal(loadTask(path).fields.status, 'plan');
  assert.match(getSection(loadTask(path).doc, 'Plan') ?? '', /### Review\n- .* · 👤 revise: invert criterion 2\n$/);
  assert.equal((await handleTaskAction(post({ text: 'again' }), projectId, 'T-006', 'revise')).status, 409);
});

test('create makes the next draft; a missing title is 400', async () => {
  assert.equal((await handleCreateTask(post({ title: '' }), projectId)).status, 400);
  assert.equal((await handleCreateTask(post({ title: 'X', kind: 'weird' }), projectId)).status, 400);
  const response = await handleCreateTask(
    post({ title: 'Export bookmarks', draft: 'As JSON.', kind: 'logic' }),
    projectId,
  );
  assert.equal(response.status, 201);
  const { id } = (await response.json()) as { id: string };
  assert.equal(loadTask(sandbox.taskPath(id)).fields.status, 'draft');
  assert.equal(loadTask(sandbox.taskPath(id)).fields.kind, 'logic');
});

test('the board offers drag moves only along human transitions, and none for the running task', async () => {
  const { loadBoard } = await import('./board.ts');
  seedTask(sandbox, { id: 'T-010', status: 'planned', kind: 'logic', scope: ['src/**'], closes: ['true'] });
  seedTask(sandbox, { id: 'T-011', status: 'qa', scope: ['src/**'], closes: ['true'] });
  const moves = (id: string) => loadBoard(projectId).cards.find((card) => card.id === id)?.moves;
  assert.deepEqual(moves('T-010'), [{ target: 'ready', action: 'approve' }]);
  assert.deepEqual(moves('T-011'), []);
  const paths = tracePaths(sandbox.project);
  writeFileSync(
    paths.running,
    JSON.stringify({
      task: 'T-010',
      stage: 'plan',
      role: 'planner',
      unit: 3,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }),
  );
  try {
    assert.deepEqual(moves('T-010'), []);
  } finally {
    rmSync(paths.running, { force: true });
  }
});
