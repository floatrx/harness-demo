import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { buildMemory } from './memory.ts';
import { tracePaths } from './paths.ts';
import { makeSandbox, seedTask } from './testkit/sandbox.ts';
import { setField } from './task/parse.ts';
import { loadTask, saveTask } from './task/task.ts';

const sandbox = makeSandbox();
after(() => sandbox.cleanup());

test('spec and plan units see the other tasks on the board; later stages do not (pilot lesson 6)', () => {
  const search = seedTask(sandbox, { id: 'T-001', status: 'needs-input' as const });
  const vague = seedTask(sandbox, { id: 'T-003', status: 'spec' as const });
  const paths = tracePaths(sandbox.project);
  const spec = buildMemory(sandbox.project, paths, sandbox.task(vague).fields, 'spec', 'main');
  assert.match(spec, /### Other tasks on the board \(id · status · title\)\n- T-\d+ · needs-input · /);
  assert.ok(spec.includes(`- ${search} · needs-input`), 'the other task is listed');
  assert.ok(!spec.includes(`- ${vague} ·`), 'the task itself is not listed');
  const qa = buildMemory(sandbox.project, paths, sandbox.task(vague).fields, 'qa', 'main');
  assert.ok(!qa.includes('Other tasks on the board'));
});

test("the board says whether another task's work is in the base branch (pilot lesson 11)", () => {
  const box = makeSandbox();
  try {
    // A delivered task whose branch is not merged, and a done task whose branch is.
    box.git(['checkout', '-q', '-b', 'harness/T-001-open']);
    box.git(['commit', '-q', '--allow-empty', '-m', 'T-001: open']);
    box.git(['checkout', '-q', 'main']);
    box.git(['branch', 'harness/T-002-merged']);
    for (const [id, status, branch] of [
      ['T-001', 'delivered', 'harness/T-001-open'],
      ['T-002', 'done', 'harness/T-002-merged'],
    ] as const) {
      seedTask(box, { id, status, scope: ['src/**'], closes: ['true'] });
      const loaded = loadTask(box.taskPath(id));
      setField(loaded.doc, 'branch', branch);
      saveTask(loaded.path, loaded.doc);
    }
    seedTask(box, { id: 'T-003', status: 'spec' });
    const memory = buildMemory(box.project, tracePaths(box.project), box.task('T-003').fields, 'plan', 'main');
    assert.match(memory, /- T-001 · delivered · .* · NOT in main yet — do not build on it/);
    assert.match(memory, /- T-002 · done · .* · merged into main/);
  } finally {
    box.cleanup();
  }
});
