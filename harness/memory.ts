// Memory between units. Every unit starts in a fresh context, so the runner hands it what earlier units left:
// measured facts first (from the trace, git and the task log — things code knows), then the tail of the journal
// (what agents chose to write down). Facts lead because a note can be wrong and a measurement cannot.

import { existsSync, readFileSync } from 'node:fs';
import type { UnitStage } from './config.ts';
import { branchExists, tryGit } from './git.ts';
import { type HandoffRecord, type TracePaths, readHandoffs } from './paths.ts';
import { type TaskFields, listTaskFiles, loadTask } from './task/task.ts';

const JOURNAL_LINES = 30;
const HANDOFFS = 5;
const LOG_LINES = 8;
const BOARD_TASKS = 30;

/** The other tasks on the board, for the stages that decide what a task is (pilot lesson 6: a vague draft's
 *  recommended option was exactly what another open task already did). */
function otherTasks(paths: TracePaths, id: string): string[] {
  return listTaskFiles(paths.tasks)
    .flatMap((file) => {
      try {
        const { fields } = loadTask(file);
        return fields.id === id ? [] : [`- ${fields.id} · ${fields.status} · ${fields.title}`];
      } catch {
        return [];
      }
    })
    .slice(-BOARD_TASKS);
}

function handoffsFor(paths: TracePaths, id: string): HandoffRecord[] {
  return readHandoffs(paths)
    .filter((record) => record.task === id)
    .slice(-HANDOFFS);
}

function taskLogTail(taskPath: string): string[] {
  if (!existsSync(taskPath)) return [];
  const text = readFileSync(taskPath, 'utf8');
  const at = text.search(/^## Log\s*$/m);
  if (at === -1) return [];
  return text
    .slice(at)
    .split('\n')
    .slice(1)
    .filter((line) => line.trim())
    .slice(-LOG_LINES);
}

export function buildMemory(
  project: string,
  paths: TracePaths,
  task: TaskFields,
  stage: UnitStage,
  baseBranch: string,
): string {
  const facts: string[] = [`- Status ${task.status}, bounces ${task.bounces}, branch ${task.branch ?? '(none yet)'}`];
  for (const record of handoffsFor(paths, task.id)) {
    const bits = [`unit ${record.unit ?? '?'}`, record.stage, `${record.from} → ${record.to}`];
    if (record.verdict) bits.push(`verdict ${record.verdict}`);
    if (record.commit) bits.push(`commit ${record.commit.slice(0, 7)}`);
    if (record.reason) bits.push(record.reason);
    facts.push(`- ${bits.filter(Boolean).join(' · ')}`);
  }
  if (task.branch && ['implement', 'qa', 'judge'].includes(stage) && branchExists(project, task.branch)) {
    const stat = tryGit(project, ['diff', '--shortstat', `${baseBranch}...${task.branch}`]).stdout.trim();
    if (stat) facts.push(`- ${task.branch} vs ${baseBranch}: ${stat}`);
  }
  const board = stage === 'spec' || stage === 'plan' ? otherTasks(paths, task.id) : [];
  const log = taskLogTail(`${paths.tasks}/${task.id}.md`);
  const journal = existsSync(paths.journal)
    ? readFileSync(paths.journal, 'utf8').trimEnd().split('\n').slice(-JOURNAL_LINES).join('\n')
    : '';
  return [
    '## Memory',
    '### Measured facts',
    facts.join('\n'),
    board.length ? `### Other tasks on the board (id · status · title)\n${board.join('\n')}` : '',
    log.length ? `### Task log (last ${log.length} lines)\n${log.join('\n')}` : '',
    journal ? `### Journal (last ${JOURNAL_LINES} lines of .harness/JOURNAL.md)\n${journal}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
