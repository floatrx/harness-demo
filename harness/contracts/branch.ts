// Branch contract — what the runner may push for delivery: the task branch, ahead of the base branch, holding only
// commits the runner made (`T-NNN: …`). An agent never commits (the scope contract stops that), so a foreign commit
// here means a human worked on the branch: the runner does not publish it on their behalf. The working tree is not
// checked: a push sends commits, never the tree (narrow every check).

import { branchExists, tryGit } from '../git.ts';

export interface BranchCheck {
  ok: boolean;
  reason: string | null;
  /** `base..branch`, oldest first, as `<short sha> <subject>`. */
  commits: string[];
}

export function checkBranch(project: string, branch: string | null, base: string, id: string): BranchCheck {
  const fail = (reason: string, commits: string[] = []): BranchCheck => ({ ok: false, reason, commits });
  if (!branch) return fail(`${id} has no branch: nothing was implemented`);
  if (!branchExists(project, branch)) return fail(`no branch ${branch}`);
  const log = tryGit(project, ['log', '--reverse', '--format=%h %s', `${base}..${branch}`]);
  if (log.code !== 0) return fail(`git log ${base}..${branch}: ${log.stderr.trim()}`);
  const commits = log.stdout.split('\n').filter(Boolean);
  if (!commits.length) return fail(`${branch} has no commits beyond ${base}`);
  const foreign = commits.filter((line) => !line.slice(line.indexOf(' ') + 1).startsWith(`${id}:`));
  if (foreign.length) return fail(`commits the runner did not make: ${foreign.slice(0, 3).join('; ')}`, commits);
  return { ok: true, reason: null, commits };
}
