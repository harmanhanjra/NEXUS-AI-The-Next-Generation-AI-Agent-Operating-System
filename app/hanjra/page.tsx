'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { HanjraTask } from '@/lib/hanjra/store';
import type { Language } from '@/lib/hanjra/contracts';
import './workspace.css';
import './console.css';
import { ThemeToggle } from '../components/theme';
import { QuickNavigation } from '../components/quick-navigation';
import { JarvisCore } from './intelligence-core';
import { gsap } from 'gsap';
import { openMicrophone, stopAfterSilence } from './voice-capture';

type Snapshot = { tasks: HanjraTask[]; agents: Array<{ id: string; name: string; responsibilities: string }>; stopped: boolean;
  model: { provider: string; model: string; textEgress: string } | null; unavailable: string[] };
type Device = { id: string; label: string; kind: string };
type VoiceState = 'idle' | 'permission' | 'listening' | 'transcribing' | 'thinking' | 'working' | 'speaking' | 'muted' | 'error';

async function jsonResponse(response: Response) {
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Request failed'); return body;
}

export default function HanjraConsole() {
  const consoleRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    const motion = gsap.matchMedia(consoleRoot);
    motion.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.hcmd-hero-copy > *, .hcmd-core-display, .hcmd-telemetry > div', { y: 18, opacity: 0, duration: .8, stagger: .07, ease: 'power3.out', clearProps: 'all' });
    });
    return () => motion.revert();
  }, []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [command, setCommand] = useState(''); const [target, setTarget] = useState('');
  const [language, setLanguage] = useState<Language | 'auto'>('auto');
  const [backend, setBackend] = useState<'voicestudio' | 'windows-local'>('windows-local');
  const [speech, setSpeech] = useState<any>(null); const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [error, setError] = useState(''); const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); const [devices, setDevices] = useState<Device[]>([]);
  const [taskQuery, setTaskQuery] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [inputDevice, setInputDevice] = useState(''); const [outputDevice, setOutputDevice] = useState('');
  const [muted, setMuted] = useState(false); const [autoSpeak, setAutoSpeak] = useState(true);
  const [autoRunVoice, setAutoRunVoice] = useState(true);
  const [submitting, setSubmitting] = useState(false); const [original, setOriginal] = useState('');
  const [turn, setTurn] = useState<string | null>(null); const [transcriptWarning, setTranscriptWarning] = useState('');
  const recording = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null); const epoch = useRef(0); const pending = useRef<AbortController | null>(null);
  const spoken = useRef(new Set<string>()); const submitLock = useRef(false); const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  const endDetection = useRef<(() => void) | null>(null); const capturePending = useRef(false);

  const refresh = useCallback(async () => {
    setSnapshot(await jsonResponse(await fetch('/api/hanjra', { cache: 'no-store' })));
  }, []);
  useEffect(() => {
    let alive = true;
    void fetch('/api/hanjra/session').then(jsonResponse).then(async () => { ready.current = true; if (alive) await refresh(); }).catch((e) => setError(String(e.message)));
    const timer = setInterval(() => { if (ready.current && alive) void refresh().catch((e) => setError(String(e.message))); }, 2000);
    return () => { alive = false; epoch.current += 1; endDetection.current?.(); clearInterval(timer); pending.current?.abort(); audio.current?.pause(); stream.current?.getTracks().forEach((t) => t.stop()); };
  }, [refresh]);

  useEffect(() => {
    let alive = true; const controller = new AbortController(); setSpeech(null);
    const check = async () => {
      await fetch('/api/hanjra/session', { signal: controller.signal });
      const health = await jsonResponse(await fetch(`/api/hanjra/speech?backend=${backend}`, { signal: controller.signal }));
      if (alive) setSpeech(health);
    };
    void check().catch((e) => { if (alive && !controller.signal.aborted) setSpeech({ available: false, blocker: e.message }); });
    return () => { alive = false; controller.abort(); };
  }, [backend]);

  const stopSpeaking = useCallback(() => {
    epoch.current += 1; pending.current?.abort(); pending.current = null;
    if (audio.current) { audio.current.pause(); if (audio.current.src.startsWith('blob:')) URL.revokeObjectURL(audio.current.src); audio.current = null; }
    setVoiceState(muted ? 'muted' : 'idle');
  }, [muted]);

  const stopCapture = useCallback((discard = false) => {
    endDetection.current?.(); endDetection.current = null;
    if (discard) epoch.current += 1;
    if (recordTimer.current) clearTimeout(recordTimer.current);
    if (recording.current?.state === 'recording') recording.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    if (discard) setVoiceState(muted ? 'muted' : 'idle');
  }, [muted]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') { stopSpeaking(); stopCapture(true); } };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [stopCapture, stopSpeaking]);

  const speak = useCallback(async (task: HanjraTask) => {
    if (muted || !task.result || ['failed', 'cancelled', 'running', 'queued'].includes(task.state)) return;
    stopSpeaking(); const marker = epoch.current; const controller = new AbortController(); pending.current = controller;
    try {
      setVoiceState('thinking');
      const response = await fetch('/api/hanjra/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, backend }), signal: controller.signal });
      if (!response.ok) throw new Error((await response.json()).error || 'Speech unavailable');
      const blob = await response.blob(); if (marker !== epoch.current) return;
      const url = URL.createObjectURL(blob); const player = new Audio(url); audio.current = player;
      if (outputDevice) {
        const selectable = player as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (!selectable.setSinkId) throw new Error('This browser cannot select an output device; choose Default output');
        await selectable.setSinkId(outputDevice);
      }
      player.onended = () => {
        URL.revokeObjectURL(url); if (marker !== epoch.current) return;
        audio.current = null; setVoiceState('idle');
        void fetch('/api/hanjra', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'playback', taskId: task.id, turnId: crypto.randomUUID() }) });
      };
      player.onerror = () => { URL.revokeObjectURL(url); setError('Output device or audio playback failed'); setVoiceState('error'); };
      await player.play(); if (marker === epoch.current) setVoiceState('speaking');
    } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setVoiceState('error'); } }
  }, [backend, muted, outputDevice, stopSpeaking]);

  useEffect(() => {
    const task = snapshot?.tasks.find((t) => t.id === current);
    if (!task) return;
    if (recording.current?.state === 'recording' || ['transcribing', 'permission'].includes(voiceState)) return;
    if (['queued', 'running'].includes(task.state)) { setVoiceState('working'); return; }
    if (!spoken.current.has(task.id)) { spoken.current.add(task.id); setVoiceState(muted ? 'muted' : 'idle'); if (autoSpeak) void speak(task); }
  }, [snapshot, current, autoSpeak, muted, speak, voiceState]);

  async function enumerateDevices() {
    if (!navigator.mediaDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list.filter((d) => d.kind !== 'videoinput').map((d) => ({ id: d.deviceId, kind: d.kind, label: d.label || `${d.kind} ${d.deviceId.slice(0, 6)}` })));
  }

  async function startCapture() {
    if (muted || !speech?.available || snapshot?.stopped || capturePending.current || recording.current?.state === 'recording') return;
    capturePending.current = true;
    stopSpeaking(); setError(''); setOriginal(''); setTranscriptWarning(''); setTurn(null);
    const marker = epoch.current; const sessionId = crypto.randomUUID();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Microphone capture is unavailable in this browser');
      setVoiceState('permission');
      const captured = await openMicrophone({ audio: { ...(inputDevice ? { deviceId: { exact: inputDevice } } : {}), echoCancellation: true, noiseSuppression: true }, video: false });
      if (marker !== epoch.current) { captured.getTracks().forEach((t) => t.stop()); return; }
      stream.current = captured; await enumerateDevices();
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(captured, mimeType ? { mimeType } : undefined); recording.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { stopCapture(true); setError('Microphone disconnected or recording failed'); setVoiceState('error'); };
      recorder.onstop = async () => {
        endDetection.current?.(); endDetection.current = null;
        captured.getTracks().forEach((t) => t.stop()); recording.current = null;
        if (marker !== epoch.current) return;
        const controller = new AbortController(); pending.current = controller; setVoiceState('transcribing');
        try {
          const form = new FormData(); form.set('audio', new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), 'command.webm'); form.set('language', language); form.set('backend', backend);
          const transcript = await jsonResponse(await fetch('/api/hanjra/speech', { method: 'POST', body: form, signal: controller.signal }));
          if (marker !== epoch.current) return;
          if (!transcript.text.trim()) throw new Error('No speech detected. Try again or type the command');
          setCommand(transcript.text); setOriginal(transcript.text); setTurn(sessionId); setVoiceState('idle');
          setTranscriptWarning(transcript.lowConfidence ? 'Some words may be uncertain. Check names, amounts, and targets before Run.' : autoRunVoice ? 'Final transcript received. Running your command.' : 'Final transcript ready. Review and press Run once.');
          if (autoRunVoice && !transcript.lowConfidence) await run({ command: transcript.text, original: transcript.text, turn: sessionId });
        } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setVoiceState('error'); } }
      };
      recorder.start(); setVoiceState('listening'); recordTimer.current = setTimeout(() => stopCapture(), 45000);
      try { endDetection.current = stopAfterSilence(captured, () => stopCapture()); } catch { /* Manual Finish recording remains available. */ }
    } catch (e) { if (marker === epoch.current) {
      stopCapture(true);
      setError((e as Error).name === 'NotAllowedError' ? 'Microphone access was denied by Windows or this browser. Enable microphone access for desktop apps in Windows microphone privacy settings, allow this site in Edge or Chrome, then try again.' : (e as Error).message);
      setVoiceState('error');
    } }
    finally { capturePending.current = false; }
  }

  async function run(voice?: { command: string; original: string; turn: string }) {
    const finalCommand = voice?.command ?? command; const finalTurn = voice?.turn ?? turn; const finalOriginal = voice?.original ?? original;
    if (submitLock.current || !finalCommand.trim()) return;
    submitLock.current = true; setSubmitting(true); setError(''); stopSpeaking();
    try {
      const result = await jsonResponse(await fetch('/api/hanjra', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'command', command: finalCommand, target: target || undefined, language, source: finalTurn ? 'voice' : 'text',
          idempotencyKey: finalTurn ? `${finalTurn}:final` : crypto.randomUUID(), originalTranscript: finalOriginal || undefined, audioSessionId: finalTurn || undefined }) }));
      setCurrent(result.task.id); setSelected(result.task.id); await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { submitLock.current = false; setSubmitting(false); }
  }

  async function control(operation: string, taskId?: string) {
    if (operation === 'stop') { stopSpeaking(); stopCapture(true); }
    try { await jsonResponse(await fetch('/api/hanjra', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, taskId }) })); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }

  const chosen = snapshot?.tasks.find((t) => t.id === selected);
  const visibleTasks = snapshot?.tasks.filter(task => (!taskQuery.trim() || `${task.command} ${task.owner} ${task.state}`.toLowerCase().includes(taskQuery.toLowerCase())) && (taskFilter === 'all' || (taskFilter === 'review' ? ['awaiting_input', 'awaiting_approval', 'blocked', 'failed'].includes(task.state) : task.state === taskFilter))) || [];
  const busyVoice = ['permission', 'listening', 'transcribing'].includes(voiceState);
  return <main className="hcmd" ref={consoleRoot}>
    <a className="hcmd-skip" href="#command-channel">Skip to command</a>
    <nav className="hcmd-rail" aria-label="Command OS navigation"><a href="#" className="hcmd-rail-logo" aria-label="Hanjra overview">H<span>HANJRA</span></a><div className="hcmd-rail-links"><a href="#command-channel"><span aria-hidden="true">⌘</span>Command center</a><Link href="/"><span aria-hidden="true">▤</span>Nexus workspace</Link><a href="#task-history"><span aria-hidden="true">◷</span>Task history</a><a href="#specialists"><span aria-hidden="true">◇</span>Specialists</a><a href="#voice-settings"><span aria-hidden="true">≋</span>Voice settings</a></div><div className="hcmd-rail-footer"><span>YOUR WORKSPACE</span><strong>Harman Hanjra</strong><small>Personal command OS</small></div></nav>
    <div className="hcmd-workspace">
    <header className="hcmd-header"><div className="hcmd-brand"><div><h1>Command center</h1><p>Voice, tasks, and your specialist team</p></div></div><div className="hcmd-header-actions"><QuickNavigation actions={[{ label: 'Nexus workspace', detail: 'Chat, team rooms, files, skills and model settings', href: '/' }, { label: 'Command channel', detail: 'Speak or type your next task', href: '#command-channel' }, { label: 'Task history', detail: 'Search outcomes and execution evidence', href: '#task-history' }, { label: 'Voice settings', detail: 'Choose microphone, speaker and speech options', href: '#voice-settings' }, { label: 'Specialist team', detail: 'Inspect the ten Hanjra roles', href: '#specialists' }]} /><Link className="hcmd-intelligence-link" href="/hanjra/intelligence">Intelligence workspace ↗</Link><ThemeToggle /><button className="hcmd-stop" onClick={() => void control(snapshot?.stopped ? 'resume' : 'stop')}>{snapshot?.stopped ? 'Resume intake' : 'Global stop'}</button></div></header>
    <JarvisCore state={muted ? 'muted' : voiceState} stopped={!!snapshot?.stopped} speechReady={!!speech?.available} taskCount={snapshot?.tasks.length || 0} activeCount={snapshot?.tasks.filter(t => t.state === 'running').length || 0} attentionCount={snapshot?.tasks.filter(t => ['awaiting_input', 'awaiting_approval'].includes(t.state)).length || 0} />
    <section className="hcmd-grid">
      <div className="hcmd-panel hcmd-compose" id="command-channel"><div className="hcmd-panel-label"><h2>Command channel</h2><span className={`hcmd-state ${voiceState}`} role="status">{muted ? 'muted' : voiceState}</span></div>
        <label>Language<select value={language} onChange={(e) => setLanguage(e.target.value as Language | 'auto')} disabled={busyVoice}><option value="auto">Auto · mixed language</option><option value="pa">ਪੰਜਾਬੀ · Punjabi</option><option value="hi">हिन्दी · Hindi</option><option value="en">English</option></select></label>
        <textarea aria-label="Command" value={command} onChange={(e) => { setCommand(e.target.value); setTurn(null); }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !busyVoice && !snapshot?.stopped) { e.preventDefault(); void run(); } }} placeholder="What would you like to move forward?" rows={4} disabled={busyVoice} />
        {original && <p className="hcmd-note">Original transcript: {original}<br />{transcriptWarning}</p>}
        <label>Selected target <span>Repository path or public request URL, when needed</span><input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Choose a specific target" /></label>
        <div className="hcmd-buttons"><button className="hcmd-primary" disabled={submitting || busyVoice || !command.trim() || snapshot?.stopped} onClick={() => void run()}>{submitting ? 'Persisting…' : 'Run command ↗'}</button><button disabled={muted || !speech?.available || snapshot?.stopped || ['transcribing', 'permission'].includes(voiceState)} onClick={() => voiceState === 'listening' ? stopCapture() : void startCapture()}>{voiceState === 'permission' ? 'Allow microphone access…' : voiceState === 'listening' ? 'Finish recording ■' : 'Push to talk ●'}</button><button onClick={() => { stopSpeaking(); stopCapture(true); }}>Stop speaking / listening</button></div>
        <div className="hcmd-examples">{['Show completed tasks, costs, and blockers', 'Plan my day from project tasks', 'Explain the Nexus architecture in Punjabi', 'Find five suitable jobs and prepare factual CV material'].map((text) => <button key={text} onClick={() => { setCommand(text); setTurn(null); }}>{text}</button>)}</div>
        {error && <p className="hcmd-error" role="alert">{error}</p>}
      </div>
      <aside className="hcmd-panel hcmd-voice" id="voice-settings"><div className="hcmd-panel-label"><h2>Voice & privacy</h2><span className="hcmd-settings-mark" aria-hidden="true">≋</span></div>
        <label>Speech service<select value={backend} onChange={(e) => { stopSpeaking(); setBackend(e.target.value as typeof backend); }} disabled={busyVoice}><option value="windows-local">Cached Whisper + Windows · local</option><option value="voicestudio">VoiceStudio · preferred service</option></select></label>
        <p className="hcmd-note">{speech ? speech.available ? `Service ready. ${backend === 'windows-local' ? 'English output voices only. Language quality awaits listening checks.' : 'Use separately configured voice profiles; language quality is unverified.'}` : `Unavailable: ${speech.blocker}` : 'Checking installed service…'}</p>
        <label>Microphone<select value={inputDevice} onChange={(e) => setInputDevice(e.target.value)} disabled={busyVoice}><option value="">Default microphone</option>{devices.filter((d) => d.kind === 'audioinput').map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <label>Speaker<select value={outputDevice} onChange={(e) => setOutputDevice(e.target.value)}><option value="">Default output</option>{devices.filter((d) => d.kind === 'audiooutput').map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <button onClick={() => void enumerateDevices()}>Refresh devices</button>
        <label className="hcmd-check"><input type="checkbox" checked={muted} onChange={(e) => { setMuted(e.target.checked); stopSpeaking(); stopCapture(true); }} />Mute microphone and output</label>
        <label className="hcmd-check"><input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} />Speak new task responses</label>
        <label className="hcmd-check"><input type="checkbox" checked={autoRunVoice} disabled={busyVoice} onChange={(e) => setAutoRunVoice(e.target.checked)} />Run finalized voice commands automatically</label>
        <details className="hcmd-voice-help"><summary>How voice and privacy work</summary><p className="hcmd-note">Click Push to talk and speak. A short pause finishes recording; Hanjra runs the finalized command and speaks the result. Uncertain transcripts need review. Sensitive actions require scoped approval.</p><p className="hcmd-note">Raw audio is deleted after transcription. Escape stops capture and playback; task cancellation is separate. Wake-word listening is off. Ctrl + Enter runs a typed command.</p></details>
        <div className="hcmd-model"><span>TEXT PROVIDER</span><strong>{snapshot?.model?.provider || 'No permitted model configured'}</strong><p>{snapshot?.model ? `${snapshot.model.model} · text egress: ${snapshot.model.textEgress}` : 'Local task status and architecture work without an LLM. Cloud text requires explicit configuration.'}</p></div>
      </aside>
    </section>
    <section className="hcmd-grid hcmd-history" id="task-history"><div className="hcmd-panel"><div className="hcmd-panel-label"><h2>Task history</h2><span>{snapshot?.tasks.length || 0} saved</span></div>
      <div className="hcmd-history-filters"><label>Search tasks<input type="search" value={taskQuery} onChange={e => setTaskQuery(e.target.value)} placeholder="Command or specialist" /></label><label>Status<select value={taskFilter} onChange={e => setTaskFilter(e.target.value)}><option value="all">All tasks</option><option value="review">Needs attention</option><option value="completed">Completed</option><option value="running">Running</option><option value="cancelled">Cancelled</option></select></label></div>
      {!snapshot?.tasks.length && <p className="hcmd-note">Run a command to create a durable task.</p>}
      {!!snapshot?.tasks.length && visibleTasks.length === 0 && <p className="hcmd-note" role="status">No tasks match this search and status. Try another filter.</p>}
      {visibleTasks.map((task) => <button className={`hcmd-task ${task.id === selected ? 'selected' : ''}`} aria-pressed={task.id === selected} key={task.id} onClick={() => setSelected(task.id)}><span>{task.command}</span><small>{task.owner} · {new Date(task.createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</small><b>{task.state.replaceAll('_', ' ')}</b></button>)}
    </div><div className="hcmd-panel hcmd-result"><div className="hcmd-panel-label"><h2>Outcome & evidence</h2></div>{chosen ? <>
      <h2>{chosen.state.replaceAll('_', ' ')}</h2><p className="hcmd-result-text">{chosen.result || 'Task persisted; waiting for its bounded adapter.'}</p>
      {chosen.blocker && <p className="hcmd-note">Missing: {chosen.blocker}</p>}
      <p className="hcmd-note">{chosen.details.provider || 'Deterministic local tools'} · {chosen.details.tokens} output tokens (estimated) · {chosen.details.costUsd === null ? 'Cost unknown' : `$${chosen.details.costUsd}`} · Asia/Kolkata</p>
      <div className="hcmd-buttons"><button onClick={() => void speak(chosen)} disabled={muted || !chosen.result}>Speak result</button><button disabled={['completed', 'failed', 'cancelled'].includes(chosen.state)} onClick={() => void control('cancel', chosen.id)}>Cancel task</button><a href={`/api/hanjra?id=${chosen.id}`} target="_blank" rel="noreferrer">Execution record ↗</a></div>
      {chosen.details.artifacts.map((path) => { const name = path.replaceAll('\\', '/').split('/').at(-1)!; return <a className="hcmd-artifact" key={path} href={`/api/hanjra?id=${chosen.id}&artifact=${encodeURIComponent(name)}`} target="_blank" rel="noreferrer">{name} ↗</a>; })}
      <ul className="hcmd-evidence">{chosen.details.evidence.map((e, i) => <li key={i}><strong>{e.scope}</strong> {e.source}<small>{e.observedAt}{e.sha256 ? ` · SHA256 ${e.sha256.slice(0, 16)}…` : ''}</small></li>)}</ul>
    </> : <p className="hcmd-note">Select a task to inspect its actual outcome.</p>}</div></section>
    <section className="hcmd-panel hcmd-team" id="specialists"><div className="hcmd-panel-label"><h2>Your specialist team</h2><span>10 roles / 2 concurrent</span></div><div>{snapshot?.agents.map((agent, i) => <article key={agent.id}><span>{String(i + 1).padStart(2, '0')}</span><h3>{agent.name}</h3><p>{agent.responsibilities}</p></article>)}</div><p className="hcmd-note">Disconnected: {snapshot?.unavailable.join(' · ')}</p></section>
    <footer className="hcmd-footer"><span>Built around your next move.</span><span>Audio stays local. Actions leave evidence.</span></footer>
    </div>
  </main>;
}
