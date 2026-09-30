'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '../components/theme';

function IntelligenceOrb({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  useEffect(() => {
    const surface = canvas.current;
    const ctx = surface?.getContext('2d');
    if (!surface || !ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0; let last = 0; let angle = 0;
    const points = Array.from({ length: 520 }, (_, i) => {
      const y = 1 - (i / 519) * 2; const radius = Math.sqrt(1 - y * y); const theta = i * Math.PI * (3 - Math.sqrt(5));
      return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
    });
    const draw = (time: number) => {
      if (!reduced.matches) frame = requestAnimationFrame(draw);
      if (document.hidden || time - last < 33) return;
      last = time; if (!reduced.matches) angle += active ? .013 : .003;
      ctx.clearRect(0, 0, 480, 400);
      const glow = ctx.createRadialGradient(240, 200, 0, 240, 200, 185);
      glow.addColorStop(0, 'rgba(85,215,230,.09)'); glow.addColorStop(1, 'rgba(85,215,230,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, 480, 400);
      const cos = Math.cos(angle); const sin = Math.sin(angle);
      const projected = points.map(p => ({ x: p.x * cos - p.z * sin, y: p.y, z: p.x * sin + p.z * cos })).sort((a, b) => a.z - b.z);
      for (const p of projected) {
        const scale = 1 + p.z * .16;
        ctx.beginPath(); ctx.arc(240 + p.x * 141 * scale, 200 + p.y * 141 * scale, 1 + (p.z + 1) * .65, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${theme === 'light' ? '18,106,129' : '145,239,245'},${.13 + (p.z + 1) * .36})`; ctx.fill();
      }
      ctx.strokeStyle = theme === 'light' ? 'rgba(18,106,129,.25)' : 'rgba(128,211,224,.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(240, 200, 190, 52, -.35, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(240, 200, 175, 66, .65, 0, Math.PI * 2); ctx.stroke();
    };
    const restart = () => { cancelAnimationFrame(frame); last = -100; draw(0); };
    reduced.addEventListener('change', restart); restart();
    return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', restart); };
  }, [active, theme]);
  return <canvas ref={canvas} width={480} height={400} aria-hidden="true" />;
}

type Props = { state: string; stopped: boolean; speechReady: boolean; taskCount: number; activeCount: number; attentionCount: number };
export function JarvisCore({ state, stopped, speechReady, taskCount, activeCount, attentionCount }: Props) {
  const status = stopped ? 'Command intake paused' : ({ idle: 'Ready when you are', permission: 'Allow microphone access', listening: 'Listening to you', speaking: 'Speaking your response', working: 'Executing your task', muted: 'Audio muted', error: 'Attention required', transcribing: 'Transcribing your voice', thinking: 'Preparing your response' }[state] || state);
  return <section className={`hcmd-hud ${state}`} aria-label="Hanjra command center">
    <div className="hcmd-hero-copy"><span className="hcmd-eyebrow">YOUR WORK, CONNECTED</span><h2>One command.<br /><em>A clearer next step.</em></h2><p>Speak or type. Hanjra routes the task,<br />saves the outcome, and shows its evidence.</p><div className="hcmd-core-status" role="status"><span />{status}</div></div>
    <div className="hcmd-core-display"><div className="hcmd-core"><IntelligenceOrb active={['listening', 'speaking', 'thinking', 'working'].includes(state)} /><div className="hcmd-orb-caption"><span>H</span><small>INTELLIGENCE CORE</small></div></div><div className="hcmd-orb-label">{speechReady ? 'Voice service connected' : 'Voice service unavailable'}<span>Punjabi / Hindi / English input</span></div></div>
    <dl className="hcmd-telemetry">{[['Running now', activeCount, 'Up to two specialists'], ['Needs your input', attentionCount, 'Review your pending tasks'], ['Task history', taskCount, 'Saved in your workspace']].map(([label, count, caption]) => <div key={label}><dt>{label}</dt><dd>{String(count).padStart(2, '0')}</dd><small>{caption}</small></div>)}</dl>
  </section>;
}
