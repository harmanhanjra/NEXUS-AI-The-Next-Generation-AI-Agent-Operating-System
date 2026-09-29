/**
 * Nexus AI — Provider Layer
 *
 * Every provider in Nexus speaks the OpenAI-compatible protocol, so the whole
 * app shares one streaming transport (see `lib/llm.ts`). A provider is just a
 * named instance of `(baseUrl, apiKey, model)`.
 *
 * Two built-ins are configured from the server environment. Users can add any
 * number of custom OpenAI-compatible providers (Ollama, vLLM, Groq, Together,
 * LM Studio, or any gateway) from the browser; those arrive with each request
 * and are validated again on the server.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

/** Protocol family. Determines only which env var supplies the server key. */
export type ProviderKind = 'nvidia' | 'openai';

/** Compatibility IDs used by the workspace UI. */
export type ProviderId = 'openai-compatible' | 'nvidia';
export type ProviderSettings = { provider: ProviderId; baseUrl: string; model: string };

/** A single resolvable provider instance. */
export interface ProviderInstance {
  /** Stable slug. Built-ins use `nvidia` / `openai`; custom ones are user ids. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  kind: ProviderKind;
  /** OpenAI-compatible root, e.g. https://integrate.api.nvidia.com/v1 */
  baseUrl: string;
  /** Empty means "discover the best available chat model at request time". */
  model: string;
  /** Built-ins cannot be deleted or have their server key removed. */
  builtin: boolean;
}

/** The provider actually used for one call, after keys and models are resolved. */
export interface ResolvedProvider {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /** Built-in providers require a key; user-added ones may run keyless. */
  builtin: boolean;
}

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

const BUILTIN_DEFS: ReadonlyArray<{ id: string; label: string; kind: ProviderKind; envBaseUrl: string; fallbackBaseUrl: string; envKey: string; defaultModel: string }> = [
  { id: 'nvidia', label: 'NVIDIA NIM', kind: 'nvidia', envBaseUrl: 'NVIDIA_BASE_URL', fallbackBaseUrl: NVIDIA_BASE_URL, envKey: 'NVIDIA_API_KEY', defaultModel: 'nvidia/nemotron-3-super-120b-a12b' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', envBaseUrl: 'OPENAI_BASE_URL', fallbackBaseUrl: OPENAI_BASE_URL, envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4.1-mini' },
];

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_LABEL_LENGTH = 60;
const MAX_URL_LENGTH = 500;
const MAX_MODEL_LENGTH = 160;
const MAX_KEY_LENGTH = 500;

/** Model preference for NVIDIA's catalogue, best balance of speed and quality. */
const NVIDIA_MODEL_PREFERENCE = [
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'nvidia/nemotron-3-super-120b-a12b',
  'deepseek-ai/deepseek-v4-flash',
  'meta/llama-3.3-70b-instruct',
  'qwen/qwen3-next-80b-a3b-instruct',
];

/** Generic preference for any other OpenAI-compatible catalogue. */
const GENERIC_MODEL_PREFERENCE = [
  'gpt-4.1-mini',
  'gpt-4o-mini',
  'llama-3.3-70b-instruct',
  'nvidia/llama-3.3-70b-instruct',
  'mistral-large',
  'qwen2.5-72b-instruct',
];

/** Prefixes/families that indicate a real chat/instruct model. */
const CHAT_HINTS = /instruct|nemotron|chat|gpt|llama|qwen|mistral|deepseek|kimi|glm|gemma|phi/i;
/** Anything that is not a chat model. */
const NON_CHAT_HINTS = /embed|guard|safety|rerank|reward|vision|vlm|cv|nvidia\/nemotron.*-(embed|guard)|moderation|whisper|tts|code/i;

export function isValidProviderId(id: string): boolean {
  return PROVIDER_ID.test(id);
}

export function isProviderKind(value: unknown): value is ProviderKind {
  return value === 'nvidia' || value === 'openai';
}

/** Built-in providers, reflecting the current server environment. */
export function builtinProviders(): ProviderInstance[] {
  return BUILTIN_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    kind: def.kind,
    baseUrl: normalizeBaseUrl(process.env[def.envBaseUrl]) || def.fallbackBaseUrl,
    model: def.defaultModel,
    builtin: true,
  }));
}

export function getBuiltinProvider(id: string): ProviderInstance | undefined {
  return builtinProviders().find((provider) => provider.id === id);
}

/** Server-side key for a built-in provider. Custom providers have none. */
export function getServerKey(provider: ProviderInstance): string {
  if (!provider.builtin) return '';
  const def = BUILTIN_DEFS.find((item) => item.id === provider.id);
  if (!def) return '';
  return (process.env[def.envKey] || '').trim();
}

