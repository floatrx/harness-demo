# harness-demo

An autonomous task harness for [Claude Code](https://claude.com/claude-code).

You write a two-line draft on a kanban board. Agents turn it into a spec, ask you when something is unclear, plan it
against the code, prototype it if it is UI, implement it, QA it and judge it — and the runner opens a pull request
that a human merges. Every step is visible in a local dashboard, can be paused, and is guarded by **contracts the code
checks**, not by instructions the agent may ignore.

- **Core** — a zero-dependency Node runner and supervisor; one fresh `claude -p` context per unit of work.
- **Agents** — a coordinator per stage delegates to an open registry of specialists (`writer`, `explorer`, `planner`,
  `designer`, `tester`, `implementer`, `debugger`, `qa`, `judge`, and any you add).
- **Dashboard** — a local Next.js control plane: projects, board, interview, live trace, stats, agents.
- **Delivery** — the runner pushes the task branch and opens the pull request. Nothing ever merges it.
- **Telegram** — optional one-way pings when the loop needs you or finishes something.

A walkthrough with screenshots of every step lives in [floatrx/harness-info](https://github.com/floatrx/harness-info);
a live demo project with pull requests opened by the loop is
[floatrx/harness-demo-bookmarks](https://github.com/floatrx/harness-demo-bookmarks). How it works inside:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

Node 26 (`.nvmrc`; it runs the TypeScript in `harness/` directly), pnpm, git. For real runs: the Claude Code CLI
(`claude`), logged in. For delivery: the GitHub CLI (`gh`), logged in.

## Quickstart

### 1. Install and check — no tokens

```bash
pnpm install
node harness/bin/harness.ts self-test     # every contract case on a throwaway git repo, with a fake agent
alias harness="node $PWD/harness/bin/harness.ts"
```

### 2. Make an example project

`examples/app` is a small Next.js bookmarks app with three seed tasks: a UI task (exercises the designer), a logic
task with a test, and a deliberately vague draft (triggers the interview). `harness example` copies it into its own git
repository — the loop branches and commits there, never in this repository — and registers it.

```bash
harness example ~/harness-bookmarks       # copy, git init, pnpm install, first commit, register as "harness-bookmarks"
```

### 3. Watch it work — no tokens

The scripted fake agent plays every role, so you can see the whole loop for free.

```bash
AGENT_CMD="node $PWD/harness/testkit/fake-agent.ts" pnpm dashboard     # → http://127.0.0.1:4777
```

Open the project, press **Submit** on T-002, press **Start** in the dock, approve the plan when it asks, and watch
the card go through implement → QA → judge → done. Everything the dashboard does, the CLI does too:

```bash
export AGENT_CMD="node $PWD/harness/testkit/fake-agent.ts"
harness submit T-002 --project harness-bookmarks
harness run --project harness-bookmarks --once-through   # spec → plan → planned, then waits for you
harness approve T-002 --project harness-bookmarks
harness run --project harness-bookmarks --once-through   # implement → qa → judge → done, one commit
```

### 4. Run it for real

Drop `AGENT_CMD`. First look at exactly what the next unit would receive — the argv for `claude -p` and the whole
prompt — without spending a token:

```bash
unset AGENT_CMD
harness preview T-003 --project harness-bookmarks
harness agents --check --project harness-bookmarks
pnpm dashboard                                          # then Submit and Start, as above
```

`harness stats --project harness-bookmarks` prints units, time, tokens and cost per stage and per task.

Any other git repository works the same way: `harness projects add <path>` (or **Add a project** on the dashboard),
then `harness new --title "…"` (or **New task**).

## How a task moves

`draft → spec → plan → planned → [prototype] → ready → implementing → qa → judge → done → delivered`,
with `needs-input` when an agent asks you a question and `parked` when a contract stops a unit. A column a human owns
(`draft`, `needs-input`, `planned`, prototype review, `parked`) waits for you. At `planned` you approve the plan or
send it back with a comment (**Request changes** on the Plan tab, or `harness revise`). `"autonomy": { "mode": "full" }` in a
project's `.harness/config.json` skips the plan and prototype approvals.

What stops a unit, whatever the agent says: a change outside the task's `scope`, a commit or a push by the agent, a
write to a section it does not own, a missing verdict, a red gate, a `[closes]` command that fails after the judge
said CONFIRMED. The unit's work goes to a named git stash and the task is parked with the reason. QA FAIL and judge
REJECTED send the task back, up to `limits.bounces` (2).

## Delivery

```json
"deliver": { "pr": true, "remote": "origin" }
```

A `done` task then gets one more step from the runner — no agent, no tokens: it checks that the task branch holds only
its own commits, pushes it, and opens a pull request with `gh pr create`. The body carries the goal, the plan, each
`[closes]` command, the QA and judge verdicts and the commits (the task files themselves are gitignored). Nothing
merges it. The supervisor refuses to start with delivery on when the remote or `gh` is missing.

## Telegram (optional)

Put the keys outside any repository, in `~/.harness/.env` (see [.env.example](.env.example)):

```bash
TELEGRAM_BOT_TOKEN=…
TELEGRAM_CHAT_ID=…
```

`harness notify --test` sends one message. The loop then pings you for a question, a plan to approve, a prototype to
review, a parked task, a done task, a pull request, and how a run ended. An empty `TELEGRAM_BOT_TOKEN` in a project's
`.env` switches it off for that project.

## What a run uses

On a Claude subscription the loop spends your **usage limits**, not money: `claude -p` reports an API-equivalent
price, and the dashboard and `harness stats` show that figure. When a unit hits a usage limit the work is put back and
the supervisor waits and retries. With `ANTHROPIC_API_KEY` set, `claude -p` bills the API per token — the supervisor's
first log line says which one applies.

A task from draft to pull request is seven units with a fresh context each: spec, plan, (prototype), implement, qa,
judge. The pilot on the demo project measured, per stage: _see [the pilot](#pilot)._

## Pilot

_Filled in from the real runs on [harness-demo-bookmarks](https://github.com/floatrx/harness-demo-bookmarks)._

## Layout

```
harness/      the core: CLI, runner, supervisor, queue, contracts, agents, memory, delivery, notify, stats
agents/       the base specialist registry (one .md per role)
dashboard/    the local control plane (Next.js) and its browser walkthrough
examples/app/ the example project template
docs/         ARCHITECTURE.md and the dashboard screenshots
```

## Development

```bash
pnpm typecheck && pnpm lint && node --test harness/ dashboard/ && node harness/bin/harness.ts self-test
pnpm -C dashboard build && pnpm dashboard:e2e   # the dashboard walkthrough in Chrome (--docs rewrites docs/screenshots/)
pnpm provenance                                 # this repository is public: no foreign names, no token shapes
```

## License

MIT
