import * as vscode from 'vscode';
import { DefinitionType, keyFromString, makeKey } from '../model/definitions.js';
import type { EventMappingConfigRow } from '../model/eventMapping.js';
import { EventMappingPanel, setEventMappingExtensionUri } from '../editors/eventMappingPanel.js';
import { SERVICE_NAME_MAX, validateServiceRequest } from '../providers/rcServiceWriter.js';
import {
  DESIGNER_TYPES, knowledgeSubsystem, nameFromTitle, strategySections, type CapabilitiesState, type CustomizationContext, type KnowledgeSummary, type CustomizationPolicy, type OwnershipState, type StrategyRow
} from '../model/customizationStrategy.js';
import { DatabaseProvider } from '../providers/database.js';
import { knowledgeFor } from '../intelligenceCommands.js';
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

/** What the discovery engine knows about Event Mapping on the connection's release (best effort: none when unavailable). */
async function eventMappingKnowledge(provider: DatabaseProvider): Promise<{ knowledge?: KnowledgeSummary }> {
  try {
    const knowledge = await knowledgeFor({ subsystem: 'event-mapping' }, provider);
    return knowledge ? { knowledge } : {};
  } catch {
    return {};
  }
}

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
  private readonly capabilities = new Map<string, CapabilitiesState>();
  private readonly knowledge = new Map<string, KnowledgeSummary | 'pending'>();

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
    this.capabilities.clear();
    this.knowledge.clear();
    this.changed.fire();
  }

  getChildren(row?: StrategyRow): StrategyRow[] {
    if (row) return row.children ?? [];
    const ctx = this.context;
    return strategySections(ctx, readCustomizationPolicy(), !!this.pinned, ctx ? this.ownerOf(ctx) : undefined, ctx ? this.capabilitiesOf(ctx) : undefined,
      ctx ? this.knowledgeOf(ctx) : undefined);
  }

  /** What discovery finds for the definition (Event Mapping so far): read once per definition. */
  private capabilitiesOf(ctx: CustomizationContext): CapabilitiesState {
    const id = `${ctx.connectionId ?? ''}\u0000${ctx.type}\u0000${(ctx.parts ?? [ctx.name]).join('.')}`;
    const known = this.capabilities.get(id);
    if (known) return known;
    const provider = ctx.connectionId ? this.workspace.activeProviders.find((p) => p.id === ctx.connectionId) : undefined;
    if (!(provider instanceof DatabaseProvider) || !provider.isConnected) {
      const state: CapabilitiesState = { state: 'unavailable', message: 'Discovered on a connected database: open the definition from one.' };
      this.capabilities.set(id, state);
      return state;
    }
    const pending: CapabilitiesState = { state: 'pending' };
    this.capabilities.set(id, pending);
    provider.discoverCapabilities({ type: ctx.type, parts: ctx.parts ?? [ctx.name] })
      .then(async (r) => this.capabilities.set(id, { state: 'done', ...r, ...(r.eventMapping ? await eventMappingKnowledge(provider) : {}) }))
      .catch((error) => this.capabilities.set(id, { state: 'unavailable', message: `Discovery failed: ${error instanceof Error ? error.message : String(error)}` }))
      .finally(() => { if (this.capabilities.get(id) !== pending) this.changed.fire(); });
    return pending;
  }

  /** What recorded findings say about writing the definition's kind, on its connection's release: read once per definition. */
  private knowledgeOf(ctx: CustomizationContext): KnowledgeSummary | 'pending' | undefined {
    const subsystem = knowledgeSubsystem(ctx.type);
    if (!subsystem) return undefined;
    const id = `${ctx.connectionId ?? ''}\u0000${subsystem}`;
    if (this.knowledge.has(id)) return this.knowledge.get(id);
    this.knowledge.set(id, 'pending');
    const provider = ctx.connectionId ? this.workspace.activeProviders.find((p) => p.id === ctx.connectionId) : undefined;
    knowledgeFor({ subsystem }, provider instanceof DatabaseProvider && provider.isConnected ? provider : undefined)
      // Nothing to read (not activated) or a failure: remembered as unknown, so the view does not ask again until refreshed.
      .then((k) => { this.knowledge.set(id, k ?? { answer: 'UNKNOWN', findings: [] }); })
      .catch(() => { this.knowledge.set(id, { answer: 'UNKNOWN', findings: [] }); })
      .finally(() => this.changed.fire());
    return 'pending';
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

/** Asks for a service's ID, name and class, then creates what is missing of them (DatabaseProvider.createEventMappingService). */
async function newEventMappingService(provider: DatabaseProvider, operatorId: string, label: string): Promise<string | undefined> {
  const serviceId = (await vscode.window.showInputBox({
    title: 'New Event Mapping Service (1/3)', prompt: 'Service ID (at most 30 characters: letters, digits and _)',
    validateInput: (v) => validateServiceRequest({ serviceId: v, name: 'x', packageRoot: 'X', classId: 'X' })[0]
  }))?.trim().toUpperCase();
  if (!serviceId) return undefined;
  const name = (await vscode.window.showInputBox({
    title: 'New Event Mapping Service (2/3)', prompt: `Service Name (at most ${SERVICE_NAME_MAX} characters)`, value: serviceId.slice(0, SERVICE_NAME_MAX),
    validateInput: (v) => validateServiceRequest({ serviceId, name: v, packageRoot: 'X', classId: 'X' })[0]
  }))?.trim();
  if (!name) return undefined;
  const cls = (await vscode.window.showInputBox({
    title: 'New Event Mapping Service (3/3)', prompt: 'Application class it runs: PACKAGE:Class or PACKAGE:Path:Class (created when missing, with its package)',
    value: `${serviceId}:Handler`, validateInput: (v) => (/^[A-Za-z0-9_]+(:[A-Za-z0-9_]+)+$/.test(v.trim()) ? undefined : 'PACKAGE:Class')
  }))?.trim();
  if (!cls) return undefined;
  const parts = cls.split(':');
  const request = {
    serviceId, name, packageRoot: parts[0].toUpperCase(), ...(parts.length > 2 ? { path: parts.slice(1, -1) } : {}), classId: parts[parts.length - 1],
    purpose: `Event Mapping service ${serviceId}, for ${label}`, operatorId
  };
  const plan = await provider.createEventMappingService({ ...request, dryRun: true });
  const steps = [
    ...(plan.packageCreated ? [`Create Application Package ${request.packageRoot}`] : []),
    ...(plan.classCreated ? [`Create class ${cls} (a stub extending PT_RCF:ServiceInterface)`] : []),
    `Define related content service ${serviceId} ("${name}") running ${cls}`
  ];
  if (await vscode.window.showInformationMessage(`Create the Event Mapping service ${serviceId} on ${provider.displayName}?`, { modal: true, detail: steps.join('\n') }, 'Create') !== 'Create') return undefined;
  const r = await provider.createEventMappingService(request);
  if (r.classCreated) {
    void vscode.commands.executeCommand('psft.openDefinition', provider.id,
      makeKey(DefinitionType.ApplicationClassPeopleCode, request.packageRoot, ...(request.path ?? []), request.classId, 'OnExecute'));
  }
  return serviceId;
}

/** A component content reference, searched by name on a connected database (Configuration Tools > Event Mapping). */
async function pickContentReference(workspace: Workspace): Promise<{ connectionId: string; cref: string; portal: string } | undefined> {
  const connected = workspace.activeProviders.filter((p): p is DatabaseProvider => p instanceof DatabaseProvider && p.isConnected);
  if (!connected.length) { void vscode.window.showInformationMessage('Event Mapping is configured on a connected database: connect one first.'); return undefined; }
  let provider = connected[0];
  if (connected.length > 1) {
    const chosen = await vscode.window.showQuickPick(connected.map((p) => ({ label: p.displayName, provider: p })), { title: 'Event Mapping: which database?' });
    if (!chosen) return undefined;
    provider = chosen.provider;
  }
  type Item = vscode.QuickPickItem & { portal: string; cref: string };
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = `Event Mapping on ${provider.displayName}`;
  qp.placeholder = 'Type part of a component content reference (e.g. JOB_DATA)';
  qp.matchOnDescription = true;
  let seq = 0;
  qp.onDidChangeValue(async (text) => {
    const term = text.trim().toUpperCase();
    if (term.length < 2) { qp.items = []; return; }
    const mine = ++seq;
    qp.busy = true;
    try {
      const found = await provider.search({ type: DefinitionType.PortalRegistry, namePattern: `%${term}%`, limit: 200 });
      if (mine !== seq) return;
      qp.items = found.filter((d) => d.key.parts[1] === 'C').slice(0, 100)
        .map((d) => ({ label: d.key.parts[2], description: d.description ?? '', detail: `${d.key.parts[0]} portal`, portal: d.key.parts[0], cref: d.key.parts[2] }));
    } catch (error) {
      if (mine === seq) qp.items = [{ label: 'Search failed', description: error instanceof Error ? error.message : String(error), portal: '', cref: '' }];
    } finally {
      if (mine === seq) qp.busy = false;
    }
  });
  const choice = await new Promise<Item | undefined>((resolve) => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]); qp.hide(); });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  qp.dispose();
  return choice?.cref ? { connectionId: provider.id, cref: choice.cref, portal: choice.portal } : undefined;
}

