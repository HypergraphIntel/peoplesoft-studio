import * as vscode from 'vscode';
import type { SettingsService } from './settingsService.js';
import type { SettingsState } from './settingsMessages.js';

export const OPEN_SETTINGS_COMMAND = 'psft.settings.open';

interface SettingsNode {
  label: string;
  description?: string;
  tooltip?: string;
  icon: string;
  /** A theme color for the icon: green while the thing it stands for is live. */
  color?: string;
}

/** The Connections view's own "connected" green, so live looks the same in both. */
const LIVE = 'charts.green';

/**
 * The Settings entry in the PeopleSoft side bar.
 *
 * A short, read-only summary of the target connection -- chosen in the
 * Connections view or the status bar, not here -- read from the same state
 * the panel renders, and a way into the panel. Every row opens it: the form
 * itself does not fit a tree.
 */
export class SettingsView implements vscode.TreeDataProvider<SettingsNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly subscription: { dispose(): void };

  constructor(private readonly service: SettingsService) {
    this.subscription = service.onDidChangeState(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(node: SettingsNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    if (node.description !== undefined) item.description = node.description;
    if (node.tooltip !== undefined) item.tooltip = node.tooltip;
    item.iconPath = new vscode.ThemeIcon(node.icon, node.color ? new vscode.ThemeColor(node.color) : undefined);
    item.command = { command: OPEN_SETTINGS_COMMAND, title: 'Open Settings' };
    return item;
  }

  getChildren(node?: SettingsNode): SettingsNode[] {
    return node ? [] : summarize(this.service.getState());
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

function summarize(state: SettingsState): SettingsNode[] {
  const nodes: SettingsNode[] = [];
  const target = state.connections.find((c) => c.selected);

  if (target) {
    nodes.push({
      label: target.name,
      description: `${target.connected ? 'Connected' : 'Not connected'} · ${target.access.label}`,
      tooltip: `Target connection: ${target.name}\n${target.access.detail}`,
      icon: target.kind === 'projectFile' ? 'file-zip' : 'database',
      ...(target.connected ? { color: LIVE } : {})
    });
    const env = target.environment;
    if (env.status === 'available') {
      nodes.push({
        label: `PeopleTools ${env.release}`,
        description: env.profile.ok ? `Compiler profile ${env.profile.id}` : 'No compiler profile',
        icon: 'versions',
        // Live: the release and profile come from the connected database.
        ...(target.connected && env.source === 'connection' && env.profile.ok ? { color: LIVE } : {})
      });
    }
  } else {
    nodes.push({
      label: 'No target connection',
      tooltip: 'Choose the target connection in the Connections view or the status bar.',
      icon: 'debug-disconnect'
    });
  }

  nodes.push({ label: 'Open Settings', icon: 'settings-gear' });
  return nodes;
}
