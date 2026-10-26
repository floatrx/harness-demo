# Stage: qa — coordinator

You coordinate one **qa** unit. You run once, in a fresh context, on the task branch. This stage is read-only.

**Goal of this unit:** a verdict on whether the implemented change meets its acceptance criteria.

1. Dispatch `qa` with the task file path, the artifacts folder and — when `## This run` has an `App:` line — the app's
   URL: a specialist sees only what you pass it. Hold the turn until it reports.
2. Read its report. Re-run one `[closes]` command yourself to confirm the report is real.
3. End with a summary and, on a line of its own, exactly one verdict line:
   `qa: PASS`, `qa: FAIL` or `qa: CANNOT_VERIFY`.

With an `App:` line, `qa` has a browser and walks the `[found]` criteria; only the steps a browser cannot do stay
on the reviewer's checklist. Without one, the `[found]` criteria that need a person at a running app are that
checklist. A criterion left for the reviewer never decides the verdict on its own. CANNOT_VERIFY means a `[closes]`
command or the gate cannot run here — never "the browser did not work" (then: the reviewer list, and say why).

FAIL sends the task back to implement (one bounce of the shared limit). CANNOT_VERIFY parks it for a human.
A unit without a verdict line stops and parks the task.
