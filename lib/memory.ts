/**
 * Nexus AI — Memory Layer
 *
 * Long-term memory with lexical (BM25) retrieval. Retrieval is computed in
 * process, so recall works on the first request, costs nothing, and needs no
 * embedding provider.
 *
 * Storage is per-instance. For durable memory across serverless cold starts,
 * point `DATABASE_URL` at libSQL and move this map into a table — the retrieval
 * helpers here are already pure functions over a `MemoryChunk[]` array.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

interface Conversation {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryChunk {
  id: string;
  agentId: string | null;
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export type MemoryHit = {
  id: string;
  content: string;
  source: string;
  score: number;
  createdAt: number;
  metadata: Record<string, unknown>;
};

const MAX_MEMORY_CHUNKS = 500;
const MAX_CHAT_MESSAGES_PER_CONVERSATION = 200;
const MAX_CONVERSATIONS = 100;

const g = globalThis as typeof globalThis & {
  __nexus_store?: {
    conversations: Map<string, Conversation>;
    messages: Map<string, Message[]>;
    memoryChunks: MemoryChunk[];
  };
};

if (!g.__nexus_store) {
  g.__nexus_store = {
    conversations: new Map<string, Conversation>(),
    messages: new Map<string, Message[]>(),
    memoryChunks: [],
  };
}
const store = g.__nexus_store;

// ===== Conversations =====

export function listConversations(agentId?: string): Conversation[] {
  const all = Array.from(store.conversations.values());
  return (agentId ? all.filter((c) => c.agentId === agentId) : all)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);
}

export function getOrCreateConversation(id: string, agentId: string, title = 'New chat'): Conversation {
  const existing = store.conversations.get(id);
  if (existing) return existing;
  const now = Date.now();
  const conversation: Conversation = { id, agentId, title, createdAt: now, updatedAt: now };
  store.conversations.set(id, conversation);
  store.messages.set(id, []);
  evictOldConversations();
  return conversation;
}

function evictOldConversations() {
  if (store.conversations.size <= MAX_CONVERSATIONS) return;
  const ordered = Array.from(store.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const conversation of ordered.slice(MAX_CONVERSATIONS)) {
    store.conversations.delete(conversation.id);
    store.messages.delete(conversation.id);
  }
}

export function listMessages(conversationId: string): Message[] {
  return store.messages.get(conversationId) || [];
}

export function addMessage(msg: Omit<Message, 'createdAt'> & { createdAt?: number }) {
  const now = msg.createdAt ?? Date.now();
  const full: Message = { ...msg, createdAt: now };
  const existing = store.messages.get(msg.conversationId);
  if (existing) {
    existing.push(full);
    // Keep history bounded so a long conversation cannot grow without limit.
    if (existing.length > MAX_CHAT_MESSAGES_PER_CONVERSATION) {
      existing.splice(0, existing.length - MAX_CHAT_MESSAGES_PER_CONVERSATION);
    }
  } else {
    store.messages.set(msg.conversationId, [full]);
  }
  const conversation = store.conversations.get(msg.conversationId);
  if (conversation) {
    conversation.updatedAt = now;
    if (conversation.title === 'New chat' && msg.role === 'user') {
      conversation.title = msg.content.replace(/\s+/g, ' ').slice(0, 54) || 'New conversation';
    }
  }
}

// ===== Tokenization =====

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'did', 'do', 'does', 'for', 'from', 'had',
  'has', 'have', 'he', 'her', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of',
  'on', 'or', 'our', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'to', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'you', 'your',
]);

/** Lowercase, strip punctuation, drop stop words. Supports basic word stems. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [];
  const out: string[] = [];
  for (const word of words) {
    if (word.length < 2) continue;
    if (STOP_WORDS.has(word)) continue;
    out.push(word.length > 4 ? stem(word) : word);
  }
  return out;
}

/** A deliberately small suffix stemmer. Enough to unify plurals and gerunds. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ing')) return undouble(word.slice(0, -3));
  if (word.length > 4 && word.endsWith('ed')) return undouble(word.slice(0, -2));
  // "-es" is only a plural when a sibilant precedes it (boxes, matches). In
  // "rules" the "s" is the plural and the "e" belongs to the stem, so
  // stripping both would yield "rul" and never match a query spelling "rule".
  if (word.length > 3 && word.endsWith('es') && SIBILANTS.has(word[word.length - 3])) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const SIBILANTS = new Set(['s', 'x', 'z', 'c', 'g', 'j', 'k', 'q', 'v', 'w', 'y']);

/**
 * Collapse the consonant doubling that survives suffix stripping, so that
 * "running" and "run" agree. Words like "running" stem to "runn" otherwise,
 * which breaks recall whenever a query and a memory spell the same word
 * differently. Only applied when the last two letters match and are not the
 * stem's own final pair of vowels or a doubled "l"/"s" that a real word keeps.
 */
function undouble(stemmed: string): string {
  if (stemmed.length < 3) return stemmed;
  const tail = stemmed.slice(-2);
  if (tail[0] !== tail[1]) return stemmed;
  // "ll" and "ss" are part of the root, not a gerund artefact: "falling" -> "fall".
  if (tail === 'll' || tail === 'ss') return stemmed;
  return stemmed.slice(0, -1);
}

