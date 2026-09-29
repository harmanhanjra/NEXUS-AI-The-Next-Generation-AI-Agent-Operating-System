'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGENTS, AgentConfig, AgentId, sanitizeAgentConfig } from '@/lib/agents';
import { ProviderId, ProviderSettings } from '@/lib/providers';
import { renderMarkdown } from '@/lib/markdown';
import { consumeSse } from '@/lib/sse';
import { SkillsPanel } from './components/SkillsPanel';

type WorkspaceView = 'chat' | 'rooms' | 'agents';

type ToolCall = {
  name: string;
  args?: string;
  result?: string;
  success?: boolean;
};

type Citation = {
  n: number;
  title: string;
  uri: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  citations?: Citation[];
  thinking?: string | null;
  streaming?: boolean;
  createdAt: number;
};

type RecentConversation = {
  id: string;
  agentId: string;
  title: string;
  updatedAt: number;
  isWorking?: boolean;
  documentIds?: string[];
  workingSession?: string;
};

type RoomStep = {
  agentId: AgentId;
  role: string;
  provider: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
  durationMs?: number;
  skills?: string[];
};

type RoomRun = {
  id: string;
  message: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  steps: RoomStep[];
  synthesis?: string;
  createdAt: number;
  phase?: 'contribute' | 'review' | 'synthesize';
};

type WorkspaceDocument = {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  summary: string;
  summaryStatus: 'processing' | 'ready' | 'failed';
  outline: string[];
  createdAt: number;
};

const ROOMS = [
  {
    id: 'launch-room',
    name: 'Product launch',
    detail: 'Strategy, research, copy',
    mission: 'Make the next launch sharper.',
    missionDetail: 'Bring research, strategy, engineering, and narrative into the same decision room.',
    status: 'active',
    defaultAgents: ['research', 'business', 'coding', 'content'] as AgentId[],
  },
  {
    id: 'engineering-room',
    name: 'Engineering review',
    detail: 'Architecture and code quality',
    mission: 'Ship with fewer surprises.',
    missionDetail: 'Architecture, risk, and delivery tradeoffs — reviewed by every specialist before you commit.',
    status: 'ready',
    defaultAgents: ['coding', 'research', 'business'] as AgentId[],
  },
  {
    id: 'customer-room',
    name: 'Customer insights',
    detail: 'Feedback synthesis',
    mission: 'Hear what customers mean.',
    missionDetail: 'Turn scattered feedback into ranked themes, risks, and the next three moves.',
    status: 'ready',
    defaultAgents: ['research', 'business', 'content', 'life'] as AgentId[],
  },
];

const ROOM_AGENT_IDS: AgentId[] = ['research', 'business', 'coding', 'content'];

function agentProviderId(agent: AgentConfig, fallback: ProviderId): ProviderId {
  const pinned = (agent.providerId || agent.provider || '') as string;
  if (pinned === 'openai') return 'openai-compatible';
  if (pinned === 'nvidia' || pinned === 'openai-compatible') {
    return pinned;
  }
  return fallback;
}

function providerKeyFor(providerId: string, apiKeys: Record<ProviderId, string>): string {
  if (providerId === 'openai') return apiKeys['openai-compatible'] || '';
  return apiKeys[providerId as ProviderId] || '';
}

function uid() {
  return Math.random().toString(36).slice(2, 11);
}

function loadKey(provider: ProviderId): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(`nexus_provider_key_${provider}`) || '';
}

function saveKey(provider: ProviderId, value: string) {
  if (typeof window === 'undefined') return;
  if (value) localStorage.setItem(`nexus_provider_key_${provider}`, value);
  else localStorage.removeItem(`nexus_provider_key_${provider}`);
}

function loadCustomAgents(): AgentConfig[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem('nexus_custom_agents') || '[]');
    return Array.isArray(value) ? value.map((agent) => sanitizeAgentConfig(agent)).filter((agent): agent is AgentConfig => Boolean(agent)) : [];
  } catch {
    return [];
  }
}

function saveCustomAgents(agents: AgentConfig[]) {
  if (typeof window !== 'undefined') localStorage.setItem('nexus_custom_agents', JSON.stringify(agents));
}

