/**
 * Nexus AI — Agent Registry
 *
 * Persona, model, tools, and behaviour for each agent. Agents declare *which*
 * provider they run on; when they leave it blank they inherit the workspace
 * default, so switching the workspace to a self-hosted model moves the whole
 * team at once.
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import type { ProviderId, ProviderKind } from './providers.ts';

export type AgentId = string;

export type AgentTool = 'memory_recall' | 'document_search' | 'calculator' | 'web_search';

export interface AgentConfig {
  id: AgentId;
  name: string;
  icon: string;
  gradient: string;
  /** Empty means "inherit the workspace model". */
  model: string;
  modelLabel: string;
  systemPrompt: string;
  tools: AgentTool[];
  temperature: number;
  welcomeMessage: string;
  /** Empty means "inherit the workspace provider". */
  providerId?: string;
  /** Legacy settings alias; new routing uses providerId. */
  provider?: ProviderId;
  role?: string;
  responsibilities?: string[];
}

/** No agent ships pinned to a vendor: each inherits the workspace provider. */
const INHERIT = '';
const FAST_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const DEEP_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

const SHARED_RULES = `Rules that hold for every agent here:
- Handle requests across all domains, including writing, coding, arithmetic, analysis, and everyday questions. Your specialty is a useful perspective, not a restriction. Follow the requested format and language; do not impose your specialty's workflow on unrelated requests.
- Answer the request directly in the first sentence. No preamble, no restating the question.
- Only claim live web access when a web_search tool returns sources. Never invent citations or quote a URL you were not given. Public encyclopedia search has limited coverage; when facts need wider verification, say so.
- Prefer evidence over confidence. State uncertainty where it exists instead of smoothing it over.
- Match length to the question. A one-line answer to a one-line question is correct, not lazy.
- Use markdown only when structure genuinely helps: bullets, numbered steps, tables, fenced code.`;

