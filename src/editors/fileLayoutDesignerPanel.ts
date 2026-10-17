import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { validateFileLayout, type FileLayoutDocument, type RecordFieldInfo } from '../model/fileLayoutDocument.js';
import { applyFileLayoutOperations, fileLayoutOperation, fileLayoutView, type FileLayoutOperation } from '../model/fileLayoutOperations.js';
import type { FileLayoutSaveResult } from '../providers/fileLayoutWriter.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The File Layout window: App Designer's -- the layout tree (the layout, its
 * segments, their fields), the property dialogs as a side panel (File Layout
 * Definition, Segment, Field), Insert Record / Segment / ChildSegment /
 * FileField, Delete, move up / down, Save, Save As, Rename, Delete -- in a VS
 * Code webview. The document lives here; the webview shows it and sends the
 * same operations the MCP tools take (model/fileLayoutOperations.ts).
 */

export interface FileLayoutDesignerHost {
  connection: { id: string; displayName: string };
  /** Undefined when the connection cannot save (read-only). */
  save?: (doc: FileLayoutDocument, token: string, dryRun?: boolean) => Promise<FileLayoutSaveResult>;
  reload: () => Promise<{ doc: FileLayoutDocument; token: string } | undefined>;
  recordFields: (record: string) => Promise<RecordFieldInfo[]>;
  saveAs?: (doc: FileLayoutDocument, name: string) => Promise<void>;
  rename?: (from: string, to: string, token: string) => Promise<void>;
  remove?: (name: string, token: string) => Promise<void>;
}

/** The document with undo / redo by snapshot, and whether it differs from the stored one. */
export class FileLayoutSession {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private saved: string;
  constructor(public doc: FileLayoutDocument, public token: string) { this.saved = JSON.stringify(doc); }
  get dirty(): boolean { return this.token === 'absent' || JSON.stringify(this.doc) !== this.saved; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  async apply(ops: FileLayoutOperation[], records: (r: string) => Promise<RecordFieldInfo[]>): Promise<string[]> {
    const before = JSON.stringify(this.doc);
    const draft = JSON.parse(before) as FileLayoutDocument;
    const done = await applyFileLayoutOperations(draft, ops, records);
    this.undoStack.push(before);
    this.redoStack = [];
    this.doc = draft;
    return done;
  }
  undo(): void { const s = this.undoStack.pop(); if (s) { this.redoStack.push(JSON.stringify(this.doc)); this.doc = JSON.parse(s); } }
  redo(): void { const s = this.redoStack.pop(); if (s) { this.undoStack.push(JSON.stringify(this.doc)); this.doc = JSON.parse(s); } }
  reset(doc: FileLayoutDocument, token: string): void { this.doc = doc; this.token = token; this.saved = JSON.stringify(doc); this.undoStack = []; this.redoStack = []; }
}

interface Open { panel: vscode.WebviewPanel; session: FileLayoutSession; host: FileLayoutDesignerHost; status?: string }

type Message =
  | { type: 'ready' } | { type: 'undo' } | { type: 'redo' } | { type: 'save' } | { type: 'preview' } | { type: 'reload' }
  | { type: 'saveAs' } | { type: 'rename' } | { type: 'deleteLayout' }
  | { type: 'ops'; ops: unknown[] }
  | { type: 'insert'; what: 'record' | 'segment' | 'child' | 'field'; segment?: string; field?: string };

export class FileLayoutDesignerPanel {
  static readonly viewType = 'psft.fileLayoutDesigner';
  private static readonly open = new Map<string, Open>();
  static key(connectionId: string, name: string): string { return `${connectionId}\u0000${name}`; }

  /** Opens (or reveals) a layout's window; token 'absent' for a new layout, which its first Save creates. */
  static show(host: FileLayoutDesignerHost, doc: FileLayoutDocument, token: string, options: { status?: string } = {}): void {
    const id = FileLayoutDesignerPanel.key(host.connection.id, doc.name);
    const existing = FileLayoutDesignerPanel.open.get(id);
    if (existing) { existing.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel(FileLayoutDesignerPanel.viewType, doc.name, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri(), 'media')] });
    panel.iconPath = new vscode.ThemeIcon('file-text');
    const open: Open = { panel, session: new FileLayoutSession(doc, token), host, ...(options.status ? { status: options.status } : {}) };
    FileLayoutDesignerPanel.open.set(id, open);
    panel.onDidDispose(() => FileLayoutDesignerPanel.open.delete(id));
    panel.webview.onDidReceiveMessage((m) => FileLayoutDesignerPanel.receive(open, m as Message));
    const media = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri(), 'media', f)).toString();
    const nonce = randomBytes(16).toString('base64');
    panel.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(media('fileLayoutDesigner.css'))}"><title>${esc(doc.name)}</title></head>
