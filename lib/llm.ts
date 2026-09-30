/**
 * Nexus AI — Model Transport
 *
 * One streaming implementation for every provider. NVIDIA NIM, OpenAI, and any
 * user-added OpenAI-compatible server all speak the same `/chat/completions`
 * protocol, so there is a single code path to keep correct and fast.
 *
 * Reliability choices worth knowing about:
 *  - Tokens are yielded to the caller as they arrive, never buffered to the end.
 *  - Retryable statuses (429/5xx) are retried with exponential backoff and the
 *    server's `Retry-After` hint, but only while no token has been emitted, so
 *    a retry can never duplicate text the user already saw.
 *  - The connect phase and the stream body are bounded separately. A slow cold
 *    model is fine; a model that stops sending mid-answer is not.
 *  - Servers that ignore `stream: true` and return a single JSON object are
 *    handled, because they are common in the self-hosted ecosystem.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import type { AgentConfig } from './agents.ts';
import { recallMemory } from './memory.ts';
import { isRetryableStatus, normalizeBaseUrl, type ResolvedProvider } from './providers.ts';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type StreamEventType = 'thinking' | 'tool_call' | 'token' | 'citation' | 'done' | 'error';

export interface StreamEvent {
  type: StreamEventType;
  data: any;
}

export type AgentStreamOptions = {
  apiKey: string;
  agent: AgentConfig;
  history: ChatTurn[];
  userMessage: string;
  provider: ResolvedProvider;
  /** Aborts an in-flight stream, e.g. when the user stops generating. */
  signal?: AbortSignal;
  maxTokens?: number;
  /** Explicit thinking control for compatible providers that advertise it. */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  harness?: boolean;
  workspaceId?: string;
  documentIds?: string[];
  skillTask?: string;
  teamAgents?: AgentConfig[];
  delegationDepth?: number;
};

const CONNECT_TIMEOUT_MS = 60_000;
export const NVIDIA_FIRST_ANSWER_TIMEOUT_MS = 60_000;
const STALL_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;
const MAX_PROVIDER_ERROR_LENGTH = 320;

type AttemptOutcome =
  | { kind: 'ok'; text: string }
  | { kind: 'stop' }
  | { kind: 'retry'; message: string; retryAfterMs: number }
  | { kind: 'error'; message: string };

type AttemptOptions = AgentStreamOptions & {
  model: string;
  messages: Array<{ role: string; content: string }>;
  attempt: number;
  totalAttempts: number;
};

