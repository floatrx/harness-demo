/* /projects: add by path, remove from the registry, and a list that survives a broken project. */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { tracePaths } from '@harness/core/paths';
import { listProjects } from '@harness/core/projects';
import { makeSandbox, type Sandbox } from '@harness/core/testkit/sandbox';
import { handleAddProject, handleRemoveProject } from './actions.ts';
import { listProjectSummaries } from './projects-view.ts';

let sandbox: Sandbox;
let home: string;
let scratch: string;
const saved = process.env.HARNESS_HOME;

before(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-projects-home-'));
  scratch = mkdtempSync(join(tmpdir(), 'harness-projects-scratch-'));
  process.env.HARNESS_HOME = home;
  sandbox = makeSandbox();
});

after(() => {
  sandbox.cleanup();
  rmSync(home, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
  if (saved === undefined) delete process.env.HARNESS_HOME;
  else process.env.HARNESS_HOME = saved;
});

const post = (body?: unknown, header = true) =>
  new Request('http://127.0.0.1/api', {
    method: 'POST',
    headers: header ? { 'x-harness': '1', 'content-type': 'application/json' } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('adding a project: header, absolute path, a git repository; a second add is idempotent', async () => {
  assert.equal((await handleAddProject(post({ path: sandbox.project }, false))).status, 403);
  assert.equal((await handleAddProject(post({ path: 'relative/dir' }))).status, 400);
  const notRepo = join(scratch, 'plain');
  mkdirSync(notRepo);
  const refused = await handleAddProject(post({ path: notRepo }));
  assert.equal(refused.status, 400);
  assert.match(((await refused.json()) as { error: string }).error, /not a git repository/);
  assert.equal(existsSync(join(notRepo, '.harness')), false);

  const added = await handleAddProject(post({ path: sandbox.project, name: 'sandbox' }));
  assert.equal(added.status, 201);
  assert.equal(((await added.json()) as { name: string }).name, 'sandbox');
  assert.equal((await handleAddProject(post({ path: sandbox.project }))).status, 200);
  assert.equal(listProjects().length, 1);
});

test('a project is not removed while a supervisor holds its lock; removing keeps its files', async () => {
  const [project] = listProjects();
  assert.ok(project);
  const { lock } = tracePaths(project.path);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  assert.equal((await handleRemoveProject(post(), project.id)).status, 409);
  rmSync(lock);
  assert.equal((await handleRemoveProject(post(), project.id)).status, 200);
  assert.equal(listProjects().length, 0);
  assert.ok(existsSync(join(project.path, '.harness', 'config.json')));
  assert.equal((await handleRemoveProject(post(), project.id)).status, 404);
});

test('the list shows a missing folder and a broken config instead of failing', async () => {
  await handleAddProject(post({ path: sandbox.project, name: 'ok' }));
  const broken = makeSandbox();
  const gone = makeSandbox();
  try {
    await handleAddProject(post({ path: broken.project, name: 'broken' }));
    await handleAddProject(post({ path: gone.project, name: 'gone' }));
    writeFileSync(join(broken.project, '.harness', 'config.json'), '{ not json');
    gone.cleanup();
    const states = Object.fromEntries(listProjectSummaries().map((row) => [row.project.name, row.state]));
    assert.deepEqual(states, { ok: 'ok', broken: 'broken', gone: 'missing' });
  } finally {
    broken.cleanup();
  }
});
