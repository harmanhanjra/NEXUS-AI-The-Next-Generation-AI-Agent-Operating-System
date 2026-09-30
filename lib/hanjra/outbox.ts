import { createHash } from 'node:crypto';
import { db, schema, getTask } from './store.ts';
import type { Evidence } from './contracts.ts';

export type Outbox = {
  id: string; taskId: string; action: string; account: string; target: string; payload: string;
  payloadHash: string; idempotencyKey: string; environment: 'fixture' | 'live'; state: string;
  providerId: string | null; evidence: Evidence[];
};
export type SendAdapter = {
  environment: 'fixture' | 'live';
  send(item: Outbox, signal: AbortSignal): Promise<{ providerId: string }>;
  reconcile(item: Outbox, signal: AbortSignal): Promise<{ status: 'confirmed' | 'absent' | 'unknown'; providerId?: string; evidence?: Evidence[] }>;
};
export function hashPayload(payload: string): string { return createHash('sha256').update(payload).digest('hex'); }

export async function prepareOutbox(item: Omit<Outbox, 'id' | 'payloadHash' | 'state' | 'providerId'>): Promise<Outbox> {
  await schema();
  const id = crypto.randomUUID();
  await db().execute({
    sql: `INSERT INTO hanjra_outbox (id,task_id,action,account,target,payload_json,payload_hash,idempotency_key,environment,state,evidence_json,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'prepared',?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
    args: [id, item.taskId, item.action, item.account, item.target, item.payload, hashPayload(item.payload), item.idempotencyKey, item.environment, JSON.stringify(item.evidence), Date.now()],
  });
  const rows = (await db().execute({ sql: 'SELECT id FROM hanjra_outbox WHERE idempotency_key=?', args: [item.idempotencyKey] })).rows;
  const stored = (await getOutbox(String(rows[0].id)))!;
  if (stored.payloadHash !== hashPayload(item.payload) || stored.target !== item.target || stored.account !== item.account || stored.action !== item.action || stored.environment !== item.environment) throw new Error('Outbox key conflict');
  return stored;
}

export async function getOutbox(id: string): Promise<Outbox | null> {
  await schema();
  const row = (await db().execute({ sql: 'SELECT * FROM hanjra_outbox WHERE id=?', args: [id] })).rows[0];
  return row ? { id: String(row.id), taskId: String(row.task_id), action: String(row.action), account: String(row.account),
    target: String(row.target), payload: String(row.payload_json), payloadHash: String(row.payload_hash), idempotencyKey: String(row.idempotency_key),
    environment: row.environment as Outbox['environment'], state: String(row.state), providerId: row.provider_id == null ? null : String(row.provider_id),
    evidence: JSON.parse(String(row.evidence_json)) as Evidence[] } : null;
}

// Called only by an authenticated human review handler; model/voice output is not a grant.
export async function grantExactAction(id: string, payloadHash: string, expiresAt: number, source: 'authenticated_text' | 'voice'): Promise<string> {
  if (source !== 'authenticated_text') throw new Error('Sensitive confirmations require authenticated text review');
  const item = await getOutbox(id);
  if (!item || item.payloadHash !== payloadHash || expiresAt <= Date.now() || expiresAt > Date.now() + 3600000) throw new Error('Invalid action scope or expiry');
  const grantId = crypto.randomUUID();
  await db().execute({ sql: 'INSERT INTO hanjra_grants (id,outbox_id,action,account,target,payload_hash,expires_at) VALUES (?,?,?,?,?,?,?)',
    args: [grantId, id, item.action, item.account, item.target, item.payloadHash, expiresAt] });
  return grantId;
}

export async function revokeGrant(id: string): Promise<void> {
  await schema(); await db().execute({ sql: 'UPDATE hanjra_grants SET revoked=1 WHERE id=?', args: [id] });
}

async function reconcile(item: Outbox, adapter: SendAdapter, signal: AbortSignal): Promise<Outbox> {
  const result = await adapter.reconcile(item, signal);
  // A receipt is authoritative only when the provider supplies a stable identity and evidence.
  const state = result.status === 'confirmed' && result.providerId && result.evidence?.length ? 'verified'
    : result.status === 'absent' ? 'prepared' : 'reconciling';
  await db().execute({ sql: 'UPDATE hanjra_outbox SET state=?,provider_id=?,evidence_json=?,updated_at=? WHERE id=?',
    args: [state, result.providerId || item.providerId, JSON.stringify(result.evidence || item.evidence), Date.now(), item.id] });
  return (await getOutbox(item.id))!;
}

export async function executeOutbox(id: string, adapter: SendAdapter, signal: AbortSignal): Promise<Outbox> {
  const item = await getOutbox(id);
  if (!item) throw new Error('Outbox item not found');
  if (item.environment !== adapter.environment) throw new Error('Fixture/live boundary denied');
  if ((await getTask(item.taskId))?.state === 'cancelled' || signal.aborted) throw new Error('Task cancelled');
  if (item.state === 'verified' || item.state === 'sending') return item;
  if (item.state === 'reconciling' || item.state === 'provider_confirmed') return reconcile(item, adapter, signal);
  const grant = (await db().execute({ sql: `SELECT id FROM hanjra_grants WHERE outbox_id=? AND action=? AND account=?
    AND target=? AND payload_hash=? AND expires_at>? AND revoked=0 AND max_actions=1`,
    args: [id, item.action, item.account, item.target, item.payloadHash, Date.now()] })).rows[0];
  if (!grant) throw new Error('Scope-specific authorization missing');
  if (!item.evidence.length || (item.environment === 'live' && item.evidence.some((e) => e.scope === 'fixture'))) throw new Error('Contact provenance missing or fixture evidence on live route');
  const claim = await db().execute({ sql: "UPDATE hanjra_outbox SET state='sending',updated_at=? WHERE id=? AND state='prepared'", args: [Date.now(), id] });
  if (claim.rowsAffected !== 1) return (await getOutbox(id))!;
  try {
    signal.throwIfAborted();
    const sent = await adapter.send(item, signal);
    await db().execute({ sql: "UPDATE hanjra_outbox SET state='provider_confirmed',provider_id=?,updated_at=? WHERE id=?", args: [sent.providerId, Date.now(), id] });
    return reconcile((await getOutbox(id))!, adapter, signal);
  } catch {
    // Cancellation after dispatch is also ambiguous. A send is never blindly repeated.
    await db().execute({ sql: "UPDATE hanjra_outbox SET state='reconciling',updated_at=? WHERE id=?", args: [Date.now(), id] });
    return (await getOutbox(id))!;
  }
}