// ===== BM25 =====

const BM25_K1 = 1.5;
const BM25_B = 0.75;

interface DocStats<T> {
  doc: T;
  length: number;
  frequencies: Map<string, number>;
}

/**
 * Rank chunks against a query with Okapi BM25.
 *
 * Raw BM25 scores are not comparable across corpora: with a single candidate
 * document the IDF term is tiny, so the highest score reachable is far below
 * what the same query yields against a large store. Callers that need a stable
 * "how relevant is this" number should divide `score` by `maxScore`, which is
 * the score a document matching every query term would earn.
 *
 * Exported for tests and for reuse by any other in-process index.
 */
export function bm25Rank<T extends { content: string }>(docs: T[], query: string, topK: number): Array<{ doc: T; score: number; maxScore: number }> {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (!queryTerms.length || !docs.length) return [];

  const stats: Array<DocStats<T>> = docs.map((doc) => {
    const terms = tokenize(doc.content);
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    return { doc, length: terms.length, frequencies };
  });

  const totalLength = stats.reduce((sum, entry) => sum + entry.length, 0);
  const averageLength = stats.length ? totalLength / stats.length : 0;
  if (averageLength === 0) return [];

  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const entry of stats) if (entry.frequencies.has(term)) count += 1;
    documentFrequency.set(term, count);
  }

  // A document holding every query term, at average length, with each term
  // appearing once. This is the ceiling the raw scores are measured against.
  const maxScore = queryTerms.reduce((sum, term) => {
    const df = documentFrequency.get(term) || 0;
    const idf = Math.log(1 + (stats.length - df + 0.5) / (df + 0.5));
    return sum + idf * (BM25_K1 + 1);
  }, 0);

  return stats
    .map((entry) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = entry.frequencies.get(term) || 0;
        if (!frequency) continue;
        const df = documentFrequency.get(term) || 0;
        // +0.5 smoothing keeps the IDF positive for terms in every document.
        const idf = Math.log(1 + (stats.length - df + 0.5) / (df + 0.5));
        const norm = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (entry.length / averageLength));
        score += idf * ((frequency * (BM25_K1 + 1)) / norm);
      }
      return { doc: entry.doc, score, maxScore };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ===== Memory =====

export async function saveMemory(opts: {
  content: string;
  /** `null` or omitted stores a global memory that every agent can recall. */
  agentId?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const id = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  store.memoryChunks.push({
    id,
    agentId: opts.agentId || null,
    source: opts.source || 'chat',
    content: opts.content,
    metadata: opts.metadata || {},
    createdAt: Date.now(),
  });
  if (store.memoryChunks.length > MAX_MEMORY_CHUNKS) {
    store.memoryChunks = store.memoryChunks.slice(-MAX_MEMORY_CHUNKS);
  }
  return id;
}

export async function recallMemory(opts: {
  query: string;
  agentId?: string;
  topK?: number;
  /** Threshold on the normalised 0–1 relevance, not the raw BM25 score. */
  minScore?: number;
}): Promise<MemoryHit[]> {
  const topK = Math.max(1, Math.min(opts.topK ?? 5, 20));
  // Null agentId memories are global and visible to every agent.
  const candidates = opts.agentId
    ? store.memoryChunks.filter((chunk) => chunk.agentId === opts.agentId || chunk.agentId === null)
    : store.memoryChunks;
  if (!candidates.length) return [];
  // Low on purpose: it admits a memory that shares even one meaningful term
  // with the query, which is what keeps global notes visible to an agent
  // whose own memories score higher. Unrelated queries score exactly 0 and
  // are already dropped upstream, and topK caps what reaches the prompt.
  const minScore = opts.minScore ?? 0.1;
  return bm25Rank(candidates, opts.query, topK)
    .map((hit) => ({
      id: hit.doc.id,
      content: hit.doc.content,
      source: hit.doc.source,
      // Normalise so the threshold means the same thing regardless of how
      // many memories exist. Without this, a fresh store can never recall.
      score: hit.maxScore > 0 ? Number((hit.score / hit.maxScore).toFixed(3)) : 0,
      createdAt: hit.doc.createdAt,
      metadata: hit.doc.metadata,
    }))
    .filter((hit) => hit.score >= minScore);
}

export function listMemoryChunks(agentId?: string, limit = 20) {
  return store.memoryChunks
    .filter((chunk) => (agentId ? chunk.agentId === agentId : true))
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(limit, 200)))
    .map((chunk) => ({
      id: chunk.id,
      agent_id: chunk.agentId,
      source: chunk.source,
      content: chunk.content,
      metadata: JSON.stringify(chunk.metadata),
      created_at: chunk.createdAt,
    }));
}

export function deleteMemory(id: string): boolean {
  const before = store.memoryChunks.length;
  store.memoryChunks = store.memoryChunks.filter((chunk) => chunk.id !== id);
  return store.memoryChunks.length !== before;
}

/** Test-only: clear all state between cases. */
export function __resetMemoryStore() {
  store.conversations.clear();
  store.messages.clear();
  store.memoryChunks = [];
}