/** True when the server holds a key for this provider. */
export function hasServerKey(provider: ProviderInstance): boolean {
  return Boolean(getServerKey(provider));
}

/**
 * Resolve the provider list to work with: built-ins plus any validated custom
 * providers the client sent. A custom provider may not shadow a built-in id.
 */
export function resolveProviderRegistry(customInput: unknown): ProviderInstance[] {
  const builtins = builtinProviders();
  if (!customInput) return builtins;
  const custom = sanitizeCustomProviders(customInput);
  if (!custom.length) return builtins;
  const builtinIds = new Set(builtins.map((provider) => provider.id));
  return [...builtins, ...custom.filter((provider) => !builtinIds.has(provider.id))];
}

export function sanitizeCustomProviders(input: unknown): ProviderInstance[] {
  const list = Array.isArray(input) ? input : input && typeof input === 'object' ? Object.values(input as Record<string, unknown>) : [];
  const seen = new Set<string>();
  const output: ProviderInstance[] = [];
  for (const raw of list.slice(0, 24)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : '';
    if (!isValidProviderId(id) || seen.has(id)) continue;
    const baseUrl = normalizeBaseUrl(typeof value.baseUrl === 'string' ? value.baseUrl : '');
    if (!baseUrl) continue;
    const kind = isProviderKind(value.kind) ? value.kind : 'openai';
    const label = (typeof value.label === 'string' ? value.label.trim() : '').slice(0, MAX_LABEL_LENGTH) || id;
    const model = typeof value.model === 'string' ? value.model.trim().slice(0, MAX_MODEL_LENGTH) : '';
    seen.add(id);
    output.push({ id, label, kind, baseUrl, model, builtin: false });
  }
  return output;
}

/**
 * Find the provider a request wants. Accepts a provider id, or an inline
 * `{ id, baseUrl, model }` blob from the client. Unknown ids fall back to the
 * first provider the server has a key for, so a stale bookmark never 500s.
 */
export function selectProvider(registry: ProviderInstance[], requested: unknown): ProviderInstance | undefined {
  const inline = requested && typeof requested === 'object' && !Array.isArray(requested) ? requested as Record<string, unknown> : null;
  const legacyId = inline && typeof inline.provider === 'string'
    ? ({ 'openai-compatible': 'openai' } as Record<string, string>)[inline.provider] || inline.provider
    : '';
  const inlineId = inline && typeof inline.id === 'string' ? inline.id.trim().toLowerCase() : legacyId;
  const rawId = inlineId || (typeof requested === 'string' ? requested.trim().toLowerCase() : '');

  let provider = rawId ? registry.find((item) => item.id === rawId) : undefined;
  if (provider && inline) {
    // A server credential must never be forwarded to a client-selected host.
    let baseUrl = provider.baseUrl;
    const requestedBaseUrl = normalizeBaseUrl(typeof inline.baseUrl === 'string' ? inline.baseUrl : '');
    if (requestedBaseUrl && isSafeProviderUrl(requestedBaseUrl)) {
      if (provider.builtin && new URL(requestedBaseUrl).origin !== new URL(provider.baseUrl).origin) {
        provider = { ...provider, builtin: false, label: 'Custom OpenAI-compatible endpoint' };
      }
      baseUrl = requestedBaseUrl;
    }
    if (baseUrl) {
      provider = {
        ...provider,
        baseUrl,
        model: typeof inline.model === 'string' ? inline.model.trim().slice(0, MAX_MODEL_LENGTH) : provider.model,
      };
    }
  } else if (!provider && inline) {
    // The id is unknown but the client sent a full inline definition.
    const override = sanitizeCustomProviders([{ ...inline, id: rawId || 'custom' }])[0];
    if (override) provider = override;
  }
  if (provider) return provider;
  return registry.find((item) => hasServerKey(item)) || registry[0];
}

/**
 * Client-supplied key for a provider, if any. Keys are stored in the browser
 * and scoped per provider id, so custom providers never overwrite each other.
 *
 * A key longer than the API accepts is rejected rather than truncated: a
 * silently shortened key would surface as a confusing authentication error
 * much later.
 */
const PROVIDER_KEY_ALIASES: Record<string, string[]> = {
  openai: ['openai', 'openai-compatible'],
  nvidia: ['nvidia'],
};

export function getClientKey(providerId: string, keyInput: unknown): string {
  if (!keyInput) return '';
  let table: Record<string, unknown> = {};
  if (typeof keyInput === 'string') table = { [providerId]: keyInput };
  else if (typeof keyInput === 'object' && !Array.isArray(keyInput)) table = keyInput as Record<string, unknown>;
  const candidates = PROVIDER_KEY_ALIASES[providerId] || [providerId];
  for (const candidate of candidates) {
    const value = table[candidate];
    if (typeof value !== 'string') continue;
    const key = value.trim();
    if (!key) continue;
    return key.length <= MAX_KEY_LENGTH ? key : '';
  }
  return '';
}

