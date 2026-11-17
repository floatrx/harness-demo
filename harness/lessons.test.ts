// Lesson candidates and LESSONS.md: the four kinds, normalization, decided keys, the scope ledger.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { snapshot, judgeScope } from './contracts/scope.ts';
import {
  BOUNCES,
  DENIED_UNITS,
  LESSONS_FILE,
  LessonError,
  appliedRules,
  applyLesson,
  findCandidates,
  journalNotes,
  lessonsView,
  normalizeReason,
  parseLessons,
  rejectLesson,
  serializeLessons,
  withdrawLesson,
} from './lessons.ts';
import { buildMemory } from './memory.ts';
import { type HandoffRecord, appendHandoff, tracePaths } from './paths.ts';
import type { UnitRecord } from './stats.ts';
import { makeSandbox, seedTask } from './testkit/sandbox.ts';

const park = (task: string, unit: number, reason: string, at = '2026-11-17T10:00:00.000Z'): HandoffRecord => ({
  at,
  task,
  stage: 'implement',
  unit,
  from: 'implementing',
  to: 'parked',
  exit: 1,
  reason,
});

const none = { handoffs: [], units: [], journal: '', decided: new Set<string>() };

describe('candidates', () => {
  test('repeat-park: two tasks with one violation give one key, whatever their ids and units', () => {
    const handoffs = [
      park('T-004', 7, 'implement unit 7: out-of-scope edit: README.md'),
      park('T-011', 19, 'implement unit 19: out-of-scope edit: README.md; gate red', '2026-11-17T12:00:00.000Z'),
    ];
    const [candidate, ...rest] = findCandidates({ ...none, handoffs });
    assert.equal(rest.length, 0, 'gate red parked one task only: no candidate');
    assert.equal(candidate?.key, 'park:out-of-scope edit:README.md');
    assert.equal(candidate?.kind, 'repeat-park');
    assert.deepEqual(candidate?.tasks, ['T-004', 'T-011']);
    assert.equal(candidate?.newest, '2026-11-17T12:00:00.000Z');
    assert.match(candidate?.draft ?? '', /README\.md/);
  });

  test('repeat-park: one task parked twice is not a pattern', () => {
    const handoffs = [
      park('T-004', 7, 'implement unit 7: stray file: x.txt'),
      park('T-004', 9, 'implement unit 9: stray file: x.txt'),
    ];
    assert.deepEqual(findCandidates({ ...none, handoffs }), []);
  });

  test('normalization strips ids, units, hashes and timestamps', () => {
    assert.equal(
      normalizeReason('main checkout: T-012 unit 33 moved 3f2a9c1 at 2026-11-17T10:00:00.000Z'),
      'main checkout: T-NNN unit N moved <sha> at <time>',
    );
  });

  test('denied-tool: a tool refused in three units', () => {
    const unit = (n: number, denials: string[]): UnitRecord => ({
      at: `2026-11-1${n}T10:00:00.000Z`,
      task: `T-00${n}`,
      stage: 'implement',
      unit: n,
      exit: 0,
      startedAt: null,
      durationMs: 1000,
      usage: { permissionDenials: denials },
    });
    const units = [unit(1, ['Bash']), unit(2, ['Bash', 'WebFetch']), unit(3, ['Bash'])];
    const candidates = findCandidates({ ...none, units });
    assert.equal(DENIED_UNITS, 3);
    assert.deepEqual(
      candidates.map((candidate) => candidate.key),
      ['deny:Bash'],
    );
    assert.equal(candidates[0]?.evidence.length, 3);
  });

  test('bounce: one task sent back twice by the same verdict', () => {
    const review = (task: string, unit: number, to: string): HandoffRecord => ({
      at: `2026-11-17T1${unit}:00:00.000Z`,
      task,
      stage: 'judge',
      unit,
      from: 'judge',
      to,
      exit: 0,
      verdict: 'REJECTED',
    });
    assert.equal(BOUNCES, 2);
    const once = findCandidates({
      ...none,
      handoffs: [review('T-001', 1, 'implementing'), review('T-002', 2, 'implementing')],
    });
    assert.deepEqual(once, [], 'two tasks bounced once each: no candidate');
    const twice = findCandidates({
      ...none,
      handoffs: [review('T-001', 1, 'implementing'), review('T-001', 3, 'parked')],
    });
    assert.equal(twice[0]?.key, 'bounce:judge:REJECTED');
    assert.deepEqual(twice[0]?.tasks, ['T-001']);
  });

  test('journal: one candidate per note after the header', () => {
    const journal =
      '# Journal\n\nNotes agents leave for the next unit.\n\n- T-003: the list sorts by date in two places\n  (lib and page).\n- Prefer the existing helper.\n';
    assert.deepEqual(journalNotes(journal), [
      'T-003: the list sorts by date in two places (lib and page).',
      'Prefer the existing helper.',
    ]);
    const candidates = findCandidates({ ...none, journal });
    assert.equal(candidates.length, 2);
    assert.ok(candidates.every((candidate) => candidate.kind === 'journal' && candidate.key.startsWith('journal:')));
    assert.deepEqual(candidates.find((candidate) => candidate.draft.startsWith('T-003'))?.tasks, ['T-003']);
    assert.deepEqual(findCandidates({ ...none, journal: '# Journal\n\nNotes agents leave for the next unit.\n' }), []);
  });

  test('a decided key is not proposed again', () => {
    const handoffs = [
      park('T-001', 1, 'implement unit 1: stray file: a.txt'),
      park('T-002', 2, 'implement unit 2: stray file: a.txt'),
    ];
    assert.equal(findCandidates({ ...none, handoffs }).length, 1);
    assert.equal(findCandidates({ ...none, handoffs, decided: new Set(['park:stray file:a.txt']) }).length, 0);
  });
});

