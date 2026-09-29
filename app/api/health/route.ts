/**
 * Nexus AI — Health Endpoint
 *
 * Reports which providers the server can reach, without ever echoing a key.
 * The UI uses this to show configured state and to warn before a run.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import { builtinProviders, hasServerKey } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = builtinProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    builtin: true,
    baseUrl: provider.baseUrl,
    defaultModel: provider.model,
    hasServerKey: hasServerKey(provider),
  }));
  const serverProviders = {
    'openai-compatible': providers.some((provider) => provider.id === 'openai' && provider.hasServerKey),
    nvidia: providers.some((provider) => provider.id === 'nvidia' && provider.hasServerKey),
  };
  return Response.json(
    {
      ok: true,
      version: 2,
      hasServerKey: providers.some((provider) => provider.hasServerKey),
      serverProviders,
      providers,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
