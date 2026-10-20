import { deserializeRecentProjects, RECENT_PROJECTS_KEY } from './model/recentProjects.js';
import { isMissingProjectDefinition, missingProjectDefinitionMessage } from './model/projectOpening.js';
import { PROPERTIES_SPECS } from './model/properties.js';
import { setManualHistoryObserver } from './changeReview/manualHistory.js';
import { databaseReviewAdapters } from './changeReview/adapters.js';
import { ReviewStore } from './changeReview/store.js';
import { BuildRequestStore } from './buildRequest/store.js';
import { registerBuildRequests } from './views/buildRequestsView.js';
import { ReviewService } from './changeReview/service.js';
import { ReviewWorkspace } from './changeReview/workspace.js';
import { ChangeReviewView } from './views/changeReviewView.js';
import { definitionReviewTarget } from './changeReview/navigation.js';
import { canonical } from './changeReview/model.js';
import { openSecurityPanel } from './editors/securityPanel.js';
import { SECURITY_TITLES } from './model/security.js';
import { openPortalStructure } from './editors/portalPanel.js';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Workspace, ConnectionConfig, providerId } from './workspace.js';
import { PeopleSoftFileSystem } from './providers/fileSystem.js';
import { ConnectionsView } from './views/connections.js';
import { BrowserView } from './views/browser.js';
import { ProjectsView } from './views/projects.js';
import { ProcessEditorProvider } from './editors/processEditor.js';
import { RecordEditorProvider } from './editors/recordEditor.js';
import { RecordSaveRefusedError } from './model/recordEdit.js';
import { FieldEditorProvider } from './editors/fieldEditor.js';
import { OpenDefinitionPanel } from './editors/openDefinitionPanel.js';
import { newQueryDocument, copyQueryDocument, type QueryFieldInfo } from './model/queryDocument.js';
import { queryToken } from './model/querySavePlan.js';
import type { QueryEdit } from './providers/queryWriter.js';
import { QueryDesignerPanel } from './editors/queryDesignerPanel.js';
import { DefinitionKey, DefinitionType, displayName, isPeopleCode, makeKey, typeLabel } from './model/definitions.js';
import { setWriteNamePrefix, writeNamePrefix, writeScopeRefusal } from './providers/writeScope.js';
import { RECORD_FIELD_EVENTS } from './model/recordEvents.js';
import { FIELD_TYPE_LABELS, FieldType, RecordType } from './model/record.js';
import { PackageCreateRefusedError } from './providers/packageWriter.js';
import { HtmlSaveRefusedError } from './providers/htmlWriter.js';
import { StyleSheetSaveRefusedError } from './providers/styleSheetWriter.js';
import { CREATABLE_FIELD_TYPES, FIXED_FIELD_LENGTH, FieldCreateRefusedError, fieldCreateRefusal } from './providers/fieldWriter.js';
import { toUri } from './util/uri.js';
import { COMPARE_SCHEME, CompareContent } from './compareContent.js';
import { compareProjectItems, type ProjectItemComparison, type ProjectItemOutcome } from './projectCompare.js';
import { reviewProjectMigration, renderMigrationReview } from './projectMigration.js';
import { exportMigrationPackage, parseMigrationPackage, previewMigrationImport, applyMigrationImport, migrationHash } from './migrationPackage.js';
import { databaseMigrationTarget } from './providers/migrationTarget.js';

/** Compare With Environment's snapshots, shared with Compare Project (set on activation). */
let compareContentForProjects: CompareContent | undefined;
/** Run SQL's results panel, reused for each query. */
let queryResultsPanel: vscode.WebviewPanel | undefined;
import type { McpWriteMode } from './mcp/writeTools.js';
import type { PeopleCodeSaveResult } from './providers/peopleCodeWriter.js';
import { registerPeopleCodeCompletion } from './peoplecode/completion.js';
import { registerPeopleCodeHover } from './peoplecode/hover.js';
import { registerPeopleCodeSymbols } from './peoplecode/symbols.js';
import { registerPeopleCodeDefinition } from './peoplecode/definitionProvider.js';
import { registerPeopleCodeReferences } from './peoplecode/referenceProvider.js';
import { registerPeopleCodeSignatureHelp } from './peoplecode/signatureProvider.js';
import { parseUri, SCHEME } from './util/uri.js';
import { findPeopleCodeReferences } from './peoplecode/findReferences.js';
import { findInProject } from './findInProject.js';
import { showTextSearchResults } from './views/textSearchResults.js';
import { htmlPreviewPage } from './editors/htmlPreview.js';
import { renderQueryResults } from './editors/queryResults.js';
import { prepareReadOnlyQuery } from './sql/readOnlyQuery.js';
import { ddlRecordFromLayout, planProjectCreateTables, unbuildableReason, type BuildPlan, type ProjectBuildRecord, type TableOption } from './model/recordBuild.js';
import { combineBuildPlans, planAlterTable, planCreateIndexes, planCreateViews, type AlterSettings, type IndexOption, type ViewOption } from './model/recordAlter.js';
import { tableName } from './model/recordDdl.js';
import { lineAndColumn, validatePeopleCode, type Validation } from './peoplecode/validate.js';
import { LiveValidator } from './peoplecode/liveValidation.js';
import { WorkerValidationRunner } from './peoplecode/validateWorkerClient.js';
import type { DefinitionProvider } from './providers/provider.js';
import { StatusBar } from './views/statusBar.js';
import { selectConnection } from './views/connectionSelection.js';
import { registerSettings } from './settings/index.js';
import { buildProperties, hasProperties } from './model/properties.js';
import { PropertiesPanel } from './editors/propertiesPanel.js';
import { ImagePanel } from './editors/imagePanel.js';
import { AeDesignerPanel, setAeDesignerExtensionUri } from './editors/aeDesignerPanel.js';
import { MenuDesignerPanel, setMenuDesignerExtensionUri } from './editors/menuDesignerPanel.js';
import { CiDesignerPanel, setCiDesignerExtensionUri } from './editors/ciDesignerPanel.js';
import { registerToolsViews } from './views/toolsViews.js';
import { newDataMoverScript } from './dataMoverCommands.js';
import { registerCustomizationStrategy } from './views/customizationView.js';
import { registerIntelligenceCommands } from './intelligenceCommands.js';
import { installCustomizationGuard } from './customizationGuard.js';
import { ChannelDesignerPanel, setChannelDesignerExtensionUri } from './editors/channelDesignerPanel.js';
import { FileLayoutDesignerPanel, setFileLayoutDesignerExtensionUri } from './editors/fileLayoutDesignerPanel.js';
import { copyLayout, newLayout, type FileLayoutDocument } from './model/fileLayoutDocument.js';
import { CHANNEL_NAME_MAX, copyChannel, type ChannelDocument } from './model/channelDocument.js';
import { copyCi, type CiDocument } from './model/ciDocument.js';
import { copyMenu, MENU_NAME_MAX, newMenu as newMenuDocument, type MenuDocument } from './model/menuDocument.js';
import type { AeDocument } from './model/aeDocument.js';
import { copyProgram as copyAeProgram, newProgram as newAeProgram, PROGRAM_NAME_MAX } from './model/aeDocument.js';
import { PagePanel, type PageLookup } from './editors/pagePanel.js';
import { imageDimensions, imageMimeType, sniffImageMimeType } from './editors/imageHtml.js';
import { ComponentPanel } from './editors/componentPanel.js';
import { ComponentSaveRefusedError, defaultItemLabel, NEW_COMPONENT_ACTIONS } from './providers/componentWriter.js';
import { NEW_PAGE, PageInvalidError, PageSaveRefusedError } from './providers/pageWriter.js';
import { buildPageLayout, type PageLayout } from './model/pageLayout.js';
import type { ComponentDefinition } from './model/componentDefinition.js';
import { componentPeopleCodeKey, eventsFor } from './model/componentPeopleCode.js';
import { canInsertIntoProject, describeItem, ProjectSaveRefusedError } from './model/projectItems.js';
import { DatabaseProvider } from './providers/database.js';
import { openAdministrationPanel, ADMIN_TITLES } from './editors/administrationPanel.js';
import { openIbPanel, hasUnsavedIb, refreshIbPanels } from './editors/ibPanel.js';
import { ibKind, IB_TITLES } from './model/ibDocument.js';
import { validateConnectString } from './settings/settingsModel.js';

import {
  configureAiClient
} from './mcp/configure.js';

import {
  McpServerController
} from './mcp/controller.js';

import {
  McpStatus,
  showMcpMenu,
  showMcpStatus
} from './mcp/status.js';

/** Left side of a compare: which connection + which definition key. */
interface CompareTarget {
  connectionId: string;
  key: DefinitionKey;
}

/**
 * Resolve the definition a command acts on: a tree node, a psft:// URI (the
 * editor tab's context menu passes the tab's), or else the active editor --
 * text or custom (record, field), so the active tab is asked, not only the
 * active text editor.
 *
 * Tree nodes from Projects / Browser look like:
 *   { kind: 'definition' | 'item' | 'packageNode', provider, summary? | node? }
 */
async function resolveDefinitionForCompare(
  workspace: Workspace,
  node: unknown,
  action = 'Compare'
): Promise<CompareTarget | undefined> {
  const fromTree = targetFromTreeNode(node);
  if (fromTree) return fromTree;

  const uri = asPsftUri(node) ?? activeDefinitionUri();
  if (uri) {
    try {
      const parsed = parseUri(uri);
      const provider = workspace.getProviderByHandle(parsed.handle);
      if (!provider) {
        vscode.window.showWarningMessage(
          'This editor belongs to a connection that is not connected.');
        return undefined;
      }
      return { connectionId: provider.id, key: parsed.key };
    } catch {
      // fall through
    }
  }

  vscode.window.showWarningMessage(
    'Select a definition in the Projects or Definition Browser tree, ' +
    `or focus a PeopleSoft editor, then run ${action}.`);
  return undefined;
}

function asPsftUri(value: unknown): vscode.Uri | undefined {
  return value instanceof vscode.Uri && value.scheme === 'psft' ? value : undefined;
}

/** The psft:// document in the active tab, whatever kind of editor shows it. */
function activeDefinitionUri(): vscode.Uri | undefined {
  const text = asPsftUri(vscode.window.activeTextEditor?.document.uri);
  if (text) return text;
  const input = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input as { uri?: unknown } | undefined;
  return asPsftUri(input?.uri);
}

function targetFromTreeNode(node: unknown): CompareTarget | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as {
    kind?: string;
    provider?: { id: string };
    summary?: { key: DefinitionKey };
    node?: { key?: DefinitionKey };
  };

  if (!n.provider?.id) return undefined;

  if ((n.kind === 'definition' || n.kind === 'item') && n.summary?.key) {
    return { connectionId: n.provider.id, key: n.summary.key };
  }

  // Application class leaf in the package tree
  if (n.kind === 'packageNode' && n.node?.key) {
    return { connectionId: n.provider.id, key: n.node.key };
  }

  return undefined;
}

/**
 * App Designer's View PeopleCode on a component: opens the object's first
 * event (the component's, or a record's from the Structure tab) -- the first
 * with a program, else the first in App Designer's order (PreBuild, RowInit
 * ...). A program that does not exist opens empty and is created on save.
 * The editor's title bar then switches object and event (psft.componentPeopleCode.*).
 */
async function viewComponentPeopleCode(provider: DatabaseProvider, def: ComponentDefinition, record?: string): Promise<void> {
  const programs = def.programs.filter((p) => record ? p.record === record && !p.field : !p.record).map((p) => p.event);
  const object = record ? { record } : {};
  const event = eventsFor({ ...object, withCode: programs })[0];
  await vscode.commands.executeCommand('psft.openDefinition', provider.id, componentPeopleCodeKey(def.name, def.market, object, event));
}

/** The component PeopleCode program a key names: its component, market, record, field and event. */
function componentProgramOf(key: DefinitionKey): { component: string; market: string; record?: string; field?: string; event: string } | undefined {
  const p = key.parts;
  if (key.type === DefinitionType.ComponentPeopleCode && p.length === 3) return { component: p[0], market: p[1], event: p[2] };
  if (key.type === DefinitionType.ComponentRecordPeopleCode && p.length === 4) return { component: p[0], market: p[1], record: p[2], event: p[3] };
  if (key.type === DefinitionType.ComponentRecordFieldPeopleCode && p.length === 5) return { component: p[0], market: p[1], record: p[2], field: p[3], event: p[4] };
  return undefined;
}

/**
 * The Page PeopleCode editor's two drop-downs: Object (the page, and each
 * record field on it -- Record Field PeopleCode) and Event (Activate for the
 * page; the record field events, those with a program first).
 */
async function choosePagePeopleCode(workspace: Workspace, which: 'object' | 'event'): Promise<void> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== 'psft') return;
  const { handle, key } = parseUri(uri);
  if (key.type !== DefinitionType.PagePeopleCode) return;
  const pnlName = key.parts[0];
  const provider = await workspace.requireByHandle(handle);
  if (!(provider instanceof DatabaseProvider)) return;
  const objects = await provider.pagePeopleCodeObjects(pnlName);
  const eventsOf = (o: { field?: string; withCode: string[] }) => {
    const all = o.field ? RECORD_FIELD_EVENTS : ['Activate'];
    const code = all.filter((e) => o.withCode.includes(e)).sort();
    return [...code, ...all.filter((e) => !code.includes(e))];
  };
  const open = (o: { record?: string; field?: string }, event: string) => vscode.commands.executeCommand('psft.openDefinition', provider.id,
    o.record && o.field ? makeKey(DefinitionType.RecordPeopleCode, o.record, o.field, event) : makeKey(DefinitionType.PagePeopleCode, pnlName, event));
  if (which === 'object') {
    const picked = await vscode.window.showQuickPick(objects.map((o) => ({
      label: `${o.field ? '  ' : ''}${o.withCode.length ? '$(zap) ' : ''}${o.label}`, description: o.withCode.join(', '), object: o
    })), { title: `${pnlName} (Page PeopleCode): object`, placeHolder: 'The page, or a record field on it (its Record Field PeopleCode)', matchOnDescription: true });
    if (picked) await open(picked.object, eventsOf(picked.object)[0]);
    return;
  }
  const page = objects[0];
  const pick = await vscode.window.showQuickPick(eventsOf(page).map((e) => ({ label: `${page.withCode.includes(e) ? '$(zap) ' : ''}${e}`, event: e })),
    { title: `${pnlName} (Page PeopleCode): event`, placeHolder: 'Event' });
  if (pick && pick.event !== key.parts[1]) await open(page, pick.event);
}

/**
 * The Component PeopleCode editor's two drop-downs, as title-bar pickers on a
 * component program's editor: Object (the component, its buffer's records and
 * their fields) opens that object's first event; Event switches event. Those
 * with a program are marked, as App Designer marks them bold.
 */
async function chooseComponentPeopleCode(workspace: Workspace, which: 'object' | 'event'): Promise<void> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== 'psft') return;
  const { handle, key } = parseUri(uri);
  const at = componentProgramOf(key);
  if (!at) return;
  const provider = await workspace.requireByHandle(handle);
  if (!(provider instanceof DatabaseProvider)) return;
  const def = await provider.readComponentDefinition(makeKey(DefinitionType.Component, at.component, at.market));
  const objects = await provider.componentPeopleCodeObjects(def);
  const current = objects.find((o) => o.record === at.record && o.field === at.field) ?? objects[0];
  let object = current;
  if (which === 'object') {
    const picked = await vscode.window.showQuickPick(objects.map((o) => ({
      label: `${o.field ? '    ' : o.record ? '  ' : ''}${o.withCode.length ? '$(zap) ' : ''}${o.label}`,
      description: o.withCode.join(', '), picked: o === current, object: o
    })), { title: `${def.name}.${def.market} (Component PeopleCode): object`, placeHolder: `${current.label} -- the component, a record or a field`, matchOnDescription: true });
    if (!picked) return;
    object = picked.object;
    const event = eventsFor(object)[0];
    await vscode.commands.executeCommand('psft.openDefinition', provider.id, componentPeopleCodeKey(def.name, def.market, object, event));
    return;
  }
  const pick = await vscode.window.showQuickPick(eventsFor(object).map((e) => ({
    label: `${object.withCode.includes(e) ? '$(zap) ' : ''}${e}`, description: e === at.event ? 'open' : object.withCode.includes(e) ? '' : 'no PeopleCode yet', event: e
  })), { title: `${def.name}.${def.market} (Component PeopleCode): ${object.label}`, placeHolder: 'Event' });
  if (!pick || pick.event === at.event) return;
  await vscode.commands.executeCommand('psft.openDefinition', provider.id, componentPeopleCodeKey(def.name, def.market, object, pick.event));
}

