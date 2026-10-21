import { agentPrompt, type BuildRequest } from './model.js';

export interface AgentLaunch { command: 'codex' | 'claude'; args: string[] }

/** Per-session endpoint override: retain client auth/model/settings without changing global MCP configuration. */
export function agentLaunch(r: BuildRequest, phase: 'analyze' | 'build', agent: 'codex' | 'claude', endpoint: string): AgentLaunch {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/mcp' || url.search || url.hash) {
    throw new Error('Build handoff requires the current local Studio MCP endpoint.');
  }
  const prompt = agentPrompt(r, phase);
  return agent === 'codex'
    ? { command: 'codex', args: ['--config', `mcp_servers.peoplesoftStudio.url=${JSON.stringify(url.href)}`, '--', prompt] }
    : { command: 'claude', args: ['--mcp-config', JSON.stringify({ mcpServers: { peoplesoftStudio: { type: 'http', url: url.href } } }), '--', prompt] };
}
