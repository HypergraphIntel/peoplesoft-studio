import * as vscode from 'vscode';
import { ConnectionConfig, providerId, Workspace } from '../workspace.js';

/**
 * Makes `config` the target connection, connecting to it first if needed.
 *
 * The one path every connection selector goes through -- the status-bar
 * picker and the Settings panel -- so both leave the workspace in the same
 * state and fire the same change event. A connection that fails to connect is
 * not selected; the failure is reported here and `false` returned.
 */
export async function selectConnection(
  workspace: Workspace,
  config: ConnectionConfig
): Promise<boolean> {
  const id = providerId(config);

  if (!workspace.getProvider(id)?.isConnected) {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to ${config.name}...`
        },
        () => workspace.connect(config)
      );
    } catch (err) {
      vscode.window.showErrorMessage(
        `Connecting to ${config.name} failed: ${(err as Error).message}`);
      return false;
    }

    if (!workspace.getProvider(id)?.isConnected) return false;
  }

  workspace.setSelectedConnection(id);
  return true;
}
