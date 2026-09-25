import * as vscode from 'vscode';

import {
  MCP_URL
} from './clients/common.js';

import {
  codexSetupCommand,
  configureCodex
} from './clients/codex.js';

import {
  claudeSetupCommand,
  configureClaude
} from './clients/claude.js';

import {
  McpServerController
} from './controller.js';

type ClientChoice =
  | 'codex'
  | 'claude'
  | 'copy-url'
  | 'manual';

interface ChoiceItem
  extends vscode.QuickPickItem {
  value: ClientChoice;
}

async function copyText(
  text: string,
  message: string
): Promise<void> {
  await vscode.env.clipboard.writeText(
    text
  );

  void vscode.window.showInformationMessage(
    message
  );
}

async function configureWithFallback(
  label: string,
  configure:
    () => Promise<{
      message: string;
    }>,
  setupCommand: string
): Promise<void> {
  try {
    const result =
      await configure();

    void vscode.window.showInformationMessage(
      `${result.message} Restart or reload ${label} if it is already running.`
    );
  } catch (error) {
    const message =
      (error as Error).message;

    const selected =
      await vscode.window.showErrorMessage(
        message,
        'Copy Setup Command'
      );

    if (
      selected ===
      'Copy Setup Command'
    ) {
      await copyText(
        setupCommand,
        `${label} MCP setup command copied to the clipboard.`
      );
    }
  }
}

export async function configureAiClient(
  controller: McpServerController
): Promise<void> {
  if (
    controller.state.status !==
    'running'
  ) {
    const selected =
      await vscode.window.showWarningMessage(
        'The PeopleSoft Studio MCP server is not running.',
        'Start MCP Server',
        'Cancel'
      );

    if (
      selected !==
      'Start MCP Server'
    ) {
      return;
    }

    try {
      await controller.start();
    } catch (error) {
      void vscode.window.showErrorMessage(
        'Unable to start the PeopleSoft Studio MCP server: ' +
        `${error instanceof Error ? error.message : String(error)}`
      );

      return;
    }
  }

  const choices:
    ChoiceItem[] = [
      {
        label:
          '$(sparkle) Codex',
        description:
          'Configure OpenAI Codex CLI / IDE',
        value:
          'codex'
      },
      {
        label:
          '$(hubot) Claude Code',
        description:
          'Configure Claude Code for all local projects',
        value:
          'claude'
      },
      {
        label:
          '$(copy) Copy MCP URL',
        description:
          MCP_URL,
        value:
          'copy-url'
      },
      {
        label:
          '$(terminal) Manual Setup',
        description:
          'Show setup commands for supported MCP clients',
        value:
          'manual'
      }
    ];

  const picked =
    await vscode.window.showQuickPick(
      choices,
      {
        title:
          'Configure AI Client',
        placeHolder:
          'Choose an MCP client',
        ignoreFocusOut:
          true
      }
    );

  if (!picked) {
    return;
  }

  switch (picked.value) {
    case 'codex':
      await configureWithFallback(
        'Codex',
        configureCodex,
        codexSetupCommand()
      );
      return;

    case 'claude':
      await configureWithFallback(
        'Claude Code',
        configureClaude,
        claudeSetupCommand()
      );
      return;

    case 'copy-url':
      await copyText(
        MCP_URL,
        'PeopleSoft Studio MCP URL copied to the clipboard.'
      );
      return;

    case 'manual': {
      const selected =
        await vscode.window.showQuickPick(
          [
            {
              label:
                'Codex',
              description:
                codexSetupCommand(),
              command:
                codexSetupCommand()
            },
            {
              label:
                'Claude Code',
              description:
                claudeSetupCommand(),
              command:
                claudeSetupCommand()
            }
          ],
          {
            title:
              'Manual MCP Setup',
            placeHolder:
              'Choose a command to copy',
            ignoreFocusOut:
              true
          }
        );

      if (!selected) {
        return;
      }

      await copyText(
        selected.command,
        `${selected.label} setup command copied to the clipboard.`
      );

      return;
    }
  }
}