function loadConversationId(agentId: string): string {
  if (typeof window === 'undefined') return uid();
  const key = `nexus_convo_${agentId}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = uid();
  localStorage.setItem(key, id);
  return id;
}

function loadWorkspaceId(): string {
  if (typeof window === 'undefined') return '';
  const key = 'nexus_document_workspace_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function newConversation(agentId: string): string {
  const id = uid();
  if (typeof window !== 'undefined') localStorage.setItem(`nexus_convo_${agentId}`, id);
  return id;
}

function conversationIndexKey(agentId: string) {
  return `nexus_conversations_${agentId}`;
}

function loadConversationIndex(agentId: string): RecentConversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(conversationIndexKey(agentId)) || '[]');
    return Array.isArray(value) ? value.filter((item): item is RecentConversation => Boolean(item && typeof item.id === 'string' && typeof item.title === 'string')) : [];
  } catch {
    return [];
  }
}

function saveConversationIndex(agentId: string, conversations: RecentConversation[]) {
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(conversationIndexKey(agentId), JSON.stringify(conversations.slice(0, 50))); } catch { /* Keep the active chat usable if browser storage is full. */ }
  }
}

function loadConversationMessages(id: string): ChatMessage[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(`nexus_messages_${id}`) || 'null');
    return Array.isArray(value) ? value.map((message) => ({ ...message, streaming: false, thinking: null })) : null;
  } catch {
    return null;
  }
}

function saveConversationMessages(id: string, messages: ChatMessage[]) {
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(`nexus_messages_${id}`, JSON.stringify(messages)); } catch { /* Keep the active chat usable if browser storage is full. */ }
  }
}

function providerLabel(provider: string) {
  return provider === 'nvidia' ? 'NVIDIA NIM' : provider === 'openai' ? 'OpenAI' : 'OpenAI-compatible';
}

function toolLabel(tool: string) {
  if (tool === 'memory_recall') return 'Memory recall';
  if (tool === 'document_search') return 'Document search';
  if (tool === 'web_search') return 'Web search';
  return tool.replace(/_/g, ' ');
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(duration?: number) {
  if (!duration) return '—';
  return `${(duration / 1000).toFixed(1)}s`;
}

/**
 * Dialog dismissal + initial focus. Escape closes without touching the
 * backdrop; the first focusable control receives focus once on mount so
 * streaming re-renders behind the modal never yank focus back.
 */
function useModalDismiss(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    const el = dialogRef.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') || el?.querySelector<HTMLElement>('input, textarea, select, button'))?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return dialogRef;
}

export default function App() {
  const [view, setView] = useState<WorkspaceView>('chat');
  const [currentAgentId, setCurrentAgentId] = useState<AgentId>('head');
  const [customAgents, setCustomAgents] = useState<AgentConfig[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>({});
  const [recentConversations, setRecentConversations] = useState<RecentConversation[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('nvidia');
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>({
    provider: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: '',
  });
  const [apiKeys, setApiKeys] = useState<Record<ProviderId, string>>({ 'openai-compatible': '', nvidia: '' });
  const [serverProviders, setServerProviders] = useState<Record<ProviderId, boolean>>({ 'openai-compatible': false, nvidia: false });
  const [showSettings, setShowSettings] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState(ROOMS[0].id);
  const [roomAgentsByRoom, setRoomAgentsByRoom] = useState<Record<string, AgentId[]>>(() =>
    Object.fromEntries(ROOMS.map((room) => [room.id, [...room.defaultAgents]])),
  );
  const [roomRunsByRoom, setRoomRunsByRoom] = useState<Record<string, RoomRun | null>>({});
  const [roomError, setRoomError] = useState('');
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [showDocuments, setShowDocuments] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [documentInstructions, setDocumentInstructions] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const messages = useMemo(() => messagesByConversation[conversationId] || [], [messagesByConversation, conversationId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeAgentIdRef = useRef(currentAgentId);
  const appSessionId = useRef(uid());
  useEffect(() => { activeAgentIdRef.current = currentAgentId; }, [currentAgentId]);
  const agentList = useMemo(() => {
    const overrides = new Map(customAgents.map((item) => [item.id, item]));
    return [...Object.values(AGENTS).filter((item) => !overrides.has(item.id)), ...customAgents];
  }, [customAgents]);
  const agent = agentList.find((item) => item.id === currentAgentId) || agentList[0] || AGENTS.research;
  const roomAgentIds = roomAgentsByRoom[activeRoomId] || ROOM_AGENT_IDS;
  const roomAgents = roomAgentIds.map((id) => agentList.find((item) => item.id === id)).filter((item): item is AgentConfig => Boolean(item));
  const activeProvider = agentProviderId(agent, provider);
  const activeApiKey = providerKeyFor(activeProvider, apiKeys);
  const activeRoom = ROOMS.find((room) => room.id === activeRoomId) || ROOMS[0];
  const roomRun = roomRunsByRoom[activeRoomId] || null;
  const hasServerKey = Boolean(serverProviders['openai-compatible'] || serverProviders.nvidia);
  const hasKey = Boolean(activeApiKey || serverProviders[activeProvider]);
  const roomHasKey = roomAgents.some((item) => {
    const agentProvider = agentProviderId(item, provider);
    const key = providerKeyFor(agentProvider, apiKeys);
    return Boolean(key || serverProviders[agentProvider]);
  });

  useEffect(() => {
    setCustomAgents(loadCustomAgents());
    setWorkspaceId(loadWorkspaceId());
    try {
      const saved = JSON.parse(localStorage.getItem('nexus_provider_settings') || 'null');
      if (saved && (saved.provider === 'nvidia' || saved.provider === 'openai-compatible')) {
        setProvider(saved.provider);
        setProviderSettings(saved);
      }
      const runs = JSON.parse(localStorage.getItem('nexus_room_runs') || '{}');
      setRoomRunsByRoom(Object.fromEntries(Object.entries(runs as Record<string, RoomRun>).map(([id, run]) => [id, { ...run, status: run.status === 'running' ? 'failed' : run.status }])));
    } catch { /* Ignore invalid saved workspace settings. */ }
    setApiKeys({ 'openai-compatible': loadKey('openai-compatible'), nvidia: loadKey('nvidia') });
    fetch('/api/health')
      .then((response) => response.json())
      .then((data) => setServerProviders(data.serverProviders || { 'openai-compatible': false, nvidia: false }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!Object.keys(roomRunsByRoom).length) return;
    try { localStorage.setItem('nexus_room_runs', JSON.stringify(roomRunsByRoom)); } catch { /* Storage full. */ }
  }, [roomRunsByRoom]);

  const refreshDocuments = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const response = await fetch(`/api/documents?workspaceId=${encodeURIComponent(workspaceId)}`);
      const data = await response.json();
      if (response.ok) setDocuments(data.documents || []);
    } catch {
      setDocumentError('Could not load the workspace file library.');
    }
  }, [workspaceId]);

  useEffect(() => { void refreshDocuments(); }, [refreshDocuments]);

  useEffect(() => {
    if (!documents.some((document) => document.summaryStatus === 'processing')) return;
    const timer = window.setInterval(() => { void refreshDocuments(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [documents, refreshDocuments]);

  const requestProvider = useCallback((id: ProviderId, model?: string) => ({
    provider: id,
    ...(id === providerSettings.provider ? { baseUrl: providerSettings.baseUrl, model: model || providerSettings.model } : model ? { model } : {}),
  }), [providerSettings]);

  const uploadDocument = useCallback(async (file: File) => {
    if (!workspaceId) return;
    setUploadingDocument(true);
    setDocumentError('');
    const formData = new FormData();
    formData.set('file', file);
    formData.set('workspaceId', workspaceId);
    formData.set('instructions', documentInstructions);
    formData.set('apiKey', activeApiKey || '');
    formData.set('apiKeys', JSON.stringify(apiKeys));
    formData.set('providerId', JSON.stringify(requestProvider(activeProvider, agent.model)));
    try {
      const response = await fetch('/api/documents', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
      if (data.document) {
        setDocuments((current) => [data.document, ...current.filter((item) => item.id !== data.document.id)]);
        setSelectedDocumentIds((current) => current.includes(data.document.id) ? current : [...current, data.document.id]);
      }
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setUploadingDocument(false);
    }
  }, [activeApiKey, activeProvider, agent.model, apiKeys, documentInstructions, requestProvider, workspaceId]);

  const removeDocument = useCallback(async (documentId: string) => {
    if (!workspaceId) return;
    setDocumentError('');
    try {
      const response = await fetch('/api/documents', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, documentId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not delete the file.');
      setDocuments((current) => current.filter((document) => document.id !== documentId));
      setSelectedDocumentIds((current) => current.filter((id) => id !== documentId));
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Could not delete the file.');
    }
  }, [workspaceId]);

  useEffect(() => {
    if (view !== 'chat') return;
    const id = loadConversationId(currentAgentId);
    setConversationId(id);
    const cached = loadConversationMessages(id);
    if (cached) setMessagesByConversation((current) => ({ ...current, [id]: current[id] || cached }));
    const localConversations = loadConversationIndex(currentAgentId).map((item) => ({ ...item, isWorking: item.isWorking && item.workingSession === appSessionId.current }));
    setRecentConversations(localConversations);
    setSelectedDocumentIds(localConversations.find((item) => item.id === id)?.documentIds || []);
    fetch(`/api/conversations?conversationId=${id}`)
      .then((response) => response.json())
      .then((data) => {
        if (cached || !Array.isArray(data.messages) || !data.messages.length) return;
        const restored = data.messages.map((message: any) => ({
          id: message.id,
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
          createdAt: message.createdAt,
        }));
        setMessagesByConversation((current) => ({ ...current, [id]: restored }));
      })
      .catch(() => undefined);
    fetch(`/api/conversations?agentId=${encodeURIComponent(currentAgentId)}`)
      .then((response) => response.json())
      .then((data) => {
        const local = loadConversationIndex(currentAgentId).map((item) => ({ ...item, isWorking: item.isWorking && item.workingSession === appSessionId.current }));
        const merged: RecentConversation[] = [...local];
        for (const item of (data.conversations || []) as RecentConversation[]) {
          if (!merged.some((conversation) => conversation.id === item.id)) merged.push(item);
        }
        merged.sort((a, b) => b.updatedAt - a.updatedAt);
        setRecentConversations(merged.slice(0, 50));
        saveConversationIndex(currentAgentId, merged);
      })
      .catch(() => undefined);
  }, [currentAgentId, view]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      for (const [id, transcript] of Object.entries(messagesByConversation)) saveConversationMessages(id, transcript);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [messagesByConversation]);

  useEffect(() => {
    if (!conversationId) return;
    const metadata = loadConversationIndex(currentAgentId);
    if (!metadata.some((item) => item.id === conversationId)) return;
    const next = metadata.map((item) => item.id === conversationId ? { ...item, documentIds: selectedDocumentIds } : item);
    saveConversationIndex(currentAgentId, next);
    setRecentConversations((current) => current.map((item) => item.id === conversationId ? { ...item, documentIds: selectedDocumentIds } : item));
  }, [conversationId, currentAgentId, selectedDocumentIds]);

  useEffect(() => {
    const stream = messagesEndRef.current?.parentElement;
    if (stream && (followOutputRef.current || messages.at(-1)?.role === 'user')) stream.scrollTop = stream.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
  }, [input]);

  const startNewChat = () => {
    const id = newConversation(currentAgentId);
    const item = { id, agentId: currentAgentId, title: 'New conversation', updatedAt: Date.now() };
    const next = [item, ...loadConversationIndex(currentAgentId).filter((conversation) => conversation.id !== id)];
    saveConversationIndex(currentAgentId, next);
    setRecentConversations(next.slice(0, 50));
    setMessagesByConversation((current) => ({ ...current, [id]: [] }));
    setConversationId(id);
    setSelectedDocumentIds([]);
    setView('chat');
  };

  const selectConversation = (item: RecentConversation) => {
    localStorage.setItem(`nexus_convo_${item.agentId}`, item.id);
    setCurrentAgentId(item.agentId);
    setConversationId(item.id);
    setSelectedDocumentIds(item.documentIds || []);
    setView('chat');
    const cached = messagesByConversation[item.id] || loadConversationMessages(item.id);
    if (cached) setMessagesByConversation((current) => ({ ...current, [item.id]: cached }));
    else {
      fetch(`/api/conversations?conversationId=${encodeURIComponent(item.id)}`)
        .then((response) => response.json())
        .then((data) => {
          const restored = (data.messages || []).map((message: any) => ({ id: message.id, role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content, createdAt: message.createdAt }));
          setMessagesByConversation((current) => ({ ...current, [item.id]: restored }));
          saveConversationMessages(item.id, restored);
        })
        .catch(() => undefined);
    }
  };

  const selectAgent = (id: string) => {
    const next = agentList.find((item) => item.id === id);
    setCurrentAgentId(id);
    if (next) setProvider(agentProviderId(next, provider));
    setView('chat');
  };

  const openNewAgent = () => setEditingAgent({
    id: `custom-${uid()}`,
    name: '',
    icon: 'A',
    gradient: 'linear-gradient(135deg,#0f8f87,#5a64c8)',
    model: '',
    modelLabel: 'Workspace model',
    systemPrompt: 'You are a focused specialist. Give clear, useful answers and state what you need when context is missing.',
    tools: ['memory_recall'],
    temperature: 0.5,
    welcomeMessage: 'Tell me what you want to accomplish.',
    provider: provider,
    role: 'New specialist',
    responsibilities: ['Turn requests into useful outcomes'],
  });

  const saveAgent = (nextAgent: AgentConfig) => {
    const sanitized = sanitizeAgentConfig(nextAgent);
    if (!sanitized) return;
    setCustomAgents((current) => {
      const next = current.some((item) => item.id === sanitized.id) ? current.map((item) => item.id === sanitized.id ? sanitized : item) : [...current, sanitized];
      saveCustomAgents(next);
      return next;
    });
    setCurrentAgentId(sanitized.id);
    const pinned = agentProviderId(sanitized, provider);
    setProvider(pinned);
    setEditingAgent(null);
  };

  const removeAgent = (id: string) => {
    setCustomAgents((current) => {
      const next = current.filter((item) => item.id !== id);
      saveCustomAgents(next);
      return next;
    });
    setRoomAgentsByRoom((current) => Object.fromEntries(
      Object.entries(current).map(([roomId, ids]) => [roomId, ids.filter((item) => item !== id)]),
    ));
    setEditingAgent(null);
  };

  const toggleRoomAgent = (id: string) => {
    setRoomAgentsByRoom((current) => {
      const ids = current[activeRoomId] || [];
      const next = ids.includes(id) ? ids.filter((item) => item !== id) : ids.length >= 5 ? ids : [...ids, id];
      return { ...current, [activeRoomId]: next };
    });
  };

  const updateMessage = useCallback((targetConversationId: string, id: string, update: (message: ChatMessage) => ChatMessage) => {
    setMessagesByConversation((current) => ({
      ...current,
      [targetConversationId]: (current[targetConversationId] || []).map((message) => message.id === id ? update(message) : message),
    }));
  }, []);

  const handleSseBlock = useCallback((block: string, messageId: string, targetConversationId: string, targetAgentId: string) => {
    let event = '';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!event) return;
    let data: any;
    try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }

    if (event === 'token') {
      updateMessage(targetConversationId, messageId, (message) => ({ ...message, content: message.content + data, thinking: null }));
    } else if (event === 'thinking') {
      updateMessage(targetConversationId, messageId, (message) => ({ ...message, thinking: data }));
    } else if (event === 'tool_call') {
      updateMessage(targetConversationId, messageId, (message) => ({ ...message, toolCalls: [...(message.toolCalls || []), data], thinking: null }));
    } else if (event === 'citation') {
      updateMessage(targetConversationId, messageId, (message) => ({ ...message, citations: data }));
    } else if (event === 'error') {
      updateMessage(targetConversationId, messageId, (message) => ({ ...message, content: `${message.content}\n\nError: ${data}`, streaming: false }));
    } else if (event === 'done') {
      updateMessage(targetConversationId, messageId, (message) => ({ ...message, streaming: false, thinking: null }));
      const storedIndex = loadConversationIndex(targetAgentId).map((conversation) => conversation.id === targetConversationId ? { ...conversation, isWorking: false, updatedAt: Date.now() } : conversation);
      saveConversationIndex(targetAgentId, storedIndex);
      setRecentConversations((current) => {
        if (activeAgentIdRef.current !== targetAgentId) return current;
        const next = current.map((conversation) => conversation.id === targetConversationId ? { ...conversation, isWorking: false, updatedAt: Date.now() } : conversation);
        return next;
      });
    }
  }, [updateMessage]);

  const sendSolo = useCallback(async () => {
    const text = input.trim();
    if ((!text && selectedDocumentIds.length === 0) || streaming) return;
    if (!hasKey) {
      setShowSettings(true);
      return;
    }

    const messageText = text || 'Please summarize the selected files.';
    const targetConversationId = conversationId || newConversation(currentAgentId);
    if (!conversationId) setConversationId(targetConversationId);
    const userMessage: ChatMessage = { id: uid(), role: 'user', content: messageText, createdAt: Date.now() };
    const assistantMessage: ChatMessage = { id: uid(), role: 'assistant', content: '', toolCalls: [], citations: [], thinking: null, streaming: true, createdAt: Date.now() };
    setInput('');
    const initialTranscript = [...(messagesByConversation[targetConversationId] || []), userMessage, assistantMessage];
    saveConversationMessages(targetConversationId, initialTranscript);
    setMessagesByConversation((current) => ({ ...current, [targetConversationId]: [...(current[targetConversationId] || []), userMessage, assistantMessage] }));
    const title = loadConversationIndex(currentAgentId).find((item) => item.id === targetConversationId)?.title;
    const conversationItem = { id: targetConversationId, agentId: currentAgentId, title: title && title !== 'New conversation' ? title : messageText.slice(0, 54), updatedAt: Date.now(), isWorking: true, workingSession: appSessionId.current, documentIds: selectedDocumentIds };
    const updatedIndex = [conversationItem, ...loadConversationIndex(currentAgentId).filter((item) => item.id !== targetConversationId)];
    saveConversationIndex(currentAgentId, updatedIndex);
    setRecentConversations(updatedIndex.slice(0, 50));
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: currentAgentId,
          conversationId: targetConversationId,
          message: messageText,
          history: (messagesByConversation[targetConversationId] || []).filter((item) => !item.streaming && item.content).slice(-24).map((item) => ({ role: item.role, content: item.content.slice(0, 16000) })),
          apiKey: activeApiKey || undefined,
          agent,
          teamAgents: agentList,
          apiKeys,
          workspaceId,
          documentIds: selectedDocumentIds,
          provider: requestProvider(activeProvider, agent.model),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('The server returned no response stream.');
      let terminal = false;
      await consumeSse(response.body, (event, data) => {
        if (event === 'done' || event === 'error') terminal = true;
        handleSseBlock(`event: ${event}\ndata: ${JSON.stringify(data)}`, assistantMessage.id, targetConversationId, currentAgentId);
      });
      if (!terminal && !controller.signal.aborted) throw new Error('Connection ended before the answer completed.');
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        updateMessage(targetConversationId, assistantMessage.id, (message) => ({ ...message, content: `${message.content}\n\nError: ${error.message}`, streaming: false }));
      } else {
        updateMessage(targetConversationId, assistantMessage.id, (message) => ({ ...message, content: message.content || 'Generation stopped.', streaming: false }));
      }
    } finally {
      setStreaming(false);
      updateMessage(targetConversationId, assistantMessage.id, (message) => ({ ...message, streaming: false, thinking: null }));
      const storedIndex = loadConversationIndex(currentAgentId).map((item) => item.id === targetConversationId ? { ...item, isWorking: false, updatedAt: Date.now() } : item);
      saveConversationIndex(currentAgentId, storedIndex);
      setRecentConversations((current) => {
        if (activeAgentIdRef.current !== conversationItem.agentId) return current;
        const next = current.map((item) => item.id === targetConversationId ? { ...item, isWorking: false, updatedAt: Date.now() } : item);
        return next;
      });
      abortRef.current = null;
    }
  }, [activeApiKey, activeProvider, agent, agentList, apiKeys, conversationId, currentAgentId, handleSseBlock, hasKey, input, messagesByConversation, requestProvider, selectedDocumentIds, streaming, updateMessage, workspaceId]);

  const runRoom = useCallback(async () => {
    const text = input.trim() || (selectedDocumentIds.length ? 'Summarize the selected files as a team.' : '');
    if (!text || streaming) return;
    if (!roomHasKey) {
      setShowSettings(true);
      return;
    }
    if (!roomAgents.length) {
      setRoomError('Select at least one agent for this room.');
      return;
    }
    const run: RoomRun = {
      id: uid(),
      message: text,
      status: 'running',
      createdAt: Date.now(),
      steps: roomAgents.map((item) => ({ agentId: item.id, role: item.role || item.name, provider: agentProviderId(item, provider), status: 'queued' })),
    };
    setInput('');
    setRoomError('');
    setRoomRunsByRoom((current) => ({ ...current, [activeRoomId]: run }));
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/rooms/${activeRoomId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          agents: roomAgents,
          stream: true,
          workspaceId,
          documentIds: selectedDocumentIds,
          apiKey: activeApiKey || undefined,
          apiKeys,
          provider: requestProvider(provider),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('No room execution stream was returned.');
      let completed = false;
      await consumeSse(response.body, (event, data) => {
        if (event === 'error') throw new Error(String(data));
        setRoomRunsByRoom((current) => {
          const existing = current[activeRoomId];
          if (!existing || existing.id !== run.id) return current;
          if (event === 'step') {
            return { ...current, [activeRoomId]: { ...existing, steps: existing.steps.map((step) => step.agentId === data.step.agentId ? data.step : step) } };
          }
          if (event === 'phase') return { ...current, [activeRoomId]: { ...existing, phase: data.phase } };
          if (event === 'done') {
            completed = true;
            return { ...current, [activeRoomId]: { ...existing, ...data, id: run.id } };
          }
          return current;
        });
        if (event === 'done') {
          completed = true;
          if (data.status === 'failed') setRoomError(data.synthesis || 'No specialist returned an answer.');
        }
      });
      if (!completed) throw new Error('Room connection ended before completion.');
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        setRoomRunsByRoom((current) => {
          const existing = current[activeRoomId];
          if (!existing || existing.id !== run.id) return current;
          return { ...current, [activeRoomId]: { ...existing, status: 'failed', steps: existing.steps.map((step) => step.status === 'completed' ? step : { ...step, status: 'failed' as const, error: 'Execution stopped.' }) } };
        });
        setRoomError('Room run stopped.');
      } else {
        setRoomRunsByRoom((current) => {
          const existing = current[activeRoomId];
          if (existing && existing.id === run.id && existing.status !== 'running') return current;
          return { ...current, [activeRoomId]: { ...run, status: 'failed', steps: run.steps.map((step) => ({ ...step, status: 'failed' as const })) } };
        });
        setRoomError(error.message || 'Room execution failed');
      }
    } finally {
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [activeApiKey, activeRoomId, apiKeys, input, provider, requestProvider, roomAgents, roomHasKey, selectedDocumentIds, streaming, workspaceId]);

  const send = view === 'rooms' ? runRoom : sendSolo;

  return (
    <div className="workspace-shell">
      <Sidebar view={view} setView={setView} activeRoomId={activeRoomId} setActiveRoomId={setActiveRoomId} currentAgentId={currentAgentId} onSelectAgent={selectAgent} onNewChat={startNewChat} onNewAgent={openNewAgent} agents={agentList} recentConversations={recentConversations} activeConversationId={conversationId} onSelectConversation={selectConversation} />
      <main className="workspace-main">
        <nav className="compact-navigation" aria-label="Workspace navigation">
          <label>View<select aria-label="Workspace view" value={view} onChange={(event) => setView(event.target.value as WorkspaceView)}><option value="chat">Chat</option><option value="rooms">Team rooms</option><option value="agents">Agent library</option></select></label>
          {view === 'rooms' ? <label>Room<select aria-label="Active room" value={activeRoomId} onChange={(event) => setActiveRoomId(event.target.value)}>{ROOMS.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label> : <label>Agent<select aria-label="Active agent" value={currentAgentId} onChange={(event) => selectAgent(event.target.value)}>{agentList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <button className="secondary-button" onClick={startNewChat} aria-label="New chat">＋</button>
        </nav>
        <Topbar view={view} activeRoom={activeRoom} agent={agent} provider={activeProvider} hasKey={view === 'rooms' ? roomHasKey : hasKey} documentCount={documents.length} onOpenSkills={() => setShowSkills(true)} onOpenDocuments={() => setShowDocuments(true)} onOpenSettings={() => setShowSettings(true)} />
        {view === 'rooms' ? (
          <RoomView room={activeRoom} agents={agentList} roomAgentIds={roomAgentIds} onToggleAgent={toggleRoomAgent} onOpenAgentLibrary={() => setView('agents')} run={roomRun} error={roomError} streaming={streaming} input={input} setInput={setInput} onSend={send} onStop={() => abortRef.current?.abort()} onChoosePrompt={setInput} selectedFiles={documents.filter((document) => selectedDocumentIds.includes(document.id)).map(({ id, name }) => ({ id, name }))} onUploadFile={(file) => { void uploadDocument(file); }} onRemoveFile={(id) => setSelectedDocumentIds((current) => current.filter((item) => item !== id))} uploadingFile={uploadingDocument} fileError={documentError} />
        ) : view === 'agents' ? (
          <AgentsView agents={agentList} onNewAgent={openNewAgent} onEditAgent={setEditingAgent} onSelectAgent={selectAgent} />
        ) : (
          <div className="solo-layout">
            <section className="conversation-panel">
              <AgentHeader agent={agent} />
              <div className="message-stream" role="log" aria-live="polite" aria-busy={streaming} aria-label="Conversation messages" onScroll={(event) => { const element = event.currentTarget; followOutputRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
                {messages.length === 0 ? <EmptyState agent={agent} onChoosePrompt={setInput} /> : messages.map((message) => <MessageView key={message.id} message={message} agent={agent} />)}
                <div ref={messagesEndRef} />
              </div>
              <Composer input={input} setInput={setInput} onSend={send} onStop={() => abortRef.current?.abort()} streaming={streaming} textareaRef={textareaRef} placeholder={selectedDocumentIds.length ? `Ask about ${selectedDocumentIds.length} attached file${selectedDocumentIds.length === 1 ? '' : 's'}…` : hasKey ? `Message ${agent.name}` : 'Configure a provider to start'} inputLabel={`Message ${agent.name}`} hasKey={hasKey} onOpenSettings={() => setShowSettings(true)} selectedFiles={documents.filter((document) => selectedDocumentIds.includes(document.id)).map(({ id, name }) => ({ id, name }))} uploadingFile={uploadingDocument} fileError={documentError} onUploadFile={(file) => { void uploadDocument(file); }} onRemoveFile={(id) => setSelectedDocumentIds((current) => current.filter((item) => item !== id))} />
            </section>
            <AgentInspector agent={agent} provider={activeProvider} onEdit={() => setEditingAgent(agent)} />
          </div>
        )}
      </main>
      {showSkills && <SkillsPanel onClose={() => setShowSkills(false)} />}
      {showDocuments && <DocumentsModal documents={documents} selectedDocumentIds={selectedDocumentIds} setSelectedDocumentIds={setSelectedDocumentIds} uploading={uploadingDocument} error={documentError} instructions={documentInstructions} setInstructions={setDocumentInstructions} onUpload={uploadDocument} onDelete={removeDocument} onClose={() => { setShowDocuments(false); setDocumentError(''); }} />}
      {showSettings && <SettingsModal provider={provider} settings={providerSettings} apiKeys={apiKeys} serverProviders={serverProviders} onSave={(key, settings) => { setProvider(settings.provider); setProviderSettings(settings); setApiKeys((current) => ({ ...current, [settings.provider]: key })); saveKey(settings.provider, key); localStorage.setItem('nexus_provider_settings', JSON.stringify(settings)); setShowSettings(false); }} onClose={() => setShowSettings(false)} />}
      {editingAgent && <AgentEditorModal agent={editingAgent} onSave={saveAgent} onDelete={removeAgent} onClose={() => setEditingAgent(null)} />}
    </div>
  );
}

function Sidebar({ view, setView, activeRoomId, setActiveRoomId, currentAgentId, onSelectAgent, onNewChat, onNewAgent, agents = Object.values(AGENTS), recentConversations = [], activeConversationId, onSelectConversation }: {
  view: WorkspaceView;
  setView: (view: WorkspaceView) => void;
  activeRoomId: string;
  setActiveRoomId: (id: string) => void;
  currentAgentId: AgentId;
  onSelectAgent: (id: string) => void;
  onNewChat: () => void;
  onNewAgent: () => void;
  agents?: AgentConfig[];
  recentConversations?: RecentConversation[];
  activeConversationId: string;
  onSelectConversation: (conversation: RecentConversation) => void;
}) {
  return (
    <aside className="app-rail">
      <div className="brand-lockup"><div className="brand-mark">N</div><div><strong>Nexus</strong><span>Agent workspace</span></div></div>
      <div className="workspace-switcher"><div className="workspace-symbol">N</div><div className="workspace-copy"><strong>Nexus demo</strong><span>Interview workspace</span></div><span className="chevron">⌄</span></div>
      <nav className="primary-nav" aria-label="Primary navigation">
        <button className={view === 'rooms' ? 'active' : ''} onClick={() => setView('rooms')}><NavIcon type="rooms" />Team rooms<span className="nav-count">3</span></button>
        <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}><NavIcon type="chat" />Solo chat</button>
        <button className={view === 'agents' ? 'active' : ''} onClick={() => setView('agents')}><NavIcon type="agents" />Agent library</button>
      </nav>
      <div className="rail-label">Rooms</div>
      <div className="room-list">
        {ROOMS.map((room) => <button key={room.id} className={`room-item ${view === 'rooms' && activeRoomId === room.id ? 'active' : ''}`} onClick={() => { setActiveRoomId(room.id); setView('rooms'); }}><span className="room-dot" /><span className="room-copy"><strong>{room.name}</strong><small>{room.detail}</small></span><span className="room-agents">{room.defaultAgents.length}</span></button>)}
      </div>
      <div className="rail-label agent-label">Agents</div>
      <div className="agent-list">
        {agents.map((item) => <button key={item.id} className={`agent-nav-item ${view === 'chat' && currentAgentId === item.id ? 'active' : ''}`} onClick={() => onSelectAgent(item.id)}><span className="mini-avatar" style={{ background: item.gradient }}>{item.name.slice(0, 1)}</span><span>{item.name.replace(' Agent', '')}</span><span className="agent-online" /></button>)}
      </div>
      <div className="rail-footer"><div className="profile-avatar">HH</div><div className="profile-copy"><strong>Harman Hanjra</strong><span>Product builder</span></div><a className="more-button" aria-label="View creator profile" href="https://github.com/harmanhanjra" target="_blank" rel="noopener noreferrer">↗</a></div>
      {view === 'chat' && recentConversations.length > 0 && <><div className="rail-label recent-chat-label">Recent chats</div><div className="recent-chat-list">{recentConversations.map((conversation) => <button key={conversation.id} className={`recent-chat-item ${activeConversationId === conversation.id ? 'active' : ''}`} title={conversation.title} onClick={() => onSelectConversation(conversation)}><span className={`recent-chat-dot ${conversation.isWorking ? 'working' : ''}`} /><span>{conversation.title || 'New conversation'}</span>{conversation.isWorking && <small>Working</small>}</button>)}</div></>}
      <button className="new-chat-button" onClick={onNewChat}><span>＋</span> New conversation</button>
      <button className="new-chat-button" onClick={onNewAgent}><span>＋</span> Create agent</button>
    </aside>
  );
}

function Topbar({ view, activeRoom, agent, provider, hasKey, documentCount, onOpenDocuments, onOpenSettings, onOpenSkills }: { view: WorkspaceView; activeRoom: typeof ROOMS[number]; agent: AgentConfig; provider: ProviderId; hasKey: boolean; documentCount: number; onOpenSkills: () => void; onOpenDocuments: () => void; onOpenSettings: () => void }) {
  const title = view === 'rooms' ? activeRoom.name : view === 'agents' ? 'Agent library' : agent.name;
  return <header className="topbar"><div className="topbar-title"><span className="eyebrow">{view === 'rooms' ? 'Team room' : view === 'agents' ? 'Configuration' : 'Solo agent'}</span><div className="title-row"><h1>{title}</h1>{view === 'rooms' && <span className="live-badge"><span />Live</span>}</div></div><div className="topbar-actions"><button className="documents-open-button" onClick={onOpenSkills}>Skills</button><button className="documents-open-button" onClick={onOpenDocuments}>Files <span>{documentCount}</span></button><div className="provider-status"><span className="status-pulse" />{providerLabel(provider)}<span className="status-divider" />{hasKey ? 'Connected' : 'Needs key'}</div><button className="icon-action" aria-label="Open settings" onClick={onOpenSettings}>⚙</button><div className="topbar-avatar">HH</div></div></header>;
}

function RoomView({ room, agents, roomAgentIds, onToggleAgent, onOpenAgentLibrary, run, error, streaming, input, setInput, onSend, onStop, onChoosePrompt, selectedFiles, onUploadFile, onRemoveFile, uploadingFile, fileError }: { selectedFiles: Array<{ id: string; name: string }>; onUploadFile: (file: File) => void; onRemoveFile: (id: string) => void; uploadingFile: boolean; fileError: string; room: typeof ROOMS[number]; agents: AgentConfig[]; roomAgentIds: string[]; onToggleAgent: (id: string) => void; onOpenAgentLibrary: () => void; run: RoomRun | null; error: string; streaming: boolean; input: string; setInput: (value: string) => void; onSend: () => void; onStop: () => void; onChoosePrompt: (value: string) => void }) {
  const completed = run?.steps.filter((step) => step.status === 'completed').length || 0;
  const total = run?.steps.length || roomAgentIds.length;
  return (
    <div className="room-layout">
      <section className="room-main">
        <div className="room-hero">
          <div>
            <span className="section-kicker">Shared mission · {room.name}</span>
            <h2>{room.mission}</h2>
            <p>{room.missionDetail}</p>
            <div className="room-coordination-strip" aria-label="Coordination protocol">
              <span><i>01</i>Discuss</span><span className="coord-arrow">→</span>
              <span><i>02</i>Peer-review</span><span className="coord-arrow">→</span>
              <span><i>03</i>Synthesize</span>
            </div>
          </div>
          <div className="hero-signal">
            <span>Room health</span>
            <strong>{run ? `${completed}/${total} answered` : 'All systems nominal'}</strong>
            <div className="health-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
          </div>
        </div>
        <div className="room-thread">
          {run ? <RoomThread run={run} agents={agents} /> : <RoomEmpty roomName={room.name} onChoosePrompt={onChoosePrompt} />}
          {error && <div className="room-error" role="alert">{error}</div>}
        </div>
        <Composer input={input} setInput={setInput} onSend={onSend} onStop={onStop} streaming={streaming} placeholder="Ask the room to investigate, decide, or build…" inputLabel="Message the team room" hasKey={true} onOpenSettings={() => undefined} selectedFiles={selectedFiles} onUploadFile={onUploadFile} onRemoveFile={onRemoveFile} uploadingFile={uploadingFile} fileError={fileError} room />
      </section>
          <RoomInspector run={run} room={room} agents={agents} roomAgentIds={roomAgentIds} onToggleAgent={onToggleAgent} onOpenAgentLibrary={onOpenAgentLibrary} />
    </div>
  );
}

function RoomEmpty({ roomName, onChoosePrompt }: { roomName: string; onChoosePrompt: (value: string) => void }) {
  const prompts = ['Compare our launch plan against the top three competitors', 'Turn this research into a product positioning brief', 'Review the architecture and flag the biggest delivery risks'];
  return <div className="room-empty"><div className="room-empty-icon">N</div><span className="section-kicker">{roomName} · Room ready</span><h3>What should the team solve?</h3><p>Each specialist reads the team&apos;s discussion in order, builds on a teammate&apos;s point, challenges a weak one, then reviews the full room before a shared answer is prepared.</p><div className="room-prompts">{prompts.map((prompt) => <button key={prompt} onClick={() => onChoosePrompt(prompt)}>{prompt}<span>→</span></button>)}</div></div>;
}

function splitContribution(output: string): { contribution: string; review: string } {
  const marker = '**Response to teammates**';
  const index = output.indexOf(marker);
  if (index === -1) return { contribution: output, review: '' };
  return { contribution: output.slice(0, index).trim(), review: output.slice(index + marker.length).trim() };
}

function RoomThread({ run, agents }: { run: RoomRun; agents: AgentConfig[] }) {
  return <div className="room-thread-content"><div className="run-header"><div><span className="section-kicker">Run {run.id}</span><h3>{run.message}</h3></div><span className={`run-state ${run.status}`} role="status">{run.status === 'running' ? run.phase === 'review' ? 'Peer review' : run.phase === 'synthesize' ? 'Synthesizing' : 'Agents are discussing' : run.status}</span></div><div className="coordination-timeline" aria-label="Agent coordination order">{run.steps.map((step, index) => <span key={step.agentId} className={`coord-node ${step.status}`} title={`${step.role}: ${step.status}`}>{index + 1}</span>)}</div><div className="agent-step-grid">{run.steps.map((step, index) => { const item = agents.find((candidate) => candidate.id === step.agentId); const { contribution, review } = splitContribution(step.output || ''); return <div className={`agent-step ${step.status}`} key={step.agentId}><div className="step-head"><span className="step-order">{index + 1}</span><span className="mini-avatar" style={{ background: item?.gradient || AGENTS.research.gradient }}>{(item?.name || 'Agent').slice(0, 1)}</span><div><strong>{item?.name || step.agentId}</strong><span>{step.role} · {typeof step.provider === 'string' ? step.provider : providerLabel(String(step.provider))}</span></div><StatusMark status={step.status} /></div>{step.skills && step.skills.length > 0 && <div className="tool-row"><span className="tool-pill">Skills: {step.skills.join(', ')}</span></div>}{contribution && <div className="message-body step-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(contribution) }} />}{review && <div className="peer-review-block"><span className="peer-review-label">Response to teammates</span><div className="message-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(review) }} /></div>}{!contribution && step.status === 'running' && <div className="thinking-line" role="status"><span className="thinking-dot" aria-hidden="true" />Reading teammates and drafting…</div>}{step.error && <small className="step-error">{step.error}</small>}{typeof step.durationMs === 'number' && <small>Completed in {formatDuration(step.durationMs)}</small>}</div>; })}</div>{run.synthesis && <div className="synthesis-card"><div className="synthesis-label"><span className="synthesis-mark">✦</span> Room synthesis</div><div className="message-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(run.synthesis) }} /></div>}</div>;
}

function RoomInspector({ run, room, agents, roomAgentIds, onToggleAgent, onOpenAgentLibrary }: { run: RoomRun | null; room: typeof ROOMS[number]; agents: AgentConfig[]; roomAgentIds: string[]; onToggleAgent: (id: string) => void; onOpenAgentLibrary: () => void }) {
  return <aside className="room-inspector"><div className="inspector-header"><div><span className="section-kicker">Live execution</span><h3>Room inspector</h3></div><span className="inspector-live">●</span></div><div className="inspector-section"><div className="inspector-label">Participants <span>{roomAgentIds.length}/5</span></div><div className="participant-picker">{agents.map((item) => { const selected = roomAgentIds.includes(item.id); const step = run?.steps.find((candidate) => candidate.agentId === item.id); return <button className={`participant-option ${selected ? 'selected' : ''}`} key={item.id} onClick={() => onToggleAgent(item.id)}><span className="mini-avatar" style={{ background: item.gradient }}>{item.name.slice(0, 1)}</span><span className="participant-copy"><strong>{item.name}</strong><small>{step?.status === 'running' ? 'Working now' : item.role || 'Specialist'}</small></span>{selected ? <StatusMark status={step?.status || 'queued'} /> : <span className="add-agent-mark">＋</span>}</button>; })}</div><button className="library-link" onClick={onOpenAgentLibrary}>Manage agent library <span>→</span></button></div><div className="inspector-section"><div className="inspector-label">Protocol</div><div className="protocol-row"><span>01</span><div><strong>Team discussion</strong><small>Each agent reads prior contributions</small></div><CheckMark /></div><div className="protocol-row"><span>02</span><div><strong>Peer review</strong><small>Every agent responds to the full room</small></div><CheckMark /></div><div className="protocol-row"><span>03</span><div><strong>Synthesis</strong><small>One answer with gaps called out</small></div><CheckMark /></div></div><div className="inspector-footnote">Room: {room.name}. Agent definitions are stored in this browser for the demo.</div></aside>;
}

function StatusMark({ status }: { status: RoomStep['status'] }) {
  const labels = { queued: 'Queued', running: 'Working', completed: 'Done', failed: 'Failed' };
  return <span className={`status-mark ${status}`} title={labels[status]} />;
}

function CheckMark() {
  return <span className="check-mark">✓</span>;
}

function AgentsView({ agents, onNewAgent, onEditAgent, onSelectAgent }: { agents: AgentConfig[]; onNewAgent: () => void; onEditAgent: (agent: AgentConfig) => void; onSelectAgent: (id: string) => void }) {
  return <div className="agents-page"><div className="agents-page-header"><div><span className="section-kicker">Workspace registry</span><h2>Agent library</h2><p>Create specialists, assign their model, and change responsibilities whenever the work changes.</p></div><button className="primary-button" onClick={onNewAgent}>＋ Create agent</button></div><div className="agent-library-grid">{agents.map((item) => <article className="library-card" key={item.id}><div className="library-card-top"><span className="large-avatar" style={{ background: item.gradient }}>{item.name.slice(0, 1)}</span><span className="library-status">Ready</span></div><h3>{item.name}</h3><p>{item.role || 'Specialist agent'}</p><div className="library-model"><span>{providerLabel(item.providerId || item.provider || 'nvidia')}</span><strong>{item.model || 'Automatic workspace model'}</strong></div><div className="library-responsibilities">{(item.responsibilities || []).slice(0, 3).map((responsibility) => <span key={responsibility}>{responsibility}</span>)}</div><div className="library-card-actions"><button className="secondary-button" onClick={() => onEditAgent(item)}>Configure</button><button className="text-button" onClick={() => onSelectAgent(item.id)}>Open chat →</button></div></article>)}</div></div>;
}

function AgentEditorModal({ agent, onSave, onDelete, onClose }: { agent: AgentConfig; onSave: (agent: AgentConfig) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(agent);
  const [responsibilities, setResponsibilities] = useState((agent.responsibilities || []).join('\n'));
  const dialogRef = useModalDismiss(onClose);
  const isBuiltin = Boolean(AGENTS[agent.id]);
  const update = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const save = () => onSave({ ...draft, responsibilities: responsibilities.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 12), modelLabel: draft.model || 'Inherits workspace model' });
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="settings-modal agent-editor-modal" role="dialog" aria-modal="true" aria-labelledby="agent-editor-title"><div className="modal-header"><div><span className="section-kicker">Agent configuration</span><h2 id="agent-editor-title">{isBuiltin ? `Configure ${agent.name}` : 'Create an agent'}</h2></div><button className="close-button" onClick={onClose} aria-label="Close editor">×</button></div><div className="settings-form"><div className="editor-grid"><label>Name<input data-autofocus value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Compliance reviewer" /></label><label>Role<input value={draft.role || ''} onChange={(event) => update('role', event.target.value)} placeholder="e.g. Risk analyst" /></label></div><label>Responsibilities <span className="field-hint">One responsibility per line</span><textarea value={responsibilities} onChange={(event) => setResponsibilities(event.target.value)} rows={4} placeholder="Review claims for evidence\nFlag compliance risks" /></label><label>System instructions<textarea value={draft.systemPrompt} onChange={(event) => update('systemPrompt', event.target.value)} rows={5} /></label><div className="editor-grid"><label>Provider<select value={draft.providerId === 'openai' ? 'openai-compatible' : draft.providerId || draft.provider || ''} onChange={(event) => setDraft({ ...draft, provider: (event.target.value || undefined) as ProviderId | undefined, providerId: event.target.value === 'openai-compatible' ? 'openai' : event.target.value || undefined })}><option value="">Inherit workspace provider</option><option value="nvidia">NVIDIA NIM</option><option value="openai-compatible">OpenAI-compatible</option></select></label><label>Model<input value={draft.model} onChange={(event) => update('model', event.target.value)} placeholder="Automatic workspace model" /></label></div><div className="editor-grid"><label>Temperature<input type="range" min="0" max="1" step="0.1" value={draft.temperature} onChange={(event) => update('temperature', Number(event.target.value))} /></label><div><span className="field-label">Tools</span><div className="tool-toggles"><button className={draft.tools.includes('memory_recall') ? 'selected' : ''} onClick={() => update('tools', draft.tools.includes('memory_recall') ? draft.tools.filter((tool) => tool !== 'memory_recall') : [...draft.tools, 'memory_recall'])}>Memory</button><button className={draft.tools.includes('document_search') ? 'selected' : ''} onClick={() => update('tools', draft.tools.includes('document_search') ? draft.tools.filter((tool) => tool !== 'document_search') : [...draft.tools, 'document_search'])}>Document search</button><button className={draft.tools.includes('calculator') ? 'selected' : ''} onClick={() => update('tools', draft.tools.includes('calculator') ? draft.tools.filter((tool) => tool !== 'calculator') : [...draft.tools, 'calculator'])}>Calculator</button><button className={draft.tools.includes('web_search') ? 'selected' : ''} onClick={() => update('tools', draft.tools.includes('web_search') ? draft.tools.filter((tool) => tool !== 'web_search') : [...draft.tools, 'web_search'])}>Web search</button></div></div></div><div className="settings-note">Changes apply to this browser workspace. In production, agent definitions should be stored in an authenticated workspace database.</div></div><div className="modal-footer"><button className="danger-text-button" onClick={() => onDelete(agent.id)}>{isBuiltin ? 'Reset to default' : 'Delete agent'}</button><span className="footer-spacer" /><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={save} disabled={!draft.name.trim() || !draft.systemPrompt.trim()}>Save agent</button></div></section></div>;
}

function AgentHeader({ agent }: { agent: AgentConfig }) {
  return <div className="agent-header"><div className="agent-identity"><span className="large-avatar" style={{ background: agent.gradient }}>{agent.name.slice(0, 1)}</span><div><span className="section-kicker">{agent.id === 'head' ? 'Team coordinator' : 'Active specialist'}</span><h2>{agent.name}</h2><p>{agent.modelLabel}</p></div></div><div className="agent-header-meta"><span className="tag">{agent.tools.length} tools</span><span className="tag">{agent.temperature} temperature</span></div></div>;
}

function EmptyState({ agent, onChoosePrompt }: { agent: AgentConfig; onChoosePrompt: (value: string) => void }) {
  const prompts = agent.id === 'head' ? ['Ask Coding to write a Python palindrome function and Content to explain it', 'Ask Research and Business to compare two product ideas'] : agent.id === 'research' ? ['What are the latest breakthroughs in AI agents?', 'Compare LangGraph and CrewAI for production'] : ['Help me turn an idea into a clear next step', 'Give me a concise, structured answer'];
  return <div className="empty-state"><div className="empty-avatar" style={{ background: agent.gradient }}>{agent.name.slice(0, 1)}</div><span className="section-kicker">Independent agent</span><h3>{agent.name} is ready.</h3><p>{agent.welcomeMessage.replace(/\*\*/g, '').split('\n')[0]}</p><div className="prompt-list">{prompts.map((prompt) => <button key={prompt} onClick={() => onChoosePrompt(prompt)}>{prompt}<span>→</span></button>)}</div></div>;
}

function MessageView({ message, agent }: { message: ChatMessage; agent: AgentConfig }) {
  const isUser = message.role === 'user';
  return <article className={`message-row ${isUser ? 'user' : 'assistant'}`}><div className="message-avatar" style={!isUser ? { background: agent.gradient } : undefined}>{isUser ? 'HH' : agent.name.slice(0, 1)}</div><div className="message-block"><div className="message-meta"><strong>{isUser ? 'You' : agent.name}</strong><span>{formatTime(message.createdAt)}</span></div>{message.toolCalls && message.toolCalls.length > 0 && <div className="tool-row">{message.toolCalls.map((tool, index) => <span className="tool-pill" title={tool.result} key={`${tool.name}-${index}`}><span className="tool-bullet" />{tool.name}{tool.result && <small>{tool.result}</small>}</span>)}</div>}{message.thinking && !message.content && <div className="thinking-line" role="status"><span className="thinking-dot" aria-hidden="true" />{message.thinking}</div>}{message.content && <div className="message-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) + (message.streaming ? '<span class="stream-caret"></span>' : '') }} />}{message.citations && message.citations.length > 0 && <div className="citation-list"><span>Sources</span>{message.citations.map((citation) => <a key={citation.n} href={citation.uri} target="_blank" rel="noopener noreferrer">{citation.title}</a>)}</div>}</div></article>;
}

function AgentInspector({ agent, provider, onEdit }: { agent: AgentConfig; provider: ProviderId; onEdit: () => void }) {
  return <aside className="solo-inspector"><div className="inspector-header"><div><span className="section-kicker">Agent profile</span><h3>Capabilities</h3></div><button className="plain-icon" aria-label="Agent options" onClick={onEdit}>•••</button></div><div className="profile-summary"><span className="large-avatar" style={{ background: agent.gradient }}>{agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><span>{agent.modelLabel}</span></div></div><div className="inspector-section"><div className="inspector-label">Available tools</div><div className="capability-list">{agent.tools.map((tool) => <div key={tool}><span className="capability-icon">✓</span><span>{toolLabel(tool)}</span><small>Active</small></div>)}</div></div><div className="inspector-section"><div className="inspector-label">Routing</div><div className="route-card"><span>Provider</span><strong>{providerLabel(provider)}</strong><small>Server-side key preferred</small></div></div><div className="inspector-footnote">{agent.id === 'head' ? 'Command specialists from this chat. Assignments use your current provider and selected files; Stop cancels the whole run.' : 'Ask across domains or move to a team room for a shared review.'}</div></aside>;
}

function NavIcon({ type }: { type: 'rooms' | 'chat' | 'agents' }) {
  if (type === 'rooms') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4.2A2.5 2.5 0 0 1 4 13.5v-8Z" /><path d="M8 8h8M8 11.5h5" /></svg>;
  if (type === 'agents') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="8" r="3" /><path d="M16 8.5a3 3 0 0 1 0 5.8M19 19v-1a3 3 0 0 0-2-2.8" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v6a2.5 2.5 0 0 1-2.5 2.5H12l-4 3v-3.2A2.5 2.5 0 0 1 5 11.5v-6Z" /><path d="M9 7.5h6M9 10h4" /></svg>;
}

function DocumentsModal({ documents, selectedDocumentIds, setSelectedDocumentIds, uploading, error, instructions, setInstructions, onUpload, onDelete, onClose }: {
  documents: WorkspaceDocument[];
  selectedDocumentIds: string[];
  setSelectedDocumentIds: (ids: string[]) => void;
  uploading: boolean;
  error: string;
  instructions: string;
  setInstructions: (value: string) => void;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const toggle = (id: string) => setSelectedDocumentIds(selectedDocumentIds.includes(id) ? selectedDocumentIds.filter((item) => item !== id) : [...selectedDocumentIds, id]);
  const dialogRef = useModalDismiss(onClose);
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !uploading) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="settings-modal document-library-modal" role="dialog" aria-modal="true" aria-labelledby="documents-title"><div className="modal-header"><div><span className="section-kicker">Workspace knowledge</span><h2 id="documents-title">File library</h2></div><button className="close-button" onClick={onClose} aria-label="Close file library">×</button></div><div className="document-library-content"><p className="document-intro">Upload documents to save the original, extract every readable section, and generate a brief. Select files as chat sources for answers grounded in their exact text and locations.</p><label className="document-instructions">Brief preferences <span>Optional</span><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={2} placeholder="For example: explain this for a new engineer; emphasize risks and action items." /></label><label className={`document-upload-zone ${uploading ? 'busy' : ''}`}><input type="file" disabled={uploading} accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.odg,.rtf,.csv,.md,.markdown,.html,.htm,.epub,.txt,.text,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.h,.cpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.yaml,.yml,.toml,.xml,.css,.scss,.diff,.log,.ipynb,.ini,.env,.conf" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ''; }} /><span className="upload-icon">↑</span><strong>{uploading ? 'Reading file…' : 'Choose a file to upload'}</strong><small>Up to 15 MB · PDF, Office, OpenDocument, EPUB, CSV, Markdown, HTML, text and code</small></label>{error && <div className="document-error" role="alert">{error}</div>}<div className="document-library-heading"><strong>Saved files</strong><span>{documents.length} / 100</span></div>{documents.length === 0 ? <div className="document-empty">No files yet. Upload a document to make it available for grounded chat.</div> : <div className="document-list">{documents.map((document) => <article className="document-card" key={document.id}><label className="document-card-top"><input type="checkbox" checked={selectedDocumentIds.includes(document.id)} onChange={() => toggle(document.id)} /><span className="document-file-icon">{document.name.split('.').at(-1)?.slice(0, 4).toUpperCase() || 'FILE'}</span><span className="document-file-name"><strong title={document.name}>{document.name}</strong><small>{(document.sizeBytes / 1024).toFixed(document.sizeBytes < 1024 * 1024 ? 0 : 1)} KB · {document.outline.length} parts · {document.summaryStatus}</small></span><button className="document-delete" type="button" aria-label={`Delete ${document.name}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onDelete(document.id); }}>Delete</button></label><details className="document-summary"><summary>Read document brief</summary><div className="document-summary-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(document.summary) }} />{document.outline.length > 0 && <div className="document-outline"><strong>Extracted structure</strong><span>{document.outline.slice(0, 12).join(' · ')}{document.outline.length > 12 ? ` · +${document.outline.length - 12} more` : ''}</span></div>}</details></article>)}</div>}<p className="document-scope-note">Selected files apply to solo chat and team rooms. When selected, answers are restricted to retrieved file passages and cite the source. Your originals, extracted text, summaries and search chunks are saved in the document database.</p></div><div className="modal-footer"><span className="footer-spacer" /><button className="primary-button" onClick={onClose}>Done</button></div></section></div>;
}

