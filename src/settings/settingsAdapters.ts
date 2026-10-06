import * as vscode from 'vscode';
import { providerId, Workspace } from '../workspace.js';
import type { McpServerController } from '../mcp/controller.js';
import { CONFIGURATION_SECTION, type SettingScope } from './settingsModel.js';
import type { ConfigurationPort, ConnectionPort, McpPort, UiPort } from './settingsService.js';

/*
 * Binds the SettingsService ports to VS Code and the extension's existing
 * objects. Each port delegates; none of them keeps state of its own.
 */

const TARGETS: Record<SettingScope, vscode.ConfigurationTarget> = {
  global: vscode.ConfigurationTarget.Global,
  workspace: vscode.ConfigurationTarget.Workspace,
  workspaceFolder: vscode.ConfigurationTarget.WorkspaceFolder
};

export function configurationPort(): ConfigurationPort {
  // Read fresh every time: a WorkspaceConfiguration is a snapshot.
  const section = () => vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  return {
    get: (key) => section().get(key),
    inspect: (key) => section().inspect(key),
    update: (key, value, scope) => Promise.resolve(section().update(key, value, TARGETS[scope])),
    onDidChange: (listener) => vscode.workspace.onDidChangeConfiguration((e) =>
      listener((key) => e.affectsConfiguration(`${CONFIGURATION_SECTION}.${key}`)))
  };
}

export function connectionPort(workspace: Workspace): ConnectionPort {
  return {
    list: () => workspace.connections.map((config) => {
      const id = providerId(config);
      return { id, config, connected: workspace.getProvider(id)?.isConnected ?? false };
    }),
    selectedId: () => workspace.selectedConnectionId,
    // The existing commands, so the Connections view and this panel behave alike.
    add: async () => { await vscode.commands.executeCommand('psft.addConnection'); },
    remove: async (config) => { await vscode.commands.executeCommand('psft.removeConnection', config); },
    test: (config) => workspace.testConnection(config),
    readEnvironment: (id) => {
      const provider = workspace.getProvider(id);
      return provider?.isConnected ? provider.readEnvironment?.() : undefined;
    },
    onDidChange: (listener) => workspace.onDidChange(listener)
  };
}

export function mcpPort(controller: McpServerController): McpPort {
  const commands = {
    start: 'psft.mcp.start',
    stop: 'psft.mcp.stop',
    restart: 'psft.mcp.restart',
    configureClient: 'psft.mcp.configureClient',
    copyUrl: 'psft.mcp.copyUrl'
  } as const;
  return {
    state: () => controller.state,
    run: async (action) => { await vscode.commands.executeCommand(commands[action]); },
    onDidChange: (listener) => controller.onDidChangeState(() => listener())
  };
}

export function uiPort(extensionId: string): UiPort {
  return {
    showError: (message) => { void vscode.window.showErrorMessage(message); },
    openNativeSettings: async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${extensionId}`);
    }
  };
}
