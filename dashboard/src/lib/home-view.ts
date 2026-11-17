/* Server-only: what /home shows — what waits for the human, and five numbers about the loop. Every number comes from
   the board model, the task files or `computeStats`; a widget with nothing to count says when its data appears. */

import { type UnitRecord, computeStats, listUnits } from '@harness/core/stats';
import type { Status } from '@harness/core/task/transitions';
import { type BoardModel, type CardModel, loadBoard, readHandoffs } from './board.ts';

export const FINISHED: readonly Status[] = ['done', 'delivered'];
export const SPARK_DAYS = 14;
export const HEALTH_UNITS = 20;

export interface HomeModel {
  board: BoardModel;
  /** Cards whose next move is the human's (the board's `owner: 'you'`), and why, grouped. */
  waiting: { count: number; reasons: { label: string; count: number }[] };
  done: {
    finished: number;
    total: number;
    /** Moves into `done` per day, oldest first, the last entry is today. */
    perDay: { day: string; count: number }[];
    lastWeek: number;
  };
  running: (NonNullable<BoardModel['dock']['running']> & { title: string | null }) | null;
  supervisor: BoardModel['dock']['supervisor']['state'];
  /** The latest agent units, oldest first. */
  health: { unit: number; task: string | null; stage: string | null; exit: number | null; verdict: string | null }[];
  /** Per finished task; null fields stay unknown (no unit of a finished task reported usage). */
  spend: { tasks: number; reported: number; costUsd: number | null; tokens: number | null } | null;
  verdicts: { stage: string; verdict: string; count: number }[];
}

/* The action a card waits on, as the reason line names it. Drafts are the human's own work: named, not hidden. */
const REASON: Record<NonNullable<CardModel['action']>, [string, string]> = {
  Approve: ['plan to approve', 'plans to approve'],
  Answer: ['interview', 'interviews'],
  Review: ['prototype to review', 'prototypes to review'],
  Reopen: ['parked task', 'parked tasks'],
  Submit: ['draft to submit', 'drafts to submit'],
};

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function loadHome(projectId: string, now = new Date()): HomeModel {
  const board = loadBoard(projectId);
  const mine = board.cards.filter((card) => card.owner === 'you' && card.action);
  const reasons = (Object.keys(REASON) as (keyof typeof REASON)[]).flatMap((action) => {
    const count = mine.filter((card) => card.action === action).length;
    return count ? [{ label: REASON[action][count === 1 ? 0 : 1], count }] : [];
  });

  const handoffs = readHandoffs(board.project.path);
  const intoDone = handoffs.filter((handoff) => handoff.to === 'done');
  const perDay = Array.from({ length: SPARK_DAYS }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (SPARK_DAYS - 1 - index));
    const day = dayKey(date);
    return { day, count: intoDone.filter((handoff) => dayKey(new Date(handoff.at)) === day).length };
  });

  const units = listUnits(board.project.path);
  const tasks = board.cards.map((card) => ({ id: card.id, title: card.title, status: card.status }));
  const finishedIds = new Set(board.cards.filter((card) => FINISHED.includes(card.status)).map((card) => card.id));
  const ofFinished = units.filter((unit: UnitRecord) => unit.task && finishedIds.has(unit.task));
  const spent = computeStats(ofFinished, tasks).total;

  const { dock } = board;
  return {
    board,
    waiting: { count: mine.length, reasons },
    done: {
      finished: finishedIds.size,
      total: board.cards.length,
      perDay,
      lastWeek: perDay.slice(-7).reduce((sum, day) => sum + day.count, 0),
    },
    running: dock.running
      ? { ...dock.running, title: board.cards.find((card) => card.id === dock.running?.task)?.title ?? null }
      : null,
    supervisor: dock.supervisor.state,
    health: units.slice(-HEALTH_UNITS).map((unit) => ({
      unit: unit.unit,
      task: unit.task ?? null,
      stage: unit.stage ?? null,
      exit: unit.exit ?? null,
      verdict: unit.verdict ?? null,
    })),
    spend: finishedIds.size
      ? {
          tasks: finishedIds.size,
          reported: spent.reported,
          costUsd: spent.costUsd == null ? null : spent.costUsd / finishedIds.size,
          tokens: spent.reported ? spent.tokens / finishedIds.size : null,
        }
      : null,
    verdicts: computeStats(units, tasks).verdicts,
  };
}

/** A unit's cell in the health strip: what its exit and its verdict say. */
export const healthOf = (cell: HomeModel['health'][number]): 'ok' | 'bounce' | 'stop' => {
  if (cell.exit !== 0) return 'stop';
  return cell.verdict && /FAIL|REJECTED/.test(cell.verdict) ? 'bounce' : 'ok';
};
