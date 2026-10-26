/* Server-only: what the trace page shows for one unit. Safe fields only (see unit-trace.ts). */

import { existsSync, readFileSync } from 'node:fs';
import { readRunning, tracePaths } from '@harness/core/paths';
import { lockHolder } from '@harness/core/supervise';
import { findProject } from './board.ts';
import { type UnitTrace, parseUnitTrace } from './unit-trace.ts';
import { type UnitRecord, listUnits } from '@harness/core/stats';

export interface UnitDetail {
  unit: number;
  record: UnitRecord | null;
  running: { task: string; stage: string; role: string; startedAt: string } | null;
  trace: UnitTrace | null;
  /** The specialists the unit was offered (`--agents`), names only. */
  offered: string[];
}

export interface TracePage {
  units: UnitRecord[];
  runningUnit: number | null;
  /** A supervisor holds the lock: the next unit may start any moment. */
  supervisorRunning: boolean;
  selected: UnitDetail | null;
  supervisorLog: string[];
}

const LOG_LINES = 30;

export function loadTracePage(projectId: string, requested: number | null): TracePage {
  const project = findProject(projectId);
  const paths = tracePaths(project.path);
  const units = listUnits(project.path).reverse();
  const running = readRunning(paths);
  const unit = requested ?? running?.unit ?? units[0]?.unit ?? null;
  let selected: UnitDetail | null = null;
  /* A unit that never ran (`?u=999`) selects nothing rather than an empty shell. */
  if (unit !== null && (unit === running?.unit || units.some((record) => record.unit === unit))) {
    const traceFile = paths.unit(unit);
    const agentsFile = paths.agents(unit);
    let offered: string[];
    try {
      offered = existsSync(agentsFile) ? Object.keys(JSON.parse(readFileSync(agentsFile, 'utf8')) as object) : [];
    } catch {
      offered = [];
    }
    selected = {
      unit,
      record: units.find((record) => record.unit === unit) ?? null,
      running:
        running?.unit === unit
          ? { task: running.task, stage: running.stage, role: running.role, startedAt: running.startedAt }
          : null,
      trace: existsSync(traceFile) ? parseUnitTrace(readFileSync(traceFile, 'utf8')) : null,
      offered,
    };
  }
  const supervisorLog = existsSync(paths.progress)
    ? readFileSync(paths.progress, 'utf8').trimEnd().split('\n').slice(-LOG_LINES)
    : [];
  return {
    units,
    runningUnit: running?.unit ?? null,
    supervisorRunning: lockHolder(project.path) !== null,
    selected,
    supervisorLog,
  };
}
