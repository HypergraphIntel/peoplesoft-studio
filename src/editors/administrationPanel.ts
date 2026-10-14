import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { adminIdentity, adminInputKey, validateAdminInput, inputForAdminDocument, type AdminDocument, type AdminKind } from '../model/administration.js';

import { administrationHtml, ADMIN_TITLES } from './administrationHtml.js';
export { ADMIN_TITLES } from './administrationHtml.js';
const PANELS = new Map<string, vscode.WebviewPanel>();
const DIRTY = new Set<string>();
export const hasUnsavedAdministration = (connectionId: string, kind: AdminKind) => DIRTY.has(connectionId + ':' + kind);

export function openAdministrationPanel(workspace: Workspace, provider: DatabaseProvider, kind: AdminKind): vscode.WebviewPanel {
  const identity = provider.id + ':' + kind;
  const existing = PANELS.get(identity); if (existing) { existing.reveal(); return existing; }
  const panel = vscode.window.createWebviewPanel('psft.administration', ADMIN_TITLES[kind], vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  PANELS.set(identity, panel); panel.onDidDispose(() => { PANELS.delete(identity); DIRTY.delete(identity); });
  panel.webview.html = administrationHtml(kind, provider.displayName, randomBytes(18).toString('hex'));
  let doc: AdminDocument | undefined;
  let newTranslation: ReturnType<typeof inputForAdminDocument> | undefined;
  let queue = Promise.resolve();
  const writable = () => workspace.isWritable(provider.id) && !!workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const showEntry = async (loaded?: AdminDocument) => {
    newTranslation = undefined;
    DIRTY.delete(identity);
    doc = loaded;
    const input = loaded ? inputForAdminDocument(loaded) : kind === 'message'
      ? { set: 20000, number: 1, setDescription: '', setShortDescription: '', severity: 'M', text: '', explanation: '' }
      : kind === 'url' ? { id: '', description: '', url: 'http://', owner: '', comments: '' }
      : { owner: '', subId: '', id: '', effectiveDate: new Date().toLocaleDateString('en-CA'), keys: Array(6).fill(''), language: '', text: '', description: '', usage: '', systemData: true };
    const reserved = kind === 'message' && loaded && Number(loaded.key[0]) < 20000;
    await panel.webview.postMessage({ type: 'entry', key: loaded?.key, input, related: loaded?.related,
      editable: writable() && !reserved, notice: reserved ? 'Oracle-reserved message set: read only.' : undefined });
  };
  panel.webview.onDidReceiveMessage((message: unknown) => {
    queue = queue.then(async () => {
      const m = message as { type?: string; key?: string[]; query?: string; offset?: number; input?: unknown; dirty?: boolean };
      if (!m || typeof m !== 'object') return;
      if (m.type === 'dirty') { DIRTY.add(identity); return; }
      if (['new', 'load', 'translate'].includes(m.type ?? '') && m.dirty) {
        if (await vscode.window.showWarningMessage('Discard unsaved administration changes?', { modal: true }, 'Discard Changes') !== 'Discard Changes') return;
      }
      if (m.type === 'ready') {
        await showEntry(); await panel.webview.postMessage({ type: 'list', ...await provider.listAdministration(kind, '') });
        if (kind === 'text') await panel.webview.postMessage({ type: 'choices', ...await provider.administrationChoices() });
      }
      else if (m.type === 'search') {
        if (typeof m.query !== 'string' || m.query.length > 254) throw new Error('Invalid search text.');
        await panel.webview.postMessage({ type: 'list', ...await provider.listAdministration(kind, m.query, m.offset ?? 0) });
      } else if (m.type === 'new') { newTranslation = undefined; await showEntry(); }
      else if (m.type === 'translate' && kind === 'text' && doc) {
        const choices = await provider.administrationChoices();
        const language = await vscode.window.showQuickPick(choices.languages.map(l => ({ label: l.code, description: l.description })), { title: 'Text Catalog translation language' });
        if (!language) return;
        const key = [...doc.key.slice(0, 10), language.label];
        const translated = await provider.readAdministration(kind, key);
        if (translated) { newTranslation = undefined; await showEntry(translated); }
        else {
          newTranslation = { ...inputForAdminDocument(doc), language: language.label, text: '' };
          doc = undefined;
          await panel.webview.postMessage({ type: 'entry', input: newTranslation, editable: writable(), notice: 'New translation. Base-language text will be preserved.' });
        }
      }
      else if (m.type === 'load') {
        if (!Array.isArray(m.key) || m.key.some(key => typeof key !== 'string')) throw new Error('Invalid entry key.');
        const loaded = await provider.readAdministration(kind, m.key);
        if (!loaded) throw new Error('This entry no longer exists.');
        await showEntry(loaded);
      } else if (m.type === 'save') {
        if (!writable()) throw new Error('Set the connection to Writable and configure a PeopleSoft Operator ID before saving.');
        const input = validateAdminInput(kind, m.input);
        if (newTranslation && adminIdentity(kind, adminInputKey(kind, newTranslation)) !== adminIdentity(kind, adminInputKey(kind, input))) throw new Error('Translation identity cannot be changed.');
        if (doc && adminIdentity(kind, doc.key) !== adminIdentity(kind, adminInputKey(kind, input))) throw new Error('Entry identity cannot be changed by Save. Create a new entry instead.');
        const saved = await provider.saveAdministration({ kind, input, expectedToken: doc?.token ?? 'absent',
          operatorId: workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim() });
        newTranslation = undefined;
        await showEntry(saved);
        await panel.webview.postMessage({ type: 'entry', key: saved.key, input: inputForAdminDocument(saved), related: saved.related, editable: writable(), notice: 'Saved and verified.' });
      }
    }).catch(async error => { await panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); });
  });
  return panel;
}
