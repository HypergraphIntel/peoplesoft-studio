import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Workspace, ConnectionConfig, providerId } from './workspace.js';
import { PeopleSoftFileSystem } from './providers/fileSystem.js';
import { ConnectionsView } from './views/connections.js';
import { BrowserView } from './views/browser.js';
import { ProjectsView } from './views/projects.js';
import { RecordEditorProvider } from './editors/recordEditor.js';
import { RecordSaveRefusedError } from './model/recordEdit.js';
import { FieldEditorProvider } from './editors/fieldEditor.js';
import { OpenDefinitionPanel } from './editors/openDefinitionPanel.js';
import { DefinitionKey, DefinitionType, displayName, makeKey, typeLabel } from './model/definitions.js';
import { setWriteNamePrefix, writeNamePrefix, writeScopeRefusal } from './providers/writeScope.js';
import { RECORD_FIELD_EVENTS } from './model/recordEvents.js';
import { FIELD_TYPE_LABELS, FieldType, RecordType } from './model/record.js';
import { PackageCreateRefusedError } from './providers/packageWriter.js';
import { HtmlSaveRefusedError } from './providers/htmlWriter.js';
import { StyleSheetSaveRefusedError } from './providers/styleSheetWriter.js';
import { CREATABLE_FIELD_TYPES, FIXED_FIELD_LENGTH, FieldCreateRefusedError, fieldCreateRefusal } from './providers/fieldWriter.js';
import { toUri } from './util/uri.js';
import type { McpWriteMode } from './mcp/writeTools.js';
import type { PeopleCodeSaveResult } from './providers/peopleCodeWriter.js';
import { registerPeopleCodeCompletion } from './peoplecode/completion.js';
import { registerPeopleCodeHover } from './peoplecode/hover.js';
import { registerPeopleCodeSymbols } from './peoplecode/symbols.js';
import { parseUri } from './util/uri.js';
import { StatusBar } from './views/statusBar.js';
import { selectConnection } from './views/connectionSelection.js';
import { registerSettings } from './settings/index.js';
import { buildProperties, hasProperties } from './model/properties.js';
import { PropertiesPanel } from './editors/propertiesPanel.js';
import { ImagePanel } from './editors/imagePanel.js';
import { AppEnginePanel } from './editors/appEnginePanel.js';
import { PagePanel } from './editors/pagePanel.js';
import { ComponentPanel } from './editors/componentPanel.js';
import { ComponentSaveRefusedError, defaultItemLabel } from './providers/componentWriter.js';
import { NEW_PAGE, PageSaveRefusedError } from './providers/pageWriter.js';
import { buildPageLayout, type PageLayout } from './model/pageLayout.js';
import type { ComponentDefinition } from './model/componentDefinition.js';
import { componentPeopleCodeKey, eventsFor } from './model/componentPeopleCode.js';
import { canInsertIntoProject, describeItem, ProjectSaveRefusedError } from './model/projectItems.js';
import { DatabaseProvider } from './providers/database.js';
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Writes go to every definition unless a name prefix limits them (writeScope.ts).
  setWriteNamePrefix(vscode.workspace.getConfiguration('peoplesoft').get<string>('writeNamePrefix'));
  const workspace = new Workspace(context.secrets);
  workspace.db2DriverDir = path.join(context.globalStorageUri.fsPath, 'db2-driver');
  context.subscriptions.push(workspace);

  const statusBar = new StatusBar(workspace);
  context.subscriptions.push(statusBar);

  const mcpController =
    new McpServerController(
      workspace
    );

  const mcpStatus =
    new McpStatus(
      mcpController
    );

  context.subscriptions.push(
    mcpController,
    mcpStatus
  );

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

  registerPeopleCodeCompletion(context);
  registerPeopleCodeHover(context);
  registerPeopleCodeSymbols(context);

  const connections = new ConnectionsView(workspace);
  const browser = new BrowserView(workspace);
  const projects = new ProjectsView(workspace);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('psft.connections', connections),
    vscode.window.registerTreeDataProvider('psft.browser', browser),
    vscode.window.registerTreeDataProvider('psft.projects', projects)
  );

  const refreshAll = () => { connections.refresh(); browser.refresh(); projects.refresh(); };

  // MCP writes (mcp/writeTools.ts): the setting, the user's approval, and the editors' state.
  mcpController.writeHost = {
    mode: () => vscode.workspace.getConfiguration('peoplesoft.mcp').get<McpWriteMode>('writes', 'confirm'),
    confirm: async ({ title, detail }) => (await vscode.window.showWarningMessage(title, { modal: true, detail }, 'Allow')) === 'Allow',
    hasUnsavedEditor: (connectionId, key) => {
      const uri = toUri(connectionId, key).toString();
      return vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.isDirty &&
        (t.input instanceof vscode.TabInputText || t.input instanceof vscode.TabInputCustom) && t.input.uri.toString() === uri));
    },
    saved: (connectionId, key, peopleCode) => {
      if (peopleCode) {
        void writeSaveReport(key, connectionId, peopleCode).catch((error) => console.error('PeopleSoft Studio: could not write the save report:', error));
      }
      PeopleSoftFileSystem.instance?.invalidate(toUri(connectionId, key));
      refreshAll();
    }
  };
  // A saved record's fields change in the trees too.
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

    vscode.commands.registerCommand('psft.peoplecode.validate', () => {
      vscode.window.showInformationMessage(
        'PeopleCode validate is not implemented yet.');
    }),

    vscode.commands.registerCommand('psft.peoplecode.findReferences', () => {
      vscode.window.showInformationMessage(
        'Find References is not implemented yet.');
    }),

    vscode.commands.registerCommand('psft.sql.run', () => {
      vscode.window.showInformationMessage(
        'Run SQL is not implemented yet.');
    }),

    vscode.commands.registerCommand('psft.html.preview', () => {
      vscode.window.showInformationMessage(
        'HTML preview is not implemented yet.');
    }),

    vscode.commands.registerCommand('psft.record.refresh', async () => {
      await withError('Refreshing record', () =>
        RecordEditorProvider.refreshActive(workspace));
    }),

    vscode.commands.registerCommand('psft.project.build', () => {
      vscode.window.showInformationMessage(
        'Project build (DDL) is not implemented yet. See docs/ROADMAP.md.');
    }),

    vscode.commands.registerCommand('psft.project.compare', () => {
      vscode.window.showInformationMessage(
        'Project compare is not implemented yet. See docs/ROADMAP.md.');
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

    vscode.commands.registerCommand('psft.openDefinition',
      async (connectionId: string, key: DefinitionKey) => {
        await withError(`Opening ${displayName(key)}`, async () => {
          if (key.type === DefinitionType.Project) {
            projects.openProject(connectionId, key.parts[0]);
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

          const provider = await workspace.require(connectionId);
          if ((key.type === DefinitionType.AppEngineProgram || key.type === DefinitionType.AppEngineSection) && provider instanceof DatabaseProvider) {
            const { program, peopleCode } = await provider.readAppEngineView(key);
            AppEnginePanel.show({ id: provider.id, displayName: provider.displayName }, key, program, peopleCode);
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

    vscode.commands.registerCommand('psft.buildProject', () => {
      vscode.window.showInformationMessage(
        'Project build (DDL generation) is not implemented yet. See docs/ROADMAP.md.');
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

        const candidates = workspace.activeProviders.filter(
          (p) => p.isConnected && p.id !== left.connectionId);
        if (candidates.length === 0) {
          vscode.window.showWarningMessage(
            'Compare needs a second connected environment, but only one connection is active at a time. ' +
            'Comparing across environments is not available until compare reads the other side without activating it.');
          return;
        }

        let rightProvider = candidates[0];
        if (candidates.length > 1) {
          const picked = await vscode.window.showQuickPick(
            candidates.map((p) => ({
              label: p.displayName,
              description: p.id,
              provider: p
            })),
            {
              title: `Compare ${displayName(left.key)} with…`,
              placeHolder: 'Other environment',
              ignoreFocusOut: true
            });
          if (!picked) return;
          rightProvider = picked.provider;
        }

        if (!rightProvider.canReadAsText(left.key.type)) {
          vscode.window.showInformationMessage(
            `${rightProvider.displayName} can't open ${typeLabel(left.key.type)} as text.`);
          return;
        }

        const leftUri = toUri(left.connectionId, left.key);
        const rightUri = toUri(rightProvider.id, left.key);
        await vscode.workspace.openTextDocument(leftUri);
        try {
          await vscode.workspace.openTextDocument(rightUri);
        } catch (err) {
          vscode.window.showErrorMessage(
            `Could not read ${displayName(left.key)} from ${rightProvider.displayName}: ` +
            `${(err as Error).message}`);
          return;
        }

        const title =
          `${displayName(left.key)} (${leftProvider.displayName} ↔ ${rightProvider.displayName})`;
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
      | DefinitionType.ApplicationClassPeopleCode | DefinitionType.Component | DefinitionType.Page;
    /** Page: New Page Fluid (from a Layout Page). */
    fluid?: boolean;
  };
  const later = (label: string): Item => ({ label, description: 'not available yet' });
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
    { label: 'Not available yet', kind: vscode.QuickPickItemKind.Separator },
    ...['Menu', 'App Engine Program'].map(later)
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
        actions: { add: false, updateDisplay: true, updateDisplayAll: false, correction: false }, disableSave: false, includeInNavigation: true
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
    ...(editable ? {
      save: async (controls, properties, order) => {
        if (!created) {
          const result = await provider.createPage({ pnlName, operatorId: operatorId!, controls, ...(properties ? { properties } : {}) });
          created = true;
          openedVersion = result.version;
          void vscode.commands.executeCommand('psft.refresh');
          vscode.window.showInformationMessage(`Created page ${pnlName} on ${provider.displayName}.`);
          return { version: result.version, layout: (await provider.readPageLayout(key)).layout };
        }
        const result = await provider.savePage({ pnlName, openedVersion, operatorId: operatorId!, controls, ...(properties ? { properties } : {}), ...(order ? { order } : {}) });
        openedVersion = result.version;
        // Added and pasted controls only get their PNLFLDIDs from the database: redraw from it.
        if (result.inserted > 0) return { version: result.version, layout: (await provider.readPageLayout(key)).layout };
        return { version: result.version };
      }
    } : {})
  });
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
