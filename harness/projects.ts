// The project registry (`$HARNESS_HOME/projects.json`, default `~/.harness`) and project init.
// A project is a local git repository; adding one creates `.harness/` in it. Removing one never deletes files.

import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DEFAULT_CONFIG, harnessDir } from './config.ts';
import { isRepo } from './git.ts';
import { atomicWrite } from './task/task.ts';

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

export function harnessHome(): string {
  return process.env.HARNESS_HOME ?? join(homedir(), '.harness');
}

function registryPath(): string {
  return join(harnessHome(), 'projects.json');
}

export function listProjects(): Project[] {
  const path = registryPath();
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8')) as Project[];
}

function saveProjects(projects: Project[]): void {
  mkdirSync(harnessHome(), { recursive: true });
  atomicWrite(registryPath(), `${JSON.stringify(projects, null, 2)}\n`);
}

export class ProjectError extends Error {
  override name = 'ProjectError';
}

/**
 * Lines the project's .gitignore must carry: loop state is local, never versioned. Task files and the journal are
 * included: the runner writes them while it switches between the base and task branches, and a versioned copy that
 * differs between branches would make a checkout fail. `config.json` stays versioned.
 */
export const IGNORED = [
  '.harness/trace/',
  '.harness/artifacts/',
  '.harness/tasks/',
  '.harness/JOURNAL.md',
  // The task worktrees (harness/worktree.ts). A project made before them gets the line in `info/exclude` instead.
  '.harness/worktrees/',
];

/** Secrets: the loop reads Telegram keys from `<project>/.env`, so that file must never be committed. */
export const SECRET_IGNORES = ['.env'];

/** Creates `.harness/` with a default config. Idempotent: an existing config is kept. */
export function initProject(path: string, overrides: Record<string, unknown> = {}): void {
  const dir = harnessDir(path);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'trace'), { recursive: true });
  const config = join(dir, 'config.json');
  if (!existsSync(config)) {
    // Only what a user sets; the rest stays a default in code, so a changed default reaches every project.
    const { baseBranch, autonomy, limits, gate, probe, deliver } = DEFAULT_CONFIG;
    const shown = { baseBranch, autonomy, limits, gate, probe, deliver };
    writeFileSync(config, `${JSON.stringify({ ...shown, ...overrides }, null, 2)}\n`);
  }
  const journal = join(dir, 'JOURNAL.md');
  if (!existsSync(journal)) writeFileSync(journal, '# Journal\n\nNotes agents leave for the next unit.\n');
  const gitignore = join(path, '.gitignore');
  const current = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  const missing = [...IGNORED, ...SECRET_IGNORES].filter((line) => !current.split('\n').includes(line));
  if (missing.length)
    appendFileSync(gitignore, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

export function addProject(path: string, name?: string): Project {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new ProjectError(`no such folder: ${abs}`);
  if (!isRepo(abs)) throw new ProjectError(`not a git repository: ${abs}`);
  const projects = listProjects();
  const known = projects.find((project) => project.path === abs);
  if (known) return known;
  initProject(abs);
  const project: Project = {
    id: randomBytes(3).toString('hex'),
    name: name ?? basename(abs),
    path: abs,
    addedAt: new Date().toISOString(),
  };
  saveProjects([...projects, project]);
  return project;
}

export function removeProject(idOrName: string): Project {
  const projects = listProjects();
  const project = projects.find((item) => item.id === idOrName || item.name === idOrName);
  if (!project) throw new ProjectError(`no project ${idOrName}`);
  saveProjects(projects.filter((item) => item !== project));
  return project;
}

/** A path, a registry id or a registry name → an absolute project path with `.harness/`. */
export function resolveProject(ref: string | undefined): string {
  if (ref) {
    const byRegistry = listProjects().find((project) => project.id === ref || project.name === ref);
    if (byRegistry) return byRegistry.path;
  }
  const abs = resolve(ref ?? '.');
  // The config, not the folder: `~/.harness/` is also the registry home, so a bare `.harness/` would make the home
  // directory look like a project.
  if (!existsSync(join(abs, '.harness', 'config.json')))
    throw new ProjectError(`${abs} is not a harness project (no .harness/config.json)`);
  return abs;
}
