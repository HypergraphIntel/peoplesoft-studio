import childProcess from 'node:child_process';

export const MCP_NAME =
  'peoplesoftStudio';

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

/**
 * Node refuses to spawn a .cmd launcher directly on Windows (EINVAL since
 * the CVE-2024-27980 fix), so npm's codex.cmd/claude.cmd run through
 * cmd.exe. Only arguments that need no shell quoting are passed that way.
 */
export function windowsShimCommand(
  command: string,
  args: string[]
): { command: string; args: string[] } {
  const line =
    [command, ...args];

  if (
    !line.every(
      (part) =>
        /^[\w.:/@-]+$/.test(part)
    )
  ) {
    throw new Error(
      'This argument cannot be passed safely to a Windows command launcher.'
    );
  }

  return {
    command:
      process.env.ComSpec ??
      'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      line.join(' ')
    ]
  };
}

export function execFile(
  command: string,
  args: string[]
): Promise<ExecResult> {
  const target =
    process.platform === 'win32' &&
    /\.cmd$/i.test(command)
      ? windowsShimCommand(
        command,
        args
      )
      : { command, args };

  return new Promise(
    (resolve, reject) => {
      childProcess.execFile(
        target.command,
        target.args,
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

export async function verifyMcpServer(
  healthUrl: string
): Promise<void> {
  const response =
    await fetch(
      healthUrl
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
