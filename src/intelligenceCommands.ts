import * as vscode from 'vscode';
import { DiscoveryInputError, DiscoveryStore, PrivacyRejectedError } from './intelligence/index.js';
import { DiscoveryPanel, DiscoveryTree, discoverySources, TOKEN_KEY } from './views/discoveryView.js';

/*
 * The extension's side of the Discovery & Intelligence Network
 * (docs/intelligence/PROGRESS.md): the installation's own store in the
 * extension's global storage, the Discoveries view and panel (phase 3),
 * recording a finding from JSON, and the server token in secret storage.
 * Nothing is sent unless the settings, the machine policy and VS Code's
 * telemetry allow it and the user approves the exact submission.
 */

let store: Promise<DiscoveryStore> | undefined;

/** The installation's discovery store (created on first use). */
export function discoveryStore(context: vscode.ExtensionContext): Promise<DiscoveryStore> {
  store ??= new DiscoveryStore(vscode.Uri.joinPath(context.globalStorageUri, 'intelligence').fsPath).open();
  return store;
}

export function registerIntelligenceCommands(context: vscode.ExtensionContext): void {
  const sources = discoverySources(() => discoveryStore(context));
  const tree = new DiscoveryTree(sources);
  const fail = (what: string, error: unknown) => void vscode.window.showErrorMessage(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  context.subscriptions.push(
    vscode.window.createTreeView('psft.discoveries', { treeDataProvider: tree }),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('peoplesoft.intelligence') || e.affectsConfiguration('telemetry')) tree.refresh(); }),
    vscode.commands.registerCommand('psft.intelligence.refreshDiscoveries', () => tree.refresh()),
    vscode.commands.registerCommand('psft.intelligence.openDiscovery', async (sourceId?: string, id?: string) => {
      try {
        const source = (await sources()).find((s) => s.id === sourceId);
        if (source && id) await DiscoveryPanel.show(context, source, id, () => tree.refresh());
      } catch (error) { fail('Discovery', error); }
    }),
    vscode.commands.registerCommand('psft.intelligence.showDiscoveries', async () => {
      try {
        const all = await Promise.all((await sources()).map(async (s) => (await s.store.list()).map((f) => ({ s, f }))));
        const flat = all.flat();
        if (!flat.length) {
          void vscode.window.showInformationMessage('No discoveries recorded yet. Research tools record them, and PeopleSoft: Record Discovery from JSON; nothing is uploaded without your review.');
          return;
        }
        const pick = await vscode.window.showQuickPick(flat.map(({ s, f }) => ({
          label: f.title, description: `${f.localStatus} · ${f.confidence} · ${f.subsystem}`, detail: `${s.label} · ${f.id} · PeopleTools ${f.observedReleases.join(', ')}`, sid: s.id, id: f.id
        })), { title: `Discoveries (${flat.length})`, matchOnDescription: true, matchOnDetail: true });
        if (pick) await vscode.commands.executeCommand('psft.intelligence.openDiscovery', pick.sid, pick.id);
      } catch (error) { fail('Discoveries', error); }
    }),
    vscode.commands.registerCommand('psft.intelligence.recordFromEditor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { void vscode.window.showInformationMessage('Open a finding as JSON (psft-finding/1 input: docs/intelligence/FINDING_SCHEMA.md) first.'); return; }
      try {
        const r = await (await discoveryStore(context)).record({ source: 'manual', ...JSON.parse(editor.document.getText()) });
        tree.refresh();
        const open = await vscode.window.showInformationMessage(`Discovery ${r.outcome}: ${r.finding.id} (${r.finding.localStatus}). Recorded on this installation only.`, 'Open');
        if (open) await vscode.commands.executeCommand('psft.intelligence.openDiscovery', 'installation', r.finding.id);
      } catch (error) {
        if (error instanceof SyntaxError) fail('Record Discovery', new Error(`The editor does not hold JSON (${error.message}).`));
        else if (error instanceof DiscoveryInputError || error instanceof PrivacyRejectedError) fail('Record Discovery', error);
        else fail('Record Discovery', error);
      }
    }),
    vscode.commands.registerCommand('psft.intelligence.setServerToken', async () => {
      const token = await vscode.window.showInputBox({ title: 'Discovery Server Token', prompt: 'The contributor token your discovery server issued. Kept in VS Code\'s secret storage; never written to settings or logs.', password: true, ignoreFocusOut: true });
      if (!token?.trim()) return;
      await context.secrets.store(TOKEN_KEY, token.trim());
      void vscode.window.showInformationMessage('Discovery server token saved in secret storage.');
    }),
    vscode.commands.registerCommand('psft.intelligence.clearServerToken', async () => {
      await context.secrets.delete(TOKEN_KEY);
      void vscode.window.showInformationMessage('Discovery server token removed.');
    })
  );
}
