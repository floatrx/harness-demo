// The queue predicate. Pure: tasks + context in, the next step out. Recomputed before every unit,
// so killing the loop mid-batch costs only the unit in flight.

import type { UnitStage } from './config.ts';
import type { TaskFields } from './task/task.ts';
import { type Status, type TransitionContext, findTransition } from './task/transitions.ts';

export type Step =
  /** A move the runner makes without an agent (an answered question, an auto-approved plan). */
  | { kind: 'advance'; task: TaskFields; action: string; target: Status }
  /** One agent unit. */
  | { kind: 'unit'; task: TaskFields; stage: UnitStage };

/** Finishing beats starting: the stage further down the board goes first, then the lower id. */
const RANK: Partial<Record<Status, number>> = {
  judge: 7,
  qa: 6,
  implementing: 5,
  ready: 4,
  prototype: 3,
  planned: 3,
  'needs-input': 2,
  plan: 2,
  spec: 1,
};

export function stageFor(task: TaskFields): UnitStage | null {
  switch (task.status) {
    case 'spec':
      return 'spec';
    case 'plan':
      return 'plan';
    case 'prototype':
      return task.prototype === 'drafting' ? 'prototype' : null;
    case 'ready':
    case 'implementing':
      return 'implement';
    case 'qa':
      return 'qa';
    case 'judge':
      return 'judge';
    default:
      return null;
  }
}

const ADVANCES = ['answered', 'auto-approve', 'auto-accept'];

export function nextStep(
  tasks: TaskFields[],
  ctx: TransitionContext,
  skip: ReadonlySet<string> = new Set(),
): Step | null {
  const ordered = tasks
    .filter((task) => !skip.has(task.id) && RANK[task.status] !== undefined)
    .sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || a.id.localeCompare(b.id));
  for (const task of ordered) {
    for (const action of ADVANCES) {
      const found = findTransition(task, 'agent', action, ctx);
      if (found) return { kind: 'advance', task, action, target: found.target };
    }
    const stage = stageFor(task);
    if (stage) return { kind: 'unit', task, stage };
  }
  return null;
}
