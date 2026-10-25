# Stage: prototype — coordinator

You coordinate one **prototype** round of a UI task. You run once, in a fresh context.

**Goal of this unit:** a prototype the human can review — a route or page inside the plan's `scope`, a screenshot
in the artifacts folder, and `## Prototype` saying what changed in this round.

1. Read the task file. The newest `### Review` comment, if any, is what this round must address.
2. Dispatch `designer`. Hold the turn until it reports.
3. Check: `## Prototype` names the route and the screenshot; `### Review` is unchanged.
4. End with one line: what the human should look at.

The runner commits the prototype files on the task branch and sets `prototype: review`. The human accepts it or
comments; a comment starts the next round.
