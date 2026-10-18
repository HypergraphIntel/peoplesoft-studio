import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { DatabaseProvider } from '../providers/database.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { portalIdentity, portalInput, portalInputForDocument, type PortalDocument } from '../model/portalDocument.js';
import type { Workspace } from '../workspace.js';
import { portalHtml } from './portalHtml.js';
const dirtyPortals = new Set<string>();
export const hasUnsavedPortal = (connection: string, portal: string) => dirtyPortals.has(JSON.stringify([connection, portal]));
const panels = new Map<string, vscode.WebviewPanel>();

export async function openPortalStructure(workspace: Workspace, provider: DatabaseProvider): Promise<void> {
  const portals = await provider.menuChoices('portals');
  const portal = await vscode.window.showQuickPick(portals.map(p => p.value), {
    title: 'Structure & Content — which portal do you want to open?', placeHolder: 'Select a portal'
  });
  if (!portal) return;
  const identity = JSON.stringify([provider.id, portal]);
  const existing = panels.get(identity);
  if (existing) { existing.reveal(); return; }
  const panel = vscode.window.createWebviewPanel('psft.portal.structure', `${portal} — Structure & Content`, vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  panels.set(identity, panel);
  const subscription = panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const m = message as { type?: string; name?: string; refType?: string; input?: unknown; parent?: string; dirty?: boolean };
    if (m.type === 'dirty') { dirtyPortals.add(identity); return; }
    queue = queue.then(async () => {
      if (['select', 'new', 'refresh'].includes(m.type ?? '') && (dirtyPortals.has(identity) || m.dirty)) {
        if (await vscode.window.showWarningMessage('Discard unsaved Structure & Content changes?', { modal: true }, 'Discard Changes') !== 'Discard Changes') {
          await panel.webview.postMessage({ type: 'cancel' }); return;
        }
      }
      if (m.type === 'ready' || m.type === 'refresh') { await tree(); await show(); }
      else if (m.type === 'select') {
        const id = portalIdentity.parse({ portal, refType: m.refType, name: m.name });
        const loaded = await provider.readPortalDocument(id);
        if (!loaded) throw new Error('Registry entry no longer exists.');
        doc = loaded; creating = false;
        await show(portalInputForDocument(doc));
      } else if (m.type === 'new') {
        if (!writable()) throw new Error('Set this connection to Writable and configure an Operator ID before creating entries.');
        if (m.refType !== 'F' && m.refType !== 'C') throw new Error('Choose Folder or Content Reference.');
        doc = undefined; creating = true;
        await show({ portal, refType: m.refType, name: '', parent: m.parent || 'PORTAL_ROOT_OBJECT', label: '', description: '', sequence: 0, owner: '', access: 'author', permissions: [] });
      } else if (m.type === 'save') {
        if (!writable()) throw new Error('Set this connection to Writable and configure an Operator ID before saving.');
        const input = portalInput.parse(m.input);
        if (input.portal !== portal) throw new Error('Cannot change portals inside this editor.');
        if (!creating && (!doc || doc.identity.name !== input.name || doc.identity.refType !== input.refType)) throw new Error('Entry identity cannot be changed by Save.');
        doc = await provider.savePortalDocument({ input, expectedToken: creating ? 'absent' : doc!.token, operatorId: workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim() });
        creating = false;
        await tree(); await show(portalInputForDocument(doc));
        await panel.webview.postMessage({ type: 'status', text: 'Saved and verified.' });
      }
    }).catch(async error => { await panel.webview.postMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) }); });
  });
  panel.onDidDispose(() => { subscription.dispose(); panels.delete(identity); dirtyPortals.delete(identity); });
  let doc: PortalDocument | undefined, creating = false;
  let queue = Promise.resolve();
  const writable = () => workspace.isWritable(provider.id) && !!workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  const tree = async () => panel.webview.postMessage({ type: 'tree', rows: await provider.portalStructure(portal), writable: writable() });
  const show = async (input?: unknown) => {
    dirtyPortals.delete(identity);
    await panel.webview.postMessage({ type: 'entry', input, creating, editable: writable() && (creating || (!!doc && doc.identity.name !== 'PORTAL_ROOT_OBJECT')), row: doc?.row });
    if (doc && input) await panel.webview.postMessage({ type: 'detail', text: await provider.readText(makeKey(DefinitionType.PortalRegistry, portal, doc.identity.refType, doc.identity.name)) });
  };
  panel.webview.html = portalHtml(portal, provider.displayName, randomBytes(18).toString('hex'));
}
