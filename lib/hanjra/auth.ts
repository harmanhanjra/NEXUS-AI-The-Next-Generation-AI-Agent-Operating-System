import { randomBytes, timingSafeEqual } from 'node:crypto';
const auth = globalThis as typeof globalThis & { __hanjraSession?: string };
export const SESSION_COOKIE = 'hanjra_session';
export function sessionToken(): string { return auth.__hanjraSession ||= randomBytes(32).toString('hex'); }
export function localRequest(req: Request): boolean {
  const host = req.headers.get('host') || new URL(req.url).host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  const origin = req.headers.get('origin');
  // Next's internal request URL may normalize the loopback host to localhost.
  // Bind browser origins to the validated Host header, not that internal URL.
  if (origin && origin !== `${new URL(req.url).protocol}//${host}`) return false;
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false;
  return true;
}
export function authenticated(req: Request): boolean {
  if (!localRequest(req)) return false;
  const cookie = (req.headers.get('cookie') || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1) || '';
  const expected = sessionToken();
  return /^[a-f0-9]{64}$/.test(cookie) && cookie.length === expected.length && timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
}
export async function readBounded(req: Request, limit: number): Promise<Uint8Array> {
  const reader = req.body?.getReader(); if (!reader) throw new Error('Missing request body');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
    if (size > limit) { await reader.cancel(); throw new Error('Request body exceeds size limit'); } chunks.push(chunk.value); }
  return Buffer.concat(chunks);
}