function SettingsModal({ provider, settings, apiKeys, serverProviders, onSave, onClose }: {
  provider: ProviderId; settings: ProviderSettings; apiKeys: Record<ProviderId, string>;
  serverProviders: Record<ProviderId, boolean>;
  onSave: (key: string, settings: ProviderSettings) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState({ ...settings, provider });
  const [keys, setKeys] = useState({ ...apiKeys });
  const [error, setError] = useState('');
  const dialogRef = useModalDismiss(onClose);
  const save = () => {
    try {
      const url = new URL(draft.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter a valid HTTP or HTTPS API URL without embedded credentials.');
      onSave(keys[draft.provider].trim(), { ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim() });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the provider settings.'); }
  };
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-header"><div><span className="section-kicker">Workspace configuration</span><h2 id="settings-title">Provider settings</h2></div><button className="close-button" onClick={onClose} aria-label="Close settings">×</button></div>
      <div className="settings-form">
        <label>Provider<select value={draft.provider} onChange={(event) => {
          const next = event.target.value as ProviderId;
          setDraft({ provider: next, baseUrl: next === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' : 'https://api.openai.com/v1', model: '' });
          setError('');
        }}><option value="nvidia">NVIDIA NIM</option><option value="openai-compatible">OpenAI-compatible endpoint</option></select></label>
        <label>API key<input data-autofocus type="password" autoComplete="off" value={keys[draft.provider]} onChange={(event) => setKeys({ ...keys, [draft.provider]: event.target.value })} placeholder={serverProviders[draft.provider] ? 'Server key configured' : 'Paste a provider key'} /></label>
        <label>Base URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
        <label>Model<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="Automatic — choose an available chat model" /></label>
        <div className="settings-note">NVIDIA uses your server API key automatically. Leave the model empty for automatic selection. Saved settings survive reloads.</div>
        {error && <div role="alert" className="document-error">{error}</div>}
      </div>
      <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={save}>Save configuration</button></div>
    </section>
  </div>;
}

function Composer({ input, setInput, onSend, onStop, streaming, textareaRef, placeholder, inputLabel, hasKey, onOpenSettings, room, selectedFiles = [], uploadingFile = false, fileError = '', onUploadFile, onRemoveFile }: { input: string; setInput: (value: string) => void; onSend: () => void; onStop: () => void; streaming: boolean; textareaRef?: React.RefObject<HTMLTextAreaElement | null>; placeholder: string; inputLabel: string; hasKey: boolean; onOpenSettings: () => void; room?: boolean; selectedFiles?: Array<{ id: string; name: string }>; uploadingFile?: boolean; fileError?: string; onUploadFile?: (file: File) => void; onRemoveFile?: (id: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(input.trim() || selectedFiles.length);
  return <div className={`composer-shell ${room ? 'room-composer' : ''}`}>
    {!room && <>
      {selectedFiles.length > 0 && <div className="composer-file-list">{selectedFiles.map((file) => <span className="composer-file-chip" key={file.id} title={file.name}><span>▧</span>{file.name}<button type="button" onClick={() => onRemoveFile?.(file.id)} aria-label={`Remove ${file.name}`} disabled={streaming}>×</button></span>)}</div>}
      {fileError && <div className="composer-file-error" role="alert">{fileError}</div>}
    </>}
    <div className="composer"><textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (uploadingFile) return; if (hasKey) onSend(); else onOpenSettings(); } }} placeholder={placeholder} aria-label={inputLabel} rows={1} disabled={streaming} /><div className="composer-footer"><div className="composer-tools">{!room && onUploadFile && <><input ref={fileInputRef} className="composer-file-input" type="file" aria-label="Attach a file" accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.odg,.rtf,.csv,.md,.markdown,.html,.htm,.epub,.txt,.text,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.h,.cpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.yaml,.yml,.toml,.xml,.css,.scss,.diff,.log,.ipynb,.ini,.env,.conf" disabled={streaming || uploadingFile} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadFile(file); event.currentTarget.value = ''; }} /><button type="button" className="composer-attach-button" onClick={() => fileInputRef.current?.click()} disabled={streaming || uploadingFile} aria-label="Attach a file" title="Attach a file">{uploadingFile ? '…' : '+'}<span>{uploadingFile ? 'Uploading' : 'Attach file'}</span></button></>}{selectedFiles.length > 0 && <span className="composer-attached-count">{selectedFiles.length} attached</span>}</div><span className="composer-hint" role={streaming ? 'status' : undefined}>{streaming ? 'Agent is working…' : 'Enter to send · Shift + Enter for a new line'}</span><div>{streaming ? <button className="stop-button" onClick={onStop} aria-label="Stop generating">Stop</button> : <button className="send-button" onClick={() => hasKey ? onSend() : onOpenSettings()} disabled={!canSend || uploadingFile} aria-label="Send message">→</button>}</div></div></div>
  </div>;
}
