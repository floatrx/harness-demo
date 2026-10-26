import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  getField,
  getSection,
  openQuestions,
  parseCriteria,
  parseQuestions,
  parseTask,
  serializeTask,
  setField,
} from './parse.ts';
import { taskFields } from './task.ts';
import {
  AGENT_TRANSITIONS,
  HUMAN_TRANSITIONS,
  STATUSES,
  type TransitionTask,
  canTransition,
  findTransition,
  humanTargets,
} from './transitions.ts';
import { validateTask } from './validate.ts';
import {
  OwnershipError,
  TransitionError,
  accept,
  answerQuestion,
  approve,
  comment,
  createTask,
  reopen,
  submit,
  taskWriteViolations,
  writeSection,
} from './write.ts';

const fixture = readFileSync(new URL('./fixtures/T-007.md', import.meta.url), 'utf8');

describe('parse / write', () => {
  test('round-trips the fixture byte for byte', () => {
    assert.equal(serializeTask(parseTask(fixture)), fixture);
  });

  test('a prettier-formatted task (blank line after every heading) parses the same and round-trips', () => {
    const pretty = readFileSync(new URL('./fixtures/T-008-prettier.md', import.meta.url), 'utf8');
    assert.equal(serializeTask(parseTask(pretty)), pretty);
    const doc = parseTask(pretty);
    assert.deepEqual(taskFields(doc), taskFields(parseTask(fixture)));
    assert.equal(parseCriteria(getSection(doc, 'Acceptance criteria')).length, 3);
    assert.equal(parseQuestions(getSection(doc, 'Questions'))[0]?.options.length, 3);
    const answered = answerQuestion(doc, 'Q1', 'b');
    assert.match(getSection(answered, 'Questions') ?? '', /> \*\*Answer:\*\* \(b\)/);
    assert.equal(openQuestions(answered).length, 0);
  });

  test('parse → write → parse is structurally stable after an edit', () => {
    const doc = parseTask(fixture);
    setField(doc, 'bounces', 1);
    const again = parseTask(serializeTask(doc));
    assert.deepEqual(taskFields(again), taskFields(doc));
    assert.equal(serializeTask(again), serializeTask(doc));
  });

  test('an edit rewrites only its own line and keeps the comment', () => {
    const doc = parseTask(fixture);
    setField(doc, 'bounces', 2);
    const out = serializeTask(doc);
    assert.match(out, /^bounces: 2 # QA FAIL \+ judge REJECTED, shared counter$/m);
    const changed = out.split('\n').filter((line, i) => line !== fixture.split('\n')[i]);
    assert.equal(changed.length, 1);
  });

  test('reads typed fields', () => {
    const fields = taskFields(parseTask(fixture));
    assert.equal(fields.status, 'needs-input');
    assert.equal(fields.kind, 'ui');
    assert.deepEqual(fields.scope, ['src/components/header/**', 'src/app/globals.css']);
    assert.equal(fields.gate, 'pnpm exec tsc -b && pnpm lint');
    assert.equal(fields.created, '2026-10-25');
    assert.equal(fields.openQuestions, 1);
  });

  test('a `##` inside a code fence is not a section', () => {
    const doc = parseTask(fixture);
    assert.deepEqual(
      doc.sections.map((section) => section.name),
      ['Draft', 'Spec', 'Questions', 'Plan', 'Prototype', 'Acceptance criteria', 'Log'],
    );
    assert.match(getSection(doc, 'Plan') ?? '', /Not a section/);
  });

  test('strings that look like other types are quoted', () => {
    const doc = parseTask('---\nid: T-001\n---\n');
    setField(doc, 'title', 'true');
    setField(doc, 'gate', 'echo a: b # not a comment');
    setField(doc, 'scope', []);
    const again = parseTask(serializeTask(doc));
    assert.equal(getField(again, 'title'), 'true');
    assert.equal(getField(again, 'gate'), 'echo a: b # not a comment');
    assert.deepEqual(getField(again, 'scope'), []);
  });

  test('parses questions and criteria', () => {
    const doc = parseTask(fixture);
    const [q1] = parseQuestions(getSection(doc, 'Questions'));
    assert.equal(q1?.id, 'Q1');
    assert.equal(q1?.options.length, 3);
    const criteria = parseCriteria(getSection(doc, 'Acceptance criteria'));
    assert.deepEqual(
      criteria.map((criterion) => [criterion.tag, criterion.command]),
      [
        ['closes', 'node -e "process.exit(0)"'],
        ['found', null],
        ['process', null],
      ],
    );
  });

  test('criteria tags are read with or without the bold (a real writer drops it)', () => {
    const criteria = parseCriteria(
      '1. [found] reads nicer\n2. [closes] only these files: `git diff --name-only main`\n3. **[process]** sign-off',
    );
    assert.deepEqual(
      criteria.map((criterion) => [criterion.tag, criterion.command]),
      [
        ['found', null],
        ['closes', 'git diff --name-only main'],
        ['process', null],
      ],
    );
  });

  test('rejects a file without frontmatter', () => {
    assert.throws(() => parseTask('# no frontmatter\n'));
  });
});

describe('owned sections', () => {
  test('a role writes only its own section', () => {
    const doc = parseTask(fixture);
    writeSection(doc, 'writer', 'Spec', 'New spec.');
    assert.equal(getSection(doc, 'Spec'), 'New spec.\n');
    assert.throws(() => writeSection(doc, 'writer', 'Plan', 'nope'), OwnershipError);
    assert.throws(() => writeSection(doc, 'implementer', 'Draft', 'nope'), OwnershipError);
  });

  test('the designer cannot overwrite the human review block', () => {
    const doc = parseTask(fixture);
    writeSection(doc, 'designer', 'Prototype', 'Round 2 at /prototypes/T-007.');
    const body = getSection(doc, 'Prototype') ?? '';
    assert.match(body, /^Round 2/);
    assert.match(body, /### Review\n- 2026-10-25 11:40 · 👤 comment/);
  });

  test('a new section lands in canonical order', () => {
    const doc = createTask({ id: 'T-001', title: 'X', draft: 'Draft text.' });
    writeSection(doc, 'planner', 'Plan', 'The plan.');
    writeSection(doc, 'writer', 'Spec', 'The spec.');
    assert.deepEqual(
      doc.sections.map((section) => section.name),
      ['Draft', 'Spec', 'Plan', 'Log'],
    );
    const text = serializeTask(doc);
    assert.match(text, /## Draft\nDraft text\.\n\n## Spec\nThe spec\.\n\n## Plan\nThe plan\.\n\n## Log\n/);
  });

  test('taskWriteViolations flags foreign sections and fields', () => {
    const before = parseTask(fixture);
    const after = parseTask(fixture);
    writeSection(after, 'runner', 'Draft', 'rewritten');
    setField(after, 'bounces', 0);
    setField(after, 'branch', 'main');
    assert.deepEqual(taskWriteViolations(before, after, 'planner'), ['wrote ## Draft', 'changed frontmatter `branch`']);
    const ask = parseTask(fixture);
    setField(ask, 'scope', ['src/x.ts']);
    assert.deepEqual(taskWriteViolations(before, ask, 'planner'), []);
    const promote = parseTask(fixture);
    setField(promote, 'status', 'done');
    assert.equal(taskWriteViolations(before, promote, 'planner').length, 1);
  });
});

const base: TransitionTask = {
  status: 'draft',
  kind: 'logic',
  resume: null,
  prototype: null,
  parkedFrom: null,
  bounces: 0,
  openQuestions: 0,
};

describe('transitions', () => {
  test('every status appears in the table', () => {
    const seen = new Set<string>();
    for (const transition of [...HUMAN_TRANSITIONS, ...AGENT_TRANSITIONS]) {
      if (transition.from !== '*') seen.add(transition.from);
    }
    const terminal = ['delivered'];
    assert.deepEqual(
      STATUSES.filter((status) => !seen.has(status) && !terminal.includes(status)),
      [],
    );
    assert.equal(STATUSES.length, 13);
  });

  test('human and agent sets are disjoint in what they allow', () => {
    assert.equal(canTransition({ ...base, status: 'spec' }, 'plan', 'human'), false);
    assert.equal(canTransition({ ...base, status: 'spec' }, 'plan', 'agent'), true);
    assert.equal(canTransition({ ...base, status: 'draft' }, 'spec', 'agent'), false);
    assert.equal(canTransition({ ...base, status: 'draft' }, 'spec', 'human'), true);
  });

  test('planned goes to prototype for ui, ready otherwise; full autonomy skips the human', () => {
    assert.deepEqual(humanTargets({ ...base, status: 'planned' }), ['ready']);
    assert.deepEqual(humanTargets({ ...base, status: 'planned', kind: 'ui' }), ['prototype']);
    const ctx = { autonomy: 'full' as const, mergeQaJudge: false, bounceCap: 2, deliverPr: false };
    assert.equal(findTransition({ ...base, status: 'planned' }, 'agent', 'auto-approve')?.target, undefined);
    assert.equal(findTransition({ ...base, status: 'planned' }, 'agent', 'auto-approve', ctx)?.target, 'ready');
  });

  test('prototype accept and comment need review', () => {
    const drafting = { ...base, status: 'prototype' as const, kind: 'ui' as const, prototype: 'drafting' as const };
    assert.deepEqual(humanTargets(drafting), []);
    assert.deepEqual(humanTargets({ ...drafting, prototype: 'review' }), ['ready']);
    assert.ok(findTransition({ ...drafting, prototype: 'review' }, 'human', 'comment'));
  });

  test('the bounce cap parks the rejection that reaches it', () => {
    const qa = { ...base, status: 'qa' as const };
    assert.equal(findTransition(qa, 'agent', 'qa-fail')?.target, 'implementing');
    assert.equal(findTransition({ ...qa, status: 'judge', bounces: 1 }, 'agent', 'rejected')?.target, 'parked');
  });

  test('needs-input returns to resume only when no question is open', () => {
    const waiting = { ...base, status: 'needs-input' as const, resume: 'plan' as const, openQuestions: 1 };
    assert.equal(findTransition(waiting, 'agent', 'answered'), null);
    assert.equal(findTransition({ ...waiting, openQuestions: 0 }, 'agent', 'answered')?.target, 'plan');
  });

  test('reopen returns to parkedFrom', () => {
    assert.deepEqual(humanTargets({ ...base, status: 'parked', parkedFrom: 'qa' }), ['qa']);
    assert.deepEqual(humanTargets({ ...base, status: 'parked' }), []);
  });
});

describe('human actions', () => {
  test('submit → approve → accept/comment → reopen', () => {
    let doc = createTask({ id: 'T-001', title: 'Toggle', draft: 'A toggle.', kind: 'ui' });
    doc = submit(doc);
    assert.equal(getField(doc, 'status'), 'spec');
    assert.throws(() => submit(doc), TransitionError);
    setField(doc, 'status', 'planned');
    doc = approve(doc);
    assert.equal(getField(doc, 'status'), 'prototype');
    assert.equal(getField(doc, 'prototype'), 'drafting');
    assert.throws(() => accept(doc), TransitionError);
    setField(doc, 'prototype', 'review');
    doc = comment(doc, 'move it left', 3);
    assert.equal(getField(doc, 'prototype'), 'drafting');
    setField(doc, 'prototype', 'review');
    doc = accept(doc);
    assert.equal(getField(doc, 'status'), 'ready');
    assert.match(getSection(doc, 'Prototype') ?? '', /👤 comment: move it left\n- .* · 👤 accepted/);
    setField(doc, 'status', 'parked');
    setField(doc, 'parkedFrom', 'qa');
    setField(doc, 'parked', 'scope');
    doc = reopen(doc);
    assert.equal(getField(doc, 'status'), 'qa');
    assert.equal(getField(doc, 'parked'), null);
  });

  test('the prototype round cap refuses one comment too many', () => {
    let doc = createTask({ id: 'T-001', title: 'Toggle', draft: 'A toggle.', kind: 'ui' });
    setField(doc, 'status', 'prototype');
    setField(doc, 'prototype', 'review');
    doc = comment(doc, 'one', 1);
    setField(doc, 'prototype', 'review');
    assert.throws(() => comment(doc, 'two', 1), /round cap/);
  });

  test('answering a question closes it', () => {
    const doc = answerQuestion(parseTask(fixture), 'Q1', 'a', 'keep it simple');
    assert.equal(openQuestions(doc).length, 0);
    assert.match(
      getSection(doc, 'Questions') ?? '',
      /### Q1 · .* · answered\n[\s\S]*> \*\*Answer:\*\* \(a\) — keep it simple/,
    );
    assert.throws(() => answerQuestion(doc, 'Q1', 'a'), /already answered/);
    assert.throws(() => answerQuestion(parseTask(fixture), 'Q1', 'z'), /no option/);
  });
});

describe('validate', () => {
  test('the fixture is valid', () => {
    assert.deepEqual(validateTask(parseTask(fixture)), []);
  });

  test('unknown status', () => {
    const doc = parseTask(fixture);
    setField(doc, 'status', 'wip');
    assert.deepEqual(
      validateTask(doc).map((issue) => issue.field),
      ['status'],
    );
  });

  test('missing scope from ready on', () => {
    const doc = parseTask(fixture);
    setField(doc, 'status', 'ready');
    setField(doc, 'scope', []);
    writeSection(doc, 'runner', 'Questions', '');
    assert.ok(validateTask(doc).some((issue) => issue.field === 'scope'));
  });

  test('[closes] without a command', () => {
    const doc = parseTask(fixture);
    writeSection(doc, 'planner', 'Acceptance criteria', '1. **[closes]** it works');
    assert.ok(validateTask(doc).some((issue) => /without a `command`/.test(issue.message)));
  });

  test('parked needs the reason and parkedFrom; needs-input needs resume', () => {
    const doc = parseTask(fixture);
    setField(doc, 'status', 'parked');
    assert.deepEqual(
      validateTask(doc).map((issue) => issue.field),
      ['parked', 'parkedFrom'],
    );
    setField(doc, 'status', 'needs-input');
    setField(doc, 'resume', null);
    assert.deepEqual(
      validateTask(doc).map((issue) => issue.field),
      ['resume'],
    );
  });

  test('a too-wide or escaping scope', () => {
    const doc = parseTask(fixture);
    setField(doc, 'scope', ['**', '../x']);
    assert.equal(validateTask(doc).filter((issue) => issue.field === 'scope').length, 2);
  });
});
