import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { pythonAdapter } from './local-process.ts';
import { redact, type Evidence } from './contracts.ts';
import type { HanjraTask, TaskState } from './store.ts';

export type AdapterResult = { state: TaskState; summary: string; blocker: string | null; evidence: Evidence[]; artifacts: string[] };
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const observedAt = () => new Date().toISOString();
const HOME = process.env.USERPROFILE || process.cwd();
export const careerRoot = () => process.env.HANJRA_CAREER_ROOT || resolve(HOME, 'career-ops');
export const automationRoot = () => process.env.HANJRA_AUTOMATION_ROOT || resolve(HOME, 'n8n-automation-os');
const skip = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.venv', 'venv', '__pycache__', 'data', '.cache']);

export async function selectedPath(input: string): Promise<string> {
  const roots = (process.env.HANJRA_ALLOWED_ROOTS || [process.cwd(), careerRoot(), automationRoot(), resolve(HOME, 'agentic-trading-os'), resolve(HOME, 'BAAG-Originals-Store')].join(';')).split(';').filter(Boolean);
  const target = await realpath(resolve(input));
  for (const root of roots) {
    try {
      const rel = relative(await realpath(root), target);
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return target;
    } catch { /* Disconnected configured roots are unavailable. */ }
  }
  throw new Error('Selected target is outside configured filesystem roots');
}

export async function artifact(taskId: string, name: string, content: string): Promise<{ path: string; evidence: Evidence }> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId) || !/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Invalid artifact path');
  const dir = resolve(process.cwd(), 'data', 'hanjra-artifacts', taskId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  const safe = redact(content);
  await writeFile(path, safe, { encoding: 'utf8', flag: 'wx' });
  if (await readFile(path, 'utf8') !== safe) throw new Error('Artifact readback failed');
  return { path, evidence: { source: path, observedAt: observedAt(), sha256: sha256(safe), scope: 'write_readback' } };
}

export async function publicJson(url: string, signal: AbortSignal, maxBytes = 2000000): Promise<{ value: any; evidence: Evidence }> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 8000000) throw new Error('Invalid public source size bound');
  const target = new URL(url);
  if (target.protocol !== 'https:' || !['www.arbeitnow.com', 'api.github.com'].includes(target.hostname) || target.username || target.password || target.port) throw new Error('Unsupported public source');
  const response = await fetch(target, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), redirect: 'error', headers: { 'Accept': 'application/json', 'User-Agent': 'Hanjra-local-review' } });
  if (!response.ok) throw new Error(`Public source returned HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty public source');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > maxBytes) { await reader.cancel(); throw new Error('Public source size limit exceeded'); }
    chunks.push(chunk.value);
  }
  const bytes = Buffer.concat(chunks);
  return { value: JSON.parse(bytes.toString('utf8')), evidence: { source: target.href, observedAt: observedAt(), sha256: sha256(bytes), scope: 'live_read' } };
}

export async function prepareCareer(task: HanjraTask, signal: AbortSignal): Promise<AdapterResult> {
  const source = await publicJson('https://www.arbeitnow.com/api/job-board-api', signal, 8000000);
  if (!Array.isArray(source.value.data)) throw new Error('Arbeitnow contract mismatch');
  const seen = new Set<string>();
  const jobs = source.value.data.filter((j: any) => {
    if (typeof j.url !== 'string' || typeof j.title !== 'string' || !/^https:\/\/(www\.)?arbeitnow\.com\/jobs\/companies\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+\/?$/.test(j.url) || seen.has(j.url)) return false;
    seen.add(j.url); return true;
  }).slice(0, 25).map((j: any) => ({ title: j.title, url: j.url, company: j.company_name || null,
    location: j.location || null, tags: Array.isArray(j.tags) ? j.tags : [], description: String(j.description || '').slice(0, 16000),
    listedAt: Number.isFinite(j.created_at) ? new Date(j.created_at * 1000).toISOString() : null, availability: 'listed_in_current_api_not_detail_verified' }));
  const review = await pythonAdapter({ mode: 'career', careerRoot: careerRoot(), automationRoot: automationRoot(), jobs }, signal);
  const content = [
    '# Career review — eligibility confirmation required',
    review.eligibilityBlocker, 'Ranking: 2 points per supported skill plus evidence-unit skill overlap. This is relevance, not eligibility.',
    ...review.matches.map((m: any, i: number) => `\n## ${i + 1}. ${m.job.title}\nSource: ${m.job.url}\nLocation: ${m.job.location}\nAvailability: ${m.job.availability}\nEvidence relevance: ${m.rankingScore}\nSupported skills: ${m.skills.map((s: any) => s.keyword).join(', ')}\nGaps: ${m.unsupportedTags.join(', ')}`),
    '\n# Factual CV material for the top two — review only',
    ...review.matches.slice(0, 2).map((m: any) => `\n## ${m.job.title}\n${m.units.slice(0, 6).map((u: any) => `- ${u.exact_fact}\n  Source: ${u.fact_ref}`).join('\n') || 'Insufficient supporting experience evidence; no tailored claims prepared.'}`),
    '\nNo location, authorization, salary, credentials, or undocumented metrics were added. No application was submitted.',
  ].join('\n\n');
  const saved = await artifact(task.id, 'career-review.md', content);
  const evidence: Evidence[] = [source.evidence, { source: review.profileSource, sha256: review.profileSha256, observedAt: observedAt(), scope: 'local_read' }, saved.evidence];
  return { state: 'awaiting_input', summary: `Reviewed ${jobs.length} public API candidates and prepared ${review.matches.length} evidence-ranked entries with factual CV material for up to two. Confirm current location and work authorization before tailoring.`, blocker: 'current_location_and_work_authorization', evidence, artifacts: [saved.path] };
}

