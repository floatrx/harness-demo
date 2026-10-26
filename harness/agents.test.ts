import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  agentsForStage,
  agentsJson,
  baseAgentsDir,
  loadRegistry,
  registryProblems,
  standingRules,
  standingRulesDrift,
  syncStandingRules,
} from './agents.ts';
import { DEFAULT_CONFIG, UNIT_STAGES } from './config.ts';
import { finalText, readUsage, readVerdict } from './contracts/trace.ts';
import { buildPrompt, invocation } from './runner.ts';
import { makeSandbox, seedTask } from './testkit/sandbox.ts';
import { previewUnit } from './runner.ts';

const BASE_ROLES = ['debugger', 'designer', 'explorer', 'implementer', 'judge', 'planner', 'qa', 'tester', 'writer'];

function tempBase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-agents-'));
  cpSync(baseAgentsDir(), join(dir, 'agents'), { recursive: true });
  return dir;
}

test('the base registry has the ten roles, each with stages, a when and a body', () => {
  const registry = loadRegistry(null);
  assert.deepEqual(
    registry.map((agent) => agent.name),
    BASE_ROLES,
  );
  for (const agent of registry) {
    assert.ok(agent.stages.length, `${agent.name} has stages`);
    assert.ok(agent.when, `${agent.name} has when`);
    assert.ok(agent.body.length > 200, `${agent.name} has a body`);
  }
});

test('every agent stage has a coordinator prompt, and every unit stage has a specialist', () => {
  const registry = loadRegistry(null);
  for (const stage of UNIT_STAGES) assert.ok(agentsForStage(registry, stage).length, `${stage} has a specialist`);
  assert.deepEqual(
    agentsForStage(registry, 'implement').map((agent) => agent.name),
    ['debugger', 'implementer', 'tester'],
  );
  assert.deepEqual(
    agentsForStage(registry, 'plan').map((agent) => agent.name),
    ['explorer', 'planner'],
  );
});

test('the base files carry the current standing rules; the default models keep the judge apart', () => {
  assert.deepEqual(standingRulesDrift(), []);
  assert.deepEqual(registryProblems(loadRegistry(null), DEFAULT_CONFIG), []);
});

