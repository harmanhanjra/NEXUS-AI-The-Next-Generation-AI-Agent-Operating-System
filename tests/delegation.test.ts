import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delegationTeam, delegateTask } from '../lib/delegation.ts';
import { AGENTS } from '../lib/agents.ts';
import { streamHarness } from '../lib/harness.ts';
import { NVIDIA_FIRST_ANSWER_TIMEOUT_MS, streamAgentResponse, type StreamEvent } from '../lib/llm.ts';

test('team accepts sanitized custom agents and excludes recursive head delegation', () => {
  const team = delegationTeam([{ id: 'custom-review', name: 'Reviewer', tools: ['calculator', 'shell'] }, null, { id: 'head', name: 'Head' }]);
  assert.equal(team.some((agent) => agent.id === 'head'), false);
  assert.deepEqual(team.find((agent) => agent.id === 'custom-review')?.tools, ['calculator']);
  assert.ok(team.some((agent) => agent.id === 'coding'));
});

test('NVIDIA request remains active after the old 20-second cutoff', async (context) => {
  assert.equal(NVIDIA_FIRST_ANSWER_TIMEOUT_MS, 60_000);
  const oldFetch = globalThis.fetch;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  let notify!: () => void;
  const started = new Promise<void>((resolve) => { notify = resolve; });
  globalThis.fetch = async (_url, init) => {
    signal = init?.signal || undefined;
    notify();
    return new Promise<Response>((resolve) => { release = resolve; });
  };
  try {
    const events: StreamEvent[] = [];
    const run = (async () => {
      for await (const event of streamAgentResponse({ apiKey: 'test-key', agent: { ...AGENTS.coding, tools: [] }, history: [], userMessage: 'Hello',
        provider: { id: 'nvidia', label: 'NVIDIA', model: 'test', builtin: true, baseUrl: 'https://integrate.api.nvidia.com/v1' } })) events.push(event);
    })();
    await started;
    context.mock.timers.tick(21_000);
    assert.equal(signal?.aborted, false);
    release(new Response('data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
    await run;
    assert.equal(events.at(-1)?.data.text, 'Ready');
  } finally { globalThis.fetch = oldFetch; context.mock.timers.reset(); }
});

test('NVIDIA stops a silent model after one minute and starts same-key recovery', async (context) => {
  const oldFetch = globalThis.fetch;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  let notify!: () => void;
  const started = new Promise<void>((resolve) => { notify = resolve; });
  globalThis.fetch = async (_url, init) => {
    signal = init?.signal || undefined;
    notify();
    return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const iterator = streamAgentResponse({ apiKey: 'test-key', agent: { ...AGENTS.coding, tools: [] }, history: [], userMessage: 'Hello',
    provider: { id: 'nvidia', label: 'NVIDIA', model: 'silent-model', builtin: true, baseUrl: 'https://integrate.api.nvidia.com/v1' } });
  try {
    await iterator.next();
    const next = iterator.next();
    await started;
    context.mock.timers.tick(59_999);
    assert.equal(signal?.aborted, false);
    context.mock.timers.tick(2);
    assert.equal(signal?.aborted, true);
    assert.match(String((await next).value?.data), /same NVIDIA key/);
  } finally { await iterator.return(undefined); globalThis.fetch = oldFetch; context.mock.timers.reset(); }
});

test('head executes a real child call on the same provider and feeds its answer into synthesis', async () => {
  const oldFetch = globalThis.fetch;
  const oldDisabled = process.env.NEXUS_DISABLE_LOCAL_SKILLS;
  process.env.NEXUS_DISABLE_LOCAL_SKILLS = 'true';
  const requests: any[] = [];
  const completion = (delta: unknown, finish_reason: string | null) => ({ id: 'qa', object: 'chat.completion.chunk', created: 1, model: 'qa', choices: [{ index: 0, delta, finish_reason }] });
  const response = (delta: unknown, reason = 'stop') => new Response(`data: ${JSON.stringify(completion(delta, null))}\n\ndata: ${JSON.stringify(completion({}, reason))}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://example.com/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer same-key');
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (requests.length === 1) return response({ tool_calls: [{ index: 0, id: 'delegate-1', type: 'function', function: { name: 'agent_delegate', arguments: '{"agentId":"coding","task":"Return CHILD_OK"}' } }] }, 'tool_calls');
    if (requests.length === 2) {
      assert.equal(body.tools.some((item: any) => item.function.name === 'agent_delegate'), false);
      return response({ content: 'CHILD_OK' });
    }
    assert.ok(body.messages.some((item: any) => item.role === 'tool' && item.content.includes('CHILD_OK')));
    return response({ content: 'Verified CHILD_OK' });
  };
  try {
    const events = [];
    for await (const event of streamHarness({ apiKey: 'same-key', agent: AGENTS.head, history: [], userMessage: 'Ask Coding to return CHILD_OK', harness: true,
      provider: { id: 'test', label: 'Test', builtin: false, model: 'qa', baseUrl: 'https://example.com/v1' } })) events.push(event);
    assert.equal(requests.length, 3);
    assert.equal(events.find((event) => event.type === 'tool_call' && event.data.name === 'agent_delegate')?.data.success, true);
    assert.equal(events.at(-1)?.data.text, 'Verified CHILD_OK');
    await assert.rejects(delegateTask({ apiKey: '', agent: AGENTS.head, history: [], userMessage: '', provider: { id: 'test', label: 'Test', builtin: false, model: 'qa', baseUrl: 'https://example.com/v1' }, delegationDepth: 1 }, AGENTS.coding, 'test'), /Nested delegation/);
  } finally { globalThis.fetch = oldFetch; if (oldDisabled === undefined) delete process.env.NEXUS_DISABLE_LOCAL_SKILLS; else process.env.NEXUS_DISABLE_LOCAL_SKILLS = oldDisabled; }
});

test('delegated document tasks preserve grounding and exclude memory, web, skills and further delegation', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.messages[0].content.includes('[Source 1] QA budget 4200'));
    const names = body.tools.map((item: any) => item.function.name);
    assert.ok(names.includes('document_search'));
    for (const name of ['memory_recall', 'web_search', 'skill_search', 'agent_delegate']) assert.equal(names.includes(name), false);
    return new Response('data: {"id":"qa","object":"chat.completion.chunk","created":1,"model":"qa","choices":[{"index":0,"delta":{"content":"4200 [Source 1]"},"finish_reason":null}]}\n\ndata: {"id":"qa","object":"chat.completion.chunk","created":1,"model":"qa","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const result = await delegateTask({ apiKey: '', agent: { ...AGENTS.head, systemPrompt: 'DOCUMENT-GROUNDED ANSWERING:\n[Source 1] QA budget 4200' },
      history: [], userMessage: '', harness: true, workspaceId: 'qa-workspace-1234', documentIds: ['qa-file'],
      provider: { id: 'test', label: 'Test', builtin: false, model: 'qa', baseUrl: 'https://example.com/v1' } },
    { ...AGENTS.research, tools: ['document_search', 'memory_recall', 'web_search'] }, 'What is the budget?');
    assert.equal(result.status, 'completed');
    assert.equal(result.answer, '4200 [Source 1]');
  } finally { globalThis.fetch = oldFetch; }
});
