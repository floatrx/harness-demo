// Structural checks over a task. The runner refuses to act on a task with errors.

import { type TaskDoc, getField, getSection, openQuestions, parseCriteria } from './parse.ts';
import { KINDS, PROTOTYPE_STATES, RESUMABLE, SCOPED, isStatus } from './transitions.ts';

export interface Issue {
  field: string;
  message: string;
}

export function validateTask(doc: TaskDoc): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  const id = getField(doc, 'id');
  if (typeof id !== 'string' || !/^T-\d{3,}$/.test(id)) add('id', 'id must look like T-001');
  const title = getField(doc, 'title');
  if (typeof title !== 'string' || title.trim() === '') add('title', 'title is required');

  const status = getField(doc, 'status');
  if (!isStatus(status)) {
    add('status', `unknown status: ${String(status)}`);
    return issues;
  }

  const kind = getField(doc, 'kind');
  if (kind !== null && kind !== undefined && !(KINDS as readonly unknown[]).includes(kind))
    add('kind', `unknown kind: ${String(kind)} (one of ${KINDS.join(', ')})`);

  const bounces = getField(doc, 'bounces');
  if (bounces !== undefined && (typeof bounces !== 'number' || bounces < 0 || !Number.isInteger(bounces)))
    add('bounces', 'bounces must be a non-negative integer');

  const scope = getField(doc, 'scope');
  if (scope !== undefined && scope !== null && !Array.isArray(scope)) add('scope', 'scope must be a list of paths');
  if (SCOPED.includes(status) && (!Array.isArray(scope) || scope.length === 0))
    add('scope', `scope is mandatory from \`ready\` on (status is ${status})`);
  if (Array.isArray(scope)) {
    for (const path of scope) {
      if (path.startsWith('/') || path.split('/').includes('..'))
        add('scope', `scope path must stay in the project: ${path}`);
      if (path === '**' || path === '*' || path === '.') add('scope', `scope is too wide: ${path}`);
    }
  }

  if (status === 'needs-input') {
    const resume = getField(doc, 'resume');
    if (!(RESUMABLE as readonly unknown[]).includes(resume))
      add('resume', `needs-input needs resume: ${RESUMABLE.join(' | ')}`);
  }
  if (status === 'prototype') {
    const prototype = getField(doc, 'prototype');
    if (!(PROTOTYPE_STATES as readonly unknown[]).includes(prototype))
      add('prototype', `status prototype needs prototype: ${PROTOTYPE_STATES.join(' | ')}`);
  }
  if (status === 'parked') {
    const parked = getField(doc, 'parked');
    if (typeof parked !== 'string' || parked.trim() === '') add('parked', 'a parked task carries the reason');
    if (!isStatus(getField(doc, 'parkedFrom'))) add('parkedFrom', 'a parked task carries parkedFrom');
  }

  const criteria = parseCriteria(getSection(doc, 'Acceptance criteria'));
  for (const criterion of criteria) {
    if (criterion.tag === 'closes' && !criterion.command)
      add('Acceptance criteria', `criterion ${criterion.n} is [closes] without a \`command\``);
  }
  if (SCOPED.includes(status) && !criteria.some((criterion) => criterion.tag === 'closes'))
    add('Acceptance criteria', `at least one [closes] criterion is mandatory from \`ready\` on`);

  if (SCOPED.includes(status) && openQuestions(doc).length > 0)
    add('Questions', 'an open question is left on a task past planning');

  return issues;
}
