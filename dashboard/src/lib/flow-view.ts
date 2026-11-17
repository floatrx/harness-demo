/* Server-only: what /flow shows — the task in flight against the path its kind should take. The expected path comes
   from the core's transition table (`expectedPath`), the real trail from handoffs.jsonl, the role chain from the unit's
   trace. Nothing is drawn that neither file records. */

import { existsSync, readFileSync } from 'node:fs';
import { STAGE_ROLE, type UnitStage, loadConfig, transitionContext } from '@harness/core/config';
import { tracePaths } from '@harness/core/paths';
import { EXIT_LABEL, listUnits } from '@harness/core/stats';
import { type Status, expectedPath, isStatus } from '@harness/core/task/transitions';
import { type AgentRow, loadAgentsPage } from './agents-view.ts';
import { type BoardModel, loadBoard, readHandoffs } from './board.ts';
import { type UnitTrace, parseUnitTrace } from './unit-trace.ts';

export const LAST_RUNS = 6;

export interface TrailNode {
  /** Unique within the lane: a repeated stage (a bounce) is a new node. */
  key: string;
  stage: string;
  role: string | null;
  from: string | null;
  to: string | null;
  unit: number | null;
  exit: number | null;
  verdict: string | null;
  /** A runner step (an answered question, an auto-approve): no agent ran. */
  isAdvance: boolean;
  /** The verdict, else what the exit code means. */
  outcome: string;
  /** A hard stop, an agent that could not run, or a FAIL / REJECTED verdict. */
  isBad: boolean;
}

export interface LastRun {
  unit: number;
  task: string | null;
  stage: string | null;
  outcome: string;
  isBad: boolean;
  durationMs: number | null;
}

export interface RoleNode {
  /** The coordinator, or the id of the dispatch that started this specialist. */
  id: string;
  role: string;
  isCoordinator: boolean;
  state: 'running' | 'done' | 'failed';
  ms: number;
  calls: number;
}

export interface FlowLane {
  /** Stable for the life of the unit: task + stage + start time. */
  key: string;
  task: string;
  title: string | null;
  kind: string | null;
  status: Status | null;
  stage: string;
  unit: number;
  startedAt: string;
  coordinator: string;
  expected: { status: Status; passed: boolean; isCurrent: boolean }[];
  trail: TrailNode[];
  roles: RoleNode[];
  progress: string | null;
}

export interface FlowModel {
  board: BoardModel;
  lane: FlowLane | null;
  lastRuns: LastRun[];
  /** The agent whose file the drawer shows (`?a=`), when there is one. */
  agent: AgentRow | null;
  /** `?a=` named a role with no agent file. */
  missingAgent: string | null;
}

const outcomeOf = (exit: number | null, verdict: string | null) => ({
  outcome: verdict ?? (exit === null ? 'no exit' : (EXIT_LABEL[exit] ?? `exit ${exit}`)),
  isBad: (exit !== null && exit !== 0) || /FAIL|REJECTED/.test(verdict ?? ''),
});

const elapsed = (from: string | null, to: string | null) =>
  from && to ? Math.max(0, new Date(to).getTime() - new Date(from).getTime()) : 0;

/* The coordinator first, then each specialist it dispatched, in dispatch order. Coordinator time is the unit's span
   minus what its specialists ran, so the strip adds up to the unit. */
function roleChain(coordinator: string, trace: UnitTrace | null, now: string): RoleNode[] {
  if (!trace) return [{ id: 'coordinator', role: coordinator, isCoordinator: true, state: 'running', ms: 0, calls: 0 }];
  const end = trace.finished ? trace.lastEventAt : now;
  const agents: RoleNode[] = trace.agents.map((agent) => ({
    id: agent.id,
    role: agent.role,
    isCoordinator: false,
    state: agent.state,
    ms: elapsed(agent.startedAt, agent.endedAt ?? end),
    calls: agent.calls,
  }));
  const own = elapsed(trace.startedAt, end) - agents.reduce((sum, agent) => sum + agent.ms, 0);
  return [
    {
      id: 'coordinator',
      role: coordinator,
      isCoordinator: true,
      state: trace.finished ? 'done' : 'running',
      ms: Math.max(0, own),
      calls: trace.coordinator.calls,
    },
    ...agents,
  ];
}

export function loadFlow(projectId: string, agentName: string | null = null, now = new Date()): FlowModel {
  const board = loadBoard(projectId);
  const { path } = board.project;
  const paths = tracePaths(path);
  const running = board.dock.running;
  let lane: FlowLane | null = null;
  if (running) {
    const card = board.cards.find((item) => item.id === running.task) ?? null;
    const trail: TrailNode[] = readHandoffs(path)
      .filter((handoff) => handoff.task === running.task && handoff.stage !== 'deliver')
      .map((handoff, index) => ({
        key: `${index}-${handoff.unit ?? handoff.stage}`,
        stage: handoff.stage ?? '?',
        role: STAGE_ROLE[handoff.stage as UnitStage] ?? null,
        from: handoff.from ?? null,
        to: handoff.to ?? null,
        unit: handoff.unit ?? null,
        exit: handoff.exit ?? null,
        verdict: handoff.verdict ?? null,
        isAdvance: handoff.stage === 'advance',
        ...outcomeOf(handoff.exit ?? null, handoff.verdict ?? null),
      }));
    /* A status counts as passed only when a handoff names it (its from, its to, or the status its unit ran in), or the
       task sits in it now. */
    const unitStatus = (stage: string) => (stage === 'implement' ? 'implementing' : isStatus(stage) ? stage : null);
    const seen = new Set<string>(
      trail
        .flatMap((node) => [node.from, node.to, node.isAdvance ? null : unitStatus(node.stage)])
        .filter((status) => status !== null),
    );
    const status = card?.status ?? null;
    if (status) seen.add(status);
    const kind = (card?.kind ?? null) as Parameters<typeof expectedPath>[0];
    const traceFile = paths.unit(running.unit);
    const trace = existsSync(traceFile) ? parseUnitTrace(readFileSync(traceFile, 'utf8')) : null;
    const progress = existsSync(paths.progress)
      ? (readFileSync(paths.progress, 'utf8').trimEnd().split('\n').at(-1) ?? null)
      : null;
    lane = {
      key: `${running.task}:${running.stage}:${running.startedAt}`,
      task: running.task,
      title: card?.title ?? null,
      kind: card?.kind ?? null,
      status,
      stage: running.stage,
      unit: running.unit,
      startedAt: running.startedAt,
      coordinator: running.role,
      expected: expectedPath(kind, transitionContext(loadConfig(path))).map((item) => ({
        status: item,
        passed: seen.has(item),
        isCurrent: item === status,
      })),
      trail,
      roles: roleChain(running.role, trace, now.toISOString()),
      progress: progress?.replace(/^\S+T(\d\d:\d\d:\d\d)\.\d+Z /, '$1 ') ?? null,
    };
  }
  let agent: AgentRow | null = null;
  let missingAgent: string | null = null;
  if (agentName) {
    agent = loadAgentsPage(projectId).agents.find((row) => row.name === agentName) ?? null;
    if (!agent) missingAgent = agentName;
  }
  return {
    board,
    lane,
    lastRuns: listUnits(path)
      .filter((unit) => unit.unit !== running?.unit)
      .slice(-LAST_RUNS)
      .reverse()
      .map((unit) => ({
        unit: unit.unit,
        task: unit.task ?? null,
        stage: unit.stage ?? null,
        durationMs: unit.durationMs,
        ...outcomeOf(unit.exit ?? null, unit.verdict ?? null),
      })),
    agent,
    missingAgent,
  };
}
