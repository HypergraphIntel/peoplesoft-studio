import type { ReviewService } from '../changeReview/service.js';
import { registerChangeReviewTools } from './changeReviewTools.js';
import { routeReviewedMutations, REVIEWED_MUTATION_TOOLS } from './reviewRouting.js';
import * as z from 'zod/v4';
import { capabilityCatalog } from './capabilityCatalog.js';
import { registerProcessTools } from './processTools.js';
import { registerQueryTools } from './queryTools.js';
import { studioReference } from './studioReference.js';
import { jsonResult } from './tools.js';
import { registerSecurityTools } from './securityTools.js';
import { registerPortalTools } from './portalTools.js';
import { registerStructureTools } from './structureTools.js';
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

import {
  type McpWriteHost,
  registerPeopleSoftWriteTools
} from './writeTools.js';

import { registerAppEngineTools } from './appEngineTools.js';
import { registerMenuTools } from './menuTools.js';
import { registerCiTools } from './ciTools.js';
import { registerChannelTools } from './channelTools.js';
import { registerCustomizationTools } from './customizationTools.js';
import { registerEventMappingTools } from './eventMappingTools.js';
import { registerDropZoneTools } from './dropZoneTools.js';
import { registerPageFieldConfiguratorTools } from './pfcTools.js';
import { registerDiscoveryTools } from './discoveryTools.js';
import { registerAdministrationTools } from './administrationTools.js';
import { registerIbTools } from './ibTools.js';
import { runToolsAsAgent } from './agentOrigin.js';
import { registerBuildRequestTools } from './buildRequestTools.js';
import { registerComponentTools } from './componentTools.js';
import { registerFileLayoutTools } from './fileLayoutTools.js';
import { registerPeopleCodeTools } from './peopleCodeTools.js';
import type { BuildRequestStore } from '../buildRequest/store.js';

import {
  DEFAULT_MCP_PORT
} from './configuration.js';

export const MCP_HOST =
  '127.0.0.1';

export function mcpUrl(
  port: number
): string {
  return `http://${MCP_HOST}:${port}/mcp`;
}

export function mcpHealthUrl(
  port: number
): string {
  return `http://${MCP_HOST}:${port}/health`;
}

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

/**
 * The release the MCP handshake reports: package.json's own version, never a copy. A literal
 * here was left at 0.9.1 through 0.9.2 and 0.9.3 and failed CI's handshake check on every
 * push. esbuild inlines the file; the test build and tsx resolve it from the source tree.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const STUDIO_VERSION: string = (require('../../package.json') as { version: string }).version;

export async function startPeopleSoftMcpServer(
  workspace: Workspace,
  options: {
    host?: string;
    port?: number;
    /** The VS Code side of MCP writes; absent, the server is read-only. */
    writeHost?: () => McpWriteHost | undefined;
    reviewService?: ReviewService;
    /** Build requests the developer assembles in VS Code; absent, no build request tools. */
    buildRequests?: BuildRequestStore;
  } = {}
): Promise<RunningPeopleSoftMcpServer> {
  const host =
    options.host ??
    MCP_HOST;

  const port =
    options.port ??
    DEFAULT_MCP_PORT;

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
              STUDIO_VERSION
          }, {
            instructions: 'Start with psft_studio_reference or psft_capability_catalog to choose a supported workflow. Read the relevant framework reference before authoring. Select a connection with psft_list_connections; inspect effective customization policy, ownership and live configuration availability before proposing delivered-object changes. Catalog entries describe bounded implementation support, not release certification or permission. Read current definitions and concurrency tokens, preview supported saves, then save through guarded tools and read back. When Change Review tools are available, use durable Change Sets and poll status. SQL/HTML/freeform style sheet, PeopleCode, Query, Process and bounded existing-Page edits plus Record/AE and IB service/operation description/comments edits stage proposals; only the developer can approve/apply in the persistent review workspace. Other mutation families retain legacy gates until adapters are verified. Planned features and preview analyses must remain explicit.'
          });

        // Every tool call runs as an agent's: the delivered-object guard applies agentDeliveredObjectPolicy to what it writes.
        runToolsAsAgent(server as never);
        if (options.reviewService) {
          routeReviewedMutations(server, options.reviewService, workspace, options.writeHost);
          registerChangeReviewTools(server, options.reviewService);
        }

        server.registerTool('psft_studio_reference', {
          title: 'PeopleSoft Studio: tools, definitions and customization strategy',
          description: 'Read first for the current Studio feature map: every Configuration Tools and Data Migration Tools entry, all modeled definition types and generic MCP coverage, customization strategy and its enforced versus preview behavior, project migration workflows, tool routing and explicit limitations. Read-only orientation; database availability and effective policy require their discovery tools.',
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        }, async () => jsonResult({...studioReference(), changeReview:options.reviewService?{available:true,adapters:options.reviewService.capabilities(),stagedTools:REVIEWED_MUTATION_TOOLS,otherMutations:'Legacy per-tool confirmation remains until adapters are calibrated.'}:{available:false}}));

        registerPeopleSoftTools(
          server,
          workspace
        );

        registerStructureTools(
          server,
          workspace
        );

        const writeHost =
          options.writeHost?.();

        server.registerTool('psft_capability_catalog', {
          title: 'Structured Studio capability catalog',
          description: 'Read first to choose a workflow. Filter by kind, definition type code or text. Explains every modeled definition type, its relationships, operation-specific MCP routes and missing operations; every configuration/data migration pane entry; customization strategy and migration limits. Implementation evidence is distinct from release verification and write permission.',
          inputSchema: z.object({ kind: z.enum(['definition', 'configuration', 'dataMigration', 'strategy', 'projectMigration']).optional(), type: z.number().int().optional(), query: z.string().optional() }).strict(),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        }, async filter => jsonResult({...capabilityCatalog(filter, !!writeHost), changeReview:options.reviewService?{available:true,adapters:options.reviewService.capabilities(),stagedTools:REVIEWED_MUTATION_TOOLS}:{available:false}}));

        // App Engine: read tools always; write tools with the write host.
        registerAppEngineTools(
          server,
          workspace,
          writeHost
        );
        registerMenuTools(
          server,
          workspace,
          writeHost
        );
        registerCiTools(
          server,
          workspace,
          writeHost
        );
        registerChannelTools(
          server,
          workspace,
          writeHost
        );
        registerCustomizationTools(server, workspace);
        registerEventMappingTools(server, workspace, writeHost);
        registerDropZoneTools(server, workspace, writeHost);
        registerPageFieldConfiguratorTools(server, workspace, writeHost);
        registerDiscoveryTools(server, workspace, writeHost);
        registerAdministrationTools(server, workspace, writeHost);
        registerSecurityTools(server, workspace, writeHost);
        registerProcessTools(server, workspace, writeHost);
        registerQueryTools(server, workspace, writeHost);
        registerIbTools(server, workspace, writeHost);
        registerPortalTools(server, workspace, writeHost);
        registerBuildRequestTools(server, options.buildRequests, () => !!writeHost);
        registerComponentTools(server, workspace, writeHost);
        registerFileLayoutTools(server, workspace, writeHost);
        registerPeopleCodeTools(server, workspace);

        if (writeHost) {
          registerPeopleSoftWriteTools(
            server,
            workspace,
            writeHost
          );
        }

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