export async function prepareOpportunity(task: HanjraTask, signal: AbortSignal): Promise<AdapterResult> {
  const target = task.details.target;
  const match = target?.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/);
  if (!match) return { state: 'awaiting_input', summary: 'Select a public GitHub issue containing a direct paid automation request or bounty. Other discovery sources are not connected.', blocker: 'selected_public_request_url', evidence: [], artifacts: [] };
  const source = await publicJson(`https://api.github.com/repos/${match[1]}/${match[2]}/issues/${match[3]}`, signal);
  const issue = source.value;
  if (typeof issue.body !== 'string' || typeof issue.title !== 'string' || !['open', 'closed'].includes(issue.state)) throw new Error('GitHub issue contract mismatch');
  const emails = [...new Set<string>(issue.body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  const budgetEvidence = issue.body.match(/\b(?:budget|bounty|reward|paid)\b[^\n]{0,100}/gi) || [];
  const directRequest = /\b(need|looking for|help|request|build|implement|automate|bounty)\b/i.test(issue.title + ' ' + issue.body);
  const score = (issue.state === 'open' ? 25 : 0) + (directRequest ? 25 : 0) + (budgetEvidence.length ? 20 : 0) + (emails.length === 1 ? 10 : 0);
  const draft = `Hello,\n\nI read your request “${issue.title}” (${target}). I would like to clarify the scope, acceptance criteria, budget, and delivery timeline before proposing a small pilot.\n\nIs this request still accepting help?\n\nBest,\nHarmanpreet`;
  const contact = emails.length === 1 ? emails[0] : null;
  const report = { source: target, observedAt: source.evidence.observedAt, state: issue.state, directRequest,
    advertisedBudgetEvidence: budgetEvidence, earnedRevenue: null, competition: null, fit: 'not_verified', effort: 'not_estimated',
    score, rankingRule: 'Open +25; direct request +25; budget statement +20; one published address +10; maximum 80',
    contact: contact ? { address: contact, provenance: target, excerpt: issue.body.split('\n').find((line: string) => line.includes(contact)) } : null,
    nextAction: issue.state === 'open' ? 'Review contact provenance and request suitability; confirm budget before outreach' : 'Closed request; do not pursue',
    draft: issue.state === 'open' && directRequest ? draft : null, sendAuthorized: false };
  const saved = await artifact(task.id, 'opportunity-review.json', JSON.stringify(report, null, 2));
  return { state: 'completed', summary: `Prepared a source-backed review of one ${issue.state} request${report.draft ? ' and a review-only outreach draft signed Harmanpreet' : ''}. ${contact ? 'A published address was recorded with provenance.' : 'No unique published contact was established.'} ${budgetEvidence.length ? 'Source budget statements are unverified advertised evidence.' : 'No budget evidence was found.'} Earned revenue is unknown.${issue.state === 'closed' ? ' Closed request; do not pursue.' : ''}`, blocker: null, evidence: [source.evidence, saved.evidence], artifacts: [saved.path] };
}

async function gitRead(path: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((res, reject) => {
    const child = spawn('git', ['-C', path, ...args], { windowsHide: true, shell: false });
    let output = ''; const stop = () => { child.kill(); reject(new Error('Repository inspection cancelled')); };
    signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 100000) child.kill(); });
    child.stderr.resume(); child.on('error', reject);
    child.on('close', (code) => { signal.removeEventListener('abort', stop); code ? reject(new Error('Git repository unavailable')) : res(redact(output)); });
  });
}

