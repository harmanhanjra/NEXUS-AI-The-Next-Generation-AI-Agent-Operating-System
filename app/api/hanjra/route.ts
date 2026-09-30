import { readFile } from 'node:fs/promises';
import { authenticated, readBounded } from '@/lib/hanjra/auth';
import { AGENT_CONTRACTS, validateCommand } from '@/lib/hanjra/contracts';
import { boot, submitCommand, cancel, globalStop, resumeIntake, configuredModel } from '@/lib/hanjra/runtime';
import { listTasks, getTask, stepsFor, control, addStep } from '@/lib/hanjra/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!authenticated(req)) return Response.json({ error: 'Local authenticated session required' }, { status: 401 });
  await boot();
  const url = new URL(req.url); const id = url.searchParams.get('id');
  if (id) {
    const task = await getTask(id); if (!task) return Response.json({ error: 'Task not found' }, { status: 404 });
    const name = url.searchParams.get('artifact');
    if (name) {
      const path = task.details.artifacts.find((p) => p.replace(/\\/g, '/').split('/').at(-1) === name);
      if (!path) return Response.json({ error: 'Artifact not found' }, { status: 404 });
      return new Response(await readFile(path, 'utf8'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return Response.json({ task, steps: await stepsFor(id) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const model = configuredModel();
  return Response.json({ tasks: await listTasks(), agents: AGENT_CONTRACTS, stopped: await control('global_stop') === 'true',
    model: model ? { provider: model.provider.label, model: model.provider.model, textEgress: model.cloud ? model.provider.baseUrl : 'loopback only', fallback: 'same provider only' } : null,
    unavailable: ['email/calendar account adapters', 'live outbound send adapter', 'application submission', 'desktop GUI', 'generic repository mutation/execution', 'live broker orders', 'wake word', 'verified Punjabi/Hindi TTS'],
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!authenticated(req) || !req.headers.get('origin')) return Response.json({ error: 'Local authenticated same-origin session required' }, { status: 401 });
  try {
    const raw = JSON.parse(new TextDecoder().decode(await readBounded(req, 20000)));
    if (raw.operation === 'cancel' && typeof raw.taskId === 'string') return Response.json({ task: await cancel(raw.taskId) });
    if (raw.operation === 'stop') { await globalStop(); return Response.json({ stopped: true }); }
    if (raw.operation === 'resume') { await resumeIntake(); return Response.json({ stopped: false }); }
    if (raw.operation === 'playback' && typeof raw.taskId === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(raw.turnId || '')) {
      const task = await getTask(raw.taskId);
      if (!task || task.state === 'cancelled') return Response.json({ error: 'Stale or cancelled task' }, { status: 409 });
      await addStep(task.id, 'speech_playback', 'client_reported_ended', JSON.stringify({ turnId: raw.turnId, device: 'browser selected output', humanListeningVerified: false }));
      return Response.json({ recorded: true });
    }
    if (raw.operation !== 'command') throw new Error('Unknown operation');
    return Response.json(await submitCommand(validateCommand(raw)), { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Command failed' }, { status: 400 });
  }
}
