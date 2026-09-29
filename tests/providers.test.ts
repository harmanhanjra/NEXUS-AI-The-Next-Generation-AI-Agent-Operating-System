import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateHostname,
  isRetryableStatus,
  isSafeProviderUrl,
  isValidProviderId,
  normalizeBaseUrl,
  providersWithKeys,
  resolveApiKey,
  resolveProviderRegistry,
  sanitizeCustomProviders,
  selectProvider,
  slugifyProviderId,
  validateProviderUrl,
  type ProviderInstance,
} from '../lib/providers.ts';

function custom(overrides: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    builtin: false,
    ...overrides,
  };
}

describe('normalizeBaseUrl', () => {
  test('strips trailing slashes and the chat/completions suffix', () => {
    assert.equal(normalizeBaseUrl('https://api.x.com/v1/'), 'https://api.x.com/v1');
    assert.equal(normalizeBaseUrl('https://api.x.com/v1/chat/completions'), 'https://api.x.com/v1');
    assert.equal(normalizeBaseUrl('  https://api.x.com/v1//  '), 'https://api.x.com/v1');
  });

  test('returns empty for missing input', () => {
    assert.equal(normalizeBaseUrl(undefined), '');
    assert.equal(normalizeBaseUrl(null), '');
    assert.equal(normalizeBaseUrl(''), '');
  });
});

describe('isPrivateHostname', () => {
  test('detects loopback, private ranges, and local TLDs', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.1.1', '0.0.0.0', '::1', 'api.local', 'svc.internal', 'fd00::1', 'fe80::1']) {
      assert.equal(isPrivateHostname(host), true, `${host} should be private`);
    }
  });

  test('does not treat public hosts as private', () => {
    for (const host of ['integrate.api.nvidia.com', 'api.openai.com', '8.8.8.8', '172.32.0.1', '11.0.0.1']) {
      assert.equal(isPrivateHostname(host), false, `${host} should be public`);
    }
  });
});

describe('isSafeProviderUrl', () => {
  test('rejects non-http schemes and embedded credentials', () => {
    assert.equal(isSafeProviderUrl('ftp://example.com/v1'), false);
    assert.equal(isSafeProviderUrl('file:///etc/passwd'), false);
    assert.equal(isSafeProviderUrl('https://user:pass@example.com/v1'), false);
    assert.equal(isSafeProviderUrl('not a url'), false);
  });

  test('blocks private hosts unless the operator opts in', () => {
    assert.equal(isSafeProviderUrl('http://localhost:11434/v1'), false);
    assert.equal(isSafeProviderUrl('https://api.example.com/v1'), true);
  });
});

describe('validateProviderUrl', () => {
  test('explains why a URL was rejected', () => {
    const missing = validateProviderUrl('');
    assert.equal(missing.ok, false);
    const scheme = validateProviderUrl('ws://example.com/v1');
    assert.equal(scheme.ok, false);
    const creds = validateProviderUrl('https://a:b@example.com/v1');
    assert.equal(creds.ok, false);
    const local = validateProviderUrl('http://localhost:11434/v1');
    assert.equal(local.ok, false);
    if (!local.ok) assert.match(local.reason, /ALLOW_LOCAL_PROVIDER_URLS/);
  });

  test('accepts and normalizes a valid public endpoint', () => {
    const result = validateProviderUrl('https://api.example.com/v1/');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.url, 'https://api.example.com/v1');
  });
});

describe('isValidProviderId', () => {
  test('accepts slugs and rejects unsafe ids', () => {
    assert.equal(isValidProviderId('ollama'), true);
    assert.equal(isValidProviderId('my-provider-2'), true);
    assert.equal(isValidProviderId(''), false);
    assert.equal(isValidProviderId('-leading'), false);
    assert.equal(isValidProviderId('has space'), false);
    assert.equal(isValidProviderId('x'.repeat(65)), false);
  });
});

describe('sanitizeCustomProviders', () => {
  test('normalises a valid list', () => {
    const result = sanitizeCustomProviders([{ id: 'Groq-Prod', label: '  Groq  ', baseUrl: 'https://api.groq.com/openai/v1/', model: 'llama-3.3-70b', kind: 'openai' }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'groq-prod');
    assert.equal(result[0].label, 'Groq');
    assert.equal(result[0].baseUrl, 'https://api.groq.com/openai/v1');
    assert.equal(result[0].model, 'llama-3.3-70b');
    assert.equal(result[0].builtin, false);
  });

  test('drops entries without a usable base URL', () => {
    assert.deepEqual(sanitizeCustomProviders([{ id: 'a', baseUrl: '' }, { id: 'b' }, 'nope', null, 42]), []);
  });

  test('deduplicates by id and caps the list', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ id: `p-${index}`, baseUrl: 'https://api.example.com/v1' }));
    const result = sanitizeCustomProviders(many);
    assert.equal(result.length, 24);
    const dupes = sanitizeCustomProviders([
      { id: 'same', baseUrl: 'https://a.example.com/v1' },
      { id: 'same', baseUrl: 'https://b.example.com/v1' },
    ]);
    assert.equal(dupes.length, 1);
  });

  test('falls back to the id when no label is supplied', () => {
    const result = sanitizeCustomProviders([{ id: 'ollama', baseUrl: 'https://api.example.com/v1' }]);
    assert.equal(result[0].label, 'ollama');
  });
});