export async function inspectRepository(task: HanjraTask, signal: AbortSignal): Promise<AdapterResult> {
  if (!task.details.target) return { state: 'awaiting_input', summary: 'Select the repository and provide the failing behavior or acceptance criterion.', blocker: 'selected_repository_and_reproduction', evidence: [], artifacts: [] };
  const target = await selectedPath(task.details.target);
  if (!(await stat(target)).isDirectory()) throw new Error('Selected repository must be a directory');
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5 || files.length >= 200) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      signal.throwIfAborted();
      if (skip.has(entry.name) || entry.name.startsWith('.env') || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(join(dir, entry.name), depth + 1);
      else if (/\.(ts|tsx|js|mjs|py|md|json|yaml|toml)$/.test(entry.name)) files.push(relative(target, join(dir, entry.name)));
      if (files.length >= 200) return;
    }
  }
  await walk(target, 0);
  let status = 'Git status unavailable'; let diff = '';
  try { status = await gitRead(target, ['status', '--short'], signal); diff = await gitRead(target, ['diff', '--stat'], signal); } catch { /* Report named missing Git boundary. */ }
  const saved = await artifact(task.id, 'repository-review.json', JSON.stringify({ target, boundedFiles: files, truncated: files.length === 200,
    gitStatus: status, existingDiff: diff, codeExecuted: false, sourceChanged: false,
    nextAction: 'Provide reproduction and a bounded fix; arbitrary repository commands are not an installed tool' }, null, 2));
  return { state: 'awaiting_input', summary: `Inspected ${files.length} source paths and recorded the existing Git diff. A bug reproduction and a verified repository execution adapter are needed for a fix.`, blocker: 'bug_reproduction_and_code_execution_adapter', evidence: [saved.evidence], artifacts: [saved.path] };
}

export async function explainLocalArchitecture(task: HanjraTask): Promise<AdapterResult> {
  const path = resolve(process.cwd(), 'README.md'); const text = await readFile(path, 'utf8');
  const evidence: Evidence = { source: path, observedAt: observedAt(), sha256: sha256(text), scope: 'local_read' };
  const summary = task.details.language === 'pa'
    ? 'NEXUS ਵਿੱਚ Next.js ਅਤੇ React UI ਹਨ। API ਮਾਡਲ ਨਾਲ ਗੱਲ ਕਰਦੀ ਹੈ, ਅਤੇ SQLite ਦਸਤਾਵੇਜ਼ ਸੰਭਾਲਦਾ ਹੈ। Hanjra commands ਅਤੇ task history ਸਥਾਨਕ SQLite ਵਿੱਚ ਸੰਭਾਲਦਾ ਹੈ। Email ਅਤੇ desktop GUI adapters ਹਾਲੇ connected ਨਹੀਂ ਹਨ।'
    : task.details.language === 'hi'
      ? 'NEXUS में Next.js और React UI हैं। API मॉडल से बात करती है और SQLite दस्तावेज़ रखता है। Hanjra commands और task history स्थानीय SQLite में रखता है। Email और desktop GUI adapters अभी connected नहीं हैं।'
      : 'NEXUS uses Next.js and React for its UI, an existing bounded model transport for chat, and SQLite for documents. Hanjra adds durable local commands, evidence, cancellation, and explicit speech adapters. Email and desktop GUI execution are not connected.';
  return { state: 'completed', summary, blocker: null, evidence: [evidence], artifacts: [] };
}
