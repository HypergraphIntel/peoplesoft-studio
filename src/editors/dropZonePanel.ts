import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { Workspace } from '../workspace.js';
import { DatabaseProvider } from '../providers/database.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import type { DropZoneAssignment } from '../providers/dropZoneWriter.js';
import { dropZoneHtml } from './dropZoneHtml.js';

const panels = new Map<string, vscode.WebviewPanel>();

export async function openDropZones(workspace: Workspace, connectionId?: string, component?: string, market = 'GBL'): Promise<void> {
  const connected = workspace.activeProviders.filter((p): p is DatabaseProvider => p instanceof DatabaseProvider && p.isConnected);
  let provider = connected.find(p => p.id === (connectionId ?? workspace.selectedConnectionId));
  if (!provider && connected.length === 1) provider = connected[0];
  if (!provider && connected.length) provider = (await vscode.window.showQuickPick(connected.map(p => ({ label: p.displayName, provider: p })), { title: 'Drop Zones — connection' }))?.provider;
  if (!provider) { if (!connected.length) void vscode.window.showInformationMessage('Connect a PeopleSoft database to configure Drop Zones.'); return; }
  if (!component) {
    const db = provider;
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { parts: string[] }>();
    picker.title = `Drop Zones on ${db.displayName}`;
    picker.placeholder = 'Type at least two characters of a component name';
    let generation = 0;
    picker.onDidChangeValue(async value => {
      const current = ++generation;
      if (value.trim().length < 2) { picker.items = []; picker.busy = false; return; }
      picker.busy = true;
      try {
        const found = await db.search({ type: DefinitionType.Component, namePattern: `%${value.trim().toUpperCase()}%`, limit: 100 });
        if (current === generation) picker.items = found.map(d => ({ label: d.key.parts[0], description: d.key.parts[1], detail: d.description, parts: [...d.key.parts] }));
      } catch (error) {
        if (current === generation) { picker.items = []; void vscode.window.showErrorMessage(String(error)); }
      } finally { if (current === generation) picker.busy = false; }
    });
    const picked = await new Promise<string[] | undefined>(resolve => {
      picker.onDidAccept(() => { const item = picker.selectedItems[0]; if (item) { resolve(item.parts); picker.hide(); } });
      picker.onDidHide(() => resolve(undefined));
      picker.show();
    });
    generation++; picker.dispose();
    if (!picked) return;
    [component, market = 'GBL'] = picked;
  }
  const db = provider, name = component!, id = `${db.id}:${name}:${market}`;
  const existing = panels.get(id);
  if (existing) { existing.reveal(); return; }
  let read = await db.readDropZoneConfiguration(name, market);
  const panel = vscode.window.createWebviewPanel('psft.dropZones', `Drop Zones: ${name}.${market}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  panels.set(id, panel);
  panel.onDidDispose(() => panels.delete(id));
  panel.webview.html = dropZoneHtml(randomBytes(18).toString('hex'));
  const operator = () => workspace.configFor(db.id)?.peoplesoftOperatorId?.trim();
  const editable = () => db.platform === 'oracle' && workspace.isWritable(db.id) && !!operator();
  const post = async (message = '') => { await panel.webview.postMessage({ type: 'state', component: name, market, connection: db.displayName, ...read, editable: editable(), message }); };
  let queue = Promise.resolve();
  panel.webview.onDidReceiveMessage((message: unknown) => {
    queue = queue.then(async () => {
      if (!message || typeof message !== 'object') return;
      const m = message as { type?: string; assignments?: DropZoneAssignment[]; page?: string };
      if (m.type === 'ready') await post();
      else if (m.type === 'reload') { read = await db.readDropZoneConfiguration(name, market); await post('Reloaded stored configuration.'); }
      else if (m.type === 'open') {
        if (read.zones.some(z => z.page === m.page || z.container === m.page || z.subpage === m.page)) await vscode.commands.executeCommand('psft.openDefinition', db.id, makeKey(DefinitionType.Page, m.page!));
      } else if (m.type === 'preview' || m.type === 'save') {
        if (!editable()) throw new Error('Saving requires a Writable connection and an Operator ID.');
        if (!Array.isArray(m.assignments)) throw new Error('Invalid assignments.');
        const seen = new Set<string>();
        for (const a of m.assignments) {
          if (!a || typeof a.subpage !== 'string' || !read.zones.some(z => z.page === a.page && z.fieldName === a.fieldName)) throw new Error('Unknown drop zone. Reload the configuration.');
          const key = `${a.page}|${a.fieldName}`;
          if (seen.has(key)) throw new Error('Duplicate drop zone assignment.');
          seen.add(key);
        }
        const request = { component: name, market, assignments: m.assignments, openedToken: read.token, operatorId: operator()! };
        const preview = await db.saveDropZoneConfiguration({ ...request, dryRun: true });
        if (m.type === 'preview' || preview.plan.empty) { await panel.webview.postMessage({ type: 'notice', message: preview.plan.empty ? 'Nothing to save.' : preview.plan.changes.join('\n') }); return; }
        if (await vscode.window.showWarningMessage(`Save Drop Zones for ${name}.${market} on ${db.displayName}?`, { modal: true, detail: preview.plan.changes.join('\n') }, 'Save') !== 'Save') { await panel.webview.postMessage({ type: 'notice', message: 'Save cancelled.' }); return; }
        await db.saveDropZoneConfiguration(request);
        read = await db.readDropZoneConfiguration(name, market);
        await post('Saved and verified.');
        void vscode.commands.executeCommand('psft.customization.refresh');
      }
    }).catch(async error => { await panel.webview.postMessage({ type: 'notice', message: `Error: ${error instanceof Error ? error.message : String(error)}` }); });
  });
}
