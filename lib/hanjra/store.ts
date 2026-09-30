import { createClient, type Client } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { POLICY_VERSION, type Evidence, type Language } from './contracts.ts';

export type TaskState = 'queued' | 'running' | 'awaiting_input' | 'awaiting_approval' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type HanjraTask = {
  id: string; command: string; source: 'text' | 'voice'; owner: string; state: TaskState;
  result: string | null; blocker: string | null; idempotencyKey: string;
  createdAt: number; updatedAt: number;
  details: TaskDetails;
};

export type TaskDetails = {
  target: string | null; priority: number; deadline: string | null; timezone: 'Asia/Kolkata';
  authorizedActions: string[]; policyVersion: string; acceptanceCriteria: string[];
  budget: { maxTokens: number; maxDurationMs: number }; cancellationRequested: boolean;
  language: Language; normalizedCommand: string; evidence: Evidence[]; artifacts: string[];
  originalTranscript: string | null; audioSessionId: string | null;
  environment: 'fixture' | 'live';
  provider: string | null; model: string | null; tokens: number; costUsd: number | null;
};

const globalStore = globalThis as typeof globalThis & { __hanjraDb?: Client; __hanjraSchema?: Promise<void> };

export function db(): Client {
  if (!globalStore.__hanjraDb) {
    const path = process.env.HANJRA_DATABASE_PATH || resolve(process.cwd(), 'data', 'hanjra.sqlite');
    mkdirSync(dirname(path), { recursive: true });
    globalStore.__hanjraDb = createClient({ url: `file:${path}` });
  }
  return globalStore.__hanjraDb;
}

export async function schema(): Promise<void> {
  if (!globalStore.__hanjraSchema) {
    globalStore.__hanjraSchema = db().batch([
      `CREATE TABLE IF NOT EXISTS hanjra_tasks (
        id TEXT PRIMARY KEY, command TEXT NOT NULL, source TEXT NOT NULL,
        owner TEXT NOT NULL, state TEXT NOT NULL, result TEXT, blocker TEXT,
        idempotency_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE TABLE IF NOT EXISTS hanjra_steps (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
        detail TEXT NOT NULL, created_at INTEGER NOT NULL,
        FOREIGN KEY(task_id) REFERENCES hanjra_tasks(id)
      )`,
      'CREATE INDEX IF NOT EXISTS hanjra_tasks_recent ON hanjra_tasks(created_at DESC)',
      'CREATE TABLE IF NOT EXISTS hanjra_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
      `CREATE TABLE IF NOT EXISTS hanjra_outbox (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, action TEXT NOT NULL, account TEXT NOT NULL,
        target TEXT NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE, environment TEXT NOT NULL, state TEXT NOT NULL,
        provider_id TEXT, evidence_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS hanjra_grants (
        id TEXT PRIMARY KEY, outbox_id TEXT NOT NULL, action TEXT NOT NULL, account TEXT NOT NULL,
        target TEXT NOT NULL, payload_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0, max_actions INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS hanjra_controls (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS hanjra_daily_budget (day TEXT PRIMARY KEY, reserved_microusd INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS hanjra_facts (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, value_json TEXT NOT NULL, source TEXT NOT NULL,
        verified_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`,
      { sql: 'INSERT OR IGNORE INTO hanjra_migrations VALUES (1,?)', args: [Date.now()] },
    ], 'write').then(() => undefined).catch((error) => { globalStore.__hanjraSchema = undefined; throw error; });
  }
  await globalStore.__hanjraSchema;
}

function task(row: Record<string, unknown>): HanjraTask {
  return {
    id: String(row.id), command: String(row.command), source: row.source === 'voice' ? 'voice' : 'text',
    owner: String(row.owner), state: row.state as TaskState, result: row.result == null ? null : String(row.result),
    blocker: row.blocker == null ? null : String(row.blocker), idempotencyKey: String(row.idempotency_key),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    details: JSON.parse(String(row.details_json || '{}')) as TaskDetails,
  };
}

