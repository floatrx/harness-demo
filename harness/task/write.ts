// Owned writes. Each role may write only its own sections and fields; the dashboard and the CLI write
// through the human actions below, which go through HUMAN_TRANSITIONS.

import {
  type TaskDoc,
  cloneDoc,
  getField,
  getSection,
  normalizeBody,
  parseQuestions,
  putSection,
  reviewBlock,
  setField,
} from './parse.ts';
import { taskFields } from './task.ts';
import {
  type Kind,
  type Status,
  type TransitionContext,
  DEFAULT_CONTEXT,
  KINDS,
  findTransition,
} from './transitions.ts';

export const ROLES = ['human', 'writer', 'planner', 'designer', 'implementer', 'qa', 'judge', 'runner'] as const;
export type Role = (typeof ROLES)[number];

/** Who may write each `##` section. `runner` may write anything. */
export const SECTION_OWNERS: Record<string, readonly Role[]> = {
  Draft: ['human'],
  Spec: ['writer'],
  // Agents append questions; a human only answers them (answerQuestion).
  Questions: ['writer', 'planner'],
  Plan: ['planner'],
  // The designer owns Prototype except its `### Review` block, which is human-owned (addReview).
  Prototype: ['designer'],
  'Acceptance criteria': ['writer', 'planner'],
  Log: ['runner'],
};

/** Frontmatter fields an agent role may change in its own unit. */
export const FIELD_OWNERS: Partial<Record<Role, readonly string[]>> = {
  writer: ['status', 'resume', 'kind'],
  planner: ['status', 'resume', 'kind', 'scope', 'gate'],
  human: ['title', 'kind'],
};

export class OwnershipError extends Error {
  override name = 'OwnershipError';
}

export function ownsSection(role: Role, section: string): boolean {
  return role === 'runner' || (SECTION_OWNERS[section] ?? []).includes(role);
}

export function writeSection(doc: TaskDoc, role: Role, section: string, content: string): void {
  if (!ownsSection(role, section)) throw new OwnershipError(`${role} may not write ## ${section}`);
  let body = normalizeBody(content);
  if (section === 'Prototype' && role !== 'runner') {
    // Keep the human-owned review block whatever the designer writes.
    const review = reviewBlock(getSection(doc, 'Prototype'));
    body = normalizeBody(`${body.replace(/^### Review[\s\S]*$/m, '')}\n${review}`);
  }
  putSection(doc, section, body);
}

export function appendToSection(doc: TaskDoc, role: Role, section: string, lines: string): void {
  const current = getSection(doc, section) ?? '';
  writeSection(doc, role, section, `${current.replace(/\s+$/, '')}\n${lines}`);
}

/** Every way `role` changed `after` relative to `before` that it does not own. Empty = clean. */
export function taskWriteViolations(before: TaskDoc, after: TaskDoc, role: Role): string[] {
  if (role === 'runner') return [];
  const violations: string[] = [];
  if (before.preamble !== after.preamble) violations.push('changed the text above the first section');
  const names = new Set([...before.sections, ...after.sections].map((section) => section.name));
  for (const name of names) {
    const a = getSection(before, name);
    const b = getSection(after, name);
    if (a === b) continue;
    if (!ownsSection(role, name)) violations.push(`wrote ## ${name}`);
    else if (name === 'Prototype' && reviewBlock(a) !== reviewBlock(b)) violations.push('wrote ### Review');
    else if (name === 'Questions') {
      const answered = parseQuestions(a).filter((question) => question.state === 'answered');
      const now = parseQuestions(b);
      for (const question of answered) {
        const same = now.find((item) => item.id === question.id);
        if (!same || same.answer !== question.answer) violations.push(`changed the answer to ${question.id}`);
      }
    }
  }
  const allowed = FIELD_OWNERS[role] ?? [];
  const keys = new Set([...before.entries, ...after.entries].flatMap((entry) => (entry.key ? [entry.key] : [])));
  for (const key of keys) {
    const a = JSON.stringify(getField(before, key));
    const b = JSON.stringify(getField(after, key));
    if (a === b) continue;
    if (!allowed.includes(key)) violations.push(`changed frontmatter \`${key}\``);
    else if (key === 'status' && getField(after, 'status') !== 'needs-input')
      violations.push(`set status to ${String(getField(after, 'status'))} (an agent may only ask: needs-input)`);
  }
  return violations;
}

// ---- log ------------------------------------------------------------------

export function stamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function appendLog(doc: TaskDoc, line: string, date = new Date()): void {
  appendToSection(doc, 'runner', 'Log', `- ${stamp(date)} ${line}`);
}

/** Sets status and logs the move. The caller has already checked the transition. */
export function moveTo(doc: TaskDoc, target: Status, who: string, date = new Date()): void {
  const from = String(getField(doc, 'status'));
  setField(doc, 'status', target);
  appendLog(doc, `${from} → ${target} · ${who}`, date);
}

// ---- human actions ----------------------------------------------------------

export class TransitionError extends Error {
  override name = 'TransitionError';
}

function human(doc: TaskDoc, action: string, ctx: TransitionContext): Status {
  const fields = taskFields(doc);
  const found = findTransition(fields, 'human', action, ctx);
  if (!found) throw new TransitionError(`${action} is not allowed from ${fields.status}`);
  return found.target;
}

