import {
  MCP_NAME,
  MCP_URL,
  commandForPlatform,
  commandNotFound,
  errorOutput,
  execFile
} from './common.js';

export interface ClientConfigureResult {
  status:
    | 'configured'
    | 'already-configured';
  message: string;
}

export function codexSetupCommand():
  string {
  return (
    `codex mcp add ${MCP_NAME} ` +
    `--url ${MCP_URL}`
  );
}

export async function configureCodex():
  Promise<ClientConfigureResult> {
  try {
    await execFile(
      commandForPlatform(
        'codex'
      ),
      [
        'mcp',
        'add',
        MCP_NAME,
        '--url',
        MCP_URL
      ]
    );

    return {
      status:
        'configured',
      message:
        'Codex MCP configured successfully.'
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
          'PeopleSoft Studio MCP is already configured in Codex.'
      };
    }

    if (
      commandNotFound(error)
    ) {
      throw new Error(
        'Codex CLI was not found in PATH.'
      );
    }

    throw new Error(
      `Codex MCP configuration failed:\n${output}`
    );
  }
}
