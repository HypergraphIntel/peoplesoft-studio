import { formatText, lengthText, RECORD_TYPE_CHOICES, recordFieldProperties, typeAbbreviation, useRows, editsRows, type RecordLayout } from '../model/recordLayout.js';
import { escapeHtml as esc } from './propertiesHtml.js';
import { RecordFlag, RecordType } from '../model/record.js';

/*
 * The record editor's page, laid out like App Designer's record editor:
 * a Record Fields tab (Field, Use and Edits displays; a subrecord is one
 * row) and a Record Type tab. Read-only, the page runs no script: tabs and
 * displays are CSS-only. Editable, a nonce'd script adds row selection,
 * drag-and-drop reordering, Insert Field / Delete / Move, and the Key, Dir
 * and List toggles of the Use display; every change is posted to the
 * extension, which applies it and repaints the page.
 */

const MIN_ROWS = 24;

export interface RecordPageOptions {
  /** Editing is offered: the page posts changes. */
  editable?: boolean;
  /** Why the record is read-only, shown above the grid. */
  readOnlyReason?: string;
}

const emptyRow = (cells: number) => `<tr class="empty">${'<td></td>'.repeat(cells)}</tr>`;

export function renderRecordHtml(r: RecordLayout, connection: string, nonce: string, options: RecordPageOptions = {}): string {
  const editable = options.editable === true;
  const rowAttrs = (i: number, extra = '') => ` data-i="${i}"${editable ? ' draggable="true"' : ''} tabindex="-1"${extra}`;
  const toggle = (i: number, act: string, label: string, enabled: boolean) => editable && enabled
    ? `<button class="cell" data-act="${act}" data-i="${i}" title="Click to change">${label || '&nbsp;'}</button>` : label;

  const rows = r.fields.map((f, i) => `<tr${rowAttrs(i, f.isSubrecord ? ' class="subrec"' : '')}${f.hasPeopleCode ? ' title="Has Record Field PeopleCode"' : ''}>
      <td class="n">${f.fieldNum}</td><td class="name${f.hasPeopleCode ? ' pc' : ''}">${esc(f.name)}</td><td>${esc(typeAbbreviation(f))}</td>
      <td class="len">${esc(lengthText(f))}</td><td>${esc(formatText(f))}</td>
      <td>${esc(f.shortName)}</td><td>${esc(f.longName)}</td></tr>`);
  for (let i = r.fields.length; i < MIN_ROWS; i++) rows.push(emptyRow(7));

  const uses = useRows(r.fields);
  const useRowsHtml = r.fields.map((f, i) => {
    const u = uses[i];
    const keyed = u.key === 'Key' || u.key === 'Dup';
    return `<tr${rowAttrs(i)}>
      <td class="n">${f.fieldNum}</td><td class="name${f.hasPeopleCode ? ' pc' : ''}">${esc(f.name)}</td><td>${esc(typeAbbreviation(f))}</td>
      <td>${toggle(i, 'key', u.key, !f.isSubrecord && u.key !== 'Alt')}</td><td class="len">${u.order}</td>
      <td>${toggle(i, 'descending', u.dir, keyed)}</td><td>${toggle(i, 'listBox', u.list, !f.isSubrecord)}</td>
      <td class="mono">${esc(u.defaultValue)}</td></tr>`;
  });
  for (let i = r.fields.length; i < MIN_ROWS; i++) useRowsHtml.push(emptyRow(8));

  const edits = editsRows(r.fields);
  const editsRowsHtml = r.fields.map((f, i) => `<tr${rowAttrs(i)}>
      <td class="n">${f.fieldNum}</td><td class="name${f.hasPeopleCode ? ' pc' : ''}">${esc(f.name)}</td><td>${esc(typeAbbreviation(f))}</td>
      <td>${edits[i].required}</td><td>${edits[i].edit}</td><td>${esc(edits[i].promptTable)}</td>
      <td>${esc(edits[i].setControlField)}</td><td>${edits[i].event}</td></tr>`);
  for (let i = r.fields.length; i < MIN_ROWS; i++) editsRowsHtml.push(emptyRow(8));

  const radios = RECORD_TYPE_CHOICES.map((c) => `<div class="radio${c.type === r.recordType ? ' on' : ''}">
      <span class="dot"></span>${esc(c.label)}</div>`).join('');
  const known = RECORD_TYPE_CHOICES.some((c) => c.type === r.recordType);
  // Each record type's controls, as App Designer's Record Type tab shows them.
  const t = r.recordType;
  const isView = t === RecordType.View;
  const isQuery = t === RecordType.QueryView;
  const nonStdEnabled = t === RecordType.Table || isView || isQuery;
  const knownCheck = (label: string, on: boolean) =>
    `<div class="chk"><span class="box2">${on ? '\u2713' : ''}</span>${esc(label)}</div>`;
  const typeControls = [
    `<div class="tfield"><div>Non-Standard SQL<br>Table Name:</div><span class="box${nonStdEnabled ? '' : ' off'}">${r.sqlTableName ? esc(r.sqlTableName) : '&nbsp;'}</span></div>`,
    isView || isQuery ? `<div class="tfield"><div>Build Sequence No:</div><span class="box short">${r.buildSequence ?? ''}</span></div>` : '',
    (isView || t === RecordType.DynamicView) && r.viewSql !== undefined
      ? `<div class="tfield"><button class="sqlbtn" data-act="viewSql">Click to open SQL Editor</button></div>` : '',
    isView || isQuery ? knownCheck('Materialized View', ((r.auxFlagMask ?? 0) & RecordFlag.MaterializedView) !== 0) : '',
    t === RecordType.TemporaryTable ? knownCheck('Global Temporary Table (GTT)', ((r.auxFlagMask ?? 0) & RecordFlag.GlobalTemporaryTable) !== 0) : '',
    isQuery ? `<div class="tfield"><div>Query:</div><span class="box">${esc(r.queryName ?? '')}</span>
      <div class="note">Launching Query Manager is not available here.</div></div>` : ''
  ].filter(Boolean).join('');
  const viewSql = r.viewSql !== undefined
    ? `<details class="sql"><summary class="caption">SQL</summary><pre>${esc(r.viewSql)}</pre></details>` : '';

  const buildButton = r.recordType === RecordType.Table ? '<button data-act="build" title="Generate the Create Table script (not run)">Build Script…</button>' : '';
  const toolbar = editable ? `<div class="toolbar">
      <button data-act="insert">Insert Field…</button><button data-act="remove">Delete</button>
      <button data-act="up">Move Up</button><button data-act="down">Move Down</button>${buildButton}
      <span class="hint">Drag rows to reorder · Use Display: click Key, Dir or List to change · right-click a field for its menu · Double-click a field for its PeopleCode · Ctrl+S saves</span></div>`
    : `<div class="banner">${options.readOnlyReason ? `Read-only: ${esc(options.readOnlyReason)} · ` : ''}Double-click a field for its PeopleCode${buildButton ? ` · ${buildButton}` : ''}</div>`;

  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
  // Each field's Record Field Properties, for the page to show; '<' escaped so the block cannot end early.
  const fieldsJson = JSON.stringify(r.fields.map((f) => ({ ...recordFieldProperties(f), isSubrecord: f.isSubrecord })))
    .replace(/</g, '\\u003c');
  const recordJson = JSON.stringify(r.properties ? { name: r.name, ...r.properties } : null).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(r.name)} (Record)</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 10px 16px 24px; margin: 0; }
  .title { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 8px; }
  .title h1 { font-size: 1.1em; font-weight: 600; margin: 0; }
  .title span { color: var(--vscode-descriptionForeground); font-size: .9em; }
  .tabs > input { position: absolute; opacity: 0; pointer-events: none; }
  .tabs > label { display: inline-block; padding: 4px 10px; border: 1px solid var(--vscode-panel-border); border-bottom: none;
                  margin-right: 2px; cursor: pointer; color: var(--vscode-descriptionForeground); background: var(--vscode-editorWidget-background); }
  .tabs > input:checked + label { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-weight: 600;
                                  position: relative; top: 1px; }
  .tabs > input:focus-visible + label { outline: 1px solid var(--vscode-focusBorder); }
  .panel { display: none; border: 1px solid var(--vscode-panel-border); padding: 0; }
  #t-fields:checked ~ .p-fields, #t-type:checked ~ .p-type { display: block; }
  .grid { border-collapse: collapse; width: 100%; }
  .grid th { text-align: left; font-weight: normal; padding: 3px 6px; border-right: 1px solid var(--vscode-panel-border);
             border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); position: sticky; top: 0; }
  .grid td { padding: 2px 6px; border-right: 1px solid var(--vscode-panel-border); border-bottom: 1px solid var(--vscode-panel-border);
             height: 1.25em; white-space: nowrap; }
  .grid .n { width: 36px; }
  .grid .len { text-align: right; width: 40px; }
  .grid td.name { font-family: var(--vscode-editor-font-family); }
  .grid td.pc { font-weight: 700; }
  .grid td.mono { font-family: var(--vscode-editor-font-family); }
  .grid tr[data-i] { cursor: default; }
  .grid tr.sel td { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .grid tr.drop-before td { box-shadow: inset 0 2px 0 var(--vscode-focusBorder); }
  .grid tr.drop-after td { box-shadow: inset 0 -2px 0 var(--vscode-focusBorder); }
  button.cell { all: unset; display: block; width: 100%; min-height: 1.2em; cursor: pointer; }
  button.cell:hover { text-decoration: underline; }
  button.cell:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
  .toolbar button { font: inherit; padding: 3px 10px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer;
                    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .toolbar .hint { color: var(--vscode-descriptionForeground); font-size: .85em; margin-left: 6px; }
  .banner button { font: inherit; padding: 1px 8px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent);
                   background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .banner { padding: 6px 8px; font-size: .9em; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }
  .modes > input { position: absolute; opacity: 0; pointer-events: none; }
  .modes > label { display: inline-block; padding: 3px 8px; margin: 6px 0 6px 6px; cursor: pointer; font-size: .9em;
                   border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
  .modes > input:checked + label { color: var(--vscode-foreground); background: var(--vscode-editorWidget-background); }
  .modes > input:focus-visible + label { outline: 1px solid var(--vscode-focusBorder); }
  .modes > .grid { display: none; }
  #m-field:checked ~ .g-field, #m-use:checked ~ .g-use, #m-edits:checked ~ .g-edits { display: table; }
  .p-type { padding: 14px 16px; }
  .typecols { display: flex; gap: 32px; align-items: flex-start; }
  fieldset { border: 1px solid var(--vscode-panel-border); padding: 6px 14px 10px; margin: 0; }
  legend { padding: 0 4px; }
  .radio { display: flex; align-items: center; gap: 6px; margin: 5px 0; color: var(--vscode-descriptionForeground); }
  .radio.on { color: var(--vscode-foreground); }
  .dot { width: 11px; height: 11px; border-radius: 50%; border: 1px solid var(--vscode-checkbox-border, var(--vscode-panel-border)); display: inline-block; }
  .radio.on .dot { background: radial-gradient(var(--vscode-foreground) 0 35%, transparent 45%); }
  .box { display: inline-block; min-width: 180px; padding: 3px 7px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
         background: var(--vscode-input-background); color: var(--vscode-input-foreground); min-height: 1.3em; margin-top: 4px; }
  .note { color: var(--vscode-descriptionForeground); font-size: .85em; margin-top: 8px; }
  .sql { margin-top: 16px; }
  .tcontrols { display: flex; flex-direction: column; gap: 14px; }
  .tfield .box.short { min-width: 70px; }
  .box.off { opacity: .45; }
  .sqlbtn { font: inherit; padding: 6px 12px; cursor: pointer; border: 1px solid var(--vscode-button-border, var(--vscode-focusBorder));
            background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .p-type .chk { display: flex; align-items: center; gap: 6px; }
  .p-type .chk.unknown { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
  .p-type .box2 { width: 12px; height: 12px; border: 1px solid var(--vscode-checkbox-border, var(--vscode-panel-border));
                  display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
  .sql pre { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 8px; white-space: pre-wrap; }
  .caption { font-weight: 600; }
  .menu { position: fixed; z-index: 20; min-width: 230px; padding: 4px 0; display: none;
          background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-foreground));
          border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); box-shadow: 0 2px 8px rgba(0,0,0,.35); }
  .menu button { all: unset; display: flex; justify-content: space-between; gap: 24px; width: calc(100% - 24px); padding: 4px 12px; cursor: pointer; }
  .menu button:hover, .menu button:focus { background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
                                           color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); }
  .menu button[disabled] { opacity: .45; cursor: default; background: none; }
  .menu .k { color: var(--vscode-descriptionForeground); }
  .menu hr { border: none; border-top: 1px solid var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); margin: 4px 0; }
  .overlay { position: fixed; inset: 0; z-index: 30; display: none; align-items: flex-start; justify-content: center; padding-top: 40px;
             background: rgba(0,0,0,.35); }
  .dialog { width: min(640px, 94vw); max-height: 86vh; overflow: auto; background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border); box-shadow: 0 4px 16px rgba(0,0,0,.4); }
  .dialog header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-weight: 600;
                   border-bottom: 1px solid var(--vscode-panel-border); }
  .dialog header button { all: unset; cursor: pointer; padding: 0 6px; }
  .dialog .dtabs { padding: 6px 12px 0; }
  .dialog .dtabs button { font: inherit; padding: 3px 10px; margin-right: 2px; cursor: pointer; border: 1px solid var(--vscode-panel-border);
                          background: none; color: var(--vscode-descriptionForeground); }
  .dialog .dtabs button.on { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-weight: 600; }
  .dialog .body { padding: 10px 12px 14px; }
  .dialog .cols { display: flex; gap: 14px; align-items: flex-start; }
  .dialog fieldset { margin: 0 0 10px; }
  .dialog .chk { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  .dialog .chk.unknown { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
  .dialog .chk .box2 { width: 12px; height: 12px; border: 1px solid var(--vscode-checkbox-border, var(--vscode-panel-border));
                        display: inline-flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1; }
  .dialog .chk button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .dialog .chk button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .dialog .row2 { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .dialog .row2 label { min-width: 110px; }
  .dialog .legend2 { color: var(--vscode-descriptionForeground); font-size: .85em; margin-top: 8px; }
  .dialog tr.pickable { cursor: pointer; }
  .dialog tr.pickable:hover td { background: var(--vscode-list-hoverBackground); }
  .dialog table { border-collapse: collapse; width: 100%; }
  .dialog pre.longtext { white-space: pre-wrap; margin: 0; min-height: 4em; font-family: var(--vscode-font-family); }
  .dialog input.box, .dialog select.box, .dialog textarea.box { font: inherit; min-width: 200px; }
  .dialog textarea.box { width: calc(100% - 16px); resize: vertical; }
  .dialog .apply { font: inherit; margin-top: 6px; padding: 3px 10px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent);
                   background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .dialog th, .dialog td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
</style>
</head>
<body data-editable="${editable ? '1' : '0'}">
<div class="title"><h1>${esc(r.name)} (Record)</h1><span>${esc([connection, editable ? 'editable' : 'read-only', `version ${r.version}`, r.description].filter(Boolean).join(' · '))}</span></div>
<div class="tabs">
  <input type="radio" name="tab" id="t-fields" checked><label for="t-fields">Record Fields</label>
  <input type="radio" name="tab" id="t-type"><label for="t-type">Record Type</label>
  <div class="panel p-fields">
    ${toolbar}
    <div class="modes">
      <input type="radio" name="mode" id="m-field" checked><label for="m-field">Field Display</label>
      <input type="radio" name="mode" id="m-use"><label for="m-use">Use Display</label>
      <input type="radio" name="mode" id="m-edits"><label for="m-edits">Edits Display</label>
      <table class="grid g-field">
        <thead><tr><th class="n">Num</th><th>Field Name</th><th>Type</th><th class="len">Len</th><th>Format</th><th>Short Name</th><th>Long Name</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <table class="grid g-use">
        <thead><tr><th class="n">Num</th><th>Field Name</th><th>Type</th><th>Key</th><th class="len">Ordr</th><th>Dir</th><th>List</th><th>Default</th></tr></thead>
        <tbody>${useRowsHtml.join('')}</tbody>
      </table>
      <table class="grid g-edits">
        <thead><tr><th class="n">Num</th><th>Field Name</th><th>Type</th><th>Req</th><th>Edit</th><th>Prompt Table</th><th>Set Control Field</th><th>Event</th></tr></thead>
        <tbody>${editsRowsHtml.join('')}</tbody>
      </table>
    </div>
  </div>
  <div class="panel p-type">
    <div class="typecols">
      <fieldset><legend>Record Type</legend>${radios}</fieldset>
      <div class="tcontrols">${typeControls}</div>
    </div>
    ${known ? '' : `<p class="note">Stored record type ${r.recordType} is not one of these.</p>`}
    ${viewSql}
  </div>
</div>
<div class="menu" id="menu" role="menu"></div>
<div class="overlay" id="overlay"><div class="dialog" role="dialog" aria-modal="true" id="dialog"></div></div>
<script type="application/json" id="fields">${fieldsJson}</script>
<script type="application/json" id="record">${recordJson}</script>
<script nonce="${nonce}">${PAGE_SCRIPT}</script>
</body>
</html>`;
}

/**
 * The page's behaviour. It keeps no record state: it posts a request and the
 * extension acts and repaints; the selected row, tab and display survive the
 * repaint through the webview's state. Double-clicking a field asks for its
 * PeopleCode; the rest (editing) only on an editable page.
 */
const PAGE_SCRIPT = `
(() => {
  const vscode = acquireVsCodeApi();
  const editable = document.body.dataset.editable === '1';
  const st = vscode.getState() || {};
  for (const id of [st.tab, st.mode]) { const el = id && document.getElementById(id); if (el) el.checked = true; }
  const count = document.querySelectorAll('.g-field tr[data-i]').length;
  let sel = Number.isInteger(st.sel) && st.sel < count ? st.sel : -1;
  // The selected rows (Ctrl-click toggles, Shift-click extends); sel is the one last clicked.
  let chosen = new Set((st.chosen || (sel >= 0 ? [sel] : [])).filter((i) => i < count));
  const save = () => vscode.setState({
    ...(vscode.getState() || {}),
    tab: document.querySelector('input[name=tab]:checked')?.id,
    mode: document.querySelector('input[name=mode]:checked')?.id, sel, chosen: [...chosen]
  });
  const mark = () => document.querySelectorAll('tr[data-i]').forEach((tr) => tr.classList.toggle('sel', chosen.has(Number(tr.dataset.i))));
  const select = (i, how = 'single') => {
    if (how === 'toggle') { if (chosen.has(i)) chosen.delete(i); else chosen.add(i); }
    else if (how === 'range' && sel >= 0) { const [a, b] = [Math.min(sel, i), Math.max(sel, i)]; chosen = new Set(); for (let x = a; x <= b; x++) chosen.add(x); }
    else chosen = new Set([i]);
    sel = i; mark(); save();
  };
  const post = (msg) => { save(); vscode.postMessage(msg); };
  const picked = () => (chosen.size ? [...chosen] : sel >= 0 ? [sel] : []).sort((a, b) => a - b);
  const removePicked = () => {
    const indexes = picked();
    if (!indexes.length) return;
    sel = Math.max(0, Math.min(indexes[0], count - indexes.length - 1)); chosen = new Set([sel]);
    post({ type: 'removeMany', indexes });
  };
  const move = (from, to) => { if (from < 0 || to < 0 || to >= count || from === to) return; sel = to; chosen = new Set([to]); post({ type: 'move', from, to }); };
  document.querySelectorAll('input[name=tab], input[name=mode]').forEach((i) => i.addEventListener('change', save));
  document.addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr && !e.target.closest('[data-act]')) { select(Number(tr.dataset.i)); post({ type: 'peoplecode', index: Number(tr.dataset.i) }); }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-act=viewSql]')) { post({ type: 'menu', action: 'viewSql', index: -1 }); return; }
    if (e.target.closest('[data-act=build]')) { post({ type: 'menu', action: 'build', index: -1 }); return; }
    const btn = editable && e.target.closest('[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'insert') return post({ type: 'insert', at: sel >= 0 ? sel + 1 : count });
      if (act === 'remove') return removePicked();
      if (act === 'up') return move(sel, sel - 1);
      if (act === 'down') return move(sel, sel + 1);
      const i = Number(btn.dataset.i);
      select(i);
      return post({ type: 'toggle', index: i, flag: act });
    }
    const tr = e.target.closest('tr[data-i]');
    if (tr) select(Number(tr.dataset.i), e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'single');
  });
  document.addEventListener('keydown', (e) => {
    const target = e.target instanceof Element ? e.target : document.body;
    if (sel < 0 || target.closest('input, button, .menu, .overlay')) return;
    if (document.getElementById('overlay').style.display === 'flex') return;
    if (e.key === 'Enter') { post({ type: 'peoplecode', index: sel }); e.preventDefault(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'c' || e.key === 'C')) { post({ type: 'copy', indexes: picked() }); e.preventDefault(); return; }
    if (editable && mod && (e.key === 'x' || e.key === 'X')) { post({ type: 'cut', indexes: picked() }); e.preventDefault(); return; }
    if (editable && mod && (e.key === 'v' || e.key === 'V')) { post({ type: 'paste', at: sel >= 0 ? sel + 1 : count }); e.preventDefault(); return; }
    if (!editable) {
      if (e.key === 'ArrowUp' && sel > 0) { select(sel - 1); e.preventDefault(); }
      else if (e.key === 'ArrowDown' && sel < count - 1) { select(sel + 1); e.preventDefault(); }
      return;
    }
    if (e.key === 'Delete') { removePicked(); e.preventDefault(); }
    else if (e.altKey && e.key === 'ArrowUp') { move(sel, sel - 1); e.preventDefault(); }
    else if (e.altKey && e.key === 'ArrowDown') { move(sel, sel + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && sel > 0) { select(sel - 1); e.preventDefault(); }
    else if (e.key === 'ArrowDown' && sel < count - 1) { select(sel + 1); e.preventDefault(); }
  });
  let dragFrom = -1;
  const clear = () => document.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  document.addEventListener('dragstart', (e) => {
    const tr = editable && e.target.closest && e.target.closest('tr[data-i]');
    if (!tr) return;
    dragFrom = Number(tr.dataset.i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFrom));
  });
  document.addEventListener('dragover', (e) => {
    const tr = e.target.closest && e.target.closest('tr[data-i]');
    if (!tr || dragFrom < 0) return;
    e.preventDefault();
    clear();
    const after = e.offsetY > tr.offsetHeight / 2;
    tr.classList.add(after ? 'drop-after' : 'drop-before');
  });
  document.addEventListener('drop', (e) => {
    const tr = e.target.closest && e.target.closest('tr[data-i]');
    clear();
    if (!tr || dragFrom < 0) return;
    e.preventDefault();
    const over = Number(tr.dataset.i);
    const after = tr.classList.contains('drop-after') || e.offsetY > tr.offsetHeight / 2;
    let to = over + (after ? 1 : 0);
    if (dragFrom < to) to -= 1;
    move(dragFrom, to);
    dragFrom = -1;
  });
  document.addEventListener('dragend', () => { dragFrom = -1; clear(); });
  // ---- App Designer's field menu, Record Field Properties and View Translates.
  const fields = JSON.parse(document.getElementById('fields').textContent || '[]');
  const record = JSON.parse(document.getElementById('record').textContent || 'null');
  const menu = document.getElementById('menu');
  const overlay = document.getElementById('overlay');
  const dialog = document.getElementById('dialog');
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'text') n.textContent = v; else if (k === 'cls') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) n.append(kid);
    return n;
  };
  const hideMenu = () => { menu.style.display = 'none'; };
  const act = (action, i) => {
    hideMenu();
    if (action === 'recordProperties' && record) return openRecordProps('general');
    if (i < 0 || !fields[i]) return;
    if (action === 'rfp') return openProps(i, 'use');
    if (action === 'recordProperties' && record) return openRecordProps('general');
    if (action === 'delete') { if (editable) removePicked(); return; }
    if (action === 'copy') return post({ type: 'copy', indexes: picked() });
    if (action === 'cut') { if (editable) post({ type: 'cut', indexes: picked() }); return; }
    if (action === 'paste') { if (editable) post({ type: 'paste', at: i + 1 }); return; }
    post({ type: 'menu', action, index: i });
  };
  const showMenu = (i, x, y) => {
    const f = fields[i];
    const items = [
      ['definition', 'View Definition', 'Ctrl+D', !f.isSubrecord], ['peoplecode', 'View PeopleCode', 'Ctrl+E', !f.isSubrecord],
      ['translates', 'View Translates', '', !f.isSubrecord], ['fieldProperties', 'View Field Properties', '', !f.isSubrecord], null,
      ['cut', 'Cut', 'Ctrl+X', editable], ['copy', 'Copy', 'Ctrl+C', true], ['paste', 'Paste', 'Ctrl+V', editable],
      ['delete', 'Delete', 'Del', editable], null,
      ['refsField', 'Find Definition References - Field', '', !f.isSubrecord], ['refsRecordField', 'Find Definition References - Record Field', '', !f.isSubrecord], null,
      ['rfp', 'Record Field Properties', 'Ctrl+Enter', !f.isSubrecord], ['recordProperties', 'Record Properties', 'Alt+Enter', true]
    ];
    menu.replaceChildren(...items.map((it) => it ? el('button', it[3] ? { role: 'menuitem', onclick: () => act(it[0], i) } : { role: 'menuitem', disabled: '' },
      el('span', { text: it[1] }), el('span', { cls: 'k', text: it[2] })) : el('hr')));
    menu.style.display = 'block';
    menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 4) + 'px';
    menu.querySelector('button:not([disabled])')?.focus();
  };
  document.addEventListener('contextmenu', (e) => {
    const tr = e.target.closest && e.target.closest('tr[data-i]');
    if (!tr) return;
    e.preventDefault();
    const i = Number(tr.dataset.i);
    if (!chosen.has(i)) select(i); else { sel = i; save(); }
    showMenu(sel, e.clientX, e.clientY);
  });
  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) hideMenu(); });
  const closeDialog = () => { overlay.style.display = 'none'; dialog.replaceChildren(); vscode.setState({ ...(vscode.getState() || {}), dialog: undefined }); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeDialog(); });
  const header = (title) => el('header', {}, el('span', { text: title }), el('button', { title: 'Close', onclick: closeDialog, text: '×' }));
  const check = (c, i) => {
    const mark = c.state === 'unknown' ? '–' : c.state ? '✓' : '';
    const box = el('span', { cls: 'box2', text: mark });
    const k = c.flag && fields[i] ? Object.fromEntries(fields[i].keys.map((x) => [x.flag, x.state])) : {};
    const live = editable && c.flag && !(c.flag === 'descending' && !k.key && !k.dupOrder) && !(c.flag === 'searchKey' && !k.key) && !(c.flag === 'searchEdit' && !k.searchKey);
    const title = c.state === 'unknown' ? 'Not established from the stored record yet' : '';
    const label = el('span', { text: c.label });
    return el('div', { cls: 'chk' + (c.state === 'unknown' ? ' unknown' : ''), title },
      live ? el('button', { onclick: () => { post({ type: 'toggle', index: i, flag: c.flag }); } }, box, label) : box, live ? null : label);
  };
  const group = (title, items, i) => el('fieldset', {}, el('legend', { text: title }), ...items.map((c) => check(c, i)));
  const row2 = (label, value) => el('div', { cls: 'row2' }, el('label', { text: label }), el('span', { cls: 'box', text: value || ' ' }));
  const input = (value, attrs) => { const n = el('input', { cls: 'box', type: 'text', ...(attrs || {}) }); n.value = value || ''; return n; };
  const dropdown = (options, value, onchange) => {
    const n = el('select', { cls: 'box', onchange: () => onchange(n.value) },
      ...options.map(([v, t, off]) => { const o = el('option', { value: String(v), text: t }); if (off) o.disabled = true; return o; }));
    n.value = String(value);
    return n;
  };
  const field2 = (label, control) => el('div', { cls: 'row2' }, el('label', { text: label }), control);
  function openProps(i, tab) {
    const f = fields[i];
    if (!f || f.isSubrecord) return;
    vscode.setState({ ...(vscode.getState() || {}), dialog: { i, tab } });
    const tabs = el('div', { cls: 'dtabs' },
      el('button', { cls: tab === 'use' ? 'on' : '', text: 'Use', onclick: () => openProps(i, 'use') }),
      el('button', { cls: tab === 'edits' ? 'on' : '', text: 'Edits', onclick: () => openProps(i, 'edits') }));
    const unexplained = f.unexplained.useEdit || f.unexplained.useEdit2
      ? el('div', { cls: 'legend2', text: 'Other stored bits, not yet read as settings: USEEDIT 0x' + f.unexplained.useEdit.toString(16) + ', USEEDIT2 0x' + f.unexplained.useEdit2.toString(16) }) : null;
    let right;
    if (editable) {
      const constant = input(f.defaultConstant), record = input(f.defaultRecord), fieldName = input(f.defaultField);
      const pageKnown = f.pageControlOptions.some((o) => o[0] === f.pageControlValue);
      right = el('div', {},
        el('fieldset', {}, el('legend', { text: 'Record Field Label ID' }),
          dropdown([['', '*** Use Default Label ***'], ...f.labels.map((l) => [l.id, l.text])], f.labelId,
            (v) => post({ type: 'label', index: i, labelId: v }))),
        el('fieldset', {}, el('legend', { text: 'Default Value' }), field2('Constant:', constant), field2('Record Name:', record), field2('Field Name:', fieldName),
          el('button', { cls: 'apply', text: 'Apply Default', onclick: () => post(record.value.trim()
            ? { type: 'default', index: i, record: record.value, field: fieldName.value }
            : { type: 'default', index: i, constant: constant.value }) })),
        el('fieldset', {}, el('legend', { text: 'Default Page Control' }), pageKnown
          ? dropdown(f.pageControlOptions, f.pageControlValue, (v) => post({ type: 'pageControl', index: i, value: Number(v) }))
          : el('span', { cls: 'box', text: f.pageControl })));
    } else {
      right = el('div', {},
        el('fieldset', {}, el('legend', { text: 'Record Field Label ID' }), el('span', { cls: 'box', text: f.label })),
        el('fieldset', {}, el('legend', { text: 'Default Value' }), row2('Constant:', f.defaultConstant), row2('Record Name:', f.defaultRecord), row2('Field Name:', f.defaultField)),
        el('fieldset', {}, el('legend', { text: 'Default Page Control' }), el('span', { cls: 'box', text: f.pageControl })));
    }
    let editsBody;
    const required = el('div', { cls: 'chk' }, editable
      ? el('button', { onclick: () => post({ type: 'edits', index: i, required: !f.required }) }, el('span', { cls: 'box2', text: f.required ? '✓' : '' }), el('span', { text: 'Required' }))
      : el('span', { cls: 'box2', text: f.required ? '✓' : '' }), editable ? null : el('span', { text: 'Required' }));
    if (editable && f.edit !== 'Translate Table Edit') {
      const types = [['none', 'No Edit'], ['prompt', 'Prompt Table Edit'], ['promptNoEdit', 'Prompt Table with No Edit'], ['yesNo', 'Yes/No Table Edit']];
      const current = { 'No Edit': 'none', 'Prompt Table Edit': 'prompt', 'Prompt Table with No Edit': 'promptNoEdit', 'Yes/No Table Edit': 'yesNo' }[f.edit];
      const table = input(f.promptTable);
      let chosen = current;
      const type = dropdown(types, current, (v) => { chosen = v; });
      editsBody = el('fieldset', {}, el('legend', { text: 'Edit Type' }), field2('Type:', type), field2('Prompt Table:', table),
        row2('Set Control Field:', f.setControlField),
        el('button', { cls: 'apply', text: 'Apply Edit', onclick: () => post({ type: 'edits', index: i, edit: chosen, promptTable: table.value }) }));
    } else {
      editsBody = el('fieldset', {}, el('legend', { text: 'Edit Type' }), row2('Edit:', f.edit === 'No Edit' ? 'No Edit' : 'Table Edit'),
        row2('Type:', f.edit === 'No Edit' ? '' : f.edit), row2('Prompt Table:', f.promptTable), row2('Set Control Field:', f.setControlField),
        editable ? el('div', { cls: 'legend2', text: 'A translate table edit cannot be changed here yet.' }) : null);
    }
    const body = tab === 'use'
      ? el('div', { cls: 'body' }, row2('Field Name:', f.name),
          el('div', { cls: 'cols' }, el('div', {}, group('Keys', f.keys, i), group('Audit', f.audit, i), group(' ', f.other, i)), right),
          el('div', { cls: 'legend2', text: '– = not established from the stored record yet.' + (editable ? ' Settings shown with a box can be changed here.' : '') }), unexplained)
      : el('div', { cls: 'body' }, row2('Field Name:', f.name), required, editsBody, unexplained);
    dialog.replaceChildren(header('Record Field Properties'), tabs, body);
    overlay.style.display = 'flex';
  }
  // App Designer's Record Properties: General and Use. Editable, the plain settings take inputs and Apply;
  // the audit record and options and the system ID / timestamp fields are shown only.
  function openRecordProps(tab) {
    vscode.setState({ ...(vscode.getState() || {}), dialog: { record: true, tab } });
    const r = record;
    const tabs = el('div', { cls: 'dtabs' },
      el('button', { cls: tab === 'general' ? 'on' : '', text: 'General', onclick: () => openRecordProps('general') }),
      el('button', { cls: tab === 'use' ? 'on' : '', text: 'Use', onclick: () => openRecordProps('use') }));
    const unknown = (label) => check({ label, state: 'unknown' }, -1);
    const known = (label, on) => check({ label, state: !!on }, -1);
    const none = (v) => v || 'None';
    const fieldNames = fields.filter((f) => !f.isSubrecord).map((f) => f.name);
    const edits = {};
    const text = (key, value, attrs) => {
      if (!editable) return el('span', { cls: 'box', text: value || ' ' });
      const n = input(value, attrs); n.addEventListener('input', () => { edits[key] = n.value; }); return n;
    };
    const flag = (key, label, on) => {
      if (!editable) return known(label, on);
      const box = el('span', { cls: 'box2', text: on ? '✓' : '' });
      return el('div', { cls: 'chk' }, el('button', { onclick: () => { edits[key] = !(edits[key] ?? on); box.textContent = edits[key] ? '✓' : ''; } }, box, el('span', { text: label })));
    };
    const apply = editable ? el('button', { cls: 'apply', text: 'Apply', onclick: () => { if (Object.keys(edits).length) post({ type: 'recordProps', change: edits }); } }) : null;
    let body;
    if (tab === 'general') {
      let definition;
      if (editable) {
        definition = el('textarea', { cls: 'box longtext', rows: '6' });
        definition.value = r.definition || '';
        definition.addEventListener('input', () => { edits.definition = definition.value; });
      } else definition = el('pre', { cls: 'longtext', text: r.definition || ' ' });
      body = el('div', { cls: 'body' }, row2('Record:', r.name), field2('Description:', text('description', r.description, { maxlength: '30' })),
        el('fieldset', {}, el('legend', { text: 'Record Definition' }), definition),
        field2('Owner ID:', text('ownerId', r.ownerId, { maxlength: '4' })),
        el('fieldset', {}, el('legend', { text: 'Last Updated' }), row2('Date/Time:', r.lastUpdated), row2('By User:', r.lastUpdatedBy)),
        unknown('Runtime Definition'), apply);
    } else {
      const setControl = editable
        ? dropdown([['', '(none)'], ...fieldNames.map((n) => [n, n])], r.setControlField, (v) => { edits.setControlField = v; })
        : el('span', { cls: 'box', text: r.setControlField || ' ' });
      const audit = (bit) => (r.recUse & bit) !== 0;
      body = el('div', { cls: 'body' }, field2('Set Control Field:', setControl),
        el('fieldset', {}, el('legend', { text: 'Record Relationships' }), field2('Parent Record:', text('parentRecord', r.parentRecord)),
          field2('Related Language Record:', text('relatedLanguageRecord', r.relatedLanguageRecord)),
          field2('Query Security Record:', text('querySecurityRecord', r.querySecurityRecord)),
          field2('Analytic Delete Record:', text('analyticDeleteRecord', r.analyticDeleteRecord))),
        el('fieldset', {}, el('legend', { text: 'Record Audit' }), row2('Record Name:', r.auditRecord),
          el('div', { cls: 'cols' }, known('Add', audit(1)), known('Change', audit(2)), known('Selective', audit(8)), known('Delete', audit(4)))),
        el('fieldset', {}, el('legend', { text: 'Record-level Auto-Update' }), row2('System ID Field:', none(r.systemIdField)),
          row2('Timestamp Field:', none(r.timestampField))),
        unknown('Real Time Indexing Trigger Record'),
        el('div', { cls: 'cols' }, el('fieldset', {}, el('legend', { text: 'Sync type (MSF)' }), unknown('Server -> User (Down Sync)'), unknown('User -> Server (Up Sync)')),
          el('fieldset', {}, el('legend', { text: 'Record Information' }), flag('toolsTable', 'Tools Table', (r.auxFlagMask & 0x10000) !== 0),
            flag('managed', 'Managed', (r.auxFlagMask & 0x20000) !== 0))),
        unknown('Append All (Dynamic Views)'), apply,
        el('div', { cls: 'legend2', text: '– = not established yet.' + (editable ? ' The audit record and options and the system ID / timestamp fields are not changed here yet.' : '') }));
    }
    dialog.replaceChildren(header('Record Properties'), tabs, body);
    overlay.style.display = 'flex';
  }
  function openTranslates(name, rows, error, writable) {
    vscode.setState({ ...(vscode.getState() || {}), dialog: undefined });
    // Add, change and delete as App Designer saves them (docs/RECORD_SAVE.md, r37-r39, r42-r44).
    const form = {};
    // App Designer's first value took the day it was added (r37).
    const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
    const input = (key, attrs) => { const n = el('input', { cls: 'box', ...attrs }); form[key] = n; return n; };
    const fresh = () => {
      form.value.value = ''; form.effectiveDate.value = today(); form.status.value = 'A'; form.longName.value = ''; form.shortName.value = '';
      form.value.disabled = false; form.effectiveDate.disabled = false;
    };
    const pick = (r) => {
      form.value.value = r.value; form.effectiveDate.value = r.effectiveDate; form.status.value = r.status === 'I' ? 'I' : 'A';
      form.longName.value = r.longName; form.shortName.value = r.shortName;
      form.value.disabled = true; form.effectiveDate.disabled = true;
    };
    const table = el('table', {}, el('thead', {}, el('tr', {}, ...['Field Value', 'Eff Date', 'Status', 'Long Name', 'Short Name'].map((h) => el('th', { text: h })))),
      el('tbody', {}, ...rows.map((r) => el('tr', writable ? { onclick: () => pick(r), cls: 'pickable' } : {},
        ...[r.value, r.effectiveDate, r.status, r.longName, r.shortName].map((v) => el('td', { text: v }))))));
    let editor = null;
    if (writable && !error) {
      const status = el('select', { cls: 'box' }, el('option', { value: 'A', text: 'Active' }), el('option', { value: 'I', text: 'Inactive' }));
      form.status = status;
      const item = () => ({ value: form.value.value.trim(), effectiveDate: form.effectiveDate.value, status: form.status.value,
        longName: form.longName.value, shortName: form.shortName.value });
      const send = (change) => post({ type: 'xlat', field: name, change });
      editor = el('fieldset', {}, el('legend', { text: 'Click a value to change or delete it; New to add one' }),
        field2('Field Value:', input('value', { maxlength: '4' })),
        field2('Effective Date:', input('effectiveDate', { type: 'date' })),
        field2('Status:', status),
        field2('Long Name:', input('longName', { maxlength: '30' })),
        field2('Short Name:', input('shortName', { maxlength: '10' })),
        el('button', { cls: 'apply', text: 'New', onclick: fresh }),
        el('button', { cls: 'apply', text: 'Add', onclick: () => { if (!form.value.disabled) send({ kind: 'add', item: item() }); } }),
        el('button', { cls: 'apply', text: 'Change', onclick: () => { if (form.value.disabled) send({ kind: 'change', item: item() }); } }),
        el('button', { cls: 'apply', text: 'Delete', onclick: () => { if (form.value.disabled) send({ kind: 'delete', value: form.value.value, effectiveDate: form.effectiveDate.value }); } }),
        el('div', { cls: 'legend2', text: 'Each change is saved to the database at once.' }));
      fresh();
    }
    const body = el('div', { cls: 'body' }, row2('Field Name:', name),
      error ? el('p', { text: error }) : rows.length === 0 ? el('p', { text: 'This field has no translate values.' }) : table, editor);
    dialog.replaceChildren(header('Translate Values'), body);
    overlay.style.display = 'flex';
  }
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'translates') openTranslates(m.field, m.rows || [], m.error, m.writable === true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideMenu(); if (overlay.style.display === 'flex') closeDialog(); return; }
    if (sel < 0 || overlay.style.display === 'flex') return;
    if (e.ctrlKey && e.key === 'Enter') { act('rfp', sel); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.altKey && e.key === 'Enter') { act('recordProperties', sel); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) { act('definition', sel); e.preventDefault(); }
    else if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) { act('peoplecode', sel); e.preventDefault(); }
  }, true);
  if (st.dialog && st.dialog.record && record) openRecordProps(st.dialog.tab);
  else if (st.dialog && fields[st.dialog.i]) openProps(st.dialog.i, st.dialog.tab);
  mark();
})();`;
