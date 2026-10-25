# harness-demo — working notes for Claude Code

An autonomous task harness: a zero-dependency Node core (`harness/`) drives one `claude -p` per unit of work
over task files in a project's `.harness/tasks/`. Code-owned contracts check every unit.

## Commands

| What | Command |
|---|---|
| Install | `pnpm install` (pnpm only — never npm or yarn) |
| Typecheck | `pnpm -r exec tsc -b` |
| Lint | `pnpm lint` |
| Tests | `node --test harness/` |
| Contract self-test | `node harness/bin/harness.ts self-test` |
| CLI help | `node harness/bin/harness.ts --help` |
| Provenance check | `pnpm provenance` |

Node 26 is required (`.nvmrc`). It runs the TypeScript in `harness/` directly by type stripping — there is no build.

## Layout

```
harness/
├── bin/harness.ts        the CLI — the dashboard calls the same functions and writes the same files
├── task/                 parse · write (owned sections, human actions) · transitions · validate · yaml
├── contracts/            scope · gate · trace · closing — the checks a unit must pass
├── runner.ts             one unit: pick → branch → snapshot → spawn → contracts → transition → commit
├── supervise.ts          policy over time: lock, PAUSE/STOP files, exit codes, barren stop, usage-limit wait
├── queue.ts              the pure "what next" predicate
├── projects.ts           ~/.harness/projects.json registry ($HARNESS_HOME overrides) and project init
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
- **Loop tests never touch a real project.** They run on `makeSandbox()` — a temp git repo with a bare `origin` —
  and set `HARNESS_HOME` when they need the registry. Never point a test at `examples/`.
- **Every file write the dashboard or CLI makes is atomic** (`atomicWrite`: temp file + rename).
- **Human and agent transitions are separate sets** (`HUMAN_TRANSITIONS`, `AGENT_TRANSITIONS`). The dashboard may
  only offer the human set.
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
