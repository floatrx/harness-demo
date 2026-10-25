// Every self-test case as a node:test test, so `node --test harness/` covers the loop end to end.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES } from './selftest.ts';

for (const item of CASES) {
  test(item.name, async () => {
    const evidence = await item.run();
    assert.ok(evidence);
  });
}
