import childProcess from 'node:child_process';

import * as vscode from 'vscode';

const MCP_NAME =
  'peoplesoftStudio';

const MCP_URL =
  'http://127.0.0.1:7337/mcp';

const HEALTH_URL =
  'http://127.0.0.1:7337/health';

function execFile(
  command: string,
  args: string[]
): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise(
    (resolve, reject) => {
      childProcess.execFile(
        command,
        args,
        {
          encoding: 'utf8'
        },
        (
          error,
          stdout,
          stderr
        ) => {
          if (error) {
            reject(
              Object.assign(
                error,
                {
                  stdout,
                  stderr
                }
              )
            );

            return;
          }

          resolve({
            stdout,
            stderr
          });
        }
      );
    }
  );
}

async function verifyMcpServer():
  Promise<void> {
  const response =
    await fetch(
      HEALTH_URL
    );

  if (!response.ok) {
    throw new Error(
      `MCP health check returned HTTP ${response.status}.`
    );
  }

  const result =
    await response.json() as {
      status?: string;
    };

  if (
    result.status !== 'ok'
  ) {
    throw new Error(
      'PeopleSoft Studio MCP server is not healthy.'
    );
  }
}

function codexCommand(): string {
  return process.platform ===
    'win32'
      ? 'codex.cmd'
      : 'codex';
}

export async function configureCodexMcp():
  Promise<void> {
  try {
    await verifyMcpServer();
  } catch (err) {
    vscode.window.showErrorMessage(
      'PeopleSoft Studio MCP is not running. ' +
      `${(err as Error).message}`
    );

    return;
  }

  const confirm =
    await vscode.window.showInformationMessage(
      'Configure Codex to use the PeopleSoft Studio MCP server?',
      {
        modal: true,
        detail:
          `${MCP_NAME} → ${MCP_URL}`
      },
      'Configure'
    );

  if (
    confirm !== 'Configure'
  ) {
    return;
  }

  try {
    await execFile(
      codexCommand(),
      [
        'mcp',
        'add',
        MCP_NAME,
        '--url',
        MCP_URL
      ]
    );

    vscode.window.showInformationMessage(
      'Codex MCP configured successfully. ' +
      'Restart or reload Codex if it is already running.'
    );
  } catch (err) {
    const error =
      err as Error & {
        stdout?: string;
        stderr?: string;
      };

    const output =
      [
        error.stderr,
        error.stdout,
        error.message
      ]
        .filter(Boolean)
        .join('\n');

    if (
      /already exists|already configured/i
        .test(output)
    ) {
      vscode.window.showInformationMessage(
        'PeopleSoft Studio MCP is already configured in Codex.'
      );

      return;
    }

    if (
      /ENOENT|not found|is not recognized/i
        .test(output)
    ) {
      const copy =
        await vscode.window.showErrorMessage(
          'The Codex CLI was not found in PATH.',
          'Copy Setup Command'
        );

      if (
        copy === 'Copy Setup Command'
      ) {
        await vscode.env.clipboard.writeText(
          `codex mcp add ${MCP_NAME} --url ${MCP_URL}`
        );

        vscode.window.showInformationMessage(
          'Codex MCP setup command copied to the clipboard.'
        );
      }

      return;
    }

    vscode.window.showErrorMessage(
      'Failed to configure Codex MCP: ' +
      output
    );
  }
}