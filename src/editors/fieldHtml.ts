import { FieldDefinition, formatTypeLabel } from '../model/fieldDefinition.js';
import { FIELD_TYPE_LABELS, FieldType } from '../model/record.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The Field editor's page, laid out like App Designer's Field dialog: type
 * and length, the Field Labels grid, the Field Format group and its flags.
 * Static and script-free, every value escaped, theme-coloured.
 */

const LABEL_ROWS = 10;

function box(value: string, cls = ''): string {
  return `<span class="box ${cls}">${value === '' ? '&nbsp;' : esc(value)}</span>`;
}

function check(on: boolean | undefined, label: string, title?: string): string {
  const mark = on === undefined ? '' : on ? '&#10003;' : '';
  const t = title ? ` title="${esc(title)}"` : '';
  return `<span class="check${on === undefined ? ' unknown' : ''}"${t}><span class="tick">${mark}</span>${esc(label)}</span>`;
}

function sizeRows(f: FieldDefinition): string {
  switch (f.type) {
    case FieldType.Character:
      return row('Field Length:', box(String(f.length), 'short'));
    case FieldType.LongCharacter:
      return row('Maximum Length:', box(String(f.length), 'short'));
    case FieldType.Number:
    case FieldType.SignedNumber:
      return row('Length:', box(String(f.length), 'short')) + row('Decimal Positions:', box(String(f.decimalPositions), 'short'));
    case FieldType.Date:
      return f.defaultCenturyYear === undefined ? '' : row('Default Century:', box(String(f.defaultCenturyYear), 'short'));
    default:
      return f.length ? row('Length:', box(String(f.length), 'short')) : '';
  }
}

function row(label: string, control: string): string {
  return `<div class="row"><label>${esc(label)}</label>${control}</div>`;
}