export interface NewTask {
  id: string;
  title: string;
  draft: string;
  kind?: Kind;
  date?: Date;
}

export function createTask(input: NewTask): TaskDoc {
  const date = input.date ?? new Date();
  const doc: TaskDoc = { entries: [], preamble: '\n', sections: [] };
  setField(doc, 'id', input.id);
  setField(doc, 'title', input.title);
  setField(doc, 'status', 'draft');
  setField(doc, 'kind', input.kind ?? null);
  setField(doc, 'bounces', 0);
  setField(doc, 'created', stamp(date).slice(0, 10));
  writeSection(doc, 'human', 'Draft', input.draft);
  appendLog(doc, 'created · human', date);
  return doc;
}

export function submit(doc: TaskDoc, ctx = DEFAULT_CONTEXT): TaskDoc {
  const next = cloneDoc(doc);
  moveTo(next, human(next, 'submit', ctx), 'human');
  return next;
}

export function approve(doc: TaskDoc, ctx = DEFAULT_CONTEXT): TaskDoc {
  const next = cloneDoc(doc);
  const target = human(next, 'approve', ctx);
  if (target === 'prototype') setField(next, 'prototype', 'drafting');
  moveTo(next, target, 'human');
  return next;
}

export function addReview(doc: TaskDoc, entry: string, date = new Date()): void {
  const body = getSection(doc, 'Prototype') ?? '';
  const review = reviewBlock(body);
  const head = body.slice(0, body.length - review.length).replace(/\s+$/, '');
  const block = review ? `${review.replace(/\s+$/, '')}\n` : '### Review\n';
  putSection(doc, 'Prototype', normalizeBody(`${head}\n\n${block}- ${stamp(date)} · 👤 ${entry}`));
}

export function accept(doc: TaskDoc, ctx = DEFAULT_CONTEXT): TaskDoc {
  const next = cloneDoc(doc);
  const target = human(next, 'accept', ctx);
  addReview(next, 'accepted');
  setField(next, 'prototype', null);
  moveTo(next, target, 'human');
  return next;
}

/** Counts human comments in the review block — the round counter for `limits.prototypeRounds`. */
export function prototypeRounds(doc: TaskDoc): number {
  return (reviewBlock(getSection(doc, 'Prototype')).match(/· 👤 comment:/g) ?? []).length;
}

export function comment(doc: TaskDoc, text: string, maxRounds: number, ctx = DEFAULT_CONTEXT): TaskDoc {
  const next = cloneDoc(doc);
  human(next, 'comment', ctx);
  if (prototypeRounds(next) >= maxRounds)
    throw new TransitionError(`prototype round cap reached (${maxRounds}): accept it or edit the plan`);
  addReview(next, `comment: ${text.replace(/\s+/g, ' ').trim()}`);
  setField(next, 'prototype', 'drafting');
  appendLog(next, 'prototype review → drafting · human');
  return next;
}

export function answerQuestion(doc: TaskDoc, id: string, letter: string, note = ''): TaskDoc {
  const next = cloneDoc(doc);
  const body = getSection(next, 'Questions');
  const question = parseQuestions(body).find((item) => item.id === id);
  if (!body || !question) throw new TransitionError(`no question ${id}`);
  if (question.state !== 'open') throw new TransitionError(`${id} is already answered`);
  if (!question.options.some((option) => option.letter === letter))
    throw new TransitionError(`${id} has no option (${letter})`);
  const lines = body.split('\n');
  const head = lines.findIndex((line) => line.startsWith(`### ${id} · `));
  lines[head] = (lines[head] as string).replace(/ · open\s*$/, ' · answered');
  let end = lines.findIndex((line, index) => index > head && line.startsWith('### '));
  if (end === -1) end = lines.length;
  const answer = `> **Answer:** (${letter})${note.trim() ? ` — ${note.trim()}` : ''}`;
  const at = lines.findIndex((line, index) => index > head && index < end && line.startsWith('> **Answer:**'));
  if (at === -1) {
    let last = end - 1;
    while (last > head && (lines[last] as string).trim() === '') last--;
    lines.splice(last + 1, 0, answer);
  } else {
    lines[at] = answer;
  }
  putSection(next, 'Questions', normalizeBody(lines.join('\n')));
  appendLog(next, `answered ${id} (${letter}) · human`);
  return next;
}

export function reopen(doc: TaskDoc, ctx = DEFAULT_CONTEXT): TaskDoc {
  const next = cloneDoc(doc);
  const target = human(next, 'reopen', ctx);
  setField(next, 'parked', null);
  setField(next, 'parkedFrom', null);
  // A reopened task gets a fresh bounce budget; otherwise it would park on its first rejection.
  setField(next, 'bounces', 0);
  moveTo(next, target, 'human');
  return next;
}

export function setKind(doc: TaskDoc, kind: Kind): TaskDoc {
  if (!KINDS.includes(kind)) throw new TransitionError(`unknown kind ${kind}`);
  const next = cloneDoc(doc);
  setField(next, 'kind', kind);
  return next;
}
