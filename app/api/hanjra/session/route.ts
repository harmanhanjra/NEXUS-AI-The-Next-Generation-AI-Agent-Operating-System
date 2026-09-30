import { localRequest, sessionToken, SESSION_COOKIE } from '@/lib/hanjra/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!localRequest(req)) return Response.json({ error: 'Local same-origin session required' }, { status: 403 });
  return Response.json({ ready: true, scope: 'local command console' }, { headers: {
    'Set-Cookie': `${SESSION_COOKIE}=${sessionToken()}; HttpOnly; SameSite=Strict; Path=/api/hanjra; Max-Age=86400`,
    'Cache-Control': 'no-store',
  } });
}
