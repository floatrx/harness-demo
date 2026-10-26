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

A walkthrough with screenshots of every step lives at [harness-info.vercel.app](https://harness-info.vercel.app/en)
(source: [floatrx/harness-info](https://github.com/floatrx/harness-info));
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
the supervisor waits — until the reset time the limit names, when it names one — and retries. With
`ANTHROPIC_API_KEY` set, `claude -p` bills the API per token; the supervisor logs which one applies right after it
starts.

A task from draft to pull request is five units, each with a fresh context: spec, plan, implement, qa, judge. A UI
task adds a prototype round, and an interview adds one more spec unit. On the pilot below, the cleanest task (an
interview, a prototype, no bounce) took 7 units, 3 min 21 s of agent time and 11k tokens — $1.68 API-equivalent.

## Pilot

Three tasks went from a draft to an open pull request on
[harness-demo-bookmarks](https://github.com/floatrx/harness-demo-bookmarks) with real `claude -p` on a subscription
login, the default models (sonnet coordinators, an opus judge, a haiku explorer), gated autonomy and delivery on.
Claude passed the human gates on the recommended options — except where an option was wrong, noted below. Nothing was
merged.

| Task | Kind | What happened | Units | Agent time | Tokens | API-equiv. | PR |
|---|---|---|---:|---:|---:|---:|---|
| T-004 Show when a bookmark was added | logic | plan sent back once (`revise`); three harness bugs parked it on the way, each fixed in code | 13 | 6:51 | 25.0k | $2.30 | [#2](https://github.com/floatrx/harness-demo-bookmarks/pull/2) |
| T-001 Search box that filters the list | ui | 2-question interview, prototype accepted on round 1, no bounce | 7 | 3:21 | 11.1k | $1.68 | [#3](https://github.com/floatrx/harness-demo-bookmarks/pull/3) |
| T-003 Make the bookmarks better | vague | 4-question interview (Q1's recommended option duplicated T-001, so answered otherwise); plan sent back once; **the judge rejected round 1** — the count sat outside the header and showed seed data on first paint — round 2 fixed both; two units hit the session limit | 14 | 7:48 | 18.7k | $2.86 | [#4](https://github.com/floatrx/harness-demo-bookmarks/pull/4) |

T-002 ([#1](https://github.com/floatrx/harness-demo-bookmarks/pull/1)) was delivered by the stand-in agent, for zero
tokens. Per stage, from `harness stats --project bookmarks` (39 units, 5 of them the stand-in's):

| Stage | Units | Parked | Agent time | Tokens | API-equiv. |
|---|---:|---:|---:|---:|---:|
| spec | 8 | 1 | 3:30 | 8.9k | $1.25 |
| plan | 7 | 1 | 4:07 | 15.9k | $1.45 |
| prototype | 1 | 0 | 0:44 | 4.2k | $0.33 |
| implement | 8 | 2 | 3:08 | 16.0k | $1.49 |
| qa | 7 | 1 | 2:11 | 3.6k | $0.83 |
| judge | 8 | 0 | 4:22 | 6.2k | $1.49 |
| **total** | **39** | **5** | **18:03** | **54.7k** | **$6.83** |

Tokens are input + output; prompt-cache reads come on top (about 2.2M for T-004 alone) and are much cheaper.

**What the pilot taught.** Every failure became a contract or a prompt line with a test, never a hand edit of a task:

1. A unit is told which task-file sections it may write; the planner had invented `## Risks`.
2. `revise` sends a plan back with a comment; `planned` used to have one way out, Approve.
3. QA cannot walk a running app (no browser): `[found]` criteria go to the reviewer's checklist in the PR, and the
   allowlist gained read-only `grep`, `cat`, `head`, `tail`, `wc`.
4. A `[closes]` command is the backtick span after the colon — the loop once ran `formatRelativeTime` as a command
   and overruled a correct verdict. The plan contract now checks every command is callable.
5. The designer draws a faithful SVG wireframe when nothing can take a screenshot.
6. Spec and plan units see the other tasks on the board, so an interview never recommends another task's work.
7. A human action on another task while a unit runs is neither blamed on the unit nor undone by its quarantine.
8. Criteria are numbered `N.` — `1a.` was silently skipped by the closing contract.
9. A usage limit that names its reset time is waited out exactly; Telegram sends only unique messages.

Each run's units are on the demo project's dashboard (`/live`, `/stats`); the contracts they exercised are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
