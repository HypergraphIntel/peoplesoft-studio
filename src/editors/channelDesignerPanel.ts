import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  ChannelSession, validateChannelReferences, type ChannelDiagnostic, type ChannelDocument, type ChannelOp, type ChannelReferenceLookup
} from '../model/channelDocument.js';
import type { ChannelSaveResult } from '../providers/channelWriter.js';
import { renderChannelDesignerHtml } from './channelDesignerHtml.js';

/*
 * The Message Channel window: App Designer's -- its Messages tab with the
 * channel's messages and the fields to partition by (checked, and Add
 * Partition Field on the list's context menu), Message Channel Properties
 * (General, Use), Save, Save As, Rename, Delete -- in a VS Code webview. The
 * document lives here, in a ChannelSession; the webview shows it and sends
 * operations (model/channelDocument.ts ChannelOp).
 */

export interface ChannelDesignerHost {
  connection: { id: string; displayName: string };
  /** Undefined when the connection cannot save (read-only). */
  save?: (doc: ChannelDocument, token: string, dryRun?: boolean) => Promise<ChannelSaveResult>;
  reload: () => Promise<{ doc: ChannelDocument; token: string } | undefined>;
  lookup: ChannelReferenceLookup;
  choices: (what: 'owners' | 'fields', arg?: string) => Promise<Array<{ value: string; label?: string }>>;
  /** Double-click on a message: its definition. */
  openMessage: (message: string) => Promise<void>;
  saveAs?: (doc: ChannelDocument, name: string) => Promise<void>;
  rename?: (from: string, to: string, token: string) => Promise<void>;
  remove?: (name: string, token: string) => Promise<void>;
}

interface Open {
  panel: vscode.WebviewPanel;
  session: ChannelSession;
  host: ChannelDesignerHost;
  extraDiagnostics: ChannelDiagnostic[];
  status?: string;
}

export class ChannelDesignerPanel {
  static readonly viewType = 'psft.channelDesigner';
  private static readonly open = new Map<string, Open>();

  static key(connectionId: string, channel: string): string { return `${connectionId}\u0000${channel}`; }

