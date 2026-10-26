// Seeds a demo project for the dashboard: a fresh copy of examples/app, driven by the fake agent (zero tokens)
// so its tasks rest in real states — draft, needs-input, planned, prototype review, qa, done, parked.
//
//   node dashboard/scripts/seed-demo.ts <dest>      (HARNESS_HOME decides which registry it lands in)

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExample } from '@harness/core/example';
import { supervise } from '@harness/core/supervise';
import { loadTask, nextTaskId, saveTask } from '@harness/core/task/task';
import { type NewTask, approve, createTask, submit } from '@harness/core/task/write';

const dest = process.argv[2];
process.env.TELEGRAM_BOT_TOKEN = ''; // the seed drives ~20 units: never ping the real chat
if (!dest) throw new Error('usage: node dashboard/scripts/seed-demo.ts <dest>');
const FAKE = fileURLToPath(new URL('../../harness/testkit/fake-agent.ts', import.meta.url));

const project = createExample(resolve(dest), { name: 'bookmarks', log: (line) => console.log(line) });
const tasks = join(project.path, '.harness', 'tasks');
const scenario = join(project.path, '..', 'seed-scenario.json');

/* Each first unit of a stage dispatches the specialists that stage offers (agents/*.md `stages`) and ends with a
   stream-json result, so /live has agent lanes and /stats has numbers. The tokens and costs are SYNTHETIC — the fake agent spends nothing; durations are real. */
type Call = { tool: string; file?: string };
const crew = (role: string, ...calls: Call[]) => ({ dispatch: { role, calls, stepMs: 140 } });
const result = (text: string, tokens: number, costUsd: number, denials?: { tool: string; command?: string }[]) => ({
  stream: { result: text, tokens, costUsd, ...(denials ? { denials } : {}) },
});
const read = (file: string): Call => ({ tool: 'Read', file });
const edit = (file: string): Call => ({ tool: 'Edit', file });
const bash: Call = { tool: 'Bash' };
const LIB = 'src/lib/bookmarks.ts';
const TEST = 'src/lib/bookmarks.test.ts';
const PAGE = 'src/app/page.tsx';
const LIST = 'src/components/bookmark-list.tsx';

writeFileSync(
  scenario,
  JSON.stringify({
    defaults: { scope: ['src/**'], closes: 'test -f src/feature.txt' },
    steps: {
      spec: [
        [
          { default: true },
          crew('writer', read(PAGE), { tool: 'Grep' }, read(LIB), read(LIST)),
          result('Spec written.', 18_400, 0.19),
        ],
      ],
      plan: [
        [
          { default: true },
          crew('explorer', read(LIB), read(TEST), { tool: 'Glob' }),
          crew('planner', read(LIB), read(PAGE)),
          result('Plan written.', 26_100, 0.27),
        ],
      ],
      prototype: [
        [
          { default: true },
          crew('designer', read(PAGE), read('src/app/globals.css'), { tool: 'Write', file: 'prototype.svg' }),
          result('Round ready.', 34_800, 0.41),
        ],
      ],
      implement: [
        [
          { default: true },
          crew('tester', read(TEST), edit(TEST), bash),
          crew('implementer', read(LIB), edit(LIB), edit(LIST), bash),
          result('Implemented.', 61_200, 0.88),
        ],
      ],
      qa: [[{ default: true }, crew('qa', bash, read(TEST), bash), result('qa: PASS', 22_300, 0.24)]],
      judge: [
        [
          { default: true },
          crew('judge', { tool: 'Bash' }, read(LIB), read(TEST)),
          result('judge: CONFIRMED', 15_800, 0.31),
        ],
      ],
      'T-003:spec': [
        [
          { default: true },
          {
            question: 'What should “better” mean first?',
            options: [
              'Faster to find a bookmark: search and tags — recommended: the list grows past one screen',
              'Nicer to look at: favicons and a denser layout',
              'Safer: export and import',
            ],
          },
          {
            question: 'Where should the bookmarks be stored?',
            options: [
              'Keep localStorage — recommended: no backend is in scope',
              'A JSON file written by a server action',
            ],
          },
          crew('writer', read(PAGE), read(LIB)),
          result('Two questions for the human.', 12_900, 0.14),
        ],
      ],
      'T-005:implement': [
        [
          { default: true },
          { append: 'README.md', content: '\nSorted by title.\n' },
          crew('implementer', read(LIB), edit(LIB), { tool: 'Edit', file: 'README.md' }),
          result('Implemented.', 47_500, 0.66, [
            { tool: 'Bash', command: 'curl -s https://registry.npmjs.org/sort-by' },
          ]),
        ],
      ],
    },
  }),
);
const agent = { agentCommand: `node ${JSON.stringify(FAKE)}`, env: { HARNESS_FAKE_SCENARIO: scenario } };

const extra: Omit<NewTask, 'id'>[] = [
  {
    title: 'Show the date a bookmark was added',
    draft: 'Each bookmark shows when it was added, as “3 days ago”.',
    kind: 'logic',
  },
  { title: 'Sort bookmarks by title', draft: 'A toggle sorts the list by title instead of by date.', kind: 'logic' },
  {
    title: 'Tag bookmarks and filter by tag',
    draft: 'Give a bookmark tags and filter the list by one tag.',
    kind: 'logic',
  },
  {
    title: 'Import bookmarks from a browser export',
    draft: 'Import the HTML file that browsers export.',
    kind: 'logic',
  },
];
for (const task of extra) {
  const id = nextTaskId(tasks);
  saveTask(join(tasks, `${id}.md`), createTask({ ...task, id }));
}

const path = (id: string) => join(tasks, `${id}.md`);
const act = (id: string, change: typeof submit) => saveTask(path(id), change(loadTask(path(id)).doc));
const run = (maxUnits?: number) =>
  supervise(project.path, { ...agent, onceThrough: true, ...(maxUnits ? { maxUnits } : {}) });

// Each task is driven alone, so the queue's "finish first" order cannot interleave them.
act('T-002', submit);
await run();
act('T-002', approve);
await run(); // T-002 → done, one commit
act('T-005', submit);
await run();
act('T-005', approve);
await run(); // T-005 → parked: the implementer edited README.md
act('T-003', submit);
await run(); // T-003 → needs-input, two questions
act('T-006', submit);
await run(); // T-006 → planned, waits for approval
act('T-001', submit);
await run();
act('T-001', approve);
await run(); // T-001 → prototype, round 1 in review
act('T-004', submit);
await run();
act('T-004', approve);
await run(1); // T-004 → implemented, waits for the qa unit
// T-007 stays a draft.

for (const id of ['T-001', 'T-002', 'T-003', 'T-004', 'T-005', 'T-006', 'T-007']) {
  const { fields } = loadTask(path(id));
  console.log(`${id}  ${fields.status.padEnd(12)} ${fields.title}`);
}
console.log(`\nproject ${project.id} · ${project.path}`);
