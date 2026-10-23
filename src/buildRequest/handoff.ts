import { agentPrompt, type BuildRequest } from './model.js';

export interface AgentLaunch { command: 'codex' | 'claude'; args: string[] }

/** Claude Code's per-session MCP configuration, written to a file where the shell would mangle inline JSON. */
export function claudeMcpConfig(endpoint: string): string {
  return JSON.stringify({ mcpServers: { peoplesoftStudio: { type: 'http', url: new URL(endpoint).href } } });
}

/**
 * Per-session endpoint override: retain client auth/model/settings without changing global MCP configuration.
 * Windows PowerShell 5.1 strips double quotes from native arguments and VS Code does not escape single quotes
 * for it, so no argument carries a quote when `claudeConfigFile` (a file holding claudeMcpConfig) is given.
 * Codex reads a value that is not TOML as a literal string.
 */
export function agentLaunch(r: BuildRequest, phase: 'analyze' | 'build', agent: 'codex' | 'claude', endpoint: string, claudeConfigFile?: string): AgentLaunch {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/mcp' || url.search || url.hash) {
    throw new Error('Build handoff requires the current local Studio MCP endpoint.');
  }
  const prompt = agentPrompt(r, phase);
  return agent === 'codex'
    ? { command: 'codex', args: ['--config', `mcp_servers.peoplesoftStudio.url=${url.href}`, '--', prompt] }
    : { command: 'claude', args: ['--mcp-config', claudeConfigFile ?? claudeMcpConfig(url.href), '--', prompt] };
}
