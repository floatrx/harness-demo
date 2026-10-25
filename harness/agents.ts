// The open agent registry: base specialists in `agents/*.md` plus the project's own in
// `<project>/.claude/agents/*.md` (a project agent with the same name replaces the base one).
//
// Each unit gets the registry as a JSON file for `claude --agents`, so nothing is written into the project.
// Every base agent file carries the standing rules between markers; a copy that drifted from
// `harness/prompts/STANDING-RULES.md` refuses the run (`harness agents --sync` rewrites the blocks).

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessConfig } from './config.ts';
import { getField, parseTask } from './task/parse.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The base registry; `HARNESS_AGENTS_DIR` points it at another folder (a team's own base set, a test). */
export function baseAgentsDir(): string {
  return process.env.HARNESS_AGENTS_DIR ?? join(HERE, '..', 'agents');
}
export const STANDING_RULES_PATH = join(HERE, 'prompts', 'STANDING-RULES.md');

export const RULES_START =
  '<!-- standing-rules:start — generated from harness/prompts/STANDING-RULES.md; edit there -->';
export const RULES_END = '<!-- standing-rules:end -->';
const BLOCK = /\n*<!-- standing-rules:start[^\n]*-->[\s\S]*?<!-- standing-rules:end -->\n*/;

export interface AgentDef {
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  /** Stages whose coordinator may dispatch this agent; empty = any stage. */
  stages: string[];
  /** A one-line trigger the coordinator reads. */
  when: string;
  /** The prompt body, standing-rules block included when the file carries one. */
  body: string;
  source: 'base' | 'project';
  path: string;
}

export class AgentError extends Error {
  override name = 'AgentError';
}

const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

export function parseAgent(text: string, path: string, source: AgentDef['source']): AgentDef {
  let doc;
  try {
    doc = parseTask(text);
  } catch (error) {
    throw new AgentError(`${path}: ${(error as Error).message}`);
  }
  const end = text.indexOf('\n---\n', 3);
  const name = String(getField(doc, 'name') ?? basename(path, '.md'));
  const description = getField(doc, 'description');
  if (typeof description !== 'string' || !description.trim()) throw new AgentError(`${path}: description is required`);
  const model = getField(doc, 'model');
  return {
    name,
    description,
    model: typeof model === 'string' ? model : null,
    tools: list(getField(doc, 'tools')),
    stages: list(getField(doc, 'stages')),
    when: String(getField(doc, 'when') ?? ''),
    body: end === -1 ? '' : text.slice(end + 5).trim(),
    source,
    path,
  };
}

function readDir(dir: string, source: AgentDef['source']): AgentDef[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md') && !file.startsWith('_'))
    .sort()
    .map((file) => parseAgent(readFileSync(join(dir, file), 'utf8'), join(dir, file), source));
}

export function loadRegistry(project: string | null, baseDir = baseAgentsDir()): AgentDef[] {
  const merged = new Map<string, AgentDef>();
  for (const agent of readDir(baseDir, 'base')) merged.set(agent.name, agent);
  if (project)
    for (const agent of readDir(join(project, '.claude', 'agents'), 'project')) merged.set(agent.name, agent);
  return [...merged.values()];
}

export function agentsForStage(registry: readonly AgentDef[], stage: string): AgentDef[] {
  return registry.filter((agent) => agent.stages.length === 0 || agent.stages.includes(stage));
}

// ---- standing rules ---------------------------------------------------------

export function standingRules(path = STANDING_RULES_PATH): string {
  return readFileSync(path, 'utf8').trim();
}

export function rulesBlock(rules = standingRules()): string {
  return `${RULES_START}\n\n${rules}\n\n${RULES_END}`;
}

/** The body without its block, then the current block: what an agent actually receives. */
export function withStandingRules(body: string, rules = standingRules()): string {
  return `${body.replace(BLOCK, '\n').trim()}\n\n${rulesBlock(rules)}\n`;
}

/** Base agent files whose block is missing or differs from STANDING-RULES.md. */
export function standingRulesDrift(baseDir = baseAgentsDir(), rules = standingRules()): string[] {
  return readDir(baseDir, 'base').flatMap((agent) => {
    const block = BLOCK.exec(readFileSync(agent.path, 'utf8'))?.[0].trim();
    return block === rulesBlock(rules) ? [] : [agent.path];
  });
}

/** Rewrites the block in every base agent file. Returns the files it changed. */
export function syncStandingRules(baseDir = baseAgentsDir(), rules = standingRules()): string[] {
  return standingRulesDrift(baseDir, rules).map((path) => {
    const text = readFileSync(path, 'utf8');
    const end = text.indexOf('\n---\n', 3) + 5;
    writeFileSync(path, `${text.slice(0, end)}\n${withStandingRules(text.slice(end), rules)}`);
    return path;
  });
}

// ---- what a unit receives ---------------------------------------------------

export function effectiveModel(agent: AgentDef, config: HarnessConfig): string | null {
  return (config.roles.models as Record<string, string | undefined>)[agent.name] ?? agent.model;
}

/** The `claude --agents` JSON for one stage. */
export function agentsJson(
  agents: readonly AgentDef[],
  config: HarnessConfig,
  rules = standingRules(),
): Record<string, { description: string; prompt: string; tools?: string[]; model?: string }> {
  return Object.fromEntries(
    agents.map((agent) => {
      const model = effectiveModel(agent, config);
      return [
        agent.name,
        {
          description: agent.description,
          prompt: withStandingRules(agent.body, rules),
          ...(agent.tools.length ? { tools: agent.tools } : {}),
          ...(model ? { model } : {}),
        },
      ];
    }),
  );
}

export function writeAgentsFile(path: string, agents: readonly AgentDef[], config: HarnessConfig): void {
  writeFileSync(path, `${JSON.stringify(agentsJson(agents, config), null, 2)}\n`);
}

/** Problems that make a run meaningless: the judge must not share a model with the author of the work. */
export function registryProblems(registry: readonly AgentDef[], config: HarnessConfig): string[] {
  const problems: string[] = [];
  const byName = new Map(registry.map((agent) => [agent.name, agent]));
  const judge = byName.get('judge');
  if (judge) {
    const judgeModel = effectiveModel(judge, config);
    for (const author of ['implementer', 'tester']) {
      const agent = byName.get(author);
      if (agent && judgeModel && effectiveModel(agent, config) === judgeModel)
        problems.push(`judge and ${author} share the model ${judgeModel}; the judge must be a different model`);
    }
  }
  for (const agent of registry) {
    if (!agent.body.trim()) problems.push(`${agent.path}: the agent has no prompt body`);
  }
  return problems;
}
