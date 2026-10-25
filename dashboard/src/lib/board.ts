/* Server-only: builds the board model from the harness core. Nothing here re-implements a status rule —
   statuses, transitions, parsing and the queue all come from @harness/core. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, transitionContext } from '@harness/core/config';
import { readRunning, tracePaths } from '@harness/core/paths';
import { type Project, listProjects } from '@harness/core/projects';
import { nextStep, stageFor } from '@harness/core/queue';
import { lockHolder } from '@harness/core/supervise';
import { getSection, openQuestions, parseCriteria } from '@harness/core/task/parse';
import { type LoadedTask, listTaskFiles, loadTask } from '@harness/core/task/task';
import { type Status, humanTargets } from '@harness/core/task/transitions';
import { validateTask } from '@harness/core/task/validate';
import { prototypeRounds } from '@harness/core/task/write';

export const STAGE_ROLE: Partial<Record<Status, string>> = {
  spec: 'writer',
  plan: 'planner',
  prototype: 'designer',
  implementing: 'implementer',
  qa: 'qa',
  judge: 'judge',
};

export interface Handoff {
  at: string;
  task?: string;
  stage?: string;
  unit?: number;
  from?: string;
  to?: string;
  exit?: number;
  commit?: string | null;
  reason?: string;
  verdict?: string | null;
  usage?: { costUsd?: number | null; durationMs?: number | null; inputTokens?: number; outputTokens?: number } | null;
}

export interface CardModel {
  id: string;
  title: string;
  status: Status;
  kind: string | null;
  /** 'you' when the card waits for the human, else the role that owns its column. */
  owner: string | null;
  /** The human action this card needs, if any. */
  action: 'Submit' | 'Answer' | 'Approve' | 'Review' | 'Reopen' | null;
  meta: string;
  bounces: number;
  bounceCap: number;
  isBad: boolean;
  /** Where the track stops: a parked task shows where it was parked from. */
  trackStatus: Status;
  hasPrototype: boolean;
  working: { role: string; since: string; unit: number } | null;
  issues: string[];
  dropTargets: Status[];
}

export interface DockModel {
  supervisor: { state: 'running' | 'paused' | 'stopped'; pid: number | null };
  running: { task: string; stage: string; role: string; unit: number; startedAt: string } | null;
  upNext: string | null;
  recent: Handoff[];
}

export interface BoardModel {
  project: Project;
  baseBranch: string;
  cards: CardModel[];
  waiting: CardModel[];
  /** null cost and duration when no unit reported usage (the fake agent reports none). */
  today: { units: number; costUsd: number | null; durationMs: number | null };
  dock: DockModel;
}

export class ProjectNotFound extends Error {
  override name = 'ProjectNotFound';
}

export const findProject = (id: string): Project => {
  const project = listProjects().find((item) => item.id === id);
  if (!project) throw new ProjectNotFound(`no project ${id}`);
  return project;
};

export const readHandoffs = (projectPath: string): Handoff[] => {
  const file = tracePaths(projectPath).handoffs;
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Handoff];
      } catch {
        return [];
      }
    });
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const usd = (value: number) => `$${value.toFixed(2)}`;

