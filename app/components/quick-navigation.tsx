'use client';
import { useEffect, useState } from 'react';
import { useDialog } from './use-dialog';

export type NavigationAction = { label: string; detail: string; action?: () => void; href?: string };
function NavigationDialog({ actions, onClose }: { actions: NavigationAction[]; onClose: () => void }) {
  const dialog = useDialog(onClose); const [query, setQuery] = useState('');
  const matches = actions.filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={dialog} tabIndex={-1} className="settings-modal quick-navigation" role="dialog" aria-modal="true" aria-labelledby="quick-navigation-title"><div className="modal-header"><h2 id="quick-navigation-title">Go anywhere</h2><button className="close-button" aria-label="Close quick navigation" onClick={onClose}>×</button></div><label className="quick-search">Search your workspace<input data-autofocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Chat, voice, files, agents…" onKeyDown={e => { if (e.key === 'Enter' && matches[0]) { const item = matches[0]; if (item.href) window.location.assign(item.href); else { onClose(); item.action?.(); } } }} /></label><div className="quick-actions">{matches.map(item => item.href ? <a key={item.label} href={item.href} onClick={onClose}><strong>{item.label}</strong><small>{item.detail}</small><span aria-hidden="true">↗</span></a> : <button key={item.label} onClick={() => { onClose(); item.action?.(); }}><strong>{item.label}</strong><small>{item.detail}</small><span aria-hidden="true">↗</span></button>)}{matches.length === 0 && <p>No matching destination. Try “chat” or “files”.</p>}</div><div className="quick-hint"><kbd>Enter</kbd> open first result <kbd>Esc</kbd> close</div></section></div>;
}
export function QuickNavigation({ actions }: { actions: NavigationAction[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(current => !current); } }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, []);
  return <><button className="quick-nav-trigger" onClick={() => setOpen(true)} aria-label="Search workspace"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg><span>Go anywhere</span><kbd>Ctrl K</kbd></button>{open && <NavigationDialog actions={actions} onClose={() => setOpen(false)} />}</>;
}
