import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUnitTrace } from './unit-trace.ts';

const SECRET = 'sk-live-THIS-MUST-NOT-LEAK';
const line = (ts: string, event: Record<string, unknown>) => JSON.stringify({ harness_ts: ts, ...event });
const use = (id: string, name: string, input: Record<string, unknown>, parent: string | null = null) => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { content: [{ type: 'tool_use', id, name, input }] },
});
const result = (id: string, parent: string | null = null) => ({
  type: 'user',
  parent_tool_use_id: parent,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: `done ${SECRET}` }] },
});

const TRACE = [
  line('2026-10-25T10:00:00.000Z', { type: 'system', subtype: 'init', model: 'claude-sonnet' }),
  line('2026-10-25T10:00:01.000Z', use('c1', 'Read', { file_path: '/repo/.harness/tasks/T-002.md' })),
  line('2026-10-25T10:00:02.000Z', result('c1')),
  line(
    '2026-10-25T10:00:03.000Z',
    use('a1', 'Agent', { subagent_type: 'tester', description: 'tests', prompt: `write tests ${SECRET}` }),
  ),
  line('2026-10-25T10:00:04.000Z', use('t1', 'Bash', { command: `curl -H "Authorization: ${SECRET}" x` }, 'a1')),
  line(
    '2026-10-25T10:00:05.000Z',
    use('t2', 'Edit', { file_path: '/repo/src/lib/bookmarks.test.ts', old_string: SECRET, new_string: 'x' }, 'a1'),
  ),
  line('2026-10-25T10:00:40.000Z', result('a1')),
  line('2026-10-25T10:00:41.000Z', use('a2', 'Agent', { subagent_type: 'implementer', prompt: 'go' })),
  line('2026-10-25T10:00:42.000Z', use('t3', 'Edit', { file_path: '/repo/src/lib/bookmarks.ts' }, 'a2')),
  line('2026-10-25T10:00:43.000Z', {
    type: 'assistant',
    message: { content: [{ type: 'text', text: `thinking about ${SECRET}` }] },
  }),
].join('\n');

test('agents, their state, their current tool and file (basename) come out of the trace', () => {
  const trace = parseUnitTrace(TRACE);
  assert.deepEqual(
    trace.agents.map((agent) => [
      agent.role,
      agent.state,
      agent.tool,
      agent.file,
      agent.calls,
      agent.startedAt?.slice(11, 19),
      agent.endedAt?.slice(11, 19) ?? null,
    ]),
    [
      ['tester', 'done', 'Edit', 'bookmarks.test.ts', 2, '10:00:03', '10:00:40'],
      ['implementer', 'running', 'Edit', 'bookmarks.ts', 1, '10:00:41', null],
    ],
  );
  assert.equal(trace.coordinator.calls, 3);
  assert.equal(trace.startedAt, '2026-10-25T10:00:00.000Z');
  assert.equal(trace.finished, false);
});

test('no tool argument, command, prompt or message text survives (criterion 6)', () => {
  assert.ok(!JSON.stringify(parseUnitTrace(TRACE)).includes(SECRET));
  assert.ok(!JSON.stringify(parseUnitTrace(TRACE)).includes('curl'));
});

test('the result event finishes the unit and counts permission denials', () => {
  const done = parseUnitTrace(
    `${TRACE}\n${line('2026-10-25T10:02:00.000Z', { type: 'result', result: SECRET, permission_denials: [{ tool_name: 'Bash' }] })}`,
  );
  assert.equal(done.finished, true);
  assert.equal(done.denials, 1);
  assert.ok(done.agents.every((agent) => agent.state === 'done'));
});

test('plain text output (the fake agent) yields no agents and does not throw', () => {
  const trace = parseUnitTrace('{"type":"text","harness_ts":"2026-10-25T10:00:00.000Z","text":"qa: PASS"}\nnot json\n');
  assert.deepEqual(trace.agents, []);
  assert.equal(trace.startedAt, '2026-10-25T10:00:00.000Z');
});