/** Validate PeopleCode's problems as diagnostics on the text they were found in (any line endings). */
function peopleCodeDiagnostics(text: string, v: Validation): vscode.Diagnostic[] {
  const normalized = text.replace(/\r\n/g, '\n');
  return v.problems.map((p) => {
    const at = lineAndColumn(normalized, p.offset);
    const start = new vscode.Position(at.line, at.column);
    const d = new vscode.Diagnostic(new vscode.Range(start, start.translate(0, 1)),
      `${p.message} (PeopleSoft Studio's compiler, ${v.profile}; Application Designer has the last word)`, vscode.DiagnosticSeverity.Warning);
    d.source = 'PeopleCode';
    return d;
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Writes go to every definition unless a name prefix limits them (writeScope.ts).
  setWriteNamePrefix(vscode.workspace.getConfiguration('peoplesoft').get<string>('writeNamePrefix'));
  const workspace = new Workspace(context.secrets);
  workspace.db2DriverDir = path.join(context.globalStorageUri.fsPath, 'db2-driver');
  context.subscriptions.push(workspace);
  // Validate PeopleCode's results: as you type (liveValidation.ts) unless that is off, when they are cleared as soon as the text changes.
  const validationDiagnostics = vscode.languages.createDiagnosticCollection('psft-peoplecode-validate');
  const releaseByHandle = new Map<string, Promise<string | undefined>>();
  const releaseFor = (handle: string) => {
    let release = releaseByHandle.get(handle);
    if (!release) {
      release = workspace.requireByHandle(handle).then((p) => p.readEnvironment?.()).then((e) => e?.toolsRelease, () => undefined);
      releaseByHandle.set(handle, release);
    }
    return release;
  };
  const liveOn = () => vscode.workspace.getConfiguration('peoplesoft').get<boolean>('peoplecode.validateAsYouType') ?? true;
  const live = new LiveValidator(
    new WorkerValidationRunner(path.join(context.extensionPath, 'dist', 'validateWorker.js')),
    (request, result) => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === request.uri);
      if (doc && liveOn()) validationDiagnostics.set(doc.uri, peopleCodeDiagnostics(request.text, result));
    },
    (uri, version) => vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri && d.version === version));
  const validateLive = async (doc: vscode.TextDocument) => {
    if (!liveOn() || doc.uri.scheme !== SCHEME || doc.languageId !== 'psft-peoplecode') return;
    let parsed: ReturnType<typeof parseUri>;
    try { parsed = parseUri(doc.uri); } catch { return; }
    const release = (await releaseFor(parsed.handle)) ?? '8.62';
    live.schedule({ uri: doc.uri.toString(), version: doc.version, text: doc.getText(), key: parsed.key, release });
  };
  context.subscriptions.push(
    validationDiagnostics,
    { dispose: () => live.dispose() },
    vscode.workspace.onDidOpenTextDocument((d) => void validateLive(d)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.contentChanges.length) return;
      if (liveOn()) void validateLive(e.document);
      else validationDiagnostics.delete(e.document.uri);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => { live.cancel(d.uri.toString()); validationDiagnostics.delete(d.uri); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('peoplesoft.peoplecode.validateAsYouType')) return;
      if (liveOn()) for (const d of vscode.workspace.textDocuments) void validateLive(d);
      else validationDiagnostics.clear();
    })
  );
  for (const d of vscode.workspace.textDocuments) void validateLive(d);
  // Compare With Environment's other side: read-only snapshots, forgotten when their tab closes.
  const compareContent = new CompareContent();
  compareContentForProjects = compareContent;
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(COMPARE_SCHEME, compareContent),
    vscode.workspace.onDidCloseTextDocument((d) => { if (d.uri.scheme === COMPARE_SCHEME) compareContent.forget(d.uri); })
  );
  setAeDesignerExtensionUri(context.extensionUri);
  AeDesignerPanel.register(context);
  setMenuDesignerExtensionUri(context.extensionUri);
  setCiDesignerExtensionUri(context.extensionUri);
  setChannelDesignerExtensionUri(context.extensionUri);
  setFileLayoutDesignerExtensionUri(context.extensionUri);
  MenuDesignerPanel.register(context);

  const statusBar = new StatusBar(workspace);
  context.subscriptions.push(statusBar);

  const mcpController =
    new McpServerController(
      workspace
    );

  const reviewAdapters = databaseReviewAdapters(workspace, () => mcpController.writeHost);
  let reviewWorkspace: ReviewWorkspace | undefined;
  let reviewTree: ChangeReviewView | undefined;
  const reviewService = new ReviewService(new ReviewStore(path.join(context.globalStorageUri.fsPath, 'change-review')), {
    environment: reviewAdapters.environment, changed: () => { reviewWorkspace?.changed(); reviewTree?.refresh(); }
  }, reviewAdapters.adapters);
  reviewWorkspace = new ReviewWorkspace(reviewService);
  reviewTree = new ChangeReviewView(reviewService);
  context.subscriptions.push(reviewTree, vscode.window.registerTreeDataProvider('psft.changeReview', reviewTree));
  mcpController.reviewService = reviewService;
  const buildRequests = new BuildRequestStore(path.join(context.globalStorageUri.fsPath, 'build-requests'));
  mcpController.buildRequests = buildRequests;
  registerBuildRequests(context, {
    store: buildRequests, extensionUri: context.extensionUri,
    connections: () => workspace.connections.filter((c) => c.kind !== 'projectFile').map((c) => c.name),
    mcp: () => ({ running: mcpController.state.status === 'running', writes: !!mcpController.writeHost && mcpController.writeHost.mode() !== 'off' })
  });
  setManualHistoryObserver((connection, key, write) => {
    if ([8,9,42,43,44,46,47,48,58].includes(key.type)) return reviewService.captureManual(connection, 'peoplecode', { type: key.type, parts: [...key.parts] }, write);
    if (key.type === DefinitionType.HtmlDefinition) return reviewService.captureManual(connection, 'html', key.parts[0], write);
    if (key.type === DefinitionType.StyleSheet) return reviewService.captureManual(connection, 'stylesheet', key.parts[0], write);
    if (key.type === DefinitionType.SqlDefinition) return reviewService.captureManual(connection, 'sql', key.parts[0], write);
    if (key.type === DefinitionType.Query) return reviewService.captureManual(connection, 'query', [key.parts[0], key.parts[1] ?? ''], write);
    if (key.type === DefinitionType.ProcessDefinition) return reviewService.captureManual(connection, 'process', [...key.parts], write);
    if (key.type === DefinitionType.Page) return reviewService.captureManual(connection, 'page', key.parts[0], write);
    if (key.type === DefinitionType.Record) return reviewService.captureManual(connection, 'record', key.parts[0], write);
    if (key.type === DefinitionType.AppEngineProgram) return reviewService.captureManual(connection, 'ae', key.parts[0], write);
    return write();
  });
  context.subscriptions.push({ dispose: () => setManualHistoryObserver(undefined) });
  context.subscriptions.push(reviewWorkspace);
  for (const command of ['open', 'pending', 'history', 'compare', 'apply', 'revert', 'redo']) {
    context.subscriptions.push(vscode.commands.registerCommand('psft.changeReview.' + command,
      (id?: string) => command === 'compare' ? reviewWorkspace!.compareRevisions() : reviewWorkspace!.show(typeof id === 'string' ? id : undefined,
        command === 'pending' ? 'pending' : command === 'history' ? 'history' : 'all')));
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('psft.definition.open', (node?: unknown) => withError('Open definition', async () => {
      const target = await resolveDefinitionForCompare(workspace, node, 'Open');
      const project = node && typeof node === 'object' && 'project' in node && typeof node.project === 'string' ? node.project : undefined;
      if (target) await vscode.commands.executeCommand(project ? 'psft.openProjectDefinition' : 'psft.openDefinition', target.connectionId, target.key, project);
    })),
    vscode.commands.registerCommand('psft.changeReview.objectHistory', (node?: unknown) => withError('Object history', async () => {
      const target = await resolveDefinitionForCompare(workspace, node, 'Object History');
      const scope = target && definitionReviewTarget(target.key);
      if (!target || !scope) return;
      const sets = await reviewService.store.list();
      for (const set of sets) {
        if (set.environment.connection !== target.connectionId) continue;
        const object = set.objects.find(c => c.adapter === scope.adapter && canonical(c.key) === canonical(scope.key));
        if (object) { await reviewWorkspace!.show(set.id, 'all', object.id); return; }
      }
      void vscode.window.showInformationMessage(`No retained Change Review history for ${displayName(target.key)} on this connection.`);
    }))
  );

  const mcpStatus =
    new McpStatus(
      mcpController
    );

  context.subscriptions.push(
    mcpController,
    mcpStatus
  );

  // Menu state is presentation only; command handlers retain their existing write/approval gates.
  const menuMcpState = () => { void vscode.commands.executeCommand('setContext', 'psft.mcp.state', mcpController.state.status); };
  context.subscriptions.push(mcpController.onDidChangeState(menuMcpState));
  menuMcpState();

  registerSettings(context, workspace, mcpController);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'psft.status.selectConnection',
      async () => {
        await selectStatusConnection(workspace);
      }
    )
  );

  // Every PeopleCode save keeps a report of the rows it replaced, so a save
  // can be undone by hand: <global storage>/peoplecode-saves/*.json.
  const writeSaveReport = async (key: DefinitionKey, connection: string, result: PeopleCodeSaveResult) => {
    const dir = context.globalStorageUri ? vscode.Uri.joinPath(context.globalStorageUri, 'peoplecode-saves') : undefined;
    if (!dir) return;
    await vscode.workspace.fs.createDirectory(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${stamp}-${key.parts.join('.').replace(/[^A-Za-z0-9_.-]/g, '_')}.json`;
    const report = {
      connection, definition: key, kind: result.kind, version: result.version, lastupddttm: result.lastupddttm,
      storedSource: result.storedSource,
      replaced: {
        ...result.before,
        program: result.before.program.map((r) => ({ ...r, bytes: r.bytes.toString('hex') }))
      }
    };
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), Buffer.from(JSON.stringify(report, null, 1), 'utf8'));
  };
  const fileSystem = PeopleSoftFileSystem.register(workspace, writeSaveReport, () => void vscode.commands.executeCommand('psft.refresh'));
  context.subscriptions.push(fileSystem);
  context.subscriptions.push(FieldEditorProvider.register(workspace, () => void vscode.commands.executeCommand('psft.refresh')));

  registerPeopleCodeCompletion(context, workspace);
  registerPeopleCodeHover(context, workspace);
  registerPeopleCodeSymbols(context);
  registerPeopleCodeDefinition(context, workspace);
  registerPeopleCodeReferences(context, workspace);
  registerPeopleCodeSignatureHelp(context);

  const connections = new ConnectionsView(workspace);
  const browser = new BrowserView(workspace);
  const projects = new ProjectsView(workspace, context.globalState);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('psft.connections', connections),
    vscode.window.registerTreeDataProvider('psft.browser', browser),
    vscode.window.registerTreeDataProvider('psft.projects', projects)
  );
  registerToolsViews(context);
  registerCustomizationStrategy(context, workspace);
  registerIntelligenceCommands(context);
  installCustomizationGuard(context, workspace);

  const refreshAll = () => { connections.refresh(); browser.refresh(); projects.refresh(); };

  // MCP writes (mcp/writeTools.ts): the setting, the user's approval, and the editors' state.
  mcpController.writeHost = {
    mode: () => vscode.workspace.getConfiguration('peoplesoft.mcp').get<McpWriteMode>('writes', 'confirm'),
    projectInclusion: () => {
      const c = vscode.workspace.getConfiguration('peoplesoft.projects');
      return { menus: c.get('includeMenus', true), portalRegistry: c.get('includePortalRegistry', true), security: c.get('includeSecurity', true) };
    },
    confirm: async ({ title, detail }) => (await vscode.window.showWarningMessage(title, { modal: true, detail }, 'Allow')) === 'Allow',
    hasUnsavedEditor: (connectionId, key) => {
      if (key.type === DefinitionType.Query) return QueryDesignerPanel.hasUnsaved(connectionId, key.parts[0], key.parts[1]);
      if (key.type === DefinitionType.ProcessDefinition && ProcessEditorProvider.hasUnsaved(connectionId, key)) return true;
      if (key.type === DefinitionType.AppEngineProgram) return AeDesignerPanel.sessionOf(connectionId, key.parts[0])?.dirty ?? false;
      if (key.type === DefinitionType.Menu) return MenuDesignerPanel.sessionOf(connectionId, key.parts[0])?.dirty ?? false;
      if (key.type === DefinitionType.ComponentInterface) return CiDesignerPanel.sessionOf(connectionId, key.parts[0])?.dirty ?? false;
      if (key.type === DefinitionType.MessageChannel) return ChannelDesignerPanel.sessionOf(connectionId, key.parts[0])?.dirty ?? false;
      if (key.type === DefinitionType.FileLayout) return FileLayoutDesignerPanel.sessionOf(connectionId, key.parts[0])?.dirty ?? false;
      const ibTypes:Partial<Record<DefinitionType, import('./model/ibDocument.js').IbKind>> = {[DefinitionType.IbMessage]:'message',[DefinitionType.IbDocument]:'document',[DefinitionType.IbService]:'service',[DefinitionType.IbServiceOperation]:'operation',[DefinitionType.MessageNode]:'node',[DefinitionType.IbRouting]:'routing'};
      if(ibTypes[key.type] && hasUnsavedIb(connectionId,ibTypes[key.type]!))return true;
      const uri = toUri(connectionId, key).toString();
      return vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.isDirty &&
        (t.input instanceof vscode.TabInputText || t.input instanceof vscode.TabInputCustom) && t.input.uri.toString() === uri));
    },
    saved: (connectionId, key, peopleCode) => {
      refreshIbPanels(connectionId);
      if (peopleCode) {
        void writeSaveReport(key, connectionId, peopleCode).catch((error) => console.error('PeopleSoft Studio: could not write the save report:', error));
      }
      if (key.type === DefinitionType.AppEngineProgram) void AeDesignerPanel.reloadIfOpen(connectionId, key.parts[0]);
      else if (key.type === DefinitionType.Menu) void MenuDesignerPanel.reloadIfOpen(connectionId, key.parts[0]);
      else if (key.type === DefinitionType.ComponentInterface) void CiDesignerPanel.reloadIfOpen(connectionId, key.parts[0]);
      else if (key.type === DefinitionType.MessageChannel) void ChannelDesignerPanel.reloadIfOpen(connectionId, key.parts[0]);
      else if (key.type === DefinitionType.FileLayout) void FileLayoutDesignerPanel.reloadIfOpen(connectionId, key.parts[0]);
      else if (key.type === DefinitionType.Query) void QueryDesignerPanel.reloadIfOpen(connectionId, key.parts[0], key.parts[1]).catch(error => console.error('PeopleSoft Studio: could not reload Query:', error));
      else if (key.type === DefinitionType.ProcessDefinition) void ProcessEditorProvider.reloadIfOpen(connectionId, key).catch(error => console.error('PeopleSoft Studio: could not reload Process Definition:', error));
      else if (key.type === DefinitionType.ComponentInterfacePeopleCode) { PeopleSoftFileSystem.instance?.invalidate(toUri(connectionId, key)); void CiDesignerPanel.reloadIfOpen(connectionId, key.parts[0]); }
      else PeopleSoftFileSystem.instance?.invalidate(toUri(connectionId, key));
      refreshAll();
    }
  };
  // A saved record's fields change in the trees too.
  context.subscriptions.push(ProcessEditorProvider.register(workspace));
  context.subscriptions.push(RecordEditorProvider.register(workspace, () => { browser.refresh(); projects.refresh(); }));

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'psft.mcp.menu',
      async () => {
        await showMcpMenu(
          mcpController
        );
      }
    ),

    vscode.commands.registerCommand(
      'psft.mcp.status',
      async () => {
        await showMcpStatus(
          mcpController
        );
      }
    ),

    vscode.commands.registerCommand(
      'psft.mcp.configureClient',
      async () => {
        await configureAiClient(
          mcpController
        );
      }
    ),

    vscode.commands.registerCommand(
      'psft.mcp.copyUrl',
      async () => {
        await vscode.env.clipboard.writeText(
          mcpController.state.url
        );

        void vscode.window.showInformationMessage(
          'PeopleSoft Studio MCP URL copied.'
        );
      }
    ),

    vscode.commands.registerCommand(
      'psft.mcp.start',
      async () => {
        await mcpController.start();
      }
    ),

    vscode.commands.registerCommand(
      'psft.mcp.stop',
      async () => {
        await mcpController.stop();
      }
    ),

    vscode.commands.registerCommand(
      'psft.mcp.restart',
      async () => {
        await mcpController.restart();
      }
    ),

    vscode.commands.registerCommand('psft.refresh', refreshAll),

    vscode.commands.registerCommand('psft.peoplecode.validate', async () => {
      await withError('Validate PeopleCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.uri.scheme !== SCHEME || editor.document.languageId !== 'psft-peoplecode') {
          vscode.window.showInformationMessage('Validate PeopleCode checks the PeopleCode program in the active editor: open one first.');
          return;
        }
        const doc = editor.document;
        const { handle, key } = parseUri(doc.uri);
        const provider = await workspace.requireByHandle(handle);
        // The connection's PeopleTools release picks the compiler profile; a project export has none, so the newest is used.
        const release = (await provider.readEnvironment?.())?.toolsRelease;
        const text = doc.getText();
        const v = validatePeopleCode(text, key, release ?? '8.62');
        validationDiagnostics.set(doc.uri, peopleCodeDiagnostics(text, v));
        const where = `${v.profile}${release ? '' : ', no PeopleTools release known for this source'}`;
        if (v.problems.length) vscode.window.showWarningMessage(`${displayName(key)} does not compile with PeopleSoft Studio's compiler (${where}): see Problems.`);
        else vscode.window.showInformationMessage(`${displayName(key)} compiles with PeopleSoft Studio's compiler (${where}).`);
      });
    }),

    vscode.commands.registerCommand('psft.findInProject', async (node?: unknown) => {
      await withError('Find in Project', () => findInProject(workspace, node));
    }),

    vscode.commands.registerCommand('psft.peoplecode.findReferences', async () => {
      await withError('Find References', async () => {
        // The PeopleCode editor's own connection and the word at the cursor; else the active connection.
        const editor = vscode.window.activeTextEditor;
        let provider: DefinitionProvider | undefined;
        let initial = '';
        if (editor?.document.uri.scheme === SCHEME) {
          provider = await workspace.requireByHandle(parseUri(editor.document.uri).handle);
          const doc = editor.document;
          const sel = editor.selection;
          const word = sel ? doc.getWordRangeAtPosition(sel.active, /[A-Za-z0-9_&%#$@]+(?:[.:][A-Za-z0-9_&%#$@]+)*/) : undefined;
          initial = !sel || sel.isEmpty ? (word ? doc.getText(word) : '') : doc.getText(sel).split(/\r?\n/)[0];
        } else {
          provider = workspace.activeProviders.find((p) => p.isConnected);
        }
        if (!provider) {
          vscode.window.showInformationMessage('Find References searches PeopleCode in a connected database or an open project export: connect one first.');
          return;
        }
        const searchIn = provider;
        const needle = (await vscode.window.showInputBox({
          title: `Find References in ${searchIn.displayName}`, value: initial,
          prompt: 'An identifier (matched as a whole word) or any text, in every PeopleCode program; case is ignored'
        }))?.trim();
        if (!needle) return;
        const r = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Finding "${needle}" in ${searchIn.displayName}'s PeopleCode…` },
          () => findPeopleCodeReferences(searchIn, needle));
        if (!r.hits.length) {
          vscode.window.showInformationMessage(`"${needle}" was not found in ${searchIn.displayName}'s PeopleCode${r.truncated ? ' (the search stopped early)' : ''}.`);
          return;
        }
        await showTextSearchResults(searchIn.id, r.hits, needle,
          `"${needle}": ${r.hits.length} in ${r.programs} program${r.programs === 1 ? '' : 's'}${r.truncated ? ' (more programs contain it; narrow the search)' : ''}`);
      });
    }),

    vscode.commands.registerCommand('psft.sql.run', async () => {
      await withError('Run SQL', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'psft-sql') {
          vscode.window.showInformationMessage('Run SQL runs the query in the active SQL editor: open a SQL definition or SQL document first.');
          return;
        }
        const doc = editor.document;
        const sel = editor.selection;
        const text = sel && !sel.isEmpty ? doc.getText(sel) : doc.getText();
        // Checked before anything touches the database (%Table is named there); a refusal says why.
        const checked = prepareReadOnlyQuery(text, (rec) => rec);
        if (!checked.ok) { vscode.window.showWarningMessage(`Not run: ${checked.reason}`); return; }
        const provider = doc.uri.scheme === SCHEME ? await workspace.requireByHandle(parseUri(doc.uri).handle) : workspace.activeProviders.find((p) => p.isConnected);
        if (!(provider instanceof DatabaseProvider)) {
          vscode.window.showInformationMessage('Run SQL runs against a connected database: connect one first (a project export has no tables).');
          return;
        }
        const maxRows = vscode.workspace.getConfiguration('peoplesoft').get<number>('sql.maxRows', 500);
        let r: Awaited<ReturnType<DatabaseProvider['runReadOnlyQuery']>>;
        try {
          r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Running the query on ${provider.displayName} (read only)…` },
            () => provider.runReadOnlyQuery(text, maxRows));
        } catch (err) {
          vscode.window.showWarningMessage(`Not run: ${(err as Error).message}`);
          return;
        }
        if (!queryResultsPanel) {
          queryResultsPanel = vscode.window.createWebviewPanel('psft.queryResults', 'Query Results', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: false, localResourceRoots: [] });
          queryResultsPanel.onDidDispose(() => { queryResultsPanel = undefined; });
        }
        queryResultsPanel.title = `Results: ${provider.displayName}`;
        queryResultsPanel.webview.html = renderQueryResults({ connection: provider.displayName, sql: r.sql, rows: r.rows, truncated: r.truncated, maxRows, ms: r.ms });
        queryResultsPanel.reveal(vscode.ViewColumn.Beside, true);
      });
    }),

    vscode.commands.registerCommand('psft.html.preview', async () => {
      await withError('Preview HTML', async () => {
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc || doc.uri.scheme !== SCHEME || !doc.uri.path.toLowerCase().endsWith('.html')) {
          vscode.window.showInformationMessage('Preview HTML shows the HTML definition in the active editor: open one first.');
          return;
        }
        const { key } = parseUri(doc.uri);
        const panel = vscode.window.createWebviewPanel('psft.htmlPreview', `Preview: ${displayName(key)}`, vscode.ViewColumn.Beside,
          { enableScripts: false, localResourceRoots: [] });
        panel.webview.html = htmlPreviewPage(doc.getText());
      });
    }),

    vscode.commands.registerCommand('psft.record.refresh', async () => {
      await withError('Refreshing record', () =>
        RecordEditorProvider.refreshActive(workspace));
    }),

    vscode.commands.registerCommand('psft.project.build', (node?: unknown) => vscode.commands.executeCommand('psft.buildProject', node)),

    vscode.commands.registerCommand('psft.dataMover.newScript', () => withError('New Data Mover Script', newDataMoverScript)),

    vscode.commands.registerCommand('psft.portal.structure', () => withError('Structure & Content', async () => {
      const connected = workspace.activeProviders.filter((p): p is DatabaseProvider => p.isConnected && p instanceof DatabaseProvider);
      let provider = connected.find(p => p.id === workspace.selectedConnectionId);
      if (!provider && connected.length === 1) provider = connected[0];
      if (!provider && connected.length) provider = (await vscode.window.showQuickPick(connected.map(p => ({ label: p.displayName, provider: p })), { title: 'Structure & Content — connection' }))?.provider;
      if (!provider) { if (!connected.length) vscode.window.showInformationMessage('Connect a PeopleSoft database to open Structure & Content.'); return; }
      await openPortalStructure(workspace, provider);
    })),

    ...(['oauth', 'saml'] as const).map(kind => vscode.commands.registerCommand('psft.security.' + kind, () => withError(SECURITY_TITLES[kind], async () => {
      const connected = workspace.activeProviders.filter((p): p is DatabaseProvider => p instanceof DatabaseProvider && p.isConnected);
      let provider = connected.find(p => p.id === workspace.selectedConnectionId);
      if (!provider && connected.length === 1) provider = connected[0];
      if (!provider && connected.length) provider = (await vscode.window.showQuickPick(connected.map(p => ({ label: p.displayName, provider: p })), { title: 'Security — connection' }))?.provider;
      if (!provider) { if (!connected.length) vscode.window.showInformationMessage('Connect a PeopleSoft database to open Security tools.'); return; }
      openSecurityPanel(workspace, provider, kind);
    }))),

    ...ibKind.options.map(kind => vscode.commands.registerCommand('psft.ib.' + kind, () => withError(IB_TITLES[kind], async () => {
      const connected = workspace.activeProviders.filter((p): p is DatabaseProvider => p instanceof DatabaseProvider && p.isConnected);
      let provider = connected.find(p => p.id === workspace.selectedConnectionId);
      if (!provider && connected.length === 1) provider = connected[0];
      if (!provider && connected.length) provider = (await vscode.window.showQuickPick(connected.map(p => ({ label: p.displayName, provider: p })), { title: 'Integration Broker — connection' }))?.provider;
      if (!provider) { if (!connected.length) vscode.window.showInformationMessage('Connect a PeopleSoft database to open Integration Broker.'); return; }
      openIbPanel(workspace, provider, kind);
    }))),

    ...([['messages', 'message'], ['text', 'text'], ['urls', 'url']] as const).map(([command, kind]) =>
      vscode.commands.registerCommand('psft.administration.' + command, async () => {
        await withError(ADMIN_TITLES[kind], async () => {
          const provider = workspace.activeProviders.find(p => p.isConnected);
          if (!(provider instanceof DatabaseProvider)) {
            vscode.window.showInformationMessage('Connect a PeopleSoft database to open ' + ADMIN_TITLES[kind] + '.');
            return;
          }
          openAdministrationPanel(workspace, provider, kind);
        });
      })),

    vscode.commands.registerCommand('psft.project.migrationReview', async (node?: unknown) => {
      await withError('Review Project Migration', async () => {
        const n = node as { kind?: string; provider?: DefinitionProvider; project?: { name: string } } | undefined;
        const source = n?.kind === 'project' && n.provider ? n.provider : workspace.activeProviders.find(p => p.isConnected);
        if (!source) {
          vscode.window.showInformationMessage('Connect an environment or open a project export to review a migration.');
          return;
        }
        let project = n?.kind === 'project' ? n.project?.name : undefined;
        if (!project) {
          const projects = await source.listProjects();
          project = (await vscode.window.showQuickPick(projects.map(p => ({ label: p.name, description: p.description })),
            { title: 'Review migration for which project?' }))?.label;
        }
        if (!project) return;
        const others = workspace.connections.filter(c => providerId(c) !== source.id);
        const selected = await vscode.window.showQuickPick([
          { label: 'Review without a target', config: undefined as ConnectionConfig | undefined },
          ...others.map(config => ({ label: config.name, config }))
        ], { title: 'Migration target', placeHolder: 'Target is read only during review' });
        if (!selected) return;
        const projectName = project;
        const review = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Reviewing migration: ${projectName}` },
          () => selected.config
            ? workspace.readFromConnection(selected.config, target => reviewProjectMigration(source, projectName, target))
            : reviewProjectMigration(source, projectName));
        const document = await vscode.workspace.openTextDocument({ content: renderMigrationReview(review), language: 'markdown' });
        await vscode.window.showTextDocument(document, { preview: false });
        const candidates = review.dependencies.filter(d => !d.inProject && canInsertIntoProject(d.key.type));
        if (!(source instanceof DatabaseProvider) || !workspace.isWritable(source.id) || !candidates.length) return;
        const operatorId = workspace.configFor(source.id)?.peoplesoftOperatorId?.trim();
        if (!operatorId) return;
        const action = await vscode.window.showInformationMessage(
          `${candidates.length} explicit dependencies are outside ${projectName}. Review which belong in this migration.`,
          'Include Dependencies...');
        if (action !== 'Include Dependencies...') return;
        const selectedDependencies = await vscode.window.showQuickPick(candidates.map(dependency => ({
          label: dependency.label, description: typeLabel(dependency.key.type),
          detail: 'Required by ' + dependency.requiredBy.join(', '), dependency
        })), { title: `Include dependencies in ${projectName}`, canPickMany: true,
          placeHolder: 'Select only definitions you intend to migrate; delivered dependencies may already exist in the target.' });
        if (!selectedDependencies?.length) return;
        await source.saveProject({ project: projectName, operatorId, add: selectedDependencies.map(item => item.dependency.key) });
        projects.refresh();
        const updated = selected.config
          ? await workspace.readFromConnection(selected.config, target => reviewProjectMigration(source, projectName, target))
          : await reviewProjectMigration(source, projectName);
        const updatedDocument = await vscode.workspace.openTextDocument({ content: renderMigrationReview(updated), language: 'markdown' });
        await vscode.window.showTextDocument(updatedDocument, { preview: false });
      });
    }),

    vscode.commands.registerCommand('psft.project.exportMigration', async (node?: unknown) => {
      await withError('Export Migration Package', async () => {
        const n = node as { kind?: string; provider?: DefinitionProvider; project?: { name: string } } | undefined;
        const source = n?.kind === 'project' && n.provider ? n.provider : workspace.activeProviders.find(p => p.isConnected);
        if (!(source instanceof DatabaseProvider)) {
          vscode.window.showInformationMessage('Connect a database to export a Studio migration package.');
          return;
        }
        const project = n?.project?.name ?? (await vscode.window.showQuickPick(
          (await source.listProjects()).map(p => ({ label: p.name, description: p.description })),
          { title: 'Export which project?' }))?.label;
        if (!project) return;
        const file = await vscode.window.showSaveDialog({ title: 'Export Studio Migration Package',
          defaultUri: vscode.Uri.file(project + '.psft-migration.json'), filters: { 'Studio migration package': ['json'] } });
        if (!file) return;
        const pkg = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Exporting ${project}` },
          () => exportMigrationPackage(source, project));
        await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(pkg, null, 2) + '\n'));
        vscode.window.showInformationMessage(`Exported ${project}: ${pkg.assets.length} definitions, ${pkg.members.length} project members.`);
      });
    }),

    vscode.commands.registerCommand('psft.project.importMigration', async () => {
      await withError('Import Migration Package', async () => {
        const files = await vscode.window.showOpenDialog({ title: 'Import Studio Migration Package',
          canSelectMany: false, filters: { 'Studio migration package': ['json'] } });
        if (!files?.[0]) return;
        const pkg = parseMigrationPackage(Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString('utf8'));
        const targetConfig = (await vscode.window.showQuickPick(workspace.connections.filter(c => c.kind !== 'projectFile')
          .map(config => ({ label: config.name, config })), { title: 'Import into which environment?' }))?.config;
        if (!targetConfig) return;
        const target = await workspace.require(providerId(targetConfig));
        const operatorId = targetConfig.peoplesoftOperatorId?.trim();
        if (!(target instanceof DatabaseProvider) || !workspace.isWritable(target.id) || !operatorId) {
          vscode.window.showInformationMessage('Migration import requires a Writable database connection with a PeopleSoft Operator ID.');
          return;
        }
        const backend = await databaseMigrationTarget(target, operatorId);
        const plan = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Previewing import into ${target.displayName}` },
          () => previewMigrationImport(pkg, backend));
        const content = JSON.stringify({
          project: pkg.project, target: target.displayName, ...plan,
          notes: [
            'Each definition is saved and verified independently. If a later save fails, completed saves remain; rerun the preview to resume.',
            'SQL record metadata does not build physical tables or move application data.',
            'Dependency checks cover explicit metadata references; dynamic and SQL/PeopleCode references require runtime validation.'
          ]
        }, null, 2);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: 'json' }), { preview: false });
        if (plan.blockers.length) return;
        if (await vscode.window.showInformationMessage(`Apply migration ${pkg.project} to ${target.displayName}?`, { modal: true }, 'Apply Migration') !== 'Apply Migration') return;
        const receipt = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Importing ${pkg.project}` },
          () => applyMigrationImport(pkg, plan, backend));
        const receiptFile = await vscode.workspace.openTextDocument({ language: 'json',
          content: JSON.stringify({ project: pkg.project, target: target.displayName, packageChecksum: pkg.checksum, previewHash: migrationHash(plan), ...receipt }, null, 2) });
        await vscode.window.showTextDocument(receiptFile, { preview: false });
        projects.refresh();
        if (receipt.error) vscode.window.showErrorMessage(`Migration stopped after ${receipt.completed.length} verified definitions: ${receipt.error}`);
        else { await projects.openProject(target.id, pkg.project); vscode.window.showInformationMessage(`Imported ${pkg.project}: ${receipt.completed.length} definitions saved and verified.`); }
      });
    }),

    vscode.commands.registerCommand('psft.project.compare', async (node?: unknown) => {
      await withError('Compare Project', async () => {
        const n = node as { kind?: string; provider?: DefinitionProvider; project?: { name: string } } | undefined;
        const here = n?.kind === 'project' && n.provider ? n.provider : workspace.activeProviders.find((p) => p.isConnected);
        if (!here) {
          vscode.window.showInformationMessage('Compare Project compares a project of the active connection with another environment: connect one first.');
          return;
        }
        let project = n?.kind === 'project' ? n.project?.name : undefined;
        if (!project) {
          const projects = await here.listProjects();
          const pickedProject = await vscode.window.showQuickPick(projects.map((p) => ({ label: p.name, description: p.description ?? '' })),
            { title: `Compare which project of ${here.displayName}?`, matchOnDescription: true });
          project = pickedProject?.label;
        }
        if (!project) return;
        const others = workspace.connections.filter((c) => providerId(c) !== here.id);
        if (!others.length) {
          vscode.window.showInformationMessage('Compare Project needs another connection (a database or a project export file) to compare with: add one first.');
          return;
        }
        let right = others[0];
        if (others.length > 1) {
          const picked = await vscode.window.showQuickPick(
            others.map((c) => ({ label: c.name, description: c.kind === 'projectFile' ? 'project export' : 'database', config: c })),
            { title: `Compare ${project} with…`, placeHolder: 'Other environment (read only; your active connection stays as it is)' });
          if (!picked) return;
          right = picked.config;
        }
        const projectName = project;
        const items = await here.listProjectItems(projectName);
        const results = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Comparing ${projectName} (${here.displayName} ↔ ${right.name})` },
          (progress) => workspace.readFromConnection(right, (other) =>
            compareProjectItems(items, here, other, (done, total) => progress.report({ message: `${done} of ${total}` }))));
        showProjectComparison(here, right.name, projectName, results);
      });
    }),

    vscode.commands.registerCommand('psft.addConnection', () => addConnection(workspace)),
    vscode.commands.registerCommand('psft.installDb2Driver', () => installDb2Driver(workspace.db2DriverDir!)),

    vscode.commands.registerCommand('psft.openProjectFile', async () => {
      const picked = await vscode.window.showOpenDialog({
        title: 'Open App Designer Project Export',
        canSelectMany: false,
        filters: { 'Project export': ['xml'] }
      });
      if (!picked?.[0]) return;
      await saveConnection({
        name: picked[0].path.split('/').pop() ?? 'Project',
        kind: 'projectFile',
        path: picked[0].fsPath
      });
      refreshAll();
    }),

    vscode.commands.registerCommand('psft.connect', async (config: ConnectionConfig) => {
      await withError(`Connecting to ${config.name}`, async () => {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Connecting to ${config.name}...` },
          () => workspace.connect(config));
        refreshAll();
      });
    }),

    vscode.commands.registerCommand('psft.disconnect', async (config: ConnectionConfig) => {
      await withError(`Disconnecting ${config.name}`, async () => {
        await workspace.disconnect(providerId(config));
        refreshAll();
      });
    }),

    vscode.commands.registerCommand('psft.removeConnection', async (config: ConnectionConfig) => {
      const confirm = await vscode.window.showWarningMessage(
        `Remove connection "${config.name}"?`, { modal: true }, 'Remove');
      if (confirm !== 'Remove') return;
      await workspace.disconnect(providerId(config));
      await workspace.forgetPassword(config.name);
      await workspace.forgetOperatorPassword(config.name);
      await workspace.forgetDomainPassword(config.name);
      const settings = vscode.workspace.getConfiguration('peoplesoft');
      const all = settings.get<ConnectionConfig[]>('connections', []);
      await settings.update('connections', all.filter((c) => c.name !== config.name),
        vscode.ConfigurationTarget.Global);
      refreshAll();
    }),

    vscode.commands.registerCommand('psft.process.open', () => withError('Opening Process Definition', async () => {
      const connected = workspace.activeProviders.filter((p): p is DatabaseProvider => p instanceof DatabaseProvider && p.isConnected);
      let provider = connected.find(p => p.id === workspace.selectedConnectionId);
      if (!provider && connected.length === 1) provider = connected[0];
      if (!provider && connected.length) provider = (await vscode.window.showQuickPick(connected.map(p => ({ label: p.displayName, provider: p })), { title: 'Process Definitions — connection' }))?.provider;
      if (!provider) { if (!connected.length) vscode.window.showInformationMessage('Connect a PeopleSoft database to open Process Definitions.'); return; }
      const pattern = await vscode.window.showInputBox({ title: `Process Definitions — ${provider.displayName}`, prompt: 'Process name (% matches any text)', value: '%', ignoreFocusOut: true });
      if (pattern === undefined) return;
      const found = await provider.search({ type: DefinitionType.ProcessDefinition, namePattern: pattern.trim().toUpperCase() || '%', limit: 500 });
      if (!found.length) { vscode.window.showInformationMessage('No process definitions match that name.'); return; }
      const picked = await vscode.window.showQuickPick(found.map(d => ({ label: d.key.parts[1], description: d.key.parts[0], detail: d.description, key: d.key })),
        { title: 'Open Process Definition', placeHolder: 'Choose a process (up to 500 matches)', matchOnDescription: true, matchOnDetail: true });
      if (picked) await vscode.commands.executeCommand('psft.openDefinition', provider.id, picked.key);
    })),

    vscode.commands.registerCommand('psft.query.open', async () => {
      await withError('Opening PS Query', async () => {
        const connected = workspace.activeProviders.filter(p => p.isConnected && p instanceof DatabaseProvider);
        const provider = connected.find(p => p.id === workspace.selectedConnectionId) ?? connected[0];
        if (!(provider instanceof DatabaseProvider)) throw new Error('Connect to a PeopleSoft database to open PS Query.');
        const pattern = await vscode.window.showInputBox({ title: `PS Query — ${provider.displayName}`, prompt: 'Public or your private query name (% matches any text)', value: '%', ignoreFocusOut: true });
        if (pattern === undefined) return;
        const found = await provider.searchQueries(pattern.trim() || '%', workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim() ?? '');
        if (!found.length) { vscode.window.showInformationMessage('No queries match that name.'); return; }
        const picked = await vscode.window.showQuickPick(found.map(q => ({ label: q.key.parts[0], description: q.description, key: q.key })),
          { title: 'Open PS Query', placeHolder: 'Choose a query (up to 500 matches)', matchOnDescription: true });
        if (picked) await showQueryDesigner(workspace, provider, picked.key);
      });
    }),

    vscode.commands.registerCommand('psft.query.new', async () => {
      await withError('Creating PS Query', async () => {
        const provider=workspace.activeProviders.find(p=>p.id===workspace.selectedConnectionId && p.isConnected)
          ?? workspace.activeProviders.find(p=>p.isConnected && p instanceof DatabaseProvider);
        if(!(provider instanceof DatabaseProvider))throw new Error('Connect to a PeopleSoft database first.');
        if(provider.platform!=='oracle')throw new Error('New Query is currently calibrated on Oracle.');
        const operator=workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
        if(!workspace.isWritable(provider.id) || !operator)throw new Error('New Query requires a Writable connection and PeopleSoft Operator ID.');
        const target=await queryTarget(provider,operator);if(!target)return;
        const record=await vscode.window.showInputBox({title:'New PS Query — Record',prompt:'SQL Table record name',value:'AAP_TBL',ignoreFocusOut:true});
        if(!record)return;
        const layout=await provider.readRecordLayout(makeKey(DefinitionType.Record,record.trim().toUpperCase()));
        if(!layout || layout.recordType!==RecordType.Table || layout.fields.some(f=>f.isSubrecord))throw new Error('Choose a SQL Table record without subrecords for this first release.');
        const doc=newQueryDocument(target.name,target.owner,layout.name);
        await showQueryDesigner(workspace,provider,makeKey(DefinitionType.Query,target.name,target.owner),{view:doc,token:'absent'});
      });
    }),

    vscode.commands.registerCommand('psft.clearRecentProjects', () =>
      withError('Clearing recent projects', async () => {
        await context.globalState.update(RECENT_PROJECTS_KEY, []);
      })),

    vscode.commands.registerCommand('psft.openRecentProject', () =>
      withError('Opening recent project', async () => {
        const recent = deserializeRecentProjects(context.globalState.get(RECENT_PROJECTS_KEY));
        const items = recent.map((entry) => {
          const config = workspace.configFor(entry.connectionId);
          const provider = workspace.getProvider(entry.connectionId);
          const status = !config ? 'connection no longer configured' : !provider?.isConnected ? 'not connected' : '';
          return { label: entry.project, description: config?.name ?? entry.connectionId, detail: status, entry };
        });
        const picked = await vscode.window.showQuickPick([
          ...items, { label: '$(clear-all) Clear Recent Projects', description: '', detail: '', entry: undefined }
        ], { title: 'Open Recent Project', placeHolder: recent.length ? 'Choose a project' : 'No recent projects', matchOnDescription: true });
        if (!picked) return;
        if (!picked.entry) {
          await vscode.commands.executeCommand('psft.clearRecentProjects');
          return;
        }
        if (picked.detail) {
          vscode.window.showInformationMessage(`${picked.entry.project}: ${picked.description} — ${picked.detail}. Connect the environment before opening this project.`);
          return;
        }
        await vscode.commands.executeCommand('psft.openDefinition', picked.entry.connectionId,
          makeKey(DefinitionType.Project, picked.entry.project));
      })),

    vscode.commands.registerCommand('psft.openProjectDefinition',
      (connectionId: string, key: DefinitionKey, project: string) =>
        withError(`Opening ${displayName(key)}`, async () => {
          const provider = await workspace.require(connectionId);
          if (provider instanceof DatabaseProvider) {
            let missing = false;
            if (PROPERTIES_SPECS[key.type]) {
              missing = !(await provider.readProperties(key));
            } else if (isPeopleCode(key.type)) {
              missing = !(await provider.hasPeopleCode(key));
            } else if (provider.canReadAsText(key.type)) {
              try { await provider.readText(key); }
              catch (error) {
                if (!isMissingProjectDefinition(error)) throw error;
                missing = true;
              }
            }
            if (missing) {
              vscode.window.showWarningMessage(missingProjectDefinitionMessage(key, provider.displayName, project));
              return;
            }
          }
          await vscode.commands.executeCommand('psft.openDefinition', connectionId, key);
        })),

    vscode.commands.registerCommand('psft.openDefinition',
      async (connectionId: string, key: DefinitionKey) => {
        await withError(`Opening ${displayName(key)}`, async () => {
          if (key.type === DefinitionType.Project) {
            await projects.openProject(connectionId, key.parts[0]);
            await vscode.commands.executeCommand('psft.projects.focus');
            return;
          }

          if (key.type === DefinitionType.Record) {
            const uri = toUri(connectionId, key);
            await vscode.commands.executeCommand(
              'vscode.openWith', uri, RecordEditorProvider.viewType);
            return;
          }

          if (key.type === DefinitionType.Field) {
            await vscode.commands.executeCommand(
              'vscode.openWith', toUri(connectionId, key), FieldEditorProvider.viewType);
            return;
          }

          if (key.type === DefinitionType.ProcessDefinition) {
            await vscode.commands.executeCommand('vscode.openWith', toUri(connectionId, key), ProcessEditorProvider.viewType);
            return;
          }

          const provider = await workspace.require(connectionId);
          if (key.type === DefinitionType.Query && provider instanceof DatabaseProvider) {
            await showQueryDesigner(workspace, provider, key);
            return;
          }
          if ((key.type === DefinitionType.AppEngineProgram || key.type === DefinitionType.AppEngineSection) && provider instanceof DatabaseProvider) {
            await showAeDesigner(workspace, provider, key.parts[0]);
            return;
          }
          if (key.type === DefinitionType.Menu && provider instanceof DatabaseProvider) {
            await showMenuDesigner(workspace, provider, key.parts[0]);
            return;
          }
          if (key.type === DefinitionType.ComponentInterface && provider instanceof DatabaseProvider) {
            await showCiDesigner(workspace, provider, key.parts[0]);
            return;
          }
          if (key.type === DefinitionType.MessageChannel && provider instanceof DatabaseProvider) {
            await showChannelDesigner(workspace, provider, key.parts[0]);
            return;
          }
          if (key.type === DefinitionType.FileLayout && provider instanceof DatabaseProvider) {
            await showFileLayoutDesigner(workspace, provider, key.parts[0]);
            return;
          }
          if (key.type === DefinitionType.Image && provider instanceof DatabaseProvider) {
            const image = await provider.readImage(key);
            if (!image) throw new Error(`No image named ${key.parts[0]}.`);
            ImagePanel.show({ id: provider.id, displayName: provider.displayName }, key, image);
            return;
          }
          if (key.type === DefinitionType.Component && provider instanceof DatabaseProvider) {
            let definition = await provider.readComponentDefinition(key);
            const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
            // Editable as pages are: a Writable connection, an operator, the name in the write scope.
            const editable = workspace.isWritable(provider.id) && !!operatorId && !writeScopeRefusal(definition.name);
            ComponentPanel.show({ id: provider.id, displayName: provider.displayName }, key, definition, {
              openPage: async (page) => { await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Page, page)); },
              viewPeopleCode: (record) => viewComponentPeopleCode(provider, definition, record),
              ...(editable ? {
                edit: {
                  choosePage: async (inComponent) => {
                    let info: { deferred: boolean } | undefined;
                    const page = await vscode.window.showInputBox({
                      title: `Insert Page into ${definition.name}.${definition.market}`, prompt: 'Page name', ignoreFocusOut: true,
                      validateInput: async (v) => {
                        const name = v.trim().toUpperCase();
                        if (!name) return undefined;
                        if (inComponent.includes(name)) return `${name} is already in the component.`;
                        info = await provider.pageInfo(name);
                        return info ? undefined : `There is no page named ${name}.`;
                      }
                    });
                    const name = page?.trim().toUpperCase();
                    if (!name) return undefined;
                    info ??= await provider.pageInfo(name);
                    if (!info) { void vscode.window.showWarningMessage(`There is no page named ${name}.`); return undefined; }
                    return { pageName: name, itemLabel: defaultItemLabel(name), deferred: info.deferred };
                  },
                  save: async (items, properties) => {
                    await provider.saveComponent({ name: definition.name, market: definition.market, openedVersion: definition.properties.general.version,
                      operatorId: operatorId!, items, properties });
                    definition = await provider.readComponentDefinition(key);
                    return definition;
                  }
                }
              } : {})
            });
            return;
          }
          if (key.type === DefinitionType.Page && provider instanceof DatabaseProvider) {
            const { layout, order } = await provider.readPageLayout(key);
            await showPageEditor(workspace, provider, key, layout, order);
            return;
          }
          if (!provider.canReadAsText(key.type)) {
            vscode.window.showInformationMessage(
              `${displayName(key)} (${typeLabel(key.type)}) can't be opened as text in ` +
              `${provider.displayName} yet.`);
            return;
          }

          const uri = toUri(connectionId, key);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: true });
        });
      }),

    vscode.commands.registerCommand('psft.pagePeopleCode.object', () =>
      withError('Choosing the object', () => choosePagePeopleCode(workspace, 'object'))),
    vscode.commands.registerCommand('psft.pagePeopleCode.event', () =>
      withError('Choosing the event', () => choosePagePeopleCode(workspace, 'event'))),
    vscode.commands.registerCommand('psft.componentPeopleCode.object', () =>
      withError('Choosing the object', () => chooseComponentPeopleCode(workspace, 'object'))),
    vscode.commands.registerCommand('psft.componentPeopleCode.event', () =>
      withError('Choosing the event', () => chooseComponentPeopleCode(workspace, 'event'))),
    vscode.commands.registerCommand('psft.viewComponentPeopleCode', async (target?: unknown) => {
      const t = await resolveDefinitionForCompare(workspace, target, 'View PeopleCode');
      if (!t) return;
      if (t.key.type !== DefinitionType.Component) {
        vscode.window.showInformationMessage(`${displayName(t.key)} is not a component.`);
        return;
      }
      await withError(`Viewing PeopleCode of ${displayName(t.key)}`, async () => {
        const provider = await workspace.require(t.connectionId);
        if (!(provider instanceof DatabaseProvider)) throw new Error('Component PeopleCode is listed from a database connection.');
        await viewComponentPeopleCode(provider, await provider.readComponentDefinition(t.key));
      });
    }),
    vscode.commands.registerCommand('psft.openDefinitionDialog', () => {
      if (workspace.activeProviders.every((p) => !p.isConnected)) {
        vscode.window.showWarningMessage(
          'Connect to a PeopleSoft environment, or open a project export, first.');
        return;
      }
      OpenDefinitionPanel.show(workspace, context.extensionUri);
    }),

    vscode.commands.registerCommand('psft.closeProject', (node: unknown) => {
      const target = node as { provider?: { id: string }; project?: { name: string } };
      if (target?.provider?.id && target.project?.name) {
        projects.closeProject(target.provider.id, target.project.name);
      }
    }),

    vscode.commands.registerCommand('psft.insertIntoProject', async (node?: unknown) => {
      await withError('Insert into project', async () => {
        const target = await resolveDefinitionForCompare(workspace, node, 'Insert Into Project');
        if (!target) return;
        const what = describeItem(target.key);
        if (!canInsertIntoProject(target.key.type)) {
          vscode.window.showInformationMessage(`${what} cannot be inserted into a project yet.`);
          return;
        }
        const provider = await workspace.require(target.connectionId);
        if (!(provider instanceof DatabaseProvider)) {
          vscode.window.showInformationMessage(
            `Inserting into a project writes to the database; ${provider.displayName} is a project export.`);
          return;
        }
        if (!workspace.isWritable(provider.id)) {
          vscode.window.showWarningMessage(
            `${provider.displayName} is read-only. To insert into its projects, set Access to Writable in PeopleSoft Studio Settings.`);
          return;
        }
        const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
        if (!operatorId) {
          vscode.window.showWarningMessage(
            `Set the PeopleSoft Operator ID for ${provider.displayName} in PeopleSoft Studio Settings first.`);
          return;
        }

        // Projects open in the Projects view first: the usual target.
        const opened = projects.openedIn(provider.id);
        const all = await provider.listProjects();
        const rank = (name: string) => (opened.includes(name) ? 0 : 1);
        const picked = await vscode.window.showQuickPick(
          [...all].sort((a, b) => rank(a.name) - rank(b.name)).map((p) => ({
            label: p.name,
            description: [opened.includes(p.name) ? 'open in Projects' : '', p.description?.trim() ?? '']
              .filter(Boolean).join(' · ')
          })),
          { title: `Insert ${what} into project`, placeHolder: `Project on ${provider.displayName}`, matchOnDescription: true });
        if (!picked) return;

        try {
          const result = await provider.saveProject({ project: picked.label, operatorId, add: [target.key] });
          projects.refresh();
          vscode.window.showInformationMessage(
            `Inserted ${what} into project ${picked.label} on ${provider.displayName} (project version ${result.version}).`);
        } catch (error) {
          if (!(error instanceof ProjectSaveRefusedError)) throw error;
          vscode.window.showWarningMessage(`${what} was not inserted: ${error.message}`);
        }
      });
    }),

    vscode.commands.registerCommand('psft.deleteRecord', async (node?: unknown) => {
      await withError('Delete record', async () => {
        const target = await resolveDefinitionForCompare(workspace, node, 'Delete Record');
        if (!target) return;
        if (target.key.type !== DefinitionType.Record) {
          vscode.window.showInformationMessage('Choose a record to delete.');
          return;
        }
        const recname = target.key.parts[0];
        const provider = await workspace.require(target.connectionId);
        const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
        if (!(provider instanceof DatabaseProvider) || !workspace.isWritable(provider.id) || !operatorId) {
          vscode.window.showWarningMessage(
            `${recname} cannot be deleted: ${provider.displayName} must be a Writable database connection with an Operator ID (PeopleSoft Studio Settings).`);
          return;
        }
        const editors = RecordEditorProvider.openEditors(provider.id, recname);
        if (editors.dirty) {
          vscode.window.showWarningMessage(`${recname} has unsaved changes. Save or revert them first.`);
          return;
        }
        const layout = await provider.readRecordLayout(target.key);
        if (!layout) {
          vscode.window.showWarningMessage(`There is no record named ${recname} in ${provider.displayName}.`);
          return;
        }
        const yes = await vscode.window.showWarningMessage(
          `Delete record ${recname} from ${provider.displayName}? Its definition is removed, as App Designer's Delete does; the SQL table, if built, is not dropped.`,
          { modal: true }, 'Delete');
        if (yes !== 'Delete') return;
        try {
          await provider.deleteRecord({ recname, openedVersion: layout.version, operatorId });
        } catch (error) {
          if (!(error instanceof RecordSaveRefusedError)) throw error;
          vscode.window.showWarningMessage(`${recname} was not deleted: ${error.message}`);
          return;
        }
        editors.close();
        browser.refresh();
        projects.refresh();
        vscode.window.showInformationMessage(`Deleted record ${recname} from ${provider.displayName}.`);
      });
    }),

    vscode.commands.registerCommand('psft.newDefinition', () =>
      withError('New definition', () => newDefinition(workspace))),
    vscode.commands.registerCommand('psft.newPage', () => withError('New Page', () => newPage(workspace))),
    vscode.commands.registerCommand('psft.newAppEngine', () => withError('New App Engine Program', () => newAppEngine(workspace))),
    vscode.commands.registerCommand('psft.newMenu', () => withError('New Menu', () => newMenu(workspace))),
    vscode.commands.registerCommand('psft.newComponentInterface', () => withError('New Component Interface', () => newComponentInterface(workspace))),
    vscode.commands.registerCommand('psft.newMessageChannel', () => withError('New Message Channel', () => newMessageChannel(workspace))),
    vscode.commands.registerCommand('psft.newFileLayout', () => withError('New File Layout', () => newFileLayout(workspace))),
    vscode.commands.registerCommand('psft.newPageFluid', () => withError('New Page Fluid', () => newPageFluid(workspace))),

    vscode.commands.registerCommand('psft.newHtmlDefinition', () =>
      withError('New HTML definition', () => newTextDefinition(workspace, DefinitionType.HtmlDefinition))),

    vscode.commands.registerCommand('psft.newSqlDefinition', () =>
      withError('New SQL definition', () => newTextDefinition(workspace, DefinitionType.SqlDefinition))),

    vscode.commands.registerCommand('psft.newStyleSheet', () =>
      withError('New style sheet', () => newTextDefinition(workspace, DefinitionType.StyleSheet))),

    vscode.commands.registerCommand('psft.changeDescription', async (node?: unknown) => {
      await withError('Change description', async () => {
        const target = await resolveDefinitionForCompare(workspace, node, 'Change Description');
        if (!target) return;
        const key = target.key;
        if (key.type !== DefinitionType.HtmlDefinition && key.type !== DefinitionType.StyleSheet) {
          vscode.window.showInformationMessage('Change Description is for HTML definitions and style sheets.');
          return;
        }
        const name = key.parts[0];
        const provider = await workspace.require(target.connectionId);
        if (!(provider instanceof DatabaseProvider) || !workspace.isSqlWritable(provider.id, key)) {
          vscode.window.showWarningMessage(
            `${name}'s description cannot be changed here: a Writable connection with an Operator ID is needed${writeNamePrefix() ? `, and a name starting ${writeNamePrefix()}` : ''}.`);
          return;
        }
        const uri = toUri(provider.id, key);
        if (vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString() && d.isDirty)) {
          vscode.window.showWarningMessage(`${name} has unsaved changes. Save or revert them first.`);
          return;
        }
        const opened = key.type === DefinitionType.HtmlDefinition
          ? await provider.readHtmlForEdit(key)
          : await provider.readStyleSheetForEdit(key);
        if (!opened || opened === 'classic') {
          vscode.window.showWarningMessage(opened === 'classic'
            ? `${name} is a classic style sheet; only freeform style sheets are saved here.`
            : `There is no ${typeLabel(key.type).replace(/s$/, '')} named ${name}.`);
          return;
        }
        const current = String((await provider.readProperties?.(key))?.row?.DESCR ?? '').trim();
        const description = await vscode.window.showInputBox({
          title: `Description of ${name}`, value: current, prompt: 'At most 30 characters; saved to the database at once.',
          validateInput: (v) => (v.length <= 30 ? undefined : 'At most 30 characters.')
        });
        if (description === undefined || description.trim() === current) return;
        const request = {
          name, text: opened.text, openedVersion: opened.version, description,
          operatorId: workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim()
        };
        try {
          if (key.type === DefinitionType.HtmlDefinition) await provider.saveHtmlDefinition(request);
          else await provider.saveStyleSheet(request);
        } catch (error) {
          if (!(error instanceof HtmlSaveRefusedError || error instanceof StyleSheetSaveRefusedError)) throw error;
          vscode.window.showWarningMessage(`The description was not saved: ${error.message}`);
          return;
        }
        PeopleSoftFileSystem.instance?.reload(uri);
        browser.refresh();
        projects.refresh();
        vscode.window.showInformationMessage(`${name}'s description is now "${description.trim()}".`);
      });
    }),

    vscode.commands.registerCommand('psft.buildProject', async (node?: unknown) => {
      await withError('Build Project', async () => {
        const n = node as { kind?: string; provider?: DefinitionProvider; project?: { name: string } } | undefined;
        const provider = n?.kind === 'project' && n.provider ? n.provider : workspace.activeProviders.find((p) => p.isConnected);
        if (!(provider instanceof DatabaseProvider)) {
          vscode.window.showInformationMessage('Build Project writes its script from a database\'s DDL model: connect a database first (a project export carries none).');
          return;
        }
        let project = n?.kind === 'project' ? n.project?.name : undefined;
        if (!project) {
          const projectsList = await provider.listProjects();
          project = (await vscode.window.showQuickPick(projectsList.map((p) => ({ label: p.name, description: p.description ?? '' })),
            { title: `Build which project of ${provider.displayName}?`, matchOnDescription: true }))?.label;
        }
        if (!project) return;
        const projectName = project;
        const config = vscode.workspace.getConfiguration('peoplesoft');
        const operation = (await vscode.window.showQuickPick([
          { label: 'Create Tables', operation: 'tables' as const, detail: 'Each SQL Table, with its indexes (Build Settings: table option).' },
          { label: 'Create Indexes', operation: 'indexes' as const, detail: 'Missing and changed indexes of each existing SQL Table (Build Settings: index option).' },
          { label: 'Create Views', operation: 'views' as const, detail: 'Each SQL View (Build Settings: view option).' },
          { label: 'Alter Tables', operation: 'alter' as const, detail: 'Each existing SQL Table brought in line with its record (Build Settings: Alter).' }
        ], { title: `Build ${projectName}`, placeHolder: 'Build option (a script; nothing is run)' }));
        if (!operation) return;
        const option: TableOption = config.get<TableOption>('build.create.table') === 'skip' ? 'skip' : 'recreate';
        const a = (k: string, d: boolean) => config.get<boolean>(`build.alter.${k}`) ?? d;
        const alter: AlterSettings = {
          tableOption: config.get<string>('build.alter.tableOption') === 'inPlace' ? 'inPlace' : 'rename',
          dropColumn: config.get<string>('build.alter.dropColumn') === 'drop' ? 'drop' : 'skip',
          changeLength: config.get<string>('build.alter.changeLength') === 'truncate' ? 'truncate' : 'skip',
          adds: a('adds', true), changes: a('changes', true), renames: a('renames', true), deletes: a('deletes', true), evenIfNoChanges: a('evenIfNoChanges', false)
        };
        const plan = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Building ${projectName}: ${operation.label}` },
          async (progress) => {
            const records = (await provider.listProjectItems(projectName)).filter((i) => i.key.type === DefinitionType.Record);
            const inputs: ProjectBuildRecord[] = [];
            const missing: string[] = [];
            const plans: BuildPlan[] = [];
            for (const [i, item] of records.entries()) {
              progress.report({ message: `${i + 1} of ${records.length}` });
              const layout = await provider.readRecordLayout(item.key);
              if (!layout) { missing.push(item.key.parts[0]); continue; }
              const model = await provider.readDdlModel(layout.name);
              if (!model) throw new Error(`${provider.displayName} has no DDL model for its platform (PSDDLMODEL).`);
              const record = ddlRecordFromLayout(layout);
              if (operation.operation === 'tables') {
                const exists = unbuildableReason(layout) ? false : (await provider.tableState(tableName(record))).exists;
                inputs.push({ layout, model, tableExists: exists });
                continue;
              }
              const wanted = operation.operation === 'views' ? RecordType.View : RecordType.Table;
              if (layout.recordType !== wanted) continue;
              if (layout.fields.some((f) => f.isSubrecord) && operation.operation !== 'views') { plans.push({ script: '', statements: [], notes: [`${layout.name}: has subrecords (not built here yet).`] }); continue; }
              if (operation.operation === 'views') {
                const viewSql = layout.viewSql ?? '';
                plans.push(planCreateViews(record, viewSql, await provider.viewExists(tableName(record)),
                  config.get<ViewOption>('build.create.view') === 'skip' ? 'skip' : 'recreate', model, await provider.readViewMetaContext(viewSql), await provider.expandedFieldNames(layout.name)));
              } else {
                const facts = await provider.readBuildFacts(tableName(record));
                plans.push(operation.operation === 'indexes'
                  ? planCreateIndexes(record, model, facts, config.get<IndexOption>('build.create.index') === 'recreate' ? 'recreate' : 'ifModified')
                  : planAlterTable(record, model, facts, alter));
              }
            }
            const p = operation.operation === 'tables' ? planProjectCreateTables(inputs, option) : combineBuildPlans(plans);
            return { ...p, notes: [...p.notes, ...missing.map((m) => `${m}: in the project, but not in the database.`)], records: records.length };
          });
        if (!plan.script) {
          vscode.window.showInformationMessage(`${projectName}: nothing to build (${plan.records} record${plan.records === 1 ? '' : 's'}).${plan.notes.length ? ` ${plan.notes.join(' ')}` : ''}`);
          return;
        }
        const doc = await vscode.workspace.openTextDocument({ content: plan.script, language: 'psft-sql' });
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showInformationMessage(
          `${projectName}: ${operation.label} script, ${plan.statements.length} statement(s)${plan.drops ? `, dropping ${plan.drops} first (Build Settings: recreate)` : ''}. ` +
          `Nothing was run.${plan.notes.length ? ` Notes: ${plan.notes.join(' ')}` : ''}`);
      });
    }),

    vscode.commands.registerCommand('psft.openFieldPeopleCode', async (target?: unknown) => {
      await withError('Opening PeopleCode', async () => {
        // From the record editor: { connectionId, record, field }; from a tree: a field under its record.
        const direct = target as { connectionId?: string; record?: string; field?: string } | undefined;
        let connectionId: string | undefined;
        let record: string | undefined;
        let field: string | undefined;
        if (direct?.connectionId && direct.record && direct.field) {
          ({ connectionId, record, field } = direct);
        } else {
          const t = await resolveDefinitionForCompare(workspace, target, 'PeopleCode');
          if (!t) return;
          if (t.key.type !== DefinitionType.Field || t.key.parts.length < 2) {
            vscode.window.showInformationMessage('Choose a field under its record (Record > Field) to open its PeopleCode.');
            return;
          }
          connectionId = t.connectionId;
          [field, record] = t.key.parts;
        }
        if (!connectionId || !record || !field) return;
        await pickRecordFieldPeopleCode(workspace, connectionId, record, field);
      });
    }),

    vscode.commands.registerCommand('psft.showProperties', async (node?: unknown) => {
      await withError('Properties', async () => {
        const target = await resolveDefinitionForCompare(workspace, node, 'Properties');
        if (!target) return;
        const name = `${displayName(target.key)} (${typeLabel(target.key.type)})`;
        if (!hasProperties(target.key.type)) {
          vscode.window.showInformationMessage(`${name} has no Properties panel.`);
          return;
        }
        const provider = await workspace.require(target.connectionId);
        if (!provider.readProperties) {
          vscode.window.showInformationMessage(
            `Properties are read from the database: ${provider.displayName} is a project export, which does not carry them.`);
          return;
        }
        const input = await provider.readProperties(target.key);
        if (!input) {
          vscode.window.showWarningMessage(`${name} was not found in ${provider.displayName}.`);
          return;
        }
        PropertiesPanel.show(context.extensionUri, provider, target.key, buildProperties(input));
      });
    }),

    vscode.commands.registerCommand('psft.compareDefinition', async (node?: unknown) => {
      await withError('Compare definition', async () => {
        const left = await resolveDefinitionForCompare(workspace, node);
        if (!left) return;

        const leftProvider = await workspace.require(left.connectionId);
        if (!leftProvider.canReadAsText(left.key.type)) {
          vscode.window.showInformationMessage(
            `${displayName(left.key)} (${typeLabel(left.key.type)}) can't be compared as text yet. ` +
            'Compare works for PeopleCode, SQL, and other text-backed definitions.');
          return;
        }

        // Any other configured connection -- a database or a project export -- read without making it active.
        const others = workspace.connections.filter((c) => providerId(c) !== left.connectionId);
        if (others.length === 0) {
          vscode.window.showInformationMessage(
            'Compare With Environment reads the same definition from another connection: add one (a database or a project export file) first.');
          return;
        }
        let right = others[0];
        if (others.length > 1) {
          const picked = await vscode.window.showQuickPick(
            others.map((c) => ({ label: c.name, description: c.kind === 'projectFile' ? 'project export' : 'database', config: c })),
            { title: `Compare ${displayName(left.key)} with…`, placeHolder: 'Other environment (read only; your active connection stays as it is)', ignoreFocusOut: true });
          if (!picked) return;
          right = picked.config;
        }

        let text: string;
        try {
          text = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Reading ${displayName(left.key)} from ${right.name}…` },
            () => workspace.readFromConnection(right, async (p) => {
              if (!p.canReadAsText(left.key.type)) throw new Error(`${right.name} can't open ${typeLabel(left.key.type)} as text.`);
              return p.readText(left.key);
            }));
        } catch (err) {
          vscode.window.showErrorMessage(`Could not read ${displayName(left.key)} from ${right.name}: ${(err as Error).message}`);
          return;
        }

        const leftUri = toUri(left.connectionId, left.key);
        const rightUri = compareContent.put(right.name, left.key, text);
        const title = `${displayName(left.key)} (${leftProvider.displayName} ↔ ${right.name})`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
      });
    }),
  );

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('peoplesoft.connections')) refreshAll();
    if (e.affectsConfiguration('peoplesoft.writeNamePrefix')) {
      setWriteNamePrefix(vscode.workspace.getConfiguration('peoplesoft').get<string>('writeNamePrefix'));
      refreshAll();
    }
  }, null, context.subscriptions);

  const disableMcp =
    process.env.PSFT_DISABLE_MCP === '1';

  if (!disableMcp) {
    context.subscriptions.push(
      mcpController.watchConfiguration()
    );
  }

  if (!disableMcp && mcpController.enabled) {
    try {
      await mcpController.start();

      console.log(
        `PeopleSoft Studio MCP server listening at ${mcpController.state.url}`
      );
    } catch (err) {
      const message =
        (err as Error).message;

      console.warn(
        `PeopleSoft Studio MCP server failed to start: ${message}`
      );
    }
  }
}

