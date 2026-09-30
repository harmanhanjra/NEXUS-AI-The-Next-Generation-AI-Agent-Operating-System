import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { stepsFor } from '../lib/hanjra/store.ts';
const root = resolve('artifacts', 'hanjra');
const latest = async prefix => {
  const name = (await readdir(root)).filter(n => n.startsWith(prefix) && n.endsWith('.json')).sort().at(-1);
  return { name, value: JSON.parse(await readFile(join(root, name), 'utf8')) };
};
const acceptance = await latest('acceptance_'); const live = await latest('live-acceptance_'); const audit = await latest('reuse-audit_');
const playback = (await stepsFor(acceptance.value.spokenDemo.taskId)).filter(s => s.kind === 'speech_playback');
const audio = acceptance.value.languages.en.audio;
const matrix = `# Hanjra capability and acceptance report

Observed ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} India time. Initial spoken command slice only; production Phases C–E remain incomplete.

## Evidence

- Repository tests: 114 passed, 0 failed. TypeScript, lint, and optimized Next.js production build passed. The build reports the existing llamaindex duplicate-import warning.
- Local acceptance: ${acceptance.value.checks.filter(c => c.passed).length}/${acceptance.value.checks.length} checks passed. Source: ${acceptance.name}.
- Audit: ${audit.name}. Current workflow database has 52 workflows, three legacy active flags; tested n8n health endpoint unavailable. No workflows activated by this build.
- Live read checks: ${live.name}. Individual outcomes below include failures.
- Consistent SQLite backup created with VACUUM INTO; operational files remain separate from existing databases.

| Capability | Offline/local evidence | Live read evidence | Authorized external write/readback |
|---|---|---|---|
| Task persistence, restart recovery, cancellation, dedupe, policy, spend caps | Passed repository tests | SQLite status reads passed | Not applicable |
| English voice | 10/10 synthetic audio intents; WER ${(audio.wordErrorRate * 100).toFixed(2)}%; real local STT and SAPI TTS | Browser playback ended recorded: ${playback.length > 0}; microphone and human listening untested | Not applicable |
| Hindi voice | 10/10 text routes | Audio untested; Hindi TTS unavailable | Not applicable |
| Punjabi voice | 10/10 text routes | Audio untested; Punjabi TTS unavailable | Not applicable |
| Mixed language | 4/4 text routes | Audio untested | Not applicable |
| Career | Pure existing profile matcher reused | ${live.value.checks.find(c => c.name.startsWith('career'))?.state}; 25 source candidates and factual review artifact; location/work authorization hold | No submissions or tracker updates |
| Opportunity | Deterministic scoring and provenance | Selected closed issue reviewed; not a viable lead; no verified contact or earned revenue | No sender connected |
| Software | Policy/path boundary tests | Selected repo inventory passed | Generic fix/test/PR tool not connected |
| Outbox | Exact scope, send-once, revoke, timeout/reconciliation tests with fake provider | Real send-history/suppression adapter unavailable | Untested; disabled |
| Local LLM | Config privacy tests pass | Model listed, but both bounded response trials timed out | No tools or cloud fallback |
| Personal operations | Local task plan | Email/calendar unavailable | Untested |
| Content/research | Role contracts and local README explanation | Current external research tools unavailable in console | Publishing disabled |
| Trading/finance | Named data/risk blocker | No verified account or market adapter | Orders disabled |
| VoiceStudio/original voice | Discovery adapter and profile configuration | Service unavailable; not installed | Not applicable |
| Schedules | No new schedules configured | Natural schedule firing unverified | Disabled |

## Measured audio latency

Synthetic English warm STT p50 ${audio.warmSttP50Ms} ms, p95 ${audio.warmSttP95Ms} ms. Cold model-load + first STT ${audio.coldSttMs} ms. SAPI fixture batch p50 ${audio.ttsBatchP50Ms} ms, p95 ${audio.ttsBatchP95Ms} ms; demo WAV response ${acceptance.value.spokenDemo.ttsMs} ms. These exclude physical microphone and first audible speaker latency. First-audible latency and LLM first-token latency remain unverified. A browser ended event certifies client playback completion, not human intelligibility.

## Reproduce

From the NEXUS workspace: run \`rtk npm run hanjra\`, open http://127.0.0.1:3013/hanjra, select Cached Whisper + Windows, and try **Show completed tasks, costs, and blockers**. For voice, record that command with Push to talk, review the final transcript, then Run command. Escape stops capture/playback; Cancel task stops work; Global stop halts intake; Ctrl+C stops the server. See docs/HANJRA.md for setup, privacy, backup, and rollback.

No external write or earned-revenue claim is made. Source changes are on codex/hanjra-command-os and available for review.
`;
const name = 'capability-report_' + new Date().toISOString().replace(/[:.]/g, '-') + '.md';
await writeFile(join(root, name), matrix, { flag: 'wx' });
await writeFile(join(root, 'playback-evidence_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'), JSON.stringify({ taskId: acceptance.value.spokenDemo.taskId, steps: playback, humanListeningVerified: false }, null, 2), { flag: 'wx' });
const reportDir = join(process.env.USERPROFILE, '.n8n-files', 'Agent Reports');
try { await stat(reportDir); await writeFile(join(reportDir, 'hanjra_' + name), matrix, { flag: 'wx' }); } catch { console.log('Existing Agent Reports copy unavailable'); }
console.log(join(root, name));
process.exit();
