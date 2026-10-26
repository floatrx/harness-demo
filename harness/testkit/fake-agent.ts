#!/usr/bin/env node
// A scripted stand-in for `claude -p`. It plays one unit per invocation, so the whole loop runs end to
// end with real git and real contract checks, and no token is spent.
//
//   AGENT_CMD="node harness/testkit/fake-agent.ts"  HARNESS_FAKE_SCENARIO=/abs/scenario.json
//
// The scenario lists steps per stage (or per `T-NNN:stage`). Each invocation consumes the next step for
// its key; past the end of the list, or with no list, the stage's default step runs. A step is a list of
// actions. Invocation counters live next to the scenario in `<scenario>.state.json`.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  getSection,
  normalizeBody,
  parseTask,
  putSection,
  reviewBlock,
  serializeTask,
  setField,
} from '../task/parse.ts';
import type { FieldValue } from '../task/yaml.ts';

export type Action =
  | { default: true }
  | { write: string; content: string }
  | { append: string; content: string }
  | { section: string; content: string }
  | { field: string; value: FieldValue }
  | { question: string; options: string[] }
  | { say: string }
  | { exec: string }
  | { sleep: number }
  | { exit: number }
  | { usageLimit: true }
  /** Looks at the app the runner started (HARNESS_APP_URL) and saves the page as a "screenshot" in the artifacts. */
  | { browse: { path?: string; save: string } }
  /** Prints stream-json like `claude -p`: an optional tool result quoting a specialist, then the final result. */
  | {
      stream: {
        quoted?: string;
        result: string;
        tokens?: number;
        costUsd?: number;
        /** Tool calls the permission mode refused, as `claude -p` reports them. */
        denials?: { tool: string; command?: string }[];
      };
    }
  /** Prints the stream-json of a coordinator dispatching one specialist, its tool calls (paced), and its result. */
  | { dispatch: { role: string; calls: { tool: string; file?: string }[]; stepMs?: number } };

export interface Scenario {
  steps?: Record<string, Action[][]>;
  defaults?: {
    scope?: string[];
    gate?: string | null;
    /** The `[closes]` command the default plan writes. */
    closes?: string;
    /** The file the default implement step writes. */
    file?: string;
  };
}

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`fake-agent: ${name} is not set`);
  return value;
};

const stage = env('HARNESS_STAGE');
const role = env('HARNESS_ROLE');
const taskId = env('HARNESS_TASK_ID');
const taskFile = env('HARNESS_TASK_FILE');
const project = env('HARNESS_PROJECT');
const artifacts = env('HARNESS_ARTIFACTS');
const scenarioPath = process.env.HARNESS_FAKE_SCENARIO;
const scenario: Scenario = scenarioPath ? (JSON.parse(readFileSync(scenarioPath, 'utf8')) as Scenario) : {};
const defaults = {
  scope: ['src/**'],
  gate: null,
  closes: 'test -f src/feature.txt',
  file: 'src/feature.txt',
  ...scenario.defaults,
};

// Drain stdin (the prompt) so the runner's write never blocks.
process.stdin.resume();
process.stdin.on('data', () => undefined);

