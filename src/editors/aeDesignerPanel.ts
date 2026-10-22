import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ActionType } from '../model/appEngine.js';
import { ACTION_LABELS } from '../model/appEngine.js';
import { findAction, findStep, type AeDocStep, type AeDocument, type AeVariantKey } from '../model/aeDocument.js';
import { AeSession, selectionAfter, type AeOp, type SelectionRef } from '../model/aeSession.js';
import { validateAppEngine, validateAppEngineReferences, variantPath, type AeDiagnostic, type AeReferenceLookup } from '../model/aeValidation.js';
import { compileForSave, prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import type { AeSaveResult } from '../providers/appEngineWriter.js';
import { renderAeDesignerHtml } from './aeDesignerHtml.js';

/*
 * The App Engine Designer: App Designer's App Engine program window
 * (Definition and Program Flow views, the property dialogs, Insert / Cut /
 * Copy / Paste / Delete, Save) in a VS Code webview. The document lives
 * here, in an AeSession; the webview shows it and sends operations
 * (model/aeSession.ts AeOp), which the session applies with App Designer's
 * own rules (model/aeDocument.ts). SQL, XSLT and PeopleCode open as VS Code
 * text editors on the psft-ae: file system below, bound to the session:
 * saving one writes the text into the document and saves the program.
 */

export interface AeDesignerHost {
  connection: { id: string; displayName: string };
  /** Undefined when the connection cannot save (read-only). */
  save?: (doc: AeDocument, token: string, dryRun?: boolean) => Promise<AeSaveResult>;
  reload: () => Promise<{ doc: AeDocument; token: string } | undefined>;
  lookup: AeReferenceLookup;
  choices: (what: 'owners' | 'markets' | 'stateRecords' | 'tempTables' | 'programs' | 'sections', prefix?: string) => Promise<{ value: string; label?: string }[]>;
  toolsRelease: () => Promise<string>;
  /** Opens another program (Call Section's target). */
  openProgram: (name: string) => Promise<void>;
  /** Save As, Rename, Delete (absent when read-only); each opens or closes windows as App Designer does. */
  saveAs?: (doc: AeDocument, name: string) => Promise<void>;
  rename?: (from: string, to: string, token: string) => Promise<void>;
  remove?: (name: string, token: string) => Promise<void>;
}

interface Open {
  panel: vscode.WebviewPanel;
  session: AeSession;
  host: AeDesignerHost;
  extraDiagnostics: AeDiagnostic[];
  status?: string;
}

/** The step clipboard, per connection: App Designer's Copy / Paste of steps. */
const clipboards = new Map<string, AeDocStep>();

export class AeDesignerPanel {
  static readonly viewType = 'psft.aeDesigner';
  private static readonly open = new Map<string, Open>();
  private static fs: AeTextFileSystem | undefined;

  static register(context: vscode.ExtensionContext): void {
    AeDesignerPanel.fs = new AeTextFileSystem();
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('psft-ae', AeDesignerPanel.fs, { isCaseSensitive: true }));
  }

  static key(connectionId: string, program: string): string { return `${connectionId}\u0000${program}`; }

  /** Opens (or reveals) a program's designer; token 'absent' for a new program, which its first Save creates. */
  static show(host: AeDesignerHost, doc: AeDocument, token: string, options: { status?: string } = {}): void {
    const id = AeDesignerPanel.key(host.connection.id, doc.name);
    const existing = AeDesignerPanel.open.get(id);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(AeDesignerPanel.viewType, doc.name,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri(), 'media')] });
    const session = new AeSession(doc, token);
    const open: Open = { panel, session, host, extraDiagnostics: [], ...(options.status ? { status: options.status } : {}) };
    AeDesignerPanel.open.set(id, open);
    panel.onDidDispose(() => AeDesignerPanel.open.delete(id));
    panel.webview.onDidReceiveMessage((m) => AeDesignerPanel.receive(open, m as Message));
    panel.webview.html = renderAeDesignerHtml({
      nonce: randomBytes(16).toString('base64'),
      cspSource: panel.webview.cspSource,
      script: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri(), 'media', 'aeDesigner.js')).toString(),
      style: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri(), 'media', 'aeDesigner.css')).toString(),
      title: doc.name
    });
  }

  /** The session of an open program (for the psft-ae: file system and the MCP tools). */
  static sessionOf(connectionId: string, program: string): AeSession | undefined {
    return AeDesignerPanel.open.get(AeDesignerPanel.key(connectionId, program))?.session;
  }

  /** Re-shows a session's state after a change made elsewhere (a text editor's save, an MCP edit). */
  static async refresh(connectionId: string, program: string, select?: SelectionRef): Promise<void> {
    const open = AeDesignerPanel.open.get(AeDesignerPanel.key(connectionId, program));
    if (open) await AeDesignerPanel.post(open, select);
  }

  /** After a save made elsewhere (the MCP tools): an open, unchanged designer shows the stored program. */
  static async reloadIfOpen(connectionId: string, program: string): Promise<void> {
    const open = AeDesignerPanel.open.get(AeDesignerPanel.key(connectionId, program));
    if (!open || open.session.dirty) return;
    const fresh = await open.host.reload();
    if (!fresh) return;
    open.session.reset(fresh.doc, fresh.token);
    open.status = 'Reloaded: the program was saved by the PeopleSoft Studio MCP.';
    await AeDesignerPanel.post(open);
  }

  /** Saves an open program (the text editors' save). */
  static async saveOpen(connectionId: string, program: string): Promise<void> {
    const open = AeDesignerPanel.open.get(AeDesignerPanel.key(connectionId, program));
    if (open) await AeDesignerPanel.save(open);
  }

  private static async post(open: Open, select?: SelectionRef, extra: Record<string, unknown> = {}): Promise<void> {
    const s = open.session;
    open.panel.title = `${s.dirty ? '● ' : ''}${s.doc.name}`;
    await open.panel.webview.postMessage({
      type: 'state', doc: s.doc, dirty: s.dirty, canUndo: s.canUndo, canRedo: s.canRedo, editable: !!open.host.save,
      isNew: s.token === 'absent', diagnostics: [...s.diagnostics(), ...open.extraDiagnostics],
      connection: open.host.connection.displayName, ...(select ? { select } : {}), ...(open.status ? { status: open.status } : {}), ...extra
    });
  }

  private static async receive(open: Open, m: Message): Promise<void> {
    const s = open.session;
    try {
      switch (m.type) {
        case 'ready':
          await AeDesignerPanel.post(open, { section: s.doc.sections[0]?.name });
          return;
        case 'op': {
          if (!open.host.save) throw new Error(`${open.host.connection.displayName} is read-only: set Access to Writable, with an Operator ID, to edit App Engine programs.`);
          const before = s.doc;
          s.apply(m.op);
          open.extraDiagnostics = [];
          open.status = undefined;
          await AeDesignerPanel.post(open, selectionAfter(before, s.doc, m.op));
          return;
        }
        case 'undo': s.undo(); await AeDesignerPanel.post(open); return;
        case 'redo': s.redo(); await AeDesignerPanel.post(open); return;
        case 'run': {
          if (s.dirty || s.token === 'absent') throw new Error('Save the App Engine program before running.');
          await vscode.commands.executeCommand('psft.process.run', open.host.connection.id, s.doc.name); return;
        }
        case 'save': await AeDesignerPanel.save(open); return;
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
          await AeDesignerPanel.post(open);
          return;
        }
        case 'validate': {
          open.extraDiagnostics = await AeDesignerPanel.deepValidate(open);
          const n = [...s.diagnostics(), ...open.extraDiagnostics];
          open.status = `Validated: ${n.filter((d) => d.severity === 'error').length} errors, ${n.filter((d) => d.severity === 'warning').length} warnings.`;
          await AeDesignerPanel.post(open);
          return;
        }
        case 'openText': await AeDesignerPanel.openText(open, m.ref, m.action); return;
        case 'copy': {
          const { step } = findStep(s.doc, m.ref);
          clipboards.set(open.host.connection.id, structuredClone(step));
          open.status = `Copied step ${step.name}.`;
          await AeDesignerPanel.post(open, undefined, { clipboard: step.name });
          return;
        }
        case 'paste': {
          const step = clipboards.get(open.host.connection.id);
          if (!step) throw new Error('Nothing to paste: copy a step first.');
          const op: AeOp = { kind: 'pasteStep', step, target: m.target };
          const before = s.doc;
          s.apply(op);
          await AeDesignerPanel.post(open, selectionAfter(before, s.doc, op));
          return;
        }
        case 'choices': {
          const items = await open.host.choices(m.what, m.prefix ?? '');
          await open.panel.webview.postMessage({ type: 'choices', id: m.id, items });
          return;
        }
        case 'openProgram': await open.host.openProgram(m.name); return;
        case 'saveAs': {
          if (!open.host.saveAs) return;
          const name = await askProgramName(`Save ${s.doc.name} As`, s.doc.name);
          if (!name) return;
          await open.host.saveAs(s.doc, name);
          return;
        }
        case 'rename': {
          if (!open.host.rename) return;
          if (s.dirty) throw new Error('Save or reload your changes before renaming the program.');
          if (s.token === 'absent') throw new Error('Save the new program before renaming it.');
          const name = await askProgramName(`Rename ${s.doc.name}`, s.doc.name);
          if (!name || name === s.doc.name) return;
          await open.host.rename(s.doc.name, name, s.token);
          open.panel.dispose();
          return;
        }
        case 'delete': {
          if (!open.host.remove) return;
          if (s.token === 'absent') { open.panel.dispose(); return; }
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to delete ${s.doc.name} definition?`,
            { modal: true, detail: 'Its sections, steps, SQL and PeopleCode are deleted, as App Designer\'s Delete does.' }, 'Delete');
          if (ok !== 'Delete') return;
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
      open.status = r.written ? `Saved ${s.doc.name} (${describe(r)}).` : 'Nothing to save.';
      open.extraDiagnostics = [];
      await AeDesignerPanel.post(open);
      AeDesignerPanel.fs?.changed(open.host.connection.id, s.doc.name);
    } catch (error) {
      await open.panel.webview.postMessage({ type: 'error', message: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  /** Validation with the database's answers (records, called programs, messages) and every PeopleCode action compiled. */
  private static async deepValidate(open: Open): Promise<AeDiagnostic[]> {
    const doc = open.session.doc;
    const out = await validateAppEngineReferences(doc, open.host.lookup);
    const release = await open.host.toolsRelease();
    for (const sec of doc.sections) for (const v of sec.variants) for (const st of v.steps) {
      const pc = st.actions.find((a) => a.type === 'P');
      if (!pc?.peopleCode?.trim()) continue;
      try {
        compileForSave(prepareSourceForSave(pc.peopleCode), { applicationClass: false, recordName: '', fieldName: '' }, release);
      } catch (e) {
        out.push({ severity: 'error', code: 'peoplecode-compile', path: `${variantPath(sec.name, v)}.${st.name}.PeopleCode`,
          message: e instanceof Error ? e.message : String(e), at: { section: sec.name, variant: v, step: st.name, action: 'P' } });
      }
    }
    void validateAppEngine;
    return out;
  }

  private static async openText(open: Open, ref: { section: string; variant?: AeVariantKey; step: string }, type: ActionType): Promise<void> {
    const s = open.session;
    const { section, variant } = findStep(s.doc, ref);
    findAction(s.doc, { ...ref, type });
    const v = variant;
    const ext = type === 'P' ? 'peoplecode' : type === 'X' ? 'xsl' : 'pssql';
    const uri = vscode.Uri.from({
      scheme: 'psft-ae',
      path: `/${encodeURIComponent(open.host.connection.id)}/${s.doc.name}/${section.name}/${v.market}.${v.dbType.trim() || 'default'}.${v.effdt}/${ref.step}/${ACTION_LABELS[type].replace(/ /g, '')}.${ext}`
    });
    const document = await vscode.workspace.openTextDocument(uri);
    const language = type === 'P' ? 'psft-peoplecode' : type === 'X' ? 'xml' : 'psft-sql';
    try { await vscode.languages.setTextDocumentLanguage(document, language); } catch { /* the language may not be installed */ }
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }
}

function describe(r: AeSaveResult): string {
  const moved = Object.entries(r.plan.increments).filter(([, d]) => d).map(([n, d]) => `${n} +${d}`).join(', ');
  return `${r.plan.statements.length} statements; ${moved}`;
}

async function askProgramName(title: string, value: string): Promise<string | undefined> {
  return (await vscode.window.showInputBox({
    title, value, prompt: 'Program name (at most 12: A-Z, 0-9, _)',
    validateInput: (v) => (/^[A-Z0-9_#@$]{1,12}$/.test(v.trim().toUpperCase()) ? undefined : 'At most 12 characters: A-Z, 0-9 and _.')
  }))?.trim().toUpperCase();
}

type Message =
  | { type: 'saveAs' } | { type: 'rename' } | { type: 'delete' }
  | { type: 'run' } | { type: 'ready' } | { type: 'undo' } | { type: 'redo' } | { type: 'save' } | { type: 'preview' } | { type: 'reload' } | { type: 'validate' }
  | { type: 'op'; op: AeOp }
  | { type: 'openText'; ref: { section: string; variant?: AeVariantKey; step: string }; action: ActionType }
  | { type: 'copy'; ref: { section: string; variant?: AeVariantKey; step: string } }
  | { type: 'paste'; target: { section: string; variant?: AeVariantKey; after?: string } }
  | { type: 'choices'; id: number; what: 'owners' | 'markets' | 'stateRecords' | 'tempTables' | 'programs' | 'sections'; prefix?: string }
  | { type: 'openProgram'; name: string };

let extensionUriValue: vscode.Uri | undefined;
export function setAeDesignerExtensionUri(uri: vscode.Uri): void { extensionUriValue = uri; }
function extensionUri(): vscode.Uri {
  if (!extensionUriValue) throw new Error('The App Engine Designer is not initialized.');
  return extensionUriValue;
}

/**
 * psft-ae:/<connection>/<program>/<section>/<market>.<platform>.<effdt>/<step>/<Action>.<ext>
 * -- an action's SQL, XSLT or PeopleCode in an open designer's document.
 * Writing it puts the text into the document and saves the program, as
 * saving App Designer's SQL or PeopleCode editor saves it.
 */
class AeTextFileSystem implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;
  private readonly times = new Map<string, number>();

  changed(connectionId: string, program: string): void {
    const prefix = `/${encodeURIComponent(connectionId)}/${program}/`;
    const events: vscode.FileChangeEvent[] = [];
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === 'psft-ae' && doc.uri.path.startsWith(prefix)) {
        this.times.set(doc.uri.toString(), Date.now());
        events.push({ type: vscode.FileChangeType.Changed, uri: doc.uri });
      }
    }
    if (events.length) this.emitter.fire(events);
  }

  private parse(uri: vscode.Uri) {
    const [conn, program, section, variant, step, file] = uri.path.split('/').slice(1);
    const [market, platform, effdt] = variant.split('.');
    const dbType = platform === 'default' ? ' ' : platform;
    const label = file.replace(/\.[^.]+$/, '');
    const type = (Object.entries(ACTION_LABELS).find(([, l]) => l.replace(/ /g, '') === label)?.[0]) as ActionType;
    const connectionId = decodeURIComponent(conn);
    const session = AeDesignerPanel.sessionOf(connectionId, program);
    if (!session) throw vscode.FileSystemError.Unavailable(`${program} is not open in the App Engine Designer.`);
    return { connectionId, program, session, ref: { section, variant: { market, dbType, effdt }, step, type } };
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const t = this.times.get(uri.toString()) ?? 1;
    return { type: vscode.FileType.File, ctime: 1, mtime: t, size: this.readFile(uri).length };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const { session, ref } = this.parse(uri);
    const { action } = findAction(session.doc, ref);
    return Buffer.from((ref.type === 'P' ? action.peopleCode : action.text) ?? '', 'utf8');
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { connectionId, program, session, ref } = this.parse(uri);
    const text = Buffer.from(content).toString('utf8');
    session.apply({ kind: 'setAction', ref, patch: ref.type === 'P' ? { peopleCode: text } : { text } });
    this.times.set(uri.toString(), Date.now());
    await AeDesignerPanel.refresh(connectionId, program, { section: ref.section, variant: ref.variant, step: ref.step, action: ref.type });
    await AeDesignerPanel.saveOpen(connectionId, program);
  }

  watch(): vscode.Disposable { return new vscode.Disposable(() => { /* no watching needed */ }); }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory(): void { throw vscode.FileSystemError.NoPermissions('psft-ae'); }
  delete(): void { throw vscode.FileSystemError.NoPermissions('psft-ae'); }
  rename(): void { throw vscode.FileSystemError.NoPermissions('psft-ae'); }
}
