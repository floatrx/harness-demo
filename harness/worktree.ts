// The task's own git worktree. Code units (prototype, implement, qa, judge) run in `.harness/worktrees/T-NNN` on the
// task branch, so the main checkout stays on the base branch and several tasks can be worked on side by side.
//
// The task file, its artifacts and the journal stay in the main checkout. The worktree reaches them through symlinks
// with the same relative paths, so a prompt that names `.harness/tasks/T-NNN.md` works from either tree.

import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ConfigError } from './config.ts';
import { branchExists, currentBranch, git, sh, tryGit } from './git.ts';

/** Links from the worktree to the main checkout's loop files (relative to either tree's root). */
export const WORKTREE_LINKS = ['.harness/tasks', '.harness/artifacts', '.harness/JOURNAL.md'] as const;

/**
 * Lines for the repository's shared `info/exclude`: the links are symlinks, and a folder pattern such as the project's
 * own `node_modules/` does not hide a symlink. Also the worktrees folder, for a project whose `.gitignore` predates it.
 */
const EXCLUDES = ['/node_modules', ...WORKTREE_LINKS.map((link) => `/${link}`), '/.harness/worktrees/'];

export function worktreePath(project: string, id: string): string {
  return join(project, '.harness', 'worktrees', id);
}

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const present = (path: string) => existsSync(path) || isLink(path);

/** Appends the missing exclude lines (idempotent). `info/exclude` is one file for the repository and its worktrees. */
export function ensureExcludes(project: string): void {
  const file = resolve(project, git(project, ['rev-parse', '--git-path', 'info/exclude']).trim());
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = current.split('\n');
  const missing = EXCLUDES.filter((line) => !lines.includes(line));
  if (!missing.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

export interface TaskTree {
  /** Absolute path of the worktree. */
  tree: string;
  /** What the runner did to get it, for the task Log (empty when it already existed). */
  notes: string[];
}

/**
 * The task's worktree on `branch`, made when missing: from `base` with a new branch, or from the existing branch (a
 * task that started before worktrees). A new worktree gets the links and its setup: `setup` run in it, or the main
 * checkout's `node_modules` linked. A failed setup removes the worktree again and throws a ConfigError.
 */
export function ensureWorktree(
  project: string,
  id: string,
  branch: string,
  base: string,
  setup: string | null,
): TaskTree {
  const tree = worktreePath(project, id);
  const notes: string[] = [];
  ensureExcludes(project);
  if (!existsSync(join(tree, '.git'))) {
    // Forget a worktree whose folder is gone (a crash, a manual delete) before making it again.
    tryGit(project, ['worktree', 'prune']);
    mkdirSync(dirname(tree), { recursive: true });
    if (branchExists(project, branch)) {
      git(project, ['worktree', 'add', '--quiet', tree, branch]);
      notes.push(`worktree .harness/worktrees/${id} made from ${branch}`);
    } else {
      git(project, ['worktree', 'add', '--quiet', '-b', branch, tree, base]);
      notes.push(`worktree .harness/worktrees/${id} made on a new ${branch} from ${base}`);
    }
    linkLoopFiles(project, tree);
    const done = runSetup(project, tree, setup);
    if (done) notes.push(done);
  } else {
    linkLoopFiles(project, tree);
    if (currentBranch(tree) !== branch) git(tree, ['checkout', '--quiet', branch]);
  }
  return { tree, notes };
}

function linkLoopFiles(project: string, tree: string): void {
  mkdirSync(join(project, '.harness', 'tasks'), { recursive: true });
  mkdirSync(join(project, '.harness', 'artifacts'), { recursive: true });
  // A link to a missing file is a trap for every tool that writes through it; the journal exists, empty if new.
  const journal = join(project, '.harness', 'JOURNAL.md');
  if (!existsSync(journal)) writeFileSync(journal, '');
  for (const link of WORKTREE_LINKS) {
    const at = join(tree, link);
    if (present(at)) continue;
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(join(project, link), at);
  }
}

function runSetup(project: string, tree: string, setup: string | null): string | null {
  if (setup) {
    const result = sh(setup, tree);
    if (result.code === 0) return `setup \`${setup}\` ran in the worktree`;
    const why = (result.stderr.trim() || result.stdout.trim()).split('\n').at(-1)?.slice(0, 200) ?? '';
    removeWorktree(project, tree);
    throw new ConfigError(`worktree.setup \`${setup}\` failed (exit ${result.code}): ${why}`);
  }
  const modules = join(project, 'node_modules');
  const at = join(tree, 'node_modules');
  if (!existsSync(modules) || present(at)) return null;
  symlinkSync(modules, at);
  return 'node_modules linked from the main checkout';
}

/**
 * Removes a worktree after its task is delivered (or done without delivery); the branch stays — it carries the pull
 * request. The runner's own links are unlinked first, by exact path, so nothing behind them is touched. Returns a
 * line for the progress log, or null when there was no worktree.
 */
export function removeWorktree(project: string, tree: string): string | null {
  if (!existsSync(tree)) return null;
  for (const link of [...WORKTREE_LINKS, 'node_modules']) {
    const at = join(tree, link);
    if (isLink(at)) unlinkSync(at);
  }
  const result = tryGit(project, ['worktree', 'remove', '--force', tree]);
  if (result.code !== 0) return `could not remove the worktree ${tree}: ${result.stderr.trim().split('\n')[0] ?? ''}`;
  return `worktree ${tree.slice(project.length + 1)} removed`;
}
