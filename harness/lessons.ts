// Lessons: what the loop should remember. Every unit starts in a fresh context, so the same mistake can happen twice.
// This module finds lesson candidates in evidence the loop already keeps — repeated parks, a tool denied again and
// again, a task bounced on the same verdict, the notes agents leave in the journal — and records a human's decision in
// `.harness/LESSONS.md`. Applied rules go, in full, into every unit's Memory (memory.ts).
//
// Candidates come from `handoffs.jsonl`, which is append-only: a reopen clears a task's `parked` and `bounces`, so the
// task file alone forgets the evidence. Thresholds are constants here on purpose (no config keys in v1).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type HandoffRecord, readHandoffs, tracePaths } from './paths.ts';
import { type UnitRecord, computeStats, listUnits } from './stats.ts';
import { saveRecordedFile } from './task/task.ts';

export const LESSONS_FILE = '.harness/LESSONS.md';
/** A park reason becomes a candidate when it stopped this many different tasks. */
export const PARK_TASKS = 2;
/** A tool becomes a candidate when the permission mode refused it in this many units. */
export const DENIED_UNITS = 3;
/** A review verdict becomes a candidate when it sent one task back this many times. */
export const BOUNCES = 2;

export const LESSON_KINDS = ['repeat-park', 'denied-tool', 'bounce', 'journal'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export interface Evidence {
  task: string | null;
  unit: number | null;
  at: string | null;
  line: string;
}

export interface Candidate {
  key: string;
  kind: LessonKind;
  summary: string;
  evidence: Evidence[];
  /** The tasks the evidence names, sorted. */
  tasks: string[];
  newest: string | null;
  /** A starting point for the rule; the human writes the final text. */
  draft: string;
}

export const LESSON_STATUSES = ['applied', 'rejected', 'withdrawn'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export interface LessonEntry {
  id: string;
  status: LessonStatus;
  date: string;
  key: string;
  /** The rule text; empty for a rejected entry. */
  text: string;
}

export class LessonError extends Error {
  override name = 'LessonError';
}

// ---- candidates -------------------------------------------------------------

/** Task ids, unit numbers, timestamps and hashes differ between two occurrences of one mistake: strip them. */
export function normalizeReason(text: string): string {
  return text
    .replace(/\b\d{4}-\d\d-\d\dT[\d:.]+Z?\b/g, '<time>')
    .replace(/\bT-\d{3,}\b/g, 'T-NNN')
    .replace(/\bunit \d+\b/g, 'unit N')
    .replace(/\b[0-9a-f]{7,40}\b/g, '<sha>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `implement unit 3: out-of-scope edit: README.md; gate red` → one item per violation, without the unit prefix. */
function parkItems(reason: string): string[] {
  return reason
    .replace(/^\w+ unit \d+: /, '')
    .split('; ')
    .map((item) => item.trim())
    .filter(Boolean);
}

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12);
const newestOf = (evidence: Evidence[]) =>
  evidence.reduce<string | null>((best, item) => (item.at && (!best || item.at > best) ? item.at : best), null);
const tasksOf = (evidence: Evidence[]) =>
  [...new Set(evidence.flatMap((item) => (item.task ? [item.task] : [])))].sort();

function repeatParks(handoffs: readonly HandoffRecord[]): Candidate[] {
  const groups = new Map<string, { contract: string; rest: string; evidence: Evidence[] }>();
  for (const handoff of handoffs) {
    if (handoff.to !== 'parked' || !handoff.reason) continue;
    for (const item of parkItems(handoff.reason)) {
      const normal = normalizeReason(item);
      const colon = normal.indexOf(':');
      const contract = colon < 0 ? normal : normal.slice(0, colon).trim();
      const rest = colon < 0 ? '' : normal.slice(colon + 1).trim();
      const key = `park:${contract}:${rest}`;
      const group = groups.get(key) ?? { contract, rest, evidence: [] };
      group.evidence.push({ task: handoff.task ?? null, unit: handoff.unit ?? null, at: handoff.at, line: item });
      groups.set(key, group);
    }
  }
  return [...groups.entries()].flatMap(([key, { contract, rest, evidence }]) => {
    const tasks = tasksOf(evidence);
    if (tasks.length < PARK_TASKS) return [];
    const what = rest ? `${contract}: ${rest}` : contract;
    return [
      {
        key,
        kind: 'repeat-park' as const,
        summary: `${tasks.length} tasks parked for “${what}”`,
        evidence,
        tasks,
        newest: newestOf(evidence),
        draft: `Do not finish a unit with “${what}”: the contracts parked ${tasks.length} tasks for it. Check it before you end the unit.`,
      },
    ];
  });
}

function deniedTools(units: readonly UnitRecord[]): Candidate[] {
  return computeStats(units, []).denials.flatMap((denial) => {
    if (denial.units.length < DENIED_UNITS) return [];
    const evidence = units
      .filter((unit) => denial.units.includes(unit.unit))
      .map((unit) => ({
        task: unit.task ?? null,
        unit: unit.unit,
        at: unit.at,
        line: `${unit.stage ?? '?'} unit ${unit.unit}: ${denial.tool} refused`,
      }));
    return [
      {
        key: `deny:${denial.tool}`,
        kind: 'denied-tool' as const,
        summary: `${denial.tool} refused in ${denial.units.length} units (${denial.count} calls)`,
        evidence,
        tasks: tasksOf(evidence),
        newest: newestOf(evidence),
        draft: `Do not call ${denial.tool}: the permission mode refused it in ${denial.units.length} units. Do the work with the tools you have, or ask a question.`,
      },
    ];
  });
}

/* A review unit that sent its task back to implementing, or parked it at the bounce cap. */
const isBounce = (handoff: HandoffRecord) =>
  (handoff.stage === 'qa' || handoff.stage === 'judge') &&
  typeof handoff.unit === 'number' &&
  /FAIL|REJECTED/.test(handoff.verdict ?? '') &&
  (handoff.to === 'implementing' || handoff.to === 'parked');

function bounces(handoffs: readonly HandoffRecord[]): Candidate[] {
  const groups = new Map<string, Evidence[]>();
  for (const handoff of handoffs.filter(isBounce)) {
    const key = `bounce:${handoff.stage}:${handoff.verdict}`;
    const evidence = groups.get(key) ?? [];
    evidence.push({
      task: handoff.task ?? null,
      unit: handoff.unit ?? null,
      at: handoff.at,
      line: `${handoff.stage} unit ${handoff.unit}: ${handoff.verdict} → ${handoff.to}`,
    });
    groups.set(key, evidence);
  }
  return [...groups.entries()].flatMap(([key, evidence]) => {
    const perTask = new Map<string, number>();
    for (const item of evidence) if (item.task) perTask.set(item.task, (perTask.get(item.task) ?? 0) + 1);
    if (![...perTask.values()].some((count) => count >= BOUNCES)) return [];
    const [, stage, verdict] = key.split(':');
    return [
      {
        key,
        kind: 'bounce' as const,
        summary: `${stage} said ${verdict} ${BOUNCES}+ times on one task`,
        evidence,
        tasks: tasksOf(evidence),
        newest: newestOf(evidence),
        draft: `Before you end an implement unit, run the task's [closes] commands yourself: ${stage} sent a task back with ${verdict} ${BOUNCES} times.`,
      },
    ];
  });
}

/** The notes after the journal's header: one per top-level bullet, or per paragraph. */
export function journalNotes(text: string): string[] {
  const notes: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const note = current.join(' ').replace(/\s+/g, ' ').trim();
    if (note) notes.push(note);
    current = [];
  };
  for (const line of text.split('\n')) {
    if (/^#/.test(line) || line.trim() === 'Notes agents leave for the next unit.') {
      flush();
      continue;
    }
    if (!line.trim()) flush();
    else if (/^[-*] /.test(line)) {
      flush();
      current.push(line.replace(/^[-*] /, ''));
    } else current.push(line.trim());
  }
  flush();
  return notes;
}

function journal(text: string): Candidate[] {
  return journalNotes(text).map((note) => ({
    key: `journal:${sha1(note)}`,
    kind: 'journal' as const,
    summary: note.length > 90 ? `${note.slice(0, 89)}…` : note,
    evidence: [{ task: /\bT-\d{3,}\b/.exec(note)?.[0] ?? null, unit: null, at: null, line: note }],
    tasks: [/\bT-\d{3,}\b/.exec(note)?.[0]].filter((task): task is string => !!task),
    newest: null,
    draft: note,
  }));
}

export interface CandidateInput {
  handoffs: readonly HandoffRecord[];
  units: readonly UnitRecord[];
  journal: string;
  /** Keys a human decided (applied or rejected): never proposed again. A withdrawn entry does not block its key. */
  decided: ReadonlySet<string>;
}

/** Every open candidate, newest evidence first (journal notes, which carry no date, last). */
export function findCandidates(input: CandidateInput): Candidate[] {
  return [
    ...repeatParks(input.handoffs),
    ...deniedTools(input.units),
    ...bounces(input.handoffs),
    ...journal(input.journal),
  ]
    .filter((candidate) => !input.decided.has(candidate.key))
    .sort((a, b) => (b.newest ?? '').localeCompare(a.newest ?? '') || a.key.localeCompare(b.key));
}

// ---- LESSONS.md ---------------------------------------------------------------

const HEADER =
  '# Lessons\n\nRules every unit reads in its Memory. Decided by a human (`harness lessons`, the Learning page).\n';
const ENTRY = /^## (L-\d{3,}) · (applied|rejected|withdrawn) · (\S+)$/;

export function parseLessons(text: string): LessonEntry[] {
  const entries: LessonEntry[] = [];
  let current: (LessonEntry & { lines: string[] }) | null = null;
  const close = () => {
    if (current) entries.push({ ...current, text: current.lines.join('\n').trim() });
  };
  for (const line of text.split('\n')) {
    const head = ENTRY.exec(line);
    if (head) {
      close();
      current = {
        id: head[1] as string,
        status: head[2] as LessonStatus,
        date: head[3] as string,
        key: '',
        text: '',
        lines: [],
      };
    } else if (current && !current.key && line.startsWith('key: ')) current.key = line.slice(5).trim();
    else if (current) current.lines.push(line);
  }
  close();
  return entries.map(({ id, status, date, key, text }) => ({ id, status, date, key, text }));
}

export function serializeLessons(entries: readonly LessonEntry[]): string {
  return (
    [
      HEADER,
      ...entries.map((entry) =>
        [`## ${entry.id} · ${entry.status} · ${entry.date}`, `key: ${entry.key}`, entry.text]
          .filter(Boolean)
          .join('\n'),
      ),
    ].join('\n') + '\n'
  );
}

export function readLessons(project: string): LessonEntry[] {
  const file = join(project, LESSONS_FILE);
  return existsSync(file) ? parseLessons(readFileSync(file, 'utf8')) : [];
}

/** The applied rule texts, oldest first: what every unit's Memory carries. */
export function appliedRules(project: string): { id: string; text: string }[] {
  return readLessons(project)
    .filter((entry) => entry.status === 'applied' && entry.text)
    .map(({ id, text }) => ({ id, text }));
}

export interface LessonsView {
  candidates: Candidate[];
  entries: LessonEntry[];
}

export function lessonsView(project: string): LessonsView {
  const entries = readLessons(project);
  const paths = tracePaths(project);
  const decided = new Set(entries.filter((entry) => entry.status !== 'withdrawn').map((entry) => entry.key));
  return {
    candidates: findCandidates({
      handoffs: readHandoffs(paths),
      units: listUnits(project),
      journal: existsSync(paths.journal) ? readFileSync(paths.journal, 'utf8') : '',
      decided,
    }),
    entries,
  };
}

const today = (now: Date) => now.toISOString().slice(0, 10);
const nextId = (entries: readonly LessonEntry[]) =>
  `L-${String(entries.reduce((max, entry) => Math.max(max, Number(entry.id.slice(2))), 0) + 1).padStart(3, '0')}`;

/* Ledger first, then the atomic write: a unit running meanwhile is not blamed for this file (scope.ts). */
function save(project: string, entries: readonly LessonEntry[]): void {
  saveRecordedFile(project, LESSONS_FILE, serializeLessons(entries), 'human');
}

function openCandidate(project: string, key: string): Candidate {
  const candidate = lessonsView(project).candidates.find((item) => item.key === key);
  if (!candidate) throw new LessonError(`no open candidate ${key}`);
  return candidate;
}

/** Records the human's rule for a candidate; returns the new entry. */
export function applyLesson(project: string, key: string, text: string, now = new Date()): LessonEntry {
  const rule = text.trim();
  if (!rule) throw new LessonError('a lesson needs its rule text');
  openCandidate(project, key);
  const entries = readLessons(project);
  const entry: LessonEntry = { id: nextId(entries), status: 'applied', date: today(now), key, text: rule };
  save(project, [...entries, entry]);
  return entry;
}

/** Blocks a candidate for good: it is never proposed again. */
export function rejectLesson(project: string, key: string, now = new Date()): LessonEntry {
  openCandidate(project, key);
  const entries = readLessons(project);
  const entry: LessonEntry = { id: nextId(entries), status: 'rejected', date: today(now), key, text: '' };
  save(project, [...entries, entry]);
  return entry;
}

/** Undo of an applied rule: it leaves Memory and stays in the file as history; its candidate may come back. */
export function withdrawLesson(project: string, id: string): LessonEntry {
  const entries = readLessons(project);
  const entry = entries.find((item) => item.id === id);
  if (!entry || entry.status !== 'applied') throw new LessonError(`no applied lesson ${id}`);
  const next = { ...entry, status: 'withdrawn' as const };
  save(
    project,
    entries.map((item) => (item.id === id ? next : item)),
  );
  return next;
}
