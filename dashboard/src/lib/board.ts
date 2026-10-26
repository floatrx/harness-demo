/* Server-only: builds the board model from the harness core. Nothing here re-implements a status rule —
   statuses, transitions, parsing and the queue all come from @harness/core. */

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { loadConfig, transitionContext } from '@harness/core/config';
import { readHandoffs as readCoreHandoffs, readRunning, tracePaths } from '@harness/core/paths';
import { type Project, listProjects } from '@harness/core/projects';
import { nextStep, stageFor } from '@harness/core/queue';
import { lockHolder } from '@harness/core/supervise';
import { getSection, openQuestions, parseCriteria } from '@harness/core/task/parse';
import { type LoadedTask, listTaskFiles, loadTask } from '@harness/core/task/task';
import {
  HUMAN_TRANSITIONS,
  type Status,
  type TransitionContext,
  type TransitionTask,
} from '@harness/core/task/transitions';
import { validateTask } from '@harness/core/task/validate';
import type { UnitUsage } from '@harness/core/contracts/trace';
import { prototypeRounds } from '@harness/core/task/write';
import { billing } from '@harness/core/runner';
import type { AgentMode } from './agent-mode.ts';
import { prototypeImage } from './prototype-image.ts';

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
  /** From the unit's stream-json result (`readUsage`); null when the agent printed none (the fake agent's plain text). */
  usage?: Partial<UnitUsage> | null;
  /** A deliver step: the pull request it opened. */
  pr?: string;
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
  /** The prototype picture in `artifacts/<id>/` (file name), if the designer left one. */
  prototypeImage: string | null;
  /** The pull request the runner opened (`deliver.pr`). */
  pr: string | null;
  working: { role: string; since: string; unit: number } | null;
  /** Not running now, but the next thing that happens to it is an agent unit (or the runner's advance). */
  agentNext: boolean;
  issues: string[];
  /** Where a drag may drop this card, and the human action that drop fires. */
  moves: { target: Status; action: string }[];
}

export interface DockModel {
  supervisor: { state: 'running' | 'paused' | 'stopped'; pid: number | null };
  /** Who a Start from this dashboard runs for this project: its env (AGENT_CMD) and the project's agent.command. */
  agent: AgentMode;
  running: { task: string; stage: string; role: string; unit: number; startedAt: string } | null;
  upNext: string | null;
  recent: Handoff[];
}

export interface BoardModel {
  project: Project;
  baseBranch: string;
  cards: CardModel[];
  /** Task files the core could not parse: shown, never silently dropped. */
  unreadable: { file: string; reason: string }[];
  /** What blocks the loop until the human acts: questions, approvals, reviews, parked tasks. */
  waiting: CardModel[];
  /** Drafts: the human's own work, which starts the loop on Submit — counted apart, never "nothing waits". */
  drafts: CardModel[];
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

/* One reader for the whole stack: the core strips refused commands from permission denials (they can carry a token),
   so nothing the dashboard sends to the browser holds one. */
export const readHandoffs = (projectPath: string): Handoff[] => readCoreHandoffs(tracePaths(projectPath)) as Handoff[];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const usd = (value: number) => `$${value.toFixed(2)}`;

function cardMeta(
  task: LoadedTask,
  handoffs: Handoff[],
  cap: number,
  rounds: number,
  deliverPr: boolean,
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
    case 'needs-input': {
      const open = openQuestions(doc).length;
      /* Every question answered: the runner moves it back to the stage that asked on its next pick. */
      if (!open)
        return {
          owner: STAGE_ROLE[fields.resume ?? 'spec'] ?? null,
          action: null,
          meta: `Answered · back to ${fields.resume ?? 'spec'} next`,
        };
      return { owner: 'you', action: 'Answer', meta: plural(open, 'open question') };
    }
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
      /* A done task with delivery on still has one runner step: the pull request. */
      const next = fields.status === 'done' && deliverPr ? 'PR next' : null;
      return {
        owner: null,
        action: null,
        meta: [commit?.slice(0, 7), cost ? usd(cost) : null, next].filter(Boolean).join(' · ') || 'Done',
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

/* The human transitions that move a card to another column; a comment keeps it in place, so it is no drag. */
const dragMoves = (task: TransitionTask, ctx: TransitionContext) =>
  HUMAN_TRANSITIONS.flatMap((transition) => {
    if (transition.from !== task.status || (transition.guard && !transition.guard(task, ctx))) return [];
    // Revise needs a comment, so it is a drawer action (Plan tab), not a drop.
    if (transition.action === 'revise') return [];
    const target = transition.to(task);
    return target && target !== task.status ? [{ target, action: transition.action }] : [];
  });

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export function loadBoard(id: string): BoardModel {
  const project = findProject(id);
  const config = loadConfig(project.path);
  const ctx = transitionContext(config);
  const paths = tracePaths(project.path);
  const handoffs = readHandoffs(project.path);
  const running = readRunning(paths);
  const unreadable: BoardModel['unreadable'] = [];
  const tasks = listTaskFiles(paths.tasks).flatMap((file) => {
    try {
      return [loadTask(file)];
    } catch (error) {
      unreadable.push({ file: basename(file), reason: (error as Error).message });
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
      ...cardMeta(task, handoffs, config.limits.bounces, prototypeRounds(task.doc), ctx.deliverPr),
      bounces: fields.bounces,
      bounceCap: config.limits.bounces,
      isBad: fields.status === 'parked',
      trackStatus: fields.status === 'parked' ? (fields.parkedFrom ?? 'parked') : fields.status,
      prototypeImage: prototypeImage(paths.artifacts, fields.id),
      pr: fields.pr,
      working: isRunning && running ? { role: running.role, since: running.startedAt, unit: running.unit } : null,
      agentNext:
        !isRunning &&
        (!!stageFor(fields) ||
          (fields.status === 'needs-input' && fields.openQuestions === 0) ||
          (fields.status === 'done' && ctx.deliverPr)),
      issues,
      moves: isRunning ? [] : dragMoves(fields, ctx),
    };
  });

  /* What the supervisor takes after the unit in flight. */
  const step = nextStep(
    tasks.map((task) => task.fields),
    ctx,
    new Set(running ? [running.task] : []),
  );
  const upNext = !step
    ? null
    : step.kind === 'advance'
      ? `${step.task.id} · ${step.task.status} → ${step.target}`
      : step.kind === 'deliver'
        ? `${step.task.id} · pull request`
        : `${step.task.id} · ${stageFor(step.task) ?? step.stage}`;
  const holder = lockHolder(project.path);
  const todays = handoffs.filter((handoff) => isToday(handoff.at) && handoff.stage !== 'advance');

  return {
    project,
    baseBranch: config.baseBranch,
    cards,
    unreadable,
    waiting: cards.filter((card) => card.action && card.action !== 'Submit'),
    drafts: cards.filter((card) => card.action === 'Submit'),
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
      agent: billing(config).mode,
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
