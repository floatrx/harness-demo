// Thin, synchronous git helpers. Every call names its repository with `-C`.

import { spawnSync } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): RunResult {
  const result = spawnSync(command, args, { cwd, env: env ?? process.env, encoding: 'utf8', maxBuffer: 64 << 20 });
  return {
    code: result.status ?? (result.error ? 127 : 1),
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '') + (result.error ? String(result.error) : ''),
  };
}

export function sh(command: string, cwd: string, env?: NodeJS.ProcessEnv): RunResult {
  return run('sh', ['-c', command], cwd, env);
}

export class GitError extends Error {
  override name = 'GitError';
}

export function git(repo: string, args: string[]): string {
  const result = run('git', ['-C', repo, ...args], repo);
  if (result.code !== 0) throw new GitError(`git ${args.join(' ')}: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

export function tryGit(repo: string, args: string[]): RunResult {
  return run('git', ['-C', repo, ...args], repo);
}

export function isRepo(path: string): boolean {
  return tryGit(path, ['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';
}

export function head(repo: string): string {
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

export function currentBranch(repo: string): string {
  return git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

export function branchExists(repo: string, branch: string): boolean {
  return tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0;
}

/** `refs/remotes/*` → sha. A push moves one of these; so does a fetch, which a unit must not run either. */
export function remoteRefs(repo: string): Record<string, string> {
  const out = git(repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes']);
  return Object.fromEntries(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ') as [string, string]),
  );
}

export interface DirtyEntry {
  path: string;
  /** Two-letter porcelain code, e.g. ` M`, `??`, `A `. */
  code: string;
}

/** Uncommitted paths (tracked changes and untracked files, one per file). */
export function dirty(repo: string): DirtyEntry[] {
  const out = git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const entries: DirtyEntry[] = [];
  const parts = out.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    const code = part.slice(0, 2);
    entries.push({ code, path: part.slice(3) });
    // A rename carries its source path as the next field.
    if (code.startsWith('R') || code.startsWith('C')) i++;
  }
  return entries;
}

export function commitsBetween(repo: string, from: string, to: string): string[] {
  return git(repo, ['rev-list', `${from}..${to}`])
    .split('\n')
    .filter(Boolean);
}

export function changedFilesBetween(repo: string, from: string, to: string): string[] {
  return git(repo, ['diff', '--name-only', from, to]).split('\n').filter(Boolean);
}
