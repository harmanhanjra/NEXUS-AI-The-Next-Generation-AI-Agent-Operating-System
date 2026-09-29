import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getAgent, isBuiltinAgent, sanitizeAgentConfig, AGENTS } from '../lib/agents.ts';

describe('sanitizeAgentConfig', () => {
  test('rejects empty or non-object input', () => {
    assert.equal(sanitizeAgentConfig(null), null);
    assert.equal(sanitizeAgentConfig(undefined), null);
    assert.equal(sanitizeAgentConfig('nope'), null);
    assert.equal(sanitizeAgentConfig({}), null);
  });

  test('keeps a valid agent intact', () => {
    const result = sanitizeAgentConfig({ name: 'Compliance Reviewer', model: 'gpt-4.1-mini', temperature: 0.4, role: 'Risk analyst' });
    assert.ok(result);
    assert.equal(result?.name, 'Compliance Reviewer');
    assert.equal(result?.model, 'gpt-4.1-mini');
    assert.equal(result?.temperature, 0.4);
  });

  test('defaults the provider to inherit the workspace when not given', () => {
    const result = sanitizeAgentConfig({ name: 'Helper' });
    assert.equal(result?.providerId, undefined);
  });

  test('filters unknown tools and keeps only supported ones', () => {
    const result = sanitizeAgentConfig({ name: 'Helper', tools: ['memory_recall', 'web_search', 'rm -rf'] });
    assert.deepEqual(result?.tools, ['memory_recall', 'web_search']);
  });

  test('clamps temperature into range', () => {
    assert.equal(sanitizeAgentConfig({ name: 'H', temperature: 5 })?.temperature, 1);
    assert.equal(sanitizeAgentConfig({ name: 'H', temperature: -2 })?.temperature, 0);
    assert.equal(sanitizeAgentConfig({ name: 'H', temperature: 'hot' as unknown as number })?.temperature, 0.5);
  });

  test('truncates overlong fields', () => {
    const result = sanitizeAgentConfig({ name: 'N'.repeat(200), model: 'm'.repeat(300) });
    assert.equal(result?.name.length, 80);
    assert.equal(result?.model.length, 160);
  });
});

describe('getAgent', () => {
  test('returns the requested built-in agent', () => {
    assert.equal(getAgent('coding').id, 'coding');
  });

  test('falls back to the head agent for an unknown id', () => {
    assert.equal(getAgent('nope').id, 'head');
  });

  test('recognises built-in agent ids', () => {
    assert.equal(isBuiltinAgent('research'), true);
    assert.equal(isBuiltinAgent('custom-x'), false);
  });
});

describe('built-in agents do not pin a provider', () => {
  test('every built-in agent inherits the workspace provider', () => {
    for (const agent of Object.values(AGENTS)) {
      assert.equal(agent.providerId, undefined, `${agent.id} should not pin a provider`);
    }
  });

  test('every built-in agent has a model, tools, and a prompt', () => {
    for (const agent of Object.values(AGENTS)) {
      assert.ok(agent.systemPrompt.length > 50, `${agent.id} needs a real prompt`);
      assert.ok(Array.isArray(agent.tools));
      assert.ok(agent.welcomeMessage.length > 0);
    }
  });
});
