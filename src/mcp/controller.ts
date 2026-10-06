import * as vscode from 'vscode';

import {
  mcpUrl,
  type RunningPeopleSoftMcpServer,
  startPeopleSoftMcpServer
} from './server.js';

import {
  DEFAULT_MCP_PORT,
  type McpServerConfiguration,
  mcpPortError,
  planMcpReconfiguration
} from './configuration.js';

export type {
  McpServerConfiguration
};

import {
  Workspace
} from '../workspace.js';

export type McpServerStatus =
  | 'disabled'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error';

export interface McpServerState {
  status: McpServerStatus;
  url: string;
  error?: string;
}

export function readMcpConfiguration():
  McpServerConfiguration {
  const settings =
    vscode.workspace.getConfiguration(
      'peoplesoft.mcp'
    );

  return {
    enabled:
      settings.get<boolean>(
        'enabled',
        true
      ),
    port:
      settings.get<number>(
        'port',
        DEFAULT_MCP_PORT
      )
  };
}

export class McpServerDisabledError
  extends Error {
  constructor() {
    super(
      'The PeopleSoft Studio MCP server is disabled. ' +
      'Enable it in PeopleSoft Studio Settings (peoplesoft.mcp.enabled).'
    );
  }
}

export class McpServerController
  implements vscode.Disposable {
  private server:
    RunningPeopleSoftMcpServer | undefined;

  private currentState:
    McpServerState;

  private readonly stateEmitter =
    new vscode.EventEmitter<McpServerState>();

  readonly onDidChangeState =
    this.stateEmitter.event;

  constructor(
    private readonly workspace:
      Workspace,
    private readonly readConfiguration:
      () => McpServerConfiguration =
      readMcpConfiguration
  ) {
    const configuration =
      this.readConfiguration();

    this.currentState = {
      status:
        configuration.enabled
          ? 'stopped'
          : 'disabled',
      url:
        mcpUrl(
          configuration.port
        )
    };
  }

  get state():
    McpServerState {
    return {
      ...this.currentState
    };
  }

  get enabled():
    boolean {
    return this.readConfiguration().enabled;
  }

  async start():
    Promise<void> {
    if (
      this.currentState.status ===
        'running' ||
      this.currentState.status ===
        'starting'
    ) {
      return;
    }

    const {
      enabled,
      port
    } = this.readConfiguration();

    if (!enabled) {
      this.setState({
        status:
          'disabled',
        url:
          mcpUrl(port)
      });

      throw new McpServerDisabledError();
    }

    const portError =
      mcpPortError(port);

    if (portError) {
      const error =
        new Error(
          `peoplesoft.mcp.port is invalid: ${portError}`
        );

      this.setState({
        status:
          'error',
        url:
          mcpUrl(port),
        error:
          error.message
      });

      throw error;
    }

    this.setState({
      status:
        'starting',
      url:
        mcpUrl(port)
    });

    try {
      this.server =
        await startPeopleSoftMcpServer(
          this.workspace,
          {
            port
          }
        );

      this.setState({
        status:
          'running',
        url:
          this.server.url
      });
    } catch (error) {
      this.server =
        undefined;

      const message =
        (error as NodeJS.ErrnoException)?.code ===
          'EADDRINUSE'
          ? `Port ${port} is already in use. ` +
            'Choose another port in PeopleSoft Studio Settings (peoplesoft.mcp.port).'
          : error instanceof Error
            ? error.message
            : String(error);

      this.setState({
        status:
          'error',
        url:
          mcpUrl(port),
        error:
          message
      });

      throw new Error(
        message
      );
    }
  }

  async stop():
    Promise<void> {
    const server =
      this.server;

    this.server =
      undefined;

    server?.dispose();

    const {
      enabled,
      port
    } = this.readConfiguration();

    this.setState({
      status:
        enabled
          ? 'stopped'
          : 'disabled',
      url:
        mcpUrl(port)
    });
  }

  async restart():
    Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Brings the server in line with `peoplesoft.mcp.*` after it changed; see
   * planMcpReconfiguration for the rules.
   *
   * Resolves to the new URL when a running server moved, so the caller can
   * tell the user that configured AI clients need updating.
   */
  async applyConfiguration():
    Promise<string | undefined> {
    const configuration =
      this.readConfiguration();

    switch (
      planMcpReconfiguration(
        this.currentState.status,
        this.server?.port,
        configuration
      )
    ) {
      case 'stop':
        await this.stop();
        return undefined;

      case 'start':
        await this.start();
        return undefined;

      case 'restart':
        await this.restart();
        return this.currentState.url;

      case 'update-url':
        this.setState({
          status:
            'stopped',
          url:
            mcpUrl(
              configuration.port
            )
        });
        return undefined;

      case 'none':
        return undefined;
    }
  }

  /** Re-applies `peoplesoft.mcp.*` whenever it changes. */
  watchConfiguration():
    vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(
      event => {
        if (
          !event.affectsConfiguration(
            'peoplesoft.mcp'
          )
        ) {
          return;
        }

        void this.applyConfiguration()
          .then(
            async movedTo => {
              if (!movedTo) {
                return;
              }

              const selected =
                await vscode.window.showInformationMessage(
                  `PeopleSoft Studio MCP now listens on ${movedTo}. ` +
                  'AI clients configured with the old URL need to be reconfigured.',
                  'Configure AI Client'
                );

              if (
                selected ===
                'Configure AI Client'
              ) {
                await vscode.commands.executeCommand(
                  'psft.mcp.configureClient'
                );
              }
            },
            error => {
              void vscode.window.showErrorMessage(
                'PeopleSoft Studio MCP: ' +
                `${error instanceof Error ? error.message : String(error)}`
              );
            }
          );
      }
    );
  }

  dispose(): void {
    this.server?.dispose();

    this.server =
      undefined;

    this.stateEmitter.dispose();
  }

  private setState(
    state: McpServerState
  ): void {
    this.currentState =
      state;

    this.stateEmitter.fire(
      this.state
    );
  }
}