/* A screenshot-sized drawing of a list page with a search box: what a designer's round looks like. */
const PROTOTYPE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 128" width="300" height="128">
<rect width="300" height="128" rx="8" fill="#141414"/><rect x="16" y="14" width="120" height="10" rx="3" fill="#e6e6e6"/>
<rect x="16" y="34" width="268" height="22" rx="6" fill="#1f1f1f" stroke="#d97757"/><circle cx="30" cy="45" r="5" fill="none" stroke="#d97757" stroke-width="1.6"/>
<rect x="42" y="42" width="70" height="6" rx="3" fill="#6b6b6b"/>
<rect x="16" y="68" width="190" height="8" rx="3" fill="#8a8a8a"/><rect x="250" y="68" width="34" height="8" rx="3" fill="#4d4d4d"/>
<rect x="16" y="86" width="160" height="8" rx="3" fill="#8a8a8a"/><rect x="250" y="86" width="34" height="8" rx="3" fill="#4d4d4d"/>
<rect x="16" y="104" width="176" height="8" rx="3" fill="#8a8a8a"/><rect x="250" y="104" width="34" height="8" rx="3" fill="#4d4d4d"/></svg>
`;

function nextStep(): Action[] {
  const keys = [`${taskId}:${stage}`, stage];
  const key = keys.find((name) => scenario.steps?.[name]) ?? stage;
  const list = scenario.steps?.[key] ?? [];
  const statePath = `${scenarioPath ?? join(project, '.harness/trace/fake')}.state.json`;
  const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, number>) : {};
  const index = state[`${taskId}:${key}`] ?? 0;
  state[`${taskId}:${key}`] = index + 1;
  writeFileSync(statePath, JSON.stringify(state));
  return list[index] ?? [{ default: true }];
}

function editTask(edit: (doc: ReturnType<typeof parseTask>) => void): void {
  const doc = parseTask(readFileSync(taskFile, 'utf8'));
  edit(doc);
  writeFileSync(taskFile, serializeTask(doc));
}

function defaultStep(): void {
  switch (stage) {
    case 'spec':
      editTask((doc) => putSection(doc, 'Spec', normalizeBody(`Goal: ${taskId}, written by the fake ${role}.`)));
      break;
    case 'plan':
      editTask((doc) => {
        // Like a real planner: rewrite the plan, keep the human-owned `### Review` block (plan Revise).
        const review = reviewBlock(getSection(doc, 'Plan') ?? '');
        putSection(doc, 'Plan', normalizeBody(`1. Write the feature file.\n\n${review}`));
        putSection(doc, 'Acceptance criteria', normalizeBody(`1. **[closes]** \`${defaults.closes}\` exits 0`));
        setField(doc, 'scope', defaults.scope);
        if (defaults.gate) setField(doc, 'gate', defaults.gate);
      });
      break;
    case 'prototype':
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(join(artifacts, 'prototype.svg'), PROTOTYPE_SVG);
      editTask((doc) => {
        // Like a real designer: rewrite the prototype notes, keep the human-owned `### Review` block.
        const current = getSection(doc, 'Prototype') ?? '';
        const review = reviewBlock(current);
        const round = (current.match(/^Round \d+/gm) ?? []).length + 1;
        putSection(doc, 'Prototype', normalizeBody(`Round ${round}: see ${taskId}/prototype.svg\n\n${review}`));
      });
      break;
    case 'implement': {
      const path = join(project, defaults.file);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${taskId} implemented at ${new Date().toISOString()}\n`);
      break;
    }
    case 'qa':
      console.log('qa: PASS');
      break;
    case 'judge':
      console.log('judge: CONFIRMED');
      break;
  }
}

async function play(actions: Action[]): Promise<void> {
  for (const action of actions) {
    if ('default' in action) defaultStep();
    else if ('write' in action) {
      mkdirSync(dirname(join(project, action.write)), { recursive: true });
      writeFileSync(join(project, action.write), action.content);
    } else if ('append' in action) {
      mkdirSync(dirname(join(project, action.append)), { recursive: true });
      appendFileSync(join(project, action.append), action.content);
    } else if ('section' in action) editTask((doc) => putSection(doc, action.section, normalizeBody(action.content)));
    else if ('field' in action) editTask((doc) => setField(doc, action.field, action.value));
    else if ('question' in action)
      editTask((doc) => {
        const body = getSection(doc, 'Questions') ?? '';
        const n = (body.match(/^### Q\d+/gm) ?? []).length + 1;
        const options = action.options.map((text, i) => `- (${String.fromCharCode(97 + i)}) ${text}`).join('\n');
        putSection(
          doc,
          'Questions',
          normalizeBody(`${body}\n### Q${n} · ${action.question} · open\n${options}\n> **Answer:**`),
        );
      });
    else if ('say' in action) console.log(action.say);
    else if ('exec' in action) execSync(action.exec, { cwd: project, stdio: 'ignore' });
    else if ('sleep' in action) await new Promise((resolve) => setTimeout(resolve, action.sleep));
    else if ('exit' in action) process.exit(action.exit);
    else if ('stream' in action) {
      const { quoted, result, tokens = 1000, costUsd = 0, denials = [] } = action.stream;
      if (quoted)
        console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: quoted }] } }));
      console.log(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result,
          num_turns: 3,
          total_cost_usd: costUsd,
          usage: { input_tokens: tokens, output_tokens: Math.round(tokens / 4) },
          permission_denials: denials.map((denial) => ({
            tool_name: denial.tool,
            tool_input: denial.command ? { command: denial.command } : {},
          })),
        }),
      );
    } else if ('dispatch' in action) {
      const { role, calls, stepMs = 400 } = action.dispatch;
      const agentId = `toolu_fake_${role}_${Date.now().toString(36)}`;
      const emit = (event: Record<string, unknown>) => console.log(JSON.stringify(event));
      emit({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: 'tool_use',
              id: agentId,
              name: 'Agent',
              input: { subagent_type: role, description: `${role} for ${taskId}` },
            },
          ],
        },
      });
      for (const [index, call] of calls.entries()) {
        await new Promise((resolve) => setTimeout(resolve, stepMs));
        const id = `${agentId}_${index}`;
        emit({
          type: 'assistant',
          parent_tool_use_id: agentId,
          message: {
            content: [
              {
                type: 'tool_use',
                id,
                name: call.tool,
                input: call.file ? { file_path: join(project, call.file) } : {},
              },
            ],
          },
        });
        emit({
          type: 'user',
          parent_tool_use_id: agentId,
          message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      emit({
        type: 'user',
        parent_tool_use_id: null,
        message: { content: [{ type: 'tool_result', tool_use_id: agentId, content: `${role} done` }] },
      });
    } else if ('browse' in action) {
      const url = process.env.HARNESS_APP_URL;
      const page = url ? await (await fetch(`${url}${action.browse.path ?? '/'}`)).text() : 'no app\n';
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(join(artifacts, action.browse.save), page);
    } else if ('usageLimit' in action) {
      console.error('Claude AI usage limit reached. Your limit will reset at 5pm.');
      process.exit(1);
    }
  }
}

await play(nextStep());
process.exit(0);
