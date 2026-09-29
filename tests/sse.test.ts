import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeSse } from '../lib/sse.ts';

test('SSE handles split UTF-8, CRLF, multiline data and a final unterminated event', async () => {
  const bytes = new TextEncoder().encode('event: token\r\ndata: "héllo"\r\n\r\nevent: step\ndata: {"status":\ndata: "completed"}\n\nevent: done\ndata: {"ok":true}');
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
    controller.close();
  } });
  const events: Array<[string, unknown]> = [];
  await consumeSse(stream, (event, data) => events.push([event, data]));
  assert.deepEqual(events, [['token', 'héllo'], ['step', { status: 'completed' }], ['done', { ok: true }]]);
});
