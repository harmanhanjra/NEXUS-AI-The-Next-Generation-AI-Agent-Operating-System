import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const base = process.argv[2] || 'http://localhost:3001';
const checks = [];
async function chat(agentId, message, extra = {}) {
  const start = Date.now();
  const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, message, conversationId: 'agent-qa-' + randomUUID(), provider: { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b' }, ...extra }), signal: AbortSignal.timeout(310_000) });
  assert.equal(response.status, 200);
  const events = (await response.text()).split(/\r?\n\r?\n/).filter(Boolean).map((block) => ({
    event: /^event:\s*(.+)$/m.exec(block)?.[1], data: JSON.parse(/^data:\s*(.+)$/m.exec(block)?.[1] || 'null'),
  }));
  assert.equal(events.some((event) => event.event === 'error'), false, JSON.stringify(events));
  const text = events.findLast((event) => event.event === 'done')?.data.text;
  assert.ok(text?.trim(), JSON.stringify(events));
  return { text, events, durationMs: Date.now() - start };
}
async function check(name, run) {
  try { const result = await run(); checks.push({ name, status: 'passed', ...result }); console.log('PASS', name); }
  catch (error) { checks.push({ name, status: 'failed', error: error.message }); console.log('FAIL', name, error.message.slice(0, 500)); }
}
for (const agent of ['head', 'research', 'coding', 'content', 'business', 'life']) {
  await check(`${agent}: exact arithmetic with tool`, async () => {
    const result = await chat(agent, 'Use the calculator to compute 17 * 23. Answer only the number.');
    assert.match(result.text, /391/);
    assert.ok(result.events.some((event) => event.event === 'tool_call' && event.data.name === 'calculator'));
    return { answer: result.text, durationMs: result.durationMs };
  });
  await check(`${agent}: coding outside specialty`, async () => {
    const result = await chat(agent, 'Write a Python function named is_even(n) that returns whether n is even. Return only the code, without analysis or advice.');
    assert.match(result.text, /def is_even\s*\(n\)/);
    assert.match(result.text, /%\s*2/);
    return { answer: result.text, durationMs: result.durationMs };
  });
  await check(`${agent}: creative writing outside specialty`, async () => {
    const result = await chat(agent, 'Write exactly two short sentences of a fictional story about a fox named Amber finding a blue umbrella. No questions or advice.');
    assert.match(result.text, /Amber/i); assert.match(result.text, /umbrella/i);
    assert.ok(result.text.length < 800);
    return { answer: result.text, durationMs: result.durationMs };
  });
}
await check('Default head coordinates two real agents and a custom agent', async () => {
  const result = await chat(undefined, 'Use agent_delegate to ask Coding to compute 12*12 and Content to write a five-word slogan for a notebook. Also ask custom-check to reply CUSTOM_DELEGATED. Summarize their returned answers briefly.',
    { teamAgents: [{ id: 'custom-check', name: 'Custom checker', systemPrompt: 'Answer the request directly.', tools: ['calculator'], model: '' }] });
  const delegates = result.events.filter((event) => event.event === 'tool_call' && event.data.name === 'agent_delegate');
  for (const id of ['coding', 'content', 'custom-check']) assert.ok(delegates.some((event) => JSON.parse(event.data.args).agentId === id && JSON.parse(event.data.result).status === 'completed'), JSON.stringify(delegates));
  assert.match(result.text, /144/); assert.match(result.text, /CUSTOM_DELEGATED/);
  return { answer: result.text, assignments: delegates.map((event) => JSON.parse(event.data.result)), durationMs: result.durationMs };
});
await writeFile('artifacts/agent-acceptance.json', JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));
console.log(`${checks.filter((item) => item.status === 'passed').length}/${checks.length} passed`);
if (checks.some((item) => item.status !== 'passed')) process.exitCode = 1;
