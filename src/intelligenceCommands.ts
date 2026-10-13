import * as vscode from 'vscode';
import { DiscoveryStore } from './intelligence/index.js';

/*
 * The extension's side of the local discovery engine, phase 1
 * (docs/intelligence/PROGRESS.md): the installation's own store in the
 * extension's global storage -- offline, never uploaded -- and a command to
 * look at it. The Discovery Center (views, review, submission) is phase 3.
 */

let store: Promise<DiscoveryStore> | undefined;

/** The installation's discovery store (created on first use). */
export function discoveryStore(context: vscode.ExtensionContext): Promise<DiscoveryStore> {
  store ??= new DiscoveryStore(vscode.Uri.joinPath(context.globalStorageUri, 'intelligence').fsPath).open();
  return store;
}

export function registerIntelligenceCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('psft.intelligence.showDiscoveries', async () => {
    try {
      const s = await discoveryStore(context);
      const all = await s.list();
      if (!all.length) {
        void vscode.window.showInformationMessage('No local discoveries recorded yet. Findings are recorded by research tools and, later, the Discovery Center; nothing is uploaded.');
        return;
      }
      const pick = await vscode.window.showQuickPick(all.map((f) => ({
        label: f.title, description: `${f.localStatus} · ${f.confidence} · ${f.subsystem}`,
        detail: `${f.id} · ${f.type} · PeopleTools ${f.observedReleases.join(', ')} · ${f.observations} observation(s) · ${f.privacy}`, id: f.id
      })), { title: `Local Discoveries (${all.length})`, matchOnDescription: true, matchOnDetail: true });
      if (!pick) return;
      const finding = await s.get(pick.id);
      if (!finding) return;
      const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(finding, null, 2), language: 'json' });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
      void vscode.window.showErrorMessage(`Local discoveries: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
}
