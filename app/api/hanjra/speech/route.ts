import { authenticated, readBounded } from '@/lib/hanjra/auth';
import { speechHealth, transcribeAudio, synthesize, type SpeechBackend } from '@/lib/hanjra/speech';
import { getTask, addStep } from '@/lib/hanjra/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
function backend(value: unknown): SpeechBackend {
  if (value === 'voicestudio' || value === 'windows-local') return value;
  throw new Error('Select an explicit speech backend');
}
export async function GET(req: Request) {
  if (!authenticated(req)) return Response.json({ error: 'Local session required' }, { status: 401 });
  try { return Response.json(await speechHealth(backend(new URL(req.url).searchParams.get('backend')), AbortSignal.any([req.signal, AbortSignal.timeout(20000)]))); }
  catch { return Response.json({ available: false, blocker: 'speech_configuration' }, { status: 503 }); }
}
export async function POST(req: Request) {
  if (!authenticated(req) || !req.headers.get('origin')) return Response.json({ error: 'Local same-origin session required' }, { status: 401 });
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(120000)]);
  try {
    const bytes = await readBounded(req, 9 * 1024 * 1024);
    if (req.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await new Response(bytes as BodyInit, { headers: { 'Content-Type': req.headers.get('content-type')! } }).formData();
      const audio = form.get('audio'); const language = String(form.get('language'));
      if (!(audio instanceof Blob) || !['auto', 'pa', 'hi', 'en'].includes(language)) throw new Error('Invalid audio or language');
      return Response.json(await transcribeAudio(audio, language as 'auto' | 'pa' | 'hi' | 'en', backend(form.get('backend')), signal));
    }
    if (bytes.length > 4000) throw new Error('Speech request too large');
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const task = typeof body.taskId === 'string' ? await getTask(body.taskId) : null;
    if (!task?.result || ['cancelled', 'failed', 'queued', 'running'].includes(task.state)) throw new Error('No current task response to speak');
    const started = Date.now(); const audio = await synthesize(task.result, task.details.language, backend(body.backend), signal);
    await addStep(task.id, 'speech_synthesis', 'generated_not_yet_played', JSON.stringify({ backend: body.backend, elapsedMs: Date.now()-started, bytes: audio.length }));
    return new Response(audio as BodyInit, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Speech adapter failed' }, { status: 503 }); }
}
