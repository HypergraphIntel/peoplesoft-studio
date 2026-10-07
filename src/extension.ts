import * as vscode from 'vscode';
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
import { RECORD_FIELD_EVENTS } from './model/recordEvents.js';
import { toUri } from './util/uri.js';
import { registerPeopleCodeCompletion } from './peoplecode/completion.js';
import { registerPeopleCodeHover } from './peoplecode/hover.js';
import { registerPeopleCodeSymbols } from './peoplecode/symbols.js';
import { parseUri } from './util/uri.js';
import { StatusBar } from './views/statusBar.js';
import { selectConnection } from './views/connectionSelection.js';
import { registerSettings } from './settings/index.js';
import { buildProperties, hasProperties } from './model/properties.js';
import { PropertiesPanel } from './editors/propertiesPanel.js';
import { canInsertIntoProject, describeItem, ProjectSaveRefusedError } from './model/projectItems.js';
import { OracleProvider } from './providers/oracle.js';

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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspace = new Workspace(context.secrets);
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
  const fileSystem = PeopleSoftFileSystem.register(workspace, async (key, connection, result) => {
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
  });
  context.subscriptions.push(fileSystem);
  context.subscriptions.push(FieldEditorProvider.register(workspace));

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

    vscode.commands.registerCommand('psft.addConnection', () => addConnection()),

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
        if (!(provider instanceof OracleProvider)) {
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
        if (!(provider instanceof OracleProvider) || !workspace.isWritable(provider.id) || !operatorId) {
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

/** Collects a connection interactively rather than making the user hand-edit settings.json. */
async function addConnection(): Promise<void> {
  const kind = await vscode.window.showQuickPick(
    [
      { label: 'Oracle database', description: 'Read definitions from the PeopleTools tables', value: 'oracle' as const },
      { label: 'Project export file', description: 'Read an App Designer XML export', value: 'projectFile' as const }
    ],
    { title: 'PeopleSoft connection type', ignoreFocusOut: true });
  if (!kind) return;

  const name = await vscode.window.showInputBox({
    title: 'Connection name', placeHolder: 'DEV', ignoreFocusOut: true });
  if (!name) return;

  if (kind.value === 'projectFile') {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false, filters: { 'Project export': ['xml'] } });
    if (!picked?.[0]) return;
    await saveConnection({ name, kind: 'projectFile', path: picked[0].fsPath });
    return;
  }

  const connectString = await vscode.window.showInputBox({
    title: 'Oracle connect string',
    placeHolder: 'host:1521/PSFTDB',
    ignoreFocusOut: true });
  if (!connectString) return;

  const user = await vscode.window.showInputBox({
    title: 'Database access id', value: 'SYSADM', ignoreFocusOut: true });
  if (!user) return;

  await saveConnection({ name, kind: 'oracle', connectString, user });
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
        detail: config.kind === 'oracle'
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
      `${record}.${field}.${picked.event} has no PeopleCode. New programs can be created on Writable connections, for scratch records (ZZ_PCODE_LAB%).`);
    return;
  }
  await vscode.commands.executeCommand('psft.openDefinition', connectionId, key);
}

async function withError(action: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    vscode.window.showErrorMessage(`${action} failed: ${(err as Error).message}`);
  }
}