  /** Opens (or reveals) a channel's window; token 'absent' for a new channel, which its first Save creates. */
  static show(host: ChannelDesignerHost, doc: ChannelDocument, token: string, options: { status?: string } = {}): void {
    const id = ChannelDesignerPanel.key(host.connection.id, doc.name);
    const existing = ChannelDesignerPanel.open.get(id);
    if (existing) { existing.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel(ChannelDesignerPanel.viewType, doc.name, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri(), 'media')] });
    const open: Open = { panel, session: new ChannelSession(doc, token), host, extraDiagnostics: [], ...(options.status ? { status: options.status } : {}) };
    ChannelDesignerPanel.open.set(id, open);
    panel.onDidDispose(() => ChannelDesignerPanel.open.delete(id));
    panel.webview.onDidReceiveMessage((m) => ChannelDesignerPanel.receive(open, m as Message));
    const media = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri(), 'media', f)).toString();
    panel.webview.html = renderChannelDesignerHtml({
      nonce: randomBytes(16).toString('base64'), cspSource: panel.webview.cspSource, script: media('channelDesigner.js'),
      styles: [media('aeDesigner.css'), media('channelDesigner.css')], title: doc.name
    });
  }

  static sessionOf(connectionId: string, channel: string): ChannelSession | undefined {
    return ChannelDesignerPanel.open.get(ChannelDesignerPanel.key(connectionId, channel))?.session;
  }

  /** After a save made elsewhere (the MCP tools): an open, unchanged window shows the stored channel. */
  static async reloadIfOpen(connectionId: string, channel: string): Promise<void> {
    const open = ChannelDesignerPanel.open.get(ChannelDesignerPanel.key(connectionId, channel));
    if (!open || open.session.dirty) return;
    const fresh = await open.host.reload();
    if (!fresh) return;
    open.session.reset(fresh.doc, fresh.token);
    open.status = 'Reloaded: the channel was saved by the PeopleSoft Studio MCP.';
    await ChannelDesignerPanel.post(open);
  }

  private static async post(open: Open, extra: Record<string, unknown> = {}): Promise<void> {
    const s = open.session;
    open.panel.title = `${s.dirty ? '● ' : ''}${s.doc.name}`;
    await open.panel.webview.postMessage({
      type: 'state', doc: s.doc, dirty: s.dirty, canUndo: s.canUndo, canRedo: s.canRedo, editable: !!open.host.save, isNew: s.token === 'absent',
      diagnostics: [...s.diagnostics(), ...open.extraDiagnostics], connection: open.host.connection.displayName,
      ...(open.status ? { status: open.status } : {}), ...extra
    });
  }

  private static async receive(open: Open, m: Message): Promise<void> {
    const s = open.session;
    try {
      switch (m.type) {
        case 'ready': await ChannelDesignerPanel.post(open); return;
        case 'op': {
          if (!open.host.save) throw new Error(`${open.host.connection.displayName} is read-only: set Access to Writable, with an Operator ID, to edit message channels.`);
          // Add Partition Field: "Invalid object name for this object type. (78,1)" unless the field exists [chn12].
          if (m.op.kind === 'addPartition' && !(await open.host.lookup.fieldExists(m.op.field))) {
            await open.panel.webview.postMessage({ type: 'addFailed', message: `Invalid object name for this object type. (78,1)\n${m.op.field.trim().toUpperCase()} is not a field.` });
            return;
          }
          s.apply(m.op);
          open.extraDiagnostics = [];
          open.status = undefined;
          await ChannelDesignerPanel.post(open);
          return;
        }
        case 'undo': s.undo(); await ChannelDesignerPanel.post(open); return;
        case 'redo': s.redo(); await ChannelDesignerPanel.post(open); return;
        case 'save': await ChannelDesignerPanel.save(open); return;
        case 'preview': {
          if (!open.host.save) return;
          const r = await open.host.save(s.doc, s.token, true);
          await open.panel.webview.postMessage({ type: 'preview', summary: r.plan.summary, increments: r.plan.increments, empty: r.plan.empty });
          return;
        }
        case 'reload': {
          if (s.dirty) {
            const ok = await vscode.window.showWarningMessage(`Discard your unsaved changes to ${s.doc.name} and reload it from the database?`, { modal: true }, 'Reload');
            if (ok !== 'Reload') return;
          }
          const fresh = await open.host.reload();
          if (!fresh) throw new Error(`${s.doc.name} no longer exists in the database.`);
          s.reset(fresh.doc, fresh.token);
          open.status = 'Reloaded from the database.';
          await ChannelDesignerPanel.post(open);
          return;
        }
        case 'validate': {
          open.extraDiagnostics = await validateChannelReferences(s.doc, open.host.lookup);
          const all = [...s.diagnostics(), ...open.extraDiagnostics];
          open.status = `Validated: ${all.filter((d) => d.severity === 'error').length} errors, ${all.filter((d) => d.severity === 'warning').length} warnings.`;
          await ChannelDesignerPanel.post(open);
          return;
        }
        case 'openMessage': await open.host.openMessage(m.message); return;
        case 'choices': {
          const items = await open.host.choices(m.what, m.arg ?? '');
          await open.panel.webview.postMessage({ type: 'choices', id: m.id, items });
          return;
        }
        case 'saveAs': {
          if (!open.host.saveAs) return;
          const name = await askChannelName(`Save ${s.doc.name} As`, s.doc.name);
          if (!name) return;
          await open.host.saveAs(s.doc, name);
          return;
        }
        case 'rename': {
          if (!open.host.rename) return;
          if (s.dirty) throw new Error('Save or reload your changes before renaming the message channel.');
          if (s.token === 'absent') throw new Error('Save the new message channel before renaming it.');
          const name = await askChannelName(`Rename ${s.doc.name}`, s.doc.name);
          if (!name || name === s.doc.name) return;
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to rename '${s.doc.name}' to '${name}'?`,
            { modal: true, detail: 'Messages naming the channel and project items are repointed, as App Designer\'s Rename does.' }, 'Yes');
          if (ok !== 'Yes') return;
          await open.host.rename(s.doc.name, name, s.token);
          open.panel.dispose();
          return;
        }
        case 'deleteChannel': {
          if (!open.host.remove) return;
          if (s.token === 'absent') { open.panel.dispose(); return; }
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to delete ${s.doc.name} definition?`,
            { modal: true, detail: 'Its rows are deleted, as App Designer\'s Delete does; messages naming it keep the name.' }, 'Yes');
          if (ok !== 'Yes') return;
          await open.host.remove(s.doc.name, s.token);
          open.panel.dispose();
          return;
        }
      }
    } catch (error) {
      await open.panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private static async save(open: Open): Promise<void> {
    const s = open.session;
    if (!open.host.save) throw new Error('This connection is read-only.');
    const errors = s.diagnostics().filter((d) => d.severity === 'error');
    if (errors.length) {
      await open.panel.webview.postMessage({ type: 'error', message: `Not saved: ${errors.length} error(s). ${errors[0].path}: ${errors[0].message}` });
      return;
    }
    try {
      const r = await open.host.save(s.doc, s.token);
      const fresh = await open.host.reload();
      if (fresh) s.reset(fresh.doc, fresh.token);
      const moved = Object.entries(r.plan.increments).filter(([, d]) => d).map(([n, d]) => `${n} +${d}`).join(', ');
      open.status = r.written ? `Saved ${s.doc.name} (${r.plan.statements.length} statements; ${moved}).` : 'Nothing to save.';
      open.extraDiagnostics = [];
      await ChannelDesignerPanel.post(open);
    } catch (error) {
      await open.panel.webview.postMessage({ type: 'error', message: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
}

async function askChannelName(title: string, value: string): Promise<string | undefined> {
  return (await vscode.window.showInputBox({
    title, value, prompt: 'Message channel name (at most 30: A-Z, 0-9, _)',
    validateInput: (v) => (/^[A-Z0-9_#@$]{1,30}$/.test(v.trim().toUpperCase()) ? undefined : 'At most 30 characters: A-Z, 0-9 and _.')
  }))?.trim().toUpperCase();
}

type Message =
  | { type: 'ready' } | { type: 'undo' } | { type: 'redo' } | { type: 'save' } | { type: 'preview' } | { type: 'reload' } | { type: 'validate' }
  | { type: 'saveAs' } | { type: 'rename' } | { type: 'deleteChannel' }
  | { type: 'op'; op: ChannelOp }
  | { type: 'openMessage'; message: string }
  | { type: 'choices'; id: number; what: 'owners' | 'fields'; arg?: string };

let extensionUriValue: vscode.Uri | undefined;
export function setChannelDesignerExtensionUri(uri: vscode.Uri): void { extensionUriValue = uri; }
function extensionUri(): vscode.Uri {
  if (!extensionUriValue) throw new Error('The Message Channel window is not initialized.');
  return extensionUriValue;
}