export function deactivate(): void { /* Workspace disposes through subscriptions. */ }

async function saveConnection(config: ConnectionConfig): Promise<void> {
  const settings = vscode.workspace.getConfiguration('peoplesoft');
  const all = settings.get<ConnectionConfig[]>('connections', []);

  if (all.some((c) => c.name === config.name)) {
    vscode.window.showErrorMessage(
      `A connection named "${config.name}" already exists.`
    );
    return;
  }

  await settings.update(
    'connections',
    [...all, config],
    vscode.ConfigurationTarget.Global
  );
}

/**
 * Installs ibm_db for DB2 connections into the extension's storage, with npm
 * in a terminal the user watches. ibm_db is not shipped in the extension: it
 * downloads IBM's CLI driver for this operating system (some 85 MB) when it
 * installs, which its install script does -- allowed by name in the
 * package.json written for it, as npm 11 otherwise skips install scripts.
 */
async function installDb2Driver(dir: string): Promise<void> {
  const go = await vscode.window.showInformationMessage(
    'Install the DB2 driver (ibm_db, with IBM\'s CLI driver: about 85 MB from npm and IBM)? It needs npm.',
    { modal: true, detail: `It is installed in ${dir}. DB2 for z/OS also needs a DB2 Connect license in its clidriver/license folder.` },
    'Install');
  if (go !== 'Install') return;
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'peoplesoft-studio-db2-driver', private: true,
    dependencies: { ibm_db: '^4.0.1' },
    allowScripts: { ibm_db: true }
  }, null, 2) + '\n');
  const terminal = vscode.window.createTerminal({ name: 'PeopleSoft: DB2 driver', cwd: dir });
  terminal.show();
  // npm 11 takes the approval from package.json's allowScripts (it refuses --allow-scripts in a project).
  terminal.sendText('npm install --no-fund --no-audit');
  void vscode.window.showInformationMessage('When npm finishes, connect to the DB2 connection again.');
}

