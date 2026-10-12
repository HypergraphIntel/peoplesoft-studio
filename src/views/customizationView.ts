import * as vscode from 'vscode';
import { keyFromString, type DefinitionType } from '../model/definitions.js';
import {
  DESIGNER_TYPES, nameFromTitle, strategySections, type CustomizationContext, type CustomizationPolicy, type OwnershipState, type StrategyRow
} from '../model/customizationStrategy.js';
import { DatabaseProvider } from '../providers/database.js';
import { CustomizationPlanPanel } from '../editors/customizationPlanPanel.js';
import { SCHEME } from '../util/uri.js';
import type { Workspace } from '../workspace.js';
import { mutedUri } from './toolsViews.js';
import { normalizePrefixes } from '../model/ownership.js';

/*
 * The Customization Strategy view (CUSTOMIZATION_STRATEGY_PANEL.md): a
 * companion to the editors that follows the PeopleSoft definition in the
 * active tab -- a psft:// text editor, a record / field editor, or a designer
 * panel -- and shows its identity, the preferred strategy, the configuration
 * frameworks that could extend it, its upgrade impact and actions. Ownership
 * is classified from the database's evidence (model/ownership.ts); capability
 * discovery is not implemented yet, so capabilities show as unknown, greyed.
 */

export function readCustomizationPolicy(): CustomizationPolicy {
  const c = vscode.workspace.getConfiguration('peoplesoft.customization');
  return {
    // The prefix list; when it is empty, 0.8.4's single organizationPrefix, else the write-scope prefix (peoplesoft.writeNamePrefix) is the organization's.
    prefixes: normalizePrefixes(c.get<unknown[]>('namingPrefixes', []),
      c.get<string>('organizationPrefix', '') || vscode.workspace.getConfiguration('peoplesoft').get<string>('writeNamePrefix', '')),
    defaultStrategy: c.get<'configurationFirst' | 'allowDirect'>('defaultStrategy', 'configurationFirst'),
    deliveredObjectPolicy: c.get<'block' | 'requireApproval' | 'allowWithAudit'>('deliveredObjectPolicy', 'allowWithAudit'),
    agentDeliveredObjectPolicy: c.get<'block' | 'requireApproval' | 'allowWithAudit'>('agentDeliveredObjectPolicy', 'requireApproval')
  };
}

