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

### Try it on the example app

`examples/app` is a small Next.js bookmarks app with three seed tasks: a UI task (exercises the designer),
a logic task with a test, and a deliberately vague draft (triggers the interview). `harness example` copies it into
its own git repository — the loop creates branches and commits there, never in this repository — and registers it.

```bash
alias harness="node $PWD/harness/bin/harness.ts"
harness example ~/harness-bookmarks            # copy, git init, pnpm install, first commit, register
harness submit T-002 --project harness-bookmarks

# Zero tokens: the scripted fake agent plays every role.
export AGENT_CMD="node $PWD/harness/testkit/fake-agent.ts"
harness run --project harness-bookmarks --once-through   # spec → plan → planned, then waits for you
harness approve T-002 --project harness-bookmarks         # the human gate
harness run --project harness-bookmarks --once-through   # implement → qa → judge → done, one commit
```

Set `"autonomy": { "mode": "full" }` in the project's `.harness/config.json` to skip the plan and prototype
approvals. Drop `AGENT_CMD` to run real Claude units — first look at exactly what a unit would receive (the argv for
`claude -p` and the full prompt) without spending a token:

```bash
harness preview T-002 --project harness-bookmarks
harness agents --check --project harness-bookmarks
```

Any other git repository works the same way: `harness projects add <path>`, then `harness new --title "…"`.

## How a task moves

`draft → spec → plan → planned → [prototype] → ready → implementing → qa → judge → done → delivered`,
with `needs-input` when an agent asks you a question and `parked` when a contract stops a unit.
A column a human owns (`draft`, `needs-input`, `planned`, prototype review, `parked`) waits for you.

## License

MIT
