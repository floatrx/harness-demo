import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { buildMemory } from './memory.ts';
import { tracePaths } from './paths.ts';
import { makeSandbox, seedTask } from './testkit/sandbox.ts';

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
