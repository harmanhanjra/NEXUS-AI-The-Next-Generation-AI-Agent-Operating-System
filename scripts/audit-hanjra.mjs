import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const home = process.env.USERPROFILE;
const python = process.env.HANJRA_PYTHON || 'python';
const callPython = (input) => {
  const run = spawnSync(python, [resolve('scripts/hanjra-local.py')], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 20000 });
  try { return { exitCode: run.status, ...JSON.parse(run.stdout) }; } catch { return { exitCode: run.status, blocker: 'local_python_adapter' }; }
};
const voices = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/hanjra-sapi.ps1')], { input: JSON.stringify({ mode: 'health' }), encoding: 'utf8', windowsHide: true, timeout: 15000 });
let voiceHealth; try { voiceHealth = JSON.parse(voices.stdout); } catch { voiceHealth = { blocker: 'windows_sapi', exitCode: voices.status }; }
const names = ['n8n-automation-os', 'career-ops', 'NEXUS-AI-The-Next-Generation-AI-Agent-Operating-System', 'agentic-trading-os', 'BAAG-Originals-Store', 'job-application-pipeline', 'growth-agent-local', 'revenue-partner', 'scalecraft-outreach', 'scalecraft-scorer', 'scalecraft-auditor'];
const inventory = [];
for (const name of names) {
  const root = join(home, name);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const readmes = entries.filter((e) => /^readme/i.test(e.name)).map((e) => e.name);
    const docs = [];
    for (const filename of readmes) {
      const content = await readFile(join(root, filename)); docs.push({ file: filename, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length });
    }
    inventory.push({ root, exists: true, topLevelFiles: entries.filter((e) => e.isFile() && !e.name.startsWith('.env')).map((e) => e.name), docs,
      capabilityScope: 'file inventory only; no runtime or external-write certification' });
  } catch { inventory.push({ root, exists: false }); }
}
const databases = [resolve(home, 'n8n-automation-os', '.n8n', '.n8n', 'database.sqlite'), resolve(home, '.n8n', 'database.sqlite')];
const n8n = [];
for (const database of databases) { try { await stat(database); n8n.push(callPython({ mode: 'n8n-audit', database })); } catch {} }
const services = {};
for (const [name, url] of Object.entries({ voicestudio: 'http://127.0.0.1:3900/.well-known/voicestudio-speech', speechSidecar: 'http://127.0.0.1:3902/.well-known/voicestudio-speech', ollama: 'http://127.0.0.1:11434/api/tags', n8n: 'http://127.0.0.1:5678/healthz' })) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'error' }); services[name] = { httpStatus: response.status, available: response.ok }; if (name === 'ollama' && response.ok) services[name].models = (await response.json()).models?.map((m) => m.name); }
  catch { services[name] = { available: false }; }
}
const report = {
  observedAt: new Date().toISOString(), timezone: 'Asia/Kolkata', scope: 'bounded read-only current audit', inventory, n8n, services,
  speech: { cachedLocal: callPython({ mode: 'speech-health' }), windows: voiceHealth,
    voiceStudioAuditedCommit: '0834c8be28460fc4e0518bdb31eb57c494b253b2', latestReleaseObserved: 'v0.5.6', installedVoiceStudioVersion: null,
    sources: ['https://github.com/debpalash/VoiceStudio/releases/tag/v0.5.6', 'https://github.com/debpalash/VoiceStudio/blob/0834c8be28460fc4e0518bdb31eb57c494b253b2/docs/speech-platform.md', 'https://github.com/debpalash/VoiceStudio/blob/0834c8be28460fc4e0518bdb31eb57c494b253b2/LICENSE-NOTICE.md'],
    selectionReason: 'Reuse already installed faster-whisper and cached CPU model while VoiceStudio is disconnected; no duplicate speech service or downloads',
    licensing: 'VoiceStudio is an optional unbundled AGPL service; model licenses are separate. No commercial distribution audit or legal eligibility conclusion.' },
  configuredCredentials: { nvidia: Boolean(process.env.NVIDIA_API_KEY), compatible: Boolean(process.env.OPENAI_API_KEY) },
  staleCareerFacts: ['Berlin, Germany', 'EU Work Authorization'], careerEligibilityRevalidated: false,
  rollback: { baseline: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout.trim(), branch: 'codex/hanjra-command-os', strategy: 'Review the Git diff; revert only Hanjra changes. New operational SQLite is isolated; existing databases/workflows were not migrated or activated.' },
  unverified: ['scheduled natural firing', 'email/calendar credentials', 'desktop GUI', 'live outbound writes', 'application submission', 'voice language quality', 'commercial speech redistribution'],
};
const dir = resolve('artifacts', 'hanjra'); await mkdir(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const name = `reuse-audit_${stamp}.json`;
await writeFile(join(dir, name), JSON.stringify(report, null, 2), { flag: 'wx' });
const reportDir = join(home, '.n8n-files', 'Agent Reports');
try { await stat(reportDir); await writeFile(join(reportDir, `hanjra_${name}`), JSON.stringify(report, null, 2), { flag: 'wx' }); } catch {}
console.log(JSON.stringify({ report: join(dir, name), services, cachedLocal: report.speech.cachedLocal, windows: voiceHealth, workflowDatabases: n8n.map((n) => ({ database: n.database, active: n.workflows?.filter((w) => w.active), count: n.workflows?.length, blocker: n.blocker })) }, null, 2));