<body><div id="app"></div><script nonce="${nonce}" src="${esc(media('fileLayoutDesigner.js'))}"></script></body></html>`;
  }

  static sessionOf(connectionId: string, name: string): FileLayoutSession | undefined {
    return FileLayoutDesignerPanel.open.get(FileLayoutDesignerPanel.key(connectionId, name))?.session;
  }

  /** After a save made elsewhere (the MCP tools): an open, unchanged window shows the stored layout. */
  static async reloadIfOpen(connectionId: string, name: string): Promise<void> {
    const open = FileLayoutDesignerPanel.open.get(FileLayoutDesignerPanel.key(connectionId, name));
    if (!open || open.session.dirty) return;
    const fresh = await open.host.reload();
    if (!fresh) return;
    open.session.reset(fresh.doc, fresh.token);
    open.status = 'Reloaded: the layout was saved by the PeopleSoft Studio MCP.';
    await FileLayoutDesignerPanel.post(open);
  }

  private static async post(open: Open, extra: Record<string, unknown> = {}): Promise<void> {
    const s = open.session;
    open.panel.title = `${s.dirty ? '● ' : ''}${s.doc.name}`;
    const problems = validateFileLayout(s.doc);
    await open.panel.webview.postMessage({
      type: 'state', view: fileLayoutView(s.doc), dirty: s.dirty, canUndo: s.canUndo, canRedo: s.canRedo, editable: !!open.host.save, isNew: s.token === 'absent',
      problems, connection: open.host.connection.displayName, ...(open.status ? { status: open.status } : {}), ...extra
    });
  }

  private static async receive(open: Open, m: Message): Promise<void> {
    const s = open.session;
    try {
      switch (m.type) {
        case 'ready': await FileLayoutDesignerPanel.post(open); return;
        case 'ops': {
          FileLayoutDesignerPanel.writable(open);
          const ops = m.ops.map((o) => fileLayoutOperation.parse(o));
          await FileLayoutDesignerPanel.applyOps(open, ops);
          return;
        }
        case 'insert': {
          FileLayoutDesignerPanel.writable(open);
          const op = await FileLayoutDesignerPanel.askInsert(open, m);
          if (op) await FileLayoutDesignerPanel.applyOps(open, [op], op.op === 'insert_record' || op.op === 'insert_segment' ? { select: { kind: 'segment', segment: segmentName(op) } }
            : op.op === 'insert_field' ? { select: { kind: 'field', segment: op.segment.toUpperCase(), field: op.name.toUpperCase() } } : {});
          return;
        }
        case 'undo': s.undo(); open.status = undefined; await FileLayoutDesignerPanel.post(open); return;
        case 'redo': s.redo(); open.status = undefined; await FileLayoutDesignerPanel.post(open); return;
        case 'save': await FileLayoutDesignerPanel.save(open); return;
        case 'preview': {
          if (!open.host.save) return;
          const r = await open.host.save(s.doc, s.token, true);
          open.status = r.plan.empty ? 'Nothing to save.' : `Save would: ${r.plan.summary.changes.join('; ')} (FLM and SYS + 1).`;
          await FileLayoutDesignerPanel.post(open);
          return;
        }
        case 'reload': {
          if (s.dirty && s.token !== 'absent') {
            const ok = await vscode.window.showWarningMessage(`Discard your unsaved changes to ${s.doc.name} and reload it from the database?`, { modal: true }, 'Reload');
            if (ok !== 'Reload') return;
          }
          const fresh = await open.host.reload();
          if (!fresh) throw new Error(`${s.doc.name} is not in the database.`);
          s.reset(fresh.doc, fresh.token);
          open.status = 'Reloaded from the database.';
          await FileLayoutDesignerPanel.post(open);
          return;
        }
        case 'saveAs': {
          if (!open.host.saveAs) return;
          const name = await askName(`Save ${s.doc.name} As`, s.doc.name, 'File Layout name', 30);
          if (name) await open.host.saveAs(s.doc, name);
          return;
        }
        case 'rename': {
          if (!open.host.rename) return;
          if (s.token === 'absent') throw new Error('Save the new File Layout before renaming it.');
          if (s.dirty) throw new Error('Save or reload your changes before renaming the File Layout.');
          const name = await askName(`Rename ${s.doc.name}`, s.doc.name, 'File Layout name', 30);
          if (!name || name === s.doc.name) return;
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to rename '${s.doc.name}' to '${name}'?`,
            { modal: true, detail: 'Project items naming it are repointed, as App Designer\'s Rename does. PeopleCode that names the layout is not changed.' }, 'Yes');
          if (ok !== 'Yes') return;
          await open.host.rename(s.doc.name, name, s.token);
          open.panel.dispose();
          return;
        }
        case 'deleteLayout': {
          if (!open.host.remove) return;
          if (s.token === 'absent') { open.panel.dispose(); return; }
          const ok = await vscode.window.showWarningMessage(`Are you sure you want to delete ${s.doc.name} definition?`, { modal: true, detail: 'Its rows are deleted, as App Designer\'s Delete does.' }, 'Yes');
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

  private static writable(open: Open): void {
    if (!open.host.save) throw new Error(`${open.host.connection.displayName} is read-only: set Access to Writable, with an Operator ID, to edit File Layouts.`);
  }

  private static async applyOps(open: Open, ops: FileLayoutOperation[], extra: Record<string, unknown> = {}): Promise<void> {
    const done = await open.session.apply(ops, open.host.recordFields);
    open.status = done.join('; ');
    await FileLayoutDesignerPanel.post(open, extra);
  }

  /** The Insert menu's dialogs, as input boxes: a record (it must exist), or a segment / field name and a field's type and length. */
  private static async askInsert(open: Open, m: Extract<Message, { type: 'insert' }>): Promise<FileLayoutOperation | undefined> {
    const s = open.session.doc;
    if (m.what === 'record') {
      const record = await askName('Insert Record', '', 'Record name (its fields become the segment\'s file fields)', 15, async (r) =>
        (await open.host.recordFields(r)).length ? undefined : `There is no record named ${r}.`);
      if (!record) return undefined;
      return { op: 'insert_record', record, ...(m.segment ? { after: m.segment } : {}) };
    }
    if (m.what === 'segment' || m.what === 'child') {
      if (m.what === 'child' && !m.segment) throw new Error('Select the segment to add a child segment to.');
      const name = await askName(m.what === 'child' ? `Insert Child Segment under ${m.segment}` : 'Insert Segment', '', 'File Record Name (the segment\'s name)', 15,
        async (n) => (s.segments.some((x) => x.name === n) ? `${s.name} already has a segment ${n}.` : undefined));
      if (!name) return undefined;
      return m.what === 'child' ? { op: 'insert_segment', name, parent: m.segment! } : { op: 'insert_segment', name, ...(m.segment ? { after: m.segment } : {}) };
    }
    if (!m.segment) throw new Error('Select the segment to add a file field to.');
    const segment = s.segments.find((x) => x.name === m.segment);
    const name = await askName(`Insert File Field into ${m.segment}`, '', 'Field Name', 18, async (n) => (segment?.fields.some((f) => f.name === n) ? `${m.segment} already has a field ${n}.` : undefined));
    if (!name) return undefined;
    const type = await vscode.window.showQuickPick(['Character', 'Number', 'Signed Number', 'Date', 'Time', 'Datetime'], { title: `Insert File Field ${name}`, placeHolder: 'Field Type' });
    if (!type) return undefined;
    const length = await vscode.window.showInputBox({ title: `Insert File Field ${name}`, prompt: 'Length', value: type === 'Date' ? '10' : '',
      validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : 'A whole number.') });
    if (length === undefined) return undefined;
    return { op: 'insert_field', segment: m.segment, name, type: type as never, length: Number(length), decimals: 0, ...(m.field ? { after: m.field } : {}) };
  }

  private static async save(open: Open): Promise<void> {
    const s = open.session;
    if (!open.host.save) throw new Error('This connection is read-only.');
    const errors = validateFileLayout(s.doc).filter((p) => p.severity === 'error');
    if (errors.length) { await open.panel.webview.postMessage({ type: 'error', message: `Not saved: ${errors[0].path}: ${errors[0].message}` }); return; }
    try {
      const r = await open.host.save(s.doc, s.token);
      const fresh = await open.host.reload();
      if (fresh) s.reset(fresh.doc, fresh.token);
      open.status = r.written ? `Saved ${s.doc.name} (version ${r.version}): ${r.plan.summary.changes.join('; ')}.` : 'Nothing to save.';
      await FileLayoutDesignerPanel.post(open);
    } catch (error) {
      await open.panel.webview.postMessage({ type: 'error', message: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
}

function segmentName(op: FileLayoutOperation): string {
  return op.op === 'insert_record' ? op.record.toUpperCase() : op.op === 'insert_segment' ? op.name.toUpperCase() : '';
}

async function askName(title: string, value: string, prompt: string, max: number, check?: (n: string) => Promise<string | undefined>): Promise<string | undefined> {
  return (await vscode.window.showInputBox({
    title, value, prompt: `${prompt} (at most ${max}: A-Z, 0-9, _)`, ignoreFocusOut: true,
    validateInput: async (v) => {
      const n = v.trim().toUpperCase();
      if (!new RegExp(`^[A-Z][A-Z0-9_#@$]{0,${max - 1}}$`).test(n)) return `A letter, then up to ${max - 1} letters, digits or _.`;
      return check ? check(n) : undefined;
    }
  }))?.trim().toUpperCase();
}

let extensionUriValue: vscode.Uri | undefined;
export function setFileLayoutDesignerExtensionUri(uri: vscode.Uri): void { extensionUriValue = uri; }
function extensionUri(): vscode.Uri {
  if (!extensionUriValue) throw new Error('The File Layout window is not initialized.');
  return extensionUriValue;
}
