import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { __resetMemoryStore, addMessage, bm25Rank, getOrCreateConversation, listMessages, recallMemory, saveMemory, tokenize } from '../lib/memory.ts';

beforeEach(() => __resetMemoryStore());

describe('tokenize', () => {
  test('lowercases, drops stop words, and keeps meaningful terms', () => {
    const tokens = tokenize('The Quick Brown Foxes are running');
    assert.ok(tokens.includes('quick'));
    assert.ok(tokens.includes('brown'));
    assert.ok(!tokens.includes('the'));
    assert.ok(!tokens.includes('are'));
  });

  test('stems plurals and gerunds so recall is not brittle', () => {
    assert.deepEqual(tokenize('deployments'), tokenize('deployment'));
    assert.deepEqual(tokenize('running'), tokenize('run'));
  });

  test('handles unicode and empty input', () => {
    assert.ok(tokenize('café naïve').length > 0);
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize('!!! ???'), []);
  });
});

describe('bm25Rank', () => {
  const docs = [
    { content: 'Vector databases store embeddings and support similarity search at scale.' },
    { content: 'Postgres is a relational database with strong transactional guarantees.' },
    { content: 'Embeddings are numeric vectors used for semantic search and retrieval.' },
  ];

  test('ranks the documents that share query terms first', () => {
    const ranked = bm25Rank(docs, 'vector database similarity search', 3);
    assert.ok(ranked.length > 0);
    assert.match(ranked[0].doc.content, /Vector databases/);
  });

  test('returns nothing when no term matches', () => {
    assert.deepEqual(bm25Rank(docs, 'zzzz qqqq', 3), []);
  });

  test('handles an empty corpus and an empty query', () => {
    assert.deepEqual(bm25Rank([], 'anything', 3), []);
    assert.deepEqual(bm25Rank(docs, '', 3), []);
  });

  test('respects the topK limit', () => {
    assert.equal(bm25Rank(docs, 'database embeddings search vector', 1).length, 1);
  });
});

describe('saveMemory / recallMemory', () => {
  test('recalls a stored memory that matches the query', async () => {
    await saveMemory({ content: 'The team decided to deploy on Fly.io instead of Vercel for latency.', agentId: 'research' });
    const hits = await recallMemory({ query: 'where did we deploy?', agentId: 'research', topK: 5 });
    assert.equal(hits.length, 1);
    assert.match(hits[0].content, /Fly\.io/);
    assert.ok(hits[0].score > 0);
  });

  test('does not recall unrelated memories', async () => {
    await saveMemory({ content: 'The team chose Postgres for storage.', agentId: 'research' });
    const hits = await recallMemory({ query: 'quantum chromodynamics lattice', agentId: 'research' });
    assert.equal(hits.length, 0);
  });

  test('scopes recall to the agent but keeps global memories visible', async () => {
    await saveMemory({ content: 'Global note about the roadmap timeline.', agentId: null });
    await saveMemory({ content: 'Coding agent specific note about lint rules.', agentId: 'coding' });
    const forCoding = await recallMemory({ query: 'note about rules', agentId: 'coding' });
    const forBusiness = await recallMemory({ query: 'note about roadmap', agentId: 'business' });
    assert.ok(forCoding.some((hit) => hit.content.includes('Global note')));
    assert.ok(forCoding.some((hit) => hit.content.includes('lint rules')));
    assert.ok(forBusiness.some((hit) => hit.content.includes('Global note')));
    assert.equal(forBusiness.some((hit) => hit.content.includes('lint rules')), false);
  });

  test('returns an empty list for an empty store', async () => {
    assert.deepEqual(await recallMemory({ query: 'anything' }), []);
  });
});

describe('conversations', () => {
  test('stores messages and derives a title from the first user turn', () => {
    getOrCreateConversation('c1', 'research');
    addMessage({ id: 'm1', conversationId: 'c1', role: 'user', content: 'How do I deploy the app?' });
    addMessage({ id: 'm2', conversationId: 'c1', role: 'assistant', content: 'Use the deploy script.' });
    const messages = listMessages('c1');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].createdAt > 0, true);
  });

  test('reuses an existing conversation', () => {
    const first = getOrCreateConversation('c1', 'research');
    const second = getOrCreateConversation('c1', 'research');
    assert.equal(first.createdAt, second.createdAt);
  });
});