/** A content reference's Event Mapping configuration in its editor: editable on a Writable connection with an Operator ID. */
export async function showEventMapping(workspace: Workspace, connectionId: string, cref: string, portal = 'EMPLOYEE'): Promise<void> {
  const provider = workspace.activeProviders.find((p) => p.id === connectionId);
  if (!(provider instanceof DatabaseProvider) || !provider.isConnected) throw new Error('Event Mapping is configured on a connected database.');
  const read = await provider.readEventMappingConfiguration(cref, portal);
  if (!read.component) throw new Error(`${cref} is not a component content reference in the ${portal} portal.`);
  const component = read.component;
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const editable = workspace.isWritable(provider.id) && !!operatorId;
  await EventMappingPanel.show({
    connection: { id: provider.id, displayName: provider.displayName }, cref, portal, label: component.label || cref, component,
    reload: () => provider.readEventMappingConfiguration(cref, portal),
    choices: () => provider.eventMappingChoices(component.name),
    fields: (record) => provider.eventMappingFields(record, component.name),
    openClass: async (appClass) => {
      await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.ApplicationClassPeopleCode, ...appClass.split(':'), 'OnExecute'));
    },
    ...(editable ? {
      save: async (rows: EventMappingConfigRow[], token: string, dryRun: boolean) => {
        const result = await provider.saveEventMappingConfiguration({ cref, portal, rows, openedToken: token, operatorId: operatorId!, dryRun });
        if (result.written) void vscode.commands.executeCommand('psft.customization.refresh');
        return result;
      },
      remove: async (token: string) => {
        await provider.removeEventMappingConfiguration(cref, token, operatorId!);
        void vscode.commands.executeCommand('psft.customization.refresh');
      },
      newService: () => newEventMappingService(provider, operatorId!, component.label || cref)
    } : {})
  });
}

/** Registers the view, its commands and the Plan Designer. */
export function registerCustomizationStrategy(context: vscode.ExtensionContext, workspace: Workspace): void {
  setEventMappingExtensionUri(context.extensionUri);
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
    vscode.commands.registerCommand('psft.customization.configureEventMapping', async (connectionId?: string, cref?: string, portal?: string) => {
      if (!connectionId || !cref) {
        // From Configuration Tools (no context): choose the content reference.
        const picked = await pickContentReference(workspace);
        if (!picked) return;
        ({ connectionId, cref, portal } = picked);
      }
      try { await showEventMapping(workspace, connectionId, cref, portal); } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
    vscode.commands.registerCommand('psft.customization.openPlan', () => {
      CustomizationPlanPanel.show(context.extensionUri, view.context, readCustomizationPolicy());
    }),
    vscode.commands.registerCommand('psft.customization.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'peoplesoft.customization'))
  );
  view.follow();
}