function labelsGrid(f: FieldDefinition): string {
  const rows: string[] = f.labels.map((l, i) => `<tr data-label="${esc(l.id)}" tabindex="-1">
      <td class="n">${i + 1}</td><td>${esc(l.id)}</td><td>${esc(l.longName)}</td><td>${esc(l.shortName)}</td>
      <td class="def">${check(l.isDefault, '')}</td></tr>`);
  for (let i = rows.length; i < Math.max(LABEL_ROWS, f.labels.length + 1); i++) {
    rows.push(`<tr class="empty"><td class="n">${i === f.labels.length ? i + 1 : ''}</td><td></td><td></td><td></td><td></td></tr>`);
  }
  return `<table class="grid">
    <thead><tr><th class="n"></th><th>Label ID</th><th>Long Name</th><th>Short Name</th><th class="def">Def</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
}

function formatGroup(f: FieldDefinition): string {
  const character = f.type === FieldType.Character;
  const rows = character
    ? row('Format Type:', box(formatTypeLabel(f.format))) +
      row('Family', box(f.formatFamily ?? '', 'dim')) +
      row('Display Name:', box(f.displayName ?? '', 'dim'))
    : f.format ? row('Format:', box(`${f.format} (stored value)`)) : '<p class="note">No format settings for this field type.</p>';
  const flags = f.auxFlagMask === undefined ? '' :
    `<div class="flagnote" title="PSDBFIELD.AUXFLAGMASK. Which bit App Designer shows as Encrypt or Chart Field is not established yet, so they are not ticked from it.">Stored flags (AUXFLAGMASK): ${f.auxFlagMask}</div>`;
  return `<div class="format">
    <fieldset><legend>Field Format</legend>${rows}</fieldset>
    <div class="flags">${check(f.notUsed, 'Not Used')}${flags}</div>
  </div>`;
}

export interface FieldPageOptions {
  /** Editing is offered: a toolbar whose actions the extension prompts for and saves at once. */
  editable?: boolean;
  /** Why the field is read-only. */
  readOnlyReason?: string;
}

/** The page's script, editable pages only: pick a label row, and post the toolbar's actions. */
const FIELD_SCRIPT = `(() => {
  const vscode = acquireVsCodeApi();
  let label = '';
  document.querySelectorAll('tr[data-label]').forEach((tr) => tr.addEventListener('click', () => {
    document.querySelectorAll('tr[data-label]').forEach((x) => x.classList.remove('sel'));
    tr.classList.add('sel');
    label = tr.dataset.label;
  }));
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => vscode.postMessage({ act: b.dataset.act, label })));
})();`;

export function renderFieldHtml(f: FieldDefinition, connection: string, nonce: string, options: FieldPageOptions = {}): string {
  const editable = options.editable === true;
  const sized = f.type === FieldType.Character || f.type === FieldType.LongCharacter || f.type === FieldType.Number || f.type === FieldType.SignedNumber;
  const toolbar = editable
    ? `<div class="toolbar">${sized ? '<button data-act="length">Change Length…</button>' : ''}
        <button data-act="addLabel">Add Label…</button><button data-act="editLabel">Edit Label…</button>
        <button data-act="defaultLabel">Set Default Label</button><button data-act="description">Change Description…</button>
        <span class="hint">Click a label to choose it · each change is saved to the database at once</span></div>`
    : options.readOnlyReason ? `<div class="note">Read-only: ${esc(options.readOnlyReason)}</div>` : '';
  const typeName = FIELD_TYPE_LABELS[f.type] ?? `Type ${f.type}`;
  const stamp = [
    f.version !== undefined ? `version ${f.version}` : '',
    f.lastUpdated ? `last updated ${f.lastUpdated}${f.lastUpdatedBy ? ` by ${f.lastUpdatedBy}` : ''}` : ''
  ].filter(Boolean).join(' · ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';${editable ? ` script-src 'nonce-${nonce}';` : ''}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(f.name)} (Field)</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 12px 20px 24px; max-width: 780px; }
  .title { display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
           border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; margin-bottom: 12px; }
  .title h1 { font-size: 1.1em; font-weight: 600; margin: 0; }
  .title span { color: var(--vscode-descriptionForeground); font-size: .9em; }
  .row { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
  .row label { font-weight: 600; min-width: 120px; }
  .box { display: inline-block; min-width: 180px; padding: 3px 7px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
         background: var(--vscode-input-background); color: var(--vscode-input-foreground); min-height: 1.3em; }
  .box.short { min-width: 70px; }
  .box.dim { opacity: .6; }
  fieldset { border: 1px solid var(--vscode-panel-border); padding: 6px 12px 10px; margin: 14px 0 0; }
  legend { font-weight: 600; padding: 0 4px; }
  .grid { border-collapse: collapse; width: 100%; font-size: .95em; }
  .grid th { text-align: left; font-weight: normal; color: var(--vscode-descriptionForeground);
             border: 1px solid var(--vscode-panel-border); padding: 3px 6px; background: var(--vscode-editorWidget-background); }
  .grid td { border: 1px solid var(--vscode-panel-border); padding: 3px 6px; height: 1.2em; }
  .grid .n { width: 28px; text-align: right; color: var(--vscode-descriptionForeground); }
  .grid .def { width: 40px; text-align: center; }
  .grid tbody tr:first-child td:nth-child(2) { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .grid tr.empty td:nth-child(2) { background: none; }
  .format { display: flex; gap: 24px; align-items: flex-end; }
  .format fieldset { flex: 0 0 auto; min-width: 360px; }
  .flags { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; }
  .check { display: inline-flex; align-items: center; gap: 6px; }
  .tick { display: inline-flex; justify-content: center; align-items: center; width: 13px; height: 13px;
          border: 1px solid var(--vscode-checkbox-border, var(--vscode-panel-border)); background: var(--vscode-checkbox-background, transparent);
          font-size: 11px; line-height: 1; }
  .check.unknown .tick { opacity: .4; }
  .flagnote, .note { color: var(--vscode-descriptionForeground); font-size: .85em; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .toolbar button { font: inherit; padding: 3px 10px; cursor: pointer; color: var(--vscode-button-secondaryForeground);
                    background: var(--vscode-button-secondaryBackground); border: 1px solid var(--vscode-button-border, transparent); }
  .toolbar .hint { color: var(--vscode-descriptionForeground); font-size: .85em; }
  .grid tr[data-label] { cursor: ${editable ? 'pointer' : 'default'}; }
  .grid tr.sel td { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .descr { white-space: pre-wrap; min-height: 2.6em; }
</style>
</head>
<body>
<div class="title"><h1>${esc(f.name)} (Field)</h1><span>${esc(connection)}${editable ? '' : ' · read-only'}${stamp ? ` · ${esc(stamp)}` : ''}</span></div>
${toolbar}
${row('Field Type:', box(typeName))}
${sizeRows(f)}
<fieldset><legend>Field Labels</legend>${labelsGrid(f)}</fieldset>
${formatGroup(f)}
${f.description !== undefined ? `<fieldset><legend>Description</legend><div class="box descr">${esc(f.description) || '&nbsp;'}</div></fieldset>` : ''}
${editable ? `<script nonce="${nonce}">${FIELD_SCRIPT}</script>` : ''}
</body>
</html>`;
}
