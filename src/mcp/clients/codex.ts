import {
  MCP_NAME,
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

export function codexSetupCommand(
  url: string
): string {
  return (
    `codex mcp add ${MCP_NAME} ` +
    `--url ${url}`
  );
}

export async function configureCodex(
  url: string
): Promise<ClientConfigureResult> {
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
        url
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
