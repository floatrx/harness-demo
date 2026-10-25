import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeStats } from './stats.ts';
import type { UnitRecord } from './units.ts';

const SECRET = 'sk-live-THIS-MUST-NOT-LEAK';
let n = 0;
const unit = (over: Partial<UnitRecord>): UnitRecord => ({
  at: `2026-10-25T10:0${n}:30.000Z`,
  unit: ++n,
  task: 'T-001',
  stage: 'spec',
  exit: 0,
  startedAt: `2026-10-25T10:0${n - 1}:30.000Z`,
  durationMs: 60_000,
  usage: null,
  ...over,
});

const UNITS = [
  unit({ usage: { costUsd: 0.2, inputTokens: 1000, outputTokens: 250, cacheReadTokens: 9000 } }),
  unit({ stage: 'plan', usage: { costUsd: 0.3, inputTokens: 2000, outputTokens: 500 } }),
  unit({
    task: 'T-002',
    stage: 'implement',
    exit: 1,
    usage: {
      costUsd: 0.6,
      inputTokens: 4000,
      outputTokens: 1000,
      permissionDenials: [`Bash(curl -H "x: ${SECRET}")`, 'Bash(rm -rf /)', 'WebFetch'],
    },
  }),
  unit({ task: 'T-002', stage: 'qa', verdict: 'PASS' }),
];
const TASKS = [
  { id: 'T-001', title: 'Search', status: 'planned' },
  { id: 'T-002', title: 'Sort', status: 'parked' },
];

test('totals, hard stops and the units that reported usage', () => {
  const stats = computeStats(UNITS, TASKS);
  assert.equal(stats.total.units, 4);
  assert.equal(stats.total.ok, 3);
  assert.equal(stats.total.stops, 1);
  assert.equal(stats.total.reported, 3);
  assert.equal(stats.total.costUsd?.toFixed(2), '1.10');
  assert.equal(stats.total.tokens, 8750);
  assert.equal(stats.total.cacheReadTokens, 9000);
  assert.equal(stats.total.durationMs, 240_000);
});

test('every unit stage has a row, in pipeline order, with its coordinator role', () => {
  const stats = computeStats(UNITS, TASKS);
  assert.deepEqual(
    stats.byStage.map((row) => [row.key, row.role, row.units]),
    [
      ['spec', 'writer', 1],
      ['plan', 'planner', 1],
      ['prototype', 'designer', 0],
      ['implement', 'implementer', 1],
      ['qa', 'qa', 1],
      ['judge', 'judge', 0],
    ],
  );
});

test('a row whose units reported no usage has an unknown cost, not zero', () => {
  const stats = computeStats(UNITS, TASKS);
  assert.equal(stats.byStage.find((row) => row.key === 'qa')?.costUsd, null);
  assert.equal(stats.byStage.find((row) => row.key === 'judge')?.costUsd, null);
});

test('tasks sort by cost and carry their title and status', () => {
  const stats = computeStats(UNITS, TASKS);
  assert.deepEqual(
    stats.byTask.map((row) => [row.key, row.title, row.status, row.units, row.costUsd?.toFixed(2)]),
    [
      ['T-002', 'Sort', 'parked', 2, '0.60'],
      ['T-001', 'Search', 'planned', 2, '0.50'],
    ],
  );
  assert.deepEqual(stats.verdicts, [{ stage: 'qa', verdict: 'PASS', count: 1 }]);
});

test('permission denials keep the tool name only — never the refused command', () => {
  const stats = computeStats(UNITS, TASKS);
  assert.deepEqual(stats.denials, [
    { tool: 'Bash', count: 2, units: [3] },
    { tool: 'WebFetch', count: 1, units: [3] },
  ]);
  const json = JSON.stringify(stats);
  assert.ok(!json.includes(SECRET));
  assert.ok(!json.includes('rm -rf'));
});
