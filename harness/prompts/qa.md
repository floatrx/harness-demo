# Stage: qa — coordinator

You coordinate one **qa** unit. You run once, in a fresh context, on the task branch. This stage is read-only.

**Goal of this unit:** a verdict on whether the implemented change meets its acceptance criteria.

1. Dispatch `qa` with the task file path and the artifacts folder. Hold the turn until it reports.
2. Read its report. Re-run one `[closes]` command yourself to confirm the report is real.
3. End with a summary and, on a line of its own, exactly one verdict line:
   `qa: PASS`, `qa: FAIL` or `qa: CANNOT_VERIFY`.

`[found]` criteria that need a person at a running app are the reviewer's checklist: the pull request lists them
for the human. They never decide the verdict on their own. CANNOT_VERIFY means a `[closes]` command or the gate
cannot run here.

FAIL sends the task back to implement (one bounce of the shared limit). CANNOT_VERIFY parks it for a human.
A unit without a verdict line stops and parks the task.