function cardMeta(
  task: LoadedTask,
  handoffs: Handoff[],
  cap: number,
  rounds: number,
): Pick<CardModel, 'meta' | 'action' | 'owner'> {
  const { fields, doc } = task;
  const role = STAGE_ROLE[fields.status] ?? null;
  const mine = handoffs.filter((handoff) => handoff.task === fields.id);
  const cost = mine.reduce((sum, handoff) => sum + (handoff.usage?.costUsd ?? 0), 0);
  switch (fields.status) {
    case 'draft':
      return {
        owner: 'you',
        action: 'Submit',
        meta: fields.created ? `Created ${shortDate(fields.created)}` : 'Draft',
      };
    case 'needs-input':
      return { owner: 'you', action: 'Answer', meta: plural(openQuestions(doc).length, 'open question') };
    case 'planned': {
      const checks = parseCriteria(getSection(doc, 'Acceptance criteria')).filter(
        (criterion) => criterion.tag === 'closes',
      );
      return {
        owner: 'you',
        action: 'Approve',
        meta: `${plural(fields.scope.length, 'path')} · ${plural(checks.length, 'check')}`,
      };
    }
    case 'prototype':
      return fields.prototype === 'review'
        ? { owner: 'you', action: 'Review', meta: `Round ${rounds + 1} · review` }
        : { owner: 'designer', action: null, meta: `Designer drafts round ${rounds + 1}` };
    case 'ready':
      return { owner: null, action: null, meta: 'Approved · waits for implement' };
    case 'parked':
      return { owner: 'you', action: 'Reopen', meta: (fields.parked ?? 'Parked').replace(/^\w+ unit \d+: /, '') };
    case 'done':
    case 'delivered': {
      const commit = [...mine].reverse().find((handoff) => handoff.commit)?.commit;
      return {
        owner: null,
        action: null,
        meta: [commit?.slice(0, 7), cost ? usd(cost) : null].filter(Boolean).join(' · ') || 'Done',
      };
    }
    default:
      return {
        owner: role,
        action: null,
        meta: fields.bounces ? `Bounce ${fields.bounces} of ${cap}` : `Waiting for the ${role ?? 'loop'}`,
      };
  }
}

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export function loadBoard(id: string): BoardModel {
  const project = findProject(id);
  const config = loadConfig(project.path);
  const ctx = transitionContext(config);
  const paths = tracePaths(project.path);
  const handoffs = readHandoffs(project.path);
  const running = readRunning(paths);
  const tasks = listTaskFiles(paths.tasks).flatMap((file) => {
    try {
      return [loadTask(file)];
    } catch {
      return [];
    }
  });

  const cards: CardModel[] = tasks.map((task) => {
    const { fields } = task;
    const issues = validateTask(task.doc).map((issue) => issue.message);
    const isRunning = running?.task === fields.id;
    return {
      id: fields.id,
      title: fields.title,
      status: fields.status,
      kind: fields.kind,
      ...cardMeta(task, handoffs, config.limits.bounces, prototypeRounds(task.doc)),
      bounces: fields.bounces,
      bounceCap: config.limits.bounces,
      isBad: fields.status === 'parked',
      trackStatus: fields.status === 'parked' ? (fields.parkedFrom ?? 'parked') : fields.status,
      hasPrototype: existsSync(join(paths.artifacts, fields.id, 'prototype.svg')),
      working: isRunning && running ? { role: running.role, since: running.startedAt, unit: running.unit } : null,
      issues,
      dropTargets: isRunning ? [] : humanTargets(fields, ctx),
    };
  });

  const step = nextStep(
    tasks.map((task) => task.fields),
    ctx,
  );
  const upNext = !step
    ? null
    : step.kind === 'advance'
      ? `${step.task.id} · ${step.task.status} → ${step.target}`
      : `${step.task.id} · ${stageFor(step.task) ?? step.stage}`;
  const holder = lockHolder(project.path);
  const todays = handoffs.filter((handoff) => isToday(handoff.at) && handoff.stage !== 'advance');

  return {
    project,
    baseBranch: config.baseBranch,
    cards,
    waiting: cards.filter((card) => card.action && card.action !== 'Submit'),
    today: {
      units: todays.length,
      costUsd: todays.some((handoff) => handoff.usage?.costUsd != null)
        ? todays.reduce((sum, handoff) => sum + (handoff.usage?.costUsd ?? 0), 0)
        : null,
      durationMs: todays.some((handoff) => handoff.usage?.durationMs != null)
        ? todays.reduce((sum, handoff) => sum + (handoff.usage?.durationMs ?? 0), 0)
        : null,
    },
    dock: {
      supervisor: {
        state: !holder ? 'stopped' : existsSync(paths.pause) ? 'paused' : 'running',
        pid: holder,
      },
      running,
      upNext,
      recent: handoffs
        .filter((handoff) => handoff.stage !== 'advance')
        .slice(-6)
        .reverse(),
    },
  };
}
