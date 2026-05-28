import { NextRequest } from 'next/server';
import { listMemoryChunks, saveMemory, deleteMemory } from '@/lib/memory';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') || undefined;
  return Response.json({ memories: listMemoryChunks(agentId, 30) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const apiKey = body.apiKey || process.env.GEMINI_API_KEY || '';
  if (!apiKey) return Response.json({ error: 'No API key' }, { status: 400 });
  const id = await saveMemory({
    apiKey,
    content: body.content,
    agentId: body.agentId,
    source: body.source || 'manual',
    metadata: body.metadata,
  });
  return Response.json({ id });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  deleteMemory(id);
  return Response.json({ ok: true });
}