export async function* streamAgentResponse(opts: AgentStreamOptions): AsyncGenerator<StreamEvent> {
  const nvidia = opts.provider.id === 'nvidia' && /^https:\/\/integrate\.api\.nvidia\.com(?:\/|$)/.test(opts.provider.baseUrl);
  if (!nvidia) { yield* streamSingleProvider(opts); return; }
  const models = [...new Set([opts.provider.model, 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3.5-lightning-30b-a3b'])];
  let lastError = '';
  for (const [index, model] of models.entries()) {
    if (opts.signal?.aborted) return;
    const controller = new AbortController();
    let timedOut = false, emitted = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, NVIDIA_FIRST_ANSWER_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, ...(opts.signal ? [opts.signal] : [])]);
    if (index) yield { type: 'thinking', data: `NVIDIA model unavailable. Trying ${model} with the same NVIDIA key…` };
    try {
      for await (const event of streamSingleProvider({ ...opts, signal, provider: { ...opts.provider, model } })) {
        if (event.type === 'token') { emitted = true; clearTimeout(timer); }
        // A real tool call means the model has started work. Delegation can
        // take longer than a first answer; its child has its own deadline.
        if (event.type === 'thinking' && /^Using /.test(String(event.data))) clearTimeout(timer);
        if (event.type === 'error' && !emitted) { lastError = String(event.data); break; }
        yield event;
      }
      if (emitted || opts.signal?.aborted) return;
      if (timedOut) lastError = `NVIDIA model ${model} did not start answering within 60 seconds.`;
    } finally { clearTimeout(timer); controller.abort(); }
  }
  yield { type: 'error', data: lastError || 'The NVIDIA models are currently unavailable. Try again shortly.' };
}

async function* streamSingleProvider(opts: AgentStreamOptions): AsyncGenerator<StreamEvent> {
  const { agent, provider } = opts;

  if (provider.builtin && !opts.apiKey) {
    yield { type: 'error', data: `No API key configured for ${provider.label}. Add one in Provider settings.` };
    return;
  }
  if (!provider.model) {
    yield { type: 'error', data: `No model selected for ${provider.label}. Set a model in Provider settings.` };
    return;
  }

  if (opts.harness) {
    let emitted = false;
    try {
      const { streamHarness } = await import('./harness.ts');
      for await (const event of streamHarness(opts)) {
        if (event.type === 'token') emitted = true;
        yield event;
      }
      return;
    } catch (error) {
      if (opts.signal?.aborted) return;
      if (emitted) {
        yield { type: 'error', data: error instanceof Error ? error.message : 'Agent execution failed.' };
        return;
      }
      // Plain chat remains available on models that reject tool schemas.
      yield { type: 'thinking', data: 'The model could not run the tool loop. Retrying with standard chat…' };
    }
  }

  yield { type: 'thinking', data: `Routing to ${provider.model}…` };

  const recall = agent.tools.includes('memory_recall')
    ? await runMemoryRecall(opts.userMessage, agent.id)
    : { text: '', events: [] as StreamEvent[] };
  for (const event of recall.events) yield event;

  const messages = [
    { role: 'system', content: agent.systemPrompt + runtimeNotice() + recall.text },
    ...opts.history.slice(-24).map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: opts.userMessage },
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (opts.signal?.aborted) return;
    const stream = attemptStream({
      ...opts,
      model: provider.model,
      messages,
      attempt,
      totalAttempts: MAX_ATTEMPTS,
    });
    const iterator = stream[Symbol.asyncIterator]();
    let emittedToken = false;
    let outcome: AttemptOutcome = { kind: 'error', message: 'The provider returned no output.' };
    while (true) {
      const next = await iterator.next();
      if (next.done) { outcome = next.value; break; }
      if (next.value.type === 'token') emittedToken = true;
      yield next.value;
    }

    if (outcome.kind === 'ok') {
      yield { type: 'done', data: { text: outcome.text, tokens: estimateTokens(outcome.text) } };
      return;
    }
    if (outcome.kind === 'stop' || opts.signal?.aborted) return;
    if (outcome.kind === 'error' || attempt === MAX_ATTEMPTS) {
      // A partial answer already shown to the user is better than an error.
      if (outcome.kind === 'retry' && emittedToken) return;
      yield { type: 'error', data: outcome.message };
      return;
    }
    yield { type: 'thinking', data: `${provider.label} did not answer — retrying (${attempt + 1}/${MAX_ATTEMPTS})…` };
    await delay(outcome.retryAfterMs, opts.signal);
  }
}

async function runMemoryRecall(query: string, agentId: string): Promise<{ text: string; events: StreamEvent[] }> {
  const events: StreamEvent[] = [];
  try {
    const memories = await recallMemory({ query, agentId, topK: 4 });
    events.push({
      type: 'tool_call',
      data: {
        name: 'memory.recall',
        args: `query="${truncate(query, 40)}"`,
        result: memories.length ? `${memories.length} relevant memories` : 'no matches',
        success: true,
      },
    });
    if (!memories.length) return { text: '', events };
    const text = `\n\n<long_term_memory>\n${memories
      .map((memory, index) => `[${index + 1}] (relevance ${memory.score}) ${truncate(memory.content, 600)}`)
      .join('\n')}\n</long_term_memory>`;
    return { text, events };
  } catch {
    events.push({ type: 'tool_call', data: { name: 'memory.recall', result: 'unavailable', success: false } });
    return { text: '', events };
  }
}

