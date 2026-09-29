import { AGENTS, sanitizeAgentConfig, type AgentConfig } from './agents.ts';
import { streamAgentResponse, type AgentStreamOptions } from './llm.ts';

export function delegationTeam(input: unknown): AgentConfig[] {
  const team = new Map(Object.values(AGENTS).filter((agent) => agent.id !== 'head').map((agent) => [agent.id, agent]));
  if (Array.isArray(input)) for (const item of input.slice(0, 24)) {
    const agent = sanitizeAgentConfig(item);
    if (agent && agent.id !== 'head') team.set(agent.id, agent);
  }
  return [...team.values()];
}

/** Children inherit the authenticated request and cannot delegate recursively. */
export async function delegateTask(opts: AgentStreamOptions, agent: AgentConfig, task: string) {
  if ((opts.delegationDepth || 0) >= 1) throw new Error('Nested delegation is unavailable.');
  const child = opts.documentIds?.length ? {
    ...agent, tools: agent.tools.filter((name) => name === 'calculator' || name === 'document_search'),
    systemPrompt: `${agent.systemPrompt}\n\n${opts.agent.systemPrompt.includes('DOCUMENT-GROUNDED ANSWERING:') ? opts.agent.systemPrompt.slice(opts.agent.systemPrompt.indexOf('DOCUMENT-GROUNDED ANSWERING:')) : 'Answer only from selected files. Cite sources. Do not fill gaps with outside knowledge.'}`,
  } : agent;
  let text = '', error = '';
  const signal = AbortSignal.any([AbortSignal.timeout(180_000), ...(opts.signal ? [opts.signal] : [])]);
  for await (const event of streamAgentResponse({ ...opts, agent: child, userMessage: task,
    history: [], delegationDepth: 1, teamAgents: [], signal, maxTokens: 2048,
    provider: opts.provider })) {
    if (event.type === 'token') text += String(event.data);
    if (event.type === 'error') error = String(event.data);
  }
  return { agentId: agent.id, agent: agent.name, status: error || !text.trim() ? 'failed' : 'completed',
    answer: text, ...(error ? { error } : !text.trim() ? { error: 'Agent stopped before returning an answer.' } : {}) };
}
