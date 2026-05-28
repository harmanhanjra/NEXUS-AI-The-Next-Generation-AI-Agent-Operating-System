/**
 * Nexus AI — Chat SSE Endpoint
 * Streams real-time Gemini responses with tool orchestration.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import { NextRequest } from 'next/server';
import { streamAgentResponse, ChatTurn } from '@/lib/llm';
import { getAgent } from '@/lib/agents';
import {
  getOrCreateConversation,
  addMessage,
  listMessages,
  saveMemory,
} from '@/lib/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    agentId = 'research',
    conversationId,
    message,
    apiKey: clientKey,
  } = body as {
    agentId?: string;
    conversationId: string;
    message: string;
    apiKey?: string;
  };

  // Resolve API key: client (UI override) > server (.env)
  const apiKey = clientKey || process.env.GEMINI_API_KEY || '';
  const agent = getAgent(agentId);

  // Persist user message
  getOrCreateConversation(conversationId, agentId);
  const userMsgId = crypto.randomUUID();
  addMessage({
    id: userMsgId,
    conversationId,
    role: 'user',
    content: message,
  });

  // Load conversation history (excluding the one we just added — we pass it via userMessage)
  const allMsgs = listMessages(conversationId);
  const history: ChatTurn[] = allMsgs
    .filter(m => m.id !== userMsgId)
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      text: m.content,
    }));

  // Build SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        let fullResponse = '';
        for await (const ev of streamAgentResponse({
          apiKey,
          agent,
          history,
          userMessage: message,
        })) {
          send(ev.type, ev.data);
          if (ev.type === 'token') fullResponse += ev.data;
          if (ev.type === 'done') fullResponse = ev.data.text;
        }

        // Persist assistant response
        if (fullResponse) {
          addMessage({
            id: crypto.randomUUID(),
            conversationId,
            role: 'assistant',
            content: fullResponse,
          });

          // Asynchronously save to long-term memory if it's a meaningful exchange
          if (message.length > 20 && fullResponse.length > 50) {
            const memoryContent = `User asked: ${message}\nAssistant said: ${fullResponse.slice(0, 500)}`;
            saveMemory({
              apiKey,
              content: memoryContent,
              agentId,
              source: 'chat',
              metadata: { conversationId },
            }).catch(() => {/* non-blocking */});
          }
        }
      } catch (err: any) {
        send('error', err?.message || 'Stream error');
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
