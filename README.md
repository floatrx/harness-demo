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

## Quickstart (core only, no tokens)

Requires Node 26 and pnpm.

```bash
pnpm install
node harness/bin/harness.ts self-test     # every contract case on a throwaway git repo, with a fake agent
node --test harness/                      # the full test suite
node harness/bin/harness.ts --help        # the CLI
```

Drive a real repository with the scripted fake agent instead of Claude:

```bash
node harness/bin/harness.ts projects add ~/code/my-app
node harness/bin/harness.ts new --project ~/code/my-app --title "Add a feature file"
node harness/bin/harness.ts submit T-001 --project ~/code/my-app
export AGENT_CMD="node $PWD/harness/testkit/fake-agent.ts"
node harness/bin/harness.ts run --project ~/code/my-app --once-through   # spec → plan → planned, then waits
node harness/bin/harness.ts approve T-001 --project ~/code/my-app         # the human gate
node harness/bin/harness.ts run --project ~/code/my-app --once-through   # implement → qa → judge → done
```

Set `"autonomy": { "mode": "full" }` in `.harness/config.json` to skip the plan and prototype approvals.

See exactly what a real unit would receive — the argv for `claude -p` and the full prompt — without spending a token:

```bash
node harness/bin/harness.ts preview T-001 --project ~/code/my-app
node harness/bin/harness.ts agents --check --project ~/code/my-app
```

## How a task moves

`draft → spec → plan → planned → [prototype] → ready → implementing → qa → judge → done → delivered`,
with `needs-input` when an agent asks you a question and `parked` when a contract stops a unit.
A column a human owns (`draft`, `needs-input`, `planned`, prototype review, `parked`) waits for you.

## License

MIT
