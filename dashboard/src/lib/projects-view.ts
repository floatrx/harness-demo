/* Server-only: the /projects list. Each project says whether it can be opened at all, and if so what waits. A broken
   project (folder gone, config unreadable) is listed with the reason instead of failing the whole page. */

import { existsSync } from 'node:fs';
import { type Project, listProjects } from '@harness/core/projects';
import { loadBoard } from './board.ts';

export interface ProjectSummary {
  project: Project;
  state: 'ok' | 'missing' | 'broken';
  problem: string | null;
  tasks: number;
  /** Cards whose next step is the human's (Answer, Approve, Review, Reopen). */
  waiting: number;
  supervisor: 'running' | 'paused' | 'stopped';
  /** The unit in flight, if any. */
  running: string | null;
}

export function listProjectSummaries(): ProjectSummary[] {
  return listProjects().map((project) => {
    const empty = { project, problem: null, tasks: 0, waiting: 0, supervisor: 'stopped', running: null } as const;
    if (!existsSync(project.path))
      return { ...empty, state: 'missing', problem: `the folder ${project.path} no longer exists` };
    try {
      const board = loadBoard(project.id);
      const running = board.dock.running;
      return {
        ...empty,
        state: 'ok',
        tasks: board.cards.length,
        waiting: board.waiting.length,
        supervisor: board.dock.supervisor.state,
        running: running ? `${running.task} · ${running.stage}` : null,
      };
    } catch (error) {
      return { ...empty, state: 'broken', problem: (error as Error).message };
    }
  });
}
