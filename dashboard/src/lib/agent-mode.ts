/* Who Start runs: shared by the server (the dock model) and the client (the Start button), so no core import here. */

export const AGENT_MODES = ['stand-in', 'api-key', 'subscription'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** The word on the Start button. */
export const START_LABEL: Record<AgentMode, string> = {
  'stand-in': 'stand-in',
  'api-key': 'claude',
  subscription: 'claude',
};

/** The line under it: what a Start spends. */
export const START_NOTE: Record<AgentMode, string> = {
  'stand-in': 'A stand-in replaces claude — no tokens.',
  'api-key': 'Real claude -p — ANTHROPIC_API_KEY is set, billed per token.',
  subscription: 'Real claude -p — spends your subscription limits.',
};
