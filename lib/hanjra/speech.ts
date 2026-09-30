import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pythonAdapter, sapiAdapter } from './local-process.ts';
import { redact, type Language } from './contracts.ts';

export type SpeechBackend = 'voicestudio' | 'windows-local';
export const SPEECH_AUDIT_COMMIT = '0834c8be28460fc4e0518bdb31eb57c494b253b2';
const state = globalThis as typeof globalThis & { __hanjraSpeechBusy?: boolean };

export function speechBase(): URL {
  const url = new URL(process.env.HANJRA_VOICESTUDIO_URL || 'http://127.0.0.1:3900');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/') throw new Error('Speech must use an explicitly configured loopback service');
  return url;
}

async function serviceJson(path: string, signal: AbortSignal): Promise<any> {
  const response = await fetch(new URL(path, speechBase()), { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]), redirect: 'error' });
  if (!response.ok) throw new Error('VoiceStudio discovery unavailable');
  const bytes = await response.text(); if (bytes.length > 2000000) throw new Error('Speech discovery size limit');
  return JSON.parse(bytes);
}

async function discover(signal: AbortSignal) {
  const discovery = await serviceJson('/.well-known/voicestudio-speech', signal);
  if (!JSON.stringify(discovery).includes('voicestudio.speech.v1')) throw new Error('Unsupported VoiceStudio speech contract');
  // Verify the installed version's advertised routes; no assumed speech endpoints.
  const api = await serviceJson('/openapi.json', signal);
  return { discovery, paths: api.paths || {} };
}

export async function speechHealth(backend: SpeechBackend, signal: AbortSignal) {
  try {
    if (backend === 'windows-local') {
      const stt = await pythonAdapter({ mode: 'speech-health' }, signal);
      const tts = await sapiAdapter({ mode: 'health' }, signal);
      return { available: Boolean(stt.cached), backend, ...stt, voices: tts.voices,
        ttsAvailableLanguages: [...new Set<string>(tts.voices.map((v: any) => String(v.language).split('-')[0]))],
        blocker: stt.cached ? null : 'cached_whisper_model', originalVoiceDesigned: false };
    }
    const contract = await discover(signal);
    const models = contract.paths['/v1/models'] ? await serviceJson('/v1/models', signal) : null;
    const voices = contract.paths['/v1/audio/voices'] ? await serviceJson('/v1/audio/voices', signal) : null;
    return { available: true, backend, discovery: contract.discovery, models, voices,
      sttAvailable: Boolean(contract.paths['/v1/audio/transcriptions']?.post),
      ttsAvailable: Boolean(contract.paths['/v1/audio/speech']?.post),
      languageQualityVerified: { pa: false, hi: false, en: false }, blocker: null, audioEgress: 'loopback only' };
  } catch { return { available: false, backend, blocker: backend === 'voicestudio' ? 'running_voicestudio_service' : 'local_python_model_or_windows_voice', audioEgress: 'none' }; }
}

async function serialized<T>(action: () => Promise<T>): Promise<T> {
  if (state.__hanjraSpeechBusy) throw new Error('Speech adapter busy; only one capture/synthesis request is allowed');
  state.__hanjraSpeechBusy = true;
  try { return await action(); } finally { state.__hanjraSpeechBusy = false; }
}

export async function transcribeAudio(audio: Blob, language: Language | 'auto', backend: SpeechBackend, signal: AbortSignal) {
  if (audio.size === 0 || audio.size > 8 * 1024 * 1024) throw new Error('Audio must contain 1 byte–8 MB');
  if (!['audio/webm', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-wav'].includes(audio.type.split(';')[0])) throw new Error('Unsupported audio format');
  return serialized(async () => {
    if (backend === 'voicestudio') {
      const contract = await discover(signal);
      if (!contract.paths['/v1/audio/transcriptions']?.post) throw new Error('Installed VoiceStudio has no batch transcription adapter');
      const model = process.env.HANJRA_VOICESTUDIO_STT_MODEL;
      if (!model) throw new Error('Select an advertised VoiceStudio STT model');
      const form = new FormData(); form.set('file', audio, 'command.webm'); form.set('model', model); form.set('response_format', 'verbose_json');
      if (language !== 'auto') form.set('language', language);
      const response = await fetch(new URL('/v1/audio/transcriptions', speechBase()), { method: 'POST', body: form, signal, redirect: 'error' });
      if (!response.ok) throw new Error('VoiceStudio transcription failed');
      const result = await response.json();
      if (typeof result.text !== 'string' || result.text.length > 12000) throw new Error('Invalid speech result');
      return { text: redact(result.text), language: result.language || language, lowConfidence: true, partial: false, model, scope: 'local_read' };
    }
    const root = resolve(process.cwd(), 'data', 'hanjra-audio'); await mkdir(root, { recursive: true });
    const path = resolve(root, `${crypto.randomUUID()}.webm`);
    try {
      await writeFile(path, Buffer.from(await audio.arrayBuffer()), { flag: 'wx' });
      const result = await pythonAdapter({ mode: 'transcribe', audio: path, root, language }, signal);
      if (typeof result.text !== 'string' || result.text.length > 12000) throw new Error('Invalid local speech result');
      return { ...result, text: redact(result.text) };
    } finally { await rm(path, { force: true }); }
  });
}

export async function synthesize(text: string, language: Language, backend: SpeechBackend, signal: AbortSignal): Promise<Uint8Array> {
  const safe = redact(text).slice(0, 1200);
  if (safe.includes('[REDACTED]')) throw new Error('Speech withheld: secret material');
  return serialized(async () => {
    if (backend === 'voicestudio') {
      const contract = await discover(signal);
      if (!contract.paths['/v1/audio/speech']?.post) throw new Error('Installed VoiceStudio has no synthesis adapter');
      const voice = process.env[`HANJRA_TTS_VOICE_${language.toUpperCase()}`];
      const model = process.env.HANJRA_VOICESTUDIO_TTS_MODEL;
      if (!voice || !model) throw new Error(`Configure an advertised TTS model and ${language} voice profile`);
      const response = await fetch(new URL('/v1/audio/speech', speechBase()), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, voice, input: safe, language, response_format: 'wav' }), signal, redirect: 'error' });
      if (!response.ok) throw new Error('VoiceStudio synthesis failed');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 16000000) throw new Error('Speech output limit exceeded');
      return bytes;
    }
    const root = resolve(process.cwd(), 'data', 'hanjra-audio'); await mkdir(root, { recursive: true });
    const path = resolve(root, `${crypto.randomUUID()}.wav`);
    try {
      await sapiAdapter({ mode: 'synthesize', text: safe, language, root, output: path,
        voice: process.env.HANJRA_WINDOWS_VOICE || 'Microsoft David Desktop' }, signal);
      return new Uint8Array(await readFile(path));
    } finally { await rm(path, { force: true }); }
  });
}