test('drift is detected and --sync repairs it', () => {
  const dir = tempBase();
  try {
    const base = join(dir, 'agents');
    const qa = join(base, 'qa.md');
    writeFileSync(qa, readFileSync(qa, 'utf8').replace('Stay inside the scope.', 'Stay roughly inside the scope.'));
    assert.deepEqual(standingRulesDrift(base), [qa]);
    assert.deepEqual(syncStandingRules(base), [qa]);
    assert.deepEqual(standingRulesDrift(base), []);
    assert.match(readFileSync(qa, 'utf8'), /^---\nname: qa\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a project agent replaces the base one of the same name and adds new ones', () => {
  const dir = tempBase();
  try {
    const project = join(dir, 'project');
    mkdirSync(join(project, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(project, '.claude', 'agents', 'qa.md'),
      '---\nname: qa\ndescription: Project QA with the e2e suite.\nstages: [qa]\nwhen: always\n---\n\nRun `pnpm e2e`.\n',
    );
    writeFileSync(
      join(project, '.claude', 'agents', 'a11y.md'),
      '---\nname: a11y\ndescription: Accessibility checks.\nstages: [qa, prototype]\nwhen: kind ui\n---\n\nCheck contrast.\n',
    );
    const registry = loadRegistry(project, join(dir, 'agents'));
    assert.equal(registry.find((agent) => agent.name === 'qa')?.source, 'project');
    assert.deepEqual(
      agentsForStage(registry, 'qa').map((agent) => agent.name),
      ['qa', 'a11y'],
    );
    // A project agent without the block still receives the current standing rules.
    const json = agentsJson(agentsForStage(registry, 'qa'), DEFAULT_CONFIG);
    assert.match(json.a11y?.prompt ?? '', /Check contrast\.[\s\S]*## Standing rules/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a judge on the implementer model is a configuration error', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.roles.models.judge = 'sonnet';
  assert.match(registryProblems(loadRegistry(null), config).join('\n'), /judge and implementer share the model sonnet/);
});

test('the built-in invocation is argv without a shell, allowedTools last; an override goes through sh', () => {
  const how = invocation(DEFAULT_CONFIG, 'sonnet', '/tmp/agents.json');
  assert.equal(how.file, 'claude');
  assert.deepEqual(how.args.slice(0, 2), ['-p', '--output-format']);
  assert.ok(how.args.includes('dontAsk'));
  assert.equal(how.args[how.args.indexOf('--agents') + 1], '/tmp/agents.json');
  assert.equal(how.args.indexOf('--allowedTools'), how.args.length - DEFAULT_CONFIG.agent.allowedTools.length - 1);
  assert.ok(!how.args.some((arg) => /git (commit|push)/.test(arg)), 'commit and push are not pre-approved');
  const fake = invocation(DEFAULT_CONFIG, 'opus', '/tmp/a.json', { agentCommand: 'my-agent --model {model}' });
  assert.deepEqual([fake.file, ...fake.args], ['sh', '-c', 'my-agent --model opus']);
});

test('the prompt carries the stage prompt, the rules, the specialists, memory and this run', () => {
  const registry = loadRegistry(null);
  const prompt = buildPrompt({
    stage: 'qa',
    role: 'qa',
    task: {
      id: 'T-009',
      title: 'Thing',
      status: 'qa',
      kind: 'logic',
      resume: null,
      prototype: null,
      parkedFrom: null,
      bounces: 1,
      openQuestions: 0,
      scope: ['src/**'],
      gate: null,
      branch: 'harness/T-009-thing',
      pr: null,
      parked: null,
      created: null,
    },
    taskRel: '.harness/tasks/T-009.md',
    branch: 'harness/T-009-thing',
    artifacts: '.harness/artifacts/T-009',
    config: DEFAULT_CONFIG,
    specialists: agentsForStage(registry, 'qa'),
    memory: '## Memory\n\n- fact',
  });
  const order = ['# Stage: qa', '## Standing rules', '## Specialists you may dispatch', '## Memory', '## This run'];
  const positions = order.map((heading) => prompt.indexOf(heading));
  assert.ok(
    positions.every((at, i) => at >= 0 && (i === 0 || at > (positions[i - 1] as number))),
    `order: ${positions}`,
  );
  assert.match(prompt, /Required verdict line: `qa: PASS\|FAIL\|CANNOT_VERIFY`/);
  assert.match(prompt, /Bounces so far: 1 of 2/);
  // The qa coordinator owns no task-file section; the line says so (the planner's lists its three).
  assert.match(prompt, /sections you may write: none/);
  assert.ok(prompt.includes(standingRules()));
});

test('stream-json: the verdict comes from the final result, not from a specialist quoted in a tool result', () => {
  const rule = { token: 'qa', values: ['PASS', 'FAIL', 'CANNOT_VERIFY'] };
  const trace = [
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'qa: PASS (says the specialist)' }] },
    }),
    JSON.stringify({
      type: 'result',
      result: 'Criterion 2 is red.\n\nqa: **FAIL**',
      total_cost_usd: 0.12,
      num_turns: 7,
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000 },
    }),
  ].join('\n');
  assert.equal(readVerdict(trace, rule).verdict, 'FAIL');
  assert.equal(finalText(trace), 'Criterion 2 is red.\n\nqa: **FAIL**');
  assert.deepEqual(readUsage(trace), {
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadTokens: 5000,
    cacheWriteTokens: 0,
    costUsd: 0.12,
    durationMs: null,
    turns: 7,
    permissionDenials: [],
  });
  assert.equal(readUsage('qa: PASS'), null);
});

test('preview of a draft shows the spec unit it gets after Submit, and changes nothing', () => {
  const sandbox = makeSandbox();
  try {
    seedTask(sandbox, { id: 'T-003', status: 'draft' });
    const before = readFileSync(sandbox.taskPath('T-003'), 'utf8');
    const preview = previewUnit(sandbox.project, 'T-003');
    assert.equal(preview.stage, 'spec');
    assert.equal(preview.note, 'T-003 is a draft: this is the spec unit it gets after Submit');
    assert.match(preview.prompt, /# Stage: spec/);
    assert.equal(readFileSync(sandbox.taskPath('T-003'), 'utf8'), before, 'the task file is untouched');
  } finally {
    sandbox.cleanup();
  }
});

test('preview shows the next unit of a task without running it', () => {
  const sandbox = makeSandbox();
  try {
    seedTask(sandbox, { id: 'T-001', status: 'ready', scope: ['src/**'], closes: ['test -f src/feature.txt'] });
    const before = sandbox.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const preview = previewUnit(sandbox.project, 'T-001');
    assert.equal(preview.stage, 'implement');
    assert.deepEqual(preview.specialists, ['debugger', 'implementer', 'tester']);
    assert.match(preview.prompt, /# Stage: implement/);
    assert.match(preview.prompt, /branch: harness\/T-001-add-the-feature-file/);
    assert.equal(sandbox.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), before, 'no branch switch');
    assert.equal(sandbox.task('T-001').fields.status, 'ready', 'no status change');
  } finally {
    sandbox.cleanup();
  }
});
