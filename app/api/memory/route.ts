/**
 * Nexus AI — Memory Endpoint
 *
 * Recall is computed locally with BM25, so saving and reading a memory needs no
 * API key and no embedding provider.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import { NextRequest } from 'next/server';
import { deleteMemory, listMemoryChunks, recallMemory, saveMemory } from '@/lib/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT_LENGTH = 4_000;
const MAX_QUERY_LENGTH = 2_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') || undefined;
  const query = searchParams.get('q');

  if (query) {
    if (query.length > MAX_QUERY_LENGTH) return Response.json({ error: 'Query is too long' }, { status: 400 });
    return Response.json({ memories: await recallMemory({ query, agentId, topK: 10 }) });
  }
  return Response.json({ memories: listMemoryChunks(agentId, 30) });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const value = body as { content?: unknown; agentId?: unknown; source?: unknown; metadata?: unknown };
  if (typeof value.content !== 'string' || !value.content.trim() || value.content.length > MAX_CONTENT_LENGTH) {
    return Response.json({ error: `content must be 1-${MAX_CONTENT_LENGTH} characters` }, { status: 400 });
  }
  const agentId = typeof value.agentId === 'string' && value.agentId ? value.agentId.slice(0, 64) : undefined;
  const source = typeof value.source === 'string' && value.source ? value.source.slice(0, 40) : 'manual';
  const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
    ? (value.metadata as Record<string, unknown>)
    : undefined;

  const id = await saveMemory({ content: value.content, agentId, source, metadata });
  return Response.json({ id }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  return deleteMemory(id)
    ? Response.json({ ok: true })
    : Response.json({ error: 'Memory not found' }, { status: 404 });
}
