import * as vscode from 'vscode';
import { Workspace, ConnectionConfig, providerId } from './workspace.js';
import { PeopleSoftFileSystem } from './providers/fileSystem.js';
import { ConnectionsView } from './views/connections.js';
import { BrowserView } from './views/browser.js';
import { ProjectsView } from './views/projects.js';
import { RecordEditorProvider } from './editors/recordEditor.js';
import { DefinitionKey, DefinitionType, displayName, TYPE_LABELS } from './model/definitions.js';
import { toUri } from './util/uri.js';
import { DefinitionProvider } from './providers/provider.js';

export function activate(context: vscode.ExtensionContext): void {
  const workspace = new Workspace(context.secrets);
  context.subscriptions.push(workspace);

  const fileSystem = PeopleSoftFileSystem.register(workspace);
  context.subscriptions.push(fileSystem);
  context.subscriptions.push(RecordEditorProvider.register(workspace));

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
          const uri = toUri(connectionId, key);
          if (key.type === DefinitionType.Record) {
            await vscode.commands.executeCommand(
              'vscode.openWith', uri, RecordEditorProvider.viewType);
          } else {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: true });
          }
        });
      }),

    vscode.commands.registerCommand('psft.findDefinition', () => findDefinition(workspace)),

    vscode.commands.registerCommand('psft.insertIntoProject', () => {
      vscode.window.showInformationMessage(
        'Inserting into a project is not implemented yet. See docs/ROADMAP.md.');
    }),

    vscode.commands.registerCommand('psft.buildProject', () => {
      vscode.window.showInformationMessage(
        'Project build (DDL generation) is not implemented yet. See docs/ROADMAP.md.');
    }),

    vscode.commands.registerCommand('psft.compareDefinition', () => {
      vscode.window.showInformationMessage(
        'Definition compare is not implemented yet. See docs/ROADMAP.md.');
    })
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

/** App Designer's Open dialog: pick a type, type a prefix, pick a definition. */
async function findDefinition(workspace: Workspace): Promise<void> {
  const providers = workspace.activeProviders.filter((p) => p.isConnected);
  if (providers.length === 0) {
    vscode.window.showWarningMessage('Connect to a PeopleSoft environment first.');
    return;
  }

  const provider = providers.length === 1 ? providers[0] : await pickProvider(providers);
  if (!provider) return;

  const type = await vscode.window.showQuickPick(
    [
      DefinitionType.Record, DefinitionType.Field, DefinitionType.Page,
      DefinitionType.Component, DefinitionType.Menu, DefinitionType.ApplicationPackage,
      DefinitionType.AppEngineProgram, DefinitionType.SqlDefinition
    ].map((t) => ({ label: TYPE_LABELS[t], value: t })),
    { title: 'Definition type', ignoreFocusOut: true });
  if (!type) return;

  const pattern = await vscode.window.showInputBox({
    title: `Find ${TYPE_LABELS[type.value]}`,
    placeHolder: 'Name starts with... (use % as a wildcard)',
    ignoreFocusOut: true });
  if (pattern === undefined) return;

  await withError('Searching', async () => {
    const results = await provider.search({
      type: type.value,
      namePattern: pattern.includes('%') ? pattern : `${pattern}%`,
      limit: 500
    });
    if (results.length === 0) {
      vscode.window.showInformationMessage(`No ${TYPE_LABELS[type.value]} matched "${pattern}".`);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      results.map((r) => ({
        label: displayName(r.key),
        description: r.description,
        detail: r.lastUpdatedBy ? `Last updated by ${r.lastUpdatedBy}` : undefined,
        key: r.key
      })),
      { title: `${results.length} result(s)`, matchOnDescription: true });
    if (!picked) return;
    await vscode.commands.executeCommand('psft.openDefinition', provider.id, picked.key);
  });
}

async function pickProvider(
  providers: DefinitionProvider[]
): Promise<DefinitionProvider | undefined> {
  const picked = await vscode.window.showQuickPick(
    providers.map((p) => ({ label: p.displayName, provider: p })),
    { title: 'Environment' });
  return picked?.provider;
}

/** Surfaces provider failures as messages instead of unhandled rejections. */
async function withError(action: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    vscode.window.showErrorMessage(`${action} failed: ${(err as Error).message}`);
  }
}
