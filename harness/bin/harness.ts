#!/usr/bin/env node
// harness — the CLI. The dashboard calls the same functions and writes the same files.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { readRunning, tracePaths } from '../paths.ts';
import { addProject, listProjects, removeProject, resolveProject } from '../projects.ts';
import { describeQueue, previewUnit, runUnit } from '../runner.ts';
import { baseAgentsDir, loadRegistry, registryProblems, standingRulesDrift, syncStandingRules } from '../agents.ts';
import { runCases } from '../selftest.ts';
import { createExample } from '../example.ts';
import { lockHolder, requestPause, requestResume, requestStop, supervise } from '../supervise.ts';
import { type TaskDoc } from '../task/parse.ts';
import { loadTask, nextTaskId, saveTask } from '../task/task.ts';
import { KINDS, type Kind } from '../task/transitions.ts';
import { validateTask } from '../task/validate.ts';
import { accept, answerQuestion, approve, comment, createTask, reopen, submit } from '../task/write.ts';
import { transitionContext } from '../config.ts';

const HELP = `harness — an autonomous task harness for Claude Code

Projects
  harness example <dest> [--name <name>] [--no-install]   a standalone copy of examples/app, git-initialised and registered
  harness projects list
  harness projects add <path> [--name <name>]      register a git repo, create .harness/ in it
  harness projects remove <id|name>                 unregister (never deletes files)

Tasks (human actions — the same transitions the dashboard offers)
  harness new --title <text> [--draft <text>] [--kind ui|logic|docs|chore]
  harness submit  <T-NNN>                           draft → spec
  harness answer  <T-NNN> <Qn> <letter> [note]      answer an open question
  harness approve <T-NNN>                           planned → prototype (ui) | ready
  harness comment <T-NNN> <text>                    prototype review → drafting
  harness accept  <T-NNN>                           prototype review → ready
  harness reopen  <T-NNN>                           parked → the status it was parked from

Loop
  harness run [--once-through] [--deadline <minutes>] [--max-units <n>]
  harness unit                                      run exactly one unit (exit code = runner code)
  harness pause | resume | stop                     files read at the unit boundary
  harness status [--json]
  harness self-test                                 every contract case on a throwaway repo

Agents and prompts
  harness agents [--check] [--sync]                 the registry (base + project), drift and model checks
  harness preview <T-NNN>                           the exact prompt and argv the next unit would get (no tokens)

Every command but projects/self-test takes --project <path|id|name> (default: the current folder).
Env: AGENT_CMD overrides the agent command (the fake agent: node harness/testkit/fake-agent.ts).

Runner exit codes: 0 done · 1 hard stop (task parked) · 2 broken config · 3 nothing to take · 4 agent could not run
Supervisor exit codes: 0 stopped/drained · 2 broken config · 3 barren · 4 gave up waiting for the agent`;

function fail(message: string, code = 2): never {
  console.error(`harness: ${message}`);
  process.exit(code);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string', short: 'p' },
    name: { type: 'string' },
    title: { type: 'string' },
    draft: { type: 'string' },
    kind: { type: 'string' },
    'once-through': { type: 'boolean' },
    check: { type: 'boolean' },
    'no-install': { type: 'boolean' },
    sync: { type: 'boolean' },
    deadline: { type: 'string' },
    'max-units': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, ...args] = positionals;
const log = (line: string) => console.log(line);

function project(): string {
  try {
    return resolveProject(values.project);
  } catch (error) {
    return fail((error as Error).message);
  }
}

function taskPath(root: string, id: string | undefined): string {
  if (!id || !/^T-\d{3,}$/.test(id)) fail('expected a task id like T-001');
  const path = join(tracePaths(root).tasks, `${id}.md`);
  if (!existsSync(path)) fail(`no task ${id} in ${root}`);
  return path;
}

