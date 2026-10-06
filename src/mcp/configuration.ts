/*
 * `peoplesoft.mcp.*`: the port's default and valid range, and what a change
 * to either setting means for the server.
 *
 * Kept apart from server.ts and controller.ts, which load the MCP SDK and
 * the `vscode` module, so this can be unit tested.
 */

/** The default for `peoplesoft.mcp.port`. */
export const DEFAULT_MCP_PORT = 7337;

/** Below 1024 a port needs elevated privileges on most systems. */
export const MIN_MCP_PORT = 1024;
export const MAX_MCP_PORT = 65535;

/** An error message for a port the server cannot use, or undefined when it is valid. */
export function mcpPortError(port: unknown): string | undefined {
  if (typeof port !== 'number' || !Number.isInteger(port)) return 'Port must be a whole number.';
  if (port < MIN_MCP_PORT || port > MAX_MCP_PORT) {
    return `Port must be between ${MIN_MCP_PORT} and ${MAX_MCP_PORT}.`;
  }
  return undefined;
}

/** `peoplesoft.mcp.*`: whether the server runs, and on which port. */
export interface McpServerConfiguration {
  enabled: boolean;
  port: number;
}

export type McpReconfiguration =
  | 'stop'
  | 'start'
  | 'restart'
  | 'update-url'
  | 'none';

/**
 * What a change to `peoplesoft.mcp.*` requires of the server.
 *
 * Disabling stops it; enabling starts it. A running server on another port
 * restarts on the new one. A server the user stopped stays stopped (only its
 * URL changes), but one that failed -- a port in use, typically -- is retried.
 *
 * @param status the controller's status before the change
 * @param runningPort the port a running server is bound to, if one is running
 */
export function planMcpReconfiguration(
  status: 'disabled' | 'stopped' | 'starting' | 'running' | 'error',
  runningPort: number | undefined,
  configuration: McpServerConfiguration
): McpReconfiguration {
  if (!configuration.enabled) return status === 'disabled' ? 'none' : 'stop';
  if (runningPort !== undefined) return runningPort === configuration.port ? 'none' : 'restart';
  if (status === 'disabled' || status === 'error') return 'start';
  if (status === 'stopped') return 'update-url';
  return 'none';
}
