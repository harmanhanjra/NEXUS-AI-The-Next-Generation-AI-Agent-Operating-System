import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamHarness } from '../lib/harness.ts';
import { AGENTS } from '../lib/agents.ts';

function completion(delta: unknown, finishReason: string | null) {
  return { id: 'completion-1', object: 'chat.completion.chunk', created: 1, model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }] };
}
function sse(chunks: unknown[]) {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } });
}

test('AI SDK executes a calculator tool and includes its result in the next model turn', async () => {
  const originalFetch = globalThis.fetch;
  const oldDisabled = process.env.NEXUS_DISABLE_LOCAL_SKILLS;
  process.env.NEXUS_DISABLE_LOCAL_SKILLS = 'true';
  const requests: any[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1) return sse([
      completion({ tool_calls: [{ index: 0, id: 'calc-1', type: 'function',
        function: { name: 'calculator', arguments: '{"expression":"(125*8)+45/3"}' } }] }, null),
      completion({}, 'tool_calls'),
    ]);
    return sse([completion({ content: '1015' }, null), completion({}, 'stop')]);
  };
  try {
    const events = [];
    for await (const event of streamHarness({ apiKey: '', agent: { ...AGENTS.coding, tools: ['calculator'] },
      history: [], userMessage: 'Use calculator to compute (125*8)+45/3.',
      provider: { id: 'test', label: 'Test', model: 'test-model', baseUrl: 'https://example.com/v1', builtin: false } })) events.push(event);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].tool_choice, { type: 'function', function: { name: 'calculator' } });
    assert.ok(requests[1].messages.some((message: any) => message.role === 'tool' && message.content.includes('1015')));
    assert.equal(events.find((event) => event.type === 'tool_call')?.data.success, true);
    assert.equal(events.at(-1)?.data.text, '1015');
    assert.equal(events.at(-1)?.data.steps, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldDisabled === undefined) delete process.env.NEXUS_DISABLE_LOCAL_SKILLS;
    else process.env.NEXUS_DISABLE_LOCAL_SKILLS = oldDisabled;
  }
});
