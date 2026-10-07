import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { parseUri } from '../util/uri.js';
import { renderFieldHtml } from './fieldHtml.js';
import { escapeHtml } from './propertiesHtml.js';
import type { FieldDefinition } from '../model/fieldDefinition.js';
import { FieldType } from '../model/record.js';
import { OracleProvider } from '../providers/oracle.js';
import { CREATABLE_FIELD_TYPES, FIXED_FIELD_LENGTH, FieldCreateRefusedError, type FieldLabelEdit, type FieldSaveRequest } from '../providers/fieldWriter.js';
import { isScratchName } from '../peoplecode/corpus/labSafety.js';
import type { DefinitionProvider } from '../providers/provider.js';

/**
 * The field definition editor -- App Designer's Field dialog. On a Writable
 * connection, a scratch field's length, labels and description can be
 * changed: each change is saved at once, as App Designer's field saves are
 * (fieldWriter.ts saveField, cases f02-f06).
 */
export class FieldEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'psft.fieldEditor';

  constructor(private readonly workspace: Workspace, private readonly onSaved: () => void = () => undefined) {}

  static register(workspace: Workspace, onSaved?: () => void): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      FieldEditorProvider.viewType,
      new FieldEditorProvider(workspace, onSaved),
      { supportsMultipleEditorsPerDocument: false });
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    let field: FieldDefinition | undefined;
    let provider: DefinitionProvider | undefined;
    const paint = async () => {
      const nonce = randomBytes(16).toString('base64');
      try {
        const { handle, key } = parseUri(document.uri);
        provider = await this.workspace.requireByHandle(handle);
        field = provider.readField ? await provider.readField(key) : undefined;
        const reason = field && provider ? this.readOnlyReason(provider, field) : 'not found';
        panel.webview.options = { enableScripts: reason === undefined, localResourceRoots: [] };
        panel.webview.html = field
          ? renderFieldHtml(field, provider.displayName, nonce, reason === undefined ? { editable: true } : { readOnlyReason: reason })
          : message(`Field ${key.parts[0] ?? ''} was not found in ${provider.displayName}.`, nonce);
      } catch (err) {
        panel.webview.options = { enableScripts: false, localResourceRoots: [] };
        panel.webview.html = message((err as Error).message, nonce);
      }
    };
    panel.webview.onDidReceiveMessage(async (m: { act?: string; label?: string }) => {
      if (!field || !(provider instanceof OracleProvider)) return;
      try {
        const change = await this.ask(field, String(m.act ?? ''), String(m.label ?? ''));
        if (!change) return;
        const operatorId = this.workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim();
        const result = await provider.saveField({ name: field.name, openedVersion: field.version ?? -1, operatorId, ...change });
        const others = result.records.length ? ` Records holding it took its new version: ${result.records.join(', ')}.` : '';
        void vscode.window.showInformationMessage(`Saved ${field.name}.${others}`);
        this.onSaved();
      } catch (err) {
        const reason = err instanceof FieldCreateRefusedError ? err.message : `Saving ${field.name} failed: ${(err as Error).message}`;
        void vscode.window.showWarningMessage(reason);
      }
      await paint();
    });
    await paint();
  }

  /** Why the field cannot be edited here; undefined when it can. */
  private readOnlyReason(provider: DefinitionProvider, field: FieldDefinition): string | undefined {
    if (!(provider instanceof OracleProvider)) return 'a project export cannot be saved.';
    if (!this.workspace.isWritable(provider.id)) return `${provider.displayName} is read-only (Access in PeopleSoft Studio Settings).`;
    if (!this.workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim()) return `set the Operator ID for ${provider.displayName} in PeopleSoft Studio Settings.`;
    if (!isScratchName(field.name)) return 'saving fields is limited to scratch fields (ZZ_PCODE_LAB%) for now.';
    if (!CREATABLE_FIELD_TYPES.includes(field.type)) return 'fields of this type cannot be saved here yet.';
    return undefined;
  }

  /** The change an action asks for, prompted; undefined when cancelled. */
  private async ask(field: FieldDefinition, act: string, labelId: string): Promise<Omit<FieldSaveRequest, 'name' | 'openedVersion' | 'operatorId'> | undefined> {
    const labels: FieldLabelEdit[] = field.labels.map((l) => ({ id: l.id, longName: l.longName, shortName: l.shortName, isDefault: l.isDefault === true }));
    const title = `${field.name} (Field)`;
    const chosen = () => {
      const l = labels.find((x) => x.id === labelId);
      if (!l) void vscode.window.showInformationMessage('Click a label in the grid first.');
      return l;
    };
    switch (act) {
      case 'length': {
        if (FIXED_FIELD_LENGTH[field.type] !== undefined) return undefined;
        const length = await vscode.window.showInputBox({ title, prompt: field.type === FieldType.LongCharacter ? 'Maximum length (0 for no maximum)' : 'Field length',
          value: String(field.length), validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : 'A whole number.') });
        if (length === undefined) return undefined;
        if (field.type !== FieldType.Number && field.type !== FieldType.SignedNumber) return { length: Number(length) };
        const decimals = await vscode.window.showInputBox({ title, prompt: 'Decimal positions', value: String(field.decimalPositions),
          validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : 'A whole number.') });
        return decimals === undefined ? undefined : { length: Number(length), decimalPositions: Number(decimals) };
      }
      case 'addLabel': {
        const id = (await vscode.window.showInputBox({ title, prompt: 'Label ID (A-Z, 0-9, _; at most 18)',
          validateInput: (v) => (/^[A-Z0-9_]{1,18}$/i.test(v.trim()) ? undefined : 'A-Z, 0-9 and _, at most 18.') }))?.trim().toUpperCase();
        if (!id) return undefined;
        const names = await this.askNames(title, { id, longName: '', shortName: '', isDefault: false });
        return names ? { labels: [...labels, names] } : undefined;
      }
      case 'editLabel': {
        const l = chosen();
        if (!l) return undefined;
        const names = await this.askNames(title, l);
        return names ? { labels: labels.map((x) => (x.id === l.id ? names : x)) } : undefined;
      }
      case 'defaultLabel': {
        const l = chosen();
        if (!l || l.isDefault) return undefined;
        return { labels: labels.map((x) => ({ ...x, isDefault: x.id === l.id })) };
      }
      case 'description': {
        const d = await vscode.window.showInputBox({ title, prompt: 'Description (saved as the field\'s long description)', value: field.description ?? '' });
        return d === undefined ? undefined : { description: d };
      }
      default:
        return undefined;
    }
  }

  private async askNames(title: string, l: FieldLabelEdit): Promise<FieldLabelEdit | undefined> {
    const longName = await vscode.window.showInputBox({ title: `${title}: label ${l.id}`, prompt: 'Long name (at most 30)', value: l.longName,
      validateInput: (v) => (v.trim() && v.length <= 30 ? undefined : '1 to 30 characters.') });
    if (longName === undefined) return undefined;
    const shortName = await vscode.window.showInputBox({ title: `${title}: label ${l.id}`, prompt: 'Short name (at most 15)', value: l.shortName || longName.slice(0, 15),
      validateInput: (v) => (v.trim() && v.length <= 15 ? undefined : '1 to 15 characters.') });
    return shortName === undefined ? undefined : { ...l, longName, shortName };
  }
}

function message(text: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">body { font-family: var(--vscode-font-family); padding: 2rem; color: var(--vscode-errorForeground); }</style></head>
<body><p>${escapeHtml(text)}</p></body></html>`;
}
