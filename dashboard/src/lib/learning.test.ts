/* /learning: the lesson guards, the page model, and the same candidates the CLI lists (criterion 5). */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendHandoff, markRunning, tracePaths } from '@harness/core/paths';
import { addProject } from '@harness/core/projects';
import { makeSandbox, type Sandbox } from '@harness/core/testkit/sandbox';
import { handleLessonAction } from './actions.ts';
import { loadHome } from './home-view.ts';
import { loadLearning } from './learning-view.ts';

const CLI = fileURLToPath(new URL('../../../harness/bin/harness.ts', import.meta.url));
const KEY = 'park:out-of-scope edit:README.md';

let sandbox: Sandbox;
let home: string;
let projectId: string;
const saved = process.env.HARNESS_HOME;

before(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-learning-home-'));
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

test('no evidence: the page is empty and Home shows no lesson line', () => {
  const model = loadLearning(projectId);
  assert.deepEqual(model.candidates, []);
  assert.equal(model.selected, null);
  assert.equal(loadHome(projectId).lessons, 0);
});

test('two parks for one violation: one candidate, the same in the page, on Home and in `harness lessons --json`', () => {
  const paths = tracePaths(sandbox.project);
  for (const [task, unit] of [
    ['T-004', 3],
    ['T-007', 9],
  ] as const)
    appendHandoff(paths, {
      task,
      stage: 'implement',
      unit,
      from: 'implementing',
      to: 'parked',
      exit: 1,
      reason: `implement unit ${unit}: out-of-scope edit: README.md`,
    });
  const model = loadLearning(projectId);
  assert.deepEqual(
    model.candidates.map((candidate) => candidate.key),
    [KEY],
  );
  assert.equal(model.selected?.key, KEY, 'the newest candidate is open by default');
  assert.equal(loadHome(projectId).lessons, 1);
  const cli = spawnSync('node', [CLI, 'lessons', '--json', '--project', sandbox.project], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const listed = JSON.parse(cli.stdout) as { candidates: { key: string }[] };
  assert.deepEqual(
    listed.candidates.map((candidate) => candidate.key),
    model.candidates.map((candidate) => candidate.key),
  );
});

test('lesson guards: header, action, rule text, open key', async () => {
  assert.equal((await handleLessonAction(post({ key: KEY, text: 'x' }, false), projectId, 'apply')).status, 403);
  assert.equal((await handleLessonAction(post({ key: KEY }), projectId, 'merge')).status, 404);
  assert.equal((await handleLessonAction(post({ key: KEY, text: 'x' }), 'nope', 'apply')).status, 404);
  assert.equal((await handleLessonAction(post({ key: KEY, text: '  ' }), projectId, 'apply')).status, 400);
  assert.equal((await handleLessonAction(post({ key: 'park:none', text: 'x' }), projectId, 'apply')).status, 409);
  assert.equal((await handleLessonAction(post({ id: 'L-404' }), projectId, 'withdraw')).status, 409);
});

test('apply is allowed while a unit runs; undo brings the candidate back; reject blocks it', async () => {
  const paths = tracePaths(sandbox.project);
  markRunning(paths, {
    task: 'T-009',
    stage: 'implement',
    role: 'implementer',
    unit: 50,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  try {
    const applied = await handleLessonAction(
      post({ key: KEY, text: 'Edit README.md only when the scope lists it.' }),
      projectId,
      'apply',
    );
    assert.equal(applied.status, 200);
    assert.equal(((await applied.json()) as { id: string }).id, 'L-001');
  } finally {
    rmSync(paths.running, { recursive: true, force: true });
  }
  let model = loadLearning(projectId, 'applied');
  assert.equal(model.tab, 'applied');
  assert.deepEqual(model.candidates, []);
  assert.equal(model.applied[0]?.text, 'Edit README.md only when the scope lists it.');
  assert.equal((await handleLessonAction(post({ id: 'L-001' }), projectId, 'withdraw')).status, 200);
  model = loadLearning(projectId);
  assert.deepEqual(model.applied, []);
  assert.equal(model.candidates[0]?.key, KEY);
  assert.equal((await handleLessonAction(post({ key: KEY }), projectId, 'reject')).status, 200);
  model = loadLearning(projectId, 'rejected');
  assert.deepEqual(model.candidates, []);
  assert.equal(model.rejected[0]?.key, KEY);
});
