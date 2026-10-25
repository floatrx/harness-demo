/* Server-only: everything the task drawer shows, as plain serialisable data. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tracePaths } from '@harness/core/paths';
import { type Question, getSection, parseCriteria, parseQuestions } from '@harness/core/task/parse';
import { loadTask } from '@harness/core/task/task';
import type { Status } from '@harness/core/task/transitions';
import { type Handoff, STAGE_ROLE, findProject, readHandoffs } from './board';

export interface TaskDetail {
  id: string;
  title: string;
  status: Status;
  trackStatus: Status;
  kind: string | null;
  hasPrototype: boolean;
  askedBy: { role: string; stage: string; unit: number | null; costUsd: number | null } | null;
  sections: Record<'Draft' | 'Spec' | 'Plan' | 'Prototype' | 'Acceptance criteria', string>;
  questions: Question[];
  criteria: ReturnType<typeof parseCriteria>;
  log: string[];
  units: Handoff[];
}

const SECTIONS = ['Draft', 'Spec', 'Plan', 'Prototype', 'Acceptance criteria'] as const;

export function loadTaskDetail(projectId: string, taskId: string): TaskDetail | null {
  if (!/^T-\d{3,}$/.test(taskId)) return null;
  const project = findProject(projectId);
  let task;
  try {
    task = loadTask(join(tracePaths(project.path).tasks, `${taskId}.md`));
  } catch {
    return null;
  }
  const { fields, doc } = task;
  const units = readHandoffs(project.path).filter((handoff) => handoff.task === taskId && handoff.stage !== 'advance');
  const asking =
    fields.status === 'needs-input' && fields.resume
      ? [...units].reverse().find((unit) => unit.to === 'needs-input')
      : undefined;
  return {
    id: fields.id,
    title: fields.title,
    status: fields.status,
    trackStatus: fields.status === 'parked' ? (fields.parkedFrom ?? 'parked') : fields.status,
    kind: fields.kind,
    hasPrototype: existsSync(join(tracePaths(project.path).artifacts, taskId, 'prototype.svg')),
    askedBy:
      fields.status === 'needs-input' && fields.resume
        ? {
            role: STAGE_ROLE[fields.resume] ?? fields.resume,
            stage: fields.resume,
            unit: asking?.unit ?? null,
            costUsd: asking?.usage?.costUsd ?? null,
          }
        : null,
    sections: Object.fromEntries(
      SECTIONS.map((name) => [name, (getSection(doc, name) ?? '').trim()]),
    ) as TaskDetail['sections'],
    questions: parseQuestions(getSection(doc, 'Questions')),
    criteria: parseCriteria(getSection(doc, 'Acceptance criteria')),
    log: (getSection(doc, 'Log') ?? '').split('\n').filter((line) => line.trim()),
    units,
  };
}
