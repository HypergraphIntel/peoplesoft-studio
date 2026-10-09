import { escapeHtml as esc } from './propertiesHtml.js';
import { controlShape, type PageControl, type PageLayout } from '../model/pageLayout.js';
import { PAGE_FIELD_TYPES } from '../model/uiDefinitions.js';
import { NEW_CONTROL_FIELDTYPE, NEW_CONTROL_SIZE, isRecordBound, type NewControlKind } from '../providers/pageControlTemplates.js';

/*
 * A page in App Designer's Layout view (controls drawn from their stored
 * geometry) and Order view (the control grid), with a shared properties
 * sidebar on the right for both. On a Writable connection the Layout view is
 * an editor -- drag to move, corner-resize, Delete, and edit the label and use
 * in the sidebar -- and Save writes the changes through pageWriter.ts.
 *
 * Positions are set by per-control rules in a nonce'd <style> block, not inline
 * style attributes (the webview CSP's style-src is nonce-only). During editing
 * the script moves controls with element.style.* (CSSOM, which the CSP allows)
 * and keeps each control's stored PSPNLFIELD columns in data-* attributes, so
 * Save round-trips the exact columns the writer expects. The Insert palette
 * adds controls (pageControlTemplates.ts holds the rows App Designer writes);
 * after a save that added any, the panel re-renders from the database so
 * they carry their new PNLFLDIDs.
 */

const px = (n: number) => `${Math.round(n)}px`;

export interface PageHtmlOptions {
  /** The connection is Writable and has an operator: the page can be edited and saved. */
  editable: boolean;
  /** The toolbar's opening status (e.g. after a save re-rendered the page). */
  status?: string;
}

/** The Insert palette, in App Designer's Insert-menu order. */
const PALETTE: Array<{ kind: NewControlKind; label: string }> = [
  { kind: 'frame', label: 'Frame' }, { kind: 'groupBox', label: 'Group Box' }, { kind: 'horizontalRule', label: 'Horizontal Rule' },
  { kind: 'staticText', label: 'Static Text' }, { kind: 'checkBox', label: 'Check Box' }, { kind: 'dropDown', label: 'Drop Down List Box' },
  { kind: 'editBox', label: 'Edit Box' }, { kind: 'pushButton', label: 'Push Button' }
];

/** What the script needs to draw a new control of each kind. */
function paletteKinds(): Record<string, unknown> {
  return Object.fromEntries(PALETTE.map(({ kind }) => {
    const z = NEW_CONTROL_SIZE[kind];
    const shape = controlShape(NEW_CONTROL_FIELDTYPE[kind]);
    // Auto-sized controls (0 x 0, sized by App Designer from the field) are drawn at a stand-in size.
    const drawn = shape === 'checkbox' ? [14, 14] : [80, 18];
    return [kind, { shape, typeName: PAGE_FIELD_TYPES[NEW_CONTROL_FIELDTYPE[kind]] ?? kind, bound: isRecordBound(kind),
      w: z.width, h: z.height, dw: z.width || drawn[0], dh: z.height || drawn[1], fst: z.fieldSizeType, lt: z.lblType, lx: z.lblText }];
  }));
}

/** The control's editable columns as data-* attributes, for the editor round-trip and the sidebar. */
function columnData(c: PageControl): string {
  const k = c.columns;
  return `data-id="${c.pnlFldId}" data-num="${c.num}" data-level="${c.level}" data-type="${esc(c.typeName)}"` +
    ` data-target="${esc(c.target)}" data-rec="${esc(c.recName)}" data-field="${esc(c.fieldName)}" data-pfn="${esc(c.pageFieldName)}"` +
    ` data-defer="${c.deferProc ? 1 : 0}" data-ctlfld="${c.controlFieldNum}" data-fl="${k.fieldLeft}" data-ft="${k.fieldTop}"` +
    ` data-fr="${k.fieldRight}" data-fb="${k.fieldBottom}" data-ell="${k.editLblLeft}" data-elt="${k.editLblTop}"` +
    ` data-elr="${k.editLblRight}" data-elb="${k.editLblBottom}" data-fst="${k.fieldSizeType}" data-lt="${k.lblType}"` +
    ` data-lx="${esc(k.lblText)}" data-fu="${k.fieldUse}" data-si="${k.secureInvisible}"`;
}

