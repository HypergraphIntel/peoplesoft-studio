import {
  MCP_NAME,
  MCP_URL,
  commandForPlatform,
  commandNotFound,
  errorOutput,
  execFile
} from './common.js';

import type {
  ClientConfigureResult
} from './codex.js';

export function claudeSetupCommand():
  string {
  return (
    'claude mcp add --transport http ' +
    `--scope user ${MCP_NAME} ${MCP_URL}`
  );
}

export async function configureClaude():
  Promise<ClientConfigureResult> {
  try {
    await execFile(
      commandForPlatform(
        'claude'
      ),
      [
        'mcp',
        'add',
        '--transport',
        'http',
        '--scope',
        'user',
        MCP_NAME,
        MCP_URL
      ]
    );

    return {
      status:
        'configured',
      message:
        'Claude Code MCP configured successfully.'
    };
  } catch (error) {
    const output =
      errorOutput(error);

    if (
      /already exists|already configured/i
        .test(output)
    ) {
      return {
        status:
          'already-configured',
        message:
          'PeopleSoft Studio MCP is already configured in Claude Code.'
      };
    }

    if (
      commandNotFound(error)
    ) {
      throw new Error(
        'Claude Code CLI was not found in PATH.'
      );
    }

    throw new Error(
      `Claude Code MCP configuration failed:\n${output}`
    );
  }
}
