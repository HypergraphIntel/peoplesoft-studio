import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { DefinitionProvider, DefinitionSummary, ProjectSummary } from '../providers/provider.js';
import { DefinitionType, displayName, typeLabel } from '../model/definitions.js';
import { PackageNode, buildPackageTree, isPackageItem } from '../model/appPackages.js';
import { toUri } from '../util/uri.js';

type Node =
  | { kind: 'project'; provider: DefinitionProvider; project: ProjectSummary }
  | { kind: 'group'; provider: DefinitionProvider; project: string; type: DefinitionType; items: DefinitionSummary[] }
  | { kind: 'packageGroup'; provider: DefinitionProvider; roots: PackageNode[]; count: number }
  | { kind: 'packageNode'; provider: DefinitionProvider; node: PackageNode }
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
      case 'packageGroup': {
        const item = new vscode.TreeItem(
          'Application Packages', vscode.TreeItemCollapsibleState.Collapsed);
        item.description = String(node.count);
        item.iconPath = new vscode.ThemeIcon('folder');
        return item;
      }
      case 'packageNode': {
        const pkg = node.node;
        const isClass = pkg.kind === 'class';
        const item = new vscode.TreeItem(
          pkg.name,
          isClass
            ? vscode.TreeItemCollapsibleState.None
            : vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon(isClass ? 'symbol-class' : 'package');
        item.contextValue = isClass ? 'definition' : 'appPackage';
        if (pkg.key) {
          item.resourceUri = toUri(node.provider.id, pkg.key);
          // A package node is only openable when it is an item in its own
          // right; an interior node inferred from a class path is not.
          item.command = {
            command: 'psft.openDefinition',
            title: 'Open',
            arguments: [node.provider.id, pkg.key]
          };
        }
        if (!isClass) {
          const classes = countClasses(pkg);
          if (classes > 0) item.description = `${classes}`;
        }
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

      // Packages and classes are folded into one hierarchy rather than listed
      // as two flat groups, because that is how App Designer presents them and
      // a class is meaningless without its package path.
      const packageItems = items.filter((i) => isPackageItem(i.key.type));
      const groups: Node[] = [];

      const byType = new Map<DefinitionType, DefinitionSummary[]>();
      for (const item of items) {
        if (isPackageItem(item.key.type)) continue;
        const list = byType.get(item.key.type) ?? [];
        list.push(item);
        byType.set(item.key.type, list);
      }

      for (const [type, list] of [...byType.entries()].sort((a, b) => a[0] - b[0])) {
        groups.push({
          kind: 'group',
          provider: node.provider,
          project: node.project.name,
          type,
          items: list
        });
      }

      if (packageItems.length > 0) {
        groups.push({
          kind: 'packageGroup',
          provider: node.provider,
          roots: buildPackageTree(packageItems),
          count: packageItems.length
        });
      }
      return groups;
    }

    if (node.kind === 'packageGroup') {
      return node.roots.map((root) => ({
        kind: 'packageNode' as const, provider: node.provider, node: root
      }));
    }

    if (node.kind === 'packageNode') {
      return node.node.children.map((child) => ({
        kind: 'packageNode' as const, provider: node.provider, node: child
      }));
    }

    if (node.kind === 'group') {
      return node.items.map((summary) => ({ kind: 'item', provider: node.provider, summary }));
    }

    return [];
  }
}

/** Classes anywhere below a package node, for the child count shown beside it. */
function countClasses(node: PackageNode): number {
  return node.children.reduce(
    (total, child) => total + (child.kind === 'class' ? 1 : countClasses(child)), 0);
}
