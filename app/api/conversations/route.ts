import { NextRequest } from 'next/server';
import { listConversations, listMessages } from '@/lib/memory';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') || undefined;
  const conversationId = searchParams.get('conversationId');

  if (conversationId) {
    const msgs = listMessages(conversationId);
    return Response.json({ messages: msgs });
  }
  return Response.json({ conversations: listConversations(agentId) });
}
