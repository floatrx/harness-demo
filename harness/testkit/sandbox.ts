// A throwaway project for loop tests: a git repo in a temp folder with a bare `origin`, `.harness/`
// initialised, nothing shared with the repository the tests run from.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../git.ts';
import { tracePaths } from '../paths.ts';
import { initProject } from '../projects.ts';
import { type TaskDoc, normalizeBody, parseTask, putSection, setField } from '../task/parse.ts';
import { type LoadedTask, loadTask, saveTask } from '../task/task.ts';
import type { Kind, Status } from '../task/transitions.ts';
import { createTask } from '../task/write.ts';
import type { Scenario } from './fake-agent.ts';

export const FAKE_AGENT = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));
export const FAKE_GH = fileURLToPath(new URL('./fake-gh.ts', import.meta.url));

export interface Sandbox {
  root: string;
  project: string;
  scenarioPath: string;
  /** Agent options for runUnit / supervise; `gh` is the fake GitHub CLI (delivery). */
  agent: { agentCommand: string; env: Record<string, string>; gh: string };
  /** Every fake `gh` call so far, argv per call. */
  ghCalls(): string[][];
  scenario(value: Scenario): void;
  task(id: string): LoadedTask;
  taskPath(id: string): string;
  git(args: string[]): string;
  cleanup(): void;
}

export const FAST_SUPERVISOR = {
  barrenUnits: 3,
  idlePollSeconds: 0.1,
  pausePollSeconds: 0.05,
  usageProbeSeconds: 0.05,
  usageNapSeconds: 0.1,
  usageCeilingSeconds: 1,
};

export function makeSandbox(config: Record<string, unknown> = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'harness-sandbox-'));
  const project = join(root, 'project');
  const origin = join(root, 'origin.git');
  mkdirSync(project);
  git(root, ['init', '--quiet', '--bare', origin]);
  git(project, ['init', '--quiet', '-b', 'main']);
  git(project, ['config', 'user.name', 'Harness Test']);
  git(project, ['config', 'user.email', 'harness-test@example.invalid']);
  git(project, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(project, 'src'));
  writeFileSync(join(project, 'README.md'), '# sandbox\n');
  writeFileSync(join(project, 'src', 'app.txt'), 'app\n');
  initProject(project, { supervisor: FAST_SUPERVISOR, ...config });
  // An empty token switches Telegram off here, whatever ~/.harness/.env holds: a test never pings a real chat.
  writeFileSync(join(project, '.env'), 'TELEGRAM_BOT_TOKEN=\n');
  git(project, ['add', 'README.md', 'src', '.gitignore']);
  git(project, ['commit', '--quiet', '-m', 'init']);
  git(project, ['remote', 'add', 'origin', origin]);
  git(project, ['push', '--quiet', '-u', 'origin', 'main']);

  const scenarioPath = join(root, 'scenario.json');
  const ghLog = join(root, 'gh.log');
  writeFileSync(scenarioPath, '{}');
  const taskPath = (id: string) => join(tracePaths(project).tasks, `${id}.md`);
  return {
    root,
    project,
    scenarioPath,
    agent: {
      agentCommand: `node ${JSON.stringify(FAKE_AGENT)}`,
      env: { HARNESS_FAKE_SCENARIO: scenarioPath },
      gh: `HARNESS_FAKE_GH_LOG=${JSON.stringify(ghLog)} node ${JSON.stringify(FAKE_GH)}`,
    },
    ghCalls: () =>
      existsSync(ghLog)
        ? readFileSync(ghLog, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as string[])
        : [],
    scenario: (value) => writeFileSync(scenarioPath, JSON.stringify(value, null, 2)),
    task: (id) => loadTask(taskPath(id)),
    taskPath,
    git: (args) => git(project, args),
    // `root` is the exact mkdtemp result — nothing else is ever removed.
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface Seed {
  id?: string;
  title?: string;
  status?: Status;
  kind?: Kind;
  scope?: string[];
  closes?: string[];
  gate?: string;
}

/** Writes a task straight into the corpus at any status, as if the earlier stages had run. */
export function seedTask(sandbox: Sandbox, seed: Seed = {}): string {
  const id = seed.id ?? 'T-001';
  const doc: TaskDoc = createTask({ id, title: seed.title ?? 'Add the feature file', draft: 'Write the feature.' });
  setField(doc, 'status', seed.status ?? 'spec');
  setField(doc, 'kind', seed.kind ?? 'logic');
  if (seed.scope) setField(doc, 'scope', seed.scope);
  if (seed.gate) setField(doc, 'gate', seed.gate);
  if (seed.status === 'prototype') setField(doc, 'prototype', 'drafting');
  if (seed.closes)
    putSection(
      doc,
      'Acceptance criteria',
      normalizeBody(seed.closes.map((command, i) => `${i + 1}. **[closes]** \`${command}\` exits 0`).join('\n')),
    );
  saveTask(sandbox.taskPath(id), doc);
  return id;
}

export function readLog(sandbox: Sandbox, id: string): string {
  return (
    parseTask(readFileSync(sandbox.taskPath(id), 'utf8')).sections.find((section) => section.name === 'Log')?.body ?? ''
  );
}
