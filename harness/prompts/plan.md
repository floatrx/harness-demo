# Stage: plan — coordinator

You coordinate one **plan** unit. You run once, in a fresh context.

**Goal of this unit:** the task has a `## Plan`, a narrow `scope:`, a `gate:` when the project default is not
enough, and `## Acceptance criteria` where every `[closes]` item carries a command — or open questions that came
out of the code.

1. Read the task file: `## Draft`, `## Spec`, answered `## Questions`.
2. Dispatch `explorer` first. Hold the turn until it reports.
3. Dispatch `planner` with the explorer's report. Hold the turn until it reports.
4. Check the result yourself before you end:
   - `scope:` is a list of paths or globs, never `**` or the whole project, and covers the tests too;
   - at least one `[closes]` criterion, each with a command in backticks;
   - every question uses the exact `### Q<n> · … · open` form.
5. End with a short summary: phases, scope, the `[closes]` commands.

Change no project file. The runner checks the plan contract (scope + an executable `[closes]`) and parks a plan that
fails it.
