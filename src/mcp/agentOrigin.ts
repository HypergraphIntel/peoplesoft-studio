import { runAsAgent } from '../providers/writeGuard.js';

/*
 * Every MCP tool call runs as an AI agent's (providers/writeGuard.ts), so the
 * delivered-object guard applies peoplesoft.customization
 * .agentDeliveredObjectPolicy to whatever the call writes -- whichever tool,
 * now or later, makes the write.
 */

interface ToolRegistrar { registerTool(name: string, config: never, callback: never): unknown }

/** Wraps the server's registerTool: each tool's callback runs inside runAsAgent. Call before registering tools. */
export function runToolsAsAgent<S extends ToolRegistrar>(server: S): S {
  const register = server.registerTool.bind(server) as (name: string, config: unknown, callback: unknown) => unknown;
  (server as { registerTool: unknown }).registerTool = (name: string, config: unknown, callback: (...args: unknown[]) => unknown) =>
    register(name, config, (...args: unknown[]) => runAsAgent(() => callback(...args)));
  return server;
}
