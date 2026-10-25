import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inScope } from './contracts/scope.ts';
import { readVerdict } from './contracts/trace.ts';
import { nextStep } from './queue.ts';
import type { TaskFields } from './task/task.ts';
import { DEFAULT_CONTEXT } from './task/transitions.ts';

const task = (id: string, status: TaskFields['status'], extra: Partial<TaskFields> = {}): TaskFields => ({
  id,
  title: id,
  status,
  kind: 'logic',
  resume: null,
  prototype: null,
  parkedFrom: null,
  bounces: 0,
  openQuestions: 0,
  scope: [],
  gate: null,
  branch: null,
  parked: null,
  created: null,
  ...extra,
});

test('the queue finishes before it starts: later stage first, then the lower id', () => {
  const step = nextStep([task('T-001', 'spec'), task('T-003', 'qa'), task('T-002', 'qa')], DEFAULT_CONTEXT);
  assert.deepEqual(step && step.kind === 'unit' && [step.task.id, step.stage], ['T-002', 'qa']);
});

test('human-owned columns are never taken; full autonomy advances planned without a unit', () => {
  const tasks = [task('T-001', 'draft'), task('T-002', 'planned'), task('T-003', 'parked')];
  assert.equal(nextStep(tasks, DEFAULT_CONTEXT), null);
  const step = nextStep(tasks, { ...DEFAULT_CONTEXT, autonomy: 'full' });
  assert.deepEqual(step && step.kind === 'advance' && [step.task.id, step.target], ['T-002', 'ready']);
});

test('an answered needs-input task returns to the stage that asked', () => {
  const step = nextStep([task('T-001', 'needs-input', { resume: 'plan' })], DEFAULT_CONTEXT);
  assert.deepEqual(step && step.kind === 'advance' && step.target, 'plan');
  assert.equal(nextStep([task('T-001', 'needs-input', { resume: 'plan', openQuestions: 1 })], DEFAULT_CONTEXT), null);
});

test('a prototype under review waits for the human', () => {
  assert.equal(nextStep([task('T-001', 'prototype', { prototype: 'review', kind: 'ui' })], DEFAULT_CONTEXT), null);
});

test('scope patterns', () => {
  assert.ok(inScope('src/a/b.ts', ['src/**']));
  assert.ok(inScope('src/b.ts', ['src/**/*.ts']));
  assert.ok(inScope('src/app/globals.css', ['src/app/globals.css']));
  assert.ok(inScope('docs/x/y.md', ['docs']));
  assert.ok(!inScope('srcx/a.ts', ['src']));
  assert.ok(!inScope('src/a/b.ts', ['src/*']));
  assert.ok(!inScope('README.md', ['src/**']));
});

test('verdicts are found inside stream-json strings and the last one wins', () => {
  const rule = { token: 'judge', values: ['CONFIRMED', 'REJECTED'] };
  const trace = '{"type":"assistant","text":"checked\\njudge: REJECTED"}\n{"text":"re-run\\njudge: CONFIRMED"}';
  assert.equal(readVerdict(trace, rule).verdict, 'CONFIRMED');
  assert.equal(readVerdict('judge says fine', rule).ok, false);
});
