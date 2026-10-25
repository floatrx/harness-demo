/* Reads a unit trace (`trace/unit-NNNN.jsonl`: claude -p stream-json, each line stamped with `harness_ts` by the
   runner) into what the Live dock shows: the coordinator and each specialist it dispatched, with state, time and the
   tool in hand.

   Safety (plan § Security): the model keeps role names, tool names and file BASENAMES only. Tool arguments, commands,
   prompts and message text never leave this function. */

export interface AgentActivity {
  /** The Agent tool_use id that dispatched it. */
  id: string;
  role: string;
  state: 'running' | 'done' | 'failed';
  startedAt: string | null;
  endedAt: string | null;
  /** The last tool it called, and the file it touched (basename only). */
  tool: string | null;
  file: string | null;
  calls: number;
}

export interface TraceStep {
  /** 'coordinator' or the dispatching Agent tool_use id (see `agents`). */
  actor: string;
  tool: string;
  file: string | null;
  at: string | null;
}

export interface UnitTrace {
  coordinator: { tool: string | null; file: string | null; calls: number };
  /** Every tool call in order — tool name and file basename only. */
  steps: TraceStep[];
  agents: AgentActivity[];
  startedAt: string | null;
  lastEventAt: string | null;
  denials: number;
  finished: boolean;
}

interface ToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  is_error?: boolean;
}

interface TraceEvent {
  type?: string;
  subtype?: string;
  harness_ts?: string;
  parent_tool_use_id?: string | null;
  tool_use_id?: string;
  status?: string;
  message?: { content?: unknown };
  permission_denials?: unknown[];
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);

/** The basename of the file a tool works on, if its input names one. Nothing else from the input survives. */
const fileOf = (input: Record<string, unknown> | undefined): string | null => {
  const path = input?.file_path ?? input?.path ?? input?.notebook_path;
  if (typeof path !== 'string' || !path) return null;
  return path.split('/').filter(Boolean).at(-1) ?? null;
};

const blocks = <T extends { type: string }>(event: TraceEvent, type: T['type']): T[] => {
  const content = event.message?.content;
  return Array.isArray(content) ? (content as T[]).filter((block) => block?.type === type) : [];
};

export function parseUnitTrace(text: string): UnitTrace {
  const trace: UnitTrace = {
    coordinator: { tool: null, file: null, calls: 0 },
    steps: [],
    agents: [],
    startedAt: null,
    lastEventAt: null,
    denials: 0,
    finished: false,
  };
  const agents = new Map<string, AgentActivity>();
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let event: TraceEvent;
    try {
      event = JSON.parse(line) as TraceEvent;
    } catch {
      continue;
    }
    const at = event.harness_ts ?? null;
    if (at) {
      trace.startedAt ??= at;
      trace.lastEventAt = at;
    }
    if (event.type === 'result') {
      trace.finished = true;
      trace.denials = Array.isArray(event.permission_denials) ? event.permission_denials.length : 0;
      for (const agent of agents.values()) if (agent.state === 'running') agent.state = 'done';
      continue;
    }
    if (event.type === 'assistant') {
      for (const use of blocks<ToolUse>(event, 'tool_use')) {
        if (AGENT_TOOLS.has(use.name) && !event.parent_tool_use_id) {
          const role = typeof use.input?.subagent_type === 'string' ? use.input.subagent_type : 'agent';
          agents.set(use.id, {
            id: use.id,
            role,
            state: 'running',
            startedAt: at,
            endedAt: null,
            tool: null,
            file: null,
            calls: 0,
          });
          trace.coordinator.tool = use.name;
          trace.coordinator.file = null;
          trace.coordinator.calls++;
          trace.steps.push({ actor: 'coordinator', tool: `${use.name} → ${role}`, file: null, at });
          continue;
        }
        const owner = event.parent_tool_use_id ? agents.get(event.parent_tool_use_id) : undefined;
        const target = owner ?? trace.coordinator;
        target.tool = use.name;
        target.file = fileOf(use.input);
        target.calls++;
        trace.steps.push({ actor: owner?.id ?? 'coordinator', tool: use.name, file: target.file, at });
      }
    }
    if (event.type === 'user') {
      for (const result of blocks<ToolResult>(event, 'tool_result')) {
        const agent = agents.get(result.tool_use_id);
        if (agent && !event.parent_tool_use_id) {
          agent.state = result.is_error ? 'failed' : 'done';
          agent.endedAt = at;
        }
      }
    }
    if (event.type === 'system' && event.subtype === 'task_notification' && event.tool_use_id) {
      const agent = agents.get(event.tool_use_id);
      if (agent && event.status && event.status !== 'completed' && event.status !== 'running') agent.state = 'failed';
    }
  }
  trace.agents = [...agents.values()];
  return trace;
}
