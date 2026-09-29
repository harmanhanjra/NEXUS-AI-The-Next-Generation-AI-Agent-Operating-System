/**
 * Nexus AI — Conversations Endpoint
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import { NextRequest } from 'next/server';
import { listConversations, listMessages } from '@/lib/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') || undefined;
  const conversationId = searchParams.get('conversationId');

  if (conversationId) {
    if (!CONVERSATION_ID.test(conversationId)) {
      return Response.json({ error: 'Invalid conversationId' }, { status: 400 });
    }
    return Response.json({ messages: listMessages(conversationId) });
  }
  return Response.json({ conversations: listConversations(agentId) });
}