/** Collects a connection interactively rather than making the user hand-edit settings.json. */
/** Compare Project's results: differences first; choosing one opens its diff, and the list stays open for the next. */
function showProjectComparison(here: DefinitionProvider, otherName: string, project: string, results: ProjectItemComparison[]): void {
  const order: Array<[ProjectItemOutcome, string, string]> = [
    ['different', 'Different', '$(diff)'], ['missing', `Not in ${otherName}`, '$(question)'], ['error', 'Could not be read', '$(error)'],
    ['notCompared', 'Not compared', '$(dash)'], ['same', 'Same', '$(check)']
  ];
  type Item = vscode.QuickPickItem & { result?: ProjectItemComparison };
  const items: Item[] = [];
  for (const [outcome, heading, icon] of order) {
    const these = results.filter((r) => r.outcome === outcome);
    if (!these.length) continue;
    items.push({ label: `${heading} (${these.length})`, kind: vscode.QuickPickItemKind.Separator });
    for (const r of these) items.push({ label: `${icon} ${r.label}`, description: typeLabel(r.key.type), ...(r.detail ? { detail: r.detail } : {}), result: r });
  }
  const differ = results.filter((r) => r.outcome === 'different').length;
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = `${project}: ${differ} different, ${results.filter((r) => r.outcome === 'same').length} same (${here.displayName} ↔ ${otherName})`;
  qp.placeholder = 'Choose a difference to see it side by side';
  qp.items = items;
  qp.matchOnDescription = true;
  qp.ignoreFocusOut = true;
  qp.onDidAccept(async () => {
    const r = qp.selectedItems[0]?.result;
    if (!r) return;
    if (r.outcome === 'different') {
      const rightUri = compareContentForProjects!.put(otherName, r.key, r.otherText ?? '');
      const leftUri = r.sourceText === undefined ? toUri(here.id, r.key) : compareContentForProjects!.put(here.displayName, r.key, r.sourceText);
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${r.label} (${here.displayName} ↔ ${otherName})`, { preview: true, preserveFocus: true });
    } else if (r.outcome === 'same' || r.outcome === 'missing') {
      await vscode.commands.executeCommand('psft.openDefinition', here.id, r.key);
    }
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function addConnection(workspace: Workspace): Promise<void> {
  const kind = await vscode.window.showQuickPick(
    [
      { label: 'Oracle database', description: 'PeopleTools tables on Oracle', platform: 'oracle' as const },
      { label: 'Microsoft SQL Server database', description: 'PeopleTools tables on SQL Server', platform: 'mssql' as const },
      { label: 'DB2 database', description: 'PeopleTools tables on DB2 for Linux, UNIX and Windows, or z/OS', platform: 'db2' as const },
      { label: '2 Tier (Oracle)', description: 'Proxy database login plus a PeopleSoft operator sign-on', platform: 'oracle' as const, signon: 'twoTier' as const },
      { label: '2 Tier (MS SQL)', description: 'Proxy database login plus a PeopleSoft operator sign-on', platform: 'mssql' as const, signon: 'twoTier' as const },
      { label: '2 Tier (DB2)', description: 'Proxy database login plus a PeopleSoft operator sign-on', platform: 'db2' as const, signon: 'twoTier' as const },
      { label: '3 Tier (Application Server)', description: 'Connect through a PeopleSoft application server (Tuxedo)', platform: undefined, signon: 'threeTier' as const },
      { label: 'Project export file', description: 'Read an App Designer XML export', platform: 'projectFile' as const }
    ],
    { title: 'PeopleSoft connection type', ignoreFocusOut: true });
  if (!kind) return;

  const name = await vscode.window.showInputBox({
    title: 'Connection name', placeHolder: 'DEV', ignoreFocusOut: true });
  if (!name) return;

  if (kind.signon === 'threeTier') {
    await addThreeTierConnection(workspace, name);
    return;
  }

  if (kind.platform === 'projectFile') {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false, filters: { 'Project export': ['xml'] } });
    if (!picked?.[0]) return;
    await saveConnection({ name, kind: 'projectFile', path: picked[0].fsPath });
    return;
  }

  const platform = kind.platform;
  if (!platform) return;
  const twoTier = kind.signon === 'twoTier';
  const prompt = {
    oracle: { title: 'Oracle connect string', placeHolder: 'host:1521/PSFTDB' },
    mssql: { title: 'SQL Server: host[\\instance][:port]/database', placeHolder: 'sqlhost:1433/HCM92' },
    db2: { title: 'DB2: host[:port]/database (z/OS: the location name)', placeHolder: 'db2host:50000/HCM92' }
  }[platform];
  const connectString = await vscode.window.showInputBox({
    ...prompt,
    ignoreFocusOut: true,
    validateInput: (value) => validateConnectString(value.trim(), platform)
  });
  if (!connectString) return;

  // The database login. Two-tier: the proxy (Connect ID, e.g. people) that
  // runs every query. Direct: the schema-owning access id.
  const user = await vscode.window.showInputBox({
    title: twoTier ? 'Connect ID (the proxy database login that runs queries)' : 'Database access id',
    placeHolder: twoTier ? 'people' : undefined,
    value: twoTier ? '' : platform === 'oracle' ? 'SYSADM' : '',
    ignoreFocusOut: true });
  if (!user) return;

  if (!twoTier) {
    await saveConnection({ name, kind: platform, connectString: connectString.trim(), user });
    return;
  }

  // Two-tier: the PeopleSoft operator this connection acts as -- the save
  // identity, verified against PSOPRDEFN at connect. The access-profile lookup
  // is never done, so the Connect ID above is what reaches the tables.
  const operatorId = await vscode.window.showInputBox({
    title: 'PeopleSoft User ID (the operator saves are recorded as)',
    placeHolder: 'PS', ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'A PeopleSoft operator ID is required for a two-tier connection.'
  });
  if (!operatorId) return;

  const operatorPassword = await vscode.window.showInputBox({
    title: `PeopleSoft password for ${operatorId.trim()}`,
    password: true, ignoreFocusOut: true,
    prompt: 'Stored in the OS secret store. The operator is verified to exist and be unlocked; the password is kept for the sign-on.'
  });
  if (operatorPassword === undefined) return;

  await saveConnection({
    name, kind: platform, connectString: connectString.trim(), user,
    signon: 'twoTier', peoplesoftOperatorId: operatorId.trim()
  });
  await workspace.setOperatorPassword(name, operatorPassword);
}

/**
 * App Designer's 3 Tier (Application Server) sign-on. The connection reaches a
 * PeopleSoft application server over Tuxedo rather than the database directly;
 * the operator signs on there. The database type is still chosen, for the SQL
 * the transport will send. The app-server transport is not built yet, so the
 * connection is configured and stored but cannot be opened.
 */
async function addThreeTierConnection(workspace: Workspace, name: string): Promise<void> {
  const dbType = await vscode.window.showQuickPick(
    [
      { label: 'Oracle', value: 'oracle' as const },
      { label: 'Microsoft SQL Server', value: 'mssql' as const },
      { label: 'DB2', value: 'db2' as const }
    ],
    { title: 'Database Type (the platform the application server\'s database runs on)', ignoreFocusOut: true });
  if (!dbType) return;

  const appServerName = await vscode.window.showInputBox({
    title: 'Application Server Name (the domain)', ignoreFocusOut: true });
  if (appServerName === undefined) return;

  const appServerMachine = await vscode.window.showInputBox({
    title: 'Machine Name or IP Address', placeHolder: 'appserver.example.com', ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'The application server machine is required.' });
  if (!appServerMachine) return;

  const portText = await vscode.window.showInputBox({
    title: 'Port Number', placeHolder: '9033', ignoreFocusOut: true,
    validateInput: (value) => {
      const v = value.trim();
      return /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535 ? undefined : 'A port number between 1 and 65535.';
    } });
  if (!portText) return;

  const tuxedoConnectString = await vscode.window.showInputBox({
    title: 'TUXEDO Connect String (optional)', placeHolder: '//host:port', ignoreFocusOut: true });
  if (tuxedoConnectString === undefined) return;

  const operatorId = await vscode.window.showInputBox({
    title: 'PeopleSoft User ID (the operator this connection signs on as)',
    placeHolder: 'PS', ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'A PeopleSoft operator ID is required.' });
  if (!operatorId) return;

  const operatorPassword = await vscode.window.showInputBox({
    title: `PeopleSoft password for ${operatorId.trim()}`, password: true, ignoreFocusOut: true,
    prompt: 'Stored in the OS secret store.' });
  if (operatorPassword === undefined) return;

  const domainPassword = await vscode.window.showInputBox({
    title: 'Domain Connection Password (optional)', password: true, ignoreFocusOut: true,
    prompt: 'The application server domain password, if the domain requires one. Stored in the OS secret store.' });
  if (domainPassword === undefined) return;

  await saveConnection({
    name, kind: dbType.value, signon: 'threeTier',
    appServerName: appServerName.trim() || undefined,
    appServerMachine: appServerMachine.trim(),
    appServerPort: Number(portText.trim()),
    ...(tuxedoConnectString.trim() ? { tuxedoConnectString: tuxedoConnectString.trim() } : {}),
    peoplesoftOperatorId: operatorId.trim()
  });
  await workspace.setOperatorPassword(name, operatorPassword);
  if (domainPassword) await workspace.setDomainPassword(name, domainPassword);
  vscode.window.showInformationMessage(
    `Added 3 Tier connection "${name}". The application server is configured; the app-server transport is not implemented yet, so it cannot be opened yet.`);
}

async function selectStatusConnection(workspace: Workspace): Promise<void> {
  const connections = workspace.connections;

  if (connections.length === 0) {
    vscode.window.showInformationMessage(
      'No PeopleSoft connections are configured.'
    );
    return;
  }

  const connected = new Set(
    workspace.activeProviders
      .filter((p) => p.isConnected)
      .map((p) => p.id)
  );

  const picked = await vscode.window.showQuickPick(
    connections.map((config) => {
      const id = providerId(config);

      return {
        label: config.name,
        description: connected.has(id) ? 'Connected' : 'Not connected',
        detail: config.kind !== 'projectFile'
          ? config.connectString
          : config.path,
        config,
      };
    }),
    {
      title: 'Select PeopleSoft Connection',
      placeHolder: 'Choose a connection',
      ignoreFocusOut: true,
    }
  );

  if (!picked) return;

  await selectConnection(workspace, picked.config);
}

/** Surfaces provider failures as messages instead of unhandled rejections. */
/**
 * A record field's PeopleCode, by event: the events with a program first
 * (opened on choice), then the rest of App Designer's record field events.
 */
async function pickRecordFieldPeopleCode(workspace: Workspace, connectionId: string, record: string, field: string): Promise<void> {
  const provider = await workspace.require(connectionId);
  const existing = (await provider.listChildren(makeKey(DefinitionType.Field, field, record)))
    .filter((s) => s.key.type === DefinitionType.RecordPeopleCode);
  const byEvent = new Map(existing.map((s) => [s.key.parts[s.key.parts.length - 1], s.key]));
  const events = [...byEvent.keys(), ...RECORD_FIELD_EVENTS.filter((e) => !byEvent.has(e))];
  const picked = await vscode.window.showQuickPick(
    events.map((event) => ({
      label: `${byEvent.has(event) ? '$(symbol-event)' : '$(blank)'} ${event}`,
      description: byEvent.has(event) ? 'PeopleCode' : 'no PeopleCode (new)',
      event
    })),
    { title: `${record}.${field} PeopleCode`, placeHolder: 'Event' });
  if (!picked) return;
  const key = byEvent.get(picked.event);
  if (!key) {
    // A new program opens empty where saving is allowed; saving creates it.
    const newKey = makeKey(DefinitionType.RecordPeopleCode, record, field, picked.event);
    if (workspace.isPeopleCodeWritable(connectionId, newKey)) {
      await vscode.commands.executeCommand('psft.openDefinition', connectionId, newKey);
      vscode.window.showInformationMessage(`${record}.${field}.${picked.event} is a new program: saving it creates it.`);
      return;
    }
    vscode.window.showInformationMessage(
      `${record}.${field}.${picked.event} has no PeopleCode. New programs can be created on Writable connections${writeNamePrefix() ? `, for records starting ${writeNamePrefix()}` : ''}.`);
    return;
  }
  await vscode.commands.executeCommand('psft.openDefinition', connectionId, key);
}

/**
 * App Designer's File > New: pick the type, then that type's own flow. Types
 * this extension cannot create yet are listed, and say so, rather than
 * leaving the user to wonder whether they were left out.
 */
async function newDefinition(workspace: Workspace): Promise<void> {
  type Item = vscode.QuickPickItem & {
    create?: TextDefinitionType | DefinitionType.Record | DefinitionType.Field | DefinitionType.Project | DefinitionType.ApplicationPackage
      | DefinitionType.ApplicationClassPeopleCode | DefinitionType.Component | DefinitionType.Page | DefinitionType.AppEngineProgram | DefinitionType.Menu | DefinitionType.ComponentInterface | DefinitionType.MessageChannel | DefinitionType.FileLayout;
    /** Page: New Page Fluid (from a Layout Page). */
    fluid?: boolean;
  };
  const picked = await vscode.window.showQuickPick<Item>([
    { label: 'Available', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(table) Record', description: 'SQL Table or Derived/Work; add fields, then save', create: DefinitionType.Record },
    { label: '$(symbol-field) Field', description: 'type, length and label; created when you finish', create: DefinitionType.Field },
    { label: '$(project) Project', description: 'created empty, then opened in Projects', create: DefinitionType.Project },
    { label: '$(window) Component', description: 'a search record and its first page; created, then opened', create: DefinitionType.Component },
    { label: '$(layout) Page', description: 'opens empty (Fluid Page off); the first save creates it, once it has a control', create: DefinitionType.Page },
    { label: '$(layout-panel) Page Fluid', description: 'from a Layout Page you choose (Fluid Page on); created, then opened', create: DefinitionType.Page, fluid: true },
    { label: '$(package) Application Package', description: 'created empty; then add classes', create: DefinitionType.ApplicationPackage },
    { label: '$(symbol-class) Application Class', description: 'in a package or subpackage; opens its declaration, the first save creates it', create: DefinitionType.ApplicationClassPeopleCode },
    { label: '$(code) HTML Definition', description: 'opens empty; the first save creates it', create: DefinitionType.HtmlDefinition },
    { label: '$(symbol-color) Style Sheet', description: 'freeform; opens empty, the first save creates it', create: DefinitionType.StyleSheet },
    { label: '$(database) SQL Definition', description: 'opens empty; the first save creates it', create: DefinitionType.SqlDefinition },
    { label: '$(gear) App Engine Program', description: 'MAIN with Step01, as App Designer starts one; the first save creates it', create: DefinitionType.AppEngineProgram },
    { label: '$(list-tree) Menu', description: 'Standard or Popup, as App Designer asks; the first save creates it, once it has an item', create: DefinitionType.Menu },
    { label: '$(plug) Component Interface', description: 'On a component, its properties defaulted from the component or not, as App Designer asks', create: DefinitionType.ComponentInterface },
    { label: '$(radio-tower) Message Channel', description: 'App Designer\'s defaults; the first save creates it', create: DefinitionType.MessageChannel },
    { label: '$(file-text) File Layout', description: 'FIXED, empty; Insert Record builds a segment; the first save creates it', create: DefinitionType.FileLayout }
  ], { title: 'New Definition', placeHolder: 'Definition type' });
  if (!picked) return;
  // DefinitionType.Record is 0: test for absence, not falsiness.
  if (picked.create === undefined) {
    vscode.window.showInformationMessage(`Creating a ${picked.label} is not available yet.`);
    return;
  }
  if (picked.create === DefinitionType.Record) await newRecord(workspace);
  else if (picked.create === DefinitionType.Field) await newField(workspace);
  else if (picked.create === DefinitionType.Project) await newProject(workspace);
  else if (picked.create === DefinitionType.Component) await newComponent(workspace);
  else if (picked.create === DefinitionType.Page) await (picked.fluid ? newPageFluid(workspace) : newPage(workspace));
  else if (picked.create === DefinitionType.ApplicationPackage) await newPackage(workspace);
  else if (picked.create === DefinitionType.ApplicationClassPeopleCode) await newClass(workspace);
  else if (picked.create === DefinitionType.AppEngineProgram) await newAppEngine(workspace);
  else if (picked.create === DefinitionType.Menu) await newMenu(workspace);
  else if (picked.create === DefinitionType.ComponentInterface) await newComponentInterface(workspace);
  else if (picked.create === DefinitionType.MessageChannel) await newMessageChannel(workspace);
  else if (picked.create === DefinitionType.FileLayout) await newFileLayout(workspace);
  else await newTextDefinition(workspace, picked.create);
}

/**
 * App Designer's File > New > HTML, (freeform) Style Sheet or SQL: an empty editor
 * whose first save creates the definition.
 */
/** The Writable database connections with an Operator ID; one picked when there are several. */
async function pickWritableConnection(workspace: Workspace, title: string): Promise<DatabaseProvider | undefined> {
  const writable = workspace.activeProviders.filter((p): p is DatabaseProvider =>
    p instanceof DatabaseProvider && p.isConnected && workspace.isWritable(p.id) &&
    Boolean(workspace.configFor(p.id)?.peoplesoftOperatorId?.trim()));
  if (writable.length === 0) {
    vscode.window.showWarningMessage('Connect to a database whose Access is Writable, with an Operator ID (PeopleSoft Studio Settings), first.');
    return undefined;
  }
  return writable.length === 1 ? writable[0] : (await vscode.window.showQuickPick(
    writable.map((p) => ({ label: p.displayName, provider: p })), { title, placeHolder: 'Connection' }))?.provider;
}

/** A new definition's name, asked for; undefined when cancelled. */
async function askDefinitionName(title: string, maxLength: number, prompt: string): Promise<string | undefined> {
  return (await vscode.window.showInputBox({
    title, value: writeNamePrefix(), prompt,
    validateInput: (v) => {
      const n = v.trim().toUpperCase();
      if (!new RegExp(`^[A-Z0-9_]{1,${maxLength}}$`).test(n)) return `A-Z, 0-9 and _, at most ${maxLength} characters.`;
      return writeScopeRefusal(n);
    }
  }))?.trim().toUpperCase();
}

/**
 * App Designer's File > New > Record: the record editor opens with no
 * fields; insert fields, set keys, and the first save creates the record
 * (recordWriter.ts createRecord).
 */
async function newRecord(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Record');
  if (!provider) return;
  const type = (await vscode.window.showQuickPick(
    [{ label: 'SQL Table', type: RecordType.Table }, { label: 'Derived/Work', type: RecordType.DerivedWork }],
    { title: 'New Record', placeHolder: 'Record type (the others cannot be created here yet)' }))?.type;
  if (type === undefined) return;
  const name = await askDefinitionName(`New Record on ${provider.displayName}`, 15, 'Record name (at most 15 characters)');
  if (!name) return;
  // A name deleted before is free again: saving removes its deletion marker, as App Designer does (r47).
  if (await provider.recordNameStatus(name) === 'exists') {
    vscode.window.showWarningMessage(`A record named ${name} already exists.`);
    return;
  }
  const uri = toUri(provider.id, makeKey(DefinitionType.Record, name));
  RecordEditorProvider.pendingNew.set(uri.toString(), type);
  await vscode.commands.executeCommand('vscode.openWith', uri, RecordEditorProvider.viewType);
  vscode.window.showInformationMessage(`${name} is new: insert its fields (right-click > Insert Field), then save to create it.`);
}

/** App Designer's File > New > Application Package and its first save: an empty root package (packageWriter.ts). */
async function newPackage(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Application Package');
  if (!provider) return;
  const name = await askDefinitionName(`New Application Package on ${provider.displayName}`, 30, 'Package name');
  if (!name) return;
  if (await provider.packageExists(name)) {
    vscode.window.showWarningMessage(`A package named ${name} already exists.`);
    return;
  }
  try {
    await provider.createPackage({ name, operatorId: workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim() });
  } catch (error) {
    if (!(error instanceof PackageCreateRefusedError)) throw error;
    vscode.window.showWarningMessage(`${name} was not created: ${error.message}`);
    return;
  }
  void vscode.commands.executeCommand('psft.refresh');
  const add = await vscode.window.showInformationMessage(`Created Application Package ${name} on ${provider.displayName}.`, 'Add a Class');
  if (add) await newClass(workspace, provider, name);
}

/**
 * App Designer's Insert Application Class, in a root package: the editor
 * opens with the class's declaration and the first save creates it --
 * PSAPPCLASSDEFN, the program, and the package's new version (case c04).
 */
async function newClass(workspace: Workspace, chosen?: DatabaseProvider, packageRoot?: string): Promise<void> {
  const provider = chosen ?? await pickWritableConnection(workspace, 'New Application Class');
  if (!provider) return;
  // ROOT, ROOT:SUB or ROOT:SUB:SUB2 -- subpackages that do not exist yet are created with the class (c05).
  const path = (await vscode.window.showInputBox({
    title: `New Application Class on ${provider.displayName}`, value: packageRoot ?? writeNamePrefix(),
    prompt: 'Package: ROOT, ROOT:SUB or ROOT:SUB:SUB2 (new subpackages are created with the class)',
    validateInput: (v) => {
      const [root, ...subs] = v.trim().split(':');
      if (!/^[A-Z0-9_]{1,30}$/.test(root.toUpperCase())) return 'The root package name: A-Z, 0-9 and _, at most 30 characters.';
      const scope = writeScopeRefusal(root.toUpperCase());
      if (scope) return scope;
      if (subs.length > 2) return 'At most two subpackages deep.';
      return subs.every((p) => /^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(p)) ? undefined : 'Subpackage names: a letter, then letters, digits or _.';
    }
  }))?.trim();
  if (!path) return;
  const [rootName, ...subs] = path.split(':');
  const root = rootName.toUpperCase();
  if (!(await provider.packageExists(root))) {
    vscode.window.showWarningMessage(`There is no Application Package ${root}. Create it first (New Definition > Application Package).`);
    return;
  }
  const className = (await vscode.window.showInputBox({
    title: `New class in ${[root, ...subs].join(':')}`, prompt: 'Class name',
    validateInput: (v) => (/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(v.trim()) ? undefined : 'A letter, then letters, digits or _; at most 30.')
  }))?.trim();
  if (!className) return;
  const key = makeKey(DefinitionType.ApplicationClassPeopleCode, root, ...subs, className, 'OnExecute');
  const qualified = [root, ...subs, className].join(':');
  if (await provider.hasPeopleCode(key)) {
    vscode.window.showWarningMessage(`${qualified} already exists; opening it.`);
  } else {
    PeopleSoftFileSystem.newClasses.add(toUri(provider.id, key).toString());
  }
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(toUri(provider.id, key)), { preview: false });
  vscode.window.showInformationMessage(`${qualified} is new: write its members, then save to create it.`);
}

/**
 * App Designer's File > New > Component and its first save (case c01): a page
 * inserted, a search record set -- a component is never saved without one --
 * and Save As. Created with App Designer's defaults (componentWriter.ts:
 * Update/Display, Include in Navigation), then opened to edit the rest.
 */
async function newComponent(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Component');
  if (!provider) return;
  const name = await askDefinitionName(`New Component on ${provider.displayName}`, 18, 'Component name (at most 18 characters)');
  if (!name) return;
  const market = (await vscode.window.showInputBox({
    title: `New Component ${name}`, prompt: 'Market', value: 'GBL',
    validateInput: (v) => (/^[A-Z0-9]{1,3}$/.test(v.trim().toUpperCase()) ? undefined : 'Up to 3 letters or digits (GBL, USA ...).')
  }))?.trim().toUpperCase();
  if (!market) return;
  if (await provider.componentExists(name, market)) {
    vscode.window.showWarningMessage(`A component ${name}.${market} already exists.`);
    return;
  }
  const searchRecord = (await vscode.window.showInputBox({
    title: `New Component ${name}.${market}`, prompt: 'Search record (required: a component is not saved without one)', ignoreFocusOut: true,
    validateInput: async (v) => {
      const r = v.trim().toUpperCase();
      if (!r) return 'A component needs a search record.';
      return (await provider.recordNameStatus(r)) === 'exists' ? undefined : `There is no record named ${r}.`;
    }
  }))?.trim().toUpperCase();
  if (!searchRecord) return;
  const page = (await vscode.window.showInputBox({
    title: `New Component ${name}.${market}`, prompt: 'Its first page (Insert > Page into Component adds more)', ignoreFocusOut: true,
    validateInput: async (v) => {
      const p = v.trim().toUpperCase();
      if (!p) return 'A component starts with a page.';
      return (await provider.pageInfo(p)) ? undefined : `There is no page named ${p}.`;
    }
  }))?.trim().toUpperCase();
  if (!page) return;
  const description = await vscode.window.showInputBox({ title: `New Component ${name}.${market}`, prompt: 'Description (optional, at most 30)',
    validateInput: (v) => (v.trim().length <= 30 ? undefined : 'At most 30 characters.') });
  if (description === undefined) return;
  try {
    await provider.saveComponent({
      name, market, operatorId: workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim(),
      items: [{ pageName: page, itemName: page, itemLabel: defaultItemLabel(page), folderTabLabel: '', hidden: false }],
      properties: {
        description, comments: '', searchRecord, addSearchRecord: '', detailPage: '', forceSearch: false,
        actions: { ...NEW_COMPONENT_ACTIONS }, disableSave: false, includeInNavigation: true
      }
    });
  } catch (error) {
    if (!(error instanceof ComponentSaveRefusedError)) throw error;
    vscode.window.showWarningMessage(`${name}.${market} was not created: ${error.message}`);
    return;
  }
  void vscode.commands.executeCommand('psft.refresh');
  vscode.window.showInformationMessage(`Created component ${name}.${market} on ${provider.displayName}.`);
  await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Component, name, market));
}

/**
 * A property panel's lookups: an image's format, pixel size and picture (Static Image's Image group), a Message
 * Catalog entry's text (an alt tag or popup from the catalog), an image definition picked from the list (the ... button),
 * a field's labels (a Group Box's Label ID), an Edit Box field's prompt table / format family / display names, and the
 * Popup Pages (an Edit Box's Mouse Over Popup).
 */
async function pageLookup(provider: DatabaseProvider, request: PageLookup): Promise<unknown> {
  switch (request.what) {
    case 'image': {
      const image = await provider.readImage(makeKey(DefinitionType.Image, request.name.trim().toUpperCase()));
      const first = image?.alternates[0];
      if (!image || !first) return undefined;
      const size = imageDimensions(first.bytes);
      const type = sniffImageMimeType(first.bytes) ?? imageMimeType(first.format);
      return { format: image.format.toUpperCase(), ...(size ?? {}), dataUri: `data:${type};base64,${first.bytes.toString('base64')}` };
    }
    case 'message': {
      const hits = await provider.search({ type: DefinitionType.MessageCatalog, namePattern: `${request.set}.${request.num}`, limit: 5 });
      return hits.find((h) => h.key.parts[0] === String(request.set) && h.key.parts[1] === String(request.num))?.description ?? '';
    }
    case 'richTextChoices':
      return provider.richTextChoices();
    case 'fieldLabels':
      return request.field.trim() ? provider.fieldLabels(request.field) : [];
    case 'editBoxField':
      return request.field.trim() ? provider.editBoxField(request.record, request.field) : { promptTable: false, formatFamily: '', displayNames: [] };
    case 'popupPages':
      return provider.popupPages();
    case 'pickImage': {
      const images = await provider.search({ type: DefinitionType.Image, namePattern: '%', limit: 100000 });
      const pick = await vscode.window.showQuickPick(images.map((i) => ({ label: i.key.parts[0], description: i.description ?? '', picked: i.key.parts[0] === request.current })),
        { title: 'Image ID', placeHolder: 'An image definition', matchOnDescription: true });
      return pick?.label;
    }
  }
}

/**
 * The page window for a page, editable on a Writable connection with an
 * operator when the name is in the write scope. A new page (New Page) is not
 * in the database yet: its first Save creates it (pageWriter.ts createPage),
 * refused until it has a control, and later Saves save it.
 */
async function showPageEditor(workspace: Workspace, provider: DatabaseProvider, key: DefinitionKey, layout: PageLayout, order: string, isNew = false): Promise<void> {
  const pnlName = key.parts[0];
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const editable = workspace.isWritable(provider.id) && !!operatorId && !writeScopeRefusal(pnlName);
  let openedVersion = layout.version;
  let created = !isNew;
  // The Page Properties lists; the page still opens without them.
  const choices = await provider.pagePropertyChoices().catch(() => undefined);
  PagePanel.show({ id: provider.id, displayName: provider.displayName }, key, layout, order, {
    editable,
    ...(isNew ? { status: 'New page: add a control, then Save to create it' } : {}),
    ...(choices ? { choices } : {}),
    viewPeopleCode: async () => { await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.PagePeopleCode, pnlName, 'Activate')); },
    lookup: (request) => pageLookup(provider, request),
    ...(editable ? {
      save: async (controls, properties, order) => {
        if (!created) {
          const result = await saveAnyway((saveInvalid) => provider.createPage({ pnlName, operatorId: operatorId!, controls, ...(properties ? { properties } : {}), ...(saveInvalid ? { saveInvalid } : {}) }));
          created = true;
          openedVersion = result.version;
          void vscode.commands.executeCommand('psft.refresh');
          vscode.window.showInformationMessage(`Created page ${pnlName} on ${provider.displayName}.`);
          return { version: result.version, layout: (await provider.readPageLayout(key)).layout };
        }
        const result = await saveAnyway((saveInvalid) => provider.savePage({ pnlName, openedVersion, operatorId: operatorId!, controls,
          ...(properties ? { properties } : {}), ...(order ? { order } : {}), ...(saveInvalid ? { saveInvalid } : {}) }));
        openedVersion = result.version;
        // Added and pasted controls only get their PNLFLDIDs from the database: redraw from it.
        if (result.inserted > 0) return { version: result.version, layout: (await provider.readPageLayout(key)).layout };
        return { version: result.version };
      }
    } : {})
  });
}

/**
 * A page save that fails App Designer's checks shows its messages and asks, as App Designer does: "Invalid page. Do you
 * still want to save the page?" (46,2). Save Anyway saves it; otherwise nothing is written.
 */
async function saveAnyway<T>(save: (saveInvalid: boolean) => Promise<T>): Promise<T> {
  try {
    return await save(false);
  } catch (err) {
    if (!(err instanceof PageInvalidError)) throw err;
    const yes = 'Save Anyway';
    const answer = await vscode.window.showWarningMessage('Invalid page. Do you still want to save the page?', {
      modal: true, detail: err.problems.map((p) => `${p.text} (${p.set},${p.num})`).join('\n')
    }, yes);
    if (answer !== yes) throw new Error(`Not saved: ${err.problems.map((p) => p.text).join(' ')}`);
    return save(true);
  }
}

async function queryTarget(provider: DatabaseProvider, operator: string): Promise<{name:string;owner:string}|undefined> {
  const name=await vscode.window.showInputBox({title:'Save PS Query As',prompt:'New query name',ignoreFocusOut:true,
    validateInput:value=>!/^[A-Z][A-Z0-9_]*$/.test(value.trim().toUpperCase())?'Use letters, digits and underscores, starting with a letter.':writeScopeRefusal(value.trim().toUpperCase())});
  if(!name)return;
  const visibility=await vscode.window.showQuickPick(['Private','Public'],{title:'Query visibility'});if(!visibility)return;
  const target={name:name.trim().toUpperCase(),owner:visibility==='Private'?operator:''};
  if(await provider.readQueryDocument(target.name,target.owner))throw new Error('A query with that name and owner already exists.');
  return target;
}

/** Host-owned Query document. Unsupported definitions retain their readable native grids. */
async function showQueryDesigner(workspace: Workspace, provider: DatabaseProvider, key: DefinitionKey, initial?: QueryEdit): Promise<void> {
  const edit=initial ?? (provider.platform==='oracle'?await provider.readQueryDocument(key.parts[0],key.parts[1] ?? ''):await provider.readQueryDefinition(key).then(view=>({view,token:queryToken(view)})));
  if(!edit)throw new Error('Query not found.');
  const operator=workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim() ?? '';
  const metadata: Record<string,QueryFieldInfo & import('./editors/queryDesignerHtml.js').QueryFieldMetadata>={};
  let basic=false;
  if(edit.view.records.length===1){
    const record=await provider.readRecordLayout(makeKey(DefinitionType.Record,String(edit.view.records[0].RECNAME).trim()));
    if(record){
      basic=record.recordType===RecordType.Table && !record.fields.some(f=>f.isSubrecord);
      for(const f of record.fields)if(f.type!==undefined && f.length!==undefined)metadata[f.name]={
        type:f.type,length:f.length,decimalPositions:f.decimalPositions??0,format:f.format??0,
        shortName:f.shortName,longName:f.longName,editTable:f.editTable,useEdit:f.useEdit,labels:f.labels??[{id:'',shortName:f.shortName,longName:f.longName,isDefault:true}]};
    }
  }
  if(edit.token!=='absent')try{await provider.prepareQuery(edit.view,operator);}catch{basic=false;}
  const editable=basic && workspace.isWritable(provider.id) && !!operator && !writeScopeRefusal(key.parts[0]);
  await QueryDesignerPanel.show(provider,edit,{
    editable,metadata,
    prepare:view=>provider.prepareQuery(view,operator),
    run:(view,values,limit)=>provider.runQuery(view,operator,values,limit),
    save:(view,token)=>provider.saveQueryDocument({view,openedToken:token,operatorId:operator}),
    reload:()=>provider.platform==='oracle'?provider.readQueryDocument(key.parts[0],key.parts[1]??''):provider.readQueryDefinition(key).then(view=>({view,token:queryToken(view)})),
    saveAs:async view=>{
      const target=await queryTarget(provider,operator);if(!target)return;
      const copy=copyQueryDocument(view,target.name,target.owner);
      await showQueryDesigner(workspace,provider,makeKey(DefinitionType.Query,target.name,target.owner),{view:copy,token:'absent'});
    }
  });
}

/**
 * An App Engine program in the App Engine Designer (editors/aeDesignerPanel.ts):
 * editable on a Writable connection with an Operator ID, for a name in the
 * write scope; read-only otherwise. `doc` opens a new, unsaved program.
 */
export async function showAeDesigner(workspace: Workspace, provider: DatabaseProvider, name: string, doc?: AeDocument): Promise<void> {
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const editable = workspace.isWritable(provider.id) && !!operatorId && !writeScopeRefusal(name);
  const read = doc ? { doc, token: 'absent' } : await provider.readAppEngineDocument(name);
  if (!read) throw new Error(`No App Engine program named ${name}.`);
  AeDesignerPanel.show({
    connection: { id: provider.id, displayName: provider.displayName },
    ...(editable ? {
      save: async (d: AeDocument, token: string, dryRun?: boolean) => {
        const result = await provider.saveAppEngineDocument({ doc: d, openedToken: token, operatorId: operatorId!, ...(dryRun ? { dryRun } : {}) });
        if (result.written && token === 'absent') void vscode.commands.executeCommand('psft.refresh');
        return result;
      }
    } : {}),
    reload: () => provider.readAppEngineDocument(name),
    lookup: provider.appEngineReferenceLookup(),
    choices: (what, prefix) => provider.appEngineChoices(what, prefix),
    toolsRelease: async () => (await provider.readEnvironment()).toolsRelease,
    openProgram: async (program) => { await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.AppEngineProgram, program)); },
    ...(editable ? {
      saveAs: async (d: AeDocument, to: string) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        if (await provider.readAppEngineDocument(to)) throw new Error(`An App Engine program named ${to} already exists.`);
        await provider.saveAppEngineDocument({ doc: copyAeProgram(d, to), openedToken: 'absent', operatorId: operatorId! });
        void vscode.commands.executeCommand('psft.refresh');
        await showAeDesigner(workspace, provider, to);
      },
      rename: async (from: string, to: string, token: string) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        await provider.renameAppEngineProgram(from, to, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        await showAeDesigner(workspace, provider, to);
      },
      remove: async (program: string, token: string) => {
        await provider.deleteAppEngineProgram(program, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        vscode.window.showInformationMessage(`Deleted App Engine program ${program} on ${provider.displayName}.`);
      }
    } : {})
  }, read.doc, read.token, doc ? { status: 'New program: Save creates it.' } : {});
}

/** File > New > App Engine Program: a name, then the designer on App Designer's new program (MAIN, Step01). */
async function newAppEngine(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New App Engine Program');
  if (!provider) return;
  const name = await askDefinitionName(`New App Engine Program on ${provider.displayName}`, PROGRAM_NAME_MAX, `Program name (at most ${PROGRAM_NAME_MAX} characters)`);
  if (!name) return;
  if (await provider.readAppEngineDocument(name)) {
    vscode.window.showWarningMessage(`An App Engine program named ${name} already exists.`);
    return;
  }
  const refusal = writeScopeRefusal(name);
  if (refusal) { vscode.window.showWarningMessage(refusal); return; }
  await showAeDesigner(workspace, provider, name, newAeProgram(name));
}

/**
 * A menu in the Menu Designer (editors/menuDesignerPanel.ts): editable on a
 * Writable connection with an Operator ID, for a name in the write scope;
 * read-only otherwise. `doc` opens a new, unsaved menu.
 */
export async function showMenuDesigner(workspace: Workspace, provider: DatabaseProvider, name: string, doc?: MenuDocument): Promise<void> {
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const editable = workspace.isWritable(provider.id) && !!operatorId && !writeScopeRefusal(name);
  const read = doc ? { doc, token: 'absent' } : await provider.readMenuDocument(name);
  if (!read) throw new Error(`No menu named ${name}.`);
  MenuDesignerPanel.show({
    connection: { id: provider.id, displayName: provider.displayName },
    ...(editable ? {
      save: async (d: MenuDocument, token: string, dryRun?: boolean) => {
        const result = await provider.saveMenuDocument({ doc: d, openedToken: token, operatorId: operatorId!, ...(dryRun ? { dryRun } : {}) });
        if (result.written && token === 'absent') void vscode.commands.executeCommand('psft.refresh');
        return result;
      }
    } : {}),
    reload: () => provider.readMenuDocument(name),
    lookup: provider.menuReferenceLookup(),
    choices: (what, arg) => provider.menuChoices(what, arg),
    toolsRelease: async () => (await provider.readEnvironment()).toolsRelease,
    openComponent: async (component, market) => { await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Component, component, market)); },
    ...(editable ? {
      saveAs: async (d: MenuDocument, to: string, withPeopleCode: boolean) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        if (await provider.readMenuDocument(to)) throw new Error(`A menu named ${to} already exists.`);
        await provider.saveMenuDocument({ doc: copyMenu(d, to, withPeopleCode), openedToken: 'absent', operatorId: operatorId! });
        void vscode.commands.executeCommand('psft.refresh');
        await showMenuDesigner(workspace, provider, to);
      },
      rename: async (from: string, to: string, token: string) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        await provider.renameMenuDefinition(from, to, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        await showMenuDesigner(workspace, provider, to);
      },
      remove: async (menu: string, token: string) => {
        await provider.deleteMenuDefinition(menu, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        vscode.window.showInformationMessage(`Deleted menu ${menu} on ${provider.displayName}.`);
      }
    } : {})
  }, read.doc, read.token, doc ? { status: 'New menu: Save creates it, once it has an item.' } : {});
}

/** The CI Designer on an interface (or a new one: its first Save creates it). */
export async function showCiDesigner(workspace: Workspace, provider: DatabaseProvider, name: string, made?: { doc: CiDocument; buffer: import('./model/ciDocument.js').CiBuffer }): Promise<void> {
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const editable = workspace.isWritable(provider.id) && !!operatorId && !writeScopeRefusal(name);
  const read = made ? { doc: made.doc, token: 'absent', buffer: made.buffer } : await provider.readCiDocument(name);
  if (!read) throw new Error(`No Component Interface named ${name}.`);
  const pcKey = (ci: string) => makeKey(DefinitionType.ComponentInterfacePeopleCode, ci, 'Methods');
  CiDesignerPanel.show({
    connection: { id: provider.id, displayName: provider.displayName },
    ...(editable ? {
      save: async (d: CiDocument, token: string, dryRun?: boolean) => {
        const result = await provider.saveCiDocument({ doc: d, openedToken: token, operatorId: operatorId!, ...(dryRun ? { dryRun } : {}) });
        if (result.written && token === 'absent') void vscode.commands.executeCommand('psft.refresh');
        return result;
      }
    } : {}),
    reload: () => provider.readCiDocument(name),
    choices: (what, arg) => provider.ciChoices(what, arg),
    userMethods: async () => {
      const pc = await provider.readPeopleCodeForEdit(pcKey(name)).catch(() => undefined);
      return [...(pc?.text ?? '').matchAll(/^\s*Function\s+([A-Za-z_][A-Za-z0-9_]*)/gim)].map((m) => m[1]);
    },
    openPeopleCode: async (ci) => { await vscode.commands.executeCommand('psft.openDefinition', provider.id, pcKey(ci)); },
    openRecord: async (record) => { await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Record, record)); },
    openComponent: async (component, market) => { await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Component, component, market)); },
    ...(editable ? {
      saveAs: async (d: CiDocument, to: string, withPeopleCode: boolean) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        if (await provider.readCiDocument(to)) throw new Error(`A Component Interface named ${to} already exists.`);
        await provider.saveCiDocument({ doc: copyCi(d, to), openedToken: 'absent', operatorId: operatorId!, ...(withPeopleCode ? { copyPeopleCodeFrom: d.name } : {}) });
        void vscode.commands.executeCommand('psft.refresh');
        await showCiDesigner(workspace, provider, to);
      },
      rename: async (from: string, to: string, token: string) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        await provider.renameCiDefinition(from, to, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        await showCiDesigner(workspace, provider, to);
      },
      remove: async (ci: string, token: string) => {
        await provider.deleteCiDefinition(ci, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        vscode.window.showInformationMessage(`Deleted Component Interface ${ci} on ${provider.displayName}.`);
      }
    } : {})
  }, read.doc, read.token, read.buffer, made ? { status: 'New Component Interface: Save creates it.' } : {});
}

/**
 * File > New > Component Interface: the source component (App Designer's "Select source Component for Component
 * Interface"), "Do you want to default the properties based on the underlying Component definition? (123,12)",
 * then a name and the designer -- App Designer asks the name at the first Save; here before, to open the window.
 */
async function newComponentInterface(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Component Interface');
  if (!provider) return;
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { component?: string; market?: string }>();
  qp.title = 'Select source Component for Component Interface';
  qp.placeholder = 'Component name (type to search)';
  let timer: NodeJS.Timeout | undefined;
  qp.onDidChangeValue((v) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (v.trim().length < 2) return;
      qp.busy = true;
      const rows = await provider.ciChoices('components', v.trim()).catch(() => []);
      qp.items = rows.map((r) => ({ label: r.value, description: r.label, component: r.value, market: r.label ?? 'GBL' }));
      qp.busy = false;
    }, 250);
  });
  const picked = await new Promise<(vscode.QuickPickItem & { component?: string; market?: string }) | undefined>((resolve) => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]); qp.hide(); });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  qp.dispose();
  if (!picked?.component) return;
  const answer = await vscode.window.showInformationMessage(
    `Do you want to default the properties based on the underlying Component definition, ${picked.component}? (123,12)`, { modal: true }, 'Yes', 'No');
  if (!answer) return;
  const name = await askDefinitionName(`New Component Interface on ${picked.component}.${picked.market}`, 30, 'Component Interface name (at most 30 characters)');
  if (!name) return;
  if (await provider.readCiDocument(name)) { vscode.window.showWarningMessage(`A Component Interface named ${name} already exists.`); return; }
  const refusal = writeScopeRefusal(name);
  if (refusal) { vscode.window.showWarningMessage(refusal); return; }
  const made = await provider.newCiDocument(name, picked.component, picked.market ?? 'GBL', answer === 'Yes');
  await showCiDesigner(workspace, provider, name, made);
}

/**
 * A message channel in its window (editors/channelDesignerPanel.ts): editable on a Writable connection with an
 * Operator ID, for a name in the write scope; read-only otherwise. `doc` opens a new, unsaved channel.
 */
export async function showChannelDesigner(workspace: Workspace, provider: DatabaseProvider, name: string, doc?: ChannelDocument): Promise<void> {
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const editable = workspace.isWritable(provider.id) && !!operatorId && !writeScopeRefusal(name);
  const read = doc ? { doc, token: 'absent' } : await provider.readChannelDocument(name);
  if (!read) throw new Error(`No message channel named ${name}.`);
  ChannelDesignerPanel.show({
    connection: { id: provider.id, displayName: provider.displayName },
    ...(editable ? {
      save: async (d: ChannelDocument, token: string, dryRun?: boolean) => {
        const result = await provider.saveChannelDocument({ doc: d, openedToken: token, operatorId: operatorId!, ...(dryRun ? { dryRun } : {}) });
        if (result.written && token === 'absent') void vscode.commands.executeCommand('psft.refresh');
        return result;
      }
    } : {}),
    reload: () => provider.readChannelDocument(name),
    lookup: provider.channelReferenceLookup(),
    choices: (what, arg) => provider.channelChoices(what, arg),
    openMessage: async (message) => { await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.IbMessage, message)); },
    ...(editable ? {
      saveAs: async (d: ChannelDocument, to: string) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        if (await provider.readChannelDocument(to)) throw new Error(`A message channel named ${to} already exists.`);
        await provider.saveChannelDocument({ doc: copyChannel(d, to), openedToken: 'absent', operatorId: operatorId! });
        void vscode.commands.executeCommand('psft.refresh');
        await showChannelDesigner(workspace, provider, to);
      },
      rename: async (from: string, to: string, token: string) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        await provider.renameChannelDefinition(from, to, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        await showChannelDesigner(workspace, provider, to);
      },
      remove: async (channel: string, token: string) => {
        await provider.deleteChannelDefinition(channel, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        vscode.window.showInformationMessage(`Deleted message channel ${channel} on ${provider.displayName}.`);
      }
    } : {})
  }, read.doc, read.token, doc ? { status: 'New message channel: Save creates it.' } : {});
}

/**
 * A File Layout in its window (editors/fileLayoutDesignerPanel.ts): editable on a Writable Oracle connection with an
 * Operator ID, for a name in the write scope; read-only otherwise. `doc` opens a new, unsaved layout.
 */
export async function showFileLayoutDesigner(workspace: Workspace, provider: DatabaseProvider, name: string, doc?: FileLayoutDocument): Promise<void> {
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const editable = provider.platform === 'oracle' && workspace.isWritable(provider.id) && !!operatorId && !writeScopeRefusal(name);
  const read = doc ? { doc, token: 'absent' } : await provider.readFileLayoutDocument(name);
  if (!read) throw new Error(`No File Layout named ${name}.`);
  FileLayoutDesignerPanel.show({
    connection: { id: provider.id, displayName: provider.displayName },
    ...(editable ? {
      save: async (d: FileLayoutDocument, token: string, dryRun?: boolean) => {
        const result = await provider.saveFileLayoutDocument({ doc: d, openedToken: token, operatorId: operatorId!, ...(dryRun ? { dryRun } : {}) });
        if (result.written && token === 'absent') void vscode.commands.executeCommand('psft.refresh');
        return result;
      },
      saveAs: async (d: FileLayoutDocument, to: string) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        if (await provider.readFileLayoutDocument(to)) throw new Error(`A File Layout named ${to} already exists.`);
        await provider.saveFileLayoutDocument({ doc: copyLayout(d, to), openedToken: 'absent', operatorId: operatorId! });
        void vscode.commands.executeCommand('psft.refresh');
        await showFileLayoutDesigner(workspace, provider, to);
      },
      rename: async (from: string, to: string, token: string) => {
        const refusal = writeScopeRefusal(to);
        if (refusal) throw new Error(refusal);
        await provider.renameFileLayoutDefinition(from, to, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        await showFileLayoutDesigner(workspace, provider, to);
      },
      remove: async (layout: string, token: string) => {
        await provider.deleteFileLayoutDefinition(layout, token, operatorId!);
        void vscode.commands.executeCommand('psft.refresh');
        vscode.window.showInformationMessage(`Deleted File Layout ${layout} on ${provider.displayName}.`);
      }
    } : {}),
    reload: async () => provider.readFileLayoutDocument(name),
    recordFields: (record: string) => provider.fileLayoutRecordFields(record)
  }, read.doc, read.token, doc ? { status: 'New File Layout (FIXED): Insert Record… builds a segment from a record; Save creates it.' } : {});
}

/** File > New > File Layout: a name (App Designer asks it at the first Save; here before, to open the window), then the window. */
async function newFileLayout(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New File Layout');
  if (!provider) return;
  const name = await askDefinitionName(`New File Layout on ${provider.displayName}`, 30, 'File Layout name (at most 30 characters)');
  if (!name) return;
  if (await provider.readFileLayoutDocument(name)) {
    vscode.window.showWarningMessage(`A File Layout named ${name} already exists.`);
    return;
  }
  const refusal = writeScopeRefusal(name);
  if (refusal) { vscode.window.showWarningMessage(refusal); return; }
  await showFileLayoutDesigner(workspace, provider, name, newLayout(name));
}

/** File > New > Message Channel: a name (App Designer asks it at the first Save; here before, to open the window), then the window. */
async function newMessageChannel(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Message Channel');
  if (!provider) return;
  const name = await askDefinitionName(`New Message Channel on ${provider.displayName}`, CHANNEL_NAME_MAX, `Message channel name (at most ${CHANNEL_NAME_MAX} characters)`);
  if (!name) return;
  if (await provider.readChannelDocument(name)) {
    vscode.window.showWarningMessage(`A message channel named ${name} already exists.`);
    return;
  }
  const refusal = writeScopeRefusal(name);
  if (refusal) { vscode.window.showWarningMessage(refusal); return; }
  await showChannelDesigner(workspace, provider, name, await provider.newChannelDocument(name));
}

/** File > New > Menu: Standard or Popup (App Designer's New Menu dialog), a name, then the designer. */
async function newMenu(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Menu');
  if (!provider) return;
  const type = await vscode.window.showQuickPick([{ label: 'Standard', type: 0 as const }, { label: 'Popup', type: 1 as const }], { title: 'New Menu', placeHolder: 'Menu Type' });
  if (!type) return;
  const name = await askDefinitionName(`New ${type.label} Menu on ${provider.displayName}`, MENU_NAME_MAX, `Menu name (at most ${MENU_NAME_MAX} characters)`);
  if (!name) return;
  if (await provider.readMenuDocument(name)) {
    vscode.window.showWarningMessage(`A menu named ${name} already exists.`);
    return;
  }
  const refusal = writeScopeRefusal(name);
  if (refusal) { vscode.window.showWarningMessage(refusal); return; }
  await showMenuDesigner(workspace, provider, name, newMenuDocument(name, type.type));
}

/** File > New > Page: a name, then the page window on an empty page (App Designer's new page: 570 x 330, Fluid off). */
async function newPage(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Page');
  if (!provider) return;
  const name = await askDefinitionName(`New Page on ${provider.displayName}`, 18, 'Page name (at most 18 characters)');
  if (!name) return;
  if (await provider.pageInfo(name)) {
    vscode.window.showWarningMessage(`A page named ${name} already exists.`);
    return;
  }
  const refusal = writeScopeRefusal(name);
  if (refusal) { vscode.window.showWarningMessage(refusal); return; }
  const layout = buildPageLayout(name, { page: { PNLNAME: name, VERSION: 0, ...NEW_PAGE }, fields: [], components: [] });
  await showPageEditor(workspace, provider, makeKey(DefinitionType.Page, name), layout, '', true);
}

/**
 * New Page Fluid: App Designer's Choose Layout Page list (every Layout Page),
 * a name, and its "save the PeopleCode too?" question; the page is created
 * as a copy of the Layout Page (n02-page-new-fluid), Fluid Page on, and opened.
 */
async function newPageFluid(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Page Fluid');
  if (!provider) return;
  const layouts = await provider.layoutPages();
  if (!layouts.length) { vscode.window.showWarningMessage(`${provider.displayName} has no Layout Pages to start from.`); return; }
  const picked = await vscode.window.showQuickPick(layouts.map((l) => ({ label: l.name, description: 'Layout Page', detail: l.description || undefined })),
    { title: 'Choose Layout Page', placeHolder: 'The Layout Page the new Fluid page starts from', matchOnDescription: true, matchOnDetail: true });
  if (!picked) return;
  const name = await askDefinitionName(`New Page Fluid on ${provider.displayName} (from ${picked.label})`, 18, 'Page name (at most 18 characters)');
  if (!name) return;
  if (await provider.pageInfo(name)) {
    vscode.window.showWarningMessage(`A page named ${name} already exists.`);
    return;
  }
  const operatorId = workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim();
  // App Designer's Save As asks whether to save the source's PeopleCode with the copy.
  const answer = await vscode.window.showInformationMessage(`Do you want to save PeopleCode from ${picked.label}?`, { modal: true }, 'Yes', 'No');
  if (!answer) return;
  try {
    await provider.createPage({ pnlName: name, operatorId, template: picked.label });
  } catch (error) {
    if (!(error instanceof PageSaveRefusedError)) throw error;
    vscode.window.showWarningMessage(`${name} was not created: ${error.message}`);
    return;
  }
  let note = '';
  if (answer === 'Yes') {
    const source = await provider.readPeopleCodeForEdit(makeKey(DefinitionType.PagePeopleCode, picked.label, 'Activate'));
    if (!source) note = ` ${picked.label} has no page PeopleCode to copy.`;
    else {
      try {
        await provider.savePeopleCode(makeKey(DefinitionType.PagePeopleCode, name, 'Activate'), { source: source.text, openedFingerprint: 'absent', operatorId });
        note = ` Its Activate PeopleCode was saved too.`;
      } catch (error) {
        note = ` Its PeopleCode was not copied: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
  void vscode.commands.executeCommand('psft.refresh');
  vscode.window.showInformationMessage(`Created page ${name} from ${picked.label} on ${provider.displayName}.${note}`);
  await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Page, name));
}

/** App Designer's File > New > Project and its first save: an empty project (projectWriter.ts createProject), opened. */
async function newProject(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Project');
  if (!provider) return;
  const name = await askDefinitionName(`New Project on ${provider.displayName}`, 30, 'Project name');
  if (!name) return;
  if (await provider.projectExists(name)) {
    vscode.window.showWarningMessage(`A project named ${name} already exists.`);
    return;
  }
  try {
    await provider.createProject({ project: name, operatorId: workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim() });
  } catch (error) {
    if (!(error instanceof ProjectSaveRefusedError)) throw error;
    vscode.window.showWarningMessage(`${name} was not created: ${error.message}`);
    return;
  }
  vscode.window.showInformationMessage(`Created project ${name} on ${provider.displayName}. Add definitions with Insert Into Project.`);
  await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Project, name));
}

