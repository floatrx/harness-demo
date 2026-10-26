import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProjectError, resolveProject } from './projects.ts';
import { makeSandbox } from './testkit/sandbox.ts';

test('a folder with only `.harness/` (the registry home, ~/.harness) is not a project; one with its config is', () => {
  const home = mkdtempSync(join(tmpdir(), 'harness-home-like-'));
  const sandbox = makeSandbox();
  try {
    mkdirSync(join(home, '.harness'));
    assert.throws(() => resolveProject(home), ProjectError);
    assert.equal(resolveProject(sandbox.project), sandbox.project);
  } finally {
    rmSync(home, { recursive: true, force: true });
    sandbox.cleanup();
  }
});
