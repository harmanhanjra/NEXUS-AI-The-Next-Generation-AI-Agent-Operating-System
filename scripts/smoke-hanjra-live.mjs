import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = 'http://127.0.0.1:3013';
const session = await fetch(base + '/api/hanjra/session');
const cookie = session.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Local session unavailable');
const headers = { cookie, origin: base, 'Content-Type': 'application/json' };
const report = { observedAt: new Date().toISOString(), scope: 'bounded live reads and explicitly local model response; no external writes', checks: [] };
const cases = [
  { name: 'career source and factual packet', command: 'Find five suitable jobs and prepare factual CV material', expected: 'awaiting_input' },
  { name: 'selected repository inventory', command: 'Inspect this repo', target: process.cwd(), expected: 'awaiting_input' },
  { name: 'selected public request review', command: 'Review an automation opportunity', target: 'https://github.com/debpalash/VoiceStudio/issues/2290', expected: 'completed' },
  { name: 'explicit local model', command: 'In one sentence, explain what a database index is.', expected: 'completed' },
];
for (const item of cases) {
  try {
    const started = Date.now();
    const response = await fetch(base + '/api/hanjra', { method: 'POST', headers, body: JSON.stringify({ operation: 'command', source: 'text', language: 'en', environment: 'live', idempotencyKey: crypto.randomUUID(), command: item.command, target: item.target }) });
    const submitted = await response.json(); if (!response.ok) throw new Error(submitted.error);
    let record;
    do {
      record = await fetch(base + '/api/hanjra?id=' + submitted.task.id, { headers }).then(r => r.json());
      if (!['running', 'queued'].includes(record.task.state)) break;
      await new Promise(r => setTimeout(r, 500));
    } while (Date.now() - started < 135000);
    const task = record.task;
    const passed = task.state === item.expected && task.details.evidence.length > 0;
    report.checks.push({ name: item.name, passed, elapsedMs: Date.now() - started, taskId: task.id, state: task.state, blocker: task.blocker, result: task.result, evidence: task.details.evidence, artifacts: task.details.artifacts, provider: task.details.provider, model: task.details.model, modelSteps: record.steps?.filter(s => s.kind === 'model') });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${item.name}: ${task.state}`);
  } catch (error) {
    report.checks.push({ name: item.name, passed: false, error: error.message });
    console.log(`FAIL ${item.name}: ${error.message}`);
  }
}
const root = resolve('artifacts', 'hanjra'); await mkdir(root, { recursive: true });
const path = resolve(root, 'live-acceptance_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
await writeFile(path, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log('Report: ' + path);
if (report.checks.some(c => !c.passed)) process.exitCode = 1;
