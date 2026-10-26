/* Server-only: the Live snapshot pushed over SSE once a second (only when it changed). It carries roles, tool names
   and file basenames — never tool arguments or message text (plan § Security; see unit-trace.ts). */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tracePaths } from '@harness/core/paths';
import { listTaskFiles } from '@harness/core/task/task';
import { type DockModel, loadBoard } from './board.ts';
import { type UnitTrace, parseUnitTrace } from './unit-trace.ts';

export type SupervisorState = 'running' | 'paused' | 'stopping' | 'stopped';

export interface LiveSnapshot {
  /** Changes whenever anything below changes; the SSE route sends only on change. */
  version: string;
  /** Changes when the board itself must re-render (a task file, the unit in flight, a handoff). */
  boardVersion: string;
  supervisor: { state: SupervisorState; pid: number | null; since: string | null };
  agent: DockModel['agent'];
  running: (NonNullable<DockModel['running']> & { trace: UnitTrace | null }) | null;
  upNext: string | null;
  recent: DockModel['recent'];
}

const hash = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);

const lockSince = (lock: string): string | null => {
  try {
    return (JSON.parse(readFileSync(lock, 'utf8')) as { startedAt?: string }).startedAt ?? null;
  } catch {
    return null;
  }
};

export function liveSnapshot(projectId: string): LiveSnapshot {
  const board = loadBoard(projectId);
  const paths = tracePaths(board.project.path);
  const { dock } = board;
  const state: SupervisorState =
    dock.supervisor.state === 'stopped' ? 'stopped' : existsSync(paths.stop) ? 'stopping' : dock.supervisor.state;
  const traceFile = dock.running ? paths.unit(dock.running.unit) : null;
  const trace = traceFile && existsSync(traceFile) ? parseUnitTrace(readFileSync(traceFile, 'utf8')) : null;
  const boardVersion = hash([
    listTaskFiles(paths.tasks).map((file) => [file, statSync(file).mtimeMs]),
    dock.running?.unit ?? null,
    existsSync(paths.handoffs) ? statSync(paths.handoffs).size : 0,
  ]);
  const body = {
    boardVersion,
    supervisor: { state, pid: dock.supervisor.pid, since: dock.supervisor.pid ? lockSince(paths.lock) : null },
    agent: dock.agent,
    running: dock.running ? { ...dock.running, trace } : null,
    upNext: dock.upNext,
    recent: dock.recent,
  };
  return { version: hash(body), ...body };
}