describe('LESSONS.md', () => {
  test('parse and serialize round-trip; rejected entries carry no text', () => {
    const entries = [
      {
        id: 'L-001',
        status: 'applied' as const,
        date: '2026-11-17',
        key: 'deny:Bash',
        text: 'Do not call Bash.\nUse Read.',
      },
      { id: 'L-002', status: 'rejected' as const, date: '2026-11-17', key: 'journal:abc', text: '' },
    ];
    assert.deepEqual(parseLessons(serializeLessons(entries)), entries);
  });

  test('apply → Memory; reject blocks; withdraw leaves Memory and brings the candidate back', () => {
    const sandbox = makeSandbox();
    try {
      const paths = tracePaths(sandbox.project);
      appendHandoff(paths, { ...park('T-001', 1, 'implement unit 1: stray file: notes.txt') });
      appendHandoff(paths, { ...park('T-002', 2, 'implement unit 2: stray file: notes.txt') });
      writeFileSync(
        paths.journal,
        '# Journal\n\nNotes agents leave for the next unit.\n\n- Keep notes in the task Log.\n',
      );
      const view = lessonsView(sandbox.project);
      assert.deepEqual(
        view.candidates.map((candidate) => candidate.kind),
        ['repeat-park', 'journal'],
      );
      assert.equal(existsSync(join(sandbox.project, LESSONS_FILE)), false, 'made only at the first decision');
      assert.throws(() => applyLesson(sandbox.project, 'park:stray file:notes.txt', '  '), LessonError);
      assert.throws(() => applyLesson(sandbox.project, 'park:nothing', 'x'), LessonError);

      const applied = applyLesson(
        sandbox.project,
        'park:stray file:notes.txt',
        'Write no new files outside the scope.',
      );
      const journalKey = view.candidates.find((candidate) => candidate.kind === 'journal')?.key ?? '';
      rejectLesson(sandbox.project, journalKey);
      assert.equal(applied.id, 'L-001');
      assert.deepEqual(lessonsView(sandbox.project).candidates, []);
      assert.deepEqual(appliedRules(sandbox.project), [{ id: 'L-001', text: 'Write no new files outside the scope.' }]);

      const id = seedTask(sandbox, { status: 'spec' });
      const memory = () => buildMemory(sandbox.project, paths, sandbox.task(id).fields, 'spec', 'main');
      assert.match(memory(), /### Lessons \(\.harness\/LESSONS\.md\)\n- L-001: Write no new files outside the scope\./);
      assert.ok(memory().indexOf('### Lessons') < memory().indexOf('### Journal'), 'lessons come before the journal');
      assert.ok(!memory().includes('journal:'), 'no keys and no rejected entries in Memory');

      withdrawLesson(sandbox.project, 'L-001');
      assert.ok(!memory().includes('### Lessons'));
      assert.deepEqual(
        lessonsView(sandbox.project).candidates.map((candidate) => candidate.key),
        ['park:stray file:notes.txt'],
      );
      assert.match(readFileSync(join(sandbox.project, LESSONS_FILE), 'utf8'), /## L-001 · withdrawn ·/);
      assert.throws(() => withdrawLesson(sandbox.project, 'L-001'), LessonError);
    } finally {
      sandbox.cleanup();
    }
  });

  test('a decision written meanwhile is not a unit scope violation', () => {
    const sandbox = makeSandbox();
    try {
      const paths = tracePaths(sandbox.project);
      appendHandoff(paths, { ...park('T-001', 1, 'implement unit 1: stray file: a.txt') });
      appendHandoff(paths, { ...park('T-002', 2, 'implement unit 2: stray file: a.txt') });
      const before = snapshot(sandbox.project);
      applyLesson(sandbox.project, 'park:stray file:a.txt', 'No stray files.');
      const rules = { branch: 'main', allowed: [], harnessAllowed: [] };
      assert.deepEqual(judgeScope(sandbox.project, before, rules).violations, []);
      // The same file written by anything else is still a violation.
      writeFileSync(join(sandbox.project, LESSONS_FILE), '# Lessons\n\nforged\n');
      assert.deepEqual(judgeScope(sandbox.project, before, rules).violations, [`loop-owned file: ${LESSONS_FILE}`]);
    } finally {
      sandbox.cleanup();
    }
  });
});
