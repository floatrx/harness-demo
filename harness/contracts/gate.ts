// Gate contract: the task's `gate:` (or the project default) must be green before the runner commits.
//
// Narrowed, because a check that fails a unit for a defect the unit did not cause is the most expensive
// bug a loop can have: when the gate is red, it is re-run at the unit's base commit in a throwaway
// worktree. Red there too ⇒ the defect is inherited (collateral) and does not fail the unit.

import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, sh, tryGit } from '../git.ts';

export interface GateResult {
  ok: boolean;
  /** Red now and red at base: inherited, not caused by the unit. */
  collateral: boolean;
  command: string | null;
  output: string;
}

const tail = (text: string, lines = 20) => text.trimEnd().split('\n').slice(-lines).join('\n');

export function runGate(project: string, command: string | null, base: string | null): GateResult {
  if (!command) return { ok: true, collateral: false, command, output: 'no gate configured' };
  const now = sh(command, project);
  if (now.code === 0) return { ok: true, collateral: false, command, output: tail(now.stdout) };
  const output = tail(`${now.stdout}\n${now.stderr}`);
  if (!base) return { ok: false, collateral: false, command, output };
  return redAtBase(project, command, base)
    ? { ok: true, collateral: true, command, output }
    : { ok: false, collateral: false, command, output };
}

/** Runs the gate at `base` in a detached throwaway worktree. node_modules is linked, not installed. */
export function redAtBase(project: string, command: string, base: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'harness-base-'));
  const tree = join(dir, 'tree');
  try {
    git(project, ['worktree', 'add', '--detach', '--quiet', tree, base]);
    const modules = join(project, 'node_modules');
    if (existsSync(modules)) symlinkSync(modules, join(tree, 'node_modules'));
    return sh(command, tree).code !== 0;
  } finally {
    tryGit(project, ['worktree', 'remove', '--force', tree]);
    rmSync(dir, { recursive: true, force: true });
  }
}
