/* Server-only: Start / Pause / Resume / Stop. Start spawns `harness run` detached; the other three write the same
   control files the CLI writes (trace/PAUSE, trace/STOP), read by the supervisor at the unit boundary. The dashboard
   never signals or kills a process. */

import { spawn } from 'node:child_process';
import { openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '@harness/core/example';
import { tracePaths } from '@harness/core/paths';
import { lockHolder, requestPause, requestResume, requestStop } from '@harness/core/supervise';
import { ProjectNotFound, findProject } from './board.ts';
import { MUTATION_HEADER } from './actions.ts';

export const SUPERVISOR_COMMANDS = ['start', 'pause', 'resume', 'stop'] as const;
export type SupervisorCommand = (typeof SUPERVISOR_COMMANDS)[number];

const CLI = join(REPO_ROOT, 'harness', 'bin', 'harness.ts');
const START_WAIT_MS = 4000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const tail = (file: string) => {
  try {
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-3).join('\n');
  } catch {
    return '';
  }
};

/** Spawns the supervisor detached (it outlives the dashboard) and waits until it holds the lock. */
async function start(projectPath: string): Promise<Response> {
  const holder = lockHolder(projectPath);
  if (holder) return json(409, { error: `a supervisor already runs this project (pid ${holder})` });
  const paths = tracePaths(projectPath);
  const out = join(paths.dir, 'supervisor.out');
  const log = openSync(out, 'a');
  /* AGENT_CMD and HARNESS_HOME flow through the environment: a dashboard started with the fake agent drives it. */
  const child = spawn(process.execPath, [CLI, 'run', '--project', projectPath], {
    cwd: projectPath,
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  });
  let exitCode: number | null = null;
  child.on('exit', (code) => {
    exitCode = code ?? 1;
  });
  child.unref();
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    if (exitCode !== null) return json(500, { error: `the supervisor exited with ${exitCode}`, log: tail(out) });
    const pid = lockHolder(projectPath);
    if (pid) return json(200, { state: 'running', pid });
    await sleep(100);
  }
  return json(202, { state: 'starting', pid: child.pid ?? null });
}

/** POST /api/p/:id/supervisor/:command */
export async function handleSupervisor(request: Request, projectId: string, command: string): Promise<Response> {
  if (request.headers.get(MUTATION_HEADER) !== '1')
    return json(403, { error: `missing the ${MUTATION_HEADER} header` });
  if (!(SUPERVISOR_COMMANDS as readonly string[]).includes(command))
    return json(404, { error: `unknown command ${command}` });
  let projectPath: string;
  try {
    projectPath = findProject(projectId).path;
  } catch (error) {
    if (error instanceof ProjectNotFound) return json(404, { error: error.message });
    throw error;
  }
  const holder = lockHolder(projectPath);
  switch (command as SupervisorCommand) {
    case 'start':
      return start(projectPath);
    case 'pause':
      if (!holder) return json(409, { error: 'no supervisor runs this project' });
      requestPause(projectPath);
      return json(200, { state: 'paused', pid: holder });
    case 'resume':
      requestResume(projectPath);
      return json(200, { state: holder ? 'running' : 'stopped', pid: holder });
    case 'stop':
      if (!holder) return json(409, { error: 'no supervisor runs this project' });
      requestStop(projectPath);
      /* A paused supervisor must wake to see STOP; it polls both files, so leaving PAUSE is fine. */
      return json(200, { state: 'stopping', pid: holder });
  }
}
