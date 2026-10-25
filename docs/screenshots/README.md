# Dashboard screenshots

Generated, never edited by hand: `pnpm -C dashboard build && pnpm dashboard:e2e --docs`.

The walkthrough (`dashboard/e2e/walkthrough.ts`) copies the example project, runs the built dashboard with the fake
agent and takes each screenshot at 1440 × 900 CSS px, device scale 2 (2880 × 1800 px), at the step named below. The tokens and costs in them are **synthetic**:
the fake agent spends nothing and reports made-up usage. Durations are real.

| File                   | Step                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `projects.png`         | the project list while a unit runs                                                               |
| `board.png`            | a card in QA with its agent working, a question, a plan to approve, a parked task, the Live dock |
| `task-questions.png`   | the writer's two questions for T-003, lettered options, the recommended one first                |
| `prototype-review.png` | T-001's first prototype round: Accept or comment                                                 |
| `live.png`             | the trace of the qa unit while it runs                                                           |
| `stats.png`            | units, time, tokens and cost per stage and per task after the walkthrough                        |
| `agents.png`           | the coordinators, the specialist matrix, the checks and the invocation                           |
