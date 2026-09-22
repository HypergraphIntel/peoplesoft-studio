import * as vscode from 'vscode';
import { Workspace, ConnectionConfig, providerId } from './workspace.js';
import { PeopleSoftFileSystem } from './providers/fileSystem.js';
import { ConnectionsView } from './views/connections.js';
import { BrowserView } from './views/browser.js';
import { ProjectsView } from './views/projects.js';
import { RecordEditorProvider } from './editors/recordEditor.js';
import { OpenDefinitionPanel } from './editors/openDefinitionPanel.js';
import { DefinitionKey, DefinitionType, displayName, typeLabel } from './model/definitions.js';
import { toUri } from './util/uri.js';
import { registerPeopleCodeCompletion } from './peoplecode/completion.js';
import { registerPeopleCodeHover } from './peoplecode/hover.js';
import { registerPeopleCodeSymbols } from './peoplecode/symbols.js';
import { parseUri } from './util/uri.js';
import { StatusBar } from './views/statusBar.js';

/** Left side of a compare: which connection + which definition key. */
interface CompareTarget {
  connectionId: string;
  key: DefinitionKey;
}

/**
 * Resolve the definition to compare from a tree node, or from the active editor.
 *
 * Tree nodes from Projects / Browser look like:
 *   { kind: 'definition' | 'item' | 'packageNode', provider, summary? | node? }
 */
async function resolveDefinitionForCompare(
  workspace: Workspace,
  node: unknown
): Promise<CompareTarget | undefined> {
  const fromTree = targetFromTreeNode(node);
  if (fromTree) return fromTree;

  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.scheme === 'psft') {
    try {
      const parsed = parseUri(editor.document.uri);
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
    'or focus a PeopleSoft text editor, then run Compare.');
  return undefined;
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

export function activate(context: vscode.ExtensionContext): void {
  const workspace = new Workspace(context.secrets);
  context.subscriptions.push(workspace);

  const statusBar = new StatusBar(workspace);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => statusBar.update()),
    workspace.onDidChange(() => statusBar.update())
  );

  const fileSystem = PeopleSoftFileSystem.register(workspace);
  context.subscriptions.push(fileSystem);
  context.subscriptions.push(RecordEditorProvider.register(workspace));

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

  context.subscriptions.push(
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
      // Reuse existing stub behavior if you still have psft.buildProject
      vscode.window.showInformationMessage(
        'Project build (DDL) is not implemented yet. See docs/ROADMAP.md.');
    }),

    vscode.commands.registerCommand('psft.project.compare', () => {
      vscode.window.showInformationMessage(
        'Project compare is not implemented yet. See docs/ROADMAP.md.');
    }),

    vscode.commands.registerCommand(
      'psft.status.selectConnection',
      () => selectStatusConnection(workspace, statusBar)
    ),

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
          // A project is not a document: opening it means showing its contents
          // in the project tree, which is the same view an opened export gives.
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

          // Checked up front rather than left to openTextDocument's failure,
          // which wraps whatever the provider throws in its own generic
          // "cannot open <uri>" dialog -- accurate, but noisier than saying
          // outright that this type has no reader here yet.
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

    vscode.commands.registerCommand('psft.insertIntoProject', () => {
      vscode.window.showInformationMessage(
        'Inserting into a project is not implemented yet. See docs/ROADMAP.md.');
    }),

    vscode.commands.registerCommand('psft.buildProject', () => {
      vscode.window.showInformationMessage(
        'Project build (DDL generation) is not implemented yet. See docs/ROADMAP.md.');
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
            'Connect a second environment (or open another project export) to compare against.');
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

        // Touch both documents so the file-system provider loads content before diff.
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
}

export function deactivate(): void { /* Workspace disposes through subscriptions. */ }

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

  // The password is requested on first connect and kept in SecretStorage, so it
  // never reaches settings.json.
  await saveConnection({ name, kind: 'oracle', connectString, user });
}

async function saveConnection(config: ConnectionConfig): Promise<void> {
  const settings = vscode.workspace.getConfiguration('peoplesoft');
  const all = settings.get<ConnectionConfig[]>('connections', []);
  if (all.some((c) => c.name === config.name)) {
    vscode.window.showErrorMessage(`A connection named "${config.name}" already exists.`);
    return;
  }
  await settings.update('connections', [...all, config], vscode.ConfigurationTarget.Global);
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

  // Connection selection happens here.
}
/** Surfaces provider failures as messages instead of unhandled rejections. */
async function withError(action: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    vscode.window.showErrorMessage(`${action} failed: ${(err as Error).message}`);
  }
}
