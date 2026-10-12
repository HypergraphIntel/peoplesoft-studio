import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { CI_ROOT, type CiBuffer, type CiDocument } from '../model/ciDocument.js';
import type { CiOperation } from '../model/ciOperations.js';
import { CiSession } from '../model/ciSession.js';
import type { CiSaveResult } from '../providers/ciWriter.js';
import { renderCiDesignerHtml } from './ciDesignerHtml.js';

/*
 * The CI Designer: App Designer's Component Interface window -- the
 * component's buffer on the left (search records, Scroll - Level 0, its
 * records and fields, each scroll), the interface on the right (GETKEYS,
 * FINDKEYS, CREATEKEYS, PROPERTIES with its collections, METHODS) -- with
 * drag from left to right, Edit Property, Toggle Read Only Access, Delete,
 * Component Interface Properties (General, Standard Methods,
 * Synchronization), View PeopleCode, Save / Save As / Rename / Delete. The
 * document lives here, in a CiSession; the webview shows it and sends the
 * window's edits as operations (model/ciOperations.ts).
 */

export type CiChoice = 'owners' | 'components' | 'menus' | 'projects';

export interface CiDesignerHost {
  connection: { id: string; displayName: string };
  /** Undefined when the connection cannot save (read-only). */
  save?: (doc: CiDocument, token: string, dryRun?: boolean) => Promise<CiSaveResult>;
  reload: () => Promise<{ doc: CiDocument; token: string; buffer?: CiBuffer } | undefined>;
  choices: (what: CiChoice, arg?: string) => Promise<Array<{ value: string; label?: string }>>;
  /** The user methods: the Functions of its Methods PeopleCode. */
  userMethods: () => Promise<string[]>;
  openPeopleCode: (ci: string) => Promise<void>;
  openRecord: (record: string) => Promise<void>;
  openComponent: (component: string, market: string) => Promise<void>;
  saveAs?: (doc: CiDocument, name: string, withPeopleCode: boolean) => Promise<void>;
  rename?: (from: string, to: string, token: string) => Promise<void>;
  remove?: (name: string, token: string) => Promise<void>;
}

interface Open { panel: vscode.WebviewPanel; session: CiSession; host: CiDesignerHost; status?: string; methods: string[] }

export class CiDesignerPanel {
  static readonly viewType = 'psft.ciDesigner';
  private static readonly open = new Map<string, Open>();

  static key(connectionId: string, ci: string): string { return `${connectionId}\u0000${ci}`; }

