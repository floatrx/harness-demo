// `harness example <dest>`: a standalone copy of `examples/app` to run the loop on.
//
// A project is its own git repository — the runner creates task branches and commits in it — so the example
// is never driven in place inside this repository. The copy gets `git init`, its dependencies, one initial
// commit, and a registry entry. Its seed tasks are on disk but not committed (`.harness/tasks/` is ignored).

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, run } from './git.ts';
import { type Project, ProjectError, addProject, initProject } from './projects.ts';
import { tracePaths } from './paths.ts';
import { getSection, normalizeBody, putSection, setField } from './task/parse.ts';
import { listTaskFiles, loadTask, saveTask } from './task/task.ts';
import { stamp } from './task/write.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const EXAMPLE_TEMPLATE = join(REPO_ROOT, 'examples', 'app');

/** Paths of the template that never travel: build output, installs, loop state. */
const SKIP = new Set(['node_modules', '.next', 'next-env.d.ts', 'tsconfig.tsbuildinfo']);
const SKIP_HARNESS = ['.harness/trace', '.harness/artifacts'];

export interface ExampleOptions {
  install?: boolean;
  name?: string;
  template?: string;
  log?: (line: string) => void;
}

export function createExample(dest: string, options: ExampleOptions = {}): Project {
  const template = options.template ?? EXAMPLE_TEMPLATE;
  const target = resolve(dest);
  const log = options.log ?? (() => undefined);
  if (existsSync(target) && readdirSync(target).length) throw new ProjectError(`${target} exists and is not empty`);
  const inside = relative(REPO_ROOT, target);
  if (!inside.startsWith('..') && !inside.startsWith('/'))
    throw new ProjectError(`${target} is inside the harness repository — pick a folder outside it`);

  cpSync(template, target, {
    recursive: true,
    filter: (source) => {
      const rel = relative(template, source);
      return !SKIP.has(basename(source)) && !SKIP_HARNESS.some((skip) => rel === skip || rel.startsWith(`${skip}/`));
    },
  });
  log(`copied ${relative(process.cwd(), template) || template} → ${target}`);
  stampSeeds(target);

  git(target, ['init', '--quiet', '-b', 'main']);
  initProject(target);
  if (options.install !== false) {
    log('pnpm install …');
    const result = run('pnpm', ['install', '--ignore-workspace'], target);
    if (result.code !== 0) throw new ProjectError(`pnpm install failed in ${target}:\n${result.stderr.slice(-800)}`);
  }
  git(target, ['add', '--all']);
  const commit = run('git', ['-C', target, 'commit', '--quiet', '-m', 'chore: example app from harness-demo'], target);
  if (commit.code !== 0)
    throw new ProjectError(
      `git commit failed in ${target} — set git user.name and user.email, then commit by hand:\n${commit.stderr.trim()}`,
    );
  log('initial commit on main');
  const project = addProject(target, options.name ?? basename(target));
  log(`registered ${project.id} · ${project.name}`);
  return project;
}

/**
 * The seeds carry the template's dates; a copy made today showed "Created 25 Oct" (quickstart review). Each seed gets
 * the copy's date in `created` and in its `created · human` log line. Only the seeds' own fields change.
 */
function stampSeeds(target: string, date = new Date()): void {
  for (const file of listTaskFiles(tracePaths(target).tasks)) {
    const doc = loadTask(file).doc;
    setField(doc, 'created', stamp(date).slice(0, 10));
    const log = getSection(doc, 'Log') ?? '';
    putSection(doc, 'Log', normalizeBody(log.replace(/^- .*? created · human$/m, `- ${stamp(date)} created · human`)));
    saveTask(file, doc);
  }
}