describe('resolveProviderRegistry', () => {
  test('merges built-ins with custom providers', () => {
    const registry = resolveProviderRegistry([{ id: 'ollama', baseUrl: 'https://api.example.com/v1' }]);
    assert.ok(registry.some((item) => item.id === 'nvidia'));
    assert.ok(registry.some((item) => item.id === 'openai'));
    assert.ok(registry.some((item) => item.id === 'ollama'));
  });

  test('a custom provider cannot shadow a built-in id', () => {
    const registry = resolveProviderRegistry([{ id: 'nvidia', baseUrl: 'https://evil.example.com/v1', label: 'Evil' }]);
    const nvidia = registry.filter((item) => item.id === 'nvidia');
    assert.equal(nvidia.length, 1);
    assert.equal(nvidia[0].builtin, true);
    assert.equal(nvidia[0].baseUrl.includes('evil.example.com'), false);
  });

  test('returns built-ins when the custom list is junk', () => {
    assert.equal(resolveProviderRegistry('garbage').length, 2);
    assert.equal(resolveProviderRegistry(undefined).length, 2);
  });
});

describe('selectProvider', () => {
  const registry = resolveProviderRegistry([{ id: 'ollama', baseUrl: 'https://api.example.com/v1' }]);

  test('selects by id string', () => {
    assert.equal(selectProvider(registry, 'ollama')?.id, 'ollama');
    assert.equal(selectProvider(registry, 'nvidia')?.id, 'nvidia');
  });

  test('applies an inline baseUrl and model override', () => {
    const selected = selectProvider(registry, { id: 'ollama', baseUrl: 'https://other.example.com/v1', model: 'llama3' });
    assert.equal(selected?.baseUrl, 'https://other.example.com/v1');
    assert.equal(selected?.model, 'llama3');
  });

  test('ignores an unknown id instead of throwing', () => {
    assert.ok(selectProvider(registry, 'does-not-exist'));
  });

  test('returns undefined only for an empty registry', () => {
    assert.equal(selectProvider([], 'nvidia'), undefined);
  });
});

describe('key resolution', () => {
  const provider = custom();

  test('reads a key from a per-provider table', () => {
    assert.equal(resolveApiKey(provider, { ollama: 'sk-1' }), 'sk-1');
  });

  test('accepts a bare string as the key for that provider', () => {
    assert.equal(resolveApiKey(provider, 'sk-2'), 'sk-2');
  });

  test('ignores an oversized or non-string key', () => {
    assert.equal(resolveApiKey(provider, { ollama: 'x'.repeat(501) }), '');
    assert.equal(resolveApiKey(provider, { ollama: 42 }), '');
    assert.equal(resolveApiKey(provider, null), '');
  });

  test('providersWithKeys filters to usable entries', () => {
    const usable = providersWithKeys(registryOfTwo(), { a: 'key-a' });
    assert.deepEqual(usable.map((item) => item.id), ['a']);
  });
});

function registryOfTwo(): ProviderInstance[] {
  return [
    { id: 'a', label: 'A', kind: 'openai', baseUrl: 'https://a.example.com/v1', model: 'm', builtin: false },
    { id: 'b', label: 'B', kind: 'openai', baseUrl: 'https://b.example.com/v1', model: 'm', builtin: false },
  ];
}

describe('slugifyProviderId', () => {
  test('slugifies and avoids collisions', () => {
    assert.equal(slugifyProviderId('My Provider'), 'my-provider');
    assert.equal(slugifyProviderId('My Provider', ['my-provider']), 'my-provider-2');
    assert.equal(slugifyProviderId('!!!'), 'custom');
  });
});

describe('isRetryableStatus', () => {
  test('treats throttling and server faults as retryable', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableStatus(status), true, `${status} should retry`);
    }
  });

  test('does not retry client mistakes', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(isRetryableStatus(status), false, `${status} should not retry`);
    }
  });
});
