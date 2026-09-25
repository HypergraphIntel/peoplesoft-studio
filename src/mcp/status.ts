import * as vscode from 'vscode';

import {
  McpServerController,
  type McpServerState
} from './controller.js';

import {
  configureAiClient
} from './configure.js';

type McpMenuAction =
  | 'status'
  | 'configure'
  | 'copy'
  | 'start'
  | 'stop'
  | 'restart';

interface McpMenuItem
  extends vscode.QuickPickItem {
  action: McpMenuAction;
}

export class McpStatus
  implements vscode.Disposable {
  private readonly item:
    vscode.StatusBarItem;

  private readonly subscriptions:
    vscode.Disposable[] = [];

constructor(
    controller:
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

export async function showMcpStatus(
  controller: McpServerController
): Promise<void> {
  const state =
    controller.state;

  const lines = [
    `Status: ${state.status}`,
    `URL: ${state.url}`
  ];

  if (state.error) {
    lines.push(
      `Error: ${state.error}`
    );
  }

  await vscode.window.showInformationMessage(
    `PeopleSoft Studio MCP\n\n${lines.join('\n')}`,
    {
      modal:
        true
    }
  );
}

async function runAction(
  label: string,
  action:
    () => Promise<void>
): Promise<void> {
  try {
    await action();

    void vscode.window.showInformationMessage(
      `PeopleSoft Studio MCP ${label}.`
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `PeopleSoft Studio MCP ${label} failed: ` +
      `${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function showMcpMenu(
  controller: McpServerController
): Promise<void> {
  const state =
    controller.state;

  const items:
    McpMenuItem[] = [
      {
        label:
          state.status === 'running'
            ? '$(check) MCP Server Running'
            : state.status === 'error'
              ? '$(error) MCP Server Error'
              : state.status === 'starting'
                ? '$(sync~spin) MCP Server Starting'
                : '$(circle-slash) MCP Server Stopped',
        description:
          state.status === 'error'
            ? state.error
            : state.url,
        action:
          'status'
      },
      {
        label:
          '$(sparkle) Configure AI Client',
        description:
          'Codex, Claude Code, or manual MCP configuration',
        action:
          'configure'
      },
      {
        label:
          '$(copy) Copy MCP URL',
        description:
          state.url,
        action:
          'copy'
      }
    ];

  if (
    state.status ===
    'running'
  ) {
    items.push(
      {
        label:
          '$(refresh) Restart MCP Server',
        action:
          'restart'
      },
      {
        label:
          '$(debug-stop) Stop MCP Server',
        action:
          'stop'
      }
    );
  } else if (
    state.status !==
    'starting'
  ) {
    items.push({
      label:
        '$(play) Start MCP Server',
      action:
        'start'
    });
  }

  const selected =
    await vscode.window.showQuickPick(
      items,
      {
        title:
          'PeopleSoft Studio MCP',
        placeHolder:
          state.status === 'running'
            ? `Running — ${state.url}`
            : 'MCP server controls',
        ignoreFocusOut:
          true
      }
    );

  if (!selected) {
    return;
  }

  switch (selected.action) {
    case 'status':
      await showMcpStatus(
        controller
      );
      return;

    case 'configure':
      await configureAiClient(
        controller
      );
      return;

    case 'copy':
      await vscode.env.clipboard.writeText(
        controller.state.url
      );

      void vscode.window.showInformationMessage(
        'PeopleSoft Studio MCP URL copied.'
      );
      return;

    case 'start':
      await runAction(
        'started',
        () => controller.start()
      );
      return;

    case 'stop':
      await runAction(
        'stopped',
        () => controller.stop()
      );
      return;

    case 'restart':
      await runAction(
        'restarted',
        () => controller.restart()
      );
      return;
  }
}
