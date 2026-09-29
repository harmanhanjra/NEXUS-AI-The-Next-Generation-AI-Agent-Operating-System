'use client';

import { useEffect, useRef, useState } from 'react';
type Skill = { id: string; name: string; description: string; path: string };

export function SkillsPanel({ onClose }: { onClose: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ skill: Skill; instructions: string } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const refresh = async (rescan = false) => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/skills${rescan ? '?refresh=true' : ''}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSkills(data.skills || []);
      if (data.warnings?.length && !data.skills?.length) setError(data.warnings.join(' '));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not discover skills.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const inspect = async (id: string) => {
    try {
      const response = await fetch(`/api/skills?id=${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPreview(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load skill.'); }
  };
  const filtered = skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="settings-modal document-library-modal" role="dialog" aria-modal="true" aria-labelledby="skills-title">
      <div className="modal-header"><div><span className="section-kicker">Local capabilities</span><h2 id="skills-title">Installed skills</h2></div><button className="close-button" aria-label="Close skills" onClick={onClose}>×</button></div>
      <div className="document-library-content">
        <p className="document-intro">Nexus discovers skills from your PC and automatically reads the best matches for each task. Active skills appear in the chat tool trace.</p>
        <label className="skill-search">Find a skill<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names and descriptions" /></label>
        {error && <div role="alert" className="document-error">{error}</div>}
        <div className="document-library-heading"><strong>{loading ? 'Scanning skill folders…' : `${skills.length} installed skills`}</strong><button className="text-button" disabled={loading} onClick={() => { void refresh(true); }}>Rescan PC</button></div>
        {preview ? <article className="skill-preview"><button className="text-button" onClick={() => setPreview(null)}>← All skills</button><h3>{preview.skill.name}</h3><p>{preview.skill.path}</p><pre>{preview.instructions}</pre></article>
          : <div className="skill-list">{filtered.map((skill) => <button key={skill.id} className="skill-card" onClick={() => { void inspect(skill.id); }}><strong>{skill.name}</strong><span>{skill.description}</span></button>)}{!loading && filtered.length === 0 && <p>No matching installed skills.</p>}</div>}
      </div>
      <div className="modal-footer"><span className="footer-spacer" /><button className="primary-button" onClick={onClose}>Done</button></div>
    </section>
  </div>;
}
