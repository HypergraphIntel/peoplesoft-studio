import * as vscode from 'vscode';

import {
  McpServerController,
  type McpServerState
} from './controller.js';

import {
  configureAiClient
} from './configure.js';

export class McpStatus
  implements vscode.Disposable {
  private readonly item:
    vscode.StatusBarItem;

  private readonly subscriptions:
    vscode.Disposable[] = [];

  constructor(
    private readonly controller:
      McpServerController
  ) {
    this.item =
      vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        90
      );

    this.item.command =
      'psft.mcp.menu';

    this.item.name =
      'PeopleSoft Studio MCP';

    this.update(
      controller.state
    );

    this.subscriptions.push(
      controller.onDidChangeState(
        state => {
          this.update(state);
        }
      )
    );

    this.item.show();
  }

  dispose(): void {
    for (
      const subscription
      of this.subscriptions
    ) {
      subscription.dispose();
    }

    this.item.dispose();
  }

  private update(
    state: McpServerState
  ): void {
    switch (state.status) {
      case 'running':
        this.item.text =
          '$(check) MCP';

        this.item.tooltip =
          `PeopleSoft Studio MCP\nRunning\n${state.url}`;

        break;

      case 'starting':
        this.item.text =
          '$(sync~spin) MCP';

        this.item.tooltip =
          'PeopleSoft Studio MCP is starting';

        break;

      case 'error':
        this.item.text =
          '$(error) MCP';

        this.item.tooltip =
          `PeopleSoft Studio MCP error\n${state.error ?? 'Unknown error'}`;

        break;

      case 'stopped':
      default:
        this.item.text =
          '$(circle-slash) MCP';

        this.item.tooltip =
          'PeopleSoft Studio MCP is stopped';

        break;
    }
  }
}