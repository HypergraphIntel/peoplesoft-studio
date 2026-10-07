import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Workspace } from '../workspace.js';
import { parseUri } from '../util/uri.js';
import { DefinitionType, makeKey, type DefinitionKey } from '../model/definitions.js';
import type { DefinitionProvider } from '../providers/provider.js';
import { OracleProvider } from '../providers/oracle.js';
import { TranslateSaveRefusedError, type TranslateChange } from '../providers/translateWriter.js';
import { writeScopeRefusal } from '../providers/writeScope.js';
import type { RecordLayout, RecordLayoutField } from '../model/recordLayout.js';
import {
  insertField, insertSubrecord, layoutEditRefusal, moveField, RecordSaveRefusedError, removeField, removeFields, setDefault, setEdits, setLabel, setPageControl,
  RECORD_TYPE_CHANGES, inMemoryMode, setInMemory, setRecordProperties, setRecordType, setUse, type EditType, type RecordTypeEdits, type RecordEditState, type RecordPropertyEdits, type UseChange
} from '../model/recordEdit.js';
import { renderRecordHtml } from './recordHtml.js';
import { createTableScript, lobColumn } from '../model/recordDdl.js';
import {
  FIELD_TYPE_LABELS, RecordDefinition, RecordField, RecordType, UseEdit, UseEdit2, hasFlag
} from '../model/record.js';

/**
 * The record definition editor -- App Designer's record editor.
 *
 * Read-only by default. Editable where a save is proven (docs/RECORD_SAVE.md):
 * an Oracle connection set to Writable with an Operator ID, a record of a
 * shape the App Designer cases cover. Changes are held
 * in the document -- VS Code's dirty marker, undo / redo, revert -- and
 * written by Save through OracleProvider.saveRecord in one transaction.
 */
export class RecordEditorProvider implements vscode.CustomEditorProvider<RecordDocument> {
  static readonly viewType = 'psft.recordEditor';

  private static readonly documents = new Set<RecordDocument>();
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<RecordDocument>>();
  readonly onDidChangeCustomDocument = this.changed.event;

  /** `onSaved` runs after a record is saved, so the trees that list its fields refresh. */
  constructor(private readonly workspace: Workspace, private readonly onSaved: () => void = () => undefined) {}

