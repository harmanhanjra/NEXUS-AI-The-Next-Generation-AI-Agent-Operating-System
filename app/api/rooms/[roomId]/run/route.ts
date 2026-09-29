/**
 * Nexus AI — Team Room Endpoint
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import { NextRequest } from 'next/server';
import { getAgent, isBuiltinAgent, sanitizeAgentConfig, type AgentConfig } from '@/lib/agents';
import { orchestrateRoom, type RoomProvider } from '@/lib/rooms';
import { applyProviderOverride, isProviderRequestInput, resolveRequestProvider } from '@/lib/request-context';
import { resolveApiKey } from '@/lib/providers';
import { searchDocumentChunks } from '@/lib/document-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_BODY_BYTES = 64_000;
const MAX_AGENTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const ROOM_ID = /^[a-z0-9-]{1,64}$/;

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(req: NextRequest) {
  const key = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
}

function readAgents(value: unknown): AgentConfig[] {
  if (Array.isArray(value)) {
    return value
      .map((agent) => sanitizeAgentConfig(agent))
      .filter((agent): agent is AgentConfig => Boolean(agent))
      .slice(0, MAX_AGENTS);
  }
  if (value && typeof value === 'object' && Array.isArray((value as { agentIds?: unknown }).agentIds)) {
    return ((value as { agentIds: unknown[] }).agentIds)
      .filter((id): id is string => typeof id === 'string' && isBuiltinAgent(id))
      .map(getAgent)
      .slice(0, MAX_AGENTS);
  }
  return [];
}

export async function POST(req: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  if (isRateLimited(req)) return Response.json({ error: 'Rate limit exceeded. Wait a minute and try again.' }, { status: 429 });

  const { roomId } = await context.params;
  if (!ROOM_ID.test(roomId)) return Response.json({ error: 'Invalid room id' }, { status: 400 });

  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return Response.json({ error: 'Request body is too large' }, { status: 413 });

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request body' }, { status: 400 });

  const value = body as Record<string, unknown>;
  const message = value.message;
  if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: 'Message must be between 1 and 12000 characters' }, { status: 400 });
  }
  if (value.apiKey !== undefined && (typeof value.apiKey !== 'string' || value.apiKey.length > 500)) {
    return Response.json({ error: 'Invalid apiKey' }, { status: 400 });
  }
  if (value.apiKeys !== undefined && (typeof value.apiKeys !== 'object' || value.apiKeys === null || Array.isArray(value.apiKeys))) {
    return Response.json({ error: 'Invalid apiKeys' }, { status: 400 });
  }
  if (value.agents !== undefined && !Array.isArray(value.agents)) {
    return Response.json({ error: 'Invalid agents' }, { status: 400 });
  }

  const agents = readAgents(value.agents ?? value);
  if (!agents.length) return Response.json({ error: 'Select between one and five agents' }, { status: 400 });

  const providerRequest = {
    providerId: value.providerId ?? value.provider,
    customProviders: value.customProviders,
    apiKey: value.apiKey,
    apiKeys: value.apiKeys,
  };
  if (!isProviderRequestInput(providerRequest)) {
    return Response.json({ error: 'Invalid provider configuration' }, { status: 400 });
  }

  const resolved = await resolveRequestProvider(providerRequest);
  if (!resolved) return Response.json({ error: 'No provider is configured' }, { status: 400 });

  const room: RoomProvider = {
    provider: resolved.provider,
    apiKey: resolved.apiKey,
    keyFor: (providerId) => {
      const instance = resolved.registry.find((item) => item.id === providerId);
      return instance ? resolveApiKey(instance, resolved.keyTable) : '';
    },
    providerFor: async (providerId) => {
      const applied = await applyProviderOverride(resolved, providerId);
      const fallbackProviders = [
        ...(applied.provider.id === resolved.provider.id ? [] : [resolved.provider]),
        ...resolved.fallbackChain,
      ].filter((item, index, list) => item.id !== applied.provider.id && list.findIndex((candidate) => candidate.id === item.id) === index);
      return {
        provider: applied.provider,
        apiKey: applied.apiKey,
        fallbackChain: fallbackProviders.map((item) => ({ provider: item, apiKey: room.keyFor(item.id) })),
      };
    },
  };

  if (!room.apiKey && resolved.provider.builtin) {
    return Response.json({ error: 'No API key is configured for the selected provider' }, { status: 400 });
  }

  let documentContext = '';
  if (value.documentIds !== undefined && !Array.isArray(value.documentIds)) return Response.json({ error: 'Invalid document selection' }, { status: 400 });
  if (Array.isArray(value.documentIds) && value.documentIds.length) {
    if (typeof value.workspaceId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(value.workspaceId)
      || value.documentIds.length > 12 || value.documentIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) {
      return Response.json({ error: 'Invalid workspace or document selection' }, { status: 400 });
    }
    try {
      room.workspaceId = value.workspaceId;
      room.documentIds = value.documentIds as string[];
      const chunks = await searchDocumentChunks(value.workspaceId, value.documentIds as string[], message, 8);
      if (!chunks.length) return Response.json({ error: 'No relevant passages were found in the selected files. Try a more specific question.' }, { status: 422 });
      documentContext = 'Use these file passages as the factual basis of the discussion. Cite [Source N] and the file location. Do not invent missing document facts.\n\n' + chunks.map((chunk, index) =>
        `[Source ${index + 1} | ${chunk.name} | ${chunk.pageNumber ? `p. ${chunk.pageNumber}` : chunk.slideNumber ? `slide ${chunk.slideNumber}` : chunk.sheetName ? `sheet ${chunk.sheetName}` : chunk.section}]\n${chunk.text}`,
      ).join('\n\n');
    } catch {
      return Response.json({ error: 'The document database is unavailable' }, { status: 503 });
    }
  }

  const controller = new AbortController();
  const stop = () => controller.abort(req.signal.reason);
  req.signal.addEventListener('abort', stop, { once: true });
  if (req.signal.aborted) stop();
  const deadline = setTimeout(() => controller.abort(new Error('Room execution exceeded its 300 second deadline.')), 300_000);
  const cleanup = () => { clearTimeout(deadline); req.signal.removeEventListener('abort', stop); };

  if (value.stream === true) {
    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const send = (event: string, data: unknown) => {
          try { output.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
          catch { controller.abort(); }
        };
        heartbeat = setInterval(() => send('heartbeat', { at: Date.now() }), 15_000);
        try {
          const result = await orchestrateRoom({ roomId, message: message.trim(), agents, room,
            signal: controller.signal, documentContext, onEvent: (event) => send(event.type, event) });
          send('done', result);
        } catch (error) {
          send('error', error instanceof Error ? error.message : 'Room execution failed');
        } finally {
          clearInterval(heartbeat);
          cleanup();
          try { output.close(); } catch { /* Disconnected. */ }
        }
      },
      cancel() { controller.abort(); clearInterval(heartbeat); cleanup(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
  }

  try {
    const result = await orchestrateRoom({
      roomId,
      message: message.trim(),
      agents,
      room,
      signal: controller.signal,
      documentContext,
    });
    if (result.status === 'failed') {
      const error = result.steps.map((step) => `${step.name}: ${step.error || 'no response'}`).join(' | ');
      return Response.json({ ...result, error }, { status: 502 });
    }
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Room execution failed' },
      { status: 502 },
    );
  } finally {
    cleanup();
  }
}