export class CustomizationStrategyView implements vscode.TreeDataProvider<StrategyRow> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private current: CustomizationContext | undefined;
  private pinned: CustomizationContext | undefined;
  private readonly owners = new Map<string, OwnershipState>();

  constructor(private readonly workspace: Workspace) {}

  /** The definition shown: the pinned one, else the active tab's. */
  get context(): CustomizationContext | undefined { return this.pinned ?? this.current; }

  /** Follows the active tab; a tab that is not a PeopleSoft definition leaves the last one shown. */
  follow(): void {
    const ctx = this.fromActiveTab();
    if (!ctx) return;
    if (ctx.name === this.current?.name && ctx.type === this.current.type && ctx.connection === this.current.connection) return;
    this.current = ctx;
    if (!this.pinned) this.changed.fire();
  }

  pin(): void {
    if (!this.current) return;
    this.pinned = this.current;
    void vscode.commands.executeCommand('setContext', 'psft.customization.pinned', true);
    this.changed.fire();
  }

  unpin(): void {
    this.pinned = undefined;
    void vscode.commands.executeCommand('setContext', 'psft.customization.pinned', false);
    this.follow();
    this.changed.fire();
  }

  /** Re-reads the shown definition's ownership (after a save, or a baseline or setting change). */
  refresh(): void {
    this.owners.clear();
    this.changed.fire();
  }

  getChildren(row?: StrategyRow): StrategyRow[] {
    if (row) return row.children ?? [];
    const ctx = this.context;
    return strategySections(ctx, readCustomizationPolicy(), !!this.pinned, ctx ? this.ownerOf(ctx) : undefined);
  }

  /** The definition's ownership: read once per definition, the view refreshed when it arrives. */
  private ownerOf(ctx: CustomizationContext): OwnershipState {
    const id = `${ctx.connectionId ?? ''}\u0000${ctx.type}\u0000${(ctx.parts ?? [ctx.name]).join('.')}`;
    const known = this.owners.get(id);
    if (known) return known;
    const provider = ctx.connectionId ? this.workspace.activeProviders.find((p) => p.id === ctx.connectionId) : undefined;
    if (!(provider instanceof DatabaseProvider) || !provider.isConnected) {
      const state: OwnershipState = { state: 'unavailable', message: 'Classified on a connected database: open the definition from one.' };
      this.owners.set(id, state);
      return state;
    }
    const pending: OwnershipState = { state: 'pending' };
    this.owners.set(id, pending);
    provider.classifyDefinition({ type: ctx.type, parts: ctx.parts ?? [ctx.name] }, readCustomizationPolicy().prefixes)
      .then((r) => this.owners.set(id, { state: 'done', classification: r.classification, baseline: !!r.evidence.baseline }))
      .catch((error) => this.owners.set(id, { state: 'unavailable', message: `Could not classify it: ${error instanceof Error ? error.message : String(error)}` }))
      .finally(() => { if (this.owners.get(id) !== pending) this.changed.fire(); });
    return pending;
  }

  getTreeItem(row: StrategyRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, row.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = row.id;
    if (row.description) item.description = row.description;
    if (row.tooltip) item.tooltip = row.tooltip;
    item.iconPath = new vscode.ThemeIcon(row.icon, row.muted ? new vscode.ThemeColor('disabledForeground') : undefined);
    if (row.muted) item.resourceUri = mutedUri(`/customization/${encodeURIComponent(row.id)}`);
    if (row.command) item.command = { command: row.command.id, title: row.label, arguments: row.command.args ?? [] };
    return item;
  }

  private fromActiveTab(): CustomizationContext | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab) return undefined;
    const input = tab.input;
    const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
    if (uri?.scheme === SCHEME) {
      const [keyPart] = uri.path.split('/').filter(Boolean);
      if (!keyPart) return undefined;
      try {
        const key = keyFromString(decodeURIComponent(keyPart));
        const provider = this.workspace.getProviderByHandle(uri.authority.toLowerCase());
        return { type: key.type, name: key.parts.join('.'), parts: [...key.parts], ...(provider ? { connection: provider.displayName, connectionId: provider.id } : {}) };
      } catch {
        return undefined;
      }
    }
    // A designer panel: its view type (VS Code prefixes it) names the definition type, its title the definition.
    if (input instanceof vscode.TabInputWebview) {
      const viewType = Object.keys(DESIGNER_TYPES).find((v) => input.viewType === v || input.viewType.endsWith(`-${v}`));
      if (viewType) {
        // A designer's tab does not say its connection: the only connected database, if there is just one.
        const connected = this.workspace.activeProviders.filter((p) => p instanceof DatabaseProvider && p.isConnected);
        const one = connected.length === 1 ? connected[0] : undefined;
        const name = nameFromTitle(tab.label);
        return { type: DESIGNER_TYPES[viewType] as DefinitionType, name, parts: [name], ...(one ? { connection: one.displayName, connectionId: one.id } : {}) };
      }
    }
    return undefined;
  }
}

/** Registers the view, its commands and the Plan Designer. */
export function registerCustomizationStrategy(context: vscode.ExtensionContext, workspace: Workspace): void {
  const view = new CustomizationStrategyView(workspace);
  const tree = vscode.window.createTreeView('psft.customizationStrategy', { treeDataProvider: view });
  tree.description = 'Preview';
  context.subscriptions.push(
    tree,
    vscode.window.tabGroups.onDidChangeTabs(() => view.follow()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => view.follow()),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('peoplesoft.customization') || e.affectsConfiguration('peoplesoft.writeNamePrefix')) view.refresh(); }),
    vscode.workspace.onDidSaveTextDocument((d) => { if (d.uri.scheme === SCHEME) view.refresh(); }),
    vscode.commands.registerCommand('psft.customization.pin', () => view.pin()),
    vscode.commands.registerCommand('psft.customization.unpin', () => view.unpin()),
    vscode.commands.registerCommand('psft.customization.refresh', () => { view.follow(); view.refresh(); }),
    vscode.commands.registerCommand('psft.customization.discover', (what?: string) => {
      void vscode.window.showInformationMessage(`${what ? `${what}: c` : 'C'}apability discovery is not available yet — Customization Intelligence is a preview.`);
    }),
    vscode.commands.registerCommand('psft.customization.openPlan', () => {
      CustomizationPlanPanel.show(context.extensionUri, view.context, readCustomizationPolicy());
    }),
    vscode.commands.registerCommand('psft.customization.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'peoplesoft.customization'))
  );
  view.follow();
}