function controlsHtml(controls: readonly PageControl[], editable: boolean): string {
  return controls.map((c) => {
    const parts: string[] = [];
    if (c.label) parts.push(`<div class="lbl" id="l${c.pnlFldId}">${esc(c.label.text)}</div>`);
    const inner = c.shape === 'checkbox' ? '<span class="box"></span>'
      : c.shape === 'radio' ? '<span class="dot"></span>'
      : c.shape === 'dropdown' ? '<span class="caret">▾</span>'
      : c.shape === 'button' ? esc(c.columns.lblText || c.typeName) : '';
    const cls = `ctl s-${c.shape}${c.displayOnly ? ' u-display-only' : ''}${c.invisible ? ' u-invisible' : ''}`;
    parts.push(
      `<div class="${cls}" id="c${c.pnlFldId}" tabindex="0" title="${esc(`${c.num}. ${c.typeName}`)}" ${columnData(c)}>` +
      `${inner}${editable ? '<span class="rsz" aria-hidden="true"></span>' : ''}</div>`);
    return parts.join('');
  }).join('\n');
}

function geometryCss(controls: readonly PageControl[]): string {
  const rules: string[] = [];
  for (const c of controls) {
    rules.push(`#c${c.pnlFldId}{left:${px(c.rect.left)};top:${px(c.rect.top)};width:${px(c.rect.width)};height:${px(c.rect.height)};` +
      `z-index:${c.shape === 'container' ? 1 : 2}}`);
    if (c.label) {
      rules.push(`#l${c.pnlFldId}{left:${px(c.label.rect.left)};top:${px(c.label.rect.top)};` +
        `${c.label.rect.width ? `max-width:${px(c.label.rect.width)};` : ''}}`);
    }
  }
  return rules.join('\n');
}

