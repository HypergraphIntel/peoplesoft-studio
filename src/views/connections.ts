import * as vscode from 'vscode';
import { ConnectionConfig, providerId, Workspace } from '../workspace.js';

export class ConnectionsView implements vscode.TreeDataProvider<ConnectionConfig> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly workspace: Workspace) {
    workspace.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: ConnectionConfig): vscode.TreeItem {
    const id = providerId(element);
    const connected = this.workspace.getProvider(id)?.isConnected ?? false;
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    item.description = element.kind === 'projectFile' ? element.path : element.connectString;
    item.iconPath = new vscode.ThemeIcon(
      element.kind === 'projectFile' ? 'file-zip' : 'database',
      connected ? new vscode.ThemeColor('charts.green') : undefined);
    item.contextValue = `connection.${connected ? 'connected' : 'disconnected'}`;
    item.tooltip = connected ? `Connected to ${element.name}` : `Not connected`;
    if (!connected) {
      item.command = { command: 'psft.connect', title: 'Connect', arguments: [element] };
    }
    return item;
  }

  getChildren(element?: ConnectionConfig): ConnectionConfig[] {
    return element ? [] : this.workspace.connections;
  }
}