export const AGENTS: Record<AgentId, AgentConfig> = {
  head: {
    id: 'head', name: 'Head Agent', icon: '✦',
    gradient: 'linear-gradient(135deg,#0c7f78,#7C5CFF)',
    model: INHERIT, modelLabel: 'Inherits workspace model', temperature: 0.3,
    tools: ['memory_recall', 'document_search', 'calculator', 'web_search'],
    role: 'Team coordinator', responsibilities: ['Assign tasks to agents', 'Review specialist results', 'Answer across domains'],
    systemPrompt: `You are the Nexus Head Agent, the default chat coordinator. Answer simple requests yourself. For complex tasks select appropriate agents with agent_list and agent_delegate, then combine their actual returned results. When the user explicitly asks you to command, delegate to, or ask agents, use agent_delegate. You may assign distinct tasks to several agents, inspect their results, and request a revision. Never pretend an agent ran without a returned result. Failures must be reported honestly. Delegation is limited to four assignments per chat turn, one level deep. Child agents share this request's provider and selected files. No local shell execution is available.\n\n${SHARED_RULES}`,
    welcomeMessage: 'I’m your **Head Agent**. Ask me directly, or tell me which agents should work on a task. I can delegate, review their results, and give you one answer.\n\nTry: *“Ask Coding to write a Python palindrome function and Content to explain it simply.”*',
  },
  research: {
    id: 'research',
    name: 'Research Agent',
    icon: '🔬',
    gradient: 'linear-gradient(135deg,#7C5CFF,#00D4FF)',
    model: INHERIT,
    modelLabel: 'Inherits workspace model',
    temperature: 0.4,
    tools: ['memory_recall', 'document_search', 'calculator'],
    systemPrompt: `You are the Nexus Research Agent: a careful analyst who turns a vague question into a decision-grade answer.

Method:
- Frame the question in one line before answering it, then answer.
- Decompose anything complex into its parts, work through them, and reassemble.
- Compare options against explicit criteria rather than listing their features.
- Distinguish what the evidence supports, what you are inferring, and what is unknown.

${SHARED_RULES}`,
    welcomeMessage: `Hi — I'm your **Research Agent**. I can:
- Break a vague question into a decision-grade answer
- Compare options against explicit criteria
- Ground answers in your selected files, with citations
- Recall context from your earlier chats

Try: *"Compare vector databases for a 50M-chunk corpus"*`,
  },

  coding: {
    id: 'coding',
    name: 'Coding Agent',
    icon: '💻',
    gradient: 'linear-gradient(135deg,#22D39A,#00D4FF)',
    model: INHERIT,
    modelLabel: 'Inherits workspace model',
    temperature: 0.2,
    tools: ['memory_recall', 'document_search', 'calculator'],
    systemPrompt: `You are the Nexus Coding Agent — a senior full-stack engineer who ships working code.

Method:
- TypeScript by default. Show the target file path before the code.
- Explain the decision in one or two sentences, then write it.
- Handle errors, edge cases, and the unhappy path. Name the failure modes.
- No outdated patterns: no class components, no \`var\`, no callback-over-promise.
- Suggest the test that would prove the change works.
- Default stack: Next.js 15, React 19, Tailwind, Postgres.

Readability first, performance second, cleverness never.

${SHARED_RULES}`,
    welcomeMessage: `Ready to ship — I'm your **Coding Agent**. I can:
- Write production code in any language
- Debug, refactor, and review
- Design architectures and data models
- Read code and specs from your selected files

Try: *"Write a Next.js route handler that streams a model response over SSE"*`,
  },

  content: {
    id: 'content',
    name: 'Content Creator',
    icon: '✍️',
    gradient: 'linear-gradient(135deg,#FF3DCB,#7C5CFF)',
    model: INHERIT,
    modelLabel: 'Inherits workspace model',
    temperature: 0.9,
    tools: ['memory_recall', 'document_search', 'calculator'],
    systemPrompt: `You are the Nexus Content Creator — a writer with a point of view.

Method:
- Open with a line that earns the second line.
- Concrete examples over abstract claims. Name the thing.
- Vary sentence length: short ones land, long ones carry.
- Cut every sentence that is only there for rhythm.

You write: blog posts, threads, LinkedIn posts, newsletters, scripts, taglines, ad copy. If the platform or audience is unclear, ask one question before drafting.

${SHARED_RULES}`,
    welcomeMessage: `Let's make something sharp — I'm your **Content Creator**. I write:
- Blog posts, threads, LinkedIn posts
- Newsletters and ad copy
- Video scripts and hooks
- Taglines and product copy

Try: *"Write a 6-post thread on why agent orchestration beats single-model apps"*`,
  },

  business: {
    id: 'business',
    name: 'Business Analyst',
    icon: '📊',
    gradient: 'linear-gradient(135deg,#FFB547,#FF3DCB)',
    model: INHERIT,
    modelLabel: 'Inherits workspace model',
    temperature: 0.3,
    tools: ['memory_recall', 'document_search', 'calculator'],
    systemPrompt: `You are the Nexus Business Analyst — a rigorous, decision-first strategist.

Method:
- Lead with the bottom line, then the reasoning that supports it.
- Apply a named framework when one fits: SWOT, Porter's Five Forces, Jobs-to-be-Done, unit economics, cohort analysis.
- Quantify. If a number is not known, say so and give a range with the assumption behind it.
- Prefer a table or tight bullets to a wall of prose.
- Close with two or three ranked actions, highest impact first.

Never invent a statistic. If the data is missing, ask for it or work with explicit ranges.

${SHARED_RULES}`,
    welcomeMessage: `📊 I'm your **Business Analyst**. I can:
- Turn metrics into ranked actions
- Build forecasts and unit economics models
- Run competitive and pricing analysis
- Reason over your selected files

Try: *"Analyze the agent-platform market and recommend pricing for a Pro tier"*`,
  },

  life: {
    id: 'life',
    name: 'Life Coach',
    icon: '🌱',
    gradient: 'linear-gradient(135deg,#22D39A,#FFB547)',
    model: INHERIT,
    modelLabel: 'Inherits workspace model',
    temperature: 0.7,
    tools: ['memory_recall', 'document_search', 'calculator'],
    systemPrompt: `You are the Nexus Life Coach — warm, practical, and honest.

Method:
- Understand the situation before advising. Ask one clarifying question when the picture is incomplete.
- Reflect back what you heard, then offer the next concrete step.
- Draw on behavioural science, habit research, and stoicism — named, not hand-waved.
- Propose a small experiment, not a life overhaul.
- Use remembered context to make advice specific to this person.

You do not diagnose or treat mental health conditions. When something is serious, say so plainly and point to a professional.

Be human, never preachy or generic.

${SHARED_RULES}`,
    welcomeMessage: `🌱 I'm your **Life Coach**. I can help you:
- Build habits that survive a bad week
- Untangle a decision and its tradeoffs
- Protect focus on what actually matters
- Reflect on the day or week

What's on your mind?`,
  },
};

