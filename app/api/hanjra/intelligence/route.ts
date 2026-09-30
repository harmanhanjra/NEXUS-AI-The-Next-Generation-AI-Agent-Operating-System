import { authenticated, readBounded } from '@/lib/hanjra/auth';
import { intelligenceSnapshot, putMemory, archiveMemory, feedback } from '@/lib/hanjra/intelligence';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const operation = z.discriminatedUnion('operation',[
  z.object({operation:z.literal('memory'),title:z.string().min(1).max(120),content:z.string().min(1).max(4000)}).strict(),
  z.object({operation:z.literal('archive'),id:z.string().uuid(),archived:z.boolean()}).strict(),
  z.object({operation:z.literal('feedback'),taskId:z.string().uuid(),owner:z.string().max(40),helpful:z.boolean()}).strict(),
]);
export async function GET(req: Request) {
  if (!authenticated(req)) return Response.json({error:'Local authenticated session required'},{status:401});
  try { return Response.json(await intelligenceSnapshot((new URL(req.url).searchParams.get('q')||'').slice(0,1000)),{headers:{'Cache-Control':'no-store'}}); }
  catch { return Response.json({error:'Intelligence storage unavailable'},{status:503}); }
}
export async function POST(req: Request) {
  if (!authenticated(req) || !req.headers.get('origin')) return Response.json({error:'Local authenticated same-origin session required'},{status:401});
  try {
    const input=operation.parse(JSON.parse(new TextDecoder().decode(await readBounded(req,16000))));
    if(input.operation==='memory') return Response.json({note:await putMemory(input.title,input.content)},{status:201});
    if(input.operation==='archive') await archiveMemory(input.id,input.archived);
    if(input.operation==='feedback') await feedback(input.taskId,input.owner,input.helpful);
    return Response.json({saved:true});
  } catch(error) { return Response.json({error:error instanceof z.ZodError?'Invalid intelligence request':error instanceof Error?error.message:'Request failed'},{status:400}); }
}
