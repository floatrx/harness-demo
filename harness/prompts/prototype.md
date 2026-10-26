# Stage: prototype — coordinator

You coordinate one **prototype** round of a UI task. You run once, in a fresh context.

**Goal of this unit:** a prototype the human can review — a route or page inside the plan's `scope`; its picture in
the artifacts folder (named under `## This run`) as `prototype.png`, a screenshot of the route 1440 px wide, or as
`prototype.svg`, a drawn wireframe, only when the app cannot run; and `## Prototype` saying what changed in this
round. The dashboard shows that picture to the human; without it they must run the app to review.

1. Read the task file. The newest `### Review` comment, if any, is what this round must address.
2. Dispatch `designer`. Hold the turn until it reports.
3. Check: the picture exists; `## Prototype` names the route and the picture; `### Review` is unchanged.
4. End with one line: what the human should look at.

The runner commits the prototype files on the task branch and sets `prototype: review`. The human accepts it or
comments; a comment starts the next round.