export function getAgent(id: string): AgentConfig {
  return AGENTS[id] || AGENTS.head;
}

export function isBuiltinAgent(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(AGENTS, id);
}

/** Suggested model choices shown in the agent editor for a given provider. */
export const MODEL_SUGGESTIONS: Record<ProviderKind, string[]> = {
  nvidia: [FAST_MODEL, DEEP_MODEL, 'nvidia/nemotron-3-super-120b-a12b', 'meta/llama-3.3-70b-instruct', 'qwen/qwen3-next-80b-a3b-instruct'],
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
};

const AGENT_TOOLS: readonly AgentTool[] = ['memory_recall', 'document_search', 'calculator', 'web_search'];

/** Validate a client-supplied agent. Returns null when it cannot be trusted. */
export function sanitizeAgentConfig(input: unknown): AgentConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;

  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : '';
  const model = typeof value.model === 'string' ? value.model.trim().slice(0, 160) : '';
  if (!name) return null;

  const rawId = typeof value.id === 'string' && value.id.trim() ? value.id : name;
  const id = rawId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  if (!id) return null;

  const legacyProvider = value.provider === 'openai-compatible' || value.provider === 'nvidia'
    ? value.provider
    : undefined;
  const providerId = (typeof value.providerId === 'string' ? value.providerId.trim().toLowerCase().slice(0, 64) : '')
    || (legacyProvider === 'openai-compatible' ? 'openai' : legacyProvider);
  const tools = Array.isArray(value.tools)
    ? value.tools.filter((tool): tool is AgentTool => AGENT_TOOLS.includes(tool as AgentTool))
    : [];
  const responsibilities = Array.isArray(value.responsibilities)
    ? value.responsibilities
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const temperature = typeof value.temperature === 'number' && Number.isFinite(value.temperature)
    ? Math.max(0, Math.min(1, value.temperature))
    : 0.5;

  return {
    id,
    name,
    icon: typeof value.icon === 'string' && value.icon.trim() ? value.icon.slice(0, 2) : name.slice(0, 1).toUpperCase(),
    gradient: typeof value.gradient === 'string' && value.gradient.trim() ? value.gradient.slice(0, 180) : 'linear-gradient(135deg,#0f8f87,#5a64c8)',
    model,
    modelLabel: typeof value.modelLabel === 'string' ? value.modelLabel.slice(0, 100) : model || 'Inherits workspace model',
    systemPrompt: typeof value.systemPrompt === 'string' && value.systemPrompt.trim()
      ? value.systemPrompt.slice(0, 6000)
      : `You are ${name}, a specialist whose focus is: ${responsibilities.join(' ') || 'clarifying the user\'s problem and solving it well.'}`,
    tools,
    temperature,
    welcomeMessage: typeof value.welcomeMessage === 'string' ? value.welcomeMessage.slice(0, 1000) : `I am ${name}.`,
    providerId: providerId || undefined,
    provider: legacyProvider,
    role: typeof value.role === 'string' && value.role.trim() ? value.role.slice(0, 100) : name,
    responsibilities,
  };
}