/** Effective key: the browser-supplied key wins, then the server key. */
export function resolveApiKey(provider: ProviderInstance, keyInput: unknown): string {
  return getClientKey(provider.id, keyInput) || getServerKey(provider);
}

/** Strip trailing slashes and any `/chat/completions` suffix from a base URL. */
export function normalizeBaseUrl(value: string | undefined | null): string {
  if (!value) return '';
  return value.trim().slice(0, MAX_URL_LENGTH).replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

/**
 * Reject base URLs that could be used to reach internal infrastructure.
 * Private/loopback hosts are only allowed when the operator opts in, because
 * self-hosted runtimes (Ollama, vLLM) legitimately need them.
 */
export function isSafeProviderUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  if (isPrivateHostname(url.hostname.toLowerCase())) {
    return process.env.ALLOW_LOCAL_PROVIDER_URLS === 'true';
  }
  return true;
}

export function isPrivateHostname(host: string): boolean {
  if (!host) return true;
  const normalized = host.replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local') || normalized.endsWith('.internal')) return true;
  if (normalized === '::1' || normalized === '0.0.0.0' || normalized === '::') return true;
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  if (/^169\.254\./.test(normalized)) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(normalized) || /^fe[89ab][0-9a-f]:/.test(normalized)) return true;
  return false;
}

/** Validate a base URL a user typed into the provider editor. */
export function validateProviderUrl(value: string): { ok: true; url: string } | { ok: false; reason: string } {
  const url = normalizeBaseUrl(value);
  if (!url) return { ok: false, reason: 'A base URL is required.' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'That is not a valid URL. Include the scheme, e.g. https://api.example.com/v1' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Only http and https endpoints are supported.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Remove the credentials from the URL and use the API key field instead.' };
  }
  if (isPrivateHostname(parsed.hostname.toLowerCase()) && process.env.ALLOW_LOCAL_PROVIDER_URLS !== 'true') {
    return { ok: false, reason: 'Private and loopback addresses are blocked. Set ALLOW_LOCAL_PROVIDER_URLS=true to allow local runtimes.' };
  }
  return { ok: true, url };
}

/** Turn a user-typed name into a valid provider id. */
export function slugifyProviderId(label: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'custom';
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Pick a chat model the key can actually reach.
 *
 * An empty `model` means "choose for me". We ask the provider's own
 * `/models` endpoint and prefer a curated list, then fall back to any model
 * that looks like a chat model. Providers without a models endpoint get a
 * curated default instead of failing.
 */
export async function discoverChatModel(baseUrl: string, apiKey: string, kind: ProviderKind): Promise<string> {
  const fallback = (kind === 'nvidia' ? NVIDIA_MODEL_PREFERENCE[0] : GENERIC_MODEL_PREFERENCE[0]);
  const root = normalizeBaseUrl(baseUrl);
  if (!root) throw new Error('No provider base URL is configured.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let models: string[];
  try {
    const response = await fetch(`${root}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      // Some OpenAI-compatible servers do not implement /models. A curated
      // default is more useful than blocking the request.
      return fallback;
    }
    const payload: unknown = await response.json();
    models = extractModelIds(payload);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return fallback;
    return fallback;
  } finally {
    clearTimeout(timer);
  }

  if (!models.length) return fallback;
  const byLowerId = new Map(models.map((id) => [id.toLowerCase(), id]));
  const preference = kind === 'nvidia' ? NVIDIA_MODEL_PREFERENCE : [...GENERIC_MODEL_PREFERENCE, ...NVIDIA_MODEL_PREFERENCE];
  const preferred = preference.map((id) => byLowerId.get(id)).find(Boolean);
  if (preferred) return preferred;
  const chatModels = models.filter((id) => CHAT_HINTS.test(id) && !NON_CHAT_HINTS.test(id));
  return chatModels[0] || models[0] || fallback;
}

function extractModelIds(payload: unknown): string[] {
  const container = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = Array.isArray(container.data)
    ? container.data
    : Array.isArray(container.models)
      ? container.models
      : Array.isArray(payload)
        ? payload
        : [];
  const ids: string[] = [];
  for (const entry of data) {
    if (typeof entry === 'string') { ids.push(entry); continue; }
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const id = value.id ?? value.name ?? value.model;
    if (typeof id === 'string' && id.trim()) ids.push(id.trim());
  }
  return [...new Set(ids)];
}

/** Every provider that currently has a usable key, for fallback ordering. */
export function providersWithKeys(registry: ProviderInstance[], keyInput: unknown): ProviderInstance[] {
  return registry.filter((provider) => Boolean(resolveApiKey(provider, keyInput)));
}
