import type { NextConfig } from 'next';

const config: NextConfig = {
  // The harness starts `next dev` for its qa and prototype units; with agent rules on, Next writes AGENTS.md into the
  // project on start, and a read-only unit would be blamed for that file.
  agentRules: false,
};

export default config;
