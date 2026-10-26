import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from './config.ts';
import { billing } from './runner.ts';

test('billing: a stand-in, an API key, or the subscription login — never the key itself', () => {
  const saved = { agent: process.env.AGENT_CMD, key: process.env.ANTHROPIC_API_KEY };
  try {
    delete process.env.AGENT_CMD;
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(billing(DEFAULT_CONFIG).mode, 'subscription');
    process.env.ANTHROPIC_API_KEY = 'not-a-real-key-value';
    const api = billing(DEFAULT_CONFIG);
    assert.equal(api.mode, 'api-key');
    assert.ok(!api.note.includes('not-a-real-key-value'));
    assert.equal(billing(DEFAULT_CONFIG, { agentCommand: 'node fake.ts' }).mode, 'stand-in');
  } finally {
    for (const [key, value] of [
      ['AGENT_CMD', saved.agent],
      ['ANTHROPIC_API_KEY', saved.key],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
