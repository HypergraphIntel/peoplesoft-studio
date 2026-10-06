import * as vscode from 'vscode';
import type { Workspace } from '../workspace.js';
import type { McpServerController } from '../mcp/controller.js';
import { SettingsService } from './settingsService.js';
import { SettingsPanel } from './settingsPanel.js';
import { OPEN_SETTINGS_COMMAND, SettingsView } from './settingsView.js';
import { configurationPort, connectionPort, mcpPort, uiPort } from './settingsAdapters.js';

/** Registers the Settings command, side-bar view and panel serializer. */
export function registerSettings(
  context: vscode.ExtensionContext,
  workspace: Workspace,
  mcpController: McpServerController
): void {
  const service = new SettingsService(
    configurationPort(),
    connectionPort(workspace),
    uiPort(context.extension.id),
    mcpPort(mcpController));
  const view = new SettingsView(service);

  context.subscriptions.push(
    service,
    view,
    vscode.window.registerTreeDataProvider('psft.settings', view),
    vscode.commands.registerCommand(OPEN_SETTINGS_COMMAND,
      () => SettingsPanel.show(service, context.extensionUri)),
    vscode.window.registerWebviewPanelSerializer(SettingsPanel.viewType, {
      deserializeWebviewPanel: async (panel) => SettingsPanel.revive(panel, service, context.extensionUri)
    })
  );
}
