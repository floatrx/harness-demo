// Scope contract: what a unit may change. Checked by code after the agent exits; the agent is only told.
//
// - the branch is the one the runner checked out;
// - HEAD did not move — the runner commits, an agent never does;
// - no remote-tracking ref moved — no push, no fetch;
// - every newly dirty file is inside the unit's allowed pathspec;
// - under `.harness/`, only the task's own file, its artifacts folder and the journal change.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { currentBranch, dirty, git, head, remoteRefs, tryGit } from '../git.ts';

export interface Snapshot {
  branch: string;
  head: string;
  remotes: Record<string, string>;
  /** Dirty paths outside `.harness/` before the unit — normally none. */
  dirty: Set<string>;
  /** path → content for every loop-owned file under `.harness/` (trace excluded). */
  harness: Map<string, Buffer>;
}

function walk(dir: string, root: string, out: Map<string, Buffer>): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(root, path);
    if (rel === '.harness/trace') continue;
    if (statSync(path).isDirectory()) walk(path, root, out);
    else out.set(rel, readFileSync(path));
  }
}

export function harnessFiles(project: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  walk(join(project, '.harness'), project, out);
  return out;
}

export const outsideHarness = (path: string) => !path.startsWith('.harness/');

export function snapshot(project: string): Snapshot {
  return {
    branch: currentBranch(project),
    head: head(project),
    remotes: remoteRefs(project),
    dirty: new Set(
      dirty(project)
        .map((entry) => entry.path)
        .filter(outsideHarness),
    ),
    harness: harnessFiles(project),
  };
}

// ---- pathspec -------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === '*' && glob[i + 1] === '*') {
      // `**/` matches zero or more folders; a trailing `**` matches everything below.
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i++;
      }
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** A pattern without glob characters matches the file itself and everything below it as a folder. */
export function inScope(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '');
    if (!/[*?]/.test(clean)) return path === clean || path.startsWith(`${clean}/`);
    return globToRegExp(clean).test(path);
  });
}

// ---- the judgement ---------------------------------------------------------

export interface ScopeRules {
  /** The branch the unit runs on. */
  branch: string;
  /** Pathspec for files outside `.harness/`. Empty = a read-only unit. */
  allowed: readonly string[];
  /** Paths under `.harness/` the unit may write (the task file, its artifacts, the journal). */
  harnessAllowed: readonly string[];
}

export interface ScopeVerdict {
  violations: string[];
  /** Files outside `.harness/` the unit changed, all inside scope when there is no violation. */
  changed: string[];
  /** Paths under `.harness/` the unit changed. */
  harnessChanged: string[];
}

export function judgeScope(project: string, before: Snapshot, rules: ScopeRules): ScopeVerdict {
  const violations: string[] = [];
  const branch = currentBranch(project);
  if (branch !== rules.branch) violations.push(`branch switch: on ${branch}, expected ${rules.branch}`);
  const now = head(project);
  if (now !== before.head) {
    const extra = tryGit(project, ['rev-list', '--count', `${before.head}..${now}`]).stdout.trim();
    violations.push(`extra commit: HEAD moved ${before.head.slice(0, 7)} → ${now.slice(0, 7)} (${extra || '?'} new)`);
  }
  const remotes = remoteRefs(project);
  for (const ref of new Set([...Object.keys(before.remotes), ...Object.keys(remotes)])) {
    if (before.remotes[ref] !== remotes[ref]) violations.push(`push: ${ref} moved`);
  }

  const committed = now !== before.head ? diffNames(project, before.head, now) : [];
  const changed = [
    ...new Set([
      ...dirty(project)
        .map((entry) => entry.path)
        .filter((path) => outsideHarness(path) && !before.dirty.has(path)),
      ...committed.filter(outsideHarness),
    ]),
  ].sort();
  for (const path of changed) {
    if (inScope(path, rules.allowed)) continue;
    const tracked = tryGit(project, ['ls-files', '--error-unmatch', '--', path]).code === 0;
    violations.push(tracked ? `out-of-scope edit: ${path}` : `stray file: ${path}`);
  }

  const after = harnessFiles(project);
  const harnessChanged = [...new Set([...before.harness.keys(), ...after.keys()])]
    .filter((path) => {
      const a = before.harness.get(path);
      const b = after.get(path);
      return !(a && b && a.equals(b));
    })
    .sort();
  for (const path of harnessChanged) {
    if (!inScope(path, rules.harnessAllowed)) violations.push(`loop-owned file: ${path}`);
  }
  return { violations, changed, harnessChanged };
}

function diffNames(project: string, from: string, to: string): string[] {
  return git(project, ['diff', '--name-only', from, to]).split('\n').filter(Boolean);
}

// ---- quarantine -------------------------------------------------------------

/**
 * Puts the tree back where the unit found it, without losing the unit's work:
 * back to the expected branch, agent commits undone into the index (`reset --soft`), every changed file
 * outside `.harness/` moved into a named stash, and `.harness/` files other than the task file restored.
 * Returns a line for the log (the stash name), or throws when the tree cannot be restored.
 */
export function quarantine(
  project: string,
  before: Snapshot,
  label: string,
  keep: readonly string[],
  allowedNew: readonly string[],
): string {
  const notes: string[] = [];
  if (currentBranch(project) !== before.branch) {
    git(project, ['checkout', '--quiet', before.branch]);
    notes.push(`back on ${before.branch}`);
  }
  if (head(project) !== before.head) {
    git(project, ['reset', '--soft', '--quiet', before.head]);
    notes.push(`agent commits undone into the index`);
  }
  const paths = dirty(project)
    .map((entry) => entry.path)
    .filter((path) => outsideHarness(path) && !before.dirty.has(path));
  if (paths.length) {
    git(project, [
      'stash',
      'push',
      '--include-untracked',
      '--quiet',
      '-m',
      `harness quarantine: ${label}`,
      '--',
      ...paths,
    ]);
    notes.push(`${paths.length} file(s) stashed as "harness quarantine: ${label}"`);
  }
  const after = harnessFiles(project);
  for (const [path, content] of before.harness) {
    if (keep.includes(path)) continue;
    const current = after.get(path);
    if (!current || !current.equals(content)) {
      mkdirSync(dirname(join(project, path)), { recursive: true });
      writeFileSync(join(project, path), content);
      notes.push(`restored ${path}`);
    }
  }
  for (const path of after.keys()) {
    if (before.harness.has(path) || keep.includes(path) || inScope(path, allowedNew)) continue;
    // A file the unit created where it may not write: renamed, so a stray `T-999.md` is no task.
    renameSync(join(project, path), join(project, `${path}.quarantined`));
    notes.push(`renamed ${path} → ${path}.quarantined`);
  }
  return notes.join('; ');
}
