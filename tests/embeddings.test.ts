import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, embedTexts, retrievalQuery } from '../lib/embeddings.ts';

test('embedding requests distinguish passages and questions and cache questions', async () => {
  const original = globalThis.fetch;
  const modes: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); modes.push(body.input_type);
    return Response.json({ data: body.input.map((_: string, index: number) => ({ index, embedding: [0.3, 0.8] })) });
  };
  try {
    await embedTexts(['sample'], 'passage', 'fixture');
    await embedTexts(['question'], 'query', 'fixture');
    await embedTexts(['question'], 'query', 'fixture');
    assert.deepEqual(modes, ['passage', 'query']);
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
    assert.match(retrievalQuery('How much does it cost?', ['Tell me about Nimbus']), /Nimbus/);
    assert.equal(retrievalQuery('quantum zebra password', ['Nimbus']), 'quantum zebra password');
  } finally { globalThis.fetch = original; }
});
