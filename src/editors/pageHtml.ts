import { escapeHtml as esc } from './propertiesHtml.js';
import { controlShape, PAGE_SIZE_PRESETS, type PageControl, type PageLayout } from '../model/pageLayout.js';
import { PAGE_FIELD_TYPES, PAGE_TYPES } from '../model/uiDefinitions.js';
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
  /** The Page Properties lists (owner IDs, style sheets, popup menus); absent shows the stored values only. */
  choices?: PagePropertyChoices;
}

/** The Page Properties dialog's lists, from the database. */
export interface PagePropertyChoices {
  /** PSOPTIONS.LANGUAGE_CD (General: Language). */
  language: string;
  /** PSXLATITEM OBJECTOWNERID: [value, long name]. */
  owners: Array<[string, string]>;
  /** PSSTYLSHEETDEFN names. */
  styleSheets: string[];
  /** PSMENUDEFN popup menus (MENUTYPE 1). */
  popupMenus: string[];
  /** PSSTYLECLASS names (Page Background). */
  styleClasses: string[];
}

/**
 * The Insert menu, grouped as App Designer's Insert menu is. Entries without
 * a kind have no captured App Designer save yet (pageControlTemplates.ts):
 * shown, disabled.
 */
const INSERT_MENU: Array<{ group: string; items: Array<{ label: string; kind?: NewControlKind }> }> = [
  { group: 'Containers and text', items: [{ kind: 'frame', label: 'Frame' }, { kind: 'groupBox', label: 'Group Box' },
    { kind: 'horizontalRule', label: 'Horizontal Rule' }, { kind: 'staticText', label: 'Static Text' }, { label: 'Static Image' }, { label: 'Tab Separator' }] },
  { group: 'Controls', items: [{ kind: 'checkBox', label: 'Check Box' }, { kind: 'dropDown', label: 'Drop-Down List Box' }, { kind: 'editBox', label: 'Edit Box' },
    { label: 'HTML Area' }, { label: 'Image' }, { label: 'Long Edit Box' }, { kind: 'pushButton', label: 'Push Button/Hyperlink' }, { label: 'Radio Button' }, { label: 'Tree' }] },
  { group: 'Grids and scrolls', items: [{ label: 'Grid' }, { label: 'Scroll Area' }, { label: 'Scroll Bar' }] },
  { group: 'Pages', items: [{ label: 'Secondary Page' }, { label: 'Subpage' }] },
  { group: 'Charts', items: [{ label: 'Chart' }, { label: 'Analytic Grid' }] }
];
const PALETTE = INSERT_MENU.flatMap((g) => g.items).filter((i): i is { label: string; kind: NewControlKind } => !!i.kind);

