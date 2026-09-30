import { cpus, totalmem, freemem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { db, schema, listTasks, stepsFor, getTask } from './store.ts';
import { AGENT_CONTRACTS, redact } from './contracts.ts';
import { predictOwner, evaluateRouter, searchMemory, type Example, type MemoryNote } from './learning.ts';

let initialization: Promise<void> | undefined;
async function intelligenceSchema() {
  await schema();
  initialization ||= db().batch([
    'CREATE TABLE IF NOT EXISTS hanjra_memory (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS hanjra_feedback (task_id TEXT PRIMARY KEY, query TEXT NOT NULL, owner TEXT NOT NULL, helpful INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  ], 'write').then(() => undefined).catch(error => { initialization = undefined; throw error; });
  await initialization;
}
export async function memoryNotes(): Promise<MemoryNote[]> {
  await intelligenceSchema();
  return (await db().execute('SELECT * FROM hanjra_memory ORDER BY updated_at DESC LIMIT 200')).rows.map(r => ({ id:String(r.id), title:String(r.title), content:String(r.content), archived:!!r.archived, updatedAt:Number(r.updated_at) }));
}
export async function putMemory(title: string, content: string) {
  await intelligenceSchema();
  if (!title.trim() || title.length > 120 || !content.trim() || content.length > 4000) throw new Error('Memory needs a title (1–120 characters) and content (1–4000 characters)');
  const count = (await db().execute('SELECT COUNT(*) AS count FROM hanjra_memory')).rows[0];
  if (Number(count.count) >= 200) throw new Error('Memory capacity reached (200 notes)');
  const note: MemoryNote = { id:crypto.randomUUID(),title:redact(title.trim()),content:redact(content.trim()),archived:false,updatedAt:Date.now() };
  await db().execute({sql:'INSERT INTO hanjra_memory VALUES (?,?,?,0,?)',args:[note.id,note.title,note.content,note.updatedAt]});
  return note;
}
export async function archiveMemory(id: string, archived: boolean) {
  await intelligenceSchema();
  await db().execute({sql:'UPDATE hanjra_memory SET archived=?,updated_at=? WHERE id=?',args:[archived?1:0,Date.now(),id]});
}
export async function reviewedExamples(): Promise<Example[]> {
  await intelligenceSchema();
  const result = await db().execute('SELECT query,owner FROM hanjra_feedback WHERE helpful=1 ORDER BY updated_at ASC LIMIT 200');
  return result.rows.map(r => ({query:String(r.query),owner:String(r.owner)}));
}
export async function feedback(taskId: string, owner: string, helpful: boolean) {
  await intelligenceSchema(); const task = await getTask(taskId);
  if (!task || task.state !== 'completed' || task.details.environment !== 'live') throw new Error('Review a completed live task');
  if (!AGENT_CONTRACTS.some(a => a.id === owner)) throw new Error('Unknown specialist');
  await db().execute({sql:'INSERT INTO hanjra_feedback VALUES (?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET owner=excluded.owner,helpful=excluded.helpful,updated_at=excluded.updated_at',args:[taskId,task.command,owner,helpful?1:0,Date.now()]});
}
export async function localContext(query: string) { return searchMemory(query,await memoryNotes(),3); }
export async function learnedOwner(query: string) { return predictOwner(query,await reviewedExamples()); }

export type IntelligenceSnapshot = Awaited<ReturnType<typeof intelligenceSnapshot>>;
export async function intelligenceSnapshot(query = '') {
  const [notes,examples,tasks] = await Promise.all([memoryNotes(),reviewedExamples(),listTasks()]);
  const feedbackRows = (await db().execute('SELECT task_id,owner,helpful FROM hanjra_feedback')).rows;
  const completed = tasks.filter(t => t.state === 'completed');
  const durations = completed.map(t => t.updatedAt - t.createdAt).sort((a,b) => a-b);
  const traces = await Promise.all(tasks.slice(0,30).map(async task => {
    const steps = await stepsFor(task.id); let firstTokenMs: number|null = null, inferenceMs: number|null = null;
    for (const step of steps) if (step.kind === 'model' && step.status === 'returned') {
      try { const data = JSON.parse(String(step.detail)); firstTokenMs = data.firstTokenMs ?? null; inferenceMs = data.totalMs ?? null; } catch { /* legacy trace */ }
    }
    return {id:task.id,command:task.command,owner:task.owner,state:task.state,createdAt:task.createdAt,
      durationMs:['completed','failed','cancelled','blocked','awaiting_input','awaiting_approval'].includes(task.state) ? task.updatedAt-task.createdAt : null,
      tokens:task.details.tokens,model:task.details.model,firstTokenMs,inferenceMs,
      steps:steps.map(s => ({kind:String(s.kind),status:String(s.status),detail:redact(String(s.detail)),at:Number(s.created_at)}))};
  }));
  let installed: Array<{name:string;bytes:number;family:string;parameters:string;quantization:string}> = [], engineStatus = 'unavailable';
  // Fixed loopback URL: a browser cannot use this endpoint as a general network proxy.
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(2500),redirect:'error'});
    if (response.ok) { const body = await response.json(); installed = (body.models || []).slice(0,30).map((m: any) => ({name:String(m.name),bytes:Number(m.size)||0,family:String(m.details?.family||''),parameters:String(m.details?.parameter_size||''),quantization:String(m.details?.quantization_level||'')})); engineStatus='connected'; }
  } catch { /* Report unavailable; never install or silently send to cloud. */ }
  let diskAvailableBytes: number|null = null;
  try { const disk = await statfs(process.cwd()); diskAvailableBytes = disk.bavail * disk.bsize; } catch { /* unsupported filesystem */ }
  return { notes, matches:query ? searchMemory(query,notes) : [], learning:{...evaluateRouter(examples),algorithm:'Multinomial Naive Bayes',prediction:query?predictOwner(query,examples):null},
    feedback:feedbackRows.map(r => ({taskId:String(r.task_id),owner:String(r.owner),helpful:!!r.helpful})),
    traces,metrics:{window:tasks.length,completed:completed.length,tokens:tasks.reduce((sum,t) => sum+t.details.tokens,0),medianDurationMs:durations.length?durations[Math.floor(durations.length/2)]:null,
      knownCostUsd:tasks.reduce((sum,t) => sum+(t.details.costUsd||0),0),unknownCosts:tasks.filter(t=>t.details.costUsd===null).length,energyJoules:null},
    engine:{status:engineStatus,installed},hardware:{cpu:cpus()[0]?.model||'Unknown',threads:cpus().length,memoryBytes:totalmem(),availableMemoryBytes:freemem(),diskAvailableBytes},
    memoryBackend:'SQLite + BM25',observedAt:new Date().toISOString() };
}
