import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { DefinitionProvider, DefinitionSummary, ProjectSummary } from '../providers/provider.js';
import { DefinitionType, displayName, typeLabel } from '../model/definitions.js';
import { toUri } from '../util/uri.js';

type Node =
  | { kind: 'project'; provider: DefinitionProvider; project: ProjectSummary }
  | { kind: 'group'; provider: DefinitionProvider; project: string; type: DefinitionType; items: DefinitionSummary[] }
  | { kind: 'item'; provider: DefinitionProvider; summary: DefinitionSummary };

/**
 * The project tree, which is how App Designer users actually navigate: a
 * project is the unit of migration, so the definitions in it are the working
 * set rather than the whole environment.
 */
export class ProjectsView implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly workspace: Workspace) {
    workspace.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'project': {
        const item = new vscode.TreeItem(
          node.project.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = node.project.description;
        item.iconPath = new vscode.ThemeIcon('project');
        item.contextValue = 'project';
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(
          typeLabel(node.type), vscode.TreeItemCollapsibleState.Collapsed);
        item.description = String(node.items.length);
        item.iconPath = new vscode.ThemeIcon('folder');
        return item;
      }
      case 'item': {
        const key = node.summary.key;
        const item = new vscode.TreeItem(displayName(key), vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('symbol-file');
        item.contextValue = 'definition';
        item.resourceUri = toUri(node.provider.id, key);
        item.command = {
          command: 'psft.openDefinition',
          title: 'Open',
          arguments: [node.provider.id, key]
        };
        return item;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const out: Node[] = [];
      for (const provider of this.workspace.activeProviders) {
        if (!provider.isConnected) continue;
        try {
          for (const project of await provider.listProjects()) {
            out.push({ kind: 'project', provider, project });
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `Could not list projects in ${provider.displayName}: ${(err as Error).message}`);
        }
      }
      return out;
    }

    if (node.kind === 'project') {
      const items = await node.provider.listProjectItems(node.project.name);
      const byType = new Map<DefinitionType, DefinitionSummary[]>();
      for (const item of items) {
        const list = byType.get(item.key.type) ?? [];
        list.push(item);
        byType.set(item.key.type, list);
      }
      return [...byType.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([type, list]) => ({
          kind: 'group' as const,
          provider: node.provider,
          project: node.project.name,
          type,
          items: list
        }));
    }

    if (node.kind === 'group') {
      return node.items.map((summary) => ({ kind: 'item', provider: node.provider, summary }));
    }

    return [];
  }
}
