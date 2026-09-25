import * as vscode from 'vscode';

import {
  MCP_URL,
  type RunningMcpServer,
  startPeopleSoftMcpServer
} from './server.js';

import {
  Workspace
} from '../workspace.js';

export type McpServerStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error';

export interface McpServerState {
  status: McpServerStatus;
  url: string;
  error?: string;
}

export class McpServerController
  implements vscode.Disposable {
  private server:
    RunningMcpServer | undefined;

  private currentState:
    McpServerState = {
      status:
        'stopped',
      url:
        MCP_URL
    };

  private readonly stateEmitter =
    new vscode.EventEmitter<McpServerState>();

  readonly onDidChangeState =
    this.stateEmitter.event;

  constructor(
    private readonly workspace:
      Workspace
  ) {}

  get state():
    McpServerState {
    return {
      ...this.currentState
    };
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

    this.setState({
      status:
        'starting',
      url:
        MCP_URL
    });

    try {
      this.server =
        await startPeopleSoftMcpServer(
          this.workspace
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

      this.setState({
        status:
          'error',
        url:
          MCP_URL,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      });

      throw error;
    }
  }

  async stop():
    Promise<void> {
    if (!this.server) {
      this.setState({
        status:
          'stopped',
        url:
          MCP_URL
      });

      return;
    }

    const server =
      this.server;

    this.server =
      undefined;

    server.dispose();

    this.setState({
      status:
        'stopped',
      url:
        MCP_URL
    });
  }

  async restart():
    Promise<void> {
    await this.stop();
    await this.start();
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