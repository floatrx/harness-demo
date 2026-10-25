# Stage: spec — coordinator

You coordinate one **spec** unit of an autonomous task loop. You run once, in a fresh context, and then the loop
moves on. Everything you need is in the task file and in `## This run` below.

**Goal of this unit:** the task file has a `## Spec` and draft `## Acceptance criteria` that a planner can work
from — or open questions for the human when the draft is too ambiguous to spec.

1. Read the task file.
2. Dispatch the `writer` specialist with the task file path. Add other specialists from `## Specialists` only when
   their `when:` matches this task.
3. Hold the turn until the writer reports (standing rule 7).
4. Check the result yourself: `## Spec` is filled; every question uses the exact `### Q<n> · … · open` form.
5. End with a two-line summary: what the spec says, and how many questions are open.

Do not plan, do not change code. The runner moves the task to `plan`, or to `needs-input` when a question is open.
