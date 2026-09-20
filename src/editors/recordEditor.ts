import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { parseUri } from '../util/uri.js';
import {
  FIELD_TYPE_LABELS, RecordDefinition, RecordField, RecordType, UseEdit, hasFlag
} from '../model/record.js';

/**
 * The record definition editor — App Designer's field grid.
 *
 * Registered as a read-only custom editor because no provider can save a record
 * yet (see OracleProvider.writeRecord). Presenting an editable grid that cannot
 * save would invite losing work; the grid becomes editable in the same change
 * that implements the write path.
 */
export class RecordEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'psft.recordEditor';

  constructor(private readonly workspace: Workspace) {}

  static register(workspace: Workspace): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      RecordEditorProvider.viewType,
      new RecordEditorProvider(workspace),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false });
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    panel.webview.options = { enableScripts: false };

    try {
      const { connectionId, key } = parseUri(document.uri);
      const provider = await this.workspace.require(connectionId);
      const record = await provider.readRecord(key);
      panel.webview.html = renderRecord(record, panel.webview);
    } catch (err) {
      panel.webview.html = renderError((err as Error).message);
    }
  }
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

/** The single-letter flags App Designer shows in its field grid. */
function keyFlags(f: RecordField): string {
  const flags: string[] = [];
  if (hasFlag(f.useEdit, UseEdit.Key)) flags.push('Key');
  if (hasFlag(f.useEdit, UseEdit.DuplicateOrderKey)) flags.push('Dup');
  if (hasFlag(f.useEdit, UseEdit.AltSearchKey)) flags.push('Alt');
  if (hasFlag(f.useEdit, UseEdit.SearchKey)) flags.push('Srch');
  if (hasFlag(f.useEdit, UseEdit.DescendingKey)) flags.push('Desc');
  if (hasFlag(f.useEdit, UseEdit.ListBoxItem)) flags.push('List');
  if (hasFlag(f.useEdit, UseEdit.SystemMaintained)) flags.push('Sys');
  if (hasFlag(f.useEdit, UseEdit.Required)) flags.push('Req');
  return flags.join(' ');
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