/** A human action: refused while the task is in flight, then validated and written atomically. */
function act(change: (doc: TaskDoc) => TaskDoc): void {
  const root = project();
  const path = taskPath(root, args[0]);
  const running = readRunning(tracePaths(root));
  if (running && running.task === args[0]) fail(`${args[0]} is in a running unit (${running.stage}); pause first`, 1);
  try {
    const next = change(loadTask(path).doc);
    saveTask(path, next);
    const fields = loadTask(path).fields;
    console.log(`${fields.id} · ${fields.status}${fields.prototype ? ` (${fields.prototype})` : ''}`);
  } catch (error) {
    fail((error as Error).message, 1);
  }
}

async function main(): Promise<void> {
  if (!command || values.help) {
    console.log(HELP);
    return;
  }
  switch (command) {
    case 'projects': {
      const [sub, arg] = args;
      if (sub === 'add') {
        if (!arg) fail('projects add <path>');
        const added = addProject(arg, values.name);
        console.log(`${added.id} · ${added.name} · ${added.path}`);
      } else if (sub === 'remove') {
        if (!arg) fail('projects remove <id|name>');
        const removed = removeProject(arg);
        console.log(`removed ${removed.id} · ${removed.name} (files untouched)`);
      } else {
        for (const item of listProjects()) console.log(`${item.id} · ${item.name} · ${item.path}`);
      }
      return;
    }
    case 'example': {
      if (!args[0]) fail('example <dest> [--name <name>] [--no-install]');
      try {
        const created = createExample(args[0], {
          install: !values['no-install'],
          ...(values.name ? { name: values.name } : {}),
          log,
        });
        console.log(
          `\nnext:\n  harness submit T-002 --project ${created.name}\n  harness run --project ${created.name} --once-through`,
        );
      } catch (error) {
        fail((error as Error).message);
      }
      return;
    }
    case 'new': {
      const root = project();
      if (!values.title) fail('new --title <text> [--draft <text>]');
      if (values.kind && !(KINDS as readonly string[]).includes(values.kind)) fail(`--kind: ${KINDS.join(' | ')}`);
      const tasks = tracePaths(root).tasks;
      const id = nextTaskId(tasks);
      const doc = createTask({
        id,
        title: values.title,
        draft: values.draft ?? values.title,
        ...(values.kind ? { kind: values.kind as Kind } : {}),
      });
      saveTask(join(tasks, `${id}.md`), doc);
      console.log(`${id} · draft · ${join(tasks, `${id}.md`)}`);
      return;
    }
    case 'submit':
      return act((doc) => submit(doc, transitionContext(loadConfig(project()))));
    case 'approve':
      return act((doc) => approve(doc, transitionContext(loadConfig(project()))));
    case 'accept':
      return act((doc) => accept(doc, transitionContext(loadConfig(project()))));
    case 'reopen':
      return act((doc) => reopen(doc, transitionContext(loadConfig(project()))));
    case 'comment': {
      const text = args.slice(1).join(' ');
      if (!text) fail('comment <T-NNN> <text>');
      const config = loadConfig(project());
      return act((doc) => comment(doc, text, config.limits.prototypeRounds, transitionContext(config)));
    }
    case 'answer': {
      const [, question, letter, ...note] = args;
      if (!question || !letter) fail('answer <T-NNN> <Qn> <letter> [note]');
      return act((doc) => answerQuestion(doc, question, letter, note.join(' ')));
    }
    case 'run': {
      const root = project();
      const minutes = values.deadline ? Number(values.deadline) : undefined;
      if (minutes !== undefined && !(minutes > 0)) fail('--deadline <minutes>');
      const result = await supervise(root, {
        log,
        onceThrough: Boolean(values['once-through']),
        ...(minutes ? { deadline: Date.now() + minutes * 60_000 } : {}),
        ...(values['max-units'] ? { maxUnits: Number(values['max-units']) } : {}),
      });
      process.exitCode = result.exit;
      return;
    }
    case 'unit': {
      const result = await runUnit(project(), { log });
      console.log(`exit ${result.exit} · ${result.message}`);
      process.exitCode = result.exit;
      return;
    }
    case 'pause':
      requestPause(project());
      console.log('pause requested: the supervisor stops at the next unit boundary');
      return;
    case 'resume':
      console.log(requestResume(project()) ? 'resumed' : 'was not paused');
      return;
    case 'stop':
      requestStop(project());
      console.log('stop requested: the supervisor exits at the next unit boundary');
      return;
    case 'status': {
      const root = project();
      const paths = tracePaths(root);
      const tasks = describeQueue(root);
      const state = {
        project: root,
        supervisor: lockHolder(root),
        paused: existsSync(paths.pause),
        stopping: existsSync(paths.stop),
        running: readRunning(paths),
        tasks: tasks.map((task) => ({
          ...task,
          issues: validateTask(loadTask(join(paths.tasks, `${task.id}.md`)).doc).map((issue) => issue.message),
        })),
      };
      if (values.json) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }
      console.log(
        `supervisor: ${state.supervisor ? `pid ${state.supervisor}` : 'not running'}${state.paused ? ' · PAUSED' : ''}${state.stopping ? ' · STOP requested' : ''}`,
      );
      if (state.running)
        console.log(`running: unit ${state.running.unit} · ${state.running.task} · ${state.running.stage}`);
      for (const task of state.tasks) {
        console.log(
          `${task.id}  ${task.status.padEnd(12)} ${task.title}${task.parked ? `\n        parked: ${task.parked}` : ''}`,
        );
        for (const issue of task.issues) console.log(`        ! ${issue}`);
      }
      return;
    }
    case 'agents': {
      if (values.sync) {
        const changed = syncStandingRules();
        console.log(changed.length ? `synced ${changed.length} file(s)` : 'every base agent carries the current rules');
        return;
      }
      const root = values.project ? project() : null;
      const registry = loadRegistry(root);
      const config = root ? loadConfig(root) : null;
      for (const agent of registry) {
        const model = (config?.roles.models as Record<string, string> | undefined)?.[agent.name] ?? agent.model;
        console.log(
          `${agent.name.padEnd(12)} ${agent.source.padEnd(8)} ${String(model ?? '-').padEnd(7)} [${agent.stages.join(', ') || 'any'}] ${agent.when}`,
        );
      }
      const drift = standingRulesDrift();
      const problems = config ? registryProblems(registry, config) : [];
      console.log(`\nbase: ${baseAgentsDir()}`);
      for (const path of drift) console.log(`! standing rules drifted: ${path} — run \`harness agents --sync\``);
      for (const problem of problems) console.log(`! ${problem}`);
      if (values.check && (drift.length || problems.length)) process.exitCode = 2;
      else if (values.check) console.log('ok: no drift, no model clash');
      return;
    }
    case 'preview': {
      const root = project();
      try {
        const preview = previewUnit(root, args[0] ?? '');
        console.log(`# ${preview.task} · stage ${preview.stage} · coordinator ${preview.role}`);
        console.log(`# specialists: ${preview.specialists.join(', ') || '(none)'}`);
        console.log(
          `# argv: ${preview.invocation.file} ${preview.invocation.args.map((arg) => JSON.stringify(arg)).join(' ')}`,
        );
        console.log(`# prompt (${preview.prompt.length} chars) — sent on stdin:\n`);
        console.log(preview.prompt);
      } catch (error) {
        fail((error as Error).message, 1);
      }
      return;
    }
    case 'self-test': {
      console.log(
        'harness self-test — every case runs the real runner on a throwaway git repo, fake agent, zero tokens\n',
      );
      const outcomes = await runCases(undefined, (outcome) =>
        console.log(`${outcome.ok ? '✓' : '✗'} ${outcome.name}\n    ${outcome.detail}`),
      );
      const failed = outcomes.filter((outcome) => !outcome.ok).length;
      console.log(`\n${outcomes.length - failed}/${outcomes.length} cases passed`);
      process.exitCode = failed ? 1 : 0;
      return;
    }
    default:
      fail(`unknown command: ${command}\n\n${HELP}`);
  }
}

await main();