export async function createTask(command: string, source: 'text' | 'voice', key: string, owner: string, input: Partial<TaskDetails> = {}): Promise<{ task: HanjraTask; replay: boolean }> {
  await schema();
  const now = Date.now();
  const id = crypto.randomUUID();
  const details: TaskDetails = {
    target: null, priority: 3, deadline: null, timezone: 'Asia/Kolkata', authorizedActions: ['read', 'prepare'],
    policyVersion: POLICY_VERSION, acceptanceCriteria: ['Actual evidence and artifact readback'],
    budget: { maxTokens: 1600, maxDurationMs: 120000 }, cancellationRequested: false,
    language: 'en', normalizedCommand: command, evidence: [], artifacts: [], provider: null, model: null,
    tokens: 0, costUsd: 0, originalTranscript: null, audioSessionId: null, environment: 'live', ...input,
  };
  const result = await db().execute({
    sql: `INSERT INTO hanjra_tasks (id,command,source,owner,state,idempotency_key,created_at,updated_at,details_json)
      VALUES (?,?,?,?,'queued',?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
    args: [id, command, source, owner, key, now, now, JSON.stringify(details)],
  });
  const selected = await db().execute({ sql: 'SELECT * FROM hanjra_tasks WHERE idempotency_key=?', args: [key] });
  const stored = task(selected.rows[0] as Record<string, unknown>);
  if (stored.command !== command || stored.source !== source || stored.details.target !== details.target || stored.details.language !== details.language || stored.details.environment !== details.environment) throw new Error('Idempotency key already belongs to a different command');
  return { task: stored, replay: result.rowsAffected === 0 };
}

export async function updateTask(id: string, state: TaskState, result: string | null, blocker: string | null): Promise<HanjraTask | null> {
  await schema();
  await db().execute({
    sql: `UPDATE hanjra_tasks SET state=?,result=?,blocker=?,updated_at=?
      WHERE id=? AND state NOT IN ('completed','failed','cancelled')`,
    args: [state, result, blocker, Date.now(), id],
  });
  return getTask(id);
}

export async function getTask(id: string): Promise<HanjraTask | null> {
  await schema();
  const result = await db().execute({ sql: 'SELECT * FROM hanjra_tasks WHERE id=?', args: [id] });
  return result.rows[0] ? task(result.rows[0] as Record<string, unknown>) : null;
}

export async function listTasks(): Promise<HanjraTask[]> {
  await schema();
  const result = await db().execute('SELECT * FROM hanjra_tasks ORDER BY created_at DESC LIMIT 50');
  return result.rows.map((row) => task(row as Record<string, unknown>));
}

export async function addStep(taskId: string, kind: string, status: string, detail: string): Promise<void> {
  await schema();
  await db().execute({
    sql: 'INSERT INTO hanjra_steps (id,task_id,kind,status,detail,created_at) VALUES (?,?,?,?,?,?)',
    args: [crypto.randomUUID(), taskId, kind, status, detail, Date.now()],
  });
}

export async function saveDetails(id: string, details: TaskDetails): Promise<void> {
  await schema();
  await db().execute({ sql: 'UPDATE hanjra_tasks SET details_json=?,updated_at=? WHERE id=? AND state NOT IN (\'cancelled\',\'failed\',\'completed\')', args: [JSON.stringify(details), Date.now(), id] });
}

export async function claimTask(id: string): Promise<boolean> {
  await schema();
  const result = await db().execute({ sql: "UPDATE hanjra_tasks SET state='running',updated_at=? WHERE id=? AND state='queued'", args: [Date.now(), id] });
  return result.rowsAffected === 1;
}

export async function cancelTask(id: string): Promise<HanjraTask | null> {
  const existing = await getTask(id);
  if (!existing || ['completed', 'failed', 'cancelled'].includes(existing.state)) return existing;
  await saveDetails(id, { ...existing.details, cancellationRequested: true });
  return updateTask(id, 'cancelled', 'Task cancelled. Late results will be discarded.', null);
}

export async function recoverTasks(): Promise<void> {
  await schema();
  // A crashed operation may have taken effect. Preserve evidence and never blindly repeat it.
  await db().execute("UPDATE hanjra_tasks SET state='blocked',blocker='restart_reconciliation_required' WHERE state='running'");
  await db().execute("UPDATE hanjra_outbox SET state='reconciling' WHERE state='sending'");
}

export async function stepsFor(id: string) {
  await schema();
  return (await db().execute({ sql: 'SELECT kind,status,detail,created_at FROM hanjra_steps WHERE task_id=? ORDER BY created_at', args: [id] })).rows;
}

export async function control(key: string, value?: string): Promise<string | null> {
  await schema();
  if (value !== undefined) await db().execute({ sql: 'INSERT INTO hanjra_controls VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', args: [key, value] });
  const result = await db().execute({ sql: 'SELECT value FROM hanjra_controls WHERE key=?', args: [key] });
  return result.rows[0] ? String(result.rows[0].value) : null;
}

export async function reserveSpend(day: string, amount: number, limit: number): Promise<boolean> {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(limit) || limit < 0 || amount > limit) return false;
  await schema();
  const result = await db().execute({
    sql: `INSERT INTO hanjra_daily_budget VALUES (?,?) ON CONFLICT(day) DO UPDATE
      SET reserved_microusd=reserved_microusd+excluded.reserved_microusd
      WHERE reserved_microusd+excluded.reserved_microusd<=? RETURNING reserved_microusd`,
    args: [day, amount, limit],
  });
  return amount <= limit && result.rows.length === 1;
}
