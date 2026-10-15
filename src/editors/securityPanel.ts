import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { Workspace } from '../workspace.js';
import { DatabaseProvider } from '../providers/database.js';
import { SECURITY_TITLES, securityDiagnostics, oauthEditable, type SecurityKind, type SecurityDocument } from '../model/security.js';
import { securityHtml } from './securityHtml.js';
const panels = new Map<string, vscode.WebviewPanel>();
const dirty = new Set<string>();
export const hasUnsavedSecurity = (connection: string) => dirty.has(connection + ':oauth');
export function openSecurityPanel(workspace: Workspace, provider: DatabaseProvider, kind: SecurityKind): vscode.WebviewPanel {
  const id = provider.id + ':' + kind, existing = panels.get(id);
  if (existing) { existing.reveal(); return existing; }
  const panel = vscode.window.createWebviewPanel('psft.security', SECURITY_TITLES[kind], vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  panels.set(id, panel);
  panel.onDidDispose(() => { panels.delete(id); dirty.delete(id); });
  panel.webview.html = securityHtml(kind, provider.displayName, randomBytes(18).toString('hex'));
  let queue = Promise.resolve();
  let opened: SecurityDocument | undefined;
  const editable = (doc: SecurityDocument) => oauthEditable(doc) && provider.platform === 'oracle' && workspace.isWritable(provider.id) && !!workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  panel.webview.onDidReceiveMessage((message: unknown) => {
    queue = queue.then(async () => {
      if (!message || typeof message !== 'object') return;
      const m = message as { type?: string; query?: string; offset?: number; key?: string[]; dirty?: boolean; changes?: unknown; dryRun?: boolean };
      if (m.type === 'dirty') { if (m.dirty) dirty.add(id); else dirty.delete(id); return; }
      if (m.type === 'list') {
        const [list, choices] = await Promise.all([provider.listSecurity(kind, typeof m.query === 'string' ? m.query : '', m.offset ?? 0), provider.securityChoices()]);
        opened = undefined; dirty.delete(id);
        await panel.webview.postMessage({ type: 'list', ...list, choices });
      } else if (m.type === 'get') {
        if (!Array.isArray(m.key)) throw new Error('Invalid configuration key.');
        const document = await provider.readSecurity(kind, m.key);
        if (!document) throw new Error('Configuration no longer exists. Refresh the list.');
        opened = document;
        dirty.delete(id);
        await panel.webview.postMessage({ type: 'entry', document, diagnostics: securityDiagnostics(document), editable: editable(document) });
      } else if (m.type === 'save') {
        if (!opened || !editable(opened)) throw new Error('This configuration is not writable in Studio.');
        const dryRun = m.dryRun === true;
        if (!dryRun && await vscode.window.showWarningMessage('Save OAuth configuration on ' + provider.displayName + '?', { modal: true, detail: JSON.stringify(m.changes, null, 2) }, 'Save') !== 'Save') {
          await panel.webview.postMessage({ type: 'preview', message: 'Save cancelled.' }); return;
        }
        const saved = await provider.saveOAuth({ key: opened.key, expectedToken: opened.token, changes: m.changes, operatorId: workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim(), dryRun });
        if (dryRun) { await panel.webview.postMessage({ type: 'preview', message: 'Preview verified and rolled back. No changes saved.\n' + JSON.stringify(saved.properties, null, 2) }); }
        else { opened = saved; dirty.delete(id); await panel.webview.postMessage({ type: 'entry', document: saved, diagnostics: securityDiagnostics(saved), editable: editable(saved), message: 'Saved and verified.' }); }
      }
    }).catch(async e => { await panel.webview.postMessage({ type: 'error', message: e instanceof Error ? e.message : 'Security tool failed.' }); });
  });
  return panel;
}
