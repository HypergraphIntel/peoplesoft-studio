import childProcess from 'node:child_process';

import {
  MCP_HEALTH_URL,
  MCP_URL
} from '../server.js';

export const MCP_NAME =
  'peoplesoftStudio';

// export const MCP_URL =
//  'http://127.0.0.1:7337/mcp';

// export const MCP_HEALTH_URL =
//  'http://127.0.0.1:7337/health';

export {
  MCP_URL,
  MCP_HEALTH_URL
};

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecFailure
  extends Error {
  stdout?: string;
  stderr?: string;
  code?: number | string;
}

export function execFile(
  command: string,
  args: string[]
): Promise<ExecResult> {
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

export function commandForPlatform(
  command: string
): string {
  return process.platform === 'win32'
    ? `${command}.cmd`
    : command;
}

export function errorOutput(
  error: unknown
): string {
  const value =
    error as ExecFailure;

  return [
    value.stderr,
    value.stdout,
    value.message
  ]
    .filter(
      (part): part is string =>
        typeof part === 'string' &&
        part.trim().length > 0
    )
    .join('\n');
}

export function commandNotFound(
  error: unknown
): boolean {
  return /ENOENT|not found|is not recognized/i
    .test(
      errorOutput(error)
    );
}

export async function verifyMcpServer():
  Promise<void> {
  const response =
    await fetch(
      MCP_HEALTH_URL
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
