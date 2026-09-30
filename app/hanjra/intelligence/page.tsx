'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ThemeToggle } from '../../components/theme';
import type { IntelligenceSnapshot } from '@/lib/hanjra/intelligence';
import { MemoryPanel, LearningPanel, TracePanel } from './panels';
import './intelligence.css';

type View = 'overview' | 'memory' | 'learning' | 'models' | 'traces';
const views: Array<{id:View;label:string;icon:string}> = [{id:'overview',label:'Overview',icon:'◈'},{id:'memory',label:'Memory',icon:'▤'},{id:'learning',label:'Learning',icon:'⌁'},{id:'models',label:'Models & device',icon:'◇'},{id:'traces',label:'Execution traces',icon:'≋'}];
const size = (bytes:number) => `${(bytes/1024**3).toFixed(1)} GB`;
export default function IntelligenceWorkspace() {
  const [view,setView] = useState<View>('overview'), [data,setData] = useState<IntelligenceSnapshot|null>(null);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const load = useCallback(async(query='', signal?:AbortSignal) => {
    setBusy(true);setError('');
    try {
      const session = await fetch('/api/hanjra/session',{signal}); if(!session.ok) throw new Error('Local session unavailable');
      const response=await fetch(`/api/hanjra/intelligence${query?`?q=${encodeURIComponent(query)}`:''}`,{cache:'no-store',signal});
      const body=await response.json(); if(!response.ok) throw new Error(body.error||'Intelligence unavailable'); setData(body);
    } catch(e) { if(!signal?.aborted) setError((e as Error).message); }
    finally { if(!signal?.aborted) setBusy(false); }
  },[]);
  useEffect(()=>{const controller=new AbortController();void load('',controller.signal);return()=>controller.abort();},[load]);
  async function mutate(input:unknown) {
    setError('');
    const response=await fetch('/api/hanjra/intelligence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const body=await response.json(); if(!response.ok) {setError(body.error||'Save failed');throw new Error(body.error||'Save failed');} await load();
  }
  return <main className="intel-shell">
    <a className="intel-skip" href="#intelligence-content">Skip to intelligence</a>
    <aside className="intel-sidebar"><Link className="intel-logo" href="/hanjra"><b>H</b><span>HANJRA<small>Personal intelligence</small></span></Link>
      <Link className="intel-assistant-link" href="/hanjra">↗ Open assistant</Link>
      <span className="intel-nav-label">WORKSPACE</span><nav aria-label="Intelligence workspace">{views.map(item=><button key={item.id} aria-current={view===item.id?'page':undefined} onClick={()=>setView(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.id==='memory'&&data&&<small>{data.notes.filter(n=>!n.archived).length}</small>}</button>)}</nav>
      <div className="intel-sidebar-bottom"><span className="intel-local-dot"/>Local by design<p>Your notes and learning data stay in this workspace.</p><Link href="/">Chat & team rooms →</Link></div>
    </aside>
    <div className="intel-main"><header className="intel-header"><div><span>HANJRA / INTELLIGENCE</span><h1>{views.find(v=>v.id===view)?.label}</h1></div><div><span className="intel-engine-status">Ollama · {data?.engine.status||'checking'}</span><ThemeToggle/><button className="intel-button" disabled={busy} onClick={()=>void load()}>{busy?'Refreshing…':'Refresh'}</button></div></header>
      <nav className="intel-mobile-nav" aria-label="Intelligence views">{views.map(v=><button key={v.id} aria-current={view===v.id?'page':undefined} onClick={()=>setView(v.id)}>{v.label}</button>)}</nav>
      <section className="intel-content" id="intelligence-content" aria-busy={busy}>
        {error&&<div className="intel-error" role="alert">{error}<button onClick={()=>void load()}>Retry</button></div>}
        {!data&&!error&&<div className="intel-loading" role="status"><span/><span/><span/>Reading local memory, model inventory, and traces…</div>}
        {data&&<>
          {view==='overview'&&<><div className="intel-intro"><span className="intel-eyebrow">PERSONAL AI, ON YOUR DEVICE</span><h2>A workspace that<br/>learns with you.</h2><p>Keep useful context. Inspect what happened.<br/>Teach Hanjra which specialist works for you.</p><Link className="intel-primary" href="/hanjra">Start a conversation ↗</Link><div className="intel-orbit" aria-hidden="true"><span>H</span><i/><i/><i/></div></div>
            <div className="intel-metrics"><Metric label="Completed tasks" value={`${data.metrics.completed} / ${data.metrics.window}`} hint="Most recent 50 tasks"/><Metric label="Remembered notes" value={String(data.notes.filter(n=>!n.archived).length)} hint="You control what is retained"/><Metric label="Reviewed examples" value={String(data.learning.samples)} hint="Explicit positive reviews only"/><Metric label="Median completion" value={data.metrics.medianDurationMs===null?'—':`${(data.metrics.medianDurationMs/1000).toFixed(1)}s`} hint="Completed tasks; wall-clock time"/></div>
            <div className="intel-overview-grid"><article className="intel-card"><span className="intel-eyebrow">THE LOCAL LOOP</span><h2>Context → response → review</h2><ol className="intel-loop"><li><b>01</b><div><strong>Remember</strong><p>Save facts and preferences. Relevant notes ground local model responses.</p></div></li><li><b>02</b><div><strong>Observe</strong><p>Inspect task steps, model latency, source evidence, and output tokens.</p></div></li><li><b>03</b><div><strong>Improve</strong><p>Review outcomes to train a small specialist classifier on your CPU.</p></div></li></ol><button className="intel-text-button" onClick={()=>setView('memory')}>Add your first memory →</button></article><article className="intel-card"><span className="intel-eyebrow">RUNTIME SNAPSHOT</span><h2>Know what is connected.</h2><dl className="intel-facts"><dt>Inference engine</dt><dd>Ollama · {data.engine.status}</dd><dt>Installed models</dt><dd>{data.engine.installed.length}</dd><dt>Knowledge retrieval</dt><dd>SQLite + BM25</dd><dt>Learning model</dt><dd>Multinomial Naive Bayes</dd><dt>Energy measurement</dt><dd>Unavailable on this device</dd><dt>Local execution</dt><dd>2 bounded workers</dd></dl><button className="intel-text-button" onClick={()=>setView('models')}>Inspect models & device →</button></article></div>
          </>}
          {view==='memory'&&<MemoryPanel notes={data.notes} mutate={mutate}/>}
          {view==='learning'&&<LearningPanel data={data} mutate={mutate} preview={query=>load(query)}/>}
          {view==='traces'&&<TracePanel data={data}/>}
          {view==='models'&&<><div className="intel-section-heading"><div><span className="intel-eyebrow">INTELLIGENCE & ENGINE</span><h2>Your local model stack</h2><p>Live Ollama inventory. Refresh checks availability without downloading weights.</p></div><span className="intel-chip">{data.engine.status}</span></div><div className="intel-model-list">{data.engine.installed.map(model=><article className="intel-card intel-model" key={model.name}><div className="intel-model-mark">◇</div><div><h3>{model.name}</h3><p>{model.family||'Local model'} · {model.parameters||'Size unknown'} · {model.quantization||'Quantization unknown'}</p></div><span>{size(model.bytes)}<small>Installed weights</small></span></article>)}{!data.engine.installed.length&&<div className="intel-empty">No models discovered. Start your existing Ollama service, then Refresh.</div>}</div><div className="intel-overview-grid"><article className="intel-card"><h2>Device profile</h2><dl className="intel-facts"><dt>Processor</dt><dd>{data.hardware.cpu}</dd><dt>Logical threads</dt><dd>{data.hardware.threads}</dd><dt>System memory</dt><dd>{size(data.hardware.memoryBytes)}</dd><dt>Available memory</dt><dd>{size(data.hardware.availableMemoryBytes)}</dd><dt>Available disk</dt><dd>{data.hardware.diskAvailableBytes===null?'Unknown':size(data.hardware.diskAvailableBytes)}</dd></dl>{data.hardware.diskAvailableBytes!==null&&data.hardware.diskAvailableBytes<1024**3&&<p className="intel-error">Less than 1 GB free. Free disk space before adding model weights or building a desktop package.</p>}</article><article className="intel-card"><h2>Built for this machine</h2><p>Use the existing quantized Ollama model for language generation, cached Whisper for speech recognition, and a tiny CPU classifier for specialist suggestions.</p><p>Memory retrieval runs directly against local notes. No vector server or training GPU is needed for this layer.</p><div className="intel-stack">React + TypeScript<span>→</span>Next.js API<span>→</span>SQLite + Ollama</div><p className="intel-caption">Deep model fine-tuning, a native desktop shell, and energy instrumentation are future integrations, not active features.</p></article></div></>}
        </>}
      </section><footer className="intel-footer">Local memory. Reviewed learning. Observable execution.<span>{data?`Observed ${new Date(data.observedAt).toLocaleTimeString()}`:'Connecting…'}</span></footer>
    </div>
  </main>;
}
function Metric({label,value,hint}:{label:string;value:string;hint:string}) { return <div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