async function* attemptStream(opts: AttemptOptions): AsyncGenerator<StreamEvent, AttemptOutcome> {
  const { agent, provider, apiKey, model, messages, attempt, totalAttempts, signal } = opts;
  if (signal?.aborted) return { kind: 'stop' };
  const root = normalizeBaseUrl(provider.baseUrl);
  if (!root) return { kind: 'error', message: `${provider.label} has no valid base URL configured.` };

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const disconnect = () => signal?.removeEventListener('abort', onAbort);
  const connectTimer = setTimeout(() => controller.abort(new PhaseTimeout('connect')), CONNECT_TIMEOUT_MS);
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const clearTimers = () => { clearTimeout(connectTimer); if (stallTimer) clearTimeout(stallTimer); };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${root}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: agent.temperature,
        stream: true,
        ...(provider.id === 'nvidia' && /nemotron-(3|3\.5)/.test(model)
          ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        max_tokens: opts.maxTokens || 4096,
        ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
        messages,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimers();
    disconnect();
    return { kind: 'retry', message: connectionMessage(root, error, controller), retryAfterMs: backoff(attempt) };
  }
  clearTimeout(connectTimer);

  if (signal?.aborted) {
    clearTimers();
    disconnect();
    return { kind: 'stop' };
  }

  if (!response.ok) {
    clearTimers();
    disconnect();
    const detail = await readErrorDetail(response);
    const message = `${provider.label} request failed (${response.status})${detail ? `: ${detail}` : ''}`;
    if (isRetryableStatus(response.status) && attempt < totalAttempts) {
      return { kind: 'retry', message, retryAfterMs: retryAfter(response, attempt) };
    }
    return { kind: 'error', message };
  }

  // Some self-hosted servers ignore `stream: true` and reply with one JSON body.
  const contentType = response.headers.get('content-type') || '';
  if (!response.body || contentType.includes('application/json')) {
    clearTimers();
    disconnect();
    const text = await readNonStreaming(response);
    if (!text) return { kind: 'error', message: `${provider.label} returned an empty response.` };
    yield { type: 'token', data: text };
    return { kind: 'ok', text };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let emittedToken = false;
  let finished = false;

  const touch = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(new PhaseTimeout('stall')), STALL_TIMEOUT_MS);
  };
  touch();

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        for (const delta of deltasFromBlock(block)) {
          if (delta) {
            fullText += delta;
            emittedToken = true;
            yield { type: 'token', data: delta };
          }
        }
        if (blockHasDone(block)) { finished = true; break; }
      }
    }
    if (!finished && buffer.trim()) {
      for (const delta of deltasFromBlock(buffer)) {
        if (delta) {
          fullText += delta;
          emittedToken = true;
          yield { type: 'token', data: delta };
        }
      }
    }
  } catch (error) {
    if (signal?.aborted && !isPhaseTimeout(controller)) return { kind: 'stop' };
    // An error the provider explicitly sent is a real failure, not a truncated
    // answer. Surface it even when tokens were already streamed, so the user
    // is not shown a partial response that silently stopped mid-thought.
    if (error instanceof ProviderStreamError) {
      return { kind: 'error', message: error.message };
    }
    if (emittedToken) {
      // A stalled connection after partial output: keep what the user is
      // already reading rather than replacing it with an error.
      return fullText.trim() ? { kind: 'ok', text: fullText } : { kind: 'error', message: streamEndedMessage(controller) };
    }
    const message = streamEndedMessage(controller);
    if (attempt < totalAttempts) return { kind: 'retry', message, retryAfterMs: backoff(attempt) };
    return { kind: 'error', message };
  } finally {
    clearTimers();
    disconnect();
  }

  if (!fullText.trim()) return { kind: 'error', message: `${provider.label} closed the stream without returning any text.` };
  return { kind: 'ok', text: fullText };
}

