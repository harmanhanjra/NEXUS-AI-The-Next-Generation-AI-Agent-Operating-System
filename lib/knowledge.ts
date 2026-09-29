import { BaseEmbedding, Document, MetadataMode, Settings, VectorStoreIndex } from 'llamaindex';
import { SimpleVectorStore } from 'llamaindex/vector-store';
import { ModalityType } from '@llamaindex/core/schema';
import type { AgentConfig } from './agents.ts';
import { tokenize } from './memory.ts';

class LocalHashEmbedding extends BaseEmbedding {
  constructor() {
    super(async (nodes) => nodes);
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    const values = new Array(256).fill(0);
    for (const word of tokenize(text)) {
      let hash = 2166136261;
      for (let index = 0; index < word.length; index += 1) hash = Math.imul(hash ^ word.charCodeAt(index), 16777619);
      values[(hash >>> 0) % values.length] += 1;
    }
    const magnitude = Math.sqrt(values.reduce((total, value) => total + value * value, 0)) || 1;
    return values.map((value) => value / magnitude);
  }
}

/**
 * The agent-definition index only depends on *which* agents are in the room,
 * not on the request text — so it is cached per agent-set. Room runs call
 * this once per request; without the cache every run paid a full index build.
 */
const indexCache = new Map<string, Promise<VectorStoreIndex>>();
const MAX_CACHED_INDEXES = 24;

function indexKeyFor(agents: AgentConfig[]): string {
  return agents
    .map((agent) => `${agent.id}:${agent.role || ''}:${(agent.responsibilities || []).join(',')}:${agent.systemPrompt.length}:${hashText(agent.systemPrompt)}`)
    .sort()
    .join('|');
}

function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return hash;
}

async function getOrBuildIndex(agents: AgentConfig[], embedding: LocalHashEmbedding): Promise<VectorStoreIndex> {
  const key = indexKeyFor(agents);
  const cached = indexCache.get(key);
  if (cached) return cached;
  const building = (async () => {
    const documents = await Promise.all(agents.map(async (agent) => {
      const text = `${agent.name}\nRole: ${agent.role || 'Specialist'}\nResponsibilities: ${(agent.responsibilities || []).join('; ')}\nInstructions: ${agent.systemPrompt}`;
      return new Document({ text, embedding: await embedding.getTextEmbedding(text), metadata: { agentId: agent.id, agentName: agent.name } });
    }));
    Settings.embedModel = embedding;
    const vectorStore = new SimpleVectorStore({ embedModel: embedding });
    return VectorStoreIndex.fromDocuments(documents, { vectorStores: { [ModalityType.TEXT]: vectorStore } });
  })();
  // Bound the cache: evict the oldest entry when full.
  if (indexCache.size >= MAX_CACHED_INDEXES) {
    const oldest = indexCache.keys().next();
    if (!oldest.done) indexCache.delete(oldest.value);
  }
  indexCache.set(key, building);
  try {
    return await building;
  } catch {
    // Never cache a failed build — the next request retries fresh.
    if (indexCache.get(key) === building) indexCache.delete(key);
    throw new Error('Knowledge index build failed.');
  }
}

export async function getKnowledgeContext(message: string, agents: AgentConfig[]): Promise<string> {
  if (!message.trim() || agents.length === 0) return '';
  const embedding = new LocalHashEmbedding();
  const index = await getOrBuildIndex(agents, embedding);
  const nodes = await index.asRetriever({ similarityTopK: Math.min(3, agents.length) }).retrieve(message);
  const context = nodes
    .map((node) => node.node.getContent(MetadataMode.ALL))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 6000);
  return context ? `\n\n<team_knowledge>\n${context}\n</team_knowledge>` : '';
}
