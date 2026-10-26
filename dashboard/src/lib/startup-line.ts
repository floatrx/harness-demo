/* Server-only: the one line `pnpm dashboard` prints when its server starts — what Start will run, from this process's
   environment. Without it the terminal said nothing, and a dashboard started without AGENT_CMD ran real claude on
   Start (quickstart review). A project's own `agent.command` can still override; its Start button says so. */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG } from '@harness/core/config';
import { billing } from '@harness/core/runner';

/** `node /long/path/fake-agent.ts` → `node …/fake-agent.ts`. */
const shortCommand = (command: string) => command.replace(/(?:\/[^\s/]+)+\/([^\s/]+)/g, '…/$1');

export function startupLine(cwd = process.cwd()): string {
  const mode = billing(DEFAULT_CONFIG).mode;
  if (mode === 'stand-in')
    return `harness · Start runs a stand-in for claude (AGENT_CMD: ${shortCommand(process.env.AGENT_CMD ?? '')}) — no tokens`;
  if (mode === 'api-key') return 'harness · Start runs real claude -p — ANTHROPIC_API_KEY is set, billed per token';
  const fake = resolve(cwd, '..', 'harness/testkit/fake-agent.ts');
  const hint = existsSync(fake) ? ` · zero tokens: AGENT_CMD="node ${fake}" pnpm dashboard` : '';
  return `harness · Start runs real claude -p on your subscription — usage limits${hint}`;
}
