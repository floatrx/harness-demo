// Project configuration: `<project>/.harness/config.json`, merged over the defaults.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransitionContext } from './task/transitions.ts';
import type { Role } from './task/write.ts';

export const UNIT_STAGES = ['spec', 'plan', 'prototype', 'implement', 'qa', 'judge'] as const;
export type UnitStage = (typeof UNIT_STAGES)[number];

/** What the loop tells the human on Telegram: what needs them, and what ended. */
export const NOTIFY_EVENTS = [
  'needs-input',
  'planned',
  'prototype',
  'parked',
  'done',
  'delivered',
  'supervisor',
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export interface VerdictRule {
  /** The token prefix the stage must print, e.g. `qa` for `qa: PASS`. */
  token: string;
  values: string[];
}

/** The project's app, started by the runner for the units that look at it (qa, prototype). Opt-in: null = none. */
export interface AppConfig {
  /** Shell command with `{port}`, e.g. `pnpm exec next dev -p {port}`. */
  start: string;
  /** Path polled until the server answers anything. */
  ready: string;
  /**
   * The host in the URL the units get. `localhost`, not 127.0.0.1: Next 16's dev server blocks its HMR socket for any
   * other origin, so a page opened on 127.0.0.1 never hydrates and its buttons do nothing (real browser run, T-005).
   */
  host: string;
  timeoutSeconds: number;
  /** Unit stages that get the app (and, from B2, a browser). */
  stages: UnitStage[];
  /** The Playwright MCP package the browser units run through `npx`, pinned. */
  browser: string;
}

export const APP_DEFAULTS: Omit<AppConfig, 'start'> = {
  ready: '/',
  host: 'localhost',
  timeoutSeconds: 60,
  stages: ['qa', 'prototype'],
  browser: '@playwright/mcp@0.0.83',
};

export interface HarnessConfig {
  baseBranch: string;
  autonomy: { mode: 'gated' | 'full' };
  roles: {
    mergeQaJudge: boolean;
    /** Model per role; the judge defaults to a different model from the implementer. */
    models: Partial<Record<Role, string>>;
  };
  limits: { bounces: number; prototypeRounds: number; unitTimeoutMinutes: number };
  /** Project default gate; a task's own `gate:` wins. null = no gate. */
  gate: string | null;
  /** A command that must exit 0 before a unit starts (stack up, network). null = skip. */
  probe: string | null;
  /** Required verdict per stage. A unit of that stage without the token fails the trace contract. */
  verdicts: Partial<Record<UnitStage, VerdictRule>>;
  /** `pr: true` → a done task's branch is pushed to `remote` and a pull request is opened. Nothing ever merges it. */
  deliver: { pr: boolean; remote: string };
  app: AppConfig | null;
  /**
   * Code units (prototype, implement, qa, judge) run in the task's own git worktree, `.harness/worktrees/T-NNN`.
   * `setup` runs there once, after it is made (e.g. `pnpm install --prefer-offline`); null = link the main
   * checkout's `node_modules` instead.
   */
  worktree: { setup: string | null };
  /** Telegram events to send (keys in env or `.env`; none → silent). */
  notify: { events: NotifyEvent[] };
  agent: {
    /** A shell command that replaces `claude` (the fake agent, a wrapper). null = the built-in `claude -p`. */
    command: string | null;
    /** `claude --permission-mode`. `dontAsk` denies anything not allowed below instead of waiting for a human. */
    permissionMode: string;
    /** `claude --allowedTools` for every unit. Commits and pushes are absent on purpose: a second fence. */
    allowedTools: string[];
    /** `claude --setting-sources`: project settings only, so personal user hooks never fire inside the loop. */
    settingSources: string;
  };
  supervisor: {
    barrenUnits: number;
    idlePollSeconds: number;
    pausePollSeconds: number;
    usageProbeSeconds: number;
    usageNapSeconds: number;
    usageCeilingSeconds: number;
  };
}

export const DEFAULT_CONFIG: HarnessConfig = {
  baseBranch: 'main',
  autonomy: { mode: 'gated' },
  roles: {
    mergeQaJudge: false,
    models: {
      writer: 'sonnet',
      planner: 'sonnet',
      designer: 'sonnet',
      implementer: 'sonnet',
      qa: 'sonnet',
      // The judge is a different model from the implementer and the tester on purpose.
      judge: 'opus',
    },
  },
  limits: { bounces: 2, prototypeRounds: 3, unitTimeoutMinutes: 60 },
  gate: null,
  probe: null,
  verdicts: {
    qa: { token: 'qa', values: ['PASS', 'FAIL', 'CANNOT_VERIFY'] },
    judge: { token: 'judge', values: ['CONFIRMED', 'REJECTED'] },
  },
  deliver: { pr: false, remote: 'origin' },
  app: null,
  worktree: { setup: null },
  notify: { events: [...NOTIFY_EVENTS] },
  agent: {
    command: null,
    permissionMode: 'dontAsk',
    allowedTools: [
      'Read',
      'Grep',
      'Glob',
      'Edit',
      'Write',
      'Agent',
      'Task',
      'TodoWrite',
      'Bash(git status:*)',
      'Bash(git diff:*)',
      'Bash(git log:*)',
      'Bash(git show:*)',
      'Bash(ls:*)',
      'Bash(grep:*)',
      'Bash(cat:*)',
      'Bash(head:*)',
      'Bash(tail:*)',
      'Bash(wc:*)',
      // The allowed way to wait for a specialist (standing rule 7): `until …` loops are refused (pilot lesson 14).
      'Bash(sleep:*)',
      'Bash(pnpm:*)',
      'Bash(npm test:*)',
      'Bash(npx:*)',
      'Bash(node:*)',
    ],
    settingSources: 'project,local',
  },
  supervisor: {
    barrenUnits: 3,
    idlePollSeconds: 30,
    pausePollSeconds: 2,
    usageProbeSeconds: 30,
    usageNapSeconds: 1800,
    usageCeilingSeconds: 6 * 3600,
  },
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function merge<T>(base: T, over: unknown): T {
  if (!isPlain(base) || !isPlain(over)) return (over === undefined ? base : over) as T;
  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = key in base ? merge(base[key], value) : value;
  return out as T;
}

export function harnessDir(project: string): string {
  return join(project, '.harness');
}

export function loadConfig(project: string): HarnessConfig {
  const path = join(harnessDir(project), 'config.json');
  if (!existsSync(path)) throw new ConfigError(`no ${path} — run \`harness projects add ${project}\``);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${path}: ${(error as Error).message}`);
  }
  const config = merge(DEFAULT_CONFIG, raw);
  if (!['gated', 'full'].includes(config.autonomy.mode)) throw new ConfigError(`autonomy.mode: gated | full`);
  if (!(config.limits.bounces >= 1)) throw new ConfigError('limits.bounces must be ≥ 1');
  if (config.app) {
    const app = { ...APP_DEFAULTS, ...config.app };
    if (typeof app.start !== 'string' || !app.start.includes('{port}'))
      throw new ConfigError('app.start must contain {port} — the runner picks a free port per unit');
    if (!app.ready.startsWith('/')) throw new ConfigError('app.ready is a path, e.g. "/"');
    if (!(app.timeoutSeconds > 0)) throw new ConfigError('app.timeoutSeconds must be > 0');
    const bad = app.stages.filter((stage) => !(UNIT_STAGES as readonly string[]).includes(stage));
    if (bad.length) throw new ConfigError(`app.stages: unknown ${bad.join(', ')} (${UNIT_STAGES.join(' | ')})`);
    config.app = app;
  }
  if (config.worktree.setup !== null && typeof config.worktree.setup !== 'string')
    throw new ConfigError('worktree.setup is a shell command or null');
  const unknown = config.notify.events.filter((event) => !(NOTIFY_EVENTS as readonly string[]).includes(event));
  if (unknown.length)
    throw new ConfigError(`notify.events: unknown ${unknown.join(', ')} (${NOTIFY_EVENTS.join(' | ')})`);
  return config;
}

export function transitionContext(config: HarnessConfig): TransitionContext {
  return {
    autonomy: config.autonomy.mode,
    mergeQaJudge: config.roles.mergeQaJudge,
    bounceCap: config.limits.bounces,
    deliverPr: config.deliver.pr,
  };
}

export const STAGE_ROLE: Record<UnitStage, Role> = {
  spec: 'writer',
  plan: 'planner',
  prototype: 'designer',
  implement: 'implementer',
  qa: 'qa',
  judge: 'judge',
};
