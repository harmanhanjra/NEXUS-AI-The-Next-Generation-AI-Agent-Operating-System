/**
 * Nexus AI — Request Resolution
 *
 * Turns the untrusted provider block on a request into a validated
 * `ResolvedProvider` plus an ordered fallback chain. Every entry point that
 * talks to a model goes through here so the rules stay identical.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import { getAgent, sanitizeAgentConfig, type AgentConfig } from './agents.ts';
import {
  discoverChatModel,
  hasServerKey,
  normalizeBaseUrl,
  providersWithKeys,
  resolveApiKey,
  resolveProviderRegistry,
  selectProvider,
  type ProviderInstance,
  type ResolvedProvider,
} from './providers.ts';

export type ProviderRequestInput = {
  providerId?: unknown;
  customProviders?: unknown;
  /** Legacy single key. Still honoured so older clients keep working. */
  apiKey?: unknown;
  /** Per-provider key table keyed by provider id. */
  apiKeys?: unknown;
  agent?: unknown;
  agentId?: unknown;
};

export type RequestProvider = {
  provider: ResolvedProvider;
  apiKey: string;
  registry: ProviderInstance[];
  /** Providers to try in order if the first one fails before any output. */
  fallbackChain: ResolvedProvider[];
  /** Keys supplied by the client, kept so an agent override can re-resolve. */
  keyTable: KeyTable;
};

export function isProviderRequestInput(value: unknown): value is ProviderRequestInput {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve the provider for a request. Returns null when no configured provider
 * has a usable key and no keyless custom provider is available.
 */
export async function resolveRequestProvider(input: ProviderRequestInput): Promise<RequestProvider | null> {
  const registry = resolveProviderRegistry(input.customProviders);
  const selected = selectProvider(registry, input.providerId);
  if (!selected) return null;

  const keyTable = {
    ...(typeof input.apiKeys === 'object' && input.apiKeys && !Array.isArray(input.apiKeys) ? input.apiKeys as Record<string, unknown> : {}),
    ...(typeof input.apiKey === 'string' && input.apiKey ? { [selected.id]: input.apiKey } : {}),
  };

  // An unconfigured built-in should not mask a configured NVIDIA provider.
  const primaryInstance = !resolveApiKey(selected, keyTable) && selected.builtin
    ? providersWithKeys(registry, keyTable)[0] || selected
    : selected;
  const primary = await materialize(primaryInstance, keyTable);

  // Fallback chain: any other configured provider, so a single bad key does not
  // end the turn. The primary is excluded.
  const alternatives = providersWithKeys(registry, keyTable).filter((item) => item.id !== primaryInstance.id);
  const fallbackChain: ResolvedProvider[] = [];
  for (const alternative of alternatives) {
    const resolved = await materialize(alternative, keyTable);
    if (!fallbackChain.some((item) => item.id === resolved.id)) fallbackChain.push(resolved);
  }

  return { provider: primary, apiKey: primary.apiKey, registry, fallbackChain, keyTable };
}

type KeyTable = Record<string, unknown>;

/** Fill in a model when the provider has none, and attach its key. */
async function materialize(provider: ProviderInstance, keyTable: KeyTable): Promise<ResolvedProvider & { apiKey: string }> {
  const apiKey = resolveApiKey(provider, keyTable);
  let model = provider.model;
  if (!model) {
    // Discovery needs network access; a failure just leaves the model unset so
    // the caller reports a clear configuration error.
    try {
      model = await discoverChatModel(provider.baseUrl, apiKey, provider.kind);
    } catch {
      model = '';
    }
  }
  return {
    id: provider.id,
    label: provider.label,
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    model,
    builtin: provider.builtin,
    apiKey,
  };
}

export type AgentResolution = {
  agent: AgentConfig;
  /** Provider override declared by the agent itself, if any. */
  providerOverride?: string;
};

/**
 * Pick the agent for a request and work out which provider should serve it.
 * A client-supplied agent is accepted only after sanitisation; otherwise the
 * built-in agent for `agentId` is used.
 */
export function resolveAgent(input: ProviderRequestInput): AgentResolution {
  const custom = sanitizeAgentConfig(input.agent);
  if (custom) return { agent: custom, providerOverride: custom.providerId };
  const agentId = typeof input.agentId === 'string' && input.agentId ? input.agentId : 'head';
  return { agent: getAgent(agentId), providerOverride: getAgent(agentId).providerId };
}

/**
 * Apply an agent's provider override to the resolved provider. Returns the
 * original provider when the override is unknown, so a typo degrades to the
 * workspace default instead of failing the request.
 */
export async function applyProviderOverride(
  resolved: RequestProvider,
  override: string | undefined,
): Promise<RequestProvider> {
  if (!override || override === resolved.provider.id) return resolved;
  const target = resolved.registry.find((item) => item.id === override);
  if (!target) return resolved;
  if (target.builtin && !resolveApiKey(target, resolved.keyTable)) return resolved;
  const alternate = await materialize(target, resolved.keyTable);
  return { ...resolved, provider: alternate, apiKey: alternate.apiKey };
}

/** True when the workspace has at least one provider ready to serve a request. */
export function hasUsableProvider(registry: ProviderInstance[], keyTable: unknown): boolean {
  return providersWithKeys(registry, keyTable).length > 0;
}

export { hasServerKey };
