import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { DefinitionProvider, DefinitionSummary, canExpand } from '../providers/provider.js';
import {
  DefinitionType, displayName, isPeopleCode, typeLabel
} from '../model/definitions.js';
import { toUri } from '../util/uri.js';
import { definitionContextValue } from './contextValue.js';

type Node =
  | { kind: 'connection'; provider: DefinitionProvider }
  | { kind: 'hint'; provider: DefinitionProvider }
  | { kind: 'newHint'; provider: DefinitionProvider }
  | { kind: 'type'; provider: DefinitionProvider; type: DefinitionType }
  | { kind: 'definition'; provider: DefinitionProvider; summary: DefinitionSummary };

/** Types offered as top-level folders, in the order App Designer lists them. */
const BROWSABLE: DefinitionType[] = [
  DefinitionType.Record,
  DefinitionType.Field,
  DefinitionType.Page,
  DefinitionType.Component,
  DefinitionType.Menu,
  DefinitionType.ApplicationPackage,
  DefinitionType.AppEngineProgram,
  DefinitionType.SqlDefinition,
  DefinitionType.FileLayout,
  DefinitionType.ComponentInterface,
  DefinitionType.Query,
  DefinitionType.ProcessDefinition,
  DefinitionType.Tree,
  DefinitionType.IbMessage,
  DefinitionType.IbService,
  DefinitionType.IbServiceOperation,
  DefinitionType.Image,
  DefinitionType.PortalRegistry,
  DefinitionType.PermissionList,
  DefinitionType.Role
];

export class BrowserView implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Per-type name filter, so a browse of PSRECDEFN does not fetch 30,000 rows. */
  private readonly filters = new Map<string, string>();

  constructor(private readonly workspace: Workspace) {
    workspace.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  setFilter(provider: DefinitionProvider, type: DefinitionType, pattern: string): void {
    this.filters.set(`${provider.id}/${type}`, pattern);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'connection': {
        const item = new vscode.TreeItem(
          node.provider.displayName, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('server-environment');
        item.contextValue = 'browserConnection';
        return item;
      }
      case 'hint': {
        const item = new vscode.TreeItem(
          'Open Definition...', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('search');
        item.tooltip = new vscode.MarkdownString(
          'An environment is not browsed by listing it. Search for a definition by name instead.');
        item.command = { command: 'psft.openDefinitionDialog', title: 'Open Definition' };
        return item;
      }
      case 'newHint': {
        const item = new vscode.TreeItem('New Definition...', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('new-file');
        item.tooltip = new vscode.MarkdownString('Create a definition: choose its type, then name it.');
        item.command = { command: 'psft.newDefinition', title: 'New Definition' };
        return item;
      }
      case 'type': {
        const item = new vscode.TreeItem(
          typeLabel(node.type), vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('folder');
        item.description = this.filters.get(`${node.provider.id}/${node.type}`);
        item.contextValue = 'definitionType';
        return item;
      }
      case 'definition': {
        const key = node.summary.key;
        const item = new vscode.TreeItem(
          node.summary.label ?? displayName(key),
          canExpand(key)
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        item.description = node.summary.description;
        item.iconPath = new vscode.ThemeIcon(iconFor(key.type));
        item.contextValue = definitionContextValue(key);
        item.resourceUri = toUri(node.provider.id, key);
        item.command = {
          command: 'psft.openDefinition',
          title: 'Open',
          arguments: [node.provider.id, key]
        };
        if (node.summary.lastUpdatedBy) {
          item.tooltip = new vscode.MarkdownString(
            `**${displayName(key)}**\n\nLast updated by \`${node.summary.lastUpdatedBy}\``);
        }
        return item;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return this.workspace.activeProviders
        .filter((p) => p.isConnected)
        .map((provider) => ({ kind: 'connection', provider }));
    }

    if (node.kind === 'connection') {
      // A database is never listed by type: even one folder of records is
      // thousands of rows, and the point of connecting is to wait until asked.
      // Definitions are found through the Open Definition dialog instead.
      if (node.provider.capabilities.globalSearch) {
        return [{ kind: 'hint', provider: node.provider }, { kind: 'newHint', provider: node.provider }];
      }
      // A project export is local and finite, so listing what it holds costs
      // nothing and is the fastest way to see its contents.
      return node.provider.searchableTypes
        .filter((type) => BROWSABLE.includes(type))
        .map((type) => ({ kind: 'type', provider: node.provider, type }));
    }

    if (node.kind === 'type') {
      const filter = this.filters.get(`${node.provider.id}/${node.type}`);
      // Without a filter a live environment would return tens of thousands of
      // rows, so cap the listing and let the user narrow it.
      try {
        const results = await node.provider.search({
          type: node.type,
          namePattern: filter ? `${filter.toUpperCase()}%` : '%',
          limit: 300
        });
        return results.map((summary) => ({ kind: 'definition', provider: node.provider, summary }));
      } catch (err) {
        vscode.window.showErrorMessage(
          `Could not list ${typeLabel(node.type)}: ${(err as Error).message}`);
        return [];
      }
    }

    if (node.kind === 'definition') {
      if (!canExpand(node.summary.key)) return [];
      try {
        const children = await node.provider.listChildren(node.summary.key);
        return children.map((summary) => ({
          kind: 'definition' as const, provider: node.provider, summary
        }));
      } catch (err) {
        vscode.window.showErrorMessage(
          `Could not expand ${displayName(node.summary.key)}: ${(err as Error).message}`);
        return [];
      }
    }

    return [];
  }
}

function iconFor(type: DefinitionType): string {
  if (isPeopleCode(type)) return 'symbol-method';
  switch (type) {
    case DefinitionType.Record: return 'table';
    case DefinitionType.Field: return 'symbol-field';
    case DefinitionType.RecordPeopleCode: return 'symbol-event';
    case DefinitionType.Page: return 'browser';
    case DefinitionType.Component: return 'window';
    case DefinitionType.Menu: return 'list-tree';
    case DefinitionType.ApplicationPackage: return 'package';
    case DefinitionType.AppEngineProgram: return 'gear';
    case DefinitionType.SqlDefinition: return 'database';
    case DefinitionType.FileLayout: return 'file-text';
    case DefinitionType.ComponentInterface: return 'plug';
    case DefinitionType.PermissionList: return 'shield';
    case DefinitionType.Role: return 'person';
    case DefinitionType.Query: return 'search';
    case DefinitionType.ProcessDefinition: return 'run';
    case DefinitionType.Tree: return 'type-hierarchy';
    case DefinitionType.IbMessage: return 'mail';
    case DefinitionType.Image: return 'file-media';
    case DefinitionType.PortalRegistry: return 'globe';
    case DefinitionType.IbService: return 'server';
    case DefinitionType.IbServiceOperation: return 'arrow-swap';
    case DefinitionType.MessageCatalog: return 'comment';
    case DefinitionType.HtmlDefinition: return 'code';
    case DefinitionType.StyleSheet: return 'symbol-color';
    default: return 'symbol-misc';
  }
}
