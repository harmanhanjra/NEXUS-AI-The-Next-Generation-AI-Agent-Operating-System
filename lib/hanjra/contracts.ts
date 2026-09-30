export const POLICY_VERSION = 'hanjra-1';
export const AGENT_ROLES = [
  ['head', 'Hanjra', 'Command intake, task state, policy, cancellation, and one coherent response'],
  ['life', 'Personal Operations', 'Selected files, documents, daily plans, deadlines, and connected account triage'],
  ['career', 'Career', 'Reuse Career Ops facts for truthful review packets and eligibility questions'],
  ['business', 'Opportunity', 'Source-backed opportunities and transparent deterministic ranking'],
  ['sales', 'Sales and Client Success', 'Contact provenance, outreach drafts, suppression, outbox, delivery handoff'],
  ['coding', 'Software Engineer', 'Selected repository inspection, fixes, tests, and reviewable diffs'],
  ['reliability', 'Automation and Reliability', 'Adapter verification, permission enforcement, workflow QA, and health'],
  ['content', 'Content and Commerce', 'Evidence-backed drafts and BAAG previews with separate brand identities'],
  ['research', 'Research and Learning', 'Cited research, architecture explanations, and learning'],
  ['trading', 'Trading Research and Finance', 'Financial journaling, analysis, paper trading, and deterministic risk veto'],
] as const;

export const AGENT_CONTRACTS = AGENT_ROLES.map(([id, name, responsibilities]) => ({
  id, name, responsibilities,
  allowedTools: id === 'head' ? ['task_status', 'task_cancel', 'dispatch'] : ['read_selected_evidence', 'prepare_artifact'],
  forbiddenActions: ['recursive_delegation', 'permission_expansion', 'unverified_completion', 'live_trade', 'unapproved_external_write'],
  inputSchema: { taskId: 'uuid', command: 'string', evidence: 'source references', constraints: 'object', cancellation: 'AbortSignal' },
  outputSchema: { state: 'TaskState', summary: 'string', evidence: 'Evidence[]', artifacts: 'string[]', blocker: 'string|null' },
  budget: { maxTokens: 1600, maxDurationMs: 120000, maxRetries: 2 },
  handoffRules: 'Return structured evidence to Hanjra. Do not speak independently or spawn agents.',
  verification: 'Persist tool observations and artifact hashes. Model text alone is never proof of a tool action.',
}));

export type Language = 'pa' | 'hi' | 'en';
export type Intent = 'status' | 'plan' | 'career' | 'opportunity' | 'software' | 'research' | 'content' | 'trading' | 'send' | 'unknown';
export type Evidence = { source: string; observedAt: string; sha256?: string; scope: 'fixture' | 'live_read' | 'local_read' | 'write_readback' | 'model_response' };
export type CommandInput = {
  command: string; idempotencyKey: string; source: 'text' | 'voice';
  language: Language | 'auto'; target?: string;
  originalTranscript?: string; audioSessionId?: string;
  environment: 'fixture' | 'live';
};

export function languageOf(text: string, lock: Language | 'auto' = 'auto'): Language {
  if (lock !== 'auto') return lock;
  if (/\bin Punjabi\b|ਪੰਜਾਬੀ ਵਿੱਚ/i.test(text)) return 'pa';
  if (/\bin Hindi\b|हिन्दी में|हिंदी में/i.test(text)) return 'hi';
  if (/[\u0a00-\u0a7f]/.test(text)) return 'pa';
  if (/[\u0900-\u097f]/.test(text)) return 'hi';
  return 'en';
}

export function routeCommand(command: string): { intent: Intent; owner: string } {
  const rules: Array<[RegExp, Intent, string]> = [
    [/\b(send|submit|publish|deploy|purchase|buy|transfer|delete|place.{0,12}order)\b|भेजो|भेज दो|ਭੇਜ|ਖਰੀਦ|मिटाओ/i, 'send', 'sales'],
    [/\b(status|completed tasks|blockers|costs|task history)\b|ਸਥਿਤੀ|पूरा.*काम/i, 'status', 'head'],
    [/\b(plan.{0,15}(day|today)|daily brief)\b|ਦਿਨ.*ਪਲਾਨ|दिन.*प्लान/i, 'plan', 'life'],
    [/\b(jobs?|applications?|resume|cv|interview)\b|नौकरी|ਨੌਕਰੀ/i, 'career', 'career'],
    [/\b(leads?|opportunit|outreach|paid pilot|bount|grant)\w*\b/i, 'opportunity', 'business'],
    [/\b(repo|bug|fix|tests?|code|software|pull request)\b/i, 'software', 'coding'],
    [/\b(xauusd|trading|trade|backtest|paper|journal|invoice|expense)\b/i, 'trading', 'trading'],
    [/\b(baag|campaign|post|portfolio|content)\b/i, 'content', 'content'],
    [/\b(explain|research|learn|teach|architecture)\b|समझाओ|ਸਮਝਾ/i, 'research', 'research'],
  ];
  for (const [pattern, intent, owner] of rules) if (pattern.test(command)) return { intent, owner };
  return { intent: 'unknown', owner: 'head' };
}

export function redact(text: string): string {
  return text.replace(/\b(?:sk-|nvapi-|gh[pousr]_)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|password|access[_-]?token|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

export function validateCommand(value: unknown): CommandInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid command body');
  const v = value as Record<string, unknown>;
  if (typeof v.command !== 'string' || !v.command.trim() || v.command.length > 12000) throw new Error('Command must contain 1–12000 characters');
  if (typeof v.idempotencyKey !== 'string' || !/^[a-zA-Z0-9:_-]{8,160}$/.test(v.idempotencyKey)) throw new Error('Invalid idempotency key');
  if (v.source !== 'text' && v.source !== 'voice') throw new Error('Invalid command source');
  if (!['auto', 'pa', 'hi', 'en'].includes(String(v.language))) throw new Error('Invalid language');
  if (v.target !== undefined && (typeof v.target !== 'string' || v.target.length > 1000)) throw new Error('Invalid selected target');
  if (v.originalTranscript !== undefined && (typeof v.originalTranscript !== 'string' || v.originalTranscript.length > 12000)) throw new Error('Invalid original transcript');
  if (v.source === 'voice' && (typeof v.audioSessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.audioSessionId))) throw new Error('Final voice commands require an audio session ID');
  if (v.environment !== undefined && !['live', 'fixture'].includes(String(v.environment))) throw new Error('Invalid execution environment');
  // Browser input never supplies grants, tools, arbitrary models, or policy versions.
  return { command: redact(v.command.trim()), idempotencyKey: v.source === 'voice' ? `${v.audioSessionId}:final` : v.idempotencyKey,
    source: v.source, language: v.language as CommandInput['language'], target: v.target as string | undefined,
    originalTranscript: typeof v.originalTranscript === 'string' ? redact(v.originalTranscript) : undefined,
    audioSessionId: v.audioSessionId as string | undefined, environment: v.environment === 'fixture' ? 'fixture' : 'live' };
}
