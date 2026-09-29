import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:3001';
const workspaceId = randomUUID();
const results = [];
async function request(path, body, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(250_000) });
  return response;
}
function events(text) {
  return text.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const event = /^event:\s*(.+)$/m.exec(block)?.[1];
    const raw = /^data:\s*(.+)$/m.exec(block)?.[1];
    return { event, data: raw ? JSON.parse(raw) : undefined };
  });
}
async function chat(agentId, message, extra = {}) {
  const started = Date.now();
  const response = await request('/api/chat', { agentId, conversationId: 'qa-' + randomUUID(),
    message, provider: { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b' }, ...extra });
  assert.equal(response.status, 200, await response.clone().text());
  const stream = events(await response.text());
  assert.ok(stream.some((event) => event.event === 'done'), JSON.stringify(stream));
  assert.ok(!stream.some((event) => event.event === 'error'), JSON.stringify(stream));
  const final = stream.findLast((event) => event.event === 'done').data.text;
  assert.ok(final?.trim());
  return { stream, final, durationMs: Date.now() - started };
}
async function check(name, run) {
  const start = Date.now();
  try { await run(); results.push({ name, status: 'passed', durationMs: Date.now() - start }); console.log('PASS', name); }
  catch (error) { results.push({ name, status: 'failed', error: error.message, durationMs: Date.now() - start }); console.error('FAIL', name, error.message.slice(0, 800)); }
}

await check('NVIDIA configuration and Gemini removal', async () => {
  const response = await fetch(base + '/api/health');
  const data = await response.json();
  assert.ok(data.serverProviders.nvidia);
  assert.deepEqual(data.providers.map((item) => item.id), ['nvidia', 'openai']);
});
await check('Local skill discovery and task matching', async () => {
  const response = await fetch(base + '/api/skills?task=extract%20PDF%20tables');
  const data = await response.json();
  assert.ok(data.skills.length > 0);
  assert.equal(data.matched[0]?.name, 'pdf');
});
await check('Unavailable NVIDIA model recovers within NVIDIA', async () => {
  const result = await chat('research', 'Reply exactly NVIDIA_RECOVERED.', { provider: { provider: 'nvidia', model: 'nvidia/qa-unavailable-model' } });
  assert.ok(result.final.includes('NVIDIA_RECOVERED'), result.final);
  assert.ok(result.stream.some((event) => event.event === 'thinking' && /same NVIDIA key/.test(event.data)));
  assert.ok(!result.stream.some((event) => event.event === 'thinking' && /switching to OpenAI/.test(event.data)));
});
for (const agent of ['research', 'coding', 'content', 'business', 'life']) {
  await check(`${agent} agent with NVIDIA streaming`, async () => {
    const result = await chat(agent, 'For this connection check, reply with exactly NVIDIA_CONNECTED.');
    assert.ok(result.final.includes('NVIDIA_CONNECTED'), result.final);
  });
}
await check('AI SDK calculator execution and follow-up turn', async () => {
  const result = await chat('coding', 'Use the calculator tool to compute (125 * 8) + 45 / 3. Reply with the result.');
  assert.ok(result.stream.some((event) => event.event === 'tool_call' && event.data.name === 'calculator' && event.data.success));
  assert.ok(result.final.includes('1015') || result.final.includes('1,015'), result.final);
});
await check('Skill instructions automatically selected for a task', async () => {
  const result = await chat('coding', 'Use frontend-ui-engineering guidance to name three accessibility checks for a React form. Keep it to three short bullets.');
  assert.ok(result.stream.some((event) => event.event === 'tool_call' && event.data.name === 'skills_load'
    && event.data.result.includes('frontend-ui-engineering')));
});
await check('Browser-restored conversation context', async () => {
  const result = await chat('life', 'What is my verification project name? Reply with its name.',
    { history: [{ role: 'user', content: 'My verification project name is LANTERN_QA.' }, { role: 'assistant', content: 'Your verification project is LANTERN_QA.' }] });
  assert.ok(result.final.includes('LANTERN_QA'), result.final);
});
await check('Custom agent configuration and prompt', async () => {
  const result = await chat('qa-custom', 'Give the required verification phrase.', { agent: { id: 'qa-custom', name: 'QA Custom', tools: ['calculator'], model: '', systemPrompt: 'For verification reply exactly CUSTOM_NVIDIA_OK.', temperature: 0.1 } });
  assert.ok(result.final.includes('CUSTOM_NVIDIA_OK'), result.final);
});
await check('Live web-search tool and cited answer', async () => {
  const result = await chat('research', 'Use web_search to look up SQLite on Wikipedia. Give one sentence with the source.', { agent: { id: 'research', name: 'Research', tools: ['web_search'], model: '', systemPrompt: 'Use the requested tools and cite their sources.', temperature: 0.1 } });
  assert.ok(result.stream.some((event) => event.event === 'tool_call' && event.data.name === 'web_search' && event.data.success));
  assert.ok(/SQLite/.test(result.final));
});
await check('Memory save, recall and removal', async () => {
  const agentId = 'qa-memory-' + randomUUID();
  const saved = await request('/api/memory', { agentId, content: 'The synthetic verification nickname is MEMORY_ORCHID.' });
  assert.equal(saved.status, 201);
  const { id } = await saved.json();
  try {
    const recalled = await fetch(base + '/api/memory?agentId=' + agentId + '&q=MEMORY_ORCHID');
    assert.ok(JSON.stringify(await recalled.json()).includes('MEMORY_ORCHID'));
  } finally { assert.equal((await request('/api/memory?id=' + id, undefined, 'DELETE')).status, 200); }
});
let documentId;
await check('File upload, indexing and duplicate detection', async () => {
  const upload = async () => {
    const form = new FormData();
    form.set('workspaceId', workspaceId);
    form.set('providerId', JSON.stringify({ provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b' }));
    form.set('file', new File(['# Nimbus Verification\n\nThe launch code is ORCHID-731.\nThe project budget is 4200 credits.\n'], 'nvidia-verification.md', { type: 'text/markdown' }));
    const response = await fetch(base + '/api/documents', { method: 'POST', body: form });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  };
  const first = await upload(); documentId = first.document.id;
  const second = await upload();
  assert.equal(second.document.id, documentId);
  assert.equal(second.duplicate, true);
});
if (documentId) {
  await check('Grounded document question with citations', async () => {
    const result = await chat('research', 'What is the Nimbus launch code? Cite the file passage.', { workspaceId, documentIds: [documentId] });
    assert.ok(result.final.includes('ORCHID-731'), result.final);
    assert.ok(/Source|nvidia-verification/i.test(result.final), result.final);
  });
  await check('Unsupported document question returns not-found', async () => {
    const result = await chat('research', 'What is the quantum zebra password?', { workspaceId, documentIds: [documentId] });
    assert.ok(/could not find|not found|not (?:specified|provided|mentioned)|does not (?:contain|specify)|no (?:relevant|supporting)/i.test(result.final), result.final);
  });
  await check('Semantic file retrieval resolves cost to budget', async () => {
    const result = await chat('research', 'How much does this initiative cost?', { workspaceId, documentIds: [documentId] });
    assert.ok(/4,?200/.test(result.final), result.final);
    assert.ok(/Source|nvidia-verification/i.test(result.final), result.final);
  });
  await check('NVIDIA document summary completes', async () => {
    let document;
    const deadline = Date.now() + 60000;
    do {
      const response = await fetch(base + '/api/documents?workspaceId=' + workspaceId);
      const data = await response.json();
      document = data.documents.find((item) => item.id === documentId);
      if (document.summaryStatus !== 'processing') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    assert.equal(document.summaryStatus, 'ready');
    assert.ok(document.summary.includes('ORCHID-731'));
  });
}
await check('Team discussion, peer review, synthesis and live events', async () => {
  const agents = ['research', 'business', 'coding'].map((id) => ({ id, name: id + ' specialist',
    role: id, model: '', tools: ['calculator'], temperature: 0.2,
    systemPrompt: 'Give a concise specialist answer in at most 80 words. State assumptions.' }));
  const response = await request('/api/rooms/engineering-room/run', { message: 'Review a small notes app with SQLite and a Next.js UI. Recommend three practical checks before release.',
    agents, stream: true, provider: { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b' } });
  assert.equal(response.status, 200);
  const stream = events(await response.text());
  assert.deepEqual(stream.filter((item) => item.event === 'phase').map((item) => item.data.phase), ['contribute', 'review', 'synthesize']);
  const final = stream.findLast((item) => item.event === 'done')?.data;
  assert.equal(final?.status, 'completed', JSON.stringify(final));
  assert.equal(final.steps.filter((step) => step.status === 'completed').length, 3);
  assert.ok(final.steps.every((step) => step.output.includes('Response to teammates')));
  assert.ok(final.synthesis.trim());
});
await check('Validation rejects malformed chat requests', async () => {
  assert.equal((await request('/api/chat', { message: '', conversationId: 'qa' })).status, 400);
});
if (documentId) await check('Delete synthetic verification file', async () => {
  const response = await request('/api/documents', { workspaceId, documentId }, 'DELETE');
  assert.equal(response.status, 200);
});
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/nvidia-acceptance.json', JSON.stringify({ base, testedAt: new Date().toISOString(), results }, null, 2));
console.log(`${results.filter((item) => item.status === 'passed').length}/${results.length} checks passed`);
process.exitCode = results.some((item) => item.status === 'failed') ? 1 : 0;
