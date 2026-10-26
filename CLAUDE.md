# harness-demo — working notes for Claude Code

An autonomous task harness: a zero-dependency Node core (`harness/`) drives one `claude -p` per unit of work
over task files in a project's `.harness/tasks/`. Code-owned contracts check every unit.

## Commands

| What | Command |
|---|---|
| Install | `pnpm install` (pnpm only — never npm or yarn) |
| Typecheck | `pnpm typecheck` (= `pnpm -r exec tsc -b --force`: the dashboard's incremental build does not see changes in `harness/`, so a plain `-b` can report green on a broken dashboard) |
| Lint | `pnpm lint` |
| Tests | `node --test harness/ dashboard/` (core + dashboard route handlers) |
| Contract self-test | `node harness/bin/harness.ts self-test` |
| CLI help | `node harness/bin/harness.ts --help` |
| Provenance check | `pnpm provenance` |
| Agents: list, check, sync rules | `node harness/bin/harness.ts agents --check` · `… agents --sync` |
| What the next unit would get | `node harness/bin/harness.ts preview T-001 --project <path>` (no tokens) |
| Dashboard | `pnpm dashboard` → http://127.0.0.1:4777 (`HARNESS_HOME` picks the registry) |
| Demo data for the dashboard | `HARNESS_HOME=/tmp/h/home pnpm dashboard:seed /tmp/h/bookmarks` (fake agent, zero tokens) |
| Live demo, zero tokens | start the dashboard with `AGENT_CMD="node $PWD/harness/testkit/fake-agent.ts"` (and optionally `HARNESS_FAKE_SCENARIO`) — the supervisor it starts inherits both |
| Dashboard walkthrough (e2e + screenshots) | `pnpm -C dashboard build && pnpm dashboard:e2e` (`--docs` rewrites `docs/screenshots/`; system Chrome) |
| Telegram notifications | `node harness/bin/harness.ts notify [--test]` — keys from env → `<project>/.env` → `~/.harness/.env`; an empty `TELEGRAM_BOT_TOKEN` switches them off (tests and the e2e do) |
| Delivery (`deliver.pr: true`) | the runner pushes the task branch and runs `gh pr create`, never merge; `HARNESS_GH` replaces `gh` (tests: `harness/testkit/fake-gh.ts`) |

Node 26 is required (`.nvmrc`). It runs the TypeScript in `harness/` directly by type stripping — there is no build.

## Layout

```
examples/app/             the example project TEMPLATE (Next.js bookmarks + .harness/ config and 3 seed tasks);
                          never driven in place — `harness example <dest>` makes a standalone git copy
dashboard/                the control plane (Next 16 · HeroUI 3 · Tailwind 4): src/lib = server-only data + mutations
                          (lib/actions.ts holds every write and its guards), src/components = UI, scripts/seed-demo.ts,
                          e2e/walkthrough.ts (the browser walkthrough that also makes docs/screenshots/)
agents/                   the base specialist registry: one .md per role (frontmatter + prompt + standing-rules block)
harness/
├── bin/harness.ts        the CLI — the dashboard calls the same functions and writes the same files
├── task/                 parse · write (owned sections, human actions) · transitions · validate · yaml
├── contracts/            scope · gate · trace · closing — the checks a unit must pass
├── runner.ts             one unit: pick → branch → snapshot → spawn → contracts → transition → commit
├── supervise.ts          policy over time: lock, PAUSE/STOP files, exit codes, barren stop, usage-limit wait
├── queue.ts              the pure "what next" predicate
├── agents.ts             registry merge (base + <project>/.claude/agents), standing-rules drift/sync, --agents JSON
├── memory.ts             the "## Memory" block of a unit's prompt: measured facts first, then the journal tail
├── prompts/              one coordinator prompt per stage + STANDING-RULES.md (the single source of the rules)
├── projects.ts           ~/.harness/projects.json registry ($HARNESS_HOME overrides) and project init
├── example.ts            `harness example <dest>`: copy the template, git init, install, first commit, register
├── config.ts · paths.ts · git.ts
├── selftest.ts           every contract case on a throwaway repo (shared by the CLI and node:test)
└── testkit/              fake-agent.ts (scripted stand-in for `claude -p`) · sandbox.ts (temp git repo)
```

## Rules for this codebase

- **No enums, namespaces or parameter properties in `harness/`.** Node's type stripping accepts erasable syntax
  only (`erasableSyntaxOnly` in `tsconfig.base.json`, enforced by ESLint). Use an `as const` array and a union type.
- **Relative imports carry the `.ts` extension** (`import { x } from './task/parse.ts'`).
- **`harness/` has zero runtime dependencies.** Dev dependencies only (TypeScript, ESLint, Prettier, types).
- **The agent is the least trusted part.** A rule that matters is a contract in code, not a sentence in a prompt.
- **Narrow every check.** A check must not fail a unit for a defect the unit did not cause (see `contracts/gate.ts`).
- **`examples/app` is a template, not a project.** The loop needs its own git repository (it branches and commits),
  so never run it with `--project examples/app`; keep the template green (`pnpm -C examples/app typecheck && … test`).
  A change to the template runs the e2e walkthrough **before** the commit: the e2e and the quickstart drive a copy of
  it (its `app` block once made every fake qa/prototype unit start a real `next dev`, which broke the e2e).
- **Telegram sends only unique messages, and a test never reaches the real chat.** `notify` holds back a repeat (same
  project + text, ids and timestamps normalized) for 6 h, caps the chat at 6 messages a minute, and a project folder
  that no longer exists sends nothing. A test that runs the supervisor in-process stops it (`requestStop` + `await`)
  before `sandbox.cleanup()`: a loop left running outlived its sandbox and flooded the user's chat (2026-10-26).
- **Loop tests never touch a real project.** They run on `makeSandbox()` — a temp git repo with a bare `origin` —
  and set `HARNESS_HOME` when they need the registry. Never point a test at `examples/`.
- **Every file write the dashboard or CLI makes is atomic** (`atomicWrite`: temp file + rename).
- **Every dashboard write goes through `dashboard/src/lib/actions.ts`**: a POST with `x-harness: 1`, refused while
  the task is in `running.json`, applied with the core's human actions. Route handlers only delegate to it.
- **Dashboard server modules import with explicit `.ts` extensions** (`./board.ts`) so `node --test` can load them.
- **Human and agent transitions are separate sets** (`HUMAN_TRANSITIONS`, `AGENT_TRANSITIONS`). The dashboard may
  only offer the human set.
- **Standing rules live in one file**, `harness/prompts/STANDING-RULES.md`. Edit it there, then run
  `harness agents --sync`; a drifted copy in `agents/*.md` refuses every run (exit 2).
- **The judge is never on the same model as the implementer or the tester** — checked at every unit.
- Code comments and docs in English.

## Provenance — this repository is public

Everything here is written from scratch. Never copy code, prompts, logs, journals or traces from another
(private) codebase into this repository, and never name private projects, clients or people. Screenshots come only
from this repository running on its own example project. Before a commit, `pnpm provenance` must pass. Its
pattern uses character classes (`[r]`) so that the pattern itself never matches the file it is written in.

## Git

- No commits, branches or pushes without the user's explicit approval.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`), no co-author lines.
- Author e-mail for this repo: `ifloatrx@gmail.com`.
- Never kill a process by pattern (`pkill`, `killall`, `pgrep | kill`, `lsof | xargs kill`) — only a PID you started.
