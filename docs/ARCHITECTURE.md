# Architecture

harness-demo moves a task from a two-line draft to a pull request through a series of **units**. A unit is one
fresh `claude -p` process that works on one stage of one task. Code — not the prompt — decides whether the unit's
work stands: after every unit the runner checks a set of **contracts**, then moves the task, commits, or stops.

The guiding rule: **the agent is the least trusted part.** A rule that matters is a check in code. A sentence in a
prompt is a hint.

```
                ┌───────────── supervisor (policy over time) ─────────────┐
 task files ──▶ │ queue ─▶ runner: one unit ─▶ contracts ─▶ transition    │ ──▶ commits, a pull request,
 .harness/      │   ▲        claude -p …          scope, task file,       │     Telegram, handoffs.jsonl
 tasks/*.md     │   └──────── PAUSE / STOP / usage limit / barren ◀──────── │
                └──────────────────────────────────────────────────────────┘
                       ▲ the same files ▲
                 CLI (harness …)   dashboard (Next.js, local)
```

## Contents

1. [A project and its files](#1-a-project-and-its-files)
2. [Tasks and their statuses](#2-tasks-and-their-statuses)
3. [The queue](#3-the-queue)
4. [One unit](#4-one-unit)
5. [Contracts](#5-contracts)
6. [Agents, prompts and standing rules](#6-agents-prompts-and-standing-rules)
7. [The supervisor](#7-the-supervisor)
8. [Delivery](#8-delivery)
9. [Notifications](#9-notifications)
10. [The dashboard](#10-the-dashboard)
11. [Security](#11-security)
12. [Testing without tokens](#12-testing-without-tokens)

## 1. A project and its files

A project is any local git repository with `.harness/config.json`. `harness projects add <path>` creates it and
registers the project in `$HARNESS_HOME/projects.json` (default `~/.harness`).

| Path | What | Versioned |
|---|---|---|
| `.harness/config.json` | base branch, autonomy, limits, gate, probe, delivery, the app (defaults live in `harness/config.ts`) | yes |
| `.harness/tasks/T-NNN.md` | one task: YAML-subset frontmatter + `##` sections | no |
| `.harness/JOURNAL.md` | short notes agents leave for the next unit | no |
| `.harness/artifacts/T-NNN/` | screenshots, the prototype picture, `qa-report.md`, `pr-body.md` | no |
| `.harness/trace/progress.log` | one line per event, timestamped | no |
| `.harness/trace/handoffs.jsonl` | one record per unit or runner step: from → to, exit, verdict, commit, usage, PR | no |
| `.harness/trace/unit-NNNN.jsonl` | the unit's raw stream-json, each line stamped with `harness_ts` | no |
| `.harness/trace/unit-NNNN.agents.json` | the `--agents` JSON the unit received | no |
| `.harness/trace/unit-NNNN.app.json`, `.app.log` | the app started for the unit (pid, port, the runner that owns it) and its output | no |
| `.harness/trace/unit-NNNN.mcp.json` | the browser unit's MCP config (Playwright MCP only) | no |
| `.harness/trace/human-writes.jsonl` | the sha256 of every task file a human wrote (CLI or dashboard) | no |
| `.harness/trace/running.json` | the unit in flight (task, stage, role, pid, start) | no |
| `.harness/trace/supervisor.lock`, `PAUSE`, `STOP` | one loop per checkout; control files read at the unit boundary | no |

Task files are gitignored on purpose: the runner switches between the base branch and task branches, and a
versioned task file that differs between branches would make a checkout fail. `.env` is gitignored too.

## 2. Tasks and their statuses

A task file has owned sections (`## Draft` is the human's, `## Spec` the writer's, `## Plan` the planner's, `## Log`
the runner's) and owned frontmatter fields. `harness/task/write.ts` holds the ownership tables; the task-file
contract enforces them after every unit.

| Status | Owner | What happens |
|---|---|---|
| `draft` | human | the human writes; Submit moves it on |
| `spec` | agent (writer) | spec unit → `plan`, or `needs-input` with questions |
| `needs-input` | human | the human answers the lettered options; the runner resumes the stage |
| `plan` | agent (planner) | plan unit → `planned`; the plan must name a `scope` and at least one `[closes]` command |
| `planned` | human | Approve → `prototype` (UI tasks) or `ready`; Revise → `plan` with a comment the planner must address |
| `prototype` | agent (designer) / human | a round while `prototype: drafting`; the human Accepts or Comments while `review` |
| `ready` | human | approved, waiting for the implement unit |
| `implementing` | agent (implementer) | the runner commits after a green gate; a round after a bounce may change nothing and go back to `qa` |
| `qa` | agent (qa) | `qa: PASS` → `judge`; FAIL → `implementing` (+1 bounce); CANNOT_VERIFY → `parked` |
| `judge` | agent (judge, another model) | `judge: CONFIRMED` → `done` after the closing contract; REJECTED → `implementing` (+1 bounce) |
| `done` | runner | with `deliver.pr`, the runner pushes and opens the pull request; otherwise the end |
| `delivered` | none | a human reviews and merges the pull request |
| `parked` | human | a hard stop or the bounce cap; Reopen returns it to `parkedFrom` |

Human moves and agent moves are separate sets (`HUMAN_TRANSITIONS`, `AGENT_TRANSITIONS` in
`harness/task/transitions.ts`). The dashboard offers only the human set. A human comment on a plan or a prototype
goes into a `### Review` block at the end of that section; the next round reads it, and the task-file contract parks
a unit that changes it. `autonomy.mode: full` skips the two
approval gates; drafts and questions still need a human.

## 3. The queue

`harness/queue.ts` is a pure function: task fields in, the next step out. It is recomputed before every step, so
stopping the loop mid-batch costs only the step in flight. **Finishing beats starting:** the status furthest down the
board goes first (`done` with delivery on, then `judge`, `qa`, `implementing`, `ready`, …), then the lower id.

A step is one of: a **unit** (an agent stage), an **advance** (the runner moves a task without an agent — an answered
interview, an auto-approved plan), or **deliver** (the runner pushes and opens a pull request).

## 4. One unit

`harness/runner.ts` runs one step. For a unit:

1. **Pick** the task (the queue), validate its file, refuse a dirty tree the loop did not make.
2. **Branch.** Spec and plan run on the base branch. Implement, qa and judge run on `harness/T-NNN-<slug>`, created
   from the base branch at the first implement unit.
3. **App** — only for a stage in `app.stages` (qa and prototype by default) of a project with an `app` block: start
   it and wait until it answers (below). **Snapshot** HEAD, the branch, remote refs, the dirty files and the task
   file — after the app is up, so nothing the server writes at start counts as the unit's.
4. **Spawn** `claude -p --output-format stream-json --model <role model> --permission-mode dontAsk
   --setting-sources project,local --agents <file> --allowedTools …` with the stage prompt on stdin. Commits and pushes
   are absent from the allowlist on purpose. In this mode Claude Code also refuses `$?`, `$(…)` and shell variables,
   so the standing rules ask for one plain command per Bash call, and the runner creates the artifacts folder first.
5. **Check** the contracts (next section).
6. **Transition** the task, **commit** on the task branch when the stage writes code (`T-NNN: <title> (round n)`),
   append the handoff record, notify. **Stop the app**, whatever the outcome.

**The app and the browser** (`harness/app.ts`). The runner picks a free port, runs `app.start` with `{port}` filled
in, as its own process group, and polls `http://<app.host>:<port><app.ready>` until anything answers or
`app.timeoutSeconds` pass. The host is `localhost`: Next's dev server blocks its hot-reload socket for other origins.
An app that exits or never answers is stopped and logged ("app did not start: …"), and the unit runs without a
browser. When the app is up, the unit gets `HARNESS_APP_URL`, an `App:` line in its prompt, and
`--mcp-config <unit.mcp.json> --strict-mcp-config` with Playwright MCP (`app.browser`, through `npx`, headless system
Chrome) as the only server. After the unit the runner sends SIGTERM to the group, SIGKILL after 5 s, and checks out
any tracked file the app rewrote while it ran. Each started app has a record in `trace/`; the next run stops a group
whose runner died.

A hard stop (a broken contract or a crashed agent) moves the unit's changes into a named git stash
("harness quarantine: T-NNN unit N"), restores the tree, and parks the task with the reason. A usage limit is not a
hard stop: exit 4, everything is put back, and the supervisor waits.

Every unit starts with an empty context. `harness/memory.ts` hands it the facts earlier units left — the last
handoffs, the branch's commits, the log tail — and then the journal tail. Measured facts come first because a note
can be wrong.

## 5. Contracts

| Contract | Where | Checks |
|---|---|---|
| Scope | `contracts/scope.ts` | same branch; HEAD did not move; no remote ref moved; every changed file inside the task's `scope`; under `.harness/` only the task file, its artifacts and the journal — and other task files a human wrote meanwhile (the human-write ledger) |
| Task file | `task/write.ts` | the unit wrote only its role's sections and fields |
| Trace | `contracts/trace.ts` | the stage's verdict (`qa: …`, `judge: …`) is in the coordinator's final result, not in a quoted specialist |
| Plan | `runner.ts`, `contracts/closing.ts` | the plan has a `scope` and at least one `[closes]` criterion with a command; every command starts with a program the shell can call; every tagged line reads as `N. [tag]` |
| Gate | `contracts/gate.ts` | the task's gate is green before a commit; when red, it is re-run at the base commit — red there too means inherited, not the unit's fault |
| Closing | `contracts/closing.ts` | after CONFIRMED, every `[closes]` command is run by code; one red command overrules the judge |
| Branch | `contracts/branch.ts` | before delivery: the branch is ahead of the base and holds only `T-NNN:` commits |

**Two kinds of acceptance criteria.** A `[closes]` criterion ends with a shell command that exits 0 when it holds —
`3. [closes] The label is tested: \`pnpm test\`` (the command is the first backtick span after a colon). Code
re-runs it, so it cannot be argued with. A `[found]` criterion is checked on the running app. With an app and a
browser, QA walks each one, saves one screenshot per criterion in the artifacts folder, and starts `qa-report.md`
with one line per criterion: `- <n> PASS|FAIL|REVIEWER · browser|command|code · <screenshot or ->`. The pull request
marks a criterion walked when its line reads `PASS · browser`; every other `[found]` criterion stays on the
reviewer's checklist. Without a browser, QA and the judge check what commands and code can show, and the whole list
is the reviewer's. A criterion left for the reviewer never parks a task on its own.

**The browser's own files.** Playwright MCP saves a screenshot with a bare file name in the workspace root — the
project. After a browser unit the runner moves new untracked images from the project root into the task's artifacts
folder, before the scope contract runs.

**Narrow every check.** A check that fails a unit for a defect the unit did not cause is the most expensive bug a
loop can have — hence the gate's base re-run.

## 6. Agents, prompts and standing rules

- **Coordinator per stage.** Each unit runs a coordinator prompt from `harness/prompts/<stage>.md`, as the stage's
  role (writer, planner, designer, implementer, qa, judge) on the role's model.
- **Specialists.** `agents/*.md` is the base registry (9 roles: writer, explorer, planner, designer, tester,
  implementer, debugger, qa, judge). A project adds or overrides roles in `<project>/.claude/agents/`. Each file has
  `stages:` and `when:` in its frontmatter; the unit receives the specialists of its stage through `--agents`.
- **Standing rules** live in one file, `harness/prompts/STANDING-RULES.md`, copied into every agent between markers.
  A drifted copy refuses every run (exit 2); `harness agents --sync` rewrites the copies.
- **The judge is never on the implementer's or the tester's model** — checked before every run.
- **Browser tools.** A browser unit's allowlist gains `mcp__playwright`. A specialist sees only the tools its file
  lists, so the runner adds the browser tools to every listing specialist of that unit — never to the judge. The
  coordinator passes the app's URL in its dispatch, because a specialist reads only its dispatch prompt.

## 7. The supervisor

`harness/supervise.ts` is policy over time: one loop per checkout (the lock), PAUSE and STOP read at the unit
boundary, never mid-unit; a stop after three units in a row that moved nothing (barren); a wait-and-retry when the
agent cannot run (a usage limit, the network, the login, a red probe). An idle supervisor polls the board, and a
human action (any write to the human-write ledger) wakes it at once.

| Exit | Meaning |
|---|---|
| 0 | stopped, drained (`--once-through`), deadline or max units |
| 2 | broken configuration — waiting fixes nothing (including the delivery preflight) |
| 3 | barren: units moved nothing |
| 4 | gave up waiting for the agent |

At start it logs who pays for the units: a stand-in (no tokens), `ANTHROPIC_API_KEY` (billed per token), or the
subscription login (usage limits; the cost figures are API-equivalent).

## 8. Delivery

With `deliver.pr: true` a `done` task gets one runner step — no agent, no tokens (`harness/deliver.ts`):

1. the branch contract;
2. the pull-request body, composed from the task file, the handoffs and QA's `qa-report.md` (goal, plan, each
   `[closes]` command, the `[found]` criteria QA walked in the browser, the verdicts, the commits), with secrets
   scrubbed, written to `artifacts/T-NNN/pr-body.md`;
3. `git push -u <remote> <branch>`;
4. `gh pr view <branch>` (reuse an open one) or `gh pr create`;
5. frontmatter `pr: <url>`, `done → delivered`.

Nothing ever merges: the only `gh` verbs are `auth status`, `pr view` and `pr create`. A failed push or `gh` call
parks the task from `done`; Reopen retries. The supervisor refuses to start with delivery on when the remote, `gh`
or its login is missing (exit 2, with the fix).

## 9. Notifications

`harness/notify.ts` sends one-way Telegram messages for what needs the human or what ended: needs-input, a plan to
approve, a prototype to review, parked, done, delivered (with the link), how a run ended. Keys come from the
environment, then `<project>/.env`, then `$HARNESS_HOME/.env`; the first source that defines the token decides, and an
empty token switches notifications off. A failed send never fails a unit.

## 10. The dashboard

`dashboard/` is a Next.js app bound to `127.0.0.1`. Server modules in `dashboard/src/lib/` read the same files the
CLI reads, through the core (`@harness/core`):

- **Board** — the columns are statuses; a drag is allowed only along a human transition.
- **Live** — a server-sent-events stream of one snapshot (supervisor state, the unit in flight with its agents, up
  next, recent units), pushed only when it changes.
- **Trace, Stats, Agents** — every unit's lanes, the cost per stage and task, the registry and its checks.
- **Writes** go through one module, `dashboard/src/lib/actions.ts`: a POST with the `x-harness: 1` header, refused
  while the task is in `running.json`, applied with the core's human actions and an atomic file write. Start spawns
  `harness run` detached with the dashboard's own environment; Pause, Resume and Stop write the same control files
  the CLI writes. The Start button and the server's first terminal line name who a Start runs (a stand-in, or real
  `claude -p` on a subscription or an API key).

## 11. Security

- The dashboard binds to localhost; every write needs a custom header, which a cross-site form cannot send.
- What reaches the browser keeps role names, tool names and file **basenames** only — no tool arguments, prompts,
  message text, or refused commands.
- The PR body and every notification pass a scrubber for token shapes and live key values; `pnpm provenance` fails
  the repository on any token shape.
- Agents run with `--permission-mode dontAsk` and an allowlist without commit or push; the scope contract catches a
  commit, a push or a fetch anyway.
- The runner owns the app: it starts it and stops exactly the process group it started, never a server it did not
  start. The app runs without the AI-agent markers, the agent session's keys, the caller's `NODE_ENV` or Next's
  internals. A browser unit gets one MCP server and no other (`--strict-mcp-config`); other units get none.
- A human may act on other tasks while a unit runs. Every human write (CLI or dashboard) records the file's sha256 in
  `.harness/trace/human-writes.jsonl`; the scope contract does not blame the unit for such a file, and a quarantine
  does not undo it. Human CLI actions refuse inside a unit (`HARNESS_LOOP`). The ledger guards against mistakes, not
  against an agent that forges it.

## 12. Testing without tokens

- `harness/testkit/fake-agent.ts` is a scripted stand-in for `claude -p`: per stage it can write files, ask questions,
  print verdicts, stream specialist dispatches, report usage, or hit a usage limit.
- `harness/testkit/fake-gh.ts` stands in for the GitHub CLI and records every call.
- `harness/testkit/fake-app.ts` stands in for a dev server: it answers, starts slowly, fails, ignores SIGTERM, reports
  the environment it got, or rewrites a file at start. The fake agent's `browse` action fetches `HARNESS_APP_URL`
  and saves the page.
- `makeSandbox()` gives each test a temporary git repository with a bare `origin`.
- `harness self-test` runs every contract case on throwaway repositories; `pnpm dashboard:e2e` walks the built
  dashboard in Chrome and writes `docs/screenshots/`.
