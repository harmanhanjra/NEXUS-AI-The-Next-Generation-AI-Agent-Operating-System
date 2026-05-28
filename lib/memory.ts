/**
 * Nexus AI — Memory Layer
 * In-memory store with Gemini embeddings for semantic recall.
 * Serverless-safe; for persistence, swap for Vercel Postgres or Upstash.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

// On Vercel, each function instance has its own memory and resets when cold.
// For persistent memory, swap this layer for Vercel Postgres or Upstash Redis.
import { GoogleGenAI } from '@google/genai';

// ===== Types =====
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

interface MemoryChunk {
  id: string;
  agentId: string | null;
  source: string;
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
  createdAt: number;
}

// ===== In-memory stores (per function instance) =====
// Note: globalThis ensures the same store is reused across hot reloads in dev
// and across requests in the same warm serverless instance.
const g = globalThis as any;
if (!g.__nexus_store) {
  g.__nexus_store = {
    conversations: new Map<string, Conversation>(),
    messages: new Map<string, Message[]>(),     // conversationId → messages
    memoryChunks: [] as MemoryChunk[],
  };
}
const store = g.__nexus_store as {
  conversations: Map<string, Conversation>;
  messages: Map<string, Message[]>;
  memoryChunks: MemoryChunk[];
};

// ===== Conversations =====
export function listConversations(agentId?: string) {
  const all = Array.from(store.conversations.values());
  const filtered = agentId ? all.filter(c => c.agentId === agentId) : all;
  return filtered.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
}

export function getOrCreateConversation(id: string, agentId: string, title = 'New chat'): Conversation {
  const existing = store.conversations.get(id);
  if (existing) return existing;
  const now = Date.now();
  const convo: Conversation = { id, agentId, title, createdAt: now, updatedAt: now };
  store.conversations.set(id, convo);
  store.messages.set(id, []);
  return convo;
}

export function listMessages(conversationId: string): Message[] {
  return store.messages.get(conversationId) || [];
}

export function addMessage(msg: Omit<Message, 'createdAt'> & { createdAt?: number }) {
  const now = msg.createdAt ?? Date.now();
  const full: Message = { ...msg, createdAt: now };
  const arr = store.messages.get(msg.conversationId) || [];
  arr.push(full);
  store.messages.set(msg.conversationId, arr);
  const c = store.conversations.get(msg.conversationId);
  if (c) c.updatedAt = now;
}

// ===== Memory =====
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function embed(client: GoogleGenAI, text: string): Promise<number[]> {
  const res = await client.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
  });
  return res.embeddings?.[0]?.values || [];
}

export async function saveMemory(opts: {
  apiKey: string;
  content: string;
  agentId?: string;
  source?: string;
  metadata?: Record<string, any>;
}): Promise<string> {
  const client = new GoogleGenAI({ apiKey: opts.apiKey });
  const vec = await embed(client, opts.content);
  const id = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  store.memoryChunks.push({
    id,
    agentId: opts.agentId || null,
    source: opts.source || 'chat',
    content: opts.content,
    embedding: vec,
    metadata: opts.metadata || {},
    createdAt: Date.now(),
  });
  // Cap at 500 chunks to keep memory bounded on serverless
  if (store.memoryChunks.length > 500) {
    store.memoryChunks = store.memoryChunks.slice(-500);
  }
  return id;
}

export async function recallMemory(opts: {
  apiKey: string;
  query: string;
  agentId?: string;
  topK?: number;
}): Promise<{ content: string; score: number; createdAt: number; source: string }[]> {
  const topK = opts.topK ?? 5;
  const candidates = opts.agentId
    ? store.memoryChunks.filter(c => c.agentId === opts.agentId || c.agentId === null)
    : store.memoryChunks;
  if (candidates.length === 0) return [];

  const client = new GoogleGenAI({ apiKey: opts.apiKey });
  const queryVec = await embed(client, opts.query);

  return candidates
    .map(c => ({
      content: c.content,
      source: c.source,
      createdAt: c.createdAt,
      score: cosineSimilarity(queryVec, c.embedding),
    }))
    .filter(s => s.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function listMemoryChunks(agentId?: string, limit = 20) {
  const filtered = agentId
    ? store.memoryChunks.filter(c => c.agentId === agentId)
    : store.memoryChunks;
  return filtered
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(c => ({
      id: c.id,
      agent_id: c.agentId,
      source: c.source,
      content: c.content,
      metadata: JSON.stringify(c.metadata),
      created_at: c.createdAt,
    }));
}

export function deleteMemory(id: string) {
  store.memoryChunks = store.memoryChunks.filter(c => c.id !== id);
}
