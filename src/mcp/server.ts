import {
  createServer,
  Server
} from 'node:http';

import {
  createMcpHandler,
  McpServer
} from '@modelcontextprotocol/server';

import {
  toNodeHandler
} from '@modelcontextprotocol/node';

import type * as vscode from 'vscode';

import {
  Workspace
} from '../workspace.js';

import {
  registerPeopleSoftTools
} from './tools.js';

export const MCP_HOST =
  '127.0.0.1';

export const MCP_PORT =
  7337;

export const MCP_URL =
  `http://${MCP_HOST}:${MCP_PORT}/mcp`;

export const MCP_HEALTH_URL =
  `http://${MCP_HOST}:${MCP_PORT}/health`;

export interface RunningPeopleSoftMcpServer
  extends vscode.Disposable {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

function listen(
  server: Server,
  host: string,
  port: number
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      const onError =
        (error: Error) => {
          server.off(
            'listening',
            onListening
          );

          reject(error);
        };

      const onListening =
        () => {
          server.off(
            'error',
            onError
          );

          resolve();
        };

      server.once(
        'error',
        onError
      );

      server.once(
        'listening',
        onListening
      );

      server.listen(
        port,
        host
      );
    }
  );
}

function sendJson(
  response:
    import('node:http').ServerResponse,
  statusCode: number,
  body: unknown
): void {
  const payload =
    JSON.stringify(
      body
    );

  response.writeHead(
    statusCode,
    {
      'content-type':
        'application/json; charset=utf-8',
      'content-length':
        Buffer.byteLength(payload)
    }
  );

  response.end(
    payload
  );
}

export async function startPeopleSoftMcpServer(
  workspace: Workspace,
  options: {
    host?: string;
    port?: number;
  } = {}
): Promise<RunningPeopleSoftMcpServer> {
  const host =
    options.host ??
    MCP_HOST;

  const port =
    options.port ??
    MCP_PORT;

  if (
    host !== '127.0.0.1' &&
    host !== '::1'
  ) {
    throw new Error(
      'PeopleSoft Studio MCP may only bind to a loopback address.'
    );
  }

  const handler =
    createMcpHandler(
      () => {
        const server =
          new McpServer({
            name:
              'peoplesoft-studio',
            version:
              '0.2.1'
          });

        registerPeopleSoftTools(
          server,
          workspace
        );

        return server;
      }
    );

  const nodeHandler =
    toNodeHandler(
      handler,
      {
        onerror:
          error => {
            console.error(
              'PeopleSoft Studio MCP request failed:',
              error
            );
          }
      }
    );

  const httpServer =
    createServer(
      (request, response) => {
        const url =
          new URL(
            request.url ?? '/',
            `http://${request.headers.host ?? `${host}:${port}`}`
          );

        if (
          url.pathname ===
          '/health'
        ) {
          sendJson(
            response,
            200,
            {
              status:
                'ok',
              service:
                'peoplesoft-studio-mcp',
              mcp:
                `http://${host}:${port}/mcp`
            }
          );

          return;
        }

        if (
          url.pathname !==
          '/mcp'
        ) {
          sendJson(
            response,
            404,
            {
              error:
                'Not found'
            }
          );

          return;
        }

        void nodeHandler(
          request,
          response
        );
      }
    );

  await listen(
    httpServer,
    host,
    port
  );

  let disposed =
    false;

  return {
    host,
    port,
    url:
      `http://${host}:${port}/mcp`,

    dispose(): void {
      if (disposed) {
        return;
      }

      disposed =
        true;

      void handler.close()
        .catch(
          error => {
            console.error(
              'Failed to close PeopleSoft Studio MCP handler:',
              error
            );
          }
        );

      httpServer.close(
        error => {
          if (error) {
            console.error(
              'Failed to close PeopleSoft Studio MCP HTTP server:',
              error
            );
          }
        }
      );
    }
  };
}
