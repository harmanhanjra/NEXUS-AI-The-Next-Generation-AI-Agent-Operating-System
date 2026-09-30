'use client';
import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({ theme: 'dark', toggle: () => {} });
export function useTheme() { return useContext(ThemeContext); }
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState('dark');
  useEffect(() => { try { const saved = localStorage.getItem('hanjra_theme'); if (saved === 'light' || saved === 'dark') setTheme(saved); } catch { /* Storage can be disabled. */ } }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const toggle = () => setTheme(current => { const next = current === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('hanjra_theme', next); } catch { /* Theme still works for this session. */ } return next; });
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle() {
  const { theme, toggle } = useContext(ThemeContext);
  return <button className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />}</svg></button>;
}