  /** Opens (or reveals) an interface's designer; token 'absent' for a new one, which its first Save creates. */
  static show(host: CiDesignerHost, doc: CiDocument, token: string, buffer: CiBuffer | undefined, options: { status?: string } = {}): void {
    const id = CiDesignerPanel.key(host.connection.id, doc.name);
    const existing = CiDesignerPanel.open.get(id);
    if (existing) { existing.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel(CiDesignerPanel.viewType, doc.name, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri(), 'media')] });
    const open: Open = { panel, session: new CiSession(doc, token, buffer), host, methods: [], ...(options.status ? { status: options.status } : {}) };
    CiDesignerPanel.open.set(id, open);
    panel.onDidDispose(() => CiDesignerPanel.open.delete(id));
    panel.webview.onDidReceiveMessage((m) => CiDesignerPanel.receive(open, m as Message));
    const media = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri(), 'media', f)).toString();
    panel.webview.html = renderCiDesignerHtml({
      nonce: randomBytes(16).toString('base64'), cspSource: panel.webview.cspSource, script: media('ciDesigner.js'),
      styles: [media('aeDesigner.css'), media('ciDesigner.css')], title: doc.name
    });
  }

  static sessionOf(connectionId: string, ci: string): CiSession | undefined {
    return CiDesignerPanel.open.get(CiDesignerPanel.key(connectionId, ci))?.session;
  }

  /** After a save made elsewhere (the MCP tools, the PeopleCode editor): an open, unchanged designer shows what is stored. */
  static async reloadIfOpen(connectionId: string, ci: string): Promise<void> {
    const open = CiDesignerPanel.open.get(CiDesignerPanel.key(connectionId, ci));
    if (!open || open.session.dirty || open.session.token === 'absent') return;
    const fresh = await open.host.reload();
    if (!fresh) return;
    open.session.reset(fresh.doc, fresh.token, fresh.buffer);
    open.methods = await open.host.userMethods().catch(() => []);
    open.status = 'Reloaded: the interface was saved elsewhere.';
    await CiDesignerPanel.post(open);
  }

  private static async post(open: Open, extra: Record<string, unknown> = {}): Promise<void> {
    const s = open.session;
    open.panel.title = `${s.dirty ? '● ' : ''}${s.doc.name}`;
    await open.panel.webview.postMessage({
      type: 'state', doc: s.doc, buffer: s.buffer ?? null, dirty: s.dirty, canUndo: s.canUndo, canRedo: s.canRedo, editable: !!open.host.save,
      isNew: s.token === 'absent', diagnostics: s.diagnostics(), connection: open.host.connection.displayName, userMethods: open.methods,
      ...(open.status ? { status: open.status } : {}), ...extra
    });
  }

  private static async receive(open: Open, m: Message): Promise<void> {
    const s = open.session;
    try {
      switch (m.type) {
        case 'ready':
          if (s.token !== 'absent') open.methods = await open.host.userMethods().catch(() => []);
          await CiDesignerPanel.post(open);
          return;
        case 'op':
          if (!open.host.save) throw new Error(`${open.host.connection.displayName} is read-only: set Access to Writable, with an Operator ID, to edit Component Interfaces.`);
          s.apply(m.op);
          open.status = undefined;
          await CiDesignerPanel.post(open);
          return;
        case 'undo': s.undo(); await CiDesignerPanel.post(open); return;
        case 'redo': s.redo(); await CiDesignerPanel.post(open); return;
        case 'save': await CiDesignerPanel.save(open); return;
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
          s.reset(fresh.doc, fresh.token, fresh.buffer);
          open.methods = await open.host.userMethods().catch(() => []);
          open.status = 'Reloaded from the database.';
          await CiDesignerPanel.post(open);
          return;
        }
        case 'validate': {
          const all = s.diagnostics();
          // App Designer's Validate for Consistency reports to its Validate tab: "No errors found." when it finds none.
          open.status = all.length ? `Validated: ${all.filter((d) => d.severity === 'error').length} errors, ${all.filter((d) => d.severity === 'warning').length} warnings.` : 'Validated: no errors found.';
          await CiDesignerPanel.post(open);
          return;
        }
        case 'choices': await open.panel.webview.postMessage({ type: 'choices', id: m.id, items: await open.host.choices(m.what, m.arg ?? '') }); return;
        case 'openPeopleCode':
          if (s.token === 'absent') throw new Error('Save the new Component Interface before writing its PeopleCode.');
          await open.host.openPeopleCode(s.doc.name);
          return;
        case 'openRecord': await open.host.openRecord(m.record); return;
        case 'openComponent': await open.host.openComponent(s.doc.component, s.doc.market); return;
        case 'delete': {
          s.apply({ op: 'delete_item', type: m.itemType, parent: m.parent || CI_ROOT, name: m.name });
          await CiDesignerPanel.post(open);
          return;
        }
        case 'saveAs': {
          if (!open.host.saveAs) return;
          const name = await askCiName(`Save ${s.doc.name} As`, s.doc.name);
          if (!name) return;
          // App Designer asks whether to copy the PeopleCode too [ci25].
          const pc = open.methods.length || s.token !== 'absent'
            ? await vscode.window.showWarningMessage(`Do you wish to also save a copy of the PeopleCode associated with ${s.doc.name}?`, { modal: true }, 'Yes', 'No') : 'No';
          if (!pc) return;
          await open.host.saveAs(s.doc, name, pc === 'Yes');
          return;
        }
        case 'rename': {
          if (!open.host.rename) return;
          if (s.dirty) throw new Error('Save or reload your changes before renaming the interface.');
          if (s.token === 'absent') throw new Error('Save the new interface before renaming it.');
          const name = await askCiName(`Rename ${s.doc.name}`, s.doc.name);
          if (!name || name === s.doc.name) return;
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to rename '${s.doc.name}' to '${name}'?`, { modal: true }, 'Yes');
          if (ok !== 'Yes') return;
          await open.host.rename(s.doc.name, name, s.token);
          open.panel.dispose();
          return;
        }
        case 'deleteCi': {
          if (!open.host.remove) return;
          if (s.token === 'absent') { open.panel.dispose(); return; }
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to delete ${s.doc.name} definition?`,
            { modal: true, detail: 'Its items, PeopleCode and permission-list grants are deleted, as App Designer\'s Delete does.' }, 'Yes');
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
    try {
      if (!open.host.save) throw new Error('This connection is read-only.');
      const errors = s.diagnostics().filter((d) => d.severity === 'error');
      if (errors.length) throw new Error(`${errors.length} error(s). ${errors[0].path}: ${errors[0].message}`);
      const r = await open.host.save(s.doc, s.token);
      const fresh = await open.host.reload();
      if (fresh) s.reset(fresh.doc, fresh.token, fresh.buffer);
      const moved = Object.entries(r.plan.increments).filter(([, d]) => d).map(([n, d]) => `${n} +${d}`).join(', ');
      open.status = r.written ? `Saved ${s.doc.name} (${r.plan.statements.length} statements; ${moved})${r.plan.summary.renamedOnSave.length ? `; names stored: ${r.plan.summary.renamedOnSave.join(', ')}` : ''}.` : 'Nothing to save.';
      await CiDesignerPanel.post(open);
    } catch (error) {
      await open.panel.webview.postMessage({ type: 'error', message: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
}

async function askCiName(title: string, value: string): Promise<string | undefined> {
  return (await vscode.window.showInputBox({
    title, value, prompt: 'Component Interface name (at most 30: A-Z, 0-9, _)',
    validateInput: (v) => (/^[A-Z][A-Z0-9_]{0,29}$/.test(v.trim().toUpperCase()) ? undefined : 'A letter, then at most 29 of A-Z, 0-9 and _.')
  }))?.trim().toUpperCase();
}

type Message =
  | { type: 'ready' } | { type: 'undo' } | { type: 'redo' } | { type: 'save' } | { type: 'preview' } | { type: 'reload' } | { type: 'validate' }
  | { type: 'saveAs' } | { type: 'rename' } | { type: 'deleteCi' } | { type: 'openPeopleCode' } | { type: 'openComponent' }
  | { type: 'op'; op: CiOperation }
  | { type: 'delete'; itemType: 'property' | 'collection' | 'getkey' | 'findkey' | 'createkey'; parent?: string; name: string }
  | { type: 'openRecord'; record: string }
  | { type: 'choices'; id: number; what: CiChoice; arg?: string };

let extensionUriValue: vscode.Uri | undefined;
export function setCiDesignerExtensionUri(uri: vscode.Uri): void { extensionUriValue = uri; }
function extensionUri(): vscode.Uri {
  if (!extensionUriValue) throw new Error('The CI Designer is not initialized.');
  return extensionUriValue;
}
