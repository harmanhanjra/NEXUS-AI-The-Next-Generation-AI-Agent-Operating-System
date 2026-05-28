'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { AGENTS, AgentId, AgentConfig } from '@/lib/agents';
import { renderMarkdown } from '@/lib/markdown';

// ====== Types ======
interface ToolCall {
  name: string;
  args?: string;
  result?: string;
  success?: boolean;
  running?: boolean;
}
interface Citation {
  n: number;
  title: string;
  uri: string;
}
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  citations?: Citation[];
  thinking?: string | null;
  streaming?: boolean;
  createdAt: number;
}

// ====== Helpers ======
function uid() { return Math.random().toString(36).slice(2, 11); }

function loadKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('nexus_gemini_key') || '';
}
function saveKey(k: string) {
  if (typeof window === 'undefined') return;
  if (k) localStorage.setItem('nexus_gemini_key', k);
  else localStorage.removeItem('nexus_gemini_key');
}

function loadConversationId(agentId: string): string {
  if (typeof window === 'undefined') return uid();
  const key = `nexus_convo_${agentId}`;
  let id = localStorage.getItem(key);
  if (!id) { id = uid(); localStorage.setItem(key, id); }
  return id;
}

function newConversation(agentId: string): string {
  const id = uid();
  if (typeof window !== 'undefined') localStorage.setItem(`nexus_convo_${agentId}`, id);
  return id;
}

