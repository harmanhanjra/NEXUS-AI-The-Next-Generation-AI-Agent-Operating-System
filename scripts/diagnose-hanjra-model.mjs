import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = 'http://127.0.0.1:11434';
const report = { observedAt: new Date().toISOString(), scope: 'explicit local model diagnostic; no cloud egress', trials: [] };
const shown = await fetch(base + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'qwen3.5:0.8b' }), signal: AbortSignal.timeout(10000) }).then(r => r.json());
report.model = { capabilities: shown.capabilities, parameters: shown.parameters, architecture: shown.model_info?.['general.architecture'] };
for (const [name, endpoint, body] of [
  ['native-no-thinking', '/api/chat', { model: 'qwen3.5:0.8b', stream: false, think: false, messages: [{ role: 'user', content: 'Say hello in one short sentence.' }], options: { num_predict: 48, num_ctx: 2048, num_thread: 2 } }],
  ['compatible-no-thinking', '/v1/chat/completions', { model: 'qwen3.5:0.8b', stream: false, reasoning_effort: 'none', max_tokens: 48, messages: [{ role: 'user', content: 'Say hello in one short sentence.' }] }],
]) {
  const start = Date.now();
  try {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const result = await response.json();
    report.trials.push({ name, status: response.status, elapsedMs: Date.now() - start, text: result.message?.content || result.choices?.[0]?.message?.content, loadMs: result.load_duration ? Math.round(result.load_duration / 1e6) : null, tokens: result.eval_count || result.usage?.completion_tokens, error: result.error });
  } catch (error) { report.trials.push({ name, elapsedMs: Date.now() - start, error: error.name }); }
  console.log(JSON.stringify(report.trials.at(-1)));
}
const root = resolve('artifacts', 'hanjra'); await mkdir(root, { recursive: true });
const path = resolve(root, 'model-diagnostic_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
await writeFile(path, JSON.stringify(report, null, 2), { flag: 'wx' }); console.log(path);
