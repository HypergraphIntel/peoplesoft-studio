import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { allItems, findItem, MENU_PC_EVENT, type MenuDocItem, type MenuDocument } from '../model/menuDocument.js';
import { MenuSession, menuSelectionAfter, validateMenu, validateMenuReferences, type MenuDiagnostic, type MenuOp, type MenuReferenceLookup, type MenuSelection } from '../model/menuSession.js';
import { compileForSave, prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import type { MenuSaveResult } from '../providers/menuWriter.js';
import { renderMenuDesignerHtml } from './menuDesignerHtml.js';

/*
 * The Menu Designer: App Designer's menu window -- the menu bar with its bars
 * and their items (a popup menu's items alone), the dashed slots that add a
 * bar or an item, Menu / Bar Item / Menu Item Properties with Transfer
 * Properties, Cut / Copy / Paste / Delete, drag to reorder, Save -- in a VS
 * Code webview. The document lives here, in a MenuSession; the webview shows
 * it and sends operations (model/menuSession.ts MenuOp) that the session
 * applies with App Designer's rules (model/menuDocument.ts). An item's
 * ItemSelected PeopleCode opens as a VS Code editor on psft-menu:, bound to
 * the session: saving it writes it into the document and saves the menu.
 */

export type MenuChoice = 'owners' | 'groups' | 'components' | 'records' | 'portals' | 'nodes' | 'menus' | 'menuComponents' | 'pages' | 'actions';

export interface MenuDesignerHost {
  connection: { id: string; displayName: string };
  /** Undefined when the connection cannot save (read-only). */
  save?: (doc: MenuDocument, token: string, dryRun?: boolean) => Promise<MenuSaveResult>;
  reload: () => Promise<{ doc: MenuDocument; token: string } | undefined>;
  lookup: MenuReferenceLookup;
  choices: (what: MenuChoice, arg?: string) => Promise<Array<{ value: string; label?: string; order?: number; separator?: boolean }>>;
  toolsRelease: () => Promise<string>;
  /** View Definition on a component item. */
  openComponent: (component: string, market: string) => Promise<void>;
  saveAs?: (doc: MenuDocument, name: string, withPeopleCode: boolean) => Promise<void>;
  rename?: (from: string, to: string, token: string) => Promise<void>;
  remove?: (name: string, token: string) => Promise<void>;
}

interface Open {
  panel: vscode.WebviewPanel;
  session: MenuSession;
  host: MenuDesignerHost;
  groups: Map<string, { order: number; separator: boolean }>;
  extraDiagnostics: MenuDiagnostic[];
  status?: string;
}

/** The item clipboard, per connection: App Designer's Copy / Cut and Paste of menu items. */
const clipboards = new Map<string, MenuDocItem>();

export class MenuDesignerPanel {
  static readonly viewType = 'psft.menuDesigner';
  private static readonly open = new Map<string, Open>();
  private static fs: MenuPeopleCodeFileSystem | undefined;

  static register(context: vscode.ExtensionContext): void {
    MenuDesignerPanel.fs = new MenuPeopleCodeFileSystem();
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('psft-menu', MenuDesignerPanel.fs, { isCaseSensitive: true }));
  }

  static key(connectionId: string, menu: string): string { return `${connectionId}\u0000${menu}`; }

  /** Opens (or reveals) a menu's designer; token 'absent' for a new menu, which its first Save creates. */
  static show(host: MenuDesignerHost, doc: MenuDocument, token: string, options: { status?: string } = {}): void {
    const id = MenuDesignerPanel.key(host.connection.id, doc.name);
    const existing = MenuDesignerPanel.open.get(id);
    if (existing) { existing.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel(MenuDesignerPanel.viewType, doc.name, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri(), 'media')] });
    const open: Open = { panel, session: new MenuSession(doc, token), host, groups: new Map(), extraDiagnostics: [], ...(options.status ? { status: options.status } : {}) };
    MenuDesignerPanel.open.set(id, open);
    panel.onDidDispose(() => MenuDesignerPanel.open.delete(id));
    panel.webview.onDidReceiveMessage((m) => MenuDesignerPanel.receive(open, m as Message));
    const media = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri(), 'media', f)).toString();
    panel.webview.html = renderMenuDesignerHtml({
      nonce: randomBytes(16).toString('base64'), cspSource: panel.webview.cspSource, script: media('menuDesigner.js'),
      styles: [media('aeDesigner.css'), media('menuDesigner.css')], title: doc.name
    });
    void host.choices('groups').then((g) => { for (const x of g) open.groups.set(x.value, { order: x.order ?? 0, separator: !!x.separator }); }).catch(() => undefined);
  }

  static sessionOf(connectionId: string, menu: string): MenuSession | undefined {
    return MenuDesignerPanel.open.get(MenuDesignerPanel.key(connectionId, menu))?.session;
  }

  static async refresh(connectionId: string, menu: string, select?: MenuSelection): Promise<void> {
    const open = MenuDesignerPanel.open.get(MenuDesignerPanel.key(connectionId, menu));
    if (open) await MenuDesignerPanel.post(open, select);
  }

  /** After a save made elsewhere (the MCP tools): an open, unchanged designer shows the stored menu. */
  static async reloadIfOpen(connectionId: string, menu: string): Promise<void> {
    const open = MenuDesignerPanel.open.get(MenuDesignerPanel.key(connectionId, menu));
    if (!open || open.session.dirty) return;
    const fresh = await open.host.reload();
    if (!fresh) return;
    open.session.reset(fresh.doc, fresh.token);
    open.status = 'Reloaded: the menu was saved by the PeopleSoft Studio MCP.';
    await MenuDesignerPanel.post(open);
  }

  static async saveOpen(connectionId: string, menu: string): Promise<void> {
    const open = MenuDesignerPanel.open.get(MenuDesignerPanel.key(connectionId, menu));
    if (open) await MenuDesignerPanel.save(open);
  }

  private static async post(open: Open, select?: MenuSelection, extra: Record<string, unknown> = {}): Promise<void> {
    const s = open.session;
    open.panel.title = `${s.dirty ? '● ' : ''}${s.doc.name}`;
    await open.panel.webview.postMessage({
      type: 'state', doc: s.doc, dirty: s.dirty, canUndo: s.canUndo, canRedo: s.canRedo, editable: !!open.host.save, isNew: s.token === 'absent',
      diagnostics: [...s.diagnostics(), ...open.extraDiagnostics], connection: open.host.connection.displayName,
      clipboard: clipboards.get(open.host.connection.id)?.name ?? null,
      groups: [...open.groups].map(([value, g]) => ({ value, ...g })),
      ...(select ? { select } : {}), ...(open.status ? { status: open.status } : {}), ...extra
    });
  }

  private static async receive(open: Open, m: Message): Promise<void> {
    const s = open.session;
    try {
      switch (m.type) {
        case 'ready': await MenuDesignerPanel.post(open); return;
        case 'op': {
          if (!open.host.save) throw new Error(`${open.host.connection.displayName} is read-only: set Access to Writable, with an Operator ID, to edit menus.`);
          const before = s.doc;
          s.apply(m.op, open.groups);
          open.extraDiagnostics = [];
          open.status = undefined;
          await MenuDesignerPanel.post(open, menuSelectionAfter(before, s.doc, m.op) ?? m.select);
          return;
        }
        case 'undo': s.undo(); await MenuDesignerPanel.post(open); return;
        case 'redo': s.redo(); await MenuDesignerPanel.post(open); return;
        case 'save': await MenuDesignerPanel.save(open); return;
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
          await MenuDesignerPanel.post(open);
          return;
        }
        case 'validate': {
          open.extraDiagnostics = await MenuDesignerPanel.deepValidate(open);
          const all = [...s.diagnostics(), ...open.extraDiagnostics];
          open.status = `Validated: ${all.filter((d) => d.severity === 'error').length} errors, ${all.filter((d) => d.severity === 'warning').length} warnings.`;
          await MenuDesignerPanel.post(open);
          return;
        }
        case 'openPeopleCode': await MenuDesignerPanel.openPeopleCode(open, m.ref); return;
        case 'openComponent': await open.host.openComponent(m.component, m.market || 'GBL'); return;
        case 'copy': case 'cut': {
          const { item } = findItem(s.doc, m.ref);
          clipboards.set(open.host.connection.id, structuredClone(item));
          if (m.type === 'cut') {
            // App Designer's Cut deletes the item first ("Delete X? (40,6)") [mi14].
            const ok = await vscode.window.showWarningMessage(`Delete ${item.name}?`, { modal: true }, 'Yes');
            if (ok !== 'Yes') return;
            s.apply({ kind: 'deleteItem', ref: m.ref });
          }
          open.status = `${m.type === 'cut' ? 'Cut' : 'Copied'} ${item.name}.`;
          await MenuDesignerPanel.post(open);
          return;
        }
        case 'paste': {
          const item = clipboards.get(open.host.connection.id);
          if (!item) throw new Error('Nothing to paste: copy an item first.');
          const op: MenuOp = { kind: 'pasteItem', item, bar: m.bar, ...(m.index !== undefined ? { index: m.index } : {}) };
          const before = s.doc;
          s.apply(op);
          await MenuDesignerPanel.post(open, menuSelectionAfter(before, s.doc, op));
          return;
        }
        case 'delete': {
          // App Designer asks "Delete X? (40,6)" for an item or a bar.
          const ok = await vscode.window.showWarningMessage(`Delete ${m.ref.item ?? m.ref.bar}?`, { modal: true }, 'Yes');
          if (ok !== 'Yes') return;
          s.apply(m.ref.item ? { kind: 'deleteItem', ref: { bar: m.ref.bar, item: m.ref.item } } : { kind: 'deleteBar', bar: m.ref.bar });
          await MenuDesignerPanel.post(open);
          return;
        }
        case 'choices': {
          const items = await open.host.choices(m.what, m.arg ?? '');
          await open.panel.webview.postMessage({ type: 'choices', id: m.id, items });
          return;
        }
        case 'saveAs': {
          if (!open.host.saveAs) return;
          const name = await askMenuName(`Save ${s.doc.name} As`, s.doc.name);
          if (!name) return;
          // App Designer asks whether to copy the PeopleCode too [mn12].
          const pc = allItems(s.doc).some((x) => (x.item.peopleCode ?? '').trim())
            ? await vscode.window.showWarningMessage(`Do you wish to also save a copy of the PeopleCode associated with ${s.doc.name}?`, { modal: true }, 'Yes', 'No') : 'No';
          if (!pc) return;
          await open.host.saveAs(s.doc, name, pc === 'Yes');
          return;
        }
        case 'rename': {
          if (!open.host.rename) return;
          if (s.dirty) throw new Error('Save or reload your changes before renaming the menu.');
          if (s.token === 'absent') throw new Error('Save the new menu before renaming it.');
          const name = await askMenuName(`Rename ${s.doc.name}`, s.doc.name);
          if (!name || name === s.doc.name) return;
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to rename '${s.doc.name}' to '${name}'?`, { modal: true }, 'Yes');
          if (ok !== 'Yes') return;
          await open.host.rename(s.doc.name, name, s.token);
          open.panel.dispose();
          return;
        }
        case 'deleteMenu': {
          if (!open.host.remove) return;
          if (s.token === 'absent') { open.panel.dispose(); return; }
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to delete ${s.doc.name} definition?`,
            { modal: true, detail: 'Its bars, items and PeopleCode are deleted, as App Designer\'s Delete does; transfers in other menus that name it are left as they are.' }, 'Yes');
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
      await MenuDesignerPanel.post(open);
      MenuDesignerPanel.fs?.changed(open.host.connection.id, s.doc.name);
    } catch (error) {
      await open.panel.webview.postMessage({ type: 'error', message: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  /** Validation with the database's answers (components, records, transfer menus) and every ItemSelected program compiled. */
  private static async deepValidate(open: Open): Promise<MenuDiagnostic[]> {
    const doc = open.session.doc;
    const out = await validateMenuReferences(doc, open.host.lookup);
    const release = await open.host.toolsRelease();
    for (const { bar, item } of allItems(doc)) {
      if (item.type !== 9 || !(item.peopleCode ?? '').trim()) continue;
      try {
        compileForSave(prepareSourceForSave(item.peopleCode!), { applicationClass: false, recordName: '', fieldName: '' }, release);
      } catch (e) {
        out.push({ severity: 'error', code: 'peoplecode-compile', path: `${bar.name}.${item.name}.${MENU_PC_EVENT}`, message: e instanceof Error ? e.message : String(e), at: { bar: bar.name, item: item.name } });
      }
    }
    void validateMenu;
    return out;
  }

  private static async openPeopleCode(open: Open, ref: { bar: string; item: string }): Promise<void> {
    const { item } = findItem(open.session.doc, ref);
    if (item.type !== 9) throw new Error(`${item.name} is not a PeopleCode item: only PeopleCode items have ItemSelected PeopleCode.`);
    const uri = vscode.Uri.from({ scheme: 'psft-menu', path: `/${encodeURIComponent(open.host.connection.id)}/${open.session.doc.name}/${ref.bar}/${ref.item}/${MENU_PC_EVENT}.peoplecode` });
    const document = await vscode.workspace.openTextDocument(uri);
    try { await vscode.languages.setTextDocumentLanguage(document, 'psft-peoplecode'); } catch { /* the language may not be installed */ }
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }
}

async function askMenuName(title: string, value: string): Promise<string | undefined> {
  return (await vscode.window.showInputBox({
    title, value, prompt: 'Menu name (at most 30: A-Z, 0-9, _)',
    validateInput: (v) => (/^[A-Z0-9_#@$]{1,30}$/.test(v.trim().toUpperCase()) ? undefined : 'At most 30 characters: A-Z, 0-9 and _.')
  }))?.trim().toUpperCase();
}

type Ref = { bar: string; item: string };
type Message =
  | { type: 'ready' } | { type: 'undo' } | { type: 'redo' } | { type: 'save' } | { type: 'preview' } | { type: 'reload' } | { type: 'validate' }
  | { type: 'saveAs' } | { type: 'rename' } | { type: 'deleteMenu' }
  | { type: 'op'; op: MenuOp; select?: MenuSelection }
  | { type: 'openPeopleCode'; ref: Ref }
  | { type: 'openComponent'; component: string; market: string }
  | { type: 'copy'; ref: Ref } | { type: 'cut'; ref: Ref }
  | { type: 'paste'; bar: string; index?: number }
  | { type: 'delete'; ref: { bar: string; item?: string } }
  | { type: 'choices'; id: number; what: MenuChoice; arg?: string };

let extensionUriValue: vscode.Uri | undefined;
export function setMenuDesignerExtensionUri(uri: vscode.Uri): void { extensionUriValue = uri; }
function extensionUri(): vscode.Uri {
  if (!extensionUriValue) throw new Error('The Menu Designer is not initialized.');
  return extensionUriValue;
}

/**
 * psft-menu:/<connection>/<menu>/<bar>/<item>/ItemSelected.peoplecode -- an
 * item's ItemSelected PeopleCode in an open designer's document. Writing it
 * puts the text into the document and saves the menu, as saving App
 * Designer's PeopleCode editor does.
 */
class MenuPeopleCodeFileSystem implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;
  private readonly times = new Map<string, number>();

  changed(connectionId: string, menu: string): void {
    const prefix = `/${encodeURIComponent(connectionId)}/${menu}/`;
    const events: vscode.FileChangeEvent[] = [];
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === 'psft-menu' && doc.uri.path.startsWith(prefix)) {
        this.times.set(doc.uri.toString(), Date.now());
        events.push({ type: vscode.FileChangeType.Changed, uri: doc.uri });
      }
    }
    if (events.length) this.emitter.fire(events);
  }

  private parse(uri: vscode.Uri) {
    const [conn, menu, bar, item] = uri.path.split('/').slice(1);
    const connectionId = decodeURIComponent(conn);
    const session = MenuDesignerPanel.sessionOf(connectionId, menu);
    if (!session) throw vscode.FileSystemError.Unavailable(`${menu} is not open in the Menu Designer.`);
    return { connectionId, menu, session, ref: { bar, item } };
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    return { type: vscode.FileType.File, ctime: 1, mtime: this.times.get(uri.toString()) ?? 1, size: this.readFile(uri).length };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const { session, ref } = this.parse(uri);
    return Buffer.from(findItem(session.doc, ref).item.peopleCode ?? '', 'utf8');
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { connectionId, menu, session, ref } = this.parse(uri);
    session.apply({ kind: 'setItem', ref, item: { peopleCode: Buffer.from(content).toString('utf8') } });
    this.times.set(uri.toString(), Date.now());
    await MenuDesignerPanel.refresh(connectionId, menu, ref);
    await MenuDesignerPanel.saveOpen(connectionId, menu);
  }

  watch(): vscode.Disposable { return new vscode.Disposable(() => { /* no watching needed */ }); }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory(): void { throw vscode.FileSystemError.NoPermissions('psft-menu'); }
  delete(): void { throw vscode.FileSystemError.NoPermissions('psft-menu'); }
  rename(): void { throw vscode.FileSystemError.NoPermissions('psft-menu'); }
}
