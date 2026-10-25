# harness-demo

An autonomous task harness for [Claude Code](https://claude.com/claude-code).

You write a two-line draft on a kanban board. Agents turn it into a spec, ask you clarifying questions,
plan it against the code, prototype it if it is UI, implement it, QA it, judge it, and deliver it as a
commit or a pull request. Every step is visible in a local dashboard, can be paused, and is guarded by
contracts that the code checks — not by instructions the agent may ignore.

- **Core** — a zero-dependency Node runner and supervisor; one fresh `claude -p` context per unit of work.
- **Agents** — a coordinator delegates to an open registry of specialists (`writer`, `planner`, `designer`,
  `implementer`, `qa`, `judge`, `delivery`, and any you add).
- **Dashboard** — a Next.js control plane: projects, board, interview, live view, token stats.
- **Example** — a small app in `examples/` with seed tasks, so you can watch the loop work end to end.

> **Status:** early. The design is done; the code is being written.
> A step-by-step explanation lives in [floatrx/harness-info](https://github.com/floatrx/harness-info).

## License

MIT
