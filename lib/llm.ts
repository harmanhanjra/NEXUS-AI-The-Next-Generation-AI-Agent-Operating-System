/**
 * Nexus AI — LLM Orchestration Layer
 * Gemini streaming client with tool routing and grounded search.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import { GoogleGenAI } from '@google/genai';
import { AgentConfig } from './agents';
import { recallMemory } from './memory';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface StreamEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'token' | 'citation' | 'done' | 'error';
  data: any;
}

/**
 * Stream a Gemini response with tool orchestration.
 * - Recalls long-term memory first
 * - For Research/Business agents: uses Gemini's native Google Search grounding
 * - Emits SSE events for tool calls, tokens, and citations
 */
export async function* streamAgentResponse(opts: {
  apiKey: string;
  agent: AgentConfig;
  history: ChatTurn[];
  userMessage: string;
}): AsyncGenerator<StreamEvent> {
  const { apiKey, agent, history, userMessage } = opts;

  if (!apiKey) {
    yield { type: 'error', data: 'No Gemini API key configured. Get one free at https://aistudio.google.com/apikey' };
    return;
  }

  const client = new GoogleGenAI({ apiKey });

  // ===== Phase 1: Memory recall =====
  let memoryContext = '';
  if (agent.tools.includes('memory_recall')) {
    yield { type: 'thinking', data: 'Searching long-term memory…' };
    try {
      const memories = await recallMemory({
        apiKey,
        query: userMessage,
        agentId: agent.id,
        topK: 4,
      });
      yield {
        type: 'tool_call',
        data: {
          name: 'memory.recall',
          args: `query="${userMessage.slice(0, 40)}…"`,
          result: `${memories.length} relevant memories`,
          success: true,
        },
      };
      if (memories.length > 0) {
        memoryContext =
          '\n\n<long_term_memory>\n' +
          memories
            .map((m, i) => `[${i + 1}] (relevance ${m.score.toFixed(2)}) ${m.content}`)
            .join('\n') +
          '\n</long_term_memory>';
      }
    } catch (e: any) {
      yield { type: 'tool_call', data: { name: 'memory.recall', result: 'error: ' + e.message, success: false } };
    }
  }

  // ===== Phase 2: Decide if we need web search (Gemini native grounding) =====
  const useGrounding = agent.tools.includes('web_search');

  if (useGrounding) {
    yield { type: 'thinking', data: 'Searching the web with Google…' };
    yield {
      type: 'tool_call',
      data: {
        name: 'google_search',
        args: 'native grounding',
        result: 'streaming…',
        success: true,
      },
    };
  } else {
    yield { type: 'thinking', data: 'Thinking…' };
  }

  // ===== Phase 3: Build the prompt =====
  const systemInstruction = agent.systemPrompt + memoryContext;

  // Convert our history format → Gemini's content format
  const contents = [
    ...history.map(turn => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    { role: 'user' as const, parts: [{ text: userMessage }] },
  ];

  // ===== Phase 4: Stream! =====
  let fullText = '';
  try {
    const config: any = {
      systemInstruction,
      temperature: agent.temperature,
    };
    if (useGrounding) {
      config.tools = [{ googleSearch: {} }];
    }

    const stream = await client.models.generateContentStream({
      model: agent.model,
      contents,
      config,
    });

    let groundingChunks: any[] = [];
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        yield { type: 'token', data: text };
      }
      // Collect grounding metadata as it arrives
      const meta = chunk.candidates?.[0]?.groundingMetadata;
      if (meta?.groundingChunks) {
        groundingChunks = meta.groundingChunks;
      }
    }

    // Emit citations at the end
    if (groundingChunks.length > 0) {
      const citations = groundingChunks
        .map((c: any, i: number) => ({
          n: i + 1,
          title: c.web?.title || 'Source',
          uri: c.web?.uri || '#',
        }))
        .slice(0, 8);
      yield { type: 'citation', data: citations };
    }

    yield { type: 'done', data: { text: fullText, tokens: estimateTokens(fullText) } };
  } catch (err: any) {
    yield { type: 'error', data: err?.message || 'Unknown error' };
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