  static register(workspace: Workspace, onSaved?: () => void): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      RecordEditorProvider.viewType,
      new RecordEditorProvider(workspace, onSaved),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false });
  }

  /** Re-read the active record editor from the provider and repaint; refused while it has unsaved changes. */
  static async refreshActive(_workspace: Workspace): Promise<void> {
    const doc = [...RecordEditorProvider.documents].find((d) => d.panels.some((p) => p.active))
      ?? (RecordEditorProvider.documents.size === 1 ? [...RecordEditorProvider.documents][0] : undefined);
    if (!doc) {
      vscode.window.showWarningMessage('No record editor is active to refresh.');
      return;
    }
    if (doc.dirty) {
      vscode.window.showWarningMessage(`${doc.recname} has unsaved changes. Save or revert them first.`);
      return;
    }
    try {
      await doc.load();
    } catch (err) {
      vscode.window.showErrorMessage(`Refresh failed: ${(err as Error).message}`);
    }
    doc.paint();
  }

  /** Records being created (New Definition): their editor opens empty, and the first save creates them. */
  static readonly pendingNew = new Map<string, RecordType>();

  /** The open editors of a record; `dirty` when any has unsaved changes. */
  static openEditors(connectionId: string, recname: string): { dirty: boolean; close: () => void } {
    const docs = [...RecordEditorProvider.documents].filter((d) => d.provider?.id === connectionId && d.recname === recname);
    return {
      dirty: docs.some((d) => d.dirty),
      close: () => { for (const d of docs) for (const p of [...d.panels]) p.dispose(); }
    };
  }

  async openCustomDocument(uri: vscode.Uri, context: vscode.CustomDocumentOpenContext): Promise<RecordDocument> {
    const doc = new RecordDocument(uri, this.workspace);
    try {
      await doc.load();
      if (context.backupId && doc.state) await doc.restore(vscode.Uri.parse(context.backupId));
    } catch (err) {
      doc.error = (err as Error).message;
    }
    RecordEditorProvider.documents.add(doc);
    return doc;
  }

  async resolveCustomEditor(doc: RecordDocument, panel: vscode.WebviewPanel): Promise<void> {
    doc.panels.push(panel);
    panel.onDidDispose(() => {
      doc.panels = doc.panels.filter((p) => p !== panel);
      if (doc.panels.length === 0) RecordEditorProvider.documents.delete(doc);
    });
    panel.webview.onDidReceiveMessage((m) => void this.onMessage(doc, m, panel.webview));
    doc.paint();
  }

  private async onMessage(doc: RecordDocument, m: unknown, webview: vscode.Webview): Promise<void> {
    const msg = m as { type?: string; from?: number; to?: number; index?: number; at?: number; flag?: string; action?: string };
    if (msg.type === 'copy') {
      await copyFields(doc, ((msg as { indexes?: number[] }).indexes ?? []).map(Number));
      return;
    }
    if (msg.type === 'menu') {
      await this.onMenu(doc, String(msg.action), Number(msg.index), webview).catch((err: Error) =>
        void vscode.window.showWarningMessage(err.message));
      return;
    }
    if (msg.type === 'xlat') {
      await this.onTranslate(doc, m as { field?: string; change?: TranslateChange }, webview);
      return;
    }
    if (msg.type === 'peoplecode') {
      // A field's Record Field PeopleCode, as App Designer opens it from the record.
      const field = doc.shownFields()[Number(msg.index)];
      if (field && !field.isSubrecord && doc.provider) {
        await vscode.commands.executeCommand('psft.openFieldPeopleCode',
          { connectionId: doc.provider.id, record: doc.recname, field: field.name });
      }
      return;
    }
    if (!doc.state) return;
    try {
      const state = doc.state;
      switch (msg.type) {
        case 'move': return this.apply(doc, moveField(state, Number(msg.from), Number(msg.to)), 'Move Field');
        case 'remove': return this.apply(doc, removeField(state, Number(msg.index)), 'Delete Field');
        case 'toggle': {
          const i = Number(msg.index);
          const f = state.fields[i];
          if (!f) return;
          let change: UseChange;
          const use2: Record<string, UseEdit2> = {
            doNotTrace: UseEdit2.DoNotTraceValue, smartPrompt: UseEdit2.SmartPrompt, smartDropDown: UseEdit2.SmartDropDown,
            inMemory: UseEdit2.InMemory
          };
          const bit2 = use2[String(msg.flag)];
          if (bit2 !== undefined) change = { [String(msg.flag)]: !hasFlag(f.useEdit2 ?? 0, bit2) };
          else {
            const bit = TOGGLE_BITS[String(msg.flag)];
            if (bit === undefined) return;
            change = { [String(msg.flag)]: !hasFlag(f.useEdit, bit) };
          }
          return this.apply(doc, setUse(state, i, change), 'Change Use');
        }
        case 'removeMany': {
          const indexes = ((msg as { indexes?: number[] }).indexes ?? []).map(Number);
          return this.apply(doc, removeFields(state, indexes), indexes.length > 1 ? 'Delete Fields' : 'Delete Field');
        }
        case 'cut': {
          const indexes = ((msg as { indexes?: number[] }).indexes ?? []).map(Number);
          await copyFields(doc, indexes);
          return this.apply(doc, removeFields(state, indexes), 'Cut');
        }
        case 'paste': {
          const names = parseClipboard(await vscode.env.clipboard.readText());
          if (names.length === 0) { void vscode.window.showInformationMessage('The clipboard holds no PeopleSoft fields to paste.'); return; }
          let next = state;
          let at = Math.min(Math.max(Number(msg.at), 0), state.fields.length);
          const skipped: string[] = [];
          for (const name of names) {
            if (next.fields.some((f) => f.name === name)) { skipped.push(name); continue; }
            await doc.describe(name);
            next = insertField(next, name, at++);
          }
          if (skipped.length) void vscode.window.showInformationMessage(`Already in ${doc.recname}, not pasted: ${skipped.join(', ')}.`);
          if (next !== state) this.apply(doc, next, 'Paste');
          return;
        }
        case 'recordType': {
          const change = (msg as { change?: RecordTypeEdits }).change ?? {};
          return this.apply(doc, setRecordType(state, doc.layout!.recordType, change), 'Change Record Type');
        }
        case 'recordProps': {
          const { inMemory, ...change } = (msg as { change?: RecordPropertyEdits }).change ?? {};
          let next = state;
          if (inMemory !== undefined) {
            if (!['off', 'all', 'selective'].includes(inMemory)) return;
            next = setInMemory(next, inMemory, {
              stored: inMemoryMode(doc.layout!.properties?.auxFlagMask ?? 0), storedType: doc.layout!.recordType,
              column: (name) => lobColumn(doc.fieldInfo(name) ?? {}) ?? ''
            });
          }
          if (Object.keys(change).length) next = setRecordProperties(next, change);
          return this.apply(doc, next, 'Change Record Properties');
        }
        case 'edits': {
          const m2 = msg as { index?: number; required?: boolean; edit?: EditType; promptTable?: string };
          return this.apply(doc, setEdits(state, Number(m2.index), {
            ...(m2.required !== undefined ? { required: m2.required } : {}),
            ...(m2.edit !== undefined ? { edit: m2.edit, promptTable: m2.promptTable ?? '' } : {})
          }), 'Change Edits');
        }
        case 'default': {
          const m2 = msg as { index?: number; constant?: string; record?: string; field?: string };
          const value = m2.record ? { record: m2.record, field: m2.field ?? '' } : m2.constant ? { constant: m2.constant } : null;
          return this.apply(doc, setDefault(state, Number(m2.index), value), 'Change Default');
        }
        case 'label': {
          const m2 = msg as { index?: number; labelId?: string };
          return this.apply(doc, setLabel(state, Number(m2.index), String(m2.labelId ?? '')), 'Change Label');
        }
        case 'pageControl': {
          const m2 = msg as { index?: number; value?: number };
          return this.apply(doc, setPageControl(state, Number(m2.index), Number(m2.value)), 'Change Page Control');
        }
        case 'insert': {
          const name = await pickField(doc);
          if (!name) return;
          const next = insertField(state, name, Math.min(Math.max(Number(msg.at), 0), state.fields.length));
          await doc.describe(name);
          return this.apply(doc, next, 'Insert Field');
        }
        case 'insertSub': {
          // App Designer's Insert > Subrecord (r53): a SubRecord's name; its fields expand into the record on save.
          const name = (await vscode.window.showInputBox({ title: `Insert Subrecord into ${doc.recname}`, prompt: 'SubRecord name',
            validateInput: (v) => (/^[A-Z0-9_#$@]{1,15}$/i.test(v.trim()) ? undefined : 'A record name.') }))?.trim().toUpperCase();
          if (!name) return;
          const next = insertSubrecord(state, name, Math.min(Math.max(Number(msg.at), 0), state.fields.length));
          doc.describeSubrecord(name);
          return this.apply(doc, next, 'Insert Subrecord');
        }
      }
    } catch (err) {
      void vscode.window.showWarningMessage((err as Error).message);
    }
  }

  /** App Designer's field menu: the actions that leave the record editor. */
  private async onMenu(doc: RecordDocument, action: string, index: number, webview: vscode.Webview): Promise<void> {
    const field = doc.shownFields()[index];
    const provider = doc.provider;
    if (!provider) return;
    const node = (key: DefinitionKey) => ({ kind: 'definition', provider: { id: provider.id }, summary: { key } });
    if (action === 'build') {
      // App Designer's Build > Create Table, generated as a script and opened, never run.
      const shown = doc.shownLayout();
      if (!shown) return;
      if (shown.fields.some((f) => f.isSubrecord)) {
        void vscode.window.showInformationMessage('Records with subrecords cannot be scripted here yet.');
        return;
      }
      const model = provider instanceof OracleProvider ? await provider.readDdlModel(shown.name) : undefined;
      if (!model) {
        void vscode.window.showInformationMessage('The build script comes from the database\'s DDL model; a project export does not carry one.');
        return;
      }
      const script = createTableScript({
        name: shown.name, recordType: shown.recordType, sqlTableName: shown.sqlTableName,
        ...(shown.tablespace ? { tablespace: shown.tablespace } : {}),
        fields: shown.fields.map((f) => ({
          name: f.name, type: f.type!, length: f.length ?? 0, decimalPositions: f.decimalPositions ?? 0,
          ...(f.format !== undefined ? { format: f.format } : {}), useEdit: f.useEdit
        }))
      }, model);
      const sql = await vscode.workspace.openTextDocument({ content: script, language: 'psft-sql' });
      await vscode.window.showTextDocument(sql, { preview: false });
      return;
    }
    if (action === 'viewSql') {
      // The view's SQL in an editor, as App Designer's SQL Editor opens it (read-only: saving view text is not supported).
      const doc2 = await vscode.workspace.openTextDocument({ content: doc.viewSql() ?? '', language: 'psft-sql' });
      await vscode.window.showTextDocument(doc2, { preview: true });
      return;
    }
    if (action === 'recordProperties') {
      await vscode.commands.executeCommand('psft.showProperties', node(makeKey(DefinitionType.Record, doc.recname)));
      return;
    }
    if (!field || field.isSubrecord) return;
    switch (action) {
      case 'definition':
        await vscode.commands.executeCommand('psft.openDefinition', provider.id, makeKey(DefinitionType.Field, field.name));
        return;
      case 'peoplecode':
        await vscode.commands.executeCommand('psft.openFieldPeopleCode', { connectionId: provider.id, record: doc.recname, field: field.name });
        return;
      case 'fieldProperties':
        await vscode.commands.executeCommand('psft.showProperties', node(makeKey(DefinitionType.Field, field.name)));
        return;
      case 'refsField':
      case 'refsRecordField':
        await showReferences(provider, field.name, action === 'refsRecordField' ? doc.recname : undefined);
        return;
      case 'translates': {
        if (!provider.readTranslates) {
          void webview.postMessage({ type: 'translates', field: field.name, rows: [], error: `${provider.displayName} is a project export, which does not carry translate values.` });
          return;
        }
        try {
          void webview.postMessage({ type: 'translates', field: field.name, rows: await provider.readTranslates(field.name),
            writable: this.translateRefusal(doc, field.name) === undefined });
        } catch (err) {
          void webview.postMessage({ type: 'translates', field: field.name, rows: [], error: (err as Error).message });
        }
        return;
      }
    }
  }

  /** Why a field's translate values cannot be changed from here; undefined when they can. */
  private translateRefusal(doc: RecordDocument, field: string): string | undefined {
    const p = doc.provider;
    if (!(p instanceof OracleProvider)) return 'translate values are changed only in a database connection.';
    if (!this.workspace.isWritable(p.id)) return `${p.displayName} is read-only (Access in PeopleSoft Studio Settings).`;
    if (!this.workspace.configFor(p.id)?.peoplesoftOperatorId?.trim()) return `set the Operator ID for ${p.displayName} in PeopleSoft Studio Settings.`;
    return writeScopeRefusal(field);
  }

  /** Adds, changes or deletes a translate value at once (translateWriter.ts), then shows the field's values again. */
  private async onTranslate(doc: RecordDocument, msg: { field?: string; change?: TranslateChange }, webview: vscode.Webview): Promise<void> {
    const field = String(msg.field ?? '');
    const change = msg.change;
    const provider = doc.provider;
    if (!change || !doc.shownFields().some((f) => f.name === field && !f.isSubrecord)) return;
    const refusal = this.translateRefusal(doc, field);
    if (refusal || !(provider instanceof OracleProvider)) {
      void vscode.window.showWarningMessage(`Translate values of ${field} cannot be changed: ${refusal}`);
      return;
    }
    if (change.kind === 'delete') {
      const yes = await vscode.window.showWarningMessage(
        `Delete translate value ${change.value} of ${field} in ${provider.displayName}? It is written to the database at once.`, { modal: true }, 'Delete');
      if (yes !== 'Delete') return;
    }
    let error: string | undefined;
    try {
      await provider.saveTranslate(field, change, this.workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim());
      void vscode.window.showInformationMessage(`${field}: translate value ${change.kind === 'delete' ? change.value : change.item.value} ${change.kind === 'add' ? 'added' : change.kind === 'change' ? 'changed' : 'deleted'}.`);
    } catch (err) {
      error = err instanceof TranslateSaveRefusedError ? err.message : `Saving the translate value failed: ${(err as Error).message}`;
      void vscode.window.showErrorMessage(error);
    }
    try {
      void webview.postMessage({ type: 'translates', field, rows: await provider.readTranslates(field), writable: true });
    } catch (err) {
      void webview.postMessage({ type: 'translates', field, rows: [], error: error ?? (err as Error).message });
    }
  }

  private apply(doc: RecordDocument, next: RecordEditState, label: string): void {
    const prev = doc.state!;
    doc.state = next;
    doc.paint();
    this.changed.fire({
      document: doc, label,
      undo: () => { doc.state = prev; doc.paint(); },
      redo: () => { doc.state = next; doc.paint(); }
    });
  }

  async saveCustomDocument(doc: RecordDocument): Promise<void> {
    if (!doc.state || !doc.dirty) return;
    const provider = doc.provider;
    const operatorId = provider && this.workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
    if (!(provider instanceof OracleProvider) || !operatorId || !this.workspace.isWritable(provider.id)) {
      throw new Error(`${doc.recname} cannot be saved: the connection is not Writable with an Operator ID.`);
    }
    try {
      await provider.saveRecord({ edit: doc.state, operatorId });
      RecordEditorProvider.pendingNew.delete(doc.uri.toString());
    } catch (err) {
      const reason = err instanceof RecordSaveRefusedError ? err.message : `Saving ${doc.recname} failed: ${(err as Error).message}`;
      void vscode.window.showErrorMessage(reason);
      throw new Error(reason);
    }
    await doc.load();
    doc.paint();
    this.onSaved();
  }

  async saveCustomDocumentAs(): Promise<void> {
    throw new Error('Save As is not available for record definitions.');
  }

  async revertCustomDocument(doc: RecordDocument): Promise<void> {
    await doc.load();
    doc.paint();
  }

  async backupCustomDocument(doc: RecordDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(context.destination, Buffer.from(JSON.stringify({ state: doc.state ?? null }), 'utf8'));
    return { id: context.destination.toString(), delete: () => { void vscode.workspace.fs.delete(context.destination).then(undefined, () => undefined); } };
  }
}

/** The bit each Use setting the page can toggle stands for. */
const TOGGLE_BITS: Readonly<Record<string, UseEdit>> = {
  key: UseEdit.Key, dupOrder: UseEdit.DuplicateOrderKey, altSearch: UseEdit.AltSearchKey, descending: UseEdit.DescendingKey, searchKey: UseEdit.SearchKey,
  searchEdit: UseEdit.SearchEdit, listBox: UseEdit.ListBoxItem, fromSearch: UseEdit.FromSearchField,
  throughSearch: UseEdit.ThroughSearchField, defaultSearch: UseEdit.DefaultSearchField,
  disableAdvancedSearch: UseEdit.DisableAdvancedSearchOptions, allowSearchEvents: UseEdit.AllowSearchEventsForPromptDialogs,
  auditAdd: UseEdit.AuditFieldAdd, auditChange: UseEdit.AuditFieldChange, auditDelete: UseEdit.AuditFieldDelete,
  systemMaintained: UseEdit.SystemMaintained
};

/** A record open in the editor: what is stored, and the edit made to it. */
class RecordDocument implements vscode.CustomDocument {
  panels: vscode.WebviewPanel[] = [];
  provider?: DefinitionProvider;
  key?: DefinitionKey;
  layout?: RecordLayout;
  /** The edit; absent when the record is read-only. */
  state?: RecordEditState;
  readOnlyReason?: string;
  /** Display values by field name, for fields inserted in this edit. */
  private readonly info = new Map<string, RecordLayoutField>();

  /** A field's type, length and format, as the editor knows them. */
  fieldInfo(name: string): RecordLayoutField | undefined { return this.info.get(name); }
  error?: string;

  constructor(readonly uri: vscode.Uri, private readonly workspace: Workspace) {}

  get recname(): string { return this.key?.parts[0] ?? ''; }

  get dirty(): boolean {
    if (!this.state || !this.layout) return false;
    const shown = this.shownFields();
    const key = (f: RecordLayoutField) => JSON.stringify([f.name, f.useEdit, f.useEdit2 ?? 0, f.editTable, f.defaultRecord,
      f.defaultField, f.labelId ?? '', f.defGuiControl ?? 99]);
    return shown.map(key).join('|') !== this.layout.fields.map(key).join('|') ||
      JSON.stringify(this.shown()?.properties ?? null) !== JSON.stringify(this.layout.properties ?? null) ||
      Object.keys(this.state.type ?? {}).length > 0;
  }

  async load(): Promise<void> {
    const { handle, key } = parseUri(this.uri);
    this.key = key;
    this.provider = await this.workspace.requireByHandle(handle);
    this.error = undefined;
    this.state = undefined;
    this.readOnlyReason = undefined;
    if (!this.provider.readRecordLayout) return;
    const created = RecordEditorProvider.pendingNew.get(this.uri.toString());
    const layout = await this.provider.readRecordLayout(key) ?? (created !== undefined ? blankLayout(key.parts[0] ?? '', created) : undefined);
    if (!layout) throw new Error(`No record definition named ${key.parts[0] ?? ''} in ${this.provider.displayName}.`);
    const isNew = created !== undefined && layout.version === 0;
    this.layout = layout;
    for (const f of layout.fields) this.info.set(f.name, f);
    this.readOnlyReason = this.whyReadOnly(layout);
    if (!this.readOnlyReason) {
      this.state = {
        recname: layout.name, recordType: layout.recordType, openedVersion: layout.version,
        fields: layout.fields.map((f) => ({
          name: f.name, useEdit: f.useEdit, useEdit2: f.useEdit2 ?? 0, isNew: false, ...(f.isSubrecord ? { isSubrecord: true } : {})
        })),
        ...(isNew ? { isNew: true } : {})
      };
    }
  }

  private whyReadOnly(layout: RecordLayout): string | undefined {
    const p = this.provider!;
    if (!(p instanceof OracleProvider)) return undefined;
    if (!this.workspace.isWritable(p.id)) return `${p.displayName} is read-only (Access in PeopleSoft Studio Settings).`;
    if (!this.workspace.configFor(p.id)?.peoplesoftOperatorId?.trim()) return `set the Operator ID for ${p.displayName} in PeopleSoft Studio Settings to edit records.`;
    return writeScopeRefusal(layout.name) ?? layoutEditRefusal(layout);
  }

  /** Display values for a subrecord inserted in this edit: a subrecord row, as the record shows stored ones. */
  describeSubrecord(name: string): void {
    if (this.info.has(name)) return;
    this.info.set(name, {
      fieldNum: 0, name, isSubrecord: true, shortName: '', longName: '', useEdit: 0, hasPeopleCode: false, editTable: '',
      defaultRecord: '', defaultField: '', useEdit2: 0, labelId: '', defGuiControl: 99, labels: []
    });
  }

  /** Display values for a field inserted in this edit. */
  async describe(name: string): Promise<void> {
    if (this.info.has(name)) return;
    const field = await this.provider?.readField?.(makeKey(DefinitionType.Field, name));
    if (!field) throw new RecordSaveRefusedError(`There is no field named ${name}.`);
    const label = field.labels.find((l) => l.isDefault) ?? field.labels[0];
    this.info.set(name, {
      fieldNum: 0, name, isSubrecord: false, type: field.type, length: field.length,
      decimalPositions: field.decimalPositions, format: field.format, shortName: label?.shortName ?? '',
      longName: label?.longName ?? '', useEdit: 0, hasPeopleCode: false, editTable: '', defaultRecord: '', defaultField: '',
      useEdit2: 0, labelId: '', defGuiControl: 99,
      labels: field.labels.map((l) => ({ id: l.id, longName: l.longName, shortName: l.shortName, isDefault: l.isDefault === true }))
    });
  }

  async restore(backup: vscode.Uri): Promise<void> {
    const saved = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(backup)).toString('utf8')) as { state?: RecordEditState };
    if (saved.state && this.state && saved.state.openedVersion === this.state.openedVersion) {
      for (const f of saved.state.fields.filter((x) => x.isNew)) await this.describe(f.name).catch(() => undefined);
      this.state = saved.state;
    }
  }

  shownLayout(): RecordLayout | undefined {
    return this.shown();
  }

  viewSql(): string | undefined {
    return this.state?.type?.viewSql ?? this.layout?.viewSql;
  }

  shownFields(): RecordLayoutField[] {
    return this.shown()?.fields ?? [];
  }

  /** The layout as edited: the edit's fields, in its order, with their display values. */
  private shown(): RecordLayout | undefined {
    if (!this.layout) return undefined;
    if (!this.state) return this.layout;
    const p = this.state.properties;
    const base = this.layout.properties;
    const properties = base && p ? {
      ...base,
      ...(p.description !== undefined ? { description: p.description } : {}),
      ...(p.definition !== undefined ? { definition: p.definition } : {}),
      ...(p.ownerId !== undefined ? { ownerId: p.ownerId } : {}),
      ...(p.setControlField !== undefined ? { setControlField: p.setControlField } : {}),
      ...(p.parentRecord !== undefined ? { parentRecord: p.parentRecord } : {}),
      ...(p.relatedLanguageRecord !== undefined ? { relatedLanguageRecord: p.relatedLanguageRecord } : {}),
      ...(p.querySecurityRecord !== undefined ? { querySecurityRecord: p.querySecurityRecord } : {}),
      ...(p.analyticDeleteRecord !== undefined ? { analyticDeleteRecord: p.analyticDeleteRecord } : {}),
      ...(p.auditRecord !== undefined ? { auditRecord: p.auditRecord } : {}),
      ...(p.recUse !== undefined ? { recUse: p.recUse } : {}),
      ...(p.timestampField !== undefined ? { timestampField: p.timestampField } : {}),
      ...(p.systemIdField !== undefined ? { systemIdField: p.systemIdField } : {}),
      auxFlagMask: (base.auxFlagMask & ~(0x30000 | (p.inMemory !== undefined ? 0x30000000 : 0))) |
        ((p.toolsTable ?? (base.auxFlagMask & 0x10000) !== 0) ? 0x10000 : 0) | ((p.managed ?? (base.auxFlagMask & 0x20000) !== 0) ? 0x20000 : 0) |
        (p.inMemory === 'all' ? 0x10000000 : p.inMemory === 'selective' ? 0x20000000 : 0)
    } : base;
    const type = this.state.type ?? {};
    return {
      ...this.layout,
      ...(properties ? { properties } : {}),
      // The Record Type tab as edited.
      ...(type.recordType !== undefined ? { recordType: type.recordType } : {}),
      ...(type.sqlTableName !== undefined ? { sqlTableName: type.sqlTableName } : {}),
      ...(type.buildSequence !== undefined ? { buildSequence: type.buildSequence } : {}),
      ...(type.viewSql !== undefined ? { viewSql: type.viewSql } : {}),
      fields: this.state.fields.map((f, i) => {
        const base = this.info.get(f.name)!;
        const shown: RecordLayoutField = {
          ...base, fieldNum: i + 1, useEdit: f.useEdit, useEdit2: f.useEdit2 ?? 0,
          ...(f.editTable !== undefined ? { editTable: f.editTable } : {}),
          ...(f.defaultRecord !== undefined ? { defaultRecord: f.defaultRecord } : {}),
          ...(f.defaultField !== undefined ? { defaultField: f.defaultField } : {}),
          ...(f.pageControl !== undefined ? { defGuiControl: f.pageControl } : {})
        };
        if (f.labelId !== undefined) {
          // The grid's Short / Long Name follow the label chosen.
          const label = f.labelId ? base.labels?.find((l) => l.id === f.labelId) : base.labels?.find((l) => l.isDefault);
          shown.labelId = f.labelId;
          if (label) { shown.shortName = label.shortName; shown.longName = label.longName; }
        }
        return shown;
      })
    };
  }

  paint(): void {
    for (const panel of this.panels) void this.paintOne(panel);
  }

  private async paintOne(panel: vscode.WebviewPanel): Promise<void> {
    const editable = this.state !== undefined;
    // The page's script also serves a read-only record: double-click a field for its PeopleCode.
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    if (this.error) { panel.webview.html = renderError(this.error); return; }
    const shown = this.shown();
    if (shown) {
      panel.webview.html = renderRecordHtml(shown, this.provider?.displayName ?? '', randomBytes(16).toString('base64'), {
        editable, ...(this.readOnlyReason ? { readOnlyReason: this.readOnlyReason } : {}),
        ...(this.layout ? { typeChoices: [this.layout.recordType, ...RECORD_TYPE_CHANGES.filter(([from]) => from === this.layout!.recordType).map(([, to]) => to)] } : {})
      });
      return;
    }
    try {
      panel.webview.html = renderRecord(await this.provider!.readRecord(this.key!), panel.webview);
    } catch (err) {
      panel.webview.html = renderError((err as Error).message);
    }
  }

  dispose(): void { /* nothing held */ }
}

/** Fields on the clipboard: their names, marked so that only fields are pasted. */
const CLIPBOARD_PREFIX = 'PeopleSoft fields: ';

async function copyFields(doc: RecordDocument, indexes: readonly number[]): Promise<void> {
  const names = indexes.map((i) => doc.shownFields()[i]).filter((f) => f && !f.isSubrecord).map((f) => f!.name);
  if (names.length) await vscode.env.clipboard.writeText(CLIPBOARD_PREFIX + names.join(', '));
}

function parseClipboard(text: string): string[] {
  if (!text.startsWith(CLIPBOARD_PREFIX)) return [];
  return text.slice(CLIPBOARD_PREFIX.length).split(',').map((n) => n.trim().toUpperCase()).filter((n) => /^[A-Z0-9_#$@]{1,18}$/.test(n));
}

/** App Designer's Find Definition References, as a list that opens what it finds. */
async function showReferences(provider: DefinitionProvider, field: string, record?: string): Promise<void> {
  const what = record ? `${record}.${field}` : field;
  if (!provider.findFieldReferences) {
    void vscode.window.showInformationMessage(`Finding references needs a database connection; ${provider.displayName} is a project export.`);
    return;
  }
  const refs = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Finding references to ${what}…` },
    () => provider.findFieldReferences!(field, record));
  if (refs.length === 0) { void vscode.window.showInformationMessage(`No references to ${what} found.`); return; }
  type Item = vscode.QuickPickItem & { key?: DefinitionKey };
  const items: Item[] = [];
  for (const group of ['Record', 'Page', 'PeopleCode']) {
    const inGroup = refs.filter((r) => r.group === group);
    if (inGroup.length === 0) continue;
    items.push({ label: `${group}s (${inGroup.length})`, kind: vscode.QuickPickItemKind.Separator });
    for (const r of inGroup) items.push({ label: r.label, description: r.description ?? '', ...(r.key ? { key: r.key } : { detail: 'cannot be opened here' }) });
  }
  const picked = await vscode.window.showQuickPick(items, { title: `References to ${what} (${refs.length})`, matchOnDescription: true });
  if (picked?.key) await vscode.commands.executeCommand('psft.openDefinition', provider.id, picked.key);
}

/** A field to insert, searched as the name is typed. */
async function pickField(doc: RecordDocument): Promise<string | undefined> {
  const provider = doc.provider;
  if (!provider) return undefined;
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
  qp.title = `Insert Field into ${doc.recname}`;
  qp.placeholder = 'Field name (% matches anything)';
  let seq = 0;
  const search = async (value: string) => {
    const mine = ++seq;
    const pattern = value.trim() ? `${value.trim().toUpperCase()}%` : '%';
    qp.busy = true;
    try {
      const hits = await provider.search({ type: DefinitionType.Field, namePattern: pattern, limit: 100 });
      if (mine !== seq) return;
      const present = new Set(doc.state?.fields.map((f) => f.name));
      qp.items = hits.filter((h) => !present.has(h.key.parts[0])).map((h) => ({ label: h.key.parts[0], description: h.description ?? '' }));
    } catch (err) {
      qp.items = [];
      qp.title = `Search failed: ${(err as Error).message}`;
    } finally {
      if (mine === seq) qp.busy = false;
    }
  };
  return new Promise((resolve) => {
    qp.onDidChangeValue((v) => void search(v));
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]?.label ?? (qp.value.trim().toUpperCase() || undefined)); qp.hide(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
    void search('');
  });
}

const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  [RecordType.Table]: 'SQL Table',
  [RecordType.View]: 'SQL View',
  [RecordType.DerivedWork]: 'Derived/Work',
  [RecordType.Subrecord]: 'Subrecord',
  [RecordType.DynamicView]: 'Dynamic View',
  [RecordType.QueryView]: 'Query View',
  [RecordType.TemporaryTable]: 'Temporary Table'
};

/**
 * The field's use flags. Only Key is shown: the other USEEDIT bit meanings
 * in model/record.ts disagree with HRDMO's delivered records (BEGIN_DT on
 * ABS_HIST_DET, a descending key, is 0x141) and await App Designer's Use
 * display to settle them.
 */
function keyFlags(f: RecordField): string {
  return hasFlag(f.useEdit, UseEdit.Key) ? 'Key' : '';
}

function fieldLength(f: RecordField): string {
  return f.decimalPositions > 0 ? `${f.length}.${f.decimalPositions}` : String(f.length);
}

function renderRecord(record: RecordDefinition, webview: vscode.Webview): string {
  const rows = record.fields.map((f) => `
    <tr${f.fromSubrecord ? ' class="inherited"' : ''}>
      <td class="num">${f.fieldNum}</td>
      <td class="name">${esc(f.name)}</td>
      <td>${esc(FIELD_TYPE_LABELS[f.type] ?? String(f.type))}</td>
      <td class="num">${fieldLength(f)}</td>
      <td class="flags">${esc(keyFlags(f))}</td>
      <td>${esc(f.editTable ?? '')}</td>
      <td class="subrec">${esc(f.fromSubrecord ?? '')}</td>
    </tr>`).join('');

  const viewSql = record.viewSql
    ? `<h2>View SQL</h2><pre class="sql">${esc(record.viewSql)}</pre>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 1rem 1.25rem; }
  h1 { font-size: 1.15rem; margin: 0 0 .15rem; }
  .sub { color: var(--vscode-descriptionForeground); font-size: .85rem;
         margin-bottom: 1rem; }
  .banner { background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            padding: .5rem .75rem; border-radius: 3px; font-size: .85rem;
            margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th { text-align: left; font-weight: 600; padding: .35rem .5rem;
       border-bottom: 1px solid var(--vscode-panel-border);
       position: sticky; top: 0; background: var(--vscode-editor-background); }
  td { padding: .3rem .5rem; border-bottom: 1px solid var(--vscode-panel-border); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.name { font-family: var(--vscode-editor-font-family); }
  td.flags, td.subrec { color: var(--vscode-descriptionForeground); font-size: .8rem; }
  tr.inherited td.name { opacity: .8; font-style: italic; }
  pre.sql { font-family: var(--vscode-editor-font-family); font-size: .85rem;
            background: var(--vscode-textCodeBlock-background); padding: .75rem;
            border-radius: 3px; overflow-x: auto; }
</style>
</head>
<body>
  <h1>${esc(record.name)}</h1>
  <div class="sub">${esc(RECORD_TYPE_LABELS[record.recordType] ?? 'Unknown type')}
    &middot; ${record.fields.length} fields
    &middot; version ${record.version}${record.description ? ' &middot; ' + esc(record.description) : ''}</div>
  <div class="banner">Read-only. Saving record definitions is not implemented yet &mdash;
    changes would have to update PSRECDEFN, PSRECFIELD and the PeopleTools version
    counters together, and regenerate DDL.</div>
  <table>
    <thead><tr>
      <th>#</th><th>Field</th><th>Type</th><th>Len</th>
      <th>Attributes</th><th>Prompt Table</th><th>From Subrecord</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${viewSql}
</body>
</html>`;
}

function renderError(message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body { font-family: var(--vscode-font-family); padding: 2rem;
  color: var(--vscode-errorForeground); }</style></head>
<body><p>${esc(message)}</p></body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** A record not saved yet, as App Designer's File > New > Record shows it: no fields, the chosen type. */
function blankLayout(name: string, recordType: RecordType): RecordLayout {
  return {
    name, description: '', recordType, sqlTableName: '', version: 0, fields: [], indexIds: [], buildSequence: 1, auxFlagMask: 0,
    properties: {
      description: '', definition: '', ownerId: '', lastUpdated: '', lastUpdatedBy: '', setControlField: '', parentRecord: '',
      relatedLanguageRecord: '', querySecurityRecord: '', analyticDeleteRecord: '', auditRecord: '', systemIdField: '',
      timestampField: '', auxFlagMask: 0, recUse: 0, optTrigFlag: 'N'
    }
  };
}
