// Typed view over a TaskDoc plus file I/O. Writes are atomic (temp file + rename).

import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type TaskDoc, getField, openQuestions, parseTask, serializeTask } from './parse.ts';
import {
  type Kind,
  type PrototypeState,
  type Status,
  type TransitionTask,
  KINDS,
  PROTOTYPE_STATES,
  isStatus,
} from './transitions.ts';

export interface TaskFields extends TransitionTask {
  id: string;
  title: string;
  scope: string[];
  gate: string | null;
  branch: string | null;
  parked: string | null;
  created: string | null;
}

const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export function taskFields(doc: TaskDoc): TaskFields {
  const status = getField(doc, 'status');
  const kind = getField(doc, 'kind');
  const resume = getField(doc, 'resume');
  const prototype = getField(doc, 'prototype');
  const parkedFrom = getField(doc, 'parkedFrom');
  const scope = getField(doc, 'scope');
  const bounces = getField(doc, 'bounces');
  return {
    id: str(getField(doc, 'id')) ?? '',
    title: str(getField(doc, 'title')) ?? '',
    // An unknown status is reported by validate(); the view keeps the raw value out of the union.
    status: (isStatus(status) ? status : 'draft') as Status,
    kind: (KINDS as readonly unknown[]).includes(kind) ? (kind as Kind) : null,
    resume: isStatus(resume) ? resume : null,
    prototype: (PROTOTYPE_STATES as readonly unknown[]).includes(prototype) ? (prototype as PrototypeState) : null,
    parkedFrom: isStatus(parkedFrom) ? parkedFrom : null,
    bounces: typeof bounces === 'number' ? bounces : 0,
    openQuestions: openQuestions(doc).length,
    scope: Array.isArray(scope) ? scope : [],
    gate: str(getField(doc, 'gate')),
    branch: str(getField(doc, 'branch')),
    parked: str(getField(doc, 'parked')),
    created: str(getField(doc, 'created')),
  };
}

export interface LoadedTask {
  path: string;
  doc: TaskDoc;
  fields: TaskFields;
}

export function loadTask(path: string): LoadedTask {
  const doc = parseTask(readFileSync(path, 'utf8'));
  return { path, doc, fields: taskFields(doc) };
}

export function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function saveTask(path: string, doc: TaskDoc): void {
  atomicWrite(path, serializeTask(doc));
}

export const TASK_FILE = /^T-\d{3,}\.md$/;

export function listTaskFiles(tasksDir: string): string[] {
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir)
    .filter((name) => TASK_FILE.test(name))
    .sort((a, b) => taskNumber(a) - taskNumber(b))
    .map((name) => join(tasksDir, name));
}

export function taskNumber(idOrFile: string): number {
  return Number(/T-(\d+)/.exec(basename(idOrFile))?.[1] ?? Number.NaN);
}

export function nextTaskId(tasksDir: string): string {
  const max = listTaskFiles(tasksDir).reduce((top, file) => Math.max(top, taskNumber(file)), 0);
  return `T-${String(max + 1).padStart(3, '0')}`;
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .split(/[\s_-]+/)
      .slice(0, 5)
      .join('-') || 'task'
  );
}