/**
 * App Designer's File > New > Field, as a few prompts: type, name, length
 * (and decimals), label. Finishing creates the field (fieldWriter.ts) and
 * opens it.
 */
async function newField(workspace: Workspace): Promise<void> {
  const provider = await pickWritableConnection(workspace, 'New Field');
  if (!provider) return;
  const type = (await vscode.window.showQuickPick(CREATABLE_FIELD_TYPES.map((t) => ({ label: FIELD_TYPE_LABELS[t] ?? String(t), type: t })),
    { title: 'New Field', placeHolder: 'Field type' }))?.type;
  if (type === undefined) return;
  const name = await askDefinitionName(`New Field on ${provider.displayName}`, 18, 'Field name (at most 18 characters)');
  if (!name) return;
  if (await provider.fieldExists(name)) {
    vscode.window.showWarningMessage(`A field named ${name} already exists.`);
    return;
  }
  const askNumber = async (prompt: string, value: string, check: (n: number) => string | undefined) => {
    const v = await vscode.window.showInputBox({ title: `New Field ${name}`, prompt, value,
      validateInput: (x) => (/^\d+$/.test(x.trim()) ? check(Number(x.trim())) : 'A whole number.') });
    return v === undefined ? undefined : Number(v.trim());
  };
  const isNumber = type === FieldType.Number || type === FieldType.SignedNumber;
  let length = FIXED_FIELD_LENGTH[type];
  if (length === undefined) {
    length = await askNumber(type === FieldType.LongCharacter ? 'Maximum length (0 for no maximum)' : 'Field length',
      type === FieldType.LongCharacter ? '0' : '10',
      (n) => fieldCreateRefusal({ name, type, length: n, decimalPositions: 0, label: { id: name, longName: 'x', shortName: 'x' } }));
    if (length === undefined) return;
  }
  let decimalPositions = 0;
  if (isNumber) {
    const d = await askNumber('Decimal positions', '0', (n) => (n < length! ? undefined : 'Fewer than the length.'));
    if (d === undefined) return;
    decimalPositions = d;
  }
  const longName = await vscode.window.showInputBox({ title: `New Field ${name}`, prompt: 'Label long name (at most 30)',
    validateInput: (x) => (x.trim() && x.length <= 30 ? undefined : '1 to 30 characters.') });
  if (longName === undefined) return;
  const shortName = await vscode.window.showInputBox({ title: `New Field ${name}`, prompt: 'Label short name (at most 15)',
    value: longName.slice(0, 15), validateInput: (x) => (x.trim() && x.length <= 15 ? undefined : '1 to 15 characters.') });
  if (shortName === undefined) return;
  const operatorId = workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim();
  try {
    await provider.createField({ name, type, length, decimalPositions, label: { id: name, longName, shortName }, operatorId });
  } catch (error) {
    if (!(error instanceof FieldCreateRefusedError)) throw error;
    vscode.window.showWarningMessage(`${name} was not created: ${error.message}`);
    return;
  }
  void vscode.commands.executeCommand('psft.refresh');
  vscode.window.showInformationMessage(`Created field ${name} on ${provider.displayName}.`);
  await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Field, name));
}

type TextDefinitionType = DefinitionType.HtmlDefinition | DefinitionType.StyleSheet | DefinitionType.SqlDefinition;

async function newTextDefinition(workspace: Workspace, type: TextDefinitionType): Promise<void> {
  const what = typeLabel(type).replace(/s$/, '');
  const provider = await pickWritableConnection(workspace, `New ${what}`);
  if (!provider) return;
  const name = await askDefinitionName(`New ${what} on ${provider.displayName}`, 30,
    `Name${type === DefinitionType.StyleSheet ? ' (a freeform style sheet)' : ''}`);
  if (!name) return;
  const key = type === DefinitionType.HtmlDefinition ? makeKey(type, name, '4') : makeKey(type, name);
  const exists = type === DefinitionType.HtmlDefinition ? Boolean(await provider.readHtmlForEdit(key))
    : type === DefinitionType.StyleSheet ? Boolean(await provider.readStyleSheetForEdit(key))
    : await provider.sqlIdTaken(name);
  if (exists) vscode.window.showWarningMessage(`${name} already exists; opening it.`);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(toUri(provider.id, key)), { preview: false });
}

async function withError(action: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    vscode.window.showErrorMessage(`${action} failed: ${(err as Error).message}`);
  }
}
