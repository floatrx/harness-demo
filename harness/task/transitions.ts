// The state machine. One status = one board column = one owner.
// Human and agent transitions are separate sets: the dashboard may only offer HUMAN_TRANSITIONS.

export const STATUSES = [
  'draft',
  'spec',
  'needs-input',
  'plan',
  'planned',
  'prototype',
  'ready',
  'implementing',
  'qa',
  'judge',
  'done',
  'delivered',
  'parked',
] as const;
export type Status = (typeof STATUSES)[number];

export const KINDS = ['ui', 'logic', 'docs', 'chore'] as const;
export type Kind = (typeof KINDS)[number];

export const PROTOTYPE_STATES = ['drafting', 'review'] as const;
export type PrototypeState = (typeof PROTOTYPE_STATES)[number];

/** Statuses a stage may ask a question from (`resume:` while `needs-input`). */
export const RESUMABLE = ['spec', 'plan'] as const satisfies readonly Status[];

/** From `ready` on, a task must carry a `scope:` — it is the implementer's pathspec. */
export const SCOPED: readonly Status[] = ['ready', 'implementing', 'qa', 'judge', 'done', 'delivered'];

export const OWNER: Record<Status, 'human' | 'agent' | 'none'> = {
  draft: 'human',
  spec: 'agent',
  'needs-input': 'human',
  plan: 'agent',
  planned: 'human',
  prototype: 'agent', // the designer drafts; the human reviews while `prototype: review`
  ready: 'human',
  implementing: 'agent',
  qa: 'agent',
  judge: 'agent',
  done: 'agent',
  delivered: 'none',
  parked: 'human',
};

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** The minimum a transition needs to know about a task. */
export interface TransitionTask {
  status: Status;
  kind: Kind | null;
  resume: Status | null;
  prototype: PrototypeState | null;
  parkedFrom: Status | null;
  bounces: number;
  openQuestions: number;
}

export interface TransitionContext {
  autonomy: 'gated' | 'full';
  mergeQaJudge: boolean;
  bounceCap: number;
}

export const DEFAULT_CONTEXT: TransitionContext = { autonomy: 'gated', mergeQaJudge: false, bounceCap: 2 };

export interface Transition {
  /** A stable name: the CLI command or the runner event that fires it. */
  action: string;
  from: Status | '*';
  /** The target, or null when it cannot be computed for this task. */
  to: (task: TransitionTask) => Status | null;
  guard?: (task: TransitionTask, ctx: TransitionContext) => boolean;
}

const to = (status: Status) => () => status;
const afterPlanned = (task: TransitionTask): Status => (task.kind === 'ui' ? 'prototype' : 'ready');
const full = (_task: TransitionTask, ctx: TransitionContext) => ctx.autonomy === 'full';
const underCap = (task: TransitionTask, ctx: TransitionContext) => task.bounces + 1 < ctx.bounceCap;
const atCap = (task: TransitionTask, ctx: TransitionContext) => task.bounces + 1 >= ctx.bounceCap;

export const HUMAN_TRANSITIONS: readonly Transition[] = [
  { action: 'submit', from: 'draft', to: to('spec') },
  // `needs-input` is left by the runner once every question is answered; answering is a section write.
  { action: 'approve', from: 'planned', to: afterPlanned },
  { action: 'accept', from: 'prototype', to: to('ready'), guard: (task) => task.prototype === 'review' },
  // Comment keeps the column and flips `prototype: review → drafting`.
  { action: 'comment', from: 'prototype', to: to('prototype'), guard: (task) => task.prototype === 'review' },
  { action: 'reopen', from: 'parked', to: (task) => task.parkedFrom },
];

export const AGENT_TRANSITIONS: readonly Transition[] = [
  { action: 'spec-done', from: 'spec', to: to('plan') },
  { action: 'ask', from: 'spec', to: to('needs-input') },
  { action: 'plan-done', from: 'plan', to: to('planned') },
  { action: 'ask', from: 'plan', to: to('needs-input') },
  {
    action: 'answered',
    from: 'needs-input',
    to: (task) => task.resume,
    guard: (task) => task.openQuestions === 0,
  },
  { action: 'auto-approve', from: 'planned', to: afterPlanned, guard: full },
  {
    action: 'prototype-done',
    from: 'prototype',
    to: to('prototype'),
    // drafting → review; under full autonomy `auto-accept` then moves it on.
    guard: (task) => task.prototype === 'drafting',
  },
  {
    action: 'auto-accept',
    from: 'prototype',
    to: to('ready'),
    // The designer's round is finished (`review`); full autonomy takes the human's Accept.
    guard: (task, ctx) => full(task, ctx) && task.prototype === 'review',
  },
  { action: 'start', from: 'ready', to: to('implementing') },
  { action: 'implemented', from: 'implementing', to: to('qa') },
  { action: 'qa-pass', from: 'qa', to: to('judge'), guard: (_task, ctx) => !ctx.mergeQaJudge },
  { action: 'qa-pass', from: 'qa', to: to('done'), guard: (_task, ctx) => ctx.mergeQaJudge },
  { action: 'qa-fail', from: 'qa', to: to('implementing'), guard: underCap },
  { action: 'qa-fail', from: 'qa', to: to('parked'), guard: atCap },
  { action: 'confirmed', from: 'judge', to: to('done') },
  { action: 'rejected', from: 'judge', to: to('implementing'), guard: underCap },
  { action: 'rejected', from: 'judge', to: to('parked'), guard: atCap },
  { action: 'delivered', from: 'done', to: to('delivered') },
  // A hard stop (scope, gate, trace, CANNOT VERIFY) parks any task that is not finished.
  {
    action: 'park',
    from: '*',
    to: to('parked'),
    guard: (task) => !['parked', 'delivered', 'draft'].includes(task.status),
  },
];

export type Actor = 'human' | 'agent';

export function transitionsFor(actor: Actor): readonly Transition[] {
  return actor === 'human' ? HUMAN_TRANSITIONS : AGENT_TRANSITIONS;
}

/** The transition `action` would fire for this task, or null when it is not allowed. */
export function findTransition(
  task: TransitionTask,
  actor: Actor,
  action: string,
  ctx: TransitionContext = DEFAULT_CONTEXT,
): { transition: Transition; target: Status } | null {
  for (const transition of transitionsFor(actor)) {
    if (transition.action !== action) continue;
    if (transition.from !== '*' && transition.from !== task.status) continue;
    if (transition.guard && !transition.guard(task, ctx)) continue;
    const target = transition.to(task);
    if (target) return { transition, target };
  }
  return null;
}

/** Whether `actor` may move this task to `target` by any transition. */
export function canTransition(
  task: TransitionTask,
  target: Status,
  actor: Actor,
  ctx: TransitionContext = DEFAULT_CONTEXT,
): boolean {
  return transitionsFor(actor).some(
    (transition) =>
      (transition.from === '*' || transition.from === task.status) &&
      (!transition.guard || transition.guard(task, ctx)) &&
      transition.to(task) === target,
  );
}

/** Targets a human can drag this card to (the board uses this). */
export function humanTargets(task: TransitionTask, ctx: TransitionContext = DEFAULT_CONTEXT): Status[] {
  return HUMAN_TRANSITIONS.flatMap((transition) => {
    if (transition.from !== task.status || (transition.guard && !transition.guard(task, ctx))) return [];
    const target = transition.to(task);
    return target && target !== task.status ? [target] : [];
  });
}
