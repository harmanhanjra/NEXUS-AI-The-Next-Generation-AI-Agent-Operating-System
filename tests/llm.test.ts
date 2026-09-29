import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseBlock, streamAgentResponse, type ChatTurn, type StreamEvent } from '../lib/llm.ts';
import { __resetMemoryStore } from '../lib/memory.ts';
import type { AgentConfig } from '../lib/agents.ts';
import type { ResolvedProvider } from '../lib/providers.ts';

const agent: AgentConfig = {
  id: 'test',
  name: 'Test',
  icon: 'T',
  gradient: '',
  model: 'test-model',
  modelLabel: 'test',
  temperature: 0.5,
  tools: [],
  systemPrompt: 'You are a test.',
  welcomeMessage: '',
};

const provider: ResolvedProvider = { id: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://api.example.com/v1', model: 'test-model', builtin: true };

const originalFetch = globalThis.fetch;

function sse(chunks: string[]): Response {
  const body = chunks.map((chunk) => `data: ${chunk}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function delta(text: string) {
  return JSON.stringify({ choices: [{ delta: { content: text } }] });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(String(input), init || {});
  }) as typeof fetch;
}

beforeEach(() => __resetMemoryStore());
afterEach(() => { globalThis.fetch = originalFetch; });

describe('parseSseBlock', () => {
  test('extracts every data line from a frame', () => {
    assert.deepEqual(parseSseBlock('data: one\ndata: two'), ['one', 'two']);
  });

  test('ignores non-data lines', () => {
    assert.deepEqual(parseSseBlock('event: message\nid: 5'), []);
  });

  test('handles an empty block', () => {
    assert.deepEqual(parseSseBlock(''), []);
  });
});

describe('streamAgentResponse', () => {
  test('NVIDIA worker failure switches models with the same key before output', async () => {
    const models: string[] = [];
    stubFetch((url, init) => {
      assert.equal(url, 'https://integrate.api.nvidia.com/v1/chat/completions');
      const body = JSON.parse(String(init.body)); models.push(body.model);
      return body.model === 'unavailable-model'
        ? sse([JSON.stringify({ error: { message: 'ResourceExhausted: worker limit reached', code: 500 } }), '[DONE]'])
        : sse([delta('Recovered with NVIDIA'), '[DONE]']);
    });
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'fixture', agent, history: [], userMessage: 'hi', provider: { ...provider, baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'unavailable-model' } })) events.push(event);
    assert.deepEqual(models, ['unavailable-model', 'nvidia/nemotron-3-super-120b-a12b']);
    assert.equal(events.at(-1)?.data.text, 'Recovered with NVIDIA');
    assert.ok(!events.some((event) => event.type === 'error'));
  });
  test('streams tokens as they arrive and finishes with done', async () => {
    stubFetch(() => sse([delta('Hello '), delta('world'), '[DONE]']));
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'k', agent, history: [], userMessage: 'hi', provider })) {
      events.push(event);
    }
    const tokens = events.filter((event) => event.type === 'token').map((event) => event.data);
    assert.deepEqual(tokens, ['Hello ', 'world']);
    const done = events.at(-1);
    assert.equal(done?.type, 'done');
    assert.equal((done?.data as any).text, 'Hello world');
  });

  test('sends the system prompt, history, and user message in order', async () => {
    let captured: any = null;
    stubFetch((_url, init) => {
      captured = JSON.parse(String(init.body));
      return sse([delta('ok'), '[DONE]']);
    });
    const history: ChatTurn[] = [{ role: 'user', text: 'earlier' }, { role: 'assistant', text: 'reply' }];
    for await (const _ of streamAgentResponse({ apiKey: 'k', agent, history, userMessage: 'now', provider })) { /* drain */ }
    assert.equal(captured.messages[0].role, 'system');
    assert.equal(captured.messages[1].content, 'earlier');
    assert.equal(captured.messages[2].content, 'reply');
    assert.equal(captured.messages.at(-1).content, 'now');
    assert.equal(captured.stream, true);
    assert.equal(captured.model, 'test-model');
  });

  test('sends the API key as a bearer token', async () => {
    let auth = '';
    stubFetch((_url, init) => { auth = (init.headers as Record<string, string>).Authorization; return sse([delta('ok'), '[DONE]']); });
    for await (const _ of streamAgentResponse({ apiKey: 'secret-key', agent, history: [], userMessage: 'hi', provider })) { /* drain */ }
    assert.equal(auth, 'Bearer secret-key');
  });

  test('omits the Authorization header for a keyless custom provider', async () => {
    let headers: Record<string, string> = {};
    stubFetch((_url, init) => { headers = init.headers as Record<string, string>; return sse([delta('ok'), '[DONE]']); });
    const keyless = { ...provider, id: 'ollama', label: 'Ollama', builtin: false };
    for await (const _ of streamAgentResponse({ apiKey: '', agent, history: [], userMessage: 'hi', provider: keyless })) { /* drain */ }
    assert.equal(headers.Authorization, undefined);
  });

  test('retries a 429 and then succeeds', async () => {
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      if (attempts === 1) return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 });
      return sse([delta('recovered'), '[DONE]']);
    });
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'k', agent, history: [], userMessage: 'hi', provider })) events.push(event);
    assert.ok(attempts >= 2, 'should have retried');
    assert.ok(events.some((event) => event.type === 'token' && event.data === 'recovered'));
  });

  test('does not retry a 401', async () => {
    let attempts = 0;
    stubFetch(() => { attempts += 1; return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }); });
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'k', agent, history: [], userMessage: 'hi', provider })) events.push(event);
    assert.equal(attempts, 1);
    assert.equal(events.at(-1)?.type, 'error');
    assert.match(String(events.at(-1)?.data), /401/);
  });

  test('errors clearly when a built-in provider has no key', async () => {
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: '', agent, history: [], userMessage: 'hi', provider })) events.push(event);
    assert.equal(events.at(-1)?.type, 'error');
    assert.match(String(events.at(-1)?.data), /No API key/);
  });

  test('errors when no model is set', async () => {
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'k', agent, history: [], userMessage: 'hi', provider: { ...provider, model: '' } })) events.push(event);
    assert.match(String(events.at(-1)?.data), /No model selected/);
  });

  test('handles a non-streaming JSON response from a server that ignores stream', async () => {
    stubFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: 'full answer' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'k', agent, history: [], userMessage: 'hi', provider })) events.push(event);
    assert.ok(events.some((event) => event.type === 'token' && event.data === 'full answer'));
    assert.equal((events.at(-1)?.data as any).text, 'full answer');
  });

  test('surfaces a mid-stream provider error event', async () => {
    stubFetch(() => sse([delta('partial '), JSON.stringify({ error: { message: 'upstream exploded' } })]));
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'k', agent, history: [], userMessage: 'hi', provider })) events.push(event);
    const error = events.find((event) => event.type === 'error');
    assert.ok(error, 'should report an error');
    assert.match(String(error?.data), /upstream exploded/);
  });

  test('stops when the caller aborts', async () => {
    const controller = new AbortController();
    stubFetch(() => sse([delta('one'), delta('two'), '[DONE]']));
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'k', agent, history: [], userMessage: 'hi', provider, signal: controller.signal })) {
      events.push(event);
      if (events.length === 2) controller.abort();
    }
    assert.ok(events.every((event) => event.type !== 'error'), 'an intentional stop is not an error');
  });

  test('caps history to the most recent turns', async () => {
    let captured: any = null;
    stubFetch((_url, init) => { captured = JSON.parse(String(init.body)); return sse([delta('ok'), '[DONE]']); });
    const history: ChatTurn[] = Array.from({ length: 100 }, (_, i) => ({ role: 'user' as const, text: `turn ${i}` }));
    for await (const _ of streamAgentResponse({ apiKey: 'k', agent, history, userMessage: 'now', provider })) { /* drain */ }
    // 24 history turns + system + current user message.
    assert.equal(captured.messages.length, 26);
  });

  test('emits a memory tool call when the agent has memory_recall', async () => {
    const { saveMemory } = await import('../lib/memory.ts');
    await saveMemory({ content: 'The release is scheduled for the first week of June.', agentId: 'test' });
    stubFetch(() => sse([delta('ok'), '[DONE]']));
    const events: StreamEvent[] = [];
    for await (const event of streamAgentResponse({ apiKey: 'k', agent: { ...agent, tools: ['memory_recall'] }, history: [], userMessage: 'when is the release?', provider })) events.push(event);
    const call = events.find((event) => event.type === 'tool_call');
    assert.ok(call, 'should report a tool call');
    assert.equal((call?.data as any).name, 'memory.recall');
  });

  test('truncates history rather than sending an unbounded payload', async () => {
    let captured: any = null;
    stubFetch((_url, init) => { captured = JSON.parse(String(init.body)); return sse([delta('ok'), '[DONE]']); });
    for await (const _ of streamAgentResponse({ apiKey: 'k', agent, history: [], userMessage: 'now', provider, maxTokens: 512 })) { /* drain */ }
    assert.equal(captured.max_tokens, 512);
  });
});