// ====== App ======
export default function App() {
  const [currentAgentId, setCurrentAgentId] = useState<AgentId>('research');
  const [conversationId, setConversationId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hasServerKey, setHasServerKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [memories, setMemories] = useState<any[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const agent = AGENTS[currentAgentId];

  // ===== Init: load key, check health, load conversation =====
  useEffect(() => {
    setApiKey(loadKey());
    fetch('/api/health').then(r => r.json()).then(d => setHasServerKey(!!d.hasServerKey)).catch(() => {});
  }, []);

  useEffect(() => {
    const id = loadConversationId(currentAgentId);
    setConversationId(id);
    loadConversationMessages(id);
    loadMemories(currentAgentId);
  }, [currentAgentId]);

  // ===== Auto-scroll =====
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.content.length]);

  // ===== Auto-resize textarea =====
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // ===== Load existing convo =====
  const loadConversationMessages = async (convId: string) => {
    try {
      const r = await fetch(`/api/conversations?conversationId=${convId}`);
      const d = await r.json();
      if (d.messages && d.messages.length > 0) {
        setMessages(d.messages.map((m: any) => ({
          id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
        })));
      } else {
        setMessages([]);
      }
    } catch {}
  };

  const loadMemories = async (agentId: string) => {
    try {
      const r = await fetch(`/api/memory?agentId=${agentId}`);
      const d = await r.json();
      setMemories(d.memories || []);
    } catch {}
  };

  const startNewChat = () => {
    const id = newConversation(currentAgentId);
    setConversationId(id);
    setMessages([]);
  };

  // ===== Send message with SSE streaming =====
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const effectiveKey = apiKey || (hasServerKey ? '__server__' : '');
    if (!effectiveKey) {
      setShowSettings(true);
      return;
    }

    setInput('');
    const userMsg: ChatMessage = {
      id: uid(), role: 'user', content: text, createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: uid(), role: 'assistant', content: '', toolCalls: [],
      citations: [], thinking: null, streaming: true, createdAt: Date.now(),
    };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: currentAgentId,
          conversationId,
          message: text,
          apiKey: apiKey || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE blocks
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleSseBlock(block, assistantMsg.id);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        updateMessage(assistantMsg.id, m => ({
          ...m,
          content: m.content + `\n\n_⚠️ Error: ${err.message}_`,
          streaming: false,
        }));
      }
    } finally {
      setStreaming(false);
      updateMessage(assistantMsg.id, m => ({ ...m, streaming: false, thinking: null }));
      loadMemories(currentAgentId);
      abortRef.current = null;
    }
  }, [input, streaming, apiKey, hasServerKey, currentAgentId, conversationId]);

  const updateMessage = (id: string, updater: (m: ChatMessage) => ChatMessage) => {
    setMessages(prev => prev.map(m => m.id === id ? updater(m) : m));
  };

  const handleSseBlock = (block: string, msgId: string) => {
    let event = '';
    let dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!event) return;
    let data: any;
    try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }

    if (event === 'token') {
      updateMessage(msgId, m => ({ ...m, content: m.content + data, thinking: null }));
    } else if (event === 'thinking') {
      updateMessage(msgId, m => ({ ...m, thinking: data }));
    } else if (event === 'tool_call') {
      updateMessage(msgId, m => ({
        ...m,
        toolCalls: [...(m.toolCalls || []), { ...data, running: false }],
        thinking: null,
      }));
    } else if (event === 'citation') {
      updateMessage(msgId, m => ({ ...m, citations: data }));
    } else if (event === 'error') {
      updateMessage(msgId, m => ({
        ...m,
        content: m.content + `\n\n_⚠️ ${data}_`,
        thinking: null,
        streaming: false,
      }));
    } else if (event === 'done') {
      updateMessage(msgId, m => ({ ...m, streaming: false, thinking: null }));
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
  };

  // ===== Render =====
  const hasKey = !!(apiKey || hasServerKey);

  return (
    <div className="app">
      <Sidebar
        currentAgentId={currentAgentId}
        onAgentChange={setCurrentAgentId}
        onNewChat={startNewChat}
      />

      <main className="main">
        <Topbar
          agent={agent}
          hasKey={hasKey}
          onOpenSettings={() => setShowSettings(true)}
          onNewChat={startNewChat}
        />

        <div className="chat-layout">
          <div className="chat-main">
            <ChatHeader agent={agent} />

            <div className="chat-messages">
              {messages.length === 0 ? (
                <EmptyState agent={agent} onSuggest={(s) => setInput(s)} />
              ) : (
                messages.map(m => <MessageView key={m.id} message={m} agent={agent} />)
              )}
              <div ref={messagesEndRef} />
            </div>

            <Composer
              input={input}
              setInput={setInput}
              onSend={send}
              onStop={stopStreaming}
              streaming={streaming}
              textareaRef={textareaRef}
              agent={agent}
              hasKey={hasKey}
              onOpenSettings={() => setShowSettings(true)}
            />
          </div>

          <ContextPanel agent={agent} memories={memories} />
        </div>
      </main>

      {showSettings && (
        <SettingsModal
          apiKey={apiKey}
          hasServerKey={hasServerKey}
          onSave={(k) => { setApiKey(k); saveKey(k); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ====== Components ======

function Sidebar({ currentAgentId, onAgentChange, onNewChat }: {
  currentAgentId: AgentId;
  onAgentChange: (id: AgentId) => void;
  onNewChat: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-orb" />
        <span>Nexus</span>
      </div>

      <button className="nav-item active">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Chat
      </button>

      <button className="nav-item" onClick={onNewChat}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Chat
      </button>

      <div className="nav-section">AI Agents</div>
      {(Object.values(AGENTS) as AgentConfig[]).map(a => (
        <button
          key={a.id}
          className={`nav-item ${currentAgentId === a.id ? 'active' : ''}`}
          onClick={() => onAgentChange(a.id)}
        >
          <span style={{ fontSize: 16 }}>{a.icon}</span>
          {a.name.replace(' Agent', '').replace(' Creator', '').replace(' Analyst', '').replace(' Coach', '')}
        </button>
      ))}

      <div className="sidebar-footer">
        <div className="avatar">JD</div>
        <div className="user-info">
          <div className="user-name">Jordan Dev</div>
          <div className="user-plan">Powered by Gemini</div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ agent, hasKey, onOpenSettings, onNewChat }: {
  agent: AgentConfig; hasKey: boolean; onOpenSettings: () => void; onNewChat: () => void;
}) {
  return (
    <div className="topbar">
      <div className="breadcrumb">
        <span className="sep">Nexus</span>
        <span className="sep">/</span>
        <span className="current">{agent.name}</span>
      </div>
      <div className="topbar-actions">
        <span className={`status-pill ${hasKey ? 'ok' : 'warn'}`}>
          <span className="status-dot" />
          {hasKey ? 'API Connected' : 'No API Key'}
        </span>
        <button className="btn btn-ghost" onClick={onNewChat}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          New Chat
        </button>
        <button className="btn btn-primary" onClick={onOpenSettings}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>
      </div>
    </div>
  );
}

function ChatHeader({ agent }: { agent: AgentConfig }) {
  return (
    <div className="chat-header">
      <div className="agent-chip">
        <div className="agent-avatar" style={{ background: agent.gradient }}>{agent.icon}</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{agent.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{agent.modelLabel}</div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ agent, onSuggest }: { agent: AgentConfig; onSuggest: (s: string) => void }) {
  const suggestionsByAgent: Record<AgentId, string[]> = {
    research: [
      'What are the latest breakthroughs in AI agents in 2026?',
      'Compare LangGraph vs CrewAI for production',
      'Find recent funding rounds in agentic AI startups',
    ],
    coding: [
      'Build a Next.js API route that streams Gemini responses',
      'Design a Postgres schema for a multi-tenant SaaS',
      'Refactor a React component to use Server Components',
    ],
    content: [
      'Write a 6-tweet thread about why AI agents will replace SaaS',
      'Draft a launch email for a new AI product',
      'Create 3 hooks for a YouTube video about agent architectures',
    ],
    business: [
      'Analyze the SaaS AI-agent market and recommend pricing',
      'Build a unit economics model for a $20/mo Pro plan',
      'Compare GTM strategies: PLG vs sales-led for AI tools',
    ],
    life: [
      'Help me design a morning routine for deep work',
      'I feel burned out — what should I do this week?',
      'Build me a 30-day habit experiment for better sleep',
    ],
  };
  const suggestions = suggestionsByAgent[agent.id] || [];
  return (
    <div className="empty-state">
      <div className="icon-big">{agent.icon}</div>
      <h2>{agent.name}</h2>
      <p dangerouslySetInnerHTML={{ __html: renderMarkdown(agent.welcomeMessage) }} />
      <div className="suggestion-row">
        {suggestions.map(s => (
          <button key={s} className="suggestion-chip" onClick={() => onSuggest(s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}

function MessageView({ message, agent }: { message: ChatMessage; agent: AgentConfig }) {
  const isUser = message.role === 'user';
  return (
    <div className="message">
      <div className={`message-avatar ${isUser ? 'user' : ''}`} style={!isUser ? { background: agent.gradient } : undefined}>
        {isUser ? 'JD' : agent.icon}
      </div>
      <div className="message-content">
        <div className="message-author">
          {isUser ? 'You' : agent.name}
          <span className="message-time">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {message.toolCalls.map((tc, i) => (
              <span key={i} className={`tool-call ${tc.running ? 'running' : ''}`}>
                <span>⚡</span>
                <span className="tool-name">{tc.name}</span>
                {tc.args && <span style={{ color: 'var(--text-muted)' }}>({tc.args})</span>}
                {tc.result && (
                  <span className={`tool-status ${tc.success === false ? 'error' : 'success'}`}>
                    → {tc.result}
                  </span>
                )}
                {tc.running && <span className="spinner" />}
              </span>
            ))}
          </div>
        )}

        {/* Thinking indicator (before any content) */}
        {message.thinking && !message.content && (
          <div className="thinking">
            <span>{message.thinking}</span>
            <div className="thinking-dots"><span /><span /><span /></div>
          </div>
        )}

        {/* Streamed content */}
        {message.content && (
          <div
            className="message-body"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(message.content) + (message.streaming ? '<span class="cursor"></span>' : ''),
            }}
          />
        )}

        {/* Citations */}
        {message.citations && message.citations.length > 0 && (
          <div className="citations">
            <div className="citations-title">📚 Sources ({message.citations.length})</div>
            {message.citations.map(c => (
              <a key={c.n} href={c.uri} target="_blank" rel="noopener noreferrer" className="citation-link">
                <span className="citation-num">{c.n}</span>
                <span style={{ flex: 1 }}>{c.title}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({ input, setInput, onSend, onStop, streaming, textareaRef, agent, hasKey, onOpenSettings }: {
  input: string;
  setInput: (s: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  agent: AgentConfig;
  hasKey: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <div className="composer">
      <div className="composer-inner">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!hasKey) onOpenSettings();
              else onSend();
            }
          }}
          placeholder={hasKey ? `Message ${agent.name}...` : 'Add your Gemini API key in Settings to start chatting...'}
          rows={1}
          disabled={streaming}
        />
        <div className="composer-actions">
          <button className="icon-btn" title="Attach file (coming soon)" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          <button className="icon-btn" title="Voice (coming soon)" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
          </button>
          <div className="right">
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {streaming ? 'Generating…' : 'Shift+Enter for newline'}
            </span>
            {streaming ? (
              <button className="btn btn-danger" onClick={onStop}>Stop</button>
            ) : (
              <button className="send-btn" onClick={() => hasKey ? onSend() : onOpenSettings()} disabled={!input.trim()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextPanel({ agent, memories }: { agent: AgentConfig; memories: any[] }) {
  return (
    <aside className="context-panel">
      <div className="panel-section">
        <div className="panel-title">⚡ Active Agent</div>
        <div className="agent-card">
          <div className="agent-name"><span style={{ fontSize: 18 }}>{agent.icon}</span> {agent.name}</div>
          <div className="agent-desc">{agent.modelLabel}</div>
          <div className="agent-stats">
            <span>🔧 {agent.tools.length} tools</span>
            <span>🌡 temp {agent.temperature}</span>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">🔧 Tools</div>
        <div>
          {agent.tools.includes('web_search') && (
            <span className="memory-item" style={{ display: 'inline-block', marginRight: 6 }}>🔍 Google Search (grounded)</span>
          )}
          {agent.tools.includes('memory_recall') && (
            <span className="memory-item" style={{ display: 'inline-block', marginRight: 6 }}>🧠 Memory Recall</span>
          )}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">🧠 Long-term Memory ({memories.length})</div>
        {memories.length === 0 ? (
          <div className="memory-empty">No memories yet. Have a few conversations and I&apos;ll remember the important parts automatically.</div>
        ) : (
          memories.slice(0, 8).map((m: any) => (
            <div key={m.id} className="memory-item">
              {String(m.content).slice(0, 160)}{m.content.length > 160 ? '…' : ''}
              <div className="mem-meta">
                <span>📌 {m.source}</span>
                <span>{new Date(m.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function SettingsModal({ apiKey, hasServerKey, onSave, onClose }: {
  apiKey: string;
  hasServerKey: boolean;
  onSave: (k: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(apiKey);
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">⚙️ Settings</div>
          <button className="icon-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Gemini API Key</label>
            <input
              type="password"
              value={val}
              onChange={e => setVal(e.target.value)}
              placeholder={hasServerKey ? 'Using server key (override here if needed)' : 'AIza...'}
              autoFocus
            />
            <div className="help">
              {hasServerKey
                ? <>✅ Server key detected. You can leave this blank or paste your own to override.</>
                : <>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a>. Stored only in your browser (localStorage).</>
              }
            </div>
          </div>

          <div className="field">
            <label>Models Used</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div>🔬 Research → <code>gemini-2.5-flash</code> + Google Search grounding</div>
              <div>💻 Coding → <code>gemini-2.5-pro</code> (2M context)</div>
              <div>✍️ Content → <code>gemini-2.5-flash</code></div>
              <div>📊 Business → <code>gemini-2.5-pro</code> + Search</div>
              <div>🌱 Life Coach → <code>gemini-2.5-flash</code></div>
              <div>🧠 Embeddings → <code>gemini-embedding-001</code></div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(val.trim())}>Save</button>
        </div>
      </div>
    </div>
  );
}