/** The Order view as App Designer's grid: one row per control in FIELDNUM order. */
function orderGrid(controls: readonly PageControl[]): string {
  const head = ['Tab Order', 'Field ID', 'Lvl', 'Label', 'Type', 'Field', 'Record', 'Page Field Name', 'Deferred', 'Control Field'];
  const rows = [...controls].sort((a, b) => a.num - b.num).map((c) =>
    `<tr data-id="${c.pnlFldId}" tabindex="0">` +
    `<td class="n">${c.num}</td><td class="n">${c.pnlFldId}</td><td class="n">${c.level}</td>` +
    `<td>${esc(c.columns.lblText)}</td><td>${esc(c.typeName)}</td><td>${esc(c.fieldName)}</td><td>${esc(c.recName)}</td>` +
    `<td>${esc(c.pageFieldName)}</td><td class="c">${c.deferProc ? '✓' : ''}</td><td class="n">${c.controlFieldNum || ''}</td></tr>`).join('\n');
  return `<table class="order-grid"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderPageHtml(layout: PageLayout, orderText: string, nonce: string, options: PageHtmlOptions = { editable: false }): string {
  void orderText;
  const editable = options.editable;
  const subtitle = [layout.pageType, `${layout.controls.length} controls`, `${layout.width}×${layout.height}`,
    `v${layout.version}`, editable ? 'editable' : 'read-only', layout.description].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>${esc(layout.name)}</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  header { padding: 0.5rem 1rem 0; display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  h1 { font-size: 1.1em; margin: 0; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0.1rem 0 0.4rem; }
  .toolbar { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; }
  button.action { font: inherit; padding: 0.25rem 0.8rem; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 3px; cursor: pointer; }
  button.action:disabled { opacity: 0.5; cursor: default; }
  .status { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .status.err { color: var(--vscode-errorForeground); }
  .tabs { display: flex; gap: 2px; padding: 0 1rem; border-bottom: 1px solid var(--vscode-panel-border, #8884); }
  .tab { background: transparent; color: var(--vscode-foreground); border: none; border-bottom: 2px solid transparent; padding: 0.35rem 0.9rem; opacity: 0.75; cursor: pointer; font: inherit; }
  .tab.selected { opacity: 1; border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder)); }
  .tab:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .main { display: flex; height: calc(100vh - 86px); }
  .content { flex: 1; min-width: 0; position: relative; }
  .panel { display: none; position: absolute; inset: 0; overflow: auto; } .panel.selected { display: block; }
  .canvas-scroll { padding: 16px; }
  .canvas { position: relative; background: #fbfbfb; border: 1px solid #b9b9b9; width: ${layout.width}px; height: ${layout.height}px; }
  .ctl { position: absolute; box-sizing: border-box; font-size: 11px; color: #1a1a1a; overflow: hidden; display: flex; align-items: center; padding: 0 2px; }
  .ctl:focus { outline: 2px solid var(--vscode-focusBorder); }
  .lbl { position: absolute; font-size: 11px; color: #1a1a1a; white-space: nowrap; z-index: 2; }
  .s-field, .s-dropdown { background: #fff; border: 1px solid #7a7a7a; }
  .s-dropdown { justify-content: flex-end; } .caret { color: #555; }
  .s-checkbox, .s-radio { border: none; background: transparent; }
  .s-checkbox .box { width: 12px; height: 12px; border: 1px solid #555; background: #fff; display: inline-block; }
  .s-radio .dot { width: 12px; height: 12px; border: 1px solid #555; border-radius: 50%; background: #fff; display: inline-block; }
  .s-button { background: #e6e6e6; border: 1px solid #707070; border-radius: 2px; justify-content: center; font-size: 10px; color: #222; }
  .s-container { background: rgba(120,140,200,0.05); border: 1px solid #9aa7c8; align-items: flex-start; }
  .s-label { border: 1px dashed transparent; } .s-image { background: #eef; border: 1px dashed #88a; }
  .s-rule { background: #999; } .s-misc { border: 1px dotted #888; background: #f4f4f4; }
  .u-display-only { opacity: 0.55; }
  .u-invisible { background-image: repeating-linear-gradient(45deg, #0000 0 4px, #8883 4px 6px); border-style: dashed; }
  .removed { display: none; }
  .selected-ctl { outline: 2px solid #c02; outline-offset: 0; }
  .editable .ctl { cursor: move; }
  .rsz { position: absolute; right: -3px; bottom: -3px; width: 8px; height: 8px; background: #c02; border: 1px solid #fff; cursor: nwse-resize; display: none; z-index: 3; }
  .selected-ctl .rsz { display: block; }
  .order-grid { border-collapse: collapse; font-size: 0.86em; width: 100%; }
  .order-grid th, .order-grid td { border: 1px solid var(--vscode-panel-border, #8884); padding: 1px 6px; text-align: left; white-space: nowrap; }
  .order-grid th { position: sticky; top: 0; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
  .order-grid td.n, .order-grid td.c { text-align: center; }
  .order-grid tbody tr { cursor: pointer; } .order-grid tbody tr:hover { background: var(--vscode-list-hoverBackground, #8881); }
  .order-grid tr.sel { background: var(--vscode-list-activeSelectionBackground, #0978); color: var(--vscode-list-activeSelectionForeground, inherit); }
  .inspector { width: 290px; flex: 0 0 290px; border-left: 1px solid var(--vscode-panel-border, #8884); padding: 12px; overflow: auto; background: var(--vscode-editorWidget-background, transparent); }
  .insp-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; }
  .inspector h2 { font-size: 0.95em; margin: 0; }
  button.link { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; padding: 0; }
  button.link:hover { text-decoration: underline; }
  .inspector table.props { border-collapse: collapse; width: 100%; margin-bottom: 0.6rem; }
  .inspector table.props td { padding: 1px 4px; vertical-align: top; word-break: break-word; }
  .inspector table.props td.k { color: var(--vscode-descriptionForeground); white-space: nowrap; width: 42%; }
  .inspector label { display: block; margin: 0.4rem 0 0.1rem; color: var(--vscode-descriptionForeground); }
  .inspector input[type=text], .inspector select, .inspector textarea { width: 100%; box-sizing: border-box; font: inherit; }
  .inspector .row { display: flex; align-items: center; gap: 0.4rem; margin: 0.3rem 0; }
  .inspector input[type=number] { width: 6em; font: inherit; }
  .hint { color: var(--vscode-descriptionForeground); }
  .pg-edge { position: absolute; z-index: 4; }
  .pg-r { top: 0; right: -4px; width: 7px; height: 100%; cursor: ew-resize; }
  .pg-b { left: 0; bottom: -4px; height: 7px; width: 100%; cursor: ns-resize; }
  .pg-rb { right: -6px; bottom: -6px; width: 11px; height: 11px; cursor: nwse-resize; background: #c02; border: 1px solid #fff; }
  .pg-edge:hover, .pg-edge.dragging { background: var(--vscode-focusBorder, #07f); opacity: 0.6; }
  .palette { display: flex; gap: 0.25rem; align-items: center; color: var(--vscode-descriptionForeground); margin-right: 0.75rem; flex-wrap: wrap; }
  button.tool { font: inherit; font-size: 0.9em; padding: 0.1rem 0.5rem; border: 1px solid var(--vscode-button-border, #8886); background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, inherit); border-radius: 3px; cursor: pointer; }
  .new-ctl { box-shadow: 0 0 0 1px #2a7 inset; }
  .lbl.placeholder { color: #888; font-style: italic; }
${geometryCss(layout.controls)}
</style>
</head>
<body class="${editable ? 'editable' : ''}">
  <header>
    <div><h1>${esc(layout.name)}</h1><p class="sub">${esc(subtitle)}</p></div>
    ${editable ? `<div class="toolbar"><span class="palette">Insert:${PALETTE.map((p) => ` <button class="tool" data-kind="${p.kind}">${esc(p.label)}</button>`).join('')}</span>` +
      `<span class="status" id="status">${esc(options.status ?? 'No changes')}</span><button class="action" id="save" disabled>Save</button></div>` : ''}
  </header>
  <div class="tabs" role="tablist">
    <button class="tab selected" id="tab-layout" role="tab">Layout</button>
    <button class="tab" id="tab-order" role="tab">Order</button>
  </div>
  <div class="main">
    <div class="content">
      <div class="panel selected" id="panel-layout"><div class="canvas-scroll"><div class="canvas" id="canvas">
${controlsHtml(layout.controls, editable)}
${editable ? '<div class="pg-edge pg-r" data-edge="r" title="Drag to set the page width"></div><div class="pg-edge pg-b" data-edge="b" title="Drag to set the page height"></div><div class="pg-edge pg-rb" data-edge="rb" title="Drag to set the page size"></div>' : ''}
      </div></div></div>
      <div class="panel" id="panel-order">${orderGrid(layout.controls)}</div>
    </div>
    <aside class="inspector" id="inspector">
      <div class="insp-head"><h2 id="inspector-title">Page Properties</h2><button class="link" id="page-props-btn">Page</button></div>
      <p class="hint" id="inspector-body">Loading…</p></aside>
  </div>
<script nonce="${nonce}">
  const editable = ${editable} && typeof acquireVsCodeApi === 'function';
  const vscode = editable ? acquireVsCodeApi() : null;
  const pageProps = ${JSON.stringify(layout.properties)};
  const pageName = ${JSON.stringify(layout.name)};
  const kinds = ${JSON.stringify(editable ? paletteKinds() : {})};
  const tabs = { layout: document.getElementById('tab-layout'), order: document.getElementById('tab-order') };
  const panels = { layout: document.getElementById('panel-layout'), order: document.getElementById('panel-order') };
  function show(w) { for (const k of ['layout','order']) { const on = k===w; tabs[k].classList.toggle('selected',on); tabs[k].setAttribute('aria-selected',String(on)); panels[k].classList.toggle('selected',on); } }
  tabs.layout.onclick = () => show('layout'); tabs.order.onclick = () => show('order');

  const canvas = document.getElementById('canvas');
  const grid = document.querySelector('.order-grid tbody');
  const status = document.getElementById('status');
  const saveBtn = document.getElementById('save');
  function markDirty() { if (!editable) return; if (saveBtn) saveBtn.disabled = false; if (status) { status.textContent = 'Unsaved changes'; status.classList.remove('err'); } }
  const n = (el, a) => Number(el.dataset[a]);
  const setN = (el, a, v) => { el.dataset[a] = String(Math.round(v)); };

  let selected = null, selRow = null;
  const body = document.getElementById('inspector-body');
  const title = document.getElementById('inspector-title');
  const tn = (tag, s) => { const e = document.createElement(tag); e.textContent = s == null ? '' : String(s); return e; };
  function propsTable(rows) {
    const t = document.createElement('table'); t.className = 'props';
    for (const [k, v] of rows) { const tr = document.createElement('tr'); const tk = tn('td', k); tk.className = 'k'; tr.append(tk, tn('td', v == null || v === '' ? '—' : v)); t.appendChild(tr); }
    return t;
  }
  function showPage() {
    if (selected) { selected.classList.remove('selected-ctl'); selected = null; }
    if (selRow) { selRow.classList.remove('sel'); selRow = null; }
    title.textContent = 'Page Properties';
    const p = pageProps;
    body.replaceChildren(propsTable([
      ['Name', pageName], ...(editable ? [] : [['Description', p.description], ['Comments', p.comments]]), ['Owner ID', p.ownerId],
      ['Page type', p.pageType], ...(editable ? [] : [['Page size', p.sizeWidth + ' × ' + p.sizeHeight + (p.sizeCustom ? ' (Custom)' : '')]]),
      ['Style sheet', p.styleSheet], ['Fluid style sheet', p.fluidStyleSheet],
      ['Version', p.version], ['Last updated', p.lastUpdated + (p.lastUpdatedBy ? ' by ' + p.lastUpdatedBy : '')]
    ]));
    if (!editable) return;
    // General tab: Description and Comments are written on Save (PSPNLDEFN.DESCR / DESCRLONG).
    const t = document.createElement('template');
    t.innerHTML = '<div><label>Description</label><input type="text" maxlength="30" id="pp-descr"><label>Comments</label><textarea rows="5" id="pp-comments"></textarea>' +
      '<label>Page size (Custom when changed; or drag the page edge)</label><div class="row"><input type="number" min="1" id="pp-w" title="Width"> × <input type="number" min="1" id="pp-h" title="Height"></div></div>';
    const form = t.content.firstElementChild;
    form.querySelector('#pp-descr').value = p.description; form.querySelector('#pp-comments').value = p.comments;
    form.querySelector('#pp-w').value = p.sizeWidth; form.querySelector('#pp-h').value = p.sizeHeight;
    const sizeInput = () => { const w = Number(form.querySelector('#pp-w').value), h = Number(form.querySelector('#pp-h').value); if (w > 0 && h > 0) setPageSize(w, h); };
    form.querySelector('#pp-w').oninput = sizeInput; form.querySelector('#pp-h').oninput = sizeInput;
    form.querySelector('#pp-descr').oninput = (e) => { p.description = e.target.value; markDirty(); };
    form.querySelector('#pp-comments').oninput = (e) => { p.comments = e.target.value; markDirty(); };
    body.prepend(form);
  }
  document.getElementById('page-props-btn').onclick = showPage;
  // The page size: the canvas is drawn at it; dragging an edge or typing a size makes it Custom.
  function setPageSize(w, h) {
    pageProps.sizeWidth = Math.max(1, Math.round(w)); pageProps.sizeHeight = Math.max(1, Math.round(h)); pageProps.sizeChanged = true;
    canvas.style.width = pageProps.sizeWidth + 'px'; canvas.style.height = pageProps.sizeHeight + 'px';
    const fw = document.getElementById('pp-w'), fh = document.getElementById('pp-h');
    if (fw && document.activeElement !== fw) fw.value = pageProps.sizeWidth; if (fh && document.activeElement !== fh) fh.value = pageProps.sizeHeight;
    markDirty();
  }
  function controlById(id) { return document.getElementById('c' + id); }
  function selectRow(id) {
    if (selRow) selRow.classList.remove('sel');
    selRow = grid ? grid.querySelector('tr[data-id="' + id + '"]') : null;
    if (selRow) selRow.classList.add('sel');
  }
  function inspect(el) {
    if (!el) return;
    if (selected) selected.classList.remove('selected-ctl');
    selected = el; el.classList.add('selected-ctl');
    selectRow(el.dataset.id);
    title.textContent = 'Page Field Properties';
    const d = el.dataset;
    body.replaceChildren(propsTable([
      ['Page field name', d.pfn], ['Field ID', d.new ? 'new (assigned on save)' : d.id], ['Tab order', d.num], ['Type', d.type], ['Occurs level', d.level],
      ['Record', d.rec], ['Field', d.field], ...(d.target ? [['Target', d.target]] : []),
      ['Label type', ['None','Text','RFT Short','RFT Long'][n(el,'lt')] ?? d.lt], ['Label', d.lx],
      ['Display only', (n(el,'fu') & 1) ? 'Yes' : 'No'], ['Invisible', (n(el,'fu') & 2) ? 'Yes' : 'No'],
      ['Deferred', d.defer === '1' ? 'Yes' : 'No'], ...(Number(d.ctlfld) ? [['Control field', d.ctlfld]] : [])
    ]));
    if (!editable) return;
    const mk = (h) => { const t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild; };
    if (d.new && kinds[d.new].bound) {
      // A new record-bound control: the record field it is placed on (App Designer's drop target).
      const rf = mk('<div><label>Record</label><input type="text" class="rec"><label>Field</label><input type="text" class="fld"></div>');
      rf.querySelector('.rec').value = d.rec || ''; rf.querySelector('.fld').value = d.field || '';
      const upd = () => { el.dataset.rec = rf.querySelector('.rec').value.trim().toUpperCase(); el.dataset.field = rf.querySelector('.fld').value.trim().toUpperCase(); placeholderLabel(el); markDirty(); };
      rf.querySelector('.rec').oninput = upd; rf.querySelector('.fld').oninput = upd;
      body.append(rf);
    }
    const lx = mk('<div><label>Label text</label><input type="text"></div>'); lx.querySelector('input').value = d.lx || '';
    const lt = mk('<div><label>Label type</label><select><option value="0">None</option><option value="1">Text</option><option value="2">RFT Short</option><option value="3">RFT Long</option></select></div>'); lt.querySelector('select').value = d.lt;
    const doRow = mk('<div class="row"><input type="checkbox"><label>Display Only</label></div>'); doRow.querySelector('input').checked = (n(el,'fu') & 1) !== 0;
    const invRow = mk('<div class="row"><input type="checkbox"><label>Invisible</label></div>'); invRow.querySelector('input').checked = (n(el,'fu') & 2) !== 0;
    const delRow = mk('<div class="row"><button class="action">Delete control</button></div>');
    body.append(lx, lt, doRow, invRow, delRow);
    lx.querySelector('input').oninput = (e) => { el.dataset.lx = e.target.value; const l = document.getElementById('l'+d.id); if (l) { l.textContent = e.target.value; l.classList.remove('placeholder'); } if (d.new) placeholderLabel(el); if (selRow) selRow.children[3].textContent = e.target.value; markDirty(); };
    lt.querySelector('select').onchange = (e) => { el.dataset.lt = e.target.value; markDirty(); };
    const useChange = () => { let u = n(el,'fu') & ~3; if (doRow.querySelector('input').checked) u |= 1; const inv = invRow.querySelector('input').checked; if (inv) u |= 2; setN(el,'fu',u); setN(el,'si', inv ? 1 : 0); el.classList.toggle('u-display-only',(u&1)!==0); el.classList.toggle('u-invisible',(u&2)!==0); markDirty(); };
    doRow.querySelector('input').onchange = useChange; invRow.querySelector('input').onchange = useChange;
    delRow.querySelector('button').onclick = () => { el.classList.add('removed'); el.dataset.removed = '1'; const l = document.getElementById('l'+d.id); if (l) l.classList.add('removed'); if (selRow) selRow.classList.add('removed'); markDirty(); body.replaceChildren(tn('p','Control deleted.')); };
  }
  showPage();
  canvas.addEventListener('click', (e) => { const el = e.target.closest('.ctl'); if (el && e.target.className !== 'rsz') inspect(el); });
  if (grid) grid.addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) inspect(controlById(tr.dataset.id)); });
  canvas.addEventListener('keydown', (e) => { if ((e.key==='Delete'||e.key==='Backspace') && editable && e.target.classList.contains('ctl')) { e.preventDefault(); e.target.classList.add('removed'); e.target.dataset.removed='1'; const l=document.getElementById('l'+e.target.dataset.id); if(l) l.classList.add('removed'); markDirty(); } });

  if (editable) {
    let drag = null;
    canvas.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('pg-edge')) {
        const edge = e.target.dataset.edge;
        drag = { page: edge, x: e.clientX, y: e.clientY, w: canvas.offsetWidth - 2, h: canvas.offsetHeight - 2, handle: e.target };
        e.target.classList.add('dragging'); e.preventDefault(); return;
      }
      const el = e.target.closest('.ctl'); if (!el) return;
      inspect(el);
      drag = { el, resize: e.target.classList.contains('rsz'), x: e.clientX, y: e.clientY, l: n(el,'fl'), t: n(el,'ft'), w: el.offsetWidth, h: el.offsetHeight };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, el = drag.el;
      if (drag.page) {
        setPageSize(drag.page === 'b' ? drag.w : Math.max(40, drag.w + dx), drag.page === 'r' ? drag.h : Math.max(40, drag.h + dy));
        return;
      }
      if (drag.resize) {
        const w = Math.max(6, drag.w + dx), h = Math.max(6, drag.h + dy);
        el.style.width = w + 'px'; el.style.height = h + 'px';
        setN(el,'fr', n(el,'fl') + w); setN(el,'fb', n(el,'ft') + h); el.dataset.fst = '2';
      } else {
        const l = drag.l + dx, t = drag.t + dy;
        el.style.left = l + 'px'; el.style.top = t + 'px'; setN(el,'fl', l); setN(el,'ft', t);
        // RIGHT/BOTTOM are page coordinates too: a sized control keeps its size (0 = auto-sized, left alone).
        if (n(el,'fr')) setN(el,'fr', n(el,'fr')+dx); if (n(el,'fb')) setN(el,'fb', n(el,'fb')+dy);
        // A stored label rectangle moves with the control; an all-zero (relative) or negative (hidden) one is left as is.
        const lr = ['ell','elt','elr','elb'].map((a) => n(el,a));
        if (lr.some((v) => v !== 0) && lr.every((v) => v >= 0)) { setN(el,'ell', lr[0]+dx); setN(el,'elt', lr[1]+dy); setN(el,'elr', lr[2]+dx); setN(el,'elb', lr[3]+dy); }
        const lbl = document.getElementById('l'+el.dataset.id);
        if (lbl) { lbl.style.left = (parseFloat(lbl.style.left||getComputedStyle(lbl).left) + dx) + 'px'; lbl.style.top = (parseFloat(lbl.style.top||getComputedStyle(lbl).top) + dy) + 'px'; }
        drag.x = e.clientX; drag.y = e.clientY; drag.l = l; drag.t = t;
      }
    });
    window.addEventListener('mouseup', () => { if (drag) { if (drag.handle) drag.handle.classList.remove('dragging'); markDirty(); drag = null; } });

    let newSeq = 0;
    function placeholderLabel(el) {
      const l = document.getElementById('l' + el.dataset.id); if (!l || el.dataset.lx) return;
      l.textContent = el.dataset.rec && el.dataset.field ? el.dataset.rec + '.' + el.dataset.field : '(record field)';
      l.classList.add('placeholder');
    }
    function addControl(kind) {
      const k = kinds[kind]; const id = -(++newSeq);
      const scroller = document.getElementById('panel-layout');
      // Cascade from the visible top-left so successive inserts do not stack.
      const step = 20 * ((newSeq - 1) % 8);
      const l = Math.round(scroller.scrollLeft + 24 + step), t = Math.round(scroller.scrollTop + 24 + step);
      const el = document.createElement('div');
      el.className = 'ctl s-' + k.shape + ' new-ctl'; el.id = 'c' + id; el.tabIndex = 0; el.title = 'New ' + k.typeName;
      Object.assign(el.dataset, { id: String(id), new: kind, num: '', level: '0', type: k.typeName, target: '', rec: '', field: '', pfn: '', defer: '1', ctlfld: '0',
        fl: String(l), ft: String(t), fr: String(k.w ? l + k.w : 0), fb: String(k.h ? t + k.h : 0), ell: '0', elt: '0', elr: '0', elb: '0',
        fst: String(k.fst), lt: String(k.lt), lx: k.lx, fu: '0', si: '0' });
      el.style.left = l + 'px'; el.style.top = t + 'px'; el.style.width = k.dw + 'px'; el.style.height = k.dh + 'px'; el.style.zIndex = k.shape === 'container' ? '1' : '2';
      if (k.shape === 'checkbox') el.appendChild(Object.assign(document.createElement('span'), { className: 'box' }));
      else if (k.shape === 'dropdown') el.appendChild(Object.assign(document.createElement('span'), { className: 'caret', textContent: '▾' }));
      else if (k.shape === 'button') el.appendChild(document.createTextNode('Button'));
      el.appendChild(Object.assign(document.createElement('span'), { className: 'rsz' }));
      if (k.shape !== 'button' && k.lt !== 0) {
        // Drawn where App Designer draws a relative (all-zero EDITLBL) label.
        const lbl = Object.assign(document.createElement('div'), { className: 'lbl', id: 'l' + id, textContent: k.lx });
        const at = k.shape === 'container' ? [l + 5, t + 1] : k.shape === 'label' ? [l + 2, t + 3] : k.shape === 'checkbox' ? [l + k.dw + 4, t + 1] : [l, t - 15];
        lbl.style.left = at[0] + 'px'; lbl.style.top = at[1] + 'px';
        canvas.appendChild(lbl);
      }
      canvas.appendChild(el);
      placeholderLabel(el);
      show('layout'); inspect(el); el.focus(); markDirty();
    }
    for (const b of document.querySelectorAll('button.tool')) b.addEventListener('click', () => addControl(b.dataset.kind));

    saveBtn.addEventListener('click', () => {
      const live = [...canvas.querySelectorAll('.ctl')].filter((el) => !el.dataset.removed);
      const unbound = live.find((el) => el.dataset.new && kinds[el.dataset.new].bound && !(el.dataset.rec && el.dataset.field));
      if (unbound) { inspect(unbound); status.textContent = 'Give the new ' + unbound.dataset.type + ' a record and field.'; status.classList.add('err'); return; }
      const controls = live.map((el) => ({
        pnlFldId: n(el,'id'), fieldLeft: n(el,'fl'), fieldTop: n(el,'ft'), fieldRight: n(el,'fr'), fieldBottom: n(el,'fb'),
        editLblLeft: n(el,'ell'), editLblTop: n(el,'elt'), editLblRight: n(el,'elr'), editLblBottom: n(el,'elb'),
        fieldSizeType: n(el,'fst'), lblType: n(el,'lt'), lblText: el.dataset.lx || '', fieldUse: n(el,'fu'), secureInvisible: n(el,'si'),
        ...(el.dataset.new ? { add: { kind: el.dataset.new, recName: el.dataset.rec || '', fieldName: el.dataset.field || '' } } : {})
      }));
      saveBtn.disabled = true; status.textContent = 'Saving…'; status.classList.remove('err');
      vscode.postMessage({ type: 'save', controls, properties: { description: pageProps.description, comments: pageProps.comments,
        ...(pageProps.sizeChanged ? { sizeWidth: pageProps.sizeWidth, sizeHeight: pageProps.sizeHeight } : {}) } });
    });
    window.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m.type === 'saved') { saveBtn.disabled = true; status.textContent = 'Saved (v' + m.version + ')'; status.classList.remove('err'); }
      else if (m.type === 'error') { saveBtn.disabled = false; status.textContent = m.message; status.classList.add('err'); }
    });
  }
</script>
</body>
</html>`;
}