/** Parse one SSE frame into its data payloads (a frame may repeat `data:`). */
export function parseSseBlock(block: string): string[] {
  const out: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) out.push(line.slice(5).trim());
  }
  return out;
}

function blockHasDone(block: string): boolean {
  return parseSseBlock(block).some((line) => line === '[DONE]');
}

function deltasFromBlock(block: string): string[] {
  const deltas: string[] = [];
  for (const data of parseSseBlock(block)) {
    if (!data || data === '[DONE]') continue;
    let payload: any;
    try { payload = JSON.parse(data); } catch { continue; }
    if (payload?.error) throw new ProviderStreamError(providerStreamError(payload.error));
    const delta = extractContent(payload);
    if (delta) deltas.push(delta);
  }
  return deltas;
}

/** Read content from a standard chat completion payload, streamed or not. */
function extractContent(payload: any): string {
  const choice = payload?.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function providerStreamError(error: unknown): string {
  const message = (error as any)?.message ?? (typeof error === 'string' ? error : 'unknown streaming error');
  return String(message).slice(0, MAX_PROVIDER_ERROR_LENGTH);
}

async function readNonStreaming(response: Response): Promise<string> {
  try {
    const payload: any = await response.json();
    return extractContent(payload).trim();
  } catch {
    return '';
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const payload: any = await response.json();
    const message = payload?.error?.message ?? payload?.message ?? payload?.error;
    return typeof message === 'string' ? message.slice(0, MAX_PROVIDER_ERROR_LENGTH) : '';
  } catch {
    return '';
  }
}

/**
 * An error the provider explicitly sent inside the stream body.
 *
 * Tracked as its own type because it must be reported to the user even when
 * partial tokens were already emitted, unlike a transport-level stall.
 */
class ProviderStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderStreamError';
  }
}

class PhaseTimeout extends Error {
  phase: 'connect' | 'stall';

  // Declared explicitly rather than as a constructor parameter property: this
  // file is executed by Node's type-stripping loader in tests, which cannot
  // erase the parameter-property syntax.
  constructor(phase: 'connect' | 'stall') {
    super(phase === 'connect' ? 'Connect timed out' : 'Stream stalled');
    this.phase = phase;
    this.name = 'AbortError';
  }
}

function isPhaseTimeout(controller: AbortController): boolean {
  return controller.signal.reason instanceof PhaseTimeout;
}

function connectionMessage(root: string, error: unknown, controller: AbortController): string {
  let host = 'the provider';
  try { host = new URL(root).host; } catch { /* keep the generic label */ }
  if (controller.signal.aborted) {
    return `Timed out waiting for ${host} to start responding. It may be cold-starting — try again in a moment.`;
  }
  const detail = error instanceof Error && error.message ? error.message.slice(0, 200) : 'unknown network error';
  return `Could not reach ${host}: ${detail}. Check the base URL and network access.`;
}

function streamEndedMessage(controller: AbortController): string {
  if ((controller.signal.reason as PhaseTimeout)?.phase === 'stall') {
    return 'The provider stopped sending data mid-answer. Check the model name, or try a smaller request.';
  }
  return 'The provider stream ended before the answer completed.';
}

function retryAfter(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 20_000);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), 20_000));
  }
  return backoff(attempt);
}

function backoff(attempt: number): number {
  return Math.min(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250), 5_000);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onDone); resolve(); }, ms);
    function onDone() { clearTimeout(timer); resolve(); }
    signal?.addEventListener('abort', onDone, { once: true });
  });
}

function runtimeNotice(): string {
  return `\n\nRuntime: today's date is ${new Date().toISOString().slice(0, 10)}. You have no live web access in this session. Never claim to have searched the web, invent a citation, or quote a URL you were not given. If a fact depends on information after your training data, say so plainly and mark it as needing verification.`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
