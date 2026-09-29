import { createClient, type Client, type InValue } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cosineSimilarity, embedTexts, EMBEDDING_MODEL } from './embeddings.ts';

export type StoredDocument = {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  summary: string;
  summaryStatus: 'processing' | 'ready' | 'failed';
  outline: string[];
  createdAt: number;
};

export type DocumentChunk = {
  id: string;
  documentId: string;
  name: string;
  text: string;
  section: string;
  pageNumber: number | null;
  slideNumber: number | null;
  sheetName: string | null;
};

const globalDb = globalThis as typeof globalThis & { __nexusDocumentsDb?: Client; __nexusDocumentsSchema?: Promise<void> };

function getClient() {
  if (globalDb.__nexusDocumentsDb) return globalDb.__nexusDocumentsDb;
  const configuredUrl = process.env.DATABASE_URL;
  const dbPath = process.env.NEXUS_DATABASE_PATH || resolve(process.cwd(), 'data', 'nexus-documents.sqlite');
  if (!configuredUrl) mkdirSync(dirname(dbPath), { recursive: true });
  globalDb.__nexusDocumentsDb = createClient({
    url: configuredUrl || `file:${dbPath}`,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return globalDb.__nexusDocumentsDb;
}

async function ensureSchema() {
  if (!globalDb.__nexusDocumentsSchema) {
    globalDb.__nexusDocumentsSchema = getClient().batch([
      `CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        original_blob BLOB NOT NULL,
        extracted_text TEXT NOT NULL,
        summary TEXT NOT NULL,
        summary_status TEXT NOT NULL DEFAULT 'ready',
        outline_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(workspace_id, sha256)
      )`,
      `CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        section TEXT NOT NULL,
        page_number INTEGER,
        slide_number INTEGER,
        sheet_name TEXT,
        start_index INTEGER,
        end_index INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS documents_workspace_created ON documents(workspace_id, created_at DESC)',
      `CREATE TABLE IF NOT EXISTS document_embeddings (chunk_id TEXT NOT NULL, model TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY(chunk_id, model))`,
      'CREATE INDEX IF NOT EXISTS document_chunks_workspace_document ON document_chunks(workspace_id, document_id, chunk_index)',
    ], 'write').then(async () => {
      try {
        await getClient().execute('ALTER TABLE documents ADD COLUMN summary_status TEXT NOT NULL DEFAULT \'ready\'');
      } catch (error) {
        if (!String(error).toLowerCase().includes('duplicate column')) throw error;
      }
    });
  }
  await globalDb.__nexusDocumentsSchema;
}

function asDocument(row: Record<string, unknown>): StoredDocument {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    summary: String(row.summary || ''),
    summaryStatus: row.summary_status === 'processing' || row.summary_status === 'failed' ? row.summary_status : 'ready',
    outline: JSON.parse(String(row.outline_json || '[]')) as string[],
    createdAt: Number(row.created_at),
  };
}

export async function listDocuments(workspaceId: string): Promise<StoredDocument[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: 'SELECT id, workspace_id, name, mime_type, size_bytes, summary, summary_status, outline_json, created_at FROM documents WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100',
    args: [workspaceId],
  });
  return result.rows.map((row) => asDocument(row as Record<string, unknown>));
}

export async function saveDocument(input: {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  originalBlob: Uint8Array;
  extractedText: string;
  summary: string;
  outline: string[];
  chunks: Array<Omit<DocumentChunk, 'id' | 'documentId' | 'name'> & { startIndex?: number; endIndex?: number }>;
  createdAt: number;
}) {
  await ensureSchema();
  const db = getClient();
  const existing = await db.execute({
    sql: 'SELECT id FROM documents WHERE workspace_id = ? AND sha256 = ?',
    args: [input.workspaceId, input.sha256],
  });
  if (existing.rows[0]) return String(existing.rows[0].id);

  const statements: Array<{ sql: string; args: InValue[] }> = [{
    sql: 'INSERT INTO documents (id, workspace_id, name, mime_type, size_bytes, sha256, original_blob, extracted_text, summary, summary_status, outline_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [input.id, input.workspaceId, input.name, input.mimeType, input.sizeBytes, input.sha256, input.originalBlob, input.extractedText, input.summary, 'processing', JSON.stringify(input.outline), input.createdAt],
  }];
  input.chunks.forEach((chunk, index) => {
    statements.push({
      sql: 'INSERT INTO document_chunks (id, document_id, workspace_id, chunk_index, text, section, page_number, slide_number, sheet_name, start_index, end_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [crypto.randomUUID(), input.id, input.workspaceId, index, chunk.text, chunk.section, chunk.pageNumber, chunk.slideNumber, chunk.sheetName, chunk.startIndex ?? null, chunk.endIndex ?? null],
    });
  });
  await db.batch(statements, 'write');
  return input.id;
}

export async function getDocument(workspaceId: string, documentId: string): Promise<StoredDocument | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: 'SELECT id, workspace_id, name, mime_type, size_bytes, summary, summary_status, outline_json, created_at FROM documents WHERE workspace_id = ? AND id = ?',
    args: [workspaceId, documentId],
  });
  return result.rows[0] ? asDocument(result.rows[0] as Record<string, unknown>) : null;
}

export async function updateDocumentSummary(workspaceId: string, documentId: string, summary: string, status: 'ready' | 'failed') {
  await ensureSchema();
  await getClient().execute({
    sql: 'UPDATE documents SET summary = ?, summary_status = ? WHERE workspace_id = ? AND id = ?',
    args: [summary, status, workspaceId, documentId],
  });
}

export async function deleteDocument(workspaceId: string, documentId: string) {
  await ensureSchema();
  const db = getClient();
  const existing = await db.execute({ sql: 'SELECT id FROM documents WHERE workspace_id = ? AND id = ?', args: [workspaceId, documentId] });
  if (!existing.rows.length) return false;
  await db.batch([
    { sql: 'DELETE FROM document_embeddings WHERE chunk_id IN (SELECT id FROM document_chunks WHERE workspace_id = ? AND document_id = ?)', args: [workspaceId, documentId] },
    { sql: 'DELETE FROM document_chunks WHERE workspace_id = ? AND document_id = ?', args: [workspaceId, documentId] },
    { sql: 'DELETE FROM documents WHERE workspace_id = ? AND id = ?', args: [workspaceId, documentId] },
  ], 'write');
  return true;
}

const pendingIndexes = new Map<string, Promise<void>>();
export async function indexDocumentEmbeddings(workspaceId: string, documentIds: string[]) {
  if (!process.env.NVIDIA_API_KEY || process.env.NEXUS_DISABLE_EMBEDDINGS === 'true' || !documentIds.length) return;
  const key = `${workspaceId}:${[...documentIds].sort().join(',')}`;
  if (pendingIndexes.has(key)) return pendingIndexes.get(key);
  const work = (async () => {
    await ensureSchema();
    const rows = await getClient().execute({
      sql: `SELECT c.id,c.text FROM document_chunks c LEFT JOIN document_embeddings e ON e.chunk_id=c.id AND e.model=? WHERE c.workspace_id=? AND c.document_id IN (${documentIds.map(() => '?').join(',')}) AND e.chunk_id IS NULL ORDER BY c.chunk_index`,
      args: [EMBEDDING_MODEL, workspaceId, ...documentIds],
    });
    for (let offset = 0; offset < rows.rows.length; offset += 32) {
      const batch = rows.rows.slice(offset, offset + 32);
      const vectors = await embedTexts(batch.map((row) => String(row.text)), 'passage');
      await getClient().batch(batch.map((row, i) => ({
        sql: 'INSERT OR REPLACE INTO document_embeddings (chunk_id,model,vector) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM document_chunks WHERE id=?)',
        args: [String(row.id), EMBEDDING_MODEL, new Uint8Array(new Float32Array(vectors[i]).buffer), String(row.id)],
      })), 'write');
    }
  })();
  pendingIndexes.set(key, work);
  try { await work; } finally { pendingIndexes.delete(key); }
}

export async function searchDocumentChunks(workspaceId: string, documentIds: string[], query: string, limit = 8): Promise<DocumentChunk[]> {
  if (!documentIds.length) return [];
  await ensureSchema();
  const ids = documentIds.slice(0, 20);
  const placeholders = ids.map(() => '?').join(',');
  const result = await getClient().execute({
    sql: `SELECT c.id, c.document_id, d.name, c.text, c.section, c.page_number, c.slide_number, c.sheet_name FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE c.workspace_id = ? AND d.workspace_id = ? AND c.document_id IN (${placeholders}) ORDER BY c.document_id, c.chunk_index ASC`,
    args: [workspaceId, workspaceId, ...ids],
  });
  const queryTerms = Array.from(new Set((query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((term) => !STOP_WORDS.has(term))));
  const chunks = result.rows.map((row) => ({
    id: String(row.id), documentId: String(row.document_id), name: String(row.name), text: String(row.text),
    section: String(row.section), pageNumber: row.page_number == null ? null : Number(row.page_number),
    slideNumber: row.slide_number == null ? null : Number(row.slide_number), sheetName: row.sheet_name == null ? null : String(row.sheet_name),
  }));
  const overviewRequest = /\b(summary|summarize|summarise|overview|briefly|highlights|entire|whole)\b/i.test(query)
    || /^(in brief|shorter|more detail|expand|why)[?.!\s]*$/i.test(query.trim())
    || /\bexplain\b.{0,40}\b(file|document|pdf|each|every)\b/i.test(query);
  if (overviewRequest && chunks.length > 0) {
    const count = Math.min(limit, chunks.length);
    if (count === 1) return [chunks[0]];
    // Sample across the whole file so a broad request does not over-focus on
    // the first keyword match or a single page/section.
    return Array.from({ length: count }, (_, index) => chunks[Math.round(index * (chunks.length - 1) / (count - 1))]);
  }
  // Short follow-ups such as "why?" and broad requests such as "summarize this"
  // often contain no indexable terms. Pass a small, deterministic window from
  // the selected file so the model can answer from evidence or abstain.
  if (!queryTerms.length) return chunks.slice(0, limit);
  const documentFrequency = new Map<string, number>();
  chunks.forEach((chunk) => {
    const terms = new Set(chunk.text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
    queryTerms.forEach((term) => { if (terms.has(term)) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1); });
  });
  const lexical = chunks.map((chunk) => {
    const terms = chunk.text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
    const counts = new Map<string, number>();
    terms.forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
    const score = queryTerms.reduce((sum, term) => {
      const frequency = counts.get(term) || 0;
      if (!frequency) return sum;
      const idf = Math.log(1 + chunks.length / (1 + (documentFrequency.get(term) || 0)));
      return sum + idf * (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * terms.length / 350));
    }, 0);
    const phraseBoost = query.trim().length > 4 && chunk.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ? 4 : 0;
    return { chunk, score: score + phraseBoost };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const fused = new Map(lexical.map((item, rank) => [item.chunk.id, { chunk: item.chunk, score: 1 / (20 + rank) }]));
  if (process.env.NVIDIA_API_KEY && process.env.NEXUS_DISABLE_EMBEDDINGS !== 'true') {
    try {
      // Never block a question behind indexing an entire large upload.
      const indexing = indexDocumentEmbeddings(workspaceId, ids).catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([indexing, new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000); })]);
      if (timer) clearTimeout(timer);
      const [questionVector] = await embedTexts([query], 'query');
      const vectors = await getClient().execute({
        sql: `SELECT e.chunk_id,e.vector FROM document_embeddings e JOIN document_chunks c ON c.id=e.chunk_id WHERE e.model=? AND c.workspace_id=? AND c.document_id IN (${placeholders})`,
        args: [EMBEDDING_MODEL, workspaceId, ...ids],
      });
      const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
      const semantic = vectors.rows.map((row) => {
        const bytes = new Uint8Array(row.vector as ArrayBuffer);
        const vector = Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
        return { chunk: byId.get(String(row.chunk_id))!, score: cosineSimilarity(questionVector, vector) };
      }).filter((item) => item.chunk && item.score >= 0.2).sort((a, b) => b.score - a.score);
      semantic.slice(0, limit * 2).forEach((item, rank) => {
        const old = fused.get(item.chunk.id);
        fused.set(item.chunk.id, { chunk: item.chunk, score: (old?.score || 0) + 1 / (20 + rank) });
      });
    } catch {
      // Keyword retrieval remains available during an embedding-service outage.
    }
  }
  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(({ chunk }) => {
    if (chunk.text.length >= 180) return chunk;
    // Restore surrounding labels/values for files indexed by an older cell-based parser.
    const index = chunks.findIndex((candidate) => candidate.id === chunk.id);
    const neighbors = chunks.slice(Math.max(0, index - 3), index + 4).filter((candidate) =>
      candidate.documentId === chunk.documentId && candidate.pageNumber === chunk.pageNumber
      && candidate.slideNumber === chunk.slideNumber && candidate.sheetName === chunk.sheetName);
    return { ...chunk, text: neighbors.map((candidate) => candidate.text).join('\n') };
  });
}

const STOP_WORDS = new Set(['is', 'it', 'its', 'to', 'of', 'in', 'as', 'an', 'on', 'be', 'by', 'at', 'do', 'me', 'tell', 'please', 'the', 'and', 'for', 'are', 'was', 'were', 'with', 'that', 'this', 'from', 'into', 'what', 'when', 'where', 'which', 'who', 'how', 'why', 'can', 'could', 'should', 'would', 'does', 'did', 'have', 'has', 'had', 'you', 'your', 'they', 'them', 'their', 'there', 'then', 'than', 'but', 'not', 'all', 'any', 'our', 'out', 'about']);
