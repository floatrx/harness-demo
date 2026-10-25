/* Server-only: what /agents shows — the stage coordinators, the specialist registry (base + project) with the stages
   that offer each one, the checks a run refuses on, and how `claude -p` is invoked. */

import { homedir } from 'node:os';
import { relative } from 'node:path';
import {
  RULES_START,
  STANDING_RULES_PATH,
  effectiveModel,
  loadRegistry,
  registryProblems,
  standingRulesDrift,
} from '@harness/core/agents';
import { type HarnessConfig, STAGE_ROLE, UNIT_STAGES, type UnitStage, loadConfig } from '@harness/core/config';
import { REPO_ROOT } from '@harness/core/example';
import { invocation, stageSpecialists } from '@harness/core/runner';
import { findProject } from './board.ts';

export interface AgentRow {
  name: string;
  description: string;
  source: 'base' | 'project';
  /** Where the file lives, relative to the harness repo or the project. */
  file: string;
  model: string | null;
  /** 'config' when roles.models overrides the agent's own frontmatter. */
  modelFrom: 'config' | 'agent' | null;
  tools: string[];
  /** The stages whose units offer this agent. */
  offeredIn: UnitStage[];
  when: string;
  /** The prompt body without the standing-rules block (every agent gets the same block). */
  prompt: string;
}

export interface AgentsPage {
  coordinators: { stage: UnitStage; role: string; model: string | null }[];
  agents: AgentRow[];
  problems: string[];
  drift: string[];
  invocation: {
    display: string;
    /** The command that replaces `claude` (config agent.command or AGENT_CMD), if any. */
    override: string | null;
    permissionMode: string;
    settingSources: string;
    allowedTools: string[];
  };
  rulesFile: string;
}

/* Anywhere in the string: the stand-in command starts with `node `, the path comes after. */
const home = (text: string) => text.replaceAll(homedir(), '~');

export function loadAgentsPage(projectId: string): AgentsPage {
  const project = findProject(projectId);
  const config: HarnessConfig = loadConfig(project.path);
  const registry = loadRegistry(project.path);
  const offered = new Map<string, UnitStage[]>();
  for (const stage of UNIT_STAGES)
    for (const agent of stageSpecialists(registry, stage, config))
      offered.set(agent.name, [...(offered.get(agent.name) ?? []), stage]);
  const models = config.roles.models as Record<string, string | undefined>;
  const run = invocation(config, '{model}', 'unit-NNNN.agents.json');
  return {
    coordinators: UNIT_STAGES.map((stage) => ({
      stage,
      role: STAGE_ROLE[stage],
      model: models[STAGE_ROLE[stage]] ?? null,
    })),
    agents: registry.map((agent) => ({
      name: agent.name,
      description: agent.description,
      source: agent.source,
      file: agent.source === 'base' ? relative(REPO_ROOT, agent.path) : relative(project.path, agent.path),
      model: effectiveModel(agent, config),
      modelFrom: models[agent.name] ? 'config' : agent.model ? 'agent' : null,
      tools: agent.tools,
      offeredIn: offered.get(agent.name) ?? [],
      when: agent.when,
      prompt: agent.body.split(RULES_START)[0]?.trim() ?? '',
    })),
    problems: registryProblems(registry, config),
    drift: standingRulesDrift().map((path) => relative(REPO_ROOT, path)),
    invocation: {
      display: home(run.display),
      override: run.file === 'sh' ? home(run.display) : null,
      permissionMode: config.agent.permissionMode,
      settingSources: config.agent.settingSources,
      allowedTools: config.agent.allowedTools,
    },
    rulesFile: relative(REPO_ROOT, STANDING_RULES_PATH),
  };
}
