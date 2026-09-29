import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { saveDocument, searchDocumentChunks, deleteDocument } from '../lib/document-store.ts';

test('file retrieval abstains on unrelated questions and keeps broad follow-ups', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'file::memory:';
  // Isolate keyword-only assertions from any real NVIDIA key in the environment.
  // Otherwise earlier searches trigger real embedding indexing, and the mocked
  // semantic check below compares a fixture query vector against real vectors.
  const previousApiKey = process.env.NVIDIA_API_KEY;
  const previousDisableEmbeddings = process.env.NEXUS_DISABLE_EMBEDDINGS;
  delete process.env.NVIDIA_API_KEY;
  process.env.NEXUS_DISABLE_EMBEDDINGS = 'true';
  const workspaceId = randomUUID();
  const id = randomUUID();
  const text = 'The Nimbus launch code is ORCHID-731. The budget is 4200 credits.';
  try {
    await saveDocument({ id, workspaceId, name: 'qa.md', mimeType: 'text/markdown', sizeBytes: text.length,
      sha256: randomUUID(), originalBlob: new TextEncoder().encode(text), extractedText: text,
      summary: text, outline: ['Nimbus'], createdAt: Date.now(),
      chunks: [{ text, section: 'Nimbus', pageNumber: null, slideNumber: null, sheetName: null }] });
    assert.equal((await searchDocumentChunks(workspaceId, [id], 'Nimbus launch code')).length, 1);
    assert.deepEqual(await searchDocumentChunks(workspaceId, [id], 'quantum zebra password'), []);
    assert.equal((await searchDocumentChunks(workspaceId, [id], 'in brief')).length, 1);
    assert.deepEqual(await searchDocumentChunks(randomUUID(), [id], 'Nimbus launch code'), []);
    const originalFetch = globalThis.fetch;
    process.env.NVIDIA_API_KEY = 'fixture';
    delete process.env.NEXUS_DISABLE_EMBEDDINGS;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({ data: body.input.map((_: string, index: number) => ({ index, embedding: [1, 0, 0] })) });
    };
    try {
      assert.equal((await searchDocumentChunks(workspaceId, [id], 'cost')).length, 1, 'semantic retrieval finds a synonym without keyword overlap');
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(await deleteDocument(workspaceId, id), true);
  } finally {
    const globals = globalThis as typeof globalThis & { __nexusDocumentsDb?: { close: () => void }; __nexusDocumentsSchema?: Promise<void> };
    globals.__nexusDocumentsDb?.close();
    delete globals.__nexusDocumentsDb; delete globals.__nexusDocumentsSchema;
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    if (previousApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousApiKey;
    if (previousDisableEmbeddings === undefined) delete process.env.NEXUS_DISABLE_EMBEDDINGS;
    else process.env.NEXUS_DISABLE_EMBEDDINGS = previousDisableEmbeddings;
  }
});
