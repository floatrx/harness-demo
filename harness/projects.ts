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

/** Lines the project's .gitignore must carry: loop state is local, never versioned. */
export const IGNORED = ['.harness/trace/', '.harness/artifacts/'];

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
  const missing = IGNORED.filter((line) => !current.split('\n').includes(line));
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
  if (!existsSync(join(abs, '.harness'))) throw new ProjectError(`${abs} is not a harness project (no .harness/)`);
  return abs;
}
