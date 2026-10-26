/* Server-only: every mutation the dashboard can make. Route handlers delegate here, so the guards are tested with
   plain Request objects (`node --test dashboard/`).

   Guards, in order:
   1. the request carries `x-harness: 1` — a cross-site form cannot set a custom header;
   2. the project is registered and the task exists;
   3. the task is not in the unit that is running now (the runner owns its file until the unit ends);
   4. the move is a HUMAN transition the core allows from the task's status (the core throws otherwise).
   Writes are atomic (`saveTask`: temp file + rename). */

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig, transitionContext } from '@harness/core/config';
import { readRunning, tracePaths } from '@harness/core/paths';
import { ProjectError, addProject, listProjects, removeProject } from '@harness/core/projects';
import { lockHolder } from '@harness/core/supervise';
import { type TaskDoc } from '@harness/core/task/parse';
import { loadTask, nextTaskId, saveHumanTask } from '@harness/core/task/task';
import { KINDS, type Kind } from '@harness/core/task/transitions';
import {
  OwnershipError,
  TransitionError,
  accept,
  answerQuestion,
  approve,
  comment,
  createTask,
  reopen,
  revise,
  submit,
} from '@harness/core/task/write';
import { ProjectNotFound, findProject } from './board.ts';

export const MUTATION_HEADER = 'x-harness';

export const TASK_ACTIONS = ['submit', 'approve', 'revise', 'accept', 'comment', 'answer', 'reopen'] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export interface AnswerInput {
  id: string;
  letter: string;
  note?: string;
}

class HttpError extends Error {
  override name = 'HttpError';
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function guardHeader(request: Request): void {
  if (request.headers.get(MUTATION_HEADER) !== '1') throw new HttpError(403, `missing the ${MUTATION_HEADER} header`);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  try {
    const body = JSON.parse(text) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'the body is not JSON');
  }
}

function change(action: TaskAction, doc: TaskDoc, body: Record<string, unknown>, projectPath: string): TaskDoc {
  const config = loadConfig(projectPath);
  const ctx = transitionContext(config);
  switch (action) {
    case 'submit':
      return submit(doc, ctx);
    case 'approve':
      return approve(doc, ctx);
    case 'accept':
      return accept(doc, ctx);
    case 'reopen':
      return reopen(doc, ctx);
    case 'revise': {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) throw new HttpError(400, 'a revision needs a comment');
      return revise(doc, text, ctx);
    }
    case 'comment': {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) throw new HttpError(400, 'a comment needs text');
      return comment(doc, text, config.limits.prototypeRounds, ctx);
    }
    case 'answer': {
      const answers = Array.isArray(body.answers) ? (body.answers as AnswerInput[]) : [];
      if (!answers.length) throw new HttpError(400, 'no answers');
      /* All answers land in one write: the runner never sees a half-answered interview. */
      return answers.reduce(
        (next, answer) => answerQuestion(next, String(answer.id), String(answer.letter), answer.note ?? ''),
        doc,
      );
    }
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json(error.status, { error: error.message });
  if (error instanceof ProjectNotFound) return json(404, { error: error.message });
  if (error instanceof ProjectError) return json(400, { error: error.message });
  if (error instanceof TransitionError || error instanceof OwnershipError) return json(409, { error: error.message });
  throw error;
}

/** POST /api/p/:id/tasks/:task/:action */
export async function handleTaskAction(
  request: Request,
  projectId: string,
  taskId: string,
  action: string,
): Promise<Response> {
  try {
    guardHeader(request);
    if (!(TASK_ACTIONS as readonly string[]).includes(action)) throw new HttpError(404, `unknown action ${action}`);
    if (!/^T-\d{3,}$/.test(taskId)) throw new HttpError(404, `no task ${taskId}`);
    const project = findProject(projectId);
    const paths = tracePaths(project.path);
    const running = readRunning(paths);
    if (running?.task === taskId)
      throw new HttpError(
        409,
        `${taskId} is in unit ${running.unit} (${running.stage}) right now; wait or pause first`,
      );
    const file = join(paths.tasks, `${taskId}.md`);
    let doc: TaskDoc;
    try {
      doc = loadTask(file).doc;
    } catch {
      throw new HttpError(404, `no task ${taskId}`);
    }
    const next = change(action as TaskAction, doc, await readBody(request), project.path);
    saveHumanTask(file, next);
    const fields = loadTask(file).fields;
    return json(200, { id: fields.id, status: fields.status, prototype: fields.prototype });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/p/:id/tasks — a new draft. */
export async function handleCreateTask(request: Request, projectId: string): Promise<Response> {
  try {
    guardHeader(request);
    const project = findProject(projectId);
    const body = await readBody(request);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
    if (!title) throw new HttpError(400, 'a task needs a title');
    const kind = typeof body.kind === 'string' && body.kind ? body.kind : null;
    if (kind && !(KINDS as readonly string[]).includes(kind))
      throw new HttpError(400, `kind is one of ${KINDS.join(', ')}`);
    const tasks = tracePaths(project.path).tasks;
    const id = nextTaskId(tasks);
    saveHumanTask(
      join(tasks, `${id}.md`),
      createTask({ id, title, draft: draft || title, ...(kind ? { kind: kind as Kind } : {}) }),
    );
    return json(201, { id, status: 'draft' });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/projects — registers a local git repository and creates `.harness/` in it, as `harness projects add`. */
export async function handleAddProject(request: Request): Promise<Response> {
  try {
    guardHeader(request);
    const body = await readBody(request);
    const given = typeof body.path === 'string' ? body.path.trim() : '';
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
    if (!given) throw new HttpError(400, 'a project needs a path');
    const path = given === '~' || given.startsWith('~/') ? join(homedir(), given.slice(1)) : given;
    /* A relative path would resolve against the dashboard's own folder, which is never what the human meant. */
    if (!isAbsolute(path)) throw new HttpError(400, 'give an absolute path, or one that starts with ~/');
    const known = listProjects().some((project) => project.path === resolve(path));
    const project = addProject(path, name);
    return json(known ? 200 : 201, project);
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/projects/:id/remove — forgets a project. Its files stay; refused while a supervisor runs it. */
export async function handleRemoveProject(request: Request, projectId: string): Promise<Response> {
  try {
    guardHeader(request);
    const project = findProject(projectId);
    const holder = lockHolder(project.path);
    if (holder) throw new HttpError(409, `a supervisor runs ${project.name} (pid ${holder}); stop it first`);
    removeProject(project.id);
    return json(200, { id: project.id, removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