function insertMenuHtml(): string {
  return `<div class="menu" id="insert-menu" role="menu" hidden>${INSERT_MENU.map((g) =>
    `<div class="menu-group">${esc(g.group)}</div>` + g.items.map((i) => i.kind
      ? `<button class="menu-item tool" role="menuitem" data-kind="${i.kind}">${esc(i.label)}</button>`
      : `<button class="menu-item" role="menuitem" disabled title="Not yet: needs a captured App Designer save">${esc(i.label)}</button>`).join('')).join('')}</div>`;
}

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
    ` data-lx="${esc(k.lblText)}" data-fu="${k.fieldUse}" data-si="${k.secureInvisible}"` +
    ` data-ftype="${c.type}" data-fs="${esc(k.fieldStyle)}" data-adj="${k.adjustHidden}" data-anc="${k.anchor}"` +
    ` data-fut="${k.fieldUseTmp}" data-fut2="${k.fieldUseTemp2}" data-fsl="${esc(k.ffStyleLong)}"` +
    ` data-dspl="${k.dsplFormat}" data-cont="${esc(k.contName)}" data-gms="${k.grdLblMsgSet}" data-gmn="${k.grdLblMsgNum}"` +
    ` data-onv="${esc(k.onValue)}" data-offv="${esc(k.offValue)}" data-lloc="${k.lblLoc}"` +
    ` data-oc1="${k.occursCount1}" data-gch="${k.gridShowColHdg}" data-grh="${k.gridShowRowHdg}" data-gcs="${k.gridAllowColSort}"`;
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
function orderGrid(controls: readonly PageControl[], editable = false): string {
  const head = ['Tab Order', 'Field ID', 'Lvl', 'Label', 'Type', 'Field', 'Record', 'Page Field Name', 'Deferred', 'Control Field'];
  const rows = [...controls].sort((a, b) => a.num - b.num).map((c) =>
    `<tr data-id="${c.pnlFldId}" tabindex="0"${editable ? ' draggable="true"' : ''}>` +
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
  .ptabs { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border, #8884); margin-bottom: 0.4rem; }
  .ptab { background: transparent; color: var(--vscode-foreground); border: none; border-bottom: 2px solid transparent; padding: 0.2rem 0.7rem; opacity: 0.75; cursor: pointer; font: inherit; }
  .ptab.selected { opacity: 1; border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder)); }
  .inspector fieldset { min-width: 0; border: 1px solid var(--vscode-panel-border, #8884); border-radius: 3px; margin: 0.5rem 0; padding: 0.2rem 0.5rem 0.4rem; }
  .inspector legend { color: var(--vscode-descriptionForeground); padding: 0 0.3rem; }
  .inspector .pending, .inspector .na { opacity: 0.6; }
  .inspector .row label { margin: 0; color: inherit; }
  .inspector .row input[type=number] { width: 5em; min-width: 0; }
  .inspector select { max-width: 100%; }
  .pg-edge { position: absolute; z-index: 4; }
  .pg-r { top: 0; right: -4px; width: 7px; height: 100%; cursor: ew-resize; }
  .pg-b { left: 0; bottom: -4px; height: 7px; width: 100%; cursor: ns-resize; }
  .pg-rb { right: -6px; bottom: -6px; width: 11px; height: 11px; cursor: nwse-resize; background: #c02; border: 1px solid #fff; }
  .pg-edge:hover, .pg-edge.dragging { background: var(--vscode-focusBorder, #07f); opacity: 0.6; }
  .tgroup { display: flex; gap: 0.25rem; align-items: center; padding-right: 0.5rem; border-right: 1px solid var(--vscode-panel-border, #8884); position: relative; }
  button.tb { font: inherit; font-size: 0.9em; padding: 0.1rem 0.5rem; border: 1px solid var(--vscode-button-border, #8886); background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, inherit); border-radius: 3px; cursor: pointer; }
  button.tb:disabled { opacity: 0.45; cursor: default; }
  button.tb.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; min-width: 200px; max-height: 70vh; overflow: auto; padding: 4px 0;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, inherit);
    border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border, #8886)); border-radius: 4px; box-shadow: 0 2px 8px #0005; }
  .menu-group { padding: 4px 12px 2px; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
  .menu-group:not(:first-child) { border-top: 1px solid var(--vscode-menu-separatorBackground, #8884); margin-top: 4px; padding-top: 6px; }
  button.menu-item { display: block; width: 100%; text-align: left; font: inherit; padding: 2px 12px 2px 20px; border: none; background: none; color: inherit; cursor: pointer; }
  button.menu-item:hover:not(:disabled), button.menu-item:focus-visible { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, inherit); outline: none; }
  button.menu-item:disabled { opacity: 0.45; cursor: default; }
  .band { position: absolute; z-index: 10; border: 1px dashed var(--vscode-focusBorder, #07f); background: color-mix(in srgb, var(--vscode-focusBorder, #07f) 12%, transparent); pointer-events: none; }
  .group-mode, .group-mode .ctl { cursor: crosshair; } .group-mode .ctl.selected-ctl { cursor: move; }
  .multi .rsz { display: none !important; }
  .order-tools { display: flex; gap: 0.4rem; align-items: center; padding: 6px 8px; position: sticky; top: 0; z-index: 2; background: var(--vscode-editor-background); }
  .order-grid tr.dragging { opacity: 0.4; }
  .order-grid tr.drop-before td { border-top: 2px solid var(--vscode-focusBorder, #07f); }
  .order-grid tr.drop-after td { border-bottom: 2px solid var(--vscode-focusBorder, #07f); }
  .new-ctl { box-shadow: 0 0 0 1px #2a7 inset; }
  .lbl.placeholder { color: #888; font-style: italic; }
${geometryCss(layout.controls)}
</style>
</head>
<body class="${editable ? 'editable' : ''}">
  <header>
    <div><h1>${esc(layout.name)}</h1><p class="sub">${esc(subtitle)}</p></div>
    ${editable ? `<div class="toolbar">` +
      `<span class="tgroup"><button class="tb on" id="sel-field" aria-pressed="true" title="Select Field: click a control; Shift / Ctrl+click adds; drag on empty page to select a group">Select Field</button>` +
      `<button class="tb" id="sel-group" aria-pressed="false" title="Select Group: drag a rectangle around controls">Select Group</button>` +
      `<button class="tb" id="sel-all" title="Select All (Ctrl+A)">Select All</button></span>` +
      `<span class="tgroup"><button class="tb" id="insert-btn" aria-haspopup="menu" aria-expanded="false">Insert ▾</button>${insertMenuHtml()}</span>` +
      `<span class="tgroup"><button class="tb" id="copy-btn" title="Copy the selected controls (Ctrl+C)">Copy</button>` +
      `<button class="tb" id="paste-btn" disabled title="Paste a copy of the copied controls (Ctrl+V); from any page of this connection">Paste</button></span>` +
      `<span class="status" id="status">${esc(options.status ?? 'No changes')}</span><button class="action" id="save" disabled>Save</button>` +
      `<button class="action" id="view-pc" title="App Designer's View > View Page PeopleCode">View PeopleCode</button></div>`
      : `<div class="toolbar"><button class="tb" id="copy-btn" title="Copy the selected control, to paste on a page you can edit (Ctrl+C)">Copy</button>` +
        `<button class="action" id="view-pc" title="App Designer's View > View Page PeopleCode">View PeopleCode</button></div>`}
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
      <div class="panel" id="panel-order">${editable ? '<div class="order-tools"><button class="tb" id="ord-up">Move Up</button><button class="tb" id="ord-down">Move Down</button>' +
        '<span class="hint">or drag a row. A control stays on its side of a grid or scroll area (its level).</span></div>' : ''}${orderGrid(layout.controls, editable)}</div>
    </div>
    <aside class="inspector" id="inspector">
      <div class="insp-head"><h2 id="inspector-title">Page Properties</h2><button class="link" id="page-props-btn">Page</button></div>
      <p class="hint" id="inspector-body">Loading…</p></aside>
  </div>
<script nonce="${nonce}">
  const editable = ${editable} && typeof acquireVsCodeApi === 'function';
  // The VS Code API: Save on an editable page, View PeopleCode on any.
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  document.getElementById('view-pc').onclick = () => { if (vscode) vscode.postMessage({ type: 'viewPeopleCode' }); };
  const pageProps = ${JSON.stringify(layout.properties)};
  const pageName = ${JSON.stringify(layout.name)};
  const kinds = ${JSON.stringify(editable ? paletteKinds() : {})};
  const choices = ${JSON.stringify(options.choices ?? null)};
  const pageTypes = ${JSON.stringify(PAGE_TYPES)};
  // App Designer's Page Size list (pageLayout.ts PAGE_SIZE_PRESETS) and the PNLUSE bits that hold the choice.
  const sizePresets = ${JSON.stringify(PAGE_SIZE_PRESETS)};
  const SIZE_BITS = 0xefc;
  const sizeChoiceOf = (use) => { const b = use & SIZE_BITS; if (b === 0x08) return 'custom'; if (b === 0x10) return 'auto'; const x = sizePresets.find((q) => q.bit === b); return x ? x.key : 'other'; };
  const drawSize = (w, h) => { const x = !w || !h ? [632, 326] : [w, h]; canvas.style.width = x[0] + 'px'; canvas.style.height = x[1] + 'px'; };
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
  // The scroll-nesting level at a page point: the deepest Scroll Bar(10)/Grid(19)/Scroll Area(27) whose drawn box
  // contains it gives its level; a control dropped there takes that level (App Designer's scroll buffer).
  function scrollLevelAt(cx, cy) {
    let level = 0, area = Infinity;
    for (const el of canvas.querySelectorAll('.ctl')) {
      if (el.dataset.removed) continue;
      const ft = Number(el.dataset.ftype);
      if (ft !== 10 && ft !== 19 && ft !== 27) continue;
      const L = el.offsetLeft, T = el.offsetTop, R = L + el.offsetWidth, B = T + el.offsetHeight;
      if (cx >= L && cx <= R && cy >= T && cy <= B) { const a = (R - L) * (B - T); if (a < area) { area = a; level = Number(el.dataset.level) || 0; } }
    }
    return level;
  }

  // The selection: one control (inspected) or a group (Select Group / Select All / Shift+click).
  let selected = null, selRow = null;
  const sel = new Set();
  const live = () => [...canvas.querySelectorAll('.ctl')].filter((el) => !el.dataset.removed);
  function clearSel() {
    for (const s of sel) s.classList.remove('selected-ctl');
    sel.clear(); selected = null; document.body.classList.remove('multi');
    if (selRow) { selRow.classList.remove('sel'); selRow = null; }
  }
  const body = document.getElementById('inspector-body');
  const title = document.getElementById('inspector-title');
  const tn = (tag, s) => { const e = document.createElement(tag); e.textContent = s == null ? '' : String(s); return e; };
  function propsTable(rows) {
    const t = document.createElement('table'); t.className = 'props';
    for (const [k, v] of rows) { const tr = document.createElement('tr'); const tk = tn('td', k); tk.className = 'k'; tr.append(tk, tn('td', v == null || v === '' ? '—' : v)); t.appendChild(tr); }
    return t;
  }
  // Page Properties: App Designer's General / Use / Fluid tabs. A setting is editable once an App Designer
  // save of it is captured (docs/PAGE_SAVE.md); the rest show what is stored, greyed.
  const PROVEN = new Set(['description', 'comments', 'size', 'ownerId', 'styleSheet', 'background', 'deferProc', 'adjustLayout', 'popupMenu',
    'pageType', 'secondary', 'modal', 'fluidPage', 'fluidClasses', 'suppressClasses']);
  // As opened: a page type change back restores what is drawn.
  const storedPage = { type: pageProps.pnlType, w: pageProps.sizeWidth, h: pageProps.sizeHeight, use: pageProps.pnlUse };
  const PENDING = 'Not editable yet: needs a captured App Designer save of this setting';
  let propTab = 'general';
  function showPage() {
    clearSel();
    title.textContent = 'Page Properties';
    const p = pageProps;
    const can = (k) => editable && PROVEN.has(k);
    const mk = (h) => { const t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild; };
    const wrap = mk('<div class="pp"><div class="ptabs" role="tablist"></div><div class="ppanel" data-tab="general"></div><div class="ppanel" data-tab="use"></div><div class="ppanel" data-tab="fluid"></div></div>');
    const pick = (k) => { propTab = k; for (const x of wrap.querySelectorAll('.ptab')) { x.classList.toggle('selected', x.dataset.tab === k); x.setAttribute('aria-selected', String(x.dataset.tab === k)); } for (const x of wrap.querySelectorAll('.ppanel')) x.hidden = x.dataset.tab !== k; };
    for (const [k, label] of [['general', 'General'], ['use', 'Use'], ['fluid', 'Fluid']]) {
      const b = tn('button', label); b.className = 'ptab'; b.setAttribute('role', 'tab'); b.dataset.tab = k; b.onclick = () => pick(k);
      wrap.firstElementChild.appendChild(b);
    }
    const panel = (k) => wrap.querySelector('.ppanel[data-tab="' + k + '"]');
    const lock = (row, control, key) => { if (!can(key)) { control.disabled = true; row.title = editable ? PENDING : ''; if (editable && !PROVEN.has(key)) row.classList.add('pending'); } };
    const field = (parent, label, control, key) => { const row = mk('<div class="pf"><label></label></div>'); if (label) row.firstChild.textContent = label; else row.firstChild.remove(); row.appendChild(control); lock(row, control, key); parent.appendChild(row); return control; };
    const text = (v, max) => { const i = document.createElement('input'); i.type = 'text'; i.value = v || ''; if (max) i.maxLength = max; return i; };
    const area = (v, rows) => { const a = document.createElement('textarea'); a.rows = rows; a.value = v || ''; return a; };
    const select = (opts, v) => {
      const sl = document.createElement('select');
      for (const [val, label] of opts) { const o = document.createElement('option'); o.value = val; o.textContent = label; sl.appendChild(o); }
      if (![...sl.options].some((o) => o.value === v)) { const o = document.createElement('option'); o.value = v; o.textContent = v; sl.appendChild(o); }
      sl.value = v; return sl;
    };
    const check = (parent, label, on, key) => { const row = mk('<div class="row"><input type="checkbox"><label></label></div>'); const c = row.firstChild; c.checked = !!on; row.lastChild.textContent = label; lock(row, c, key); parent.appendChild(row); return c; };
    const group = (parent, legend) => { const f = mk('<fieldset><legend></legend></fieldset>'); f.firstChild.textContent = legend; parent.appendChild(f); return f; };
    const DEFAULT_STYLE = '*** Use Default Style ***';

    // General
    const g = panel('general');
    g.appendChild(propsTable([['Name', pageName], ['Language', choices ? choices.language : '']]));
    const descr = field(g, 'Description', text(p.description, 30), 'description');
    const comments = field(g, 'Comments', area(p.comments, 5), 'comments');
    const owners = [['', ''], ...(choices ? choices.owners : [])].map(([v, nm]) => [v, nm ? nm + ' (' + v + ')' : v]);
    const owner = field(g, 'Owner Id', select(owners, p.ownerId), 'ownerId');
    owner.onchange = () => { p.ownerId = owner.value; markDirty(); };
    const lu = group(g, 'Last Updated');
    lu.appendChild(propsTable([['Date/Time', p.lastUpdated], ['By User', p.lastUpdatedBy], ['Version', p.version]]));
    descr.oninput = () => { p.description = descr.value; markDirty(); };
    comments.oninput = () => { p.comments = comments.value; markDirty(); };

    // Use
    const u = panel('use');
    const typeBox = group(u, 'Page Type');
    const typeSel = field(typeBox, '', select(Object.entries(pageTypes), String(p.pnlType)), 'pageType');
    // What each type offers, as App Designer's Use tab does: Subpage and Popup Page are Auto-size; Header page
    // to Side Page 2 are Fluid at 800x600 page inside portal; only a secondary page has buttons, Close Box and
    // Disable Modal; a popup page always defers processing and takes no style sheet.
    const t = p.pnlType, secondary = t === 2, auto = t === 1 || t === 3, fluidType = t >= 4;
    const na = (control, why) => { control.disabled = true; control.closest('.row, .pf').classList.add('na'); control.closest('.row, .pf').title = why; };
    const typeName = pageTypes[t] || 'page of this type';
    typeSel.onchange = () => {
      const next = Number(typeSel.value);
      p.pnlType = next; markDirty();
      // As pageWriter.ts writes it (t01-t11, r01-r06, u08, u12): the new type sets the size choice; Fluid is never turned off.
      const portal = () => { p.sizeChanged = false; p.sizeWidth = 570; p.sizeHeight = 330; canvas.style.width = '570px'; canvas.style.height = '330px'; };
      if (next === storedPage.type) {
        p.pnlUse = storedPage.use; p.sizeChanged = false; p.sizeWidth = storedPage.w; p.sizeHeight = storedPage.h;
        canvas.style.width = storedPage.w + 'px'; canvas.style.height = storedPage.h + 'px';
      } else if (next === 0) { p.pnlUse = (p.pnlUse & ~(0xff | SIZE_BITS)) | 0x23; portal(); }
      else if (next === 2) { p.pnlUse = (p.pnlUse & ~(0xff | SIZE_BITS)) | 0x10; p.okCancel = true; p.closeBox = true; }
      else if (next === 1 || next === 3) { p.pnlUse = (p.pnlUse & ~(0xff | SIZE_BITS)) | 0x13; p.sizeChanged = false; if (next === 3) p.deferProc = true; }
      else { p.pnlUse = ((p.pnlUse | 0x4000) & ~(0xff | SIZE_BITS)) | 0x23; p.fluidPage = true; portal(); }
      delete p.pageSize;
      p.sizeCustom = sizeChoiceOf(p.pnlUse) === 'custom';
      showPage();
    };
    // A secondary page's OK & Cancel buttons and Close Box (PNLUSE 0x01 / 0x02 clear).
    const okc = check(typeBox, 'OK & Cancel buttons', secondary && p.okCancel, 'secondary');
    const cbx = check(typeBox, 'Close Box', secondary && p.closeBox, 'secondary');
    for (const c of [okc, cbx]) if (!secondary) na(c, "A secondary page's");
    okc.onchange = () => { p.okCancel = okc.checked; markDirty(); };
    cbx.onchange = () => { p.closeBox = cbx.checked; markDirty(); };
    if (p.pnlType !== storedPage.type && (t === 0 || fluidType)) {
      const h = tn('p', 'App Designer sets the page to 800x600 page inside portal (570 × 330).'); h.className = 'hint'; typeBox.appendChild(h);
    }
    const sizeBox = group(typeBox, 'Page Size');
    // The Page Size choice: App Designer's list on a standard page (s01-s08); a page type's own size otherwise.
    const choice = sizeChoiceOf(p.pnlUse);
    const nameOf = (k) => k === 'custom' ? 'Custom size' : k === 'auto' ? 'Auto-size'
      : (sizePresets.find((x) => x.key === k) || { label: 'Preset size (PNLUSE 0x' + (p.pnlUse & SIZE_BITS).toString(16) + ')' }).label;
    const sizeSel = t === 0
      ? field(sizeBox, '', select([...sizePresets.map((x) => [x.key, x.label]), ['custom', 'Custom size']], choice), 'size')
      : field(sizeBox, '', select([[choice, nameOf(choice)]], choice), 'sizeChoice');
    if (auto || fluidType) sizeSel.title = 'Set by the page type';
    sizeSel.onchange = () => {
      const k = sizeSel.value, x = sizePresets.find((q) => q.key === k);
      p.pageSize = k; p.sizeChanged = false; markDirty();
      if (k === 'custom') {
        p.pnlUse = (p.pnlUse & ~SIZE_BITS) | 0x08 | 0x03;
        // From 640x480 (stored 0 x 0), Custom starts at the size App Designer shows for it.
        if (!p.sizeWidth || !p.sizeHeight) { p.sizeWidth = 632; p.sizeHeight = 326; }
      } else {
        p.pnlUse = (p.pnlUse & ~SIZE_BITS) | x.bit | 0x03;
        // The Var choices keep the page's height, less 8 (s06, s07), from the size the page was opened at.
        p.sizeWidth = x.width; p.sizeHeight = x.height === 'var' ? (storedPage.h || 326) - 8 : x.height;
      }
      p.sizeCustom = k === 'custom';
      drawSize(p.sizeWidth, p.sizeHeight);
      showPage();
    };
    const wh = mk('<div class="row"><label>Width</label><input type="number" min="1" id="pp-w"><label>Height</label><input type="number" min="1" id="pp-h"></div>');
    sizeBox.appendChild(wh);
    const fw = wh.querySelector('#pp-w'), fh = wh.querySelector('#pp-h');
    // 640x480 stores 0 x 0 and shows 632 x 326.
    fw.value = auto ? '' : p.sizeWidth || (t === 0 && choice === '640x480' ? 632 : 0); fh.value = auto ? '' : p.sizeHeight || (t === 0 && choice === '640x480' ? 326 : 0);
    if (!can('size') || auto || fluidType) { fw.disabled = fh.disabled = true; if (auto || fluidType) wh.title = 'Set by the page type'; }
    else {
      const sizeInput = () => { const w = Number(fw.value), h = Number(fh.value); if (w > 0 && h > 0) setPageSize(w, h); };
      // Leaving a size box shows the size the page took (never smaller than what is on it).
      const sizeShown = () => { fw.value = p.sizeWidth; fh.value = p.sizeHeight; };
      fw.oninput = fh.oninput = sizeInput; fw.onchange = fh.onchange = sizeShown;
      const hint = tn('p', 'Typing a size, or dragging the page edge, makes it Custom.'); hint.className = 'hint'; sizeBox.appendChild(hint);
    }
    const styleBox = group(u, 'Style');
    const sheet = field(styleBox, 'Page Style Sheet', select([['', DEFAULT_STYLE], ...(choices ? choices.styleSheets : []).map((n) => [n, n])], p.styleSheet), 'styleSheet');
    sheet.onchange = () => { p.styleSheet = sheet.value; markDirty(); };
    if (t === 3) na(sheet, 'Not used on a ' + typeName);
    const bg = field(styleBox, 'Page Background', select([['', DEFAULT_STYLE], ...(choices ? choices.styleClasses || [] : []).map((n) => [n, n])], p.background), 'background');
    bg.onchange = () => { p.background = bg.value; markDirty(); };
    if (auto) na(bg, 'Not used on a ' + typeName);
    if (p.fluidStyleSheet) styleBox.appendChild(propsTable([['Fluid style sheet', p.fluidStyleSheet]]));
    const opts = group(u, 'Options');
    const defer = check(opts, 'Allow Deferred Processing', p.deferProc, 'deferProc');
    defer.onchange = () => { p.deferProc = defer.checked; markDirty(); };
    if (t === 3) na(defer, 'A popup page always defers processing');
    const fluidBox = check(opts, 'Fluid Page', p.fluidPage, 'fluidPage');
    fluidBox.onchange = () => { p.fluidPage = fluidBox.checked; markDirty(); };
    const adjust = check(opts, 'Adjust Layout for Hidden Fields', p.adjustLayout, 'adjustLayout');
    adjust.onchange = () => { p.adjustLayout = adjust.checked; markDirty(); };
    const modal = check(opts, 'Disable Display in Modal Window When Not Launched by DoModal PeopleCode', p.disableModal, 'modal');
    if (!secondary) na(modal, "A secondary page's");
    modal.onchange = () => { p.disableModal = modal.checked; markDirty(); };
    const popup = field(opts, 'Popup Menu', select([['', ''], ...(choices ? choices.popupMenus : []).map((n) => [n, n])], p.popupMenu), 'popupMenu');
    popup.onchange = () => { p.popupMenu = popup.value; markDirty(); };
    if (t !== 0 && t !== 2) na(popup, 'Not used on a ' + typeName);

    // Fluid
    const f = panel('fluid');
    const app = group(f, 'Application-Specific Styles');
    const classes = field(app, 'Style Classes', area(p.fluid.styleClasses, 3), 'fluidClasses');
    classes.maxLength = 100;
    // One line in PSPNLDEFN: a line break is a space.
    classes.oninput = () => { p.fluid.styleClasses = classes.value.replace(/[\\r\\n]+/g, ' '); markDirty(); };
    const ff = group(app, 'Form Factor Style Class Override');
    for (const [label, k] of [['Small', 'small'], ['Medium', 'medium'], ['Large', 'large'], ['Extra Large', 'extraLarge']]) {
      const i = field(ff, label, text(p.fluid[k], 100), 'fluidClasses');
      i.oninput = () => { p.fluid[k] = i.value; markDirty(); };
    }
    const suppress = check(f, 'Suppress System-Specific Style Classes', p.suppressClasses, 'suppressClasses');
    suppress.onchange = () => { p.suppressClasses = suppress.checked; markDirty(); };

    if (editable) { const note = tn('p', 'Greyed settings show what is stored. Each becomes editable once an App Designer save of it is captured.'); note.className = 'hint'; wrap.appendChild(note); }
    body.replaceChildren(wrap);
    pick(propTab);
  }
  document.getElementById('page-props-btn').onclick = showPage;
  // The right and bottom of what is drawn on the page (controls and their labels): the smallest the page can be.
  // Measured while the Layout tab is shown; the last measure stands while it is hidden.
  let lastExtent = { l: 0, t: 0, r: 1, b: 1 };
  function contentExtent() {
    if (!panels.layout.classList.contains('selected')) return lastExtent;
    let l = Infinity, t = Infinity, r = 1, b = 1;
    for (const el of canvas.querySelectorAll('.ctl, .lbl')) {
      if (el.classList.contains('removed') || el.offsetParent === null) continue;
      l = Math.min(l, el.offsetLeft); t = Math.min(t, el.offsetTop);
      r = Math.max(r, el.offsetLeft + el.offsetWidth); b = Math.max(b, el.offsetTop + el.offsetHeight);
    }
    return (lastExtent = { l: Number.isFinite(l) ? l : 0, t: Number.isFinite(t) ? t : 0, r, b });
  }
  // The page size: the canvas is drawn at it; dragging an edge or typing a size makes it Custom.
  function setPageSize(w, h) {
    const ext = contentExtent();
    pageProps.sizeWidth = Math.max(ext.r, Math.round(w)); pageProps.sizeHeight = Math.max(ext.b, Math.round(h)); pageProps.sizeChanged = true;
    // A typed or dragged size is Custom (14-props-use).
    delete pageProps.pageSize; pageProps.sizeCustom = true;
    pageProps.pnlUse = (pageProps.pnlUse & ~SIZE_BITS) | 0x08 | (pageProps.pnlType === 2 ? pageProps.pnlUse & 0x03 : 0x03);
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
    clearSel();
    sel.add(el); selected = el; el.classList.add('selected-ctl');
    selectRow(el.dataset.id);
    return dispatch(el);
  }
  // selRow's Label / Page-Field-Name columns and the canvas label kept in step with the inspector's inputs.
  function syncLabel(el) {
    const d = el.dataset; const l = document.getElementById('l' + d.id);
    if (l) { l.textContent = d.lx || ''; l.classList.toggle('placeholder', !d.lx); }
    if (d.new) placeholderLabel(el);
    if (selRow) selRow.children[3].textContent = d.lx || '';
  }
  const STYLE_DEFAULT = '*** Use Default Style ***';
  // The shared form helpers every control panel is built from (the set the Frame panel pioneered).
  function ctxFor(el) {
    const d = el.dataset;
    const mk = (h) => { const t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild; };
    const field = (parent, label, control) => { const row = mk('<div class="pf"><label></label></div>'); if (label) row.firstChild.textContent = label; else row.firstChild.remove(); row.appendChild(control); parent.appendChild(row); if (!editable) control.disabled = true; return control; };
    const check = (parent, label, on) => { const row = mk('<div class="row"><input type="checkbox"><label></label></div>'); const c = row.firstChild; c.checked = !!on; row.lastChild.textContent = label; parent.appendChild(row); if (!editable) c.disabled = true; return c; };
    const group = (parent, legend) => { const f = mk('<fieldset><legend></legend></fieldset>'); f.firstChild.textContent = legend; parent.appendChild(f); return f; };
    const text = (v, max) => { const i = document.createElement('input'); i.type = 'text'; i.value = v || ''; if (max) i.maxLength = max; return i; };
    const select = (opts, v) => { const sl = document.createElement('select'); for (const o of opts) { const e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; sl.appendChild(e); } if (![...sl.options].some((o) => o.value === v)) { const e = document.createElement('option'); e.value = v; e.textContent = v; sl.appendChild(e); } sl.value = v; return sl; };
    const radio = (parent, name, options, current, set) => { const row = mk('<div class="row"></div>'); for (const o of options) { const r = Object.assign(document.createElement('input'), { type: 'radio', name, value: o[0], checked: o[0] === current }); r.onchange = () => set(o[0]); if (!editable) r.disabled = true; row.append(r, tn('label', o[1])); } parent.appendChild(row); };
    const styleClasses = (choices ? choices.styleClasses || [] : []).map((x) => [x, x]);
    const styleSelect = (parent, label) => { const s = field(parent, label || 'Style', select([['', STYLE_DEFAULT], ...styleClasses], (d.fs || '').trim())); s.onchange = () => { d.fs = s.value.trim().toUpperCase(); markDirty(); }; return s; };
    const useBit = (b, on) => { setN(el, 'fu', on ? n(el, 'fu') | b : n(el, 'fu') & ~b); markDirty(); };
    const tmpBit = (b, on) => { setN(el, 'fut', on ? n(el, 'fut') | b : n(el, 'fut') & ~b); markDirty(); };
    const t2Bit = (b, on) => { setN(el, 'fut2', on ? n(el, 'fut2') | b : n(el, 'fut2') & ~b); markDirty(); };
    return { el, d, mk, field, check, group, text, select, radio, styleSelect, styleClasses, useBit, tmpBit, t2Bit };
  }
  // Record tab: the record field the control is bound to, plus Style. Rebinding a stored control writes
  // RECNAME / FIELDNAME (the save refuses a field that is not on the record).
  function recordTab(ctx, p, extra) {
    const { el, d, field, text } = ctx;
    const rec = field(p, 'Record Name', text(d.rec || ''));
    const fld = field(p, 'Field Name', text(d.field || ''));
    const upd = () => { d.rec = rec.value.trim().toUpperCase(); d.field = fld.value.trim().toUpperCase(); placeholderLabel(el); markDirty(); };
    rec.oninput = upd; fld.oninput = upd;
    if (extra) extra(ctx, p);
    ctx.styleSelect(p);
  }
  // Label tab: the label's Type and Text (or a Message Catalog set/number), Style, optional Alignment/Paragraph,
  // and Adjust Layout for Hidden Fields. opts tunes it per type (Static Text alignment, Static Image alt-tag).
  function labelTab(ctx, p, opts) {
    opts = opts || {};
    const { el, d, field, group, text, select } = ctx;
    const types = opts.imageAlt
      ? [['6', 'None'], ['1', 'Text'], ['7', 'Message Catalog']]
      : [['0', 'None'], ['1', 'Text'], ['2', 'RFT Short'], ['3', 'RFT Long'], ['7', 'Message Catalog']];
    const lt = field(p, opts.typeLabel || 'Type', select(types, d.lt));
    const txt = field(p, opts.textLabel || 'Text', text(d.lx));
    txt.oninput = () => { d.lx = txt.value; syncLabel(el); markDirty(); };
    const ms = field(p, 'Message Set', text(d.gms && d.gms !== '0' ? d.gms : '')); ms.type = 'number';
    const mn = field(p, 'Message Number', text(d.gmn && d.gmn !== '0' ? d.gmn : '')); mn.type = 'number';
    ms.oninput = () => { d.gms = String(Number(ms.value) || 0); markDirty(); };
    mn.oninput = () => { d.gmn = String(Number(mn.value) || 0); markDirty(); };
    const disp = group(p, 'Display Options');
    ctx.styleSelect(disp);
    if (opts.alignment) { const al = field(disp, 'Alignment', select([['0', 'Left'], ['2', 'Centered'], ['4', 'Right']], String(n(el, 'dspl') & 0x6))); al.onchange = () => { setN(el, 'dspl', (n(el, 'dspl') & ~0x6) | Number(al.value)); markDirty(); }; }
    if (opts.paragraph) { const para = ctx.check(disp, 'Paragraph', (n(el, 'fut2') & 0x800) !== 0); para.onchange = () => ctx.t2Bit(0x800, para.checked); }
    const adj = ctx.check(disp, 'Adjust Layout for Hidden Fields', n(el, 'adj') !== 0); adj.onchange = () => { setN(el, 'adj', adj.checked ? 1 : 0); markDirty(); };
    const refresh = () => { const msgCat = lt.value === '7'; const txtOn = lt.value !== '0' && lt.value !== '6'; ms.closest('.pf').hidden = !msgCat; mn.closest('.pf').hidden = !msgCat; txt.closest('.pf').hidden = !txtOn; };
    lt.onchange = () => { d.lt = lt.value; refresh(); markDirty(); };
    refresh();
  }
  // Use tab: Allow Deferred Processing (DEFERPROC) then the FIELDUSE / FIELDUSETMP bit toggles for this type.
  // Each bit entry is [label, register, bit, invert].
  function useTab(ctx, p, bits) {
    const { el } = ctx;
    const dp = ctx.check(p, 'Allow Deferred Processing', el.dataset.defer !== '0');
    dp.onchange = () => { el.dataset.defer = dp.checked ? '1' : '0'; if (selRow) selRow.children[8].textContent = dp.checked ? '✓' : ''; markDirty(); };
    for (const spec of bits) {
      const label = spec[0], src = spec[1], bit = spec[2], invert = spec[3];
      const cur = src === 'fut' ? n(el, 'fut') : src === 'fut2' ? n(el, 'fut2') : n(el, 'fu');
      const c = ctx.check(p, label, invert ? (cur & bit) === 0 : (cur & bit) !== 0);
      c.onchange = () => {
        const on = invert ? !c.checked : c.checked;
        if (src === 'fut') ctx.tmpBit(bit, on); else if (src === 'fut2') ctx.t2Bit(bit, on); else ctx.useBit(bit, on);
        if (src === 'fu' && bit === 1) el.classList.toggle('u-display-only', c.checked);
        if (src === 'fu' && bit === 2) { setN(el, 'si', c.checked ? 1 : 0); el.classList.toggle('u-invisible', c.checked); }
      };
    }
  }
  // General tab: Page Field Name, Enable as Page Anchor, and (where App Designer offers it) Adjust Layout.
  function generalTab(ctx, p, opts) {
    opts = opts || {};
    const { el, d, field, text, check } = ctx;
    const pfn = field(p, 'Page Field Name', text((d.pfn || '').trim(), 18));
    pfn.oninput = () => { d.pfn = pfn.value.trim().toUpperCase(); if (selRow) selRow.children[7].textContent = d.pfn; markDirty(); };
    const anc = check(p, 'Enable as Page Anchor', n(el, 'anc') !== 0); anc.onchange = () => { setN(el, 'anc', anc.checked ? 1 : 0); markDirty(); };
    if (opts.adjust) { const adj = check(p, 'Adjust Layout for Hidden Fields', n(el, 'adj') !== 0); adj.onchange = () => { setN(el, 'adj', adj.checked ? 1 : 0); markDirty(); }; }
  }
  // Fluid tab (App Designer offers it on a Fluid page): FFSTYLELONG's five slots and the FIELDUSETMP /
  // FIELDUSETEMP2 bits -- the same set the Frame panel maps (fr08-fr20), shared by every control type.
  function fluidTab(ctx, fl) {
    const { el, d, group, text, check } = ctx;
    const fluidOn = !!pageProps.fluidPage && editable;
    const off = (c) => { if (!fluidOn) { c.disabled = true; const r = c.closest('.pf, .row'); if (r) { r.classList.add('na'); r.title = 'App Designer offers these on a Fluid page'; } } return c; };
    const slots = (d.fsl || '').split('|').map((x) => x.trim()); while (slots.length < 5) slots.push('');
    const setSlot = (i, v) => { slots[i] = v; d.fsl = slots.slice(0, 5).map((x) => x.trim() || ' ').join('|'); d.fslEdited = '1'; markDirty(); };
    const app = group(fl, 'Application-Specific Styles');
    const sc = off(ctx.field(app, 'Style Classes', Object.assign(document.createElement('textarea'), { rows: 2, value: slots[0], maxLength: 100 })));
    sc.oninput = () => setSlot(0, sc.value.replace(/[\\r\\n]+/g, ' '));
    const ff = group(app, 'Form Factor Style Class Override');
    ['Small', 'Medium', 'Large', 'Extra Large'].forEach((label, i) => { const inp = off(ctx.field(ff, label, text(slots[i + 1], 100))); inp.oninput = () => setSlot(i + 1, inp.value); });
    const supc = off(check(fl, 'Suppress System-Supplied Style Classes', (n(el, 'fut') & 0x400000) !== 0)); supc.onchange = () => ctx.tmpBit(0x400000, supc.checked);
    const sup = group(fl, 'Suppress On Form Factor');
    for (const row of [['Small', (n(el, 'fut') & 0x40000000) !== 0, (v) => ctx.tmpBit(0x40000000, v)], ['Medium', (n(el, 'fut2') & 0x10) !== 0, (v) => ctx.t2Bit(0x10, v)], ['Large', (n(el, 'fut') & 0x20000000) !== 0, (v) => ctx.tmpBit(0x20000000, v)], ['Extra Large', (n(el, 'fut2') & 0x80) !== 0, (v) => ctx.t2Bit(0x80, v)]]) { const c = off(check(sup, row[0], row[1])); c.onchange = () => row[2](c.checked); }
    const radio = (parent, name, options, current, set) => { const row = ctx.mk('<div class="row"></div>'); for (const o of options) { const r = Object.assign(document.createElement('input'), { type: 'radio', name, value: o[0], checked: o[0] === current }); r.onchange = () => set(o[0]); if (!fluidOn) r.disabled = true; row.append(r, tn('label', o[1])); } parent.appendChild(row); if (!fluidOn) { row.classList.add('na'); row.title = 'App Designer offers these on a Fluid page'; } };
    const lr = group(fl, 'Label Rendering');
    radio(lr, 'lr' + d.id, [['before', 'Before Control'], ['after', 'After Control']], (n(el, 'fut') & 0x2000000) ? 'after' : 'before', (v) => ctx.tmpBit(0x2000000, v === 'after'));
    const lig = off(check(lr, 'Include Labels in Grid Cells', (n(el, 'fut2') & 0x02) !== 0)); lig.onchange = () => ctx.t2Bit(0x02, lig.checked);
    radio(group(fl, 'Control Structure'), 'cs' + d.id, [['basic', 'Basic'], ['advanced', 'Advanced']], (n(el, 'fut') & 0x4000000) ? 'basic' : 'advanced', (v) => ctx.tmpBit(0x4000000, v === 'basic'));
  }
  // Static Image: Image ID and the Scale/Size format (DSPLFORMAT 0x800 Scale / 0x4000 Size).
  function imageTab(ctx, p) {
    const { el, d, field, text, select } = ctx;
    const img = field(p, 'Image ID', text((d.cont || '').trim())); img.oninput = () => { d.cont = img.value.trim().toUpperCase(); markDirty(); };
    const sz = field(p, 'Image Format', select([['size', 'Size'], ['scale', 'Scale']], (n(el, 'dspl') & 0x800) ? 'scale' : 'size'));
    sz.onchange = () => { let v = n(el, 'dspl') & ~0x4800; v |= sz.value === 'scale' ? 0x800 : 0x4000; setN(el, 'dspl', v); markDirty(); };
  }
  // Scroll Bar / Scroll Area Options: Occurs Level (computed from the scroll nesting, read-only) and Occurs Count.
  function scrollOptionsTab(ctx, p) {
    const { el, field, text, check } = ctx;
    const lvl = field(p, 'Occurs Level', text(String(n(el, 'level')))); lvl.readOnly = true; lvl.title = 'The scroll nesting level, set by where the scroll sits';
    const unlimited = check(p, 'Unlimited Occurs Count', n(el, 'oc1') === 0);
    const oc = field(p, 'Occurs Count', text(String(n(el, 'oc1')))); oc.type = 'number';
    oc.oninput = () => { setN(el, 'oc1', Number(oc.value) || 0); unlimited.checked = (Number(oc.value) || 0) === 0; markDirty(); };
    unlimited.onchange = () => { if (unlimited.checked) { setN(el, 'oc1', 0); oc.value = '0'; } else { setN(el, 'oc1', 1); oc.value = '1'; } markDirty(); };
  }
  // Grid Options: Occurs Count and the display flags (Show Column Headings / Row Numbers / Allow Column Sorting).
  function gridOptionsTab(ctx, p) {
    const { el, field, text, check } = ctx;
    const lvl = field(p, 'Occurs Level', text(String(n(el, 'level')))); lvl.readOnly = true; lvl.title = 'The scroll nesting level, set by where the grid sits';
    const oc = field(p, 'Occurs Count', text(String(n(el, 'oc1')))); oc.type = 'number'; oc.oninput = () => { setN(el, 'oc1', Number(oc.value) || 0); markDirty(); };
    for (const pair of [['Show Column Headings', 'gch'], ['Show Row Numbers', 'grh'], ['Allow Column Sorting', 'gcs']]) {
      const cb = check(p, pair[0], n(el, pair[1]) !== 0); cb.onchange = () => { setN(el, pair[1], cb.checked ? 1 : 0); markDirty(); };
    }
  }
  // The tabbed scaffold every non-Frame panel uses: the tab strip, panels, a footer and the Delete button.
  let ctrlTab = 'label';
  function richInspect(el, specTitle, tabDefs) {
    const d = el.dataset;
    title.textContent = specTitle;
    const mk = (h) => { const t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild; };
    const wrap = mk('<div class="pp"><div class="ptabs" role="tablist"></div></div>');
    for (const def of tabDefs) { const pane = document.createElement('div'); pane.className = 'ppanel'; pane.dataset.tab = def[0]; wrap.appendChild(pane); }
    const panel = (k) => wrap.querySelector('.ppanel[data-tab="' + k + '"]');
    const keys = tabDefs.map((t) => t[0]);
    const pick = (k) => { ctrlTab = k; for (const x of wrap.querySelectorAll('.ptab')) { x.classList.toggle('selected', x.dataset.tab === k); x.setAttribute('aria-selected', String(x.dataset.tab === k)); } for (const x of wrap.querySelectorAll('.ppanel')) x.hidden = x.dataset.tab !== k; };
    for (const def of tabDefs) { const b = tn('button', def[1]); b.className = 'ptab'; b.setAttribute('role', 'tab'); b.dataset.tab = def[0]; b.onclick = () => pick(def[0]); wrap.firstElementChild.appendChild(b); }
    const ctx = ctxFor(el);
    for (const def of tabDefs) def[2](ctx, panel(def[0]));
    wrap.appendChild(propsTable([['Field ID', d.new ? 'new (assigned on save)' : d.id], ['Tab order', d.num], ['Type', d.type], ['Occurs level', d.level], ...(Number(d.ctlfld) ? [['Control field', d.ctlfld]] : [])]));
    if (editable) { const del = tn('button', 'Delete control'); del.className = 'action'; del.onclick = () => { removeCtl(el); clearSel(); body.replaceChildren(tn('p', 'Control deleted.')); }; wrap.appendChild(del); }
    body.replaceChildren(wrap);
    pick(keys.indexOf(ctrlTab) >= 0 ? ctrlTab : keys[0]);
  }
  // The shared bit sets reused across record-bound controls.
  const USE_COMMON = [['Display Only', 'fu', 0x1], ['Invisible', 'fu', 0x2]];
  const USE_FIELD = [['Display Only', 'fu', 0x1], ['Invisible', 'fu', 0x2], ['Display Control Field', 'fu', 0x8],
    ['Related Field', 'fu', 0x10], ['Multi-Currency Field', 'fu', 0x20], ['Enable When Page is Display Only', 'fu', 0x40000],
    ['Set Component Changed', 'fut', 0x8, true], ['Wrap Long Words', 'fut', 0x40]];
  // Each control type's property panel: App Designer's own tab set for that type, built from the captured columns.
  function dispatch(el) {
    const ft = n(el, 'ftype');
    if (ft === 1) return inspectFrame(el);
    const T = (k, lbl, fn) => [k, lbl, fn];
    const label = (opts) => (ctx, p) => labelTab(ctx, p, opts);
    const general = (opts) => (ctx, p) => generalTab(ctx, p, opts);
    const record = (extra) => (ctx, p) => recordTab(ctx, p, extra);
    const use = (bits) => (ctx, p) => useTab(ctx, p, bits);
    const onOff = (ctx, p) => { const on = ctx.field(p, 'On Value', ctx.text(ctx.d.onv || '')); const off = ctx.field(p, 'Off Value', ctx.text(ctx.d.offv || '')); on.oninput = () => { ctx.d.onv = on.value; markDirty(); }; off.oninput = () => { ctx.d.offv = off.value; markDirty(); }; };
    const valueOnly = (ctx, p) => { const v = ctx.field(p, 'Value', ctx.text(ctx.d.onv || '')); v.oninput = () => { ctx.d.onv = v.value; markDirty(); }; };
    const refInfo = (ttl, read) => (ctx, p) => { const t = ctx.field(p, ttl, ctx.text(read(ctx.d))); t.readOnly = true; t.title = 'Set in App Designer'; };
    switch (ft) {
      case 0: return richInspect(el, 'Static Text Properties', [T('label', 'Label', label({ alignment: true, paragraph: true })), T('general', 'General', general({ adjust: true }))]);
      case 2: return richInspect(el, 'Group Box Properties', [T('label', 'Label', label({})), T('use', 'Use', use([...USE_COMMON, ['Multi-Currency Field', 'fu', 0x20]])), T('general', 'General', general({ adjust: true })), T('fluid', 'Fluid', fluidTab)]);
      case 3: return richInspect(el, 'Image Properties', [T('image', 'Image', imageTab), T('label', 'Label', label({ imageAlt: true, textLabel: 'Alt Tag Label' })), T('general', 'General', general({}))]);
      case 4: return richInspect(el, 'Edit Box Properties', [T('record', 'Record', record()), T('label', 'Label', label({})), T('use', 'Use', use(USE_FIELD)), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 5: return richInspect(el, 'Drop-Down List Properties', [T('record', 'Record', record()), T('label', 'Label', label({})), T('use', 'Use', use(USE_FIELD)), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 6: return richInspect(el, 'Long Edit Box Properties', [T('record', 'Record', record()), T('label', 'Label', label({})), T('use', 'Use', use([...USE_FIELD])), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 7: return richInspect(el, 'Check Box Properties', [T('record', 'Record', record(onOff)), T('label', 'Label', label({})), T('use', 'Use', use(USE_FIELD)), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 8: return richInspect(el, 'Radio Button Properties', [T('record', 'Record', record(valueOnly)), T('label', 'Label', label({})), T('use', 'Use', use(USE_FIELD)), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 9: return richInspect(el, 'Image Properties', [T('record', 'Record', record()), T('label', 'Label', label({})), T('general', 'General', general({}))]);
      case 10: return richInspect(el, 'Scroll Bar Properties', [T('options', 'Options', scrollOptionsTab), T('use', 'Use', use(USE_COMMON)), T('general', 'General', general({}))]);
      case 11: return richInspect(el, 'Subpage Properties', [T('subpage', 'Subpage', refInfo('Subpage Name', (d) => d.target || '')), T('general', 'General', general({}))]);
      case 18: return richInspect(el, 'Secondary Page Properties', [T('secpage', 'Secondary Page', refInfo('Page', (d) => d.target || '')), T('use', 'Use', use([['Invisible', 'fu', 0x2]])), T('label', 'Label', label({})), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 19: return richInspect(el, 'Grid Properties', [T('label', 'Label', label({})), T('options', 'Options', gridOptionsTab), T('use', 'Use', use(USE_COMMON)), T('general', 'General', general({}))]);
      case 20: return richInspect(el, 'Tree Properties', [T('record', 'Record', record()), T('general', 'General', general({}))]);
      case 23: return richInspect(el, 'Horizontal Rule Properties', [T('label', 'Label', label({})), T('general', 'General', general({ adjust: true }))]);
      case 25: return richInspect(el, 'HTML Area Properties', [T('record', 'Record', record()), T('general', 'General', general({}))]);
      case 27: return richInspect(el, 'Scroll Area Properties', [T('label', 'Label', label({})), T('options', 'Options', scrollOptionsTab), T('use', 'Use', use(USE_COMMON)), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 30: return richInspect(el, 'Chart Properties', [T('record', 'Record', record()), T('general', 'General', general({}))]);
      default:
        if ((ft >= 12 && ft <= 17) || ft === 21 || ft === 26 || ft === 29) return richInspect(el, 'Push Button Properties', [T('label', 'Label', label({})), T('use', 'Use', use(USE_COMMON)), T('general', 'General', general({}))]);
        return richInspect(el, 'Page Field Properties', [T('general', 'General', general({ adjust: true }))]);
    }
  }
  // A frame: App Designer's Frame Properties tabs (Label, Use, General, Fluid), as captured (fr01-fr07).
  let frameTab = 'label';
  function inspectFrame(el) {
    const d = el.dataset;
    title.textContent = 'Frame Properties';
    const mk = (h) => { const t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild; };
    const wrap = mk('<div class="pp"><div class="ptabs" role="tablist"></div><div class="ppanel" data-tab="label"></div><div class="ppanel" data-tab="use"></div><div class="ppanel" data-tab="general"></div><div class="ppanel" data-tab="fluid"></div></div>');
    const pick = (k) => { frameTab = k; for (const x of wrap.querySelectorAll('.ptab')) { x.classList.toggle('selected', x.dataset.tab === k); x.setAttribute('aria-selected', String(x.dataset.tab === k)); } for (const x of wrap.querySelectorAll('.ppanel')) x.hidden = x.dataset.tab !== k; };
    for (const [k, label] of [['label', 'Label'], ['use', 'Use'], ['general', 'General'], ['fluid', 'Fluid']]) {
      const b = tn('button', label); b.className = 'ptab'; b.setAttribute('role', 'tab'); b.dataset.tab = k; b.onclick = () => pick(k);
      wrap.firstElementChild.appendChild(b);
    }
    const panel = (k) => wrap.querySelector('.ppanel[data-tab="' + k + '"]');
    const field = (parent, label, control) => { const row = mk('<div class="pf"><label></label></div>'); row.firstChild.textContent = label; row.appendChild(control); parent.appendChild(row); if (!editable) control.disabled = true; return control; };
    const check = (parent, label, on) => { const row = mk('<div class="row"><input type="checkbox"><label></label></div>'); const c = row.firstChild; c.checked = !!on; row.lastChild.textContent = label; parent.appendChild(row); if (!editable) c.disabled = true; return c; };
    const group = (parent, legend) => { const f = mk('<fieldset><legend></legend></fieldset>'); f.firstChild.textContent = legend; parent.appendChild(f); return f; };
    const text = (v, max) => { const i = document.createElement('input'); i.type = 'text'; i.value = v || ''; if (max) i.maxLength = max; return i; };
    const select = (opts, v) => { const sl = document.createElement('select'); for (const [val, label] of opts) { const o = document.createElement('option'); o.value = val; o.textContent = label; sl.appendChild(o); }
      if (![...sl.options].some((o) => o.value === v)) { const o = document.createElement('option'); o.value = v; o.textContent = v; sl.appendChild(o); } sl.value = v; return sl; };
    const useBit = (b, on) => { setN(el, 'fu', on ? n(el, 'fu') | b : n(el, 'fu') & ~b); markDirty(); };

    // Label: the frame's text, its style, Hide Border (FIELDUSE 0x4000000) and Adjust Layout for Hidden Fields.
    const lab = panel('label');
    const txt = field(lab, 'Text', text(d.lx));
    txt.oninput = () => { d.lx = txt.value; const l = document.getElementById('l' + d.id); if (l) { l.textContent = txt.value; l.classList.remove('placeholder'); } if (selRow) selRow.children[3].textContent = txt.value; markDirty(); };
    const disp = group(lab, 'Display Options');
    const style = field(disp, 'Style', select([['', '*** Use Default Style ***'], ...(choices ? choices.styleClasses || [] : []).map((x) => [x, x])], (d.fs || '').trim()));
    style.onchange = () => { d.fs = style.value; markDirty(); };
    const hide = check(disp, 'Hide Border', (n(el, 'fu') & 0x4000000) !== 0);
    hide.onchange = () => useBit(0x4000000, hide.checked);
    const adj = check(disp, 'Adjust Layout for Hidden Fields', n(el, 'adj') !== 0);
    adj.onchange = () => { setN(el, 'adj', adj.checked ? 1 : 0); markDirty(); };

    // Use: Multi-Currency Field (FIELDUSE 0x20).
    const mc = check(panel('use'), 'Multi-Currency Field', (n(el, 'fu') & 0x20) !== 0);
    mc.onchange = () => useBit(0x20, mc.checked);

    // General: Page Field Name and Enable as Page Anchor.
    const gen = panel('general');
    const pfn = field(gen, 'Page Field Name', text((d.pfn || '').trim(), 18));
    pfn.oninput = () => { d.pfn = pfn.value.trim().toUpperCase(); if (selRow) selRow.children[7].textContent = d.pfn; markDirty(); };
    const anc = check(gen, 'Enable as Page Anchor', n(el, 'anc') !== 0);
    anc.onchange = () => { setN(el, 'anc', anc.checked ? 1 : 0); markDirty(); };

    // Fluid (fr08-fr20): App Designer offers it on a Fluid page. Classes: PSPNLFIELDEXT.FFSTYLELONG's five slots;
    // the switches: FIELDUSETMP and PSPNLFIELDEXT.FIELDUSETEMP2 bits.
    const fl = panel('fluid');
    const fluidOn = !!pageProps.fluidPage && editable;
    const off = (c) => { if (!fluidOn) { c.disabled = true; c.closest('.pf, .row').classList.add('na'); c.closest('.pf, .row').title = 'App Designer offers these on a Fluid page'; } return c; };
    const slots = (d.fsl || '').split('|').map((x) => x.trim());
    while (slots.length < 5) slots.push('');
    const setSlot = (i, v) => { slots[i] = v; d.fsl = slots.slice(0, 5).map((x) => x.trim() || ' ').join('|'); d.fslEdited = '1'; markDirty(); };
    const tmpBit = (b, on) => { setN(el, 'fut', on ? n(el, 'fut') | b : n(el, 'fut') & ~b); markDirty(); };
    const t2Bit = (b, on) => { setN(el, 'fut2', on ? n(el, 'fut2') | b : n(el, 'fut2') & ~b); markDirty(); };
    const app = group(fl, 'Application-Specific Styles');
    const sc = off(field(app, 'Style Classes', Object.assign(document.createElement('textarea'), { rows: 2, value: slots[0], maxLength: 100 })));
    sc.oninput = () => setSlot(0, sc.value.replace(/[\\r\\n]+/g, ' '));
    const ff = group(app, 'Form Factor Style Class Override');
    ['Small', 'Medium', 'Large', 'Extra Large'].forEach((label, i) => { const inp = off(field(ff, label, text(slots[i + 1], 100))); inp.oninput = () => setSlot(i + 1, inp.value); });
    const supc = off(check(fl, 'Suppress System-Supplied Style Classes', (n(el, 'fut') & 0x400000) !== 0));
    supc.onchange = () => tmpBit(0x400000, supc.checked);
    const sup = group(fl, 'Suppress On Form Factor');
    for (const [label, on, set] of [
      ['Small', (n(el, 'fut') & 0x40000000) !== 0, (v) => tmpBit(0x40000000, v)],
      ['Medium', (n(el, 'fut2') & 0x10) !== 0, (v) => t2Bit(0x10, v)],
      ['Large', (n(el, 'fut') & 0x20000000) !== 0, (v) => tmpBit(0x20000000, v)],
      ['Extra Large', (n(el, 'fut2') & 0x80) !== 0, (v) => t2Bit(0x80, v)]]) { const c = off(check(sup, label, on)); c.onchange = () => set(c.checked); }
    const radio = (parent, name, options, current, set) => {
      const row = mk('<div class="row"></div>');
      for (const [val, label] of options) {
        const r = Object.assign(document.createElement('input'), { type: 'radio', name, value: val, checked: val === current });
        r.onchange = () => set(val); row.append(r, tn('label', label));
        if (!fluidOn) r.disabled = true;
      }
      parent.appendChild(row); if (!fluidOn) { row.classList.add('na'); row.title = 'App Designer offers these on a Fluid page'; }
    };
    const lr = group(fl, 'Label Rendering');
    radio(lr, 'lr' + d.id, [['before', 'Before Control'], ['after', 'After Control']], (n(el, 'fut') & 0x2000000) ? 'after' : 'before', (v) => tmpBit(0x2000000, v === 'after'));
    const lig = off(check(lr, 'Include Labels in Grid Cells', (n(el, 'fut2') & 0x02) !== 0));
    lig.onchange = () => t2Bit(0x02, lig.checked);
    radio(group(fl, 'Control Structure'), 'cs' + d.id, [['basic', 'Basic'], ['advanced', 'Advanced']], (n(el, 'fut') & 0x4000000) ? 'basic' : 'advanced', (v) => tmpBit(0x4000000, v === 'basic'));

    const foot = propsTable([['Field ID', d.new ? 'new (assigned on save)' : d.id], ['Tab order', d.num]]);
    wrap.appendChild(foot);
    if (editable) {
      const del = tn('button', 'Delete control'); del.className = 'action';
      del.onclick = () => { removeCtl(el); clearSel(); body.replaceChildren(tn('p', 'Control deleted.')); };
      wrap.appendChild(del);
    }
    body.replaceChildren(wrap);
    pick(frameTab);
  }
  function removeCtl(el) {
    el.classList.add('removed'); el.dataset.removed = '1';
    const l = document.getElementById('l' + el.dataset.id); if (l) l.classList.add('removed');
    const r = grid && grid.querySelector('tr[data-id="' + el.dataset.id + '"]'); if (r) r.classList.add('removed');
    markDirty();
  }
  // Several controls: the inspector shows the group; dragging any of them moves all.
  function setSelection(list) {
    list = [...new Set(list)].filter((el) => !el.dataset.removed);
    if (list.length === 1) return inspect(list[0]);
    if (!list.length) return showPage();
    clearSel();
    for (const el of list) { sel.add(el); el.classList.add('selected-ctl'); }
    document.body.classList.add('multi');
    title.textContent = 'Group Selection';
    const hint = tn('p', 'Drag any selected control to move them together. Delete removes them.'); hint.className = 'hint';
    body.replaceChildren(propsTable([['Controls selected', list.length]]), hint);
    if (editable) {
      const b = tn('button', 'Delete ' + list.length + ' controls'); b.className = 'action';
      b.onclick = () => { for (const el of [...sel]) removeCtl(el); showPage(); };
      body.append(b);
    }
  }
  showPage();
  if (!editable) canvas.addEventListener('click', (e) => { const el = e.target.closest('.ctl'); if (el) inspect(el); });
  if (grid) grid.addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) inspect(controlById(tr.dataset.id)); });
  // Copy: the selected controls, described for a paste on any page window of this connection (pagePanel.ts keeps them).
  // A stored control is pasted as a copy of its stored rows (pageWriter.ts copyControlRows); a new one as another new one.
  let clip = [];
  let pasteClipboard = () => {};
  function copySelection() {
    const items = [...sel].filter((el) => !el.dataset.removed).map((el) => {
      const lbl = document.getElementById('l' + el.dataset.id);
      const stored = !el.dataset.new && !el.dataset.copyPage;
      return { cls: [...el.classList].filter((c) => /^(s-[a-z]+|u-display-only|u-invisible)$/.test(c)),
        data: { ...el.dataset, ...(stored ? { copyPage: pageName, copyId: el.dataset.id } : {}) },
        l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight,
        label: lbl && !lbl.classList.contains('removed') ? { text: lbl.textContent, dx: lbl.offsetLeft - el.offsetLeft, dy: lbl.offsetTop - el.offsetTop, placeholder: lbl.classList.contains('placeholder') } : null };
    });
    if (!items.length) { if (status) { status.textContent = 'Select the controls to copy first.'; status.classList.add('err'); } return; }
    if (vscode) vscode.postMessage({ type: 'copy', items });
    if (status) { status.textContent = 'Copied ' + items.length + ' control' + (items.length === 1 ? '' : 's'); status.classList.remove('err'); }
  }
  document.getElementById('copy-btn').onclick = copySelection;
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'clipboard') { clip = ev.data.items || []; const p = document.getElementById('paste-btn'); if (p) p.disabled = !clip.length; }
  });
  if (vscode) vscode.postMessage({ type: 'ready' });

  // Keys outside the inspector's inputs: Delete removes the selection, Ctrl+A selects all, Ctrl+C / Ctrl+V copy and paste, Escape clears.
  window.addEventListener('keydown', (e) => {
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!panels.layout.classList.contains('selected')) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'c' && sel.size) { e.preventDefault(); copySelection(); return; }
    if (editable && (e.ctrlKey || e.metaKey) && key === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (editable && (e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); for (const el of [...sel]) removeCtl(el); showPage(); }
    else if (editable && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection(live()); }
    else if (e.key === 'Escape' && sel.size) showPage();
  });

  if (editable) {
    let drag = null;
    // Select Field (click; Shift / Ctrl+click adds; a drag on empty page selects a group) or Select Group (a drag anywhere).
    let mode = 'field';
    const modeBtns = { field: document.getElementById('sel-field'), group: document.getElementById('sel-group') };
    function setMode(m) {
      mode = m;
      for (const k of Object.keys(modeBtns)) { modeBtns[k].classList.toggle('on', k === m); modeBtns[k].setAttribute('aria-pressed', String(k === m)); }
      canvas.classList.toggle('group-mode', m === 'group');
    }
    modeBtns.field.onclick = () => { show('layout'); setMode('field'); };
    modeBtns.group.onclick = () => { show('layout'); setMode('group'); };
    document.getElementById('sel-all').onclick = () => { show('layout'); setSelection(live()); };

    const canvasPoint = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left - canvas.clientLeft, y: e.clientY - r.top - canvas.clientTop }; };
    // Moves a control (and its label) by dx, dy in page pixels, keeping its stored columns in step.
    function moveBy(el, dx, dy) {
      const l = n(el,'fl') + dx, t = n(el,'ft') + dy;
      el.style.left = l + 'px'; el.style.top = t + 'px'; setN(el,'fl', l); setN(el,'ft', t);
      // RIGHT/BOTTOM are page coordinates too: a sized control keeps its size (0 = auto-sized, left alone).
      if (n(el,'fr')) setN(el,'fr', n(el,'fr')+dx); if (n(el,'fb')) setN(el,'fb', n(el,'fb')+dy);
      // A stored label rectangle moves with the control; an all-zero (relative) or negative (hidden) one is left as is.
      const lr = ['ell','elt','elr','elb'].map((a) => n(el,a));
      if (lr.some((v) => v !== 0) && lr.every((v) => v >= 0)) { setN(el,'ell', lr[0]+dx); setN(el,'elt', lr[1]+dy); setN(el,'elr', lr[2]+dx); setN(el,'elb', lr[3]+dy); }
      const lbl = document.getElementById('l'+el.dataset.id);
      if (lbl) { lbl.style.left = (parseFloat(lbl.style.left||getComputedStyle(lbl).left) + dx) + 'px'; lbl.style.top = (parseFloat(lbl.style.top||getComputedStyle(lbl).top) + dy) + 'px'; }
    }
    // A move keeps the controls on the page: it stops at the page's edges.
    function clampMove(group, dx, dy) {
      const W = pageProps.sizeWidth, H = pageProps.sizeHeight;
      const minL = Math.min(...group.map((el) => el.offsetLeft)), minT = Math.min(...group.map((el) => el.offsetTop));
      const maxR = Math.max(...group.map((el) => el.offsetLeft + el.offsetWidth)), maxB = Math.max(...group.map((el) => el.offsetTop + el.offsetHeight));
      if (dx < 0) dx = Math.max(dx, Math.min(0, -minL)); else dx = Math.min(dx, Math.max(0, W - maxR));
      if (dy < 0) dy = Math.max(dy, Math.min(0, -minT)); else dy = Math.min(dy, Math.max(0, H - maxB));
      return [dx, dy];
    }

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      closeInsertMenu();
      if (e.target.classList.contains('pg-edge')) {
        if (pageProps.pnlType !== 0 && pageProps.pnlType !== 2) { status.textContent = 'The size of a ' + (pageTypes[pageProps.pnlType] || 'page') + ' is set by its type.'; e.preventDefault(); return; }
        const edge = e.target.dataset.edge;
        drag = { page: edge, x: e.clientX, y: e.clientY, w: canvas.offsetWidth - 2, h: canvas.offsetHeight - 2, handle: e.target };
        e.target.classList.add('dragging'); e.preventDefault(); return;
      }
      const el = e.target.closest('.ctl');
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!el || (mode === 'group' && !sel.has(el))) {
        // A selection rectangle.
        const at = canvasPoint(e);
        const box = Object.assign(document.createElement('div'), { className: 'band' });
        box.style.left = at.x + 'px'; box.style.top = at.y + 'px';
        canvas.appendChild(box);
        drag = { band: box, x0: at.x, y0: at.y, add: additive };
        e.preventDefault(); return;
      }
      if (additive) {
        setSelection(sel.has(el) ? [...sel].filter((s) => s !== el) : [...sel, el]);
        e.preventDefault(); return;
      }
      const resize = e.target.classList.contains('rsz');
      const inGroup = sel.has(el) && sel.size > 1;
      if (!inGroup) inspect(el);
      el.focus({ preventScroll: true });
      drag = { el, group: [...sel], resize, collapse: inGroup, x: e.clientX, y: e.clientY, w: el.offsetWidth, h: el.offsetHeight, moved: false };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      if (drag.band) {
        const p = canvasPoint(e);
        const r = { l: Math.min(p.x, drag.x0), t: Math.min(p.y, drag.y0), r: Math.max(p.x, drag.x0), b: Math.max(p.y, drag.y0) };
        Object.assign(drag.band.style, { left: r.l + 'px', top: r.t + 'px', width: (r.r - r.l) + 'px', height: (r.b - r.t) + 'px' });
        drag.rect = r; return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, el = drag.el;
      if (drag.page) {
        setPageSize(drag.page === 'b' ? drag.w : drag.w + dx, drag.page === 'r' ? drag.h : drag.h + dy);
        return;
      }
      if (drag.resize) {
        // Not past the page's right / bottom edge.
        const w = Math.max(6, Math.min(drag.w + dx, pageProps.sizeWidth - el.offsetLeft)), h = Math.max(6, Math.min(drag.h + dy, pageProps.sizeHeight - el.offsetTop));
        el.style.width = w + 'px'; el.style.height = h + 'px';
        setN(el,'fr', n(el,'fl') + w); setN(el,'fb', n(el,'ft') + h); el.dataset.fst = '2';
        drag.moved = true;
      } else {
        const [mx, my] = clampMove(drag.group, dx, dy);
        if (!mx && !my) return;
        for (const g of drag.group) moveBy(g, mx, my);
        drag.x += mx; drag.y += my; drag.moved = true;
      }
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.band) {
        d.band.remove();
        const r = d.rect;
        if (r && (r.r - r.l > 2 || r.b - r.t > 2)) {
          // The controls wholly inside the rectangle (App Designer's Select Group).
          const inside = live().filter((el) => el.offsetParent !== null && el.offsetLeft >= r.l && el.offsetTop >= r.t &&
            el.offsetLeft + el.offsetWidth <= r.r && el.offsetTop + el.offsetHeight <= r.b);
          setSelection(d.add ? [...sel, ...inside] : inside);
        } else if (!d.add) showPage();
        return;
      }
      if (d.handle) d.handle.classList.remove('dragging');
      if (d.moved) markDirty();
      else if (d.collapse) inspect(d.el);
    });

    // Insert ▾: App Designer's Insert menu, grouped.
    const insertBtn = document.getElementById('insert-btn'), insertMenu = document.getElementById('insert-menu');
    function closeInsertMenu() { insertMenu.hidden = true; insertBtn.setAttribute('aria-expanded', 'false'); }
    insertBtn.onclick = (e) => {
      e.stopPropagation();
      insertMenu.hidden = !insertMenu.hidden; insertBtn.setAttribute('aria-expanded', String(!insertMenu.hidden));
      if (!insertMenu.hidden) { const f = insertMenu.querySelector('button:not(:disabled)'); if (f) f.focus(); }
    };
    document.addEventListener('click', (e) => { if (!insertMenu.hidden && !insertMenu.contains(e.target) && e.target !== insertBtn) closeInsertMenu(); });
    insertMenu.addEventListener('keydown', (e) => {
      const items = [...insertMenu.querySelectorAll('button:not(:disabled)')], i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeInsertMenu(); insertBtn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });

    // The Order tab: Move Up / Move Down and drag-and-drop set the tab order (FIELDNUM), sent with Save.
    let orderChanged = false;
    function renumber() {
      let i = 0;
      for (const tr of grid.rows) {
        if (tr.classList.contains('removed')) continue;
        tr.children[0].textContent = String(++i);
        const c = controlById(tr.dataset.id); if (c) c.dataset.num = String(i);
      }
    }
    function moveRow(tr, before) {
      if (before === tr) return;
      grid.insertBefore(tr, before); orderChanged = true; renumber(); markDirty();
      if (selected) inspect(selected); // its Tab order
    }
    const visibleSibling = (tr, dir) => { let s = tr[dir]; while (s && s.classList.contains('removed')) s = s[dir]; return s; };
    document.getElementById('ord-up').onclick = () => { if (!selRow) return; const p = visibleSibling(selRow, 'previousElementSibling'); if (p) moveRow(selRow, p); selRow.focus(); };
    document.getElementById('ord-down').onclick = () => { if (!selRow) return; const nx = visibleSibling(selRow, 'nextElementSibling'); if (nx) moveRow(selRow, nx.nextElementSibling); selRow.focus(); };
    let dragRow = null;
    const clearDrop = () => { for (const tr of grid.querySelectorAll('.drop-before, .drop-after')) tr.classList.remove('drop-before', 'drop-after'); };
    grid.addEventListener('dragstart', (e) => {
      dragRow = e.target.closest('tr'); if (!dragRow) return;
      inspect(controlById(dragRow.dataset.id));
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragRow.dataset.id);
      dragRow.classList.add('dragging');
    });
    grid.addEventListener('dragover', (e) => {
      const tr = e.target.closest('tr'); if (!dragRow || !tr || tr === dragRow) return;
      e.preventDefault(); clearDrop();
      const r = tr.getBoundingClientRect();
      tr.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
    });
    grid.addEventListener('drop', (e) => {
      e.preventDefault();
      const tr = e.target.closest('tr');
      if (dragRow && tr && tr !== dragRow) moveRow(dragRow, tr.classList.contains('drop-after') ? tr.nextElementSibling : tr);
      clearDrop();
    });
    grid.addEventListener('dragend', () => { clearDrop(); if (dragRow) dragRow.classList.remove('dragging'); dragRow = null; });

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
      Object.assign(el.dataset, { id: String(id), new: kind, num: '', level: String(scrollLevelAt(l + k.dw / 2, t + k.dh / 2)), type: k.typeName, target: '', rec: '', field: '', pfn: '', defer: '1', ctlfld: '0',
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
    for (const b of document.querySelectorAll('button.tool')) b.addEventListener('click', () => { closeInsertMenu(); addControl(b.dataset.kind); });

    // Paste: the copied controls, each a new control drawn as its source was, offset down-right (again with each paste),
    // kept on the page. App Designer's paste moves FIELDLEFT / TOP / RIGHT / BOTTOM by the offset (c01, c02).
    let pasteSeq = 0;
    pasteClipboard = () => {
      if (!clip.length) return;
      show('layout');
      const step = 20 * (++pasteSeq);
      const W = pageProps.sizeWidth, H = pageProps.sizeHeight;
      const minL = Math.min(...clip.map((i) => i.l)), minT = Math.min(...clip.map((i) => i.t));
      const maxR = Math.max(...clip.map((i) => i.l + i.w)), maxB = Math.max(...clip.map((i) => i.t + i.h));
      const dx = Math.max(-minL, Math.min(step, W - maxR)), dy = Math.max(-minT, Math.min(step, H - maxB));
      const made = [];
      for (const it of clip) {
        const id = -(++newSeq);
        const el = document.createElement('div');
        el.className = ['ctl', ...it.cls.filter((c) => /^(s-[a-z]+|u-display-only|u-invisible)$/.test(c)), 'new-ctl'].join(' ');
        for (const [k, v] of Object.entries(it.data)) if (!['id', 'num', 'removed'].includes(k)) el.dataset[k] = String(v);
        Object.assign(el.dataset, { id: String(id), num: '', level: String(scrollLevelAt(it.l + dx + it.w / 2, it.t + dy + it.h / 2)) });
        el.id = 'c' + id; el.tabIndex = 0; el.title = 'Pasted ' + (el.dataset.type || 'control');
        // The stored columns move as a drag moves them (an auto-sized 0 stays 0 here; the writer moves it as App Designer does).
        setN(el, 'fl', n(el, 'fl') + dx); setN(el, 'ft', n(el, 'ft') + dy);
        if (n(el, 'fr')) setN(el, 'fr', n(el, 'fr') + dx); if (n(el, 'fb')) setN(el, 'fb', n(el, 'fb') + dy);
        const lr = ['ell', 'elt', 'elr', 'elb'].map((a) => n(el, a));
        if (lr.some((v) => v !== 0) && lr.every((v) => v >= 0)) { setN(el, 'ell', lr[0] + dx); setN(el, 'elt', lr[1] + dy); setN(el, 'elr', lr[2] + dx); setN(el, 'elb', lr[3] + dy); }
        Object.assign(el.style, { left: (it.l + dx) + 'px', top: (it.t + dy) + 'px', width: it.w + 'px', height: it.h + 'px', zIndex: el.classList.contains('s-container') ? '1' : '2' });
        if (el.classList.contains('s-checkbox')) el.appendChild(Object.assign(document.createElement('span'), { className: 'box' }));
        else if (el.classList.contains('s-radio')) el.appendChild(Object.assign(document.createElement('span'), { className: 'dot' }));
        else if (el.classList.contains('s-dropdown')) el.appendChild(Object.assign(document.createElement('span'), { className: 'caret', textContent: '▾' }));
        else if (el.classList.contains('s-button')) el.appendChild(document.createTextNode(el.dataset.lx || el.dataset.type || 'Button'));
        el.appendChild(Object.assign(document.createElement('span'), { className: 'rsz' }));
        if (it.label) {
          const lbl = Object.assign(document.createElement('div'), { className: 'lbl' + (it.label.placeholder ? ' placeholder' : ''), id: 'l' + id, textContent: it.label.text });
          lbl.style.left = (it.l + dx + it.label.dx) + 'px'; lbl.style.top = (it.t + dy + it.label.dy) + 'px';
          canvas.appendChild(lbl);
        }
        canvas.appendChild(el);
        made.push(el);
      }
      setSelection(made);
      markDirty();
      status.textContent = 'Pasted ' + made.length + ' control' + (made.length === 1 ? '' : 's') + ' (unsaved)';
    };
    document.getElementById('paste-btn').onclick = () => pasteClipboard();

    saveBtn.addEventListener('click', () => {
      const live = [...canvas.querySelectorAll('.ctl')].filter((el) => !el.dataset.removed);
      const unbound = live.find((el) => el.dataset.new && kinds[el.dataset.new].bound && !(el.dataset.rec && el.dataset.field));
      if (unbound) { inspect(unbound); status.textContent = 'Give the new ' + unbound.dataset.type + ' a record and field.'; status.classList.add('err'); return; }
      const controls = live.map((el) => ({
        pnlFldId: n(el,'id'), fieldLeft: n(el,'fl'), fieldTop: n(el,'ft'), fieldRight: n(el,'fr'), fieldBottom: n(el,'fb'),
        editLblLeft: n(el,'ell'), editLblTop: n(el,'elt'), editLblRight: n(el,'elr'), editLblBottom: n(el,'elb'),
        fieldSizeType: n(el,'fst'), lblType: n(el,'lt'), lblText: el.dataset.lx || '', fieldUse: n(el,'fu'), secureInvisible: n(el,'si'),
        // The Properties dialog's columns, for a stored control (an added one takes App Designer's defaults).
        ...(el.dataset.fs !== undefined ? { fieldStyle: el.dataset.fs, pageFieldName: el.dataset.pfn || '', adjustHidden: n(el,'adj'), anchor: n(el,'anc'),
          fieldUseTmp: n(el,'fut'), fieldUseTemp2: n(el,'fut2'), dsplFormat: n(el,'dspl'), contName: el.dataset.cont || '', grdLblMsgSet: n(el,'gms'), grdLblMsgNum: n(el,'gmn'),
          onValue: el.dataset.onv || '', offValue: el.dataset.offv || '', lblLoc: n(el,'lloc'),
          // A stored control's record rebind (Record / Field Name) and Allow Deferred Processing.
          recName: el.dataset.rec || '', fieldName: el.dataset.field || '', deferProc: el.dataset.defer !== '0',
          // Scroll Bar / Grid / Scroll Area Occurs Count and the Grid display-option flags.
          occursCount1: n(el,'oc1'), gridShowColHdg: n(el,'gch'), gridShowRowHdg: n(el,'grh'), gridAllowColSort: n(el,'gcs'),
          ...(el.dataset.fslEdited ? { fluidClasses: (el.dataset.fsl || '').split('|') } : {}) } : {}),
        // A new / pasted control takes the scroll level of its final position (App Designer's scroll buffer).
        ...((el.dataset.new || el.dataset.copyPage) ? { occursLevel: scrollLevelAt(el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2) } : {}),
        ...(el.dataset.copyPage ? { copy: { pnlName: el.dataset.copyPage, pnlFldId: Number(el.dataset.copyId) } }
          : el.dataset.new ? { add: { kind: el.dataset.new, recName: el.dataset.rec || '', fieldName: el.dataset.field || '' } } : {})
      }));
      saveBtn.disabled = true; status.textContent = 'Saving…'; status.classList.remove('err');
      // The tab order, when the Order tab changed it: the stored controls still on the page, first to last.
      const order = orderChanged ? [...grid.rows].map((tr) => Number(tr.dataset.id)).filter((id) => { const c = controlById(id); return c && !c.dataset.removed; }) : undefined;
      // Every captured property goes as it stands; the writer writes only those that differ from the stored page.
      const pp = pageProps;
      vscode.postMessage({ type: 'save', controls, ...(order ? { order } : {}), properties: { description: pp.description, comments: pp.comments,
        ownerId: pp.ownerId, styleSheet: pp.styleSheet, background: pp.background, deferProc: pp.deferProc, adjustLayout: pp.adjustLayout, popupMenu: pp.popupMenu,
        ...(pp.pageSize ? { pageSize: pp.pageSize } : {}),
        pageType: pp.pnlType, okCancel: pp.okCancel, closeBox: pp.closeBox, disableModal: pp.disableModal,
        // A page made Subpage / Popup Page (Auto-size): what is drawn, as App Designer measures it.
        ...((pp.pnlType === 1 || pp.pnlType === 3) && pp.pnlType !== storedPage.type
          ? { autoSizeExtent: (() => { show('layout'); const e = contentExtent(); return { left: e.l, top: e.t, right: e.r, bottom: e.b }; })() } : {}),
        fluidPage: pp.fluidPage, fluid: pp.fluid, suppressClasses: pp.suppressClasses,
        ...(pp.sizeChanged ? { sizeWidth: pp.sizeWidth, sizeHeight: pp.sizeHeight } : {}) } });
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
