import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limitResetAt } from './trace.ts';

const LIMIT = "You've hit your session limit · resets 9:10pm (Europe/Kiev)";

test('a usage limit names its reset: the next 21:10 in that zone (pilot lesson 9)', () => {
  // 18:09 UTC is 20:09 in Kyiv (UTC+2 after the October change): the reset is 21:10 the same day, 19:10 UTC.
  assert.equal(limitResetAt(LIMIT, new Date('2026-10-26T18:09:00Z'))?.toISOString(), '2026-10-26T19:10:00.000Z');
  // Past 21:10 Kyiv the same words mean tomorrow.
  assert.equal(limitResetAt(LIMIT, new Date('2026-10-26T19:30:00Z'))?.toISOString(), '2026-10-27T19:10:00.000Z');
  // Summer time: UTC+3.
  assert.equal(
    limitResetAt('resets 9am (Europe/Kiev)', new Date('2026-07-01T03:00:00Z'))?.toISOString(),
    '2026-07-01T06:00:00.000Z',
  );
  assert.equal(
    limitResetAt('resets 12am (UTC)', new Date('2026-07-01T03:00:00Z'))?.toISOString(),
    '2026-07-02T00:00:00.000Z',
  );
});

test('no time of day or an unknown zone: null, so the supervisor naps as configured', () => {
  assert.equal(limitResetAt('API Error: 429 rate limited'), null);
  assert.equal(limitResetAt('resets 9:10pm (Mars/Olympus)'), null);
  assert.equal(limitResetAt('resets 13pm (UTC)'), null);
});
