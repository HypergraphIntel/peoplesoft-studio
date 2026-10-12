import { escapeHtml as esc } from './propertiesHtml.js';
import { controlShape, PAGE_SIZE_PRESETS, type PageControl, type PageLayout } from '../model/pageLayout.js';
import { PAGE_FIELD_TYPES, PAGE_TYPES } from '../model/uiDefinitions.js';
import { FIELD_OPTIONAL, GRID_ONLY, NEW_CONTROL_FIELDTYPE, NEW_CONTROL_FIELDUSE, NEW_CONTROL_SIZE, RECORD_ONLY, RECORD_OPTIONAL, isRecordBound, type NewControlKind } from '../providers/pageControlTemplates.js';

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
    { kind: 'horizontalRule', label: 'Horizontal Rule' }, { kind: 'staticText', label: 'Static Text' }, { kind: 'staticImage', label: 'Static Image' }, { kind: 'tabSeparator', label: 'Tab Separator' }] },
  { group: 'Controls', items: [{ kind: 'checkBox', label: 'Check Box' }, { kind: 'dropDown', label: 'Drop-Down List Box' }, { kind: 'editBox', label: 'Edit Box' },
    { kind: 'htmlArea', label: 'HTML Area' }, { kind: 'image', label: 'Image' }, { kind: 'longEdit', label: 'Long Edit Box' }, { kind: 'pushButton', label: 'Push Button/Hyperlink' }, { kind: 'radioButton', label: 'Radio Button' }, { kind: 'tree', label: 'Tree' }] },
  { group: 'Grids and scrolls', items: [{ kind: 'grid', label: 'Grid' }, { kind: 'scrollArea', label: 'Scroll Area' }, { kind: 'scrollBar', label: 'Scroll Bar' }] },
  { group: 'Pages', items: [{ kind: 'secondaryPage', label: 'Secondary Page' }, { kind: 'subpage', label: 'Subpage' }] },
  { group: 'Charts', items: [{ kind: 'chart', label: 'Chart' }, { kind: 'analyticGrid', label: 'Analytic Grid' }] }
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
    // Auto-sized controls (0 x 0, sized by App Designer from the field) are drawn at a stand-in size, and so are the
    // 4 x 4 boxes App Designer drops for a Static Image or HTML Area (saved 4 x 4 until resized; a move keeps the size),
    // and a Scroll Bar's 17 x 4.
    const drawn = shape === 'checkbox' ? [14, 14] : [80, 18];
    const tiny = (z.width > 0 && z.width < 12) || kind === 'scrollBar';
    return [kind, { shape, typeName: PAGE_FIELD_TYPES[NEW_CONTROL_FIELDTYPE[kind]] ?? kind, bound: isRecordBound(kind),
      w: z.width, h: z.height, dw: tiny ? 24 : z.width || drawn[0], dh: tiny ? 24 : z.height || drawn[1], fst: z.fieldSizeType, lt: z.lblType, lx: z.lblText,
      ftype: NEW_CONTROL_FIELDTYPE[kind],
      fu: NEW_CONTROL_FIELDUSE[kind] ?? 0, fieldOptional: FIELD_OPTIONAL.has(kind),
      // What else a new one needs before a save: a grid's record, an analytic model, its page, a grid to be a column of.
      recordOnly: RECORD_ONLY.has(kind) && kind !== 'analyticGrid', recordOptional: RECORD_OPTIONAL.has(kind), analytic: kind === 'analyticGrid',
      pageRef: kind === 'subpage' || kind === 'secondaryPage', gridOnly: GRID_ONLY.has(kind) }];
  }));
}

/** The control's editable columns as data-* attributes, for the editor round-trip and the sidebar. */
function columnData(c: PageControl): string {
  const k = c.columns;
  return `data-id="${c.pnlFldId}" data-num="${c.num}" data-level="${c.level}" data-type="${esc(c.typeName)}"` +
    (c.gridColumnOf !== undefined ? ` data-incol="${c.gridColumnOf}"` : '') +
    ` data-target="${esc(c.target)}" data-rec="${esc(c.recName)}" data-field="${esc(c.fieldName)}" data-pfn="${esc(c.pageFieldName)}"` +
    ` data-defer="${c.deferProc ? 1 : 0}" data-ctlfld="${c.controlFieldNum}" data-fl="${k.fieldLeft}" data-ft="${k.fieldTop}"` +
    ` data-fr="${k.fieldRight}" data-fb="${k.fieldBottom}" data-ell="${k.editLblLeft}" data-elt="${k.editLblTop}"` +
    ` data-elr="${k.editLblRight}" data-elb="${k.editLblBottom}" data-fst="${k.fieldSizeType}" data-lt="${k.lblType}"` +
    ` data-lx="${esc(k.lblText).replace(/\r/g, '&#13;')}" data-fu="${k.fieldUse}" data-si="${k.secureInvisible}"` +
    ` data-ftype="${c.type}" data-fs="${esc(k.fieldStyle)}" data-adj="${k.adjustHidden}" data-anc="${k.anchor}"` +
    ` data-fut="${k.fieldUseTmp}" data-fut2="${k.fieldUseTemp2}" data-fsl="${esc(k.ffStyleLong)}"` +
    ` data-dspl="${k.dsplFormat}" data-cont="${esc(k.contName)}" data-gms="${k.grdLblMsgSet}" data-gmn="${k.grdLblMsgNum}"` +
    ` data-onv="${esc(k.onValue)}" data-offv="${esc(k.offValue)}" data-lloc="${k.lblLoc}"` +
    ` data-oc1="${k.occursCount1}" data-gch="${k.gridShowColHdg}" data-grh="${k.gridShowRowHdg}" data-gcs="${k.gridAllowColSort}"` +
    ` data-hc="${k.htmlConstant === null ? 0 : 1}" data-html="${esc(k.htmlConstant ?? '').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')}"` +
    ` data-lst="${k.labelSizeType}" data-lex="${k.expandField}" data-plt="${k.placeholderType}" data-plh="${esc(k.placeholder)}"` +
    ` data-pls="${k.placeholderMsgSet}" data-pln="${k.placeholderMsgNum}" data-rte="${k.richText ? 1 : 0}"` +
    ` data-rtc="${esc(k.richText?.configSettingsId ?? '')}" data-rti="${esc(k.richText?.imageLocationUrlId ?? '')}" data-rtp="${esc(k.richText?.pluginFileId ?? '')}"` +
    ` data-rtt="${esc(k.richText?.templateFileId ?? '')}" data-rts="${esc(k.richText?.styleFileId ?? '')}"` +
    ` data-pop="${esc(k.popupMenu)}" data-assoc="${k.assocFieldNum}" data-lsty="${esc(k.labelStyle)}" data-lid="${esc(k.labelId)}" data-udl="${k.useDefaultLabel}" data-hf="${k.hideFields}"` +
    ` data-cda="${k.collapseDataArea}" data-dve="${k.defaultExpanded}" data-imc="${esc(k.imageCollapsed)}" data-ime="${esc(k.imageExpanded)}"` +
    ` data-pms="${k.popupMsgSet}" data-pmn="${k.popupMsgNum}" data-gbt="${k.groupBoxType}" data-gbh="${k.groupBoxHtmlType}" data-sb="${k.scrollBars}"` +
    ` data-hti="${k.headerTextInfo}" data-hai="${k.headerActionInfo}" data-hac="${k.headerActionItems}"` +
    ` data-n1="${k.setLevel}" data-dfill="${esc(k.dsplFill)}" data-ffam="${esc(k.formatFamily)}" data-dfn="${esc(k.displayFormatName)}" data-ppg="${esc(k.popupPage)}"` +
    ` data-ity="${k.inputType}" data-mnn="${esc(k.minNumber)}" data-mxn="${esc(k.maxNumber)}" data-stn="${esc(k.stepNumber)}" data-nsp="${k.disableSmartPrompt}"`;
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
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
  .lbl { position: absolute; font-size: 11px; color: #1a1a1a; white-space: pre; z-index: 2; }
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
  .ptabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border, #8884); margin-bottom: 0.4rem; }
  .ptab { background: transparent; color: var(--vscode-foreground); border: none; border-bottom: 2px solid transparent; padding: 0.2rem 0.45rem; opacity: 0.75; cursor: pointer; font: inherit; }
  .ptab.selected { opacity: 1; border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder)); }
  .inspector fieldset { min-width: 0; border: 1px solid var(--vscode-panel-border, #8884); border-radius: 3px; margin: 0.5rem 0; padding: 0.2rem 0.5rem 0.4rem; }
  .inspector legend { color: var(--vscode-descriptionForeground); padding: 0 0.3rem; }
  .inspector .pending, .inspector .na { opacity: 0.6; }
  .inspector .row label { margin: 0; color: inherit; }
  .inspector .row input[type=number] { width: 5em; min-width: 0; }
  .inspector .row input.mini { width: 2.6em; min-width: 0; flex: 0 1 auto; }
  .inspector .row select.mini { width: 4em; flex: 0 0 auto; }
  .inspector .row:has(input.mini) label { white-space: nowrap; }
  .inspector .pf .row { margin: 0; }
  .inspector .row.wrap { flex-wrap: wrap; column-gap: 0.9rem; }
  .inspector .indent { margin-left: 1.4rem; }
  .inspector textarea.code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
  .inspector .cols2 { display: grid; grid-template-columns: 1fr 1fr; column-gap: 0.6rem; }
  .inspector .row.wrap > fieldset { flex: 1 1 8rem; }
  .inspector .pf > .row > select { min-width: 0; }
  .inspector .pf .row input[type=text] { flex: 1 1 auto; min-width: 0; }
  .inspector .preview { min-height: 48px; display: flex; align-items: center; justify-content: center; margin: 0.3rem 0; color: var(--vscode-descriptionForeground); }
  .inspector .preview img { max-width: 100%; max-height: 120px; }
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
  function markDirty() { if (!editable) return; relevel(); if (saveBtn) saveBtn.disabled = false; if (status) { status.textContent = 'Unsaved changes'; status.classList.remove('err'); } }
  const n = (el, a) => Number(el.dataset[a]);
  const setN = (el, a, v) => { el.dataset[a] = String(Math.round(v)); };
  // Scroll levels, as App Designer assigns them (src/model/pageLevels.ts, lv01-lv17): in tab order, a Scroll Bar / Grid /
  // Scroll Area / Analytic Grid keeps its own Occurs Level and a Horizontal Rule with Set to Level its choice; every other
  // control takes the running level. Where a control sits on the page plays no part -- only its place in the tab order.
  const SCROLL_TYPES = [10, 19, 27, 32];
  const setsLevel = (el) => SCROLL_TYPES.includes(n(el, 'ftype')) || (n(el, 'ftype') === 23 && (n(el, 'fu') & 2) !== 0);
  // The tab order the save will write: the stored controls in the Order tab's order, then each added control where App
  // Designer puts one -- after the control before it in reading order (pageWriter newControlTabIndex) -- and each pasted
  // copy of a control on this page right after its source and its earlier copies (others last).
  function tabOrder() {
    const order = grid ? [...grid.rows].map((tr) => controlById(tr.dataset.id)).filter((c) => c && !c.dataset.removed) : [];
    const sameRow = (a, b) => Math.abs(n(a, 'ft') - n(b, 'ft')) <= 20;
    const atOrBefore = (a, b) => (sameRow(a, b) ? n(a, 'fl') <= n(b, 'fl') : n(a, 'ft') < n(b, 'ft'));
    const before = (a, b) => (sameRow(a, b) ? n(a, 'fl') < n(b, 'fl') : n(a, 'ft') < n(b, 'ft'));
    for (const c of canvas.querySelectorAll('.ctl')) {
      if (c.dataset.removed || !(c.dataset.new || c.dataset.copyPage)) continue;
      if (c.dataset.new && c.dataset.into) {
        // A grid's new column: after the grid and its columns (pageWriter planPageSave).
        let at = order.findIndex((o) => o.dataset.id === c.dataset.into);
        if (at >= 0) { while (at + 1 < order.length && (order[at + 1].dataset.incol === c.dataset.into || order[at + 1].dataset.into === c.dataset.into)) at++; order.splice(at + 1, 0, c); continue; }
      }
      if (c.dataset.new && SCROLL_TYPES.includes(n(c, 'ftype'))) {
        // A new scroll: after the last control whose top is at or above its bottom edge (pageWriter newScrollTabIndex).
        const bottom = Math.max(n(c, 'fb'), n(c, 'ft'));
        let last = -1;
        order.forEach((o, i) => { if (n(o, 'ft') <= bottom) last = i; });
        order.splice(last + 1, 0, c); continue;
      }
      if (c.dataset.new) {
        let best = -1;
        order.forEach((o, i) => { if (atOrBefore(o, c) && (best < 0 || before(order[best], o))) best = i; });
        order.splice(best + 1, 0, c); continue;
      }
      const src = c.dataset.copyPage === pageName ? c.dataset.copyId : undefined;
      let at = src === undefined ? -1 : order.findIndex((o) => !o.dataset.new && !o.dataset.copyPage && o.dataset.id === src);
      if (at < 0) { order.push(c); continue; }
      while (at + 1 < order.length && order[at + 1].dataset.copyId === src && order[at + 1].dataset.copyPage) at++;
      order.splice(at + 1, 0, c);
    }
    return order;
  }
  // Every control's level again, as the save will write it; the Order tab's Lvl column follows.
  function relevel() {
    let level = 0;
    for (const c of tabOrder()) {
      if (setsLevel(c)) level = n(c, 'level') || 0; else c.dataset.level = String(level);
      const tr = grid && !c.dataset.new && !c.dataset.copyPage ? grid.querySelector('tr[data-id="' + c.dataset.id + '"]') : null;
      if (tr) tr.children[2].textContent = c.dataset.level;
    }
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
    // onFieldInfo: tabs told of the bound field's prompt table / format family (an Edit Box's Record tab looks it up).
    return { el, d, mk, field, check, group, text, select, radio, styleSelect, styleClasses, useBit, tmpBit, t2Bit, onFieldInfo: [] };
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
  // Label tab: the label's Type and Text (or a Message Catalog set/number), Style and Adjust Layout for Hidden Fields.
  // (Static Text and Static Image have App Designer's own Label tabs below.)
  function labelTab(ctx, p) {
    const { el, d, field, group, text, select } = ctx;
    const types = [['0', 'None'], ['1', 'Text'], ['2', 'RFT Short'], ['3', 'RFT Long'], ['7', 'Message Catalog']];
    const lt = field(p, 'Type', select(types, d.lt));
    const txt = field(p, 'Text', text(d.lx));
    txt.oninput = () => { d.lx = txt.value; syncLabel(el); markDirty(); };
    const ms = field(p, 'Message Set', text(d.gms && d.gms !== '0' ? d.gms : '')); ms.type = 'number';
    const mn = field(p, 'Message Number', text(d.gmn && d.gmn !== '0' ? d.gmn : '')); mn.type = 'number';
    ms.oninput = () => { d.gms = String(Number(ms.value) || 0); markDirty(); };
    mn.oninput = () => { d.gmn = String(Number(mn.value) || 0); markDirty(); };
    const disp = group(p, 'Display Options');
    ctx.styleSelect(disp);
    const adj = ctx.check(disp, 'Adjust Layout for Hidden Fields', n(el, 'adj') !== 0); adj.onchange = () => { setN(el, 'adj', adj.checked ? 1 : 0); markDirty(); };
    const refresh = () => { const msgCat = lt.value === '7'; const txtOn = lt.value !== '0' && lt.value !== '6'; ms.closest('.pf').hidden = !msgCat; mn.closest('.pf').hidden = !msgCat; txt.closest('.pf').hidden = !txtOn; };
    lt.onchange = () => { d.lt = lt.value; refresh(); markDirty(); };
    refresh();
  }
  // Static Text's Label tab, laid out as App Designer's (st01-st10): Label Text -- Text (LBLTYPE 1) or Message
  // Catalog (LBLTYPE 7), the text with Insert Line Feed, Message Set/Number (GRDLBLMSGSET/GRDLBLMSGNUM) shown as
  // its Text or Explanation (DSPLFORMAT 0x40000000), Style -- then Alignment Left / Centered (0x2) / Right (0x4).
  function staticTextLabelTab(ctx, p) {
    const { el, d, mk, group, radio } = ctx;
    const lt = group(p, 'Label Text');
    radio(lt, 'stlt' + d.id, [['1', 'Text'], ['7', 'Message Catalog']], d.lt === '7' ? '7' : '1', (v) => { d.lt = v; refresh(); markDirty(); });
    // A textarea, not an input: App Designer's line feeds are part of the text and an input would drop them.
    const txt = ctx.field(lt, 'Text', Object.assign(document.createElement('textarea'), { value: d.lx || '', rows: 1 }));
    const fit = () => { txt.rows = Math.max(1, txt.value.split('\\n').length); };
    // Insert Line Feed stores a bare LF (st11). A textarea reads every break back as LF; a label stored with CRLF keeps CRLF.
    const crlf = (d.lx || '').includes('\\r\\n');
    txt.oninput = () => { d.lx = crlf ? txt.value.replace(/\\n/g, '\\r\\n') : txt.value; fit(); syncLabel(el); markDirty(); };
    fit();
    const lf = tn('button', 'Insert Line Feed'); lf.className = 'action'; lt.appendChild(lf);
    lf.onclick = () => { const a = txt.selectionStart, b = txt.selectionEnd; txt.setRangeText('\\n', a, b, 'end'); txt.oninput(); txt.focus(); };
    const msg = mk('<div class="pf"><label>Message Set/Number</label><div class="row"></div></div>'); lt.appendChild(msg);
    const num = (v) => { const i = ctx.text(v && v !== '0' ? v : ''); i.type = 'number'; i.min = '0'; msg.lastChild.appendChild(i); return i; };
    const ms = num(d.gms), mn = num(d.gmn);
    ms.oninput = () => { d.gms = String(Number(ms.value) || 0); markDirty(); };
    mn.oninput = () => { d.gmn = String(Number(mn.value) || 0); markDirty(); };
    const exp = (n(el, 'dspl') & 0x40000000) !== 0;
    radio(lt, 'stmx' + d.id, [['text', 'Text'], ['exp', 'Explanation']], exp ? 'exp' : 'text', (v) => { const x = n(el, 'dspl') & ~0x40000000; setN(el, 'dspl', v === 'exp' ? x | 0x40000000 : x); markDirty(); });
    const mx = lt.lastElementChild;
    ctx.styleSelect(lt);
    const al = group(p, 'Alignment');
    for (const [v, label] of [['0', 'Left'], ['2', 'Centered'], ['4', 'Right']]) radio(al, 'stal' + d.id, [[v, label]], String(n(el, 'dspl') & 0x6), () => { setN(el, 'dspl', (n(el, 'dspl') & ~0x6) | Number(v)); markDirty(); });
    // Text or Message Catalog greys out the other's inputs, as App Designer does.
    function refresh() {
      const cat = d.lt === '7';
      const dim = (row, off) => { row.classList.toggle('na', off || !editable); for (const c of row.querySelectorAll('input, textarea, button')) c.disabled = off || !editable; };
      dim(txt.closest('.pf'), cat); lf.disabled = cat || !editable; dim(msg, !cat); dim(mx, !cat);
    }
    refresh();
  }
  // Static Text's Use tab: Multi-Currency Field (FIELDUSE 0x20) and Paragraph (FIELDUSETEMP2 0x800).
  function staticTextUseTab(ctx, p) {
    const { el, check } = ctx;
    const mc = check(p, 'Multi-Currency Field', (n(el, 'fu') & 0x20) !== 0); mc.onchange = () => ctx.useBit(0x20, mc.checked);
    const para = check(p, 'Paragraph', (n(el, 'fut2') & 0x800) !== 0); para.onchange = () => ctx.t2Bit(0x800, para.checked);
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
  // FIELDUSETEMP2 bits -- the same set the Frame panel maps (fr08-fr20), shared by every control type. A Group Box's
  // has Container Properties in place of Label Rendering and Control Structure (groupBoxFluid).
  function fluidTab(ctx, fl, opts) {
    opts = opts || {};
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
    const supc = off(check(app, opts.suppressLabel || 'Suppress System-Supplied Style Classes', (n(el, 'fut') & 0x400000) !== 0)); supc.onchange = () => ctx.tmpBit(0x400000, supc.checked);
    const sup = group(fl, 'Suppress On Form Factor');
    for (const row of [['Small', (n(el, 'fut') & 0x40000000) !== 0, (v) => ctx.tmpBit(0x40000000, v)], ['Medium', (n(el, 'fut2') & 0x10) !== 0, (v) => ctx.t2Bit(0x10, v)], ['Large', (n(el, 'fut') & 0x20000000) !== 0, (v) => ctx.tmpBit(0x20000000, v)], ['Extra Large', (n(el, 'fut2') & 0x80) !== 0, (v) => ctx.t2Bit(0x80, v)]]) { const c = off(check(sup, row[0], row[1])); c.onchange = () => row[2](c.checked); }
    if (opts.groupBox) { groupBoxFluid(ctx, fl, off); return; }
    const radio = (parent, name, options, current, set) => { const row = ctx.mk('<div class="row"></div>'); for (const o of options) { const r = Object.assign(document.createElement('input'), { type: 'radio', name, value: o[0], checked: o[0] === current }); r.onchange = () => set(o[0]); if (!fluidOn) r.disabled = true; row.append(r, tn('label', o[1])); } parent.appendChild(row); if (!fluidOn) { row.classList.add('na'); row.title = 'App Designer offers these on a Fluid page'; } };
    const lr = group(fl, 'Label Rendering');
    radio(lr, 'lr' + d.id, [['before', 'Before Control'], ['after', 'After Control']], (n(el, 'fut') & 0x2000000) ? 'after' : 'before', (v) => ctx.tmpBit(0x2000000, v === 'after'));
    const lig = off(check(lr, 'Include Labels in Grid Cells', (n(el, 'fut2') & 0x02) !== 0)); lig.onchange = () => ctx.t2Bit(0x02, lig.checked);
    radio(group(fl, 'Control Structure'), 'cs' + d.id, [['basic', 'Basic'], ['advanced', 'Advanced']], (n(el, 'fut') & 0x4000000) ? 'basic' : 'advanced', (v) => ctx.tmpBit(0x4000000, v === 'basic'));
    if (opts.placeholder) placeholderGroup(ctx, fl, off);
    if (opts.inputType) inputGroup(ctx, fl, off);
  }
  // A Group Box's Fluid Container Properties (gb01-gb04, gb21-gb27): Group Box Type (GRPBOXTYPE, its list index),
  // Html Tag Type (GRPBOXHTMLTYPE), ScrollBars (SCROLLBARS), the Header Extension (PTGBRELTXTINFO / PTGBRELACTINFO /
  // PTGBRELACTFLD: a "Group Box Header Extension" group box's FIELDNUM - 1, -1 none; offered on a Default group box),
  // Draggable / Droppable (FIELDUSETMP 0x800000 / 0x1000000), Gestures / Capture Trigger / Scroll Sizing by Style
  // (FIELDUSETEMP2 0x40 / 0x8000 / 0x8).
  const GROUP_BOX_TYPES = ['Default', 'Container', 'Accordion Vertical', 'Accordion Horizontal', 'Accordion GroupBox', 'Layout Only', 'Panel Control',
    'Custom Header Left', 'Custom Header Right', 'Custom Header Middle', 'Custom Header Bottom', 'Page Title', 'Related Field Group', 'Toggle Container',
    'Custom Grid Header', 'Custom Action Menu', 'Popup', 'Custom Header Search', 'Page Tab', 'Master/Detail Target', 'Search Action', 'Related Content',
    'Menu', 'Menu Item', 'Tab Set', 'Tab Item', 'Group Box Header Extension'];
  const GROUP_BOX_HEADER_EXTENSION = 26;
  function groupBoxFluid(ctx, fl, off) {
    const { el, group, select, check, mk } = ctx;
    const fluidOn = !!pageProps.fluidPage && editable;
    const listed = (names) => names.map((x, i) => [String(i), x]);
    const cont = group(fl, 'Container Properties');
    const gbt = off(ctx.field(cont, 'Group Box Type', select(listed(GROUP_BOX_TYPES), String(n(el, 'gbt')))));
    const tag = off(ctx.field(cont, 'Html Tag Type', select(listed(['Default', 'DIV', 'Section', 'Article', 'UL', 'OL', 'LI']), String(n(el, 'gbh')))));
    const sb = off(ctx.field(cont, 'ScrollBars', select(listed(['None', 'Vertical', 'Horizontal', 'Both', 'Carousel']), String(n(el, 'sb')))));
    tag.onchange = () => { setN(el, 'gbh', Number(tag.value)); markDirty(); };
    sb.onchange = () => { setN(el, 'sb', Number(sb.value)); markDirty(); };
    // The Header Extension lists: this page's "Group Box Header Extension" group boxes, as "tab order | label".
    const hdr = group(cont, 'Group Box Header Extension');
    const extensions = [...document.querySelectorAll('.ctl[data-ftype="2"]')]
      .filter((c) => c !== el && !c.dataset.removed && c.dataset.gbt === String(GROUP_BOX_HEADER_EXTENSION))
      .map((c) => [String(Number(c.dataset.num) - 1), c.dataset.num + ' | ' + (c.dataset.lx || '').trim()]);
    const pickers = [['Textual Info', 'hti'], ['Actionable Info', 'hai'], ['Action Items', 'hac']].map(([label, key]) => {
      const v = String(n(el, key)), known = extensions.some((x) => x[0] === v);
      const s = ctx.field(hdr, label, select([['-1', '0 | None'], ...extensions], known ? v : '-1'));
      s.onchange = () => { setN(el, key, Number(s.value)); markDirty(); };
      return s;
    });
    // Offered on a Default group box only (App Designer greys them for any other type).
    const hdrOn = () => {
      const on = fluidOn && n(el, 'gbt') === 0;
      for (const s of pickers) { s.disabled = !on; s.closest('.pf').classList.toggle('na', !on); }
    };
    gbt.onchange = () => { setN(el, 'gbt', Number(gbt.value)); markDirty(); hdrOn(); };
    hdrOn();
    const flags = mk('<div class="row wrap"></div>'); cont.appendChild(flags);
    for (const [label, reg, bit] of [['Draggable', 'fut', 0x800000], ['Droppable', 'fut', 0x1000000], ['Gestures', 'fut2', 0x40], ['Capture Trigger', 'fut2', 0x8000]]) {
      const c = off(check(flags, label, (n(el, reg) & bit) !== 0));
      c.onchange = () => (reg === 'fut' ? ctx.tmpBit(bit, c.checked) : ctx.t2Bit(bit, c.checked));
    }
    const sizing = off(check(fl, 'Scroll Sizing by Style', (n(el, 'fut2') & 0x8) !== 0)); sizing.onchange = () => ctx.t2Bit(0x8, sizing.checked);
  }
  // A Group Box's Record tab: Record Name / Field Name. Binding a field makes the label its default RFT Long label (gb16).
  function groupBoxRecordTab(ctx, p) {
    const { el, d, field, group, text } = ctx;
    const f = group(p, 'Field');
    const rec = field(f, 'Record Name', text(d.rec || '')), fld = field(f, 'Field Name', text(d.field || ''));
    rec.oninput = () => { d.rec = rec.value.trim().toUpperCase(); markDirty(); };
    fld.onchange = () => {
      d.field = fld.value.trim().toUpperCase(); fld.value = d.field; markDirty();
      if (!d.field) return;
      lookup({ what: 'fieldLabels', field: d.field }).then((labels) => {
        const def = (labels || []).find((l) => l.isDefault) || (labels || [])[0];
        if (!def) return;
        d.lt = '3'; d.lid = def.labelId; d.udl = '1'; d.lx = def.longName; syncLabel(el); markDirty();
      });
    };
  }
  // A Group Box's Label tab, laid out as App Designer's (gb07-gb17). Type: Text / RFT Short / RFT Long / Message Catalog
  // (LBLTYPE 1 / 2 / 3 / 7; RFT needs a bound field). Label Text: the Text (LBLTEXT; an RFT label stores the label's short
  // or long name), Label ID (LABEL_ID; *** Use Default Label *** = USEDEFAULTLABEL 1), Context (shown only), Message
  // Set/Number (GRDLBLMSGSET / GRDLBLMSGNUM), Label Style (LABELSTYLE), Embedded Popup Help (Message Catalog Popup =
  // FIELDUSETMP 0xA000 with PSPNLFIELDEXT MESSAGE_SET_NBR / MESSAGE_NBR). Alignment: DSPLFORMAT Left 0x80000 / Centered
  // 0x100000 / Right 0x200000. Display Options: Body Style (FIELDSTYLE), Adjust Layout for Hidden Fields
  // (PTADJHIDDENFIELDS), Hide Border (FIELDUSE 0x4000000), Suppress Accessible Label (FIELDUSE 0x2000).
  function groupBoxLabelTab(ctx, p) {
    const { el, d, mk, field, group, text, select, radio, check } = ctx;
    const mini = (v) => { const i = text(v && v !== '0' ? v : ''); i.className = 'mini'; return i; };
    const pair = (parent, label) => { const row = mk('<div class="pf"><label></label><div class="row"></div></div>'); row.firstChild.textContent = label; parent.appendChild(row); return row; };
    const dim = (row, off) => { row.classList.toggle('na', off); for (const c of row.querySelectorAll('input, select, button')) c.disabled = off || !editable; };
    let labels = [];
    const ty = group(p, 'Type');
    radio(ty, 'gblt' + d.id, [['1', 'Text'], ['2', 'RFT Short'], ['3', 'RFT Long'], ['7', 'Message Catalog']], d.lt, (v) => setType(v));
    ty.lastElementChild.classList.add('wrap');
    const lt = group(p, 'Label Text');
    const txt = field(lt, 'Text', text(d.lx));
    txt.oninput = () => { d.lx = txt.value; syncLabel(el); markDirty(); };
    const lid = field(lt, 'Label ID', select([['', '*** Use Default Label ***']], ''));
    const ctxt = field(lt, 'Context', text('')); ctxt.readOnly = true; ctxt.title = 'Shown by App Designer; not stored on the page';
    const msg = pair(lt, 'Message Set/Number');
    const ms = mini(d.gms), mn = mini(d.gmn); msg.lastChild.append(ms, mn);
    ms.oninput = () => { d.gms = String(Number(ms.value) || 0); markDirty(); };
    mn.oninput = () => { d.gmn = String(Number(mn.value) || 0); markDirty(); };
    const ls = field(lt, 'Label Style', select([['', STYLE_DEFAULT], ...ctx.styleClasses], (d.lsty || '').trim()));
    ls.onchange = () => { d.lsty = ls.value.trim().toUpperCase(); markDirty(); };
    // Embedded Popup Help.
    const pop = group(lt, 'Embedded Popup Help');
    const popOn = (n(el, 'fut') & 0xA000) === 0xA000;
    radio(pop, 'gbpop' + d.id, [['none', 'No Popup']], popOn ? 'cat' : 'none', () => setPopup(false));
    radio(pop, 'gbpop' + d.id, [['cat', 'Message Catalog Popup']], popOn ? 'cat' : 'none', () => setPopup(true));
    const pmsg = pair(pop, 'Message Set/Number');
    const pms = mini(d.pms), pmn = mini(d.pmn); pmsg.lastChild.append(pms, pmn);
    const ptxt = field(pop, 'Text', text('')); ptxt.readOnly = true;
    let popSeq = 0;
    const popText = () => {
      const set = Number(pms.value) || 0, num = Number(pmn.value) || 0, seq = ++popSeq;
      ptxt.value = '';
      if (set && num) lookup({ what: 'message', set, num }).then((t) => { if (seq === popSeq) ptxt.value = t || ''; });
    };
    pms.oninput = () => { setN(el, 'pms', Number(pms.value) || 0); markDirty(); popText(); };
    pmn.oninput = () => { setN(el, 'pmn', Number(pmn.value) || 0); markDirty(); popText(); };
    // No Popup clears the set / number with the bits (gb13).
    function setPopup(on) {
      const t = n(el, 'fut'); setN(el, 'fut', on ? t | 0xA000 : t & ~0xA000);
      if (!on) { setN(el, 'pms', 0); setN(el, 'pmn', 0); pms.value = pmn.value = ''; ptxt.value = ''; }
      dim(pmsg, !on); markDirty();
    }
    dim(pmsg, !popOn);
    if (popOn) popText();
    // Alignment.
    const al = group(p, 'Alignment');
    const ALIGN = { left: 0x80000, centered: 0x100000, right: 0x200000 };
    const curAlign = (n(el, 'dspl') & ALIGN.right) ? 'right' : (n(el, 'dspl') & ALIGN.centered) ? 'centered' : 'left';
    radio(al, 'gbal' + d.id, [['left', 'Left'], ['centered', 'Centered'], ['right', 'Right']], curAlign, (v) => { setN(el, 'dspl', (n(el, 'dspl') & ~0x380000) | ALIGN[v]); markDirty(); });
    // Display Options.
    const disp = group(p, 'Display Options');
    ctx.styleSelect(disp, 'Body Style');
    const adj = check(disp, 'Adjust Layout for Hidden Fields', n(el, 'adj') !== 0); adj.onchange = () => { setN(el, 'adj', adj.checked ? 1 : 0); markDirty(); };
    const flags = mk('<div class="row wrap"></div>'); disp.appendChild(flags);
    const hide = check(flags, 'Hide Border', (n(el, 'fu') & 0x4000000) !== 0); hide.onchange = () => ctx.useBit(0x4000000, hide.checked);
    const acc = check(flags, 'Suppress Accessible Label', (n(el, 'fu') & 0x2000) !== 0); acc.onchange = () => ctx.useBit(0x2000, acc.checked);

    // An RFT label shows the chosen label's short or long name (delivered RFT labels store exactly that).
    const chosen = () => {
      const def = labels.find((x) => x.isDefault) || labels[0];
      const id = d.udl === '1' ? (def ? def.labelId : '') : (d.lid || '').trim();
      return labels.find((l) => l.labelId === id);
    };
    const rftText = () => {
      const l = chosen();
      if (l && (d.lt === '2' || d.lt === '3')) { d.lx = d.lt === '2' ? l.shortName : l.longName; txt.value = d.lx; syncLabel(el); }
    };
    lid.onchange = () => {
      if (lid.value) { d.udl = '0'; d.lid = lid.value; }
      else { d.udl = '1'; const def = labels.find((x) => x.isDefault) || labels[0]; if (def) d.lid = def.labelId; }
      rftText(); markDirty();
    };
    function setType(v) {
      d.lt = v;
      if (v === '7') { d.lx = ' '; syncLabel(el); } // Message Catalog blanks the text (gb14)
      rftText(); refresh(); markDirty();
    }
    function refresh() {
      const bound = !!(d.field || '').trim(), rft = d.lt === '2' || d.lt === '3', cat = d.lt === '7';
      for (const r of ty.querySelectorAll('input[type=radio]')) if (r.value === '2' || r.value === '3') { r.disabled = !bound || !editable; r.nextElementSibling.classList.toggle('na', !bound); }
      dim(txt.closest('.pf'), d.lt !== '1'); dim(lid.closest('.pf'), !rft); dim(msg, !cat);
      txt.value = cat ? '' : (d.lx || '').trim();
    }
    refresh();
    if ((d.field || '').trim()) lookup({ what: 'fieldLabels', field: d.field }).then((list) => {
      labels = list || [];
      for (const l of labels) lid.appendChild(Object.assign(document.createElement('option'), { value: l.labelId, textContent: l.labelId + ' "' + l.longName + '"' }));
      lid.value = d.udl === '1' ? '' : (d.lid || '').trim();
    });
  }
  // A Group Box's Use tab (gb18-gb20): Multi-Currency Field (FIELDUSE 0x20); Display Options: Hide all Fields when Group
  // Box Hidden (PTHIDEFIELDS), Collapsible Data Area (PTCOLLAPSEDATAAREA) with Default Initial View to Expanded State
  // (PTDFLTVIEWEXPANDED) and the collapsed / expanded label images (PTLBLIMGCOLLAPSE / PTLBLIMGEXPAND; blank = default).
  function groupBoxUseTab(ctx, p) {
    const { el, d, mk, group, check, text } = ctx;
    const mc = check(p, 'Multi-Currency Field', (n(el, 'fu') & 0x20) !== 0); mc.onchange = () => ctx.useBit(0x20, mc.checked);
    const disp = group(p, 'Display Options');
    const flag = (label, key) => { const c = check(disp, label, n(el, key) !== 0); c.onchange = () => { setN(el, key, c.checked ? 1 : 0); markDirty(); }; return c; };
    flag('Hide all Fields when Group Box Hidden', 'hf');
    const coll = flag('Collapsible Data Area', 'cda');
    const sub = mk('<div class="indent"></div>'); disp.appendChild(sub);
    const exp = check(sub, 'Default Initial View to Expanded State', n(el, 'dve') !== 0); exp.onchange = () => { setN(el, 'dve', exp.checked ? 1 : 0); markDirty(); };
    const image = (label, key) => {
      const row = mk('<div class="pf"><label></label><div class="row"></div></div>'); row.firstChild.textContent = label; sub.appendChild(row);
      const inp = text((d[key] || '').trim(), 30); inp.placeholder = '*** Use Default Image ***';
      const browse = tn('button', '...'); browse.className = 'action'; browse.title = 'Select Image';
      row.lastChild.append(inp, browse);
      const pic = mk('<div class="preview"></div>'); sub.appendChild(pic);
      let seq = 0;
      const show = () => {
        const name = (d[key] || '').trim(), s = ++seq;
        pic.replaceChildren();
        if (name) lookup({ what: 'image', name }).then((r) => { if (s === seq && r && r.dataUri) pic.replaceChildren(Object.assign(document.createElement('img'), { src: r.dataUri, alt: name })); });
      };
      const set = (v) => { d[key] = v.trim().toUpperCase(); inp.value = d[key]; markDirty(); show(); };
      inp.onchange = () => set(inp.value);
      browse.onclick = () => lookup({ what: 'pickImage', current: (d[key] || '').trim() }).then((v) => { if (v) set(v); });
      show();
    };
    image('Label Image for Collapsed State', 'imc');
    image('Label Image for Expanded State', 'ime');
    // The collapsible settings are offered once Collapsible Data Area is on.
    const refresh = () => {
      for (const c of sub.querySelectorAll('input, button')) c.disabled = !coll.checked || !editable;
      sub.classList.toggle('na', !coll.checked);
    };
    coll.addEventListener('change', refresh);
    refresh();
  }
  // A Horizontal Rule's tabs, as App Designer's (hr01-hr07). Label: Text (LBLTEXT; LBLTYPE stays 0) and Style
  // (FIELDSTYLE). Use: Multi-Currency Field (FIELDUSE 0x20) and Set to Level (FIELDUSE 0x2 with SECUREINVISIBLE 1),
  // whose level is the rule's OCCURSLEVEL, from 0 to the scroll level where it sits.
  function ruleLabelTab(ctx, p) {
    const { el, d, field, text } = ctx;
    const txt = field(p, 'Text', text((d.lx || '').trim()));
    txt.oninput = () => { d.lx = txt.value; syncLabel(el); markDirty(); };
    ctx.styleSelect(p);
  }
  function ruleUseTab(ctx, p) {
    const { el, d, mk, check, select } = ctx;
    const mc = check(p, 'Multi-Currency Field', (n(el, 'fu') & 0x20) !== 0); mc.onchange = () => ctx.useBit(0x20, mc.checked);
    const row = mk('<div class="row"></div>'); p.appendChild(row);
    const set = check(row, 'Set to Level', (n(el, 'fu') & 0x2) !== 0);
    // The levels offered: 0 up to one below the page's deepest scroll (lv06, lv08: 0 and 1 under a level-2 scroll bar).
    const deepest = Math.max(1, ...[...canvas.querySelectorAll('.ctl')].filter((c) => !c.dataset.removed && SCROLL_TYPES.includes(n(c, 'ftype'))).map((c) => n(c, 'level') || 0));
    const shown = set.checked ? String(n(el, 'level') || 0) : '0';
    const lvl = select(Array.from({ length: Math.max(deepest, Number(shown) + 1) }, (_, i) => [String(i), String(i)]), shown);
    lvl.className = 'mini'; row.appendChild(lvl);
    const refresh = () => { lvl.disabled = !set.checked || !editable; };
    // Set to Level starts at 0 (lv12) and stores its choice in PT_NUMFLD1 too; cleared, the rule takes the running
    // level and PT_NUMFLD1 keeps the last choice (lv11).
    const choose = (v) => { d.level = v; setN(el, 'n1', Number(v)); d.lvlEdited = '1'; };
    set.onchange = () => {
      if (set.checked) { lvl.value = '0'; choose('0'); }
      setN(el, 'si', set.checked ? 1 : 0); ctx.useBit(0x2, set.checked);
      refresh();
    };
    lvl.onchange = () => { choose(lvl.value); markDirty(); };
    refresh();
  }
  // A Check Box's Record tab (cbx, in03): Field (Record Name / Field Name) and Field Values (On / Off Value).
  function checkBoxRecordTab(ctx, p) {
    const { d, field, group, text } = ctx;
    const f = group(p, 'Field');
    const rec = field(f, 'Record Name', text(d.rec || '')), fld = field(f, 'Field Name', text(d.field || ''));
    const upd = () => { d.rec = rec.value.trim().toUpperCase(); d.field = fld.value.trim().toUpperCase(); markDirty(); };
    rec.oninput = upd; fld.oninput = upd;
    const v = group(p, 'Field Values');
    const on = field(v, 'On Value', text(d.onv || '')), off = field(v, 'Off Value', text(d.offv || ''));
    on.oninput = () => { d.onv = on.value; markDirty(); };
    off.oninput = () => { d.offv = off.value; markDirty(); };
  }
  // A record-bound control's Label tab (cbx02-cbx05): Type None / Text / RFT Short / RFT Long (LBLTYPE 0-3; an RFT label
  // stores the label's short or long name, cbx05), Label ID (LABEL_ID; *** Use Default Label *** = USEDEFAULTLABEL 1),
  // Context (shown only), Style (FIELDSTYLE), Location Left / Right (LBLLOC 0 / 1), Alignment Left / Centered / Right
  // (DSPLFORMAT 0x80000 / 0x100000 / 0x200000).
  // A Long Edit Box's and an Edit Box's (opts.longEdit, le05-le11, eb32-eb37) differ: Insert Line Feed, Style is the label's (LABELSTYLE), Position
  // Left / Top / Custom (LABELSIZETYPE 0 / 2 / 1; App Designer lays the label out again from its text) in place of Location,
  // and Display Options First occurs only (DSPLFORMAT 0x400000) and No colon (LBLLOC 1).
  function fieldLabelTab(ctx, p, opts) {
    opts = opts || {};
    const { el, d, mk, field, group, text, select, radio } = ctx;
    let labels = [];
    const ty = group(p, 'Type');
    radio(ty, 'cblt' + d.id, [['0', 'None'], ['1', 'Text'], ['2', 'RFT Short'], ['3', 'RFT Long']], d.lt, (v) => setType(v));
    ty.lastElementChild.classList.add('wrap');
    const lt = group(p, 'Label Text');
    // A label with line feeds keeps them (a textarea; Insert Line Feed adds a bare LF, le11).
    const txt = field(lt, 'Text', opts.longEdit ? Object.assign(document.createElement('textarea'), { rows: 1, value: (d.lx || '').trim() }) : text((d.lx || '').trim()));
    txt.oninput = () => { d.lx = txt.value; if (opts.longEdit) txt.rows = Math.max(1, txt.value.split('\\n').length); syncLabel(el); markDirty(); };
    const lid = field(lt, 'Label ID', select([['', '*** Use Default Label ***']], ''));
    const ctxt = field(lt, 'Context', text('')); ctxt.readOnly = true; ctxt.title = 'Shown by App Designer; not stored on the page';
    let lf = null;
    if (opts.longEdit) {
      lf = tn('button', 'Insert Line Feed'); lf.className = 'action'; lt.appendChild(lf);
      lf.onclick = () => { txt.setRangeText('\\n', txt.selectionStart, txt.selectionEnd, 'end'); txt.oninput(); txt.focus(); };
      const ls = field(lt, 'Style', select([['', STYLE_DEFAULT], ...ctx.styleClasses], (d.lsty || '').trim()));
      ls.onchange = () => { d.lsty = ls.value.trim().toUpperCase(); markDirty(); };
    } else ctx.styleSelect(lt);
    const pair = mk('<div class="row wrap"></div>'); p.appendChild(pair);
    const al = group(pair, 'Alignment');
    const ALIGN = { left: 0x80000, centered: 0x100000, right: 0x200000 };
    const cur = (n(el, 'dspl') & ALIGN.right) ? 'right' : (n(el, 'dspl') & ALIGN.centered) ? 'centered' : 'left';
    for (const [k, label] of [['left', 'Left'], ['centered', 'Centered'], ['right', 'Right']]) {
      radio(al, 'cbal' + d.id, [[k, label]], cur, () => { setN(el, 'dspl', (n(el, 'dspl') & ~0x380000) | ALIGN[k]); markDirty(); });
    }
    if (opts.longEdit) {
      const pos = group(pair, 'Position');
      for (const [v, label] of [['0', 'Left'], ['2', 'Top'], ['1', 'Custom']]) radio(pos, 'lepos' + d.id, [[v, label]], String(n(el, 'lst')), () => { setN(el, 'lst', Number(v)); markDirty(); });
      const disp = group(p, 'Display Options');
      const row = mk('<div class="row wrap"></div>'); disp.appendChild(row);
      const first = ctx.check(row, 'First occurs only', (n(el, 'dspl') & 0x400000) !== 0);
      first.onchange = () => { setN(el, 'dspl', first.checked ? n(el, 'dspl') | 0x400000 : n(el, 'dspl') & ~0x400000); markDirty(); };
      const colon = ctx.check(row, 'No colon', n(el, 'lloc') === 1); colon.onchange = () => { setN(el, 'lloc', colon.checked ? 1 : 0); markDirty(); };
    } else {
      const loc = group(pair, 'Location');
      radio(loc, 'cbloc' + d.id, [['0', 'Left']], String(n(el, 'lloc')), () => { setN(el, 'lloc', 0); markDirty(); });
      radio(loc, 'cbloc' + d.id, [['1', 'Right']], String(n(el, 'lloc')), () => { setN(el, 'lloc', 1); markDirty(); });
      pair.insertBefore(loc, al);
    }
    const dim = (row, off) => { row.classList.toggle('na', off); for (const c of row.querySelectorAll('input, select')) c.disabled = off || !editable; };
    // An RFT label shows the chosen label's short or long name.
    const chosen = () => {
      const def = labels.find((x) => x.isDefault) || labels[0];
      const id = d.udl === '1' ? (def ? def.labelId : '') : (d.lid || '').trim();
      return labels.find((l) => l.labelId === id);
    };
    const rftText = () => {
      const l = chosen();
      if (l && (d.lt === '2' || d.lt === '3')) { d.lx = d.lt === '2' ? l.shortName : l.longName; txt.value = d.lx; syncLabel(el); }
    };
    lid.onchange = () => {
      if (lid.value) { d.udl = '0'; d.lid = lid.value; }
      else { d.udl = '1'; const def = labels.find((x) => x.isDefault) || labels[0]; if (def) d.lid = def.labelId; }
      rftText(); markDirty();
    };
    function setType(v) { d.lt = v; rftText(); refresh(); markDirty(); }
    function refresh() {
      const rft = d.lt === '2' || d.lt === '3';
      dim(txt.closest('.pf'), d.lt !== '1'); dim(lid.closest('.pf'), !rft);
      if (lf) lf.disabled = d.lt !== '1' || !editable;
      txt.value = (d.lx || '').trim();
    }
    refresh();
    if ((d.field || '').trim()) lookup({ what: 'fieldLabels', field: d.field }).then((list) => {
      labels = list || [];
      for (const l of labels) lid.appendChild(Object.assign(document.createElement('option'), { value: l.labelId, textContent: l.labelId + ' "' + l.longName + '"' }));
      lid.value = d.udl === '1' ? '' : (d.lid || '').trim();
    });
  }
  // A record-bound control's Use tab (cb-*, cbx06-cbx16). Field Use Options: Display Only (FIELDUSE 0x1), Invisible (0x2,
  // with SECUREINVISIBLE 1 unless Modifiable by JavaScript; off clears both and Generate in HTML), Modifiable by
  // JavaScript and Generate in HTML (FIELDUSETEMP2 0x20; offered on an invisible control), Multi-Currency (0x20), Display
  // Control Field (0x8), Related Field (0x10, which also sets Display Only) with its Related Control Field (ASSOCFIELDNUM:
  // a Display Control Field control's FIELDNUM - 1), Enable When Page is Display Only (0x40000). Popup Menu (POPUPMENU),
  // Allow Deferred Processing (DEFERPROC), Set Component Changed (FIELDUSETMP 0x8 off), Display-Only Appearance (Disabled
  // Edit Control FIELDUSETMP 0x4; Read only control for screen reader FIELDUSETEMP2 0x10000), Wrap Long Words (FIELDUSETMP 0x40).
  // Show Label, the left Enable When Page is Display Only, Smart Prompt, Persist Grid Column in Menu and Field Format
  // Override stay greyed, as App Designer has them on a check box outside a grid.
  // A Long Edit Box's (opts.longEdit, le12-le16): no Show Label / Smart Prompt / Display Control Field / Field Format
  // Override; Expand Field When Display Only (PTLEBEXPANDFIELD), Display in Modal Window (FIELDUSETMP 0x100), Enable Long
  // Edit Counter (FIELDUSETMP 0x8000000) and the screen-reader read-only (FIELDUSETEMP2 0x10000) instead; Wrap Long Words,
  // Persist Grid Column in Menu and Paragraph greyed; no Display-Only Appearance.
  // An Edit Box's (opts.editBox, eb38-eb60, eb80): Show Label (FIELDUSE 0x400) and Enable When Page is Display Only (0x40000)
  // are offered under Invisible (off clears them, eb49); Smart Prompt (PTDISABLESMARTPROM 0, offered when the field has a prompt
  // table); no right-hand Enable When Page is Display Only; and Mouse Over Popup (offered on a Display Only control; off clears
  // it, eb43): No Popup, Page Popup (FIELDUSETMP 0x200 + PTPOPUPPNL, a Popup Page) or Message Catalog Popup (FIELDUSETMP 0x2200
  // + MESSAGE_SET_NBR / MESSAGE_NBR). Its dialog's Wrap Long Words (FIELDUSETMP 0x40) hides a Paragraph (FIELDUSETEMP2 0x800) the
  // dialog never shows; the Paragraph bit is left as stored.
  function fieldUseTab(ctx, p, useOpts) {
    useOpts = useOpts || {};
    const le = !!useOpts.longEdit, eb = !!useOpts.editBox;
    const { el, d, mk, group, check, select, radio } = ctx;
    const bit = (k) => (b) => (n(el, k) & b) !== 0;
    const fu = bit('fu'), fut = bit('fut'), fut2 = bit('fut2');
    const opts = group(p, 'Field Use Options');
    const cols = mk('<div class="cols2"><div></div><div></div></div>'); opts.appendChild(cols);
    const [left, right] = cols.children;
    const greyed = (parent, label) => { const c = check(parent, label, false); c.disabled = true; c.closest('.row').classList.add('na'); return c; };
    const dOnly = check(left, 'Display Only', fu(0x1)); dOnly.onchange = () => ctx.useBit(0x1, dOnly.checked);
    const inv = check(left, 'Invisible', fu(0x2));
    const sub = mk('<div class="indent"></div>'); left.appendChild(sub);
    const showLbl = eb ? check(sub, 'Show Label', fu(0x400)) : null;
    if (showLbl) showLbl.onchange = () => ctx.useBit(0x400, showLbl.checked); else if (!le) greyed(sub, 'Show Label');
    const modjs = check(sub, 'Modifiable by JavaScript', fu(0x2) && n(el, 'si') === 0);
    const ewdoSub = eb ? check(sub, 'Enable When Page is Display Only', fu(0x40000)) : null;
    if (ewdoSub) ewdoSub.onchange = () => ctx.useBit(0x40000, ewdoSub.checked); else greyed(sub, 'Enable When Page is Display Only');
    const html = check(sub, 'Generate in HTML', fut2(0x20));
    const smart = eb ? check(left, 'Smart Prompt', n(el, 'nsp') === 0) : null;
    if (smart) {
      smart.onchange = () => { setN(el, 'nsp', smart.checked ? 0 : 1); markDirty(); };
      const offer = (has) => { smart.disabled = !has || !editable; smart.closest('.row').classList.toggle('na', !has); if (!has) smart.checked = n(el, 'nsp') === 0; };
      offer(false);
      ctx.onFieldInfo.push((info) => offer(!!info.promptTable));
    } else if (!le) greyed(left, 'Smart Prompt');
    const mc = check(right, 'Multi-Currency Field', fu(0x20)); mc.onchange = () => ctx.useBit(0x20, mc.checked);
    if (!le) { const dcf = check(right, 'Display Control Field', fu(0x8)); dcf.onchange = () => ctx.useBit(0x8, dcf.checked); }
    const rel = check(right, 'Related Field', fu(0x10));
    if (le) {
      const exp = check(right, 'Expand Field When Display Only', n(el, 'lex') !== 0); exp.onchange = () => { setN(el, 'lex', exp.checked ? 1 : 0); markDirty(); };
      const modal = check(right, 'Display in Modal Window', fut(0x100)); modal.onchange = () => ctx.tmpBit(0x100, modal.checked);
      const counter = check(right, 'Enable Long Edit Counter', fut(0x8000000)); counter.onchange = () => ctx.tmpBit(0x8000000, counter.checked);
      const sr = check(right, 'Read only control for screen reader', fut2(0x10000)); sr.onchange = () => ctx.t2Bit(0x10000, sr.checked);
      greyed(left, 'Wrap Long Words'); greyed(left, 'Persist Grid Column in Menu'); greyed(right, 'Paragraph');
    } else if (eb) {
      greyed(right, 'Persist Grid Column in Menu'); greyed(right, 'Field Format Override');
    } else {
      greyed(right, 'Persist Grid Column in Menu');
      const ewdo = check(right, 'Enable When Page is Display Only', fu(0x40000)); ewdo.onchange = () => ctx.useBit(0x40000, ewdo.checked);
      greyed(right, 'Field Format Override');
    }
    // Related Control Field: this page's Display Control Field controls, as "tab order | label".
    const controls = [...document.querySelectorAll('.ctl')].filter((c) => c !== el && !c.dataset.removed && (Number(c.dataset.fu) & 0x8))
      .map((c) => [String(Number(c.dataset.num) - 1), c.dataset.num + ' | ' + (c.dataset.lx || c.dataset.field || '').trim()]);
    const cur = String(n(el, 'assoc'));
    const relCtl = ctx.field(p, 'Related Control Field', select([['0', ''], ...controls], controls.some((x) => x[0] === cur) ? cur : '0'));
    relCtl.onchange = () => { setN(el, 'assoc', Number(relCtl.value)); markDirty(); };
    const popup = ctx.field(group(p, 'Popup Menu'), '', select([['', ''], ...(choices ? choices.popupMenus : []).map((m) => [m, m])], (d.pop || '').trim()));
    popup.onchange = () => { d.pop = popup.value; markDirty(); };
    const procRow = mk('<div class="row wrap"></div>'); p.appendChild(procRow);
    const defer = check(procRow, 'Allow Deferred Processing', d.defer !== '0');
    defer.onchange = () => { d.defer = defer.checked ? '1' : '0'; if (selRow) selRow.children[8].textContent = defer.checked ? '✓' : ''; markDirty(); };
    const scc = check(procRow, 'Set Component Changed', !fut(0x8)); scc.onchange = () => ctx.tmpBit(0x8, !scc.checked);
    if (!le) {
      const appear = group(p, 'Display-Only Appearance');
      radio(appear, 'cbdo' + d.id, [['text', 'Text Only'], ['edit', 'Disabled Edit Control']], fut(0x4) ? 'edit' : 'text', (v) => ctx.tmpBit(0x4, v === 'edit'));
      const sr = check(appear, 'Read only control for screen reader', fut2(0x10000)); sr.onchange = () => ctx.t2Bit(0x10000, sr.checked);
      const wrap = check(p, 'Wrap Long Words', fut(0x40)); wrap.onchange = () => ctx.tmpBit(0x40, wrap.checked);
    }
    const mouse = eb ? mouseOverPopup(ctx, p) : null;

    const refresh = () => {
      const invisible = inv.checked;
      if (mouse) mouse.offer(dOnly.checked);
      for (const c of [modjs, html, showLbl, ewdoSub].filter(Boolean)) { c.disabled = !invisible || !editable; c.closest('.row').classList.toggle('na', !invisible); }
      relCtl.disabled = !rel.checked || !editable; relCtl.closest('.pf').classList.toggle('na', !rel.checked);
    };
    inv.onchange = () => {
      ctx.useBit(0x2, inv.checked);
      el.classList.toggle('u-invisible', inv.checked);
      if (inv.checked) setN(el, 'si', modjs.checked ? 0 : 1);
      else {
        setN(el, 'si', 0); modjs.checked = false; html.checked = false; ctx.t2Bit(0x20, false);
        // An Edit Box's Show Label and Enable When Page is Display Only go with it (eb49).
        if (showLbl) { showLbl.checked = false; ewdoSub.checked = false; ctx.useBit(0x400 | 0x40000, false); }
      }
      refresh();
    };
    modjs.onchange = () => { setN(el, 'si', modjs.checked ? 0 : 1); markDirty(); };
    html.onchange = () => ctx.t2Bit(0x20, html.checked);
    // Related Field turns Display Only on with it (cbx13); off leaves Display Only and clears the control field (cbx14).
    rel.onchange = () => {
      ctx.useBit(0x10, rel.checked);
      if (rel.checked) { ctx.useBit(0x1, true); dOnly.checked = true; el.classList.add('u-display-only'); }
      else { setN(el, 'assoc', 0); relCtl.value = '0'; }
      refresh();
    };
    dOnly.addEventListener('change', () => {
      el.classList.toggle('u-display-only', dOnly.checked);
      // Display Only off drops the Mouse Over Popup (eb43).
      if (mouse && !dOnly.checked) mouse.clear();
      refresh();
    });
    refresh();
  }
  // An Edit Box's Mouse Over Popup (eb38-eb43): No Popup / Page Popup (FIELDUSETMP 0x200, PTPOPUPPNL) / Message Catalog Popup
  // (FIELDUSETMP 0x2200, MESSAGE_SET_NBR / MESSAGE_NBR, its text shown). Each choice clears the other's columns (eb40, eb41).
  function mouseOverPopup(ctx, p) {
    const { el, d, mk, group, text, select, radio } = ctx;
    const g = group(p, 'Mouse Over Popup');
    const mode = () => (n(el, 'fut') & 0x2000) ? 'msg' : (n(el, 'fut') & 0x200) ? 'page' : 'none';
    radio(g, 'ebmo' + d.id, [['none', 'No Popup']], mode(), () => set('none'));
    const pageRow = mk('<div class="row"></div>'); g.appendChild(pageRow);
    radio(pageRow, 'ebmo' + d.id, [['page', 'Page Popup']], mode(), () => set('page'));
    const page = select([['', '']], (d.ppg || '').trim()); pageRow.appendChild(page);
    page.onchange = () => { d.ppg = page.value; markDirty(); };
    radio(g, 'ebmo' + d.id, [['msg', 'Message Catalog Popup']], mode(), () => set('msg'));
    const msg = mk('<div class="row"><label>Message Set/Number</label></div>'); g.appendChild(msg);
    const mini = (v) => { const i = text(v && v !== '0' ? v : ''); i.className = 'mini'; return i; };
    const ms = mini(d.pms), mn = mini(d.pmn); msg.append(ms, mn);
    const txt = ctx.field(g, 'Text', text('')); txt.readOnly = true;
    let seq = 0;
    const showText = () => {
      const set = Number(ms.value) || 0, num = Number(mn.value) || 0, s = ++seq;
      txt.value = '';
      if (mode() === 'msg' && set && num) lookup({ what: 'message', set, num }).then((t) => { if (s === seq) txt.value = t || ''; });
    };
    ms.oninput = () => { setN(el, 'pms', Number(ms.value) || 0); markDirty(); showText(); };
    mn.oninput = () => { setN(el, 'pmn', Number(mn.value) || 0); markDirty(); showText(); };
    let offered = false;
    const refresh = () => {
      const m = mode();
      for (const r of g.querySelectorAll('input[type=radio]')) { r.disabled = !offered || !editable; r.checked = r.value === m; }
      page.disabled = !offered || m !== 'page' || !editable;
      ms.disabled = mn.disabled = !offered || m !== 'msg' || !editable;
      g.classList.toggle('na', !offered);
    };
    function set(m) {
      const x = n(el, 'fut') & ~0x2200;
      setN(el, 'fut', m === 'msg' ? x | 0x2200 : m === 'page' ? x | 0x200 : x);
      if (m !== 'page') { d.ppg = ''; page.value = ''; }
      if (m !== 'msg') { setN(el, 'pms', 0); setN(el, 'pmn', 0); ms.value = mn.value = ''; }
      refresh(); showText(); markDirty();
    }
    lookup({ what: 'popupPages' }).then((names) => {
      for (const nme of names || []) if (![...page.options].some((o) => o.value === nme)) page.appendChild(Object.assign(document.createElement('option'), { value: nme, textContent: nme }));
      page.value = (d.ppg || '').trim();
    });
    showText();
    return { offer: (on) => { offered = on; refresh(); }, clear: () => set('none') };
  }
  // An HTML Area's HTML tab (ha01-ha05, ha10). Value: Field (RECNAME / FIELDNAME) or Constant (the HTML in PSPNLHTMLAREA;
  // RECNAME and FIELDNAME blank), HTML Tags Only (FIELDUSETMP 0x100000), Respond Only Once (FIELDUSETEMP2 0x1000).
  // Binding a field fills LABEL_ID and LBLTEXT with its default label and leaves the label type (ha05).
  function htmlAreaTab(ctx, p) {
    const { el, d, mk, field, group, text, radio, check } = ctx;
    const v = group(p, 'Value');
    const top = mk('<div class="row wrap"></div>'); v.appendChild(top);
    radio(top, 'hav' + d.id, [['field', 'Field'], ['const', 'Constant']], d.hc === '1' ? 'const' : 'field', (m) => setMode(m));
    const tags = check(top, 'HTML Tags Only', (n(el, 'fut') & 0x100000) !== 0); tags.onchange = () => ctx.tmpBit(0x100000, tags.checked);
    const rec = field(v, 'Record Name', text(d.rec || '')), fld = field(v, 'Field Name', text(d.field || ''));
    rec.oninput = () => { d.rec = rec.value.trim().toUpperCase(); markDirty(); };
    fld.onchange = () => {
      d.field = fld.value.trim().toUpperCase(); fld.value = d.field; markDirty();
      if (!d.field) return;
      lookup({ what: 'fieldLabels', field: d.field }).then((labels) => {
        const def = (labels || []).find((l) => l.isDefault) || (labels || [])[0];
        if (def) { d.lid = def.labelId; d.lx = def.longName; syncLabel(el); markDirty(); }
      });
    };
    const html = field(v, '', Object.assign(document.createElement('textarea'), { rows: 8, value: d.html || '' }));
    html.className = 'code';
    html.oninput = () => { d.html = html.value; markDirty(); };
    const once = check(v, 'Respond Only Once', (n(el, 'fut2') & 0x1000) !== 0); once.onchange = () => ctx.t2Bit(0x1000, once.checked);
    const refresh = () => {
      const k = d.hc === '1';
      for (const c of [rec, fld]) { c.disabled = k || !editable; c.closest('.pf').classList.toggle('na', k); }
      html.disabled = !k || !editable; html.closest('.pf').classList.toggle('na', !k);
    };
    // Constant blanks the record field (ha03); Field drops the Constant's text (ha05).
    function setMode(m) {
      if (m === 'const') { d.hc = '1'; d.rec = ''; d.field = ''; rec.value = fld.value = ''; d.html = html.value; }
      else { d.hc = '0'; }
      refresh(); markDirty();
    }
    refresh();
  }
  // An HTML Area's Label tab (ha06-ha09): Type None / Text / Message Catalog / RFT Long / RFT Short (LBLTYPE 0 / 1 / 7 / 3
  // / 2), Text (LBLTEXT), Label ID (LABEL_ID, USEDEFAULTLABEL), Context (shown only), Message Set / Msg Number
  // (GRDLBLMSGSET / GRDLBLMSGNUM). Message Catalog blanks LABEL_ID and LBLTEXT (ha06); an RFT type takes the default label
  // when none is set and shows its short or long name (ha07); Text and None keep both (ha08, ha09).
  function htmlLabelTab(ctx, p) {
    const { el, d, mk, field, group, text, select } = ctx;
    let labels = [];
    const g = group(p, 'Label Text');
    const ty = field(g, 'Type', select([['0', 'None'], ['1', 'Text'], ['7', 'Message Catalog'], ['3', 'RFT Long'], ['2', 'RFT Short']], d.lt));
    const txt = field(g, 'Text', text((d.lx || '').trim()));
    txt.oninput = () => { d.lx = txt.value; syncLabel(el); markDirty(); };
    const lid = field(g, 'Label ID', select([['', '*** Use Default Label ***']], ''));
    const ctxt = field(g, 'Context', text('')); ctxt.readOnly = true; ctxt.title = 'Shown by App Designer; not stored on the page';
    const msg = mk('<div class="row"><label>Message Set</label></div>'); g.appendChild(msg);
    const mini = (v) => { const i = text(v && v !== '0' ? v : ''); i.className = 'mini'; return i; };
    const ms = mini(d.gms), mn = mini(d.gmn);
    msg.appendChild(ms); msg.appendChild(tn('label', 'Msg Number')); msg.appendChild(mn);
    let seq = 0;
    const catText = () => {
      const set = Number(ms.value) || 0, num = Number(mn.value) || 0, s = ++seq;
      if (d.lt === '7' && set && num) lookup({ what: 'message', set, num }).then((t) => { if (s === seq && d.lt === '7') txt.value = t || ''; });
    };
    ms.oninput = () => { d.gms = String(Number(ms.value) || 0); markDirty(); catText(); };
    mn.oninput = () => { d.gmn = String(Number(mn.value) || 0); markDirty(); catText(); };
    const def = () => labels.find((x) => x.isDefault) || labels[0];
    const chosen = () => labels.find((l) => l.labelId === (d.udl === '1' && def() ? def().labelId : (d.lid || '').trim()));
    const rftText = () => { const l = chosen(); if (l && (d.lt === '2' || d.lt === '3')) { d.lx = d.lt === '2' ? l.shortName : l.longName; syncLabel(el); } };
    const dim = (c, off) => { c.disabled = off || !editable; c.closest('.pf, .row').classList.toggle('na', off); };
    const refresh = () => {
      const cat = d.lt === '7', rft = d.lt === '2' || d.lt === '3';
      dim(txt, d.lt !== '1'); dim(lid, !rft); dim(ms, !cat); mn.disabled = !cat || !editable;
      txt.value = cat ? '' : (d.lx || '').trim();
      if (cat) catText();
    };
    ty.onchange = () => {
      d.lt = ty.value;
      if (d.lt === '7') { d.lid = ''; d.lx = ' '; syncLabel(el); }
      else if ((d.lt === '2' || d.lt === '3') && !(d.lid || '').trim() && def()) { d.lid = def().labelId; d.udl = '1'; }
      rftText(); refresh(); markDirty();
    };
    lid.onchange = () => {
      if (lid.value) { d.udl = '0'; d.lid = lid.value; } else { d.udl = '1'; if (def()) d.lid = def().labelId; }
      rftText(); refresh(); markDirty();
    };
    refresh();
    if ((d.field || '').trim()) lookup({ what: 'fieldLabels', field: d.field }).then((list) => {
      labels = list || [];
      for (const l of labels) lid.appendChild(Object.assign(document.createElement('option'), { value: l.labelId, textContent: l.labelId + ' "' + l.longName + '"' }));
      lid.value = d.udl === '1' ? '' : (d.lid || '').trim();
    });
  }
  // A Long Edit Box's Record tab (le02, le04): Field (Record Name / Field Name), Style (FIELDSTYLE; greyed while Rich Text
  // is on, as App Designer has it) and Display Options Enable Spell Check (FIELDUSETMP 0x2).
  function longEditRecordTab(ctx, p) {
    const { el, d, field, group, text, check } = ctx;
    const f = group(p, 'Field');
    const rec = field(f, 'Record Name', text(d.rec || '')), fld = field(f, 'Field Name', text(d.field || ''));
    const upd = () => { d.rec = rec.value.trim().toUpperCase(); d.field = fld.value.trim().toUpperCase(); markDirty(); };
    rec.oninput = upd; fld.oninput = upd;
    const style = ctx.styleSelect(p);
    style.classList.add('le-style');
    greyStyle(style, d.rte === '1');
    const spell = check(group(p, 'Display Options'), 'Enable Spell Check', (n(el, 'fut') & 0x2) !== 0);
    spell.onchange = () => ctx.tmpBit(0x2, spell.checked);
  }
  // An Edit Box's Record tab (eb01-eb31, eb77-eb78). Field: Record Name / Field Name; a rebind takes the field's default label
  // (LABEL_ID, and LBLTEXT on an RFT label) and format family (FORMATFAMILY), clearing the Display Name (eb77, eb79). Style
  // (FIELDSTYLE) and Fill Character (DSPLFILL). Size Average / Maximum / Custom (FIELDSIZETYPE 0 / 1 / 2; Custom fixes the drawn
  // size as FIELDRIGHT / FIELDBOTTOM, eb14). Alignment Auto / Left / Right (DSPLFORMAT 0x8 / 0x1 / 0x4). Family Name (the
  // field's, shown) and Display Name (DISPFMTNAME, the family's PSFMTITEM names). Display Options in DSPLFORMAT: Display Zero
  // 0x80, Password 0x8000, Show Prompt Button (0x800000 off), Auto Fill 0x200, Display Time Zone 0x20000000, Display Century
  // 0x10000, Currency Symbol 0x10, 1000 Separator 0x20, Auto Decimal 0x400; Input Only (FIELDUSETEMP2 0x200, offered with
  // Password, kept when greyed) and Enable Spell Check (FIELDUSETMP 0x2: greys Show Prompt Button and clears its 0x800000, eb12;
  // off leaves it unchecked, eb27).
  function editBoxRecordTab(ctx, p) {
    const { el, d, mk, field, group, text, select, radio, check } = ctx;
    const dspl = (b) => (n(el, 'dspl') & b) !== 0;
    const setDspl = (b, on) => { setN(el, 'dspl', on ? n(el, 'dspl') | b : n(el, 'dspl') & ~b); markDirty(); };
    const f = group(p, 'Field');
    const rec = field(f, 'Record Name', text(d.rec || '')), fld = field(f, 'Field Name', text(d.field || ''));
    rec.oninput = () => { d.rec = rec.value.trim().toUpperCase(); markDirty(); };
    fld.oninput = () => { d.field = fld.value.trim().toUpperCase(); markDirty(); };
    const styleRow = mk('<div class="row wrap"></div>'); p.appendChild(styleRow);
    ctx.styleSelect(styleRow);
    const fill = field(styleRow, 'Fill Character', text((d.dfill || '').trim(), 1)); fill.className = 'mini';
    fill.oninput = () => { d.dfill = fill.value; markDirty(); };
    const pair = mk('<div class="row wrap"></div>'); p.appendChild(pair);
    const size = group(pair, 'Size');
    for (const [v, label] of [['0', 'Average'], ['1', 'Maximum'], ['2', 'Custom']]) radio(size, 'ebsz' + d.id, [[v, label]], String(n(el, 'fst')), () => {
      // Custom fixes the size App Designer draws (eb14); Average and Maximum leave the stored right / bottom (eb15).
      if (v === '2' && !n(el, 'fr')) { setN(el, 'fr', n(el, 'fl') + el.offsetWidth); setN(el, 'fb', n(el, 'ft') + el.offsetHeight); }
      el.dataset.fst = v; markDirty();
    });
    const al = group(pair, 'Alignment');
    const curAl = String(n(el, 'dspl') & 0xd);
    for (const [v, label] of [['8', 'Auto'], ['1', 'Left'], ['4', 'Right']]) radio(al, 'ebal' + d.id, [[v, label]], curAl, () => { setN(el, 'dspl', (n(el, 'dspl') & ~0xf) | Number(v)); markDirty(); });
    const fam = mk('<div class="row wrap"></div>'); p.appendChild(fam);
    const famName = field(fam, 'Family Name', text((d.ffam || '').trim())); famName.readOnly = true;
    const dispName = field(fam, 'Display Name', select([['', '']], (d.dfn || '').trim()));
    dispName.onchange = () => { d.dfn = dispName.value; markDirty(); };
    const showFamily = (info) => {
      const has = !!(d.ffam || '').trim();
      famName.value = (d.ffam || '').trim();
      for (const c of [famName, dispName]) { c.disabled = !has || !editable; c.closest('.pf').classList.toggle('na', !has); }
      if (info) {
        dispName.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: '' }));
        for (const nme of info.displayNames || []) dispName.appendChild(Object.assign(document.createElement('option'), { value: nme, textContent: nme }));
        dispName.value = (d.dfn || '').trim();
      }
    };
    const disp = group(p, 'Display Options');
    const cols = mk('<div class="cols2"><div></div><div></div></div>'); disp.appendChild(cols);
    const [left, right] = cols.children;
    const opt = (parent, label, bit) => { const c = check(parent, label, dspl(bit)); c.onchange = () => setDspl(bit, c.checked); return c; };
    opt(left, 'Display Zero', 0x80);
    const pwd = opt(left, 'Password', 0x8000);
    const prompt = check(left, 'Show Prompt Button', !dspl(0x800000));
    opt(left, 'Auto Fill', 0x200);
    opt(left, 'Display Time Zone', 0x20000000);
    const inputOnly = check(left, 'Input Only', (n(el, 'fut2') & 0x200) !== 0);
    opt(right, 'Display Century', 0x10000);
    opt(right, 'Currency Symbol', 0x10);
    opt(right, '1000 Separator', 0x20);
    opt(right, 'Auto Decimal', 0x400);
    const spell = check(right, 'Enable Spell Check', (n(el, 'fut') & 0x2) !== 0);
    const refresh = () => {
      const sp = spell.checked;
      prompt.disabled = sp || !editable; prompt.closest('.row').classList.toggle('na', sp);
      if (sp) prompt.checked = false;
      inputOnly.disabled = !pwd.checked || !editable; inputOnly.closest('.row').classList.toggle('na', !pwd.checked);
    };
    prompt.onchange = () => setDspl(0x800000, !prompt.checked);
    inputOnly.onchange = () => ctx.t2Bit(0x200, inputOnly.checked);
    pwd.addEventListener('change', refresh);
    // Spell Check on clears the prompt's 0x800000 (eb12); off leaves the button unchecked, 0x800000 set (eb27).
    spell.onchange = () => { ctx.tmpBit(0x2, spell.checked); setDspl(0x800000, !spell.checked); refresh(); };
    refresh();
    const fieldInfo = () => lookup({ what: 'editBoxField', record: d.rec || '', field: d.field || '' });
    fld.onchange = rec.onchange = () => {
      if (!d.field) return;
      fieldInfo().then((info) => {
        if (!info) return;
        d.ffam = info.formatFamily; d.dfn = ''; showFamily(info);
        for (const fn of ctx.onFieldInfo) fn(info);
        markDirty();
      });
      // The field's default label (eb77): LABEL_ID, and an RFT label's text.
      lookup({ what: 'fieldLabels', field: d.field }).then((labels) => {
        const def = (labels || []).find((l) => l.isDefault) || (labels || [])[0];
        if (!def) return;
        d.lid = def.labelId;
        if (d.lt === '2' || d.lt === '3') { d.lx = d.lt === '2' ? def.shortName : def.longName; syncLabel(el); }
        markDirty();
      });
    };
    showFamily(null);
    if ((d.field || '').trim()) fieldInfo().then((info) => { if (info) { showFamily(info); for (const fn of ctx.onFieldInfo) fn(info); } });
  }
  // An Edit Box's Fluid Input Properties (eb61-eb76): Input Type (HTML_INPUT_TYPE: text 0, color 1, date 2, datetime 3, email 5,
  // number 7, range 8, search 9, tel 10, time 11, url 12), Generate As Hyperlink (FIELDUSETMP 0x80000; offered for email and
  // url) and a range's Min / Max / Step (MINNUMBER / MAXNUMBER / STEPNUMBER). Another type keeps both (eb72, eb74).
  const INPUT_TYPES = [['0', 'text'], ['1', 'color'], ['2', 'date'], ['3', 'datetime'], ['5', 'email'], ['7', 'number'], ['8', 'range'], ['9', 'search'], ['10', 'tel'], ['11', 'time'], ['12', 'url']];
  function inputGroup(ctx, fl, off) {
    const { el, d, mk, group, text, select, check } = ctx;
    const g = group(fl, 'Input Properties');
    const row = mk('<div class="row wrap"></div>'); g.appendChild(row);
    const ty = off(ctx.field(row, 'Input Type', select(INPUT_TYPES, String(n(el, 'ity')))));
    const link = off(check(row, 'Generate As Hyperlink', (n(el, 'fut') & 0x80000) !== 0));
    link.onchange = () => ctx.tmpBit(0x80000, link.checked);
    const range = mk('<div class="row wrap"></div>'); g.appendChild(range);
    for (const [label, key] of [['Min', 'mnn'], ['Max', 'mxn'], ['Step', 'stn']]) {
      const i = off(ctx.field(range, label, text((d[key] || '').trim(), 30))); i.className = 'mini';
      i.oninput = () => { d[key] = i.value.trim(); markDirty(); };
    }
    const refresh = () => { const t = ty.value; link.closest('.row').hidden = t !== '5' && t !== '12'; range.hidden = t !== '8'; };
    ty.onchange = () => { setN(el, 'ity', Number(ty.value)); refresh(); markDirty(); };
    refresh();
  }
  // The Record tab's Style, greyed while Rich Text is on.
  function greyStyle(style, rich) {
    style.disabled = rich || !editable; style.closest('.pf').classList.toggle('na', rich); style.closest('.pf').title = rich ? 'Not used with Rich Text' : '';
  }
  // A Long Edit Box's Options tab (le01, le03): Enable Rich Text (FIELDUSETMP 0x80 with a PSPTPNLRTEDITOR row; on, App
  // Designer fills Image Location URL Id with PT_RTE_IMG_DB_LOC; off deletes the row) and its five ids.
  function richTextTab(ctx, p) {
    const { el, d, field, group, text, select, check } = ctx;
    const g = group(p, 'Rich Text Options');
    const on = check(g, 'Enable Rich Text', d.rte === '1');
    const pick = (label, key) => {
      const s = field(g, label, select([['', '']], (d[key] || '').trim()));
      s.onchange = () => { d[key] = s.value; markDirty(); };
      return s;
    };
    const cfg = pick('Configuration Settings Id', 'rtc'), img = pick('Image Location URL Id', 'rti'), plugin = pick('Plugin File Id', 'rtp');
    const typed = (label, key) => { const t = field(g, label, text((d[key] || '').trim(), 30)); t.oninput = () => { d[key] = t.value.trim().toUpperCase(); markDirty(); }; return t; };
    const tmpl = typed('Template File Id', 'rtt'), style = typed('Style File Id', 'rts');
    const all = [cfg, img, plugin, tmpl, style];
    const refresh = () => { for (const c of all) { c.disabled = !on.checked || !editable; c.closest('.pf').classList.toggle('na', !on.checked); } };
    on.onchange = () => {
      ctx.tmpBit(0x80, on.checked);
      d.rte = on.checked ? '1' : '0';
      const style = document.querySelector('.inspector select.le-style'); if (style) greyStyle(style, on.checked);
      if (on.checked && !(d.rti || '').trim()) { d.rti = 'PT_RTE_IMG_DB_LOC'; img.value = d.rti; if (img.value !== d.rti) { img.appendChild(Object.assign(document.createElement('option'), { value: d.rti, textContent: d.rti })); img.value = d.rti; } }
      refresh();
    };
    refresh();
    lookup({ what: 'richTextChoices' }).then((r) => {
      if (!r) return;
      for (const [s, names, key] of [[cfg, r.configs, 'rtc'], [img, r.imageUrls, 'rti'], [plugin, r.plugins, 'rtp']]) {
        const cur = (d[key] || '').trim();
        for (const nme of names) if (![...s.options].some((o) => o.value === nme)) s.appendChild(Object.assign(document.createElement('option'), { value: nme, textContent: nme }));
        s.value = cur;
      }
    });
  }
  // Placeholder Text (le17-le19), on a Long Edit Box's Fluid tab: None / Static / Message Catalog (PSPNLFIELDEXT.PLHTYPE
  // 0 / 1 / 2), the Static Text (PLACEHOLDER) and Message Set/Number (PLH_MSG_SET_NBR / PLH_MSG_NBR). Message Catalog
  // blanks the static text (le18); None clears the set / number (le19).
  function placeholderGroup(ctx, fl, off) {
    const { el, d, mk, group, text, radio } = ctx;
    const g = group(fl, 'Placeholder Text');
    radio(g, 'plh' + d.id, [['0', 'None'], ['1', 'Static'], ['2', 'Message Catalog']], String(n(el, 'plt')), (v) => setType(Number(v)));
    if (!pageProps.fluidPage) for (const r of g.querySelectorAll('input[type=radio]')) off(r);
    const st = off(ctx.field(g, 'Static Text', text((d.plh || '').trim(), 254)));
    st.oninput = () => { d.plh = st.value; markDirty(); };
    const msg = mk('<div class="row"><label>Message Set/Number</label></div>'); g.appendChild(msg);
    const mini = (v) => { const i = text(v && v !== '0' ? v : ''); i.className = 'mini'; return i; };
    const ms = mini(d.pls), mn = mini(d.pln); msg.append(ms, mn);
    ms.oninput = () => { setN(el, 'pls', Number(ms.value) || 0); markDirty(); };
    mn.oninput = () => { setN(el, 'pln', Number(mn.value) || 0); markDirty(); };
    const refresh = () => {
      const t = n(el, 'plt'), on = !!pageProps.fluidPage && editable;
      st.disabled = t !== 1 || !on; st.closest('.pf').classList.toggle('na', t !== 1);
      ms.disabled = mn.disabled = t !== 2 || !on; msg.classList.toggle('na', t !== 2);
    };
    function setType(t) {
      setN(el, 'plt', t);
      if (t !== 1) { d.plh = ''; st.value = ''; }
      if (t !== 2) { setN(el, 'pls', 0); setN(el, 'pln', 0); ms.value = mn.value = ''; }
      refresh(); markDirty();
    }
    refresh();
  }
  // Static Image's Label tab, laid out as App Designer's (si01-si12). Alt tag for image: Label Type None (LBLTYPE 6) /
  // Text (1) / Message Catalog (7), Message Set / Msg Number (GRDLBLMSGSET / GRDLBLMSGNUM), the Label (LBLTEXT, or the
  // catalog message shown greyed). Image: Image ID (CONTNAME) with the image's type, size and picture. Image Format /
  // Size: Scale (DSPLFORMAT 0x800) or Size (0x4000), and the Width / Height the dialog shows, the control's less 2.
  function staticImageLabelTab(ctx, p) {
    const { el, d, mk, field, group, text, select, radio } = ctx;
    const mini = (v) => { const i = text(v); i.className = 'mini'; return i; };
    const alt = group(p, 'Alt tag for image');
    const lt = field(alt, 'Label Type', select([['6', 'None'], ['1', 'Text'], ['7', 'Message Catalog']], d.lt));
    const msg = mk('<div class="row"><label>Message Set</label></div>'); alt.appendChild(msg);
    const ms = mini(d.gms && d.gms !== '0' ? d.gms : ''); msg.appendChild(ms);
    msg.appendChild(tn('label', 'Msg Number'));
    const mn = mini(d.gmn && d.gmn !== '0' ? d.gmn : ''); msg.appendChild(mn);
    const lbl = field(alt, 'Label', text(d.lx));
    lbl.oninput = () => { d.lx = lbl.value; syncLabel(el); markDirty(); };
    // The catalog message is looked up once Message Set and Msg Number are both set.
    let msgSeq = 0;
    const showMessage = () => {
      if (d.lt !== '7') return;
      const set = Number(ms.value) || 0, num = Number(mn.value) || 0, seq = ++msgSeq;
      lbl.value = '';
      if (set && num) lookup({ what: 'message', set, num }).then((t) => { if (seq === msgSeq && d.lt === '7') lbl.value = t || ''; });
    };
    ms.oninput = () => { d.gms = String(Number(ms.value) || 0); markDirty(); showMessage(); };
    mn.oninput = () => { d.gmn = String(Number(mn.value) || 0); markDirty(); showMessage(); };
    const refresh = () => {
      const cat = d.lt === '7', txt = d.lt === '1';
      for (const c of [ms, mn]) c.disabled = !cat || !editable;
      msg.classList.toggle('na', !cat);
      lbl.disabled = !txt || !editable; lbl.closest('.pf').classList.toggle('na', !txt);
      if (txt) lbl.value = d.lx || ''; else if (cat) showMessage(); else lbl.value = '';
    };
    // Message Catalog blanks the alt text (si04: LBLTEXT 'ZZ Alt' -> ' ').
    lt.onchange = () => { d.lt = lt.value; if (d.lt === '7') { d.lx = ' '; syncLabel(el); } refresh(); markDirty(); };
    refresh();

    const imgBox = group(p, 'Image');
    const idRow = mk('<div class="pf"><label>Image ID</label><div class="row"></div></div>'); imgBox.appendChild(idRow);
    const img = text((d.cont || '').trim(), 30); idRow.lastChild.appendChild(img);
    const browse = tn('button', '...'); browse.className = 'action'; browse.title = 'Choose an image definition'; idRow.lastChild.appendChild(browse);
    if (!editable) img.disabled = browse.disabled = true;
    const info = mk('<div class="row"><label>Type</label></div>'); imgBox.appendChild(info);
    const ty = mini(''), iw = mini(''), ih = mini('');
    info.append(ty, tn('label', 'Width'), iw, tn('label', 'Height'), ih);
    for (const c of [ty, iw, ih]) c.readOnly = true;
    const pic = mk('<div class="preview"></div>'); imgBox.appendChild(pic);
    let actual = null, imgSeq = 0;
    const showImage = () => {
      const name = (d.cont || '').trim(), seq = ++imgSeq;
      actual = null; ty.value = iw.value = ih.value = ''; pic.replaceChildren(); reset.disabled = true;
      if (!name) return;
      lookup({ what: 'image', name }).then((r) => {
        if (seq !== imgSeq) return;
        if (!r) { pic.replaceChildren(tn('span', 'No image named ' + name)); return; }
        ty.value = r.format || ''; iw.value = r.width ? String(r.width) : ''; ih.value = r.height ? String(r.height) : '';
        if (r.width && r.height) { actual = r; reset.disabled = !editable; }
        if (r.dataUri) pic.replaceChildren(Object.assign(document.createElement('img'), { src: r.dataUri, alt: name }));
      });
    };
    const setImage = (v) => { d.cont = v.trim().toUpperCase(); img.value = d.cont; markDirty(); showImage(); };
    img.onchange = () => setImage(img.value);
    browse.onclick = () => lookup({ what: 'pickImage', current: (d.cont || '').trim() }).then((v) => { if (v) setImage(v); });

    const fmt = group(p, 'Image Format / Size');
    const scaled = (n(el, 'dspl') & 0x800) !== 0;
    radio(fmt, 'sifmt' + d.id, [['scale', 'Scale'], ['size', 'Size']], scaled ? 'scale' : 'size', (v) => {
      let x = n(el, 'dspl') & ~0x4800; x |= v === 'scale' ? 0x800 : 0x4000; setN(el, 'dspl', x); markDirty();
    });
    const dims = mk('<div class="row"><label>Width</label></div>'); fmt.appendChild(dims);
    const num = (v) => { const i = text(String(v)); i.type = 'number'; i.min = '1'; if (!editable) i.disabled = true; return i; };
    const fw = num(Math.max(0, n(el, 'fr') - n(el, 'fl') - 2)), fh = num(Math.max(0, n(el, 'fb') - n(el, 'ft') - 2));
    dims.append(fw, tn('label', 'Height'), fh);
    const resize = (w, h) => {
      setN(el, 'fr', n(el, 'fl') + w + 2); setN(el, 'fb', n(el, 'ft') + h + 2);
      el.style.width = (w + 2) + 'px'; el.style.height = (h + 2) + 'px'; markDirty();
    };
    fw.oninput = fh.oninput = () => { const w = Number(fw.value), h = Number(fh.value); if (w > 0 && h > 0) resize(w, h); };
    const reset = tn('button', 'Reset to actual image size'); reset.className = 'action'; fmt.appendChild(reset);
    reset.onclick = () => { if (!actual) return; fw.value = String(actual.width); fh.value = String(actual.height); resize(actual.width, actual.height); };
    showImage();
  }
  // A scroll's Occurs Level (its own: the controls after it in tab order take it, up to the next scroll or Set to Level
  // rule -- lv04, lv09), 1 to 3.
  function occursLevelField(ctx, p) {
    const { el, field, text } = ctx;
    const lvl = field(p, 'Occurs Level', text(String(n(el, 'level'))));
    lvl.type = 'number'; lvl.min = '1'; lvl.max = '3';
    lvl.title = 'The controls after this scroll in the Order tab are at this level, up to the next scroll or Set to Level rule';
    lvl.oninput = () => { const v = Math.min(3, Math.max(1, Math.round(Number(lvl.value) || 1))); setN(el, 'level', v); markDirty(); };
    return lvl;
  }
  // Scroll Bar / Scroll Area Options: Occurs Level and Occurs Count.
  function scrollOptionsTab(ctx, p) {
    const { el, field, text, check } = ctx;
    occursLevelField(ctx, p);
    const unlimited = check(p, 'Unlimited Occurs Count', n(el, 'oc1') === 0);
    const oc = field(p, 'Occurs Count', text(String(n(el, 'oc1')))); oc.type = 'number';
    oc.oninput = () => { setN(el, 'oc1', Number(oc.value) || 0); unlimited.checked = (Number(oc.value) || 0) === 0; markDirty(); };
    unlimited.onchange = () => { if (unlimited.checked) { setN(el, 'oc1', 0); oc.value = '0'; } else { setN(el, 'oc1', 1); oc.value = '1'; } markDirty(); };
  }
  // Grid Options: Occurs Count and the display flags (Show Column Headings / Row Numbers / Allow Column Sorting).
  // A new Grid's / Analytic Grid's main record: its own record, keyed by the parent level's keys plus a row key
  // (psft_explain_scrolls). App Designer also makes it the grid's Page Field Name (gd-fresh).
  function mainRecordTab(ctx, p) {
    const { el, d, field, text } = ctx;
    const rec = field(p, 'Main Record', text(d.rec || ''));
    rec.oninput = () => { d.rec = rec.value.trim().toUpperCase(); d.pfn = d.rec; placeholderLabel(el); markDirty(); };
    p.appendChild(tn('p', 'The grid\\'s rows: its own record, keyed by the keys of the level above it plus one more for each row. Fields dropped on the grid become its columns.'));
  }
  // A new Subpage: the subpage (placed at its own rectangle on save, as App Designer places it) and Subpage Record Name Substitution.
  function newSubpageTab(ctx, p) {
    const { d, field, text } = ctx;
    const sub = field(p, 'Subpage', text(d.sub || '', 30));
    const to = field(p, 'Record Name Substitution To', text(d.rec || '', 15));
    sub.oninput = () => { d.sub = sub.value.trim().toUpperCase(); d.target = d.sub; markDirty(); };
    to.oninput = () => { d.rec = to.value.trim().toUpperCase(); markDirty(); };
    p.appendChild(tn('p', 'App Designer places a subpage at the subpage\\'s own size and position; the save does the same.'));
  }
  function newSecondaryTab(ctx, p) {
    const { d, field, text } = ctx;
    const pg = field(p, 'Page', text(d.sub || '', 30));
    pg.oninput = () => { d.sub = pg.value.trim().toUpperCase(); d.target = d.sub; markDirty(); };
  }
  // A new Tree: its root record field (field optional) and its levels below, each the child of the one before (PSPNLTREECTRL).
  function treeRecordTab(ctx, p) {
    recordTab(ctx, p);
    const { d, field } = ctx;
    const levels = field(p, 'Levels (RECORD.FIELD, one per line)', Object.assign(document.createElement('textarea'), { rows: 3,
      value: (d.tl ? JSON.parse(d.tl) : []).map((l) => l.recName + '.' + l.fieldName).join('\\n') }));
    levels.oninput = () => {
      const ls = levels.value.split('\\n').map((x) => x.trim().toUpperCase()).filter(Boolean).map((x) => { const [r, f] = x.split('.'); return { recName: r || '', fieldName: f || '' }; });
      d.tl = JSON.stringify(ls); markDirty();
    };
  }
  // An Analytic Grid's model and cube collection (its record is the collection's; its dimensions start on the Row Axis).
  function analyticsTab(ctx, p) {
    const { el, d, field, text } = ctx;
    if (!el.dataset.new) { p.appendChild(propsTable([['Record', d.rec || ''], ['Page Field Name', d.pfn || '']])); return; }
    const m = field(p, 'Model Name', text(d.acem || '', 30));
    const cc = field(p, 'Cube Collection Name', text(d.acec || '', 30));
    m.oninput = () => { d.acem = m.value.trim().toUpperCase(); markDirty(); };
    cc.oninput = () => { d.acec = cc.value.trim().toUpperCase(); markDirty(); };
    p.appendChild(tn('p', 'The record is the cube collection\\'s; every field of the collection must be a column (App Designer\\'s 15,89).'));
  }
  function gridOptionsTab(ctx, p) {
    const { el, field, text, check } = ctx;
    occursLevelField(ctx, p);
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
    const valueOnly = (ctx, p) => { const v = ctx.field(p, 'Value', ctx.text(ctx.d.onv || '')); v.oninput = () => { ctx.d.onv = v.value; markDirty(); }; };
    const refInfo = (ttl, read) => (ctx, p) => { const t = ctx.field(p, ttl, ctx.text(read(ctx.d))); t.readOnly = true; t.title = 'Set in App Designer'; };
    switch (ft) {
      case 0: return richInspect(el, 'Static Text Properties', [T('label', 'Label', staticTextLabelTab), T('use', 'Use', staticTextUseTab), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 2: return richInspect(el, 'Group Box Properties', [T('record', 'Record', groupBoxRecordTab), T('label', 'Label', groupBoxLabelTab), T('use', 'Use', groupBoxUseTab),
        T('general', 'General', general({})), T('fluid', 'Fluid', (ctx, p) => fluidTab(ctx, p, { groupBox: true }))]);
      case 3: return richInspect(el, 'Static Image Properties', [T('label', 'Label', staticImageLabelTab), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 4: return richInspect(el, 'Edit Box Properties', [T('record', 'Record', editBoxRecordTab), T('label', 'Label', (ctx, p) => fieldLabelTab(ctx, p, { longEdit: true })),
        T('use', 'Use', (ctx, p) => fieldUseTab(ctx, p, { editBox: true })), T('general', 'General', general({})),
        T('fluid', 'Fluid', (ctx, p) => fluidTab(ctx, p, { placeholder: true, inputType: true, suppressLabel: 'Suppress System-Specific Style Classes' }))]);
      case 5: return richInspect(el, 'Drop-Down List Properties', [T('record', 'Record', record()), T('label', 'Label', label({})), T('use', 'Use', use(USE_FIELD)), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 6: return richInspect(el, 'Long Edit Box Properties', [T('record', 'Record', longEditRecordTab), T('label', 'Label', (ctx, p) => fieldLabelTab(ctx, p, { longEdit: true })),
        T('use', 'Use', (ctx, p) => fieldUseTab(ctx, p, { longEdit: true })), T('general', 'General', general({})),
        T('fluid', 'Fluid', (ctx, p) => fluidTab(ctx, p, { placeholder: true, suppressLabel: 'Suppress System-Specific Style Classes' })), T('options', 'Options', richTextTab)]);
      case 7: return richInspect(el, 'Check Box Properties', [T('record', 'Record', checkBoxRecordTab), T('label', 'Label', fieldLabelTab), T('use', 'Use', fieldUseTab), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 8: return richInspect(el, 'Radio Button Properties', [T('record', 'Record', record(valueOnly)), T('label', 'Label', label({})), T('use', 'Use', use(USE_FIELD)), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 9: return richInspect(el, 'Image Properties', [T('record', 'Record', record()), T('label', 'Label', label({})), T('general', 'General', general({}))]);
      case 24: return richInspect(el, 'Tab Separator Properties', [T('label', 'Label', label({})), T('general', 'General', general({}))]);
      case 32: return richInspect(el, 'Analytic Grid Properties', [T('analytics', 'Analytics', analyticsTab), T('label', 'Label', label({})), T('options', 'Options', gridOptionsTab), T('general', 'General', general({}))]);
      case 10: return richInspect(el, 'Scroll Bar Properties', [T('options', 'Options', scrollOptionsTab), T('use', 'Use', use(USE_COMMON)), T('general', 'General', general({}))]);
      case 11: return richInspect(el, 'Subpage Properties', [T('subpage', 'Subpage', el.dataset.new ? newSubpageTab : refInfo('Subpage Name', (d) => d.target || '')), T('general', 'General', general({}))]);
      case 18: return richInspect(el, 'Secondary Page Properties', [T('secpage', 'Secondary Page', el.dataset.new ? newSecondaryTab : refInfo('Page', (d) => d.target || '')), T('use', 'Use', use([['Invisible', 'fu', 0x2]])), T('label', 'Label', label({})), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 19: return richInspect(el, 'Grid Properties', [...(el.dataset.new ? [T('record', 'Record', mainRecordTab)] : []), T('label', 'Label', label({})), T('options', 'Options', gridOptionsTab), T('use', 'Use', use(USE_COMMON)), T('general', 'General', general({}))]);
      case 20: return richInspect(el, 'Tree Properties', [T('record', 'Record', el.dataset.new ? treeRecordTab : record()), T('general', 'General', general({}))]);
      case 23: return richInspect(el, 'Horizontal Rule Properties', [T('label', 'Label', ruleLabelTab), T('use', 'Use', ruleUseTab), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 25: return richInspect(el, 'HTML Area Properties', [T('html', 'HTML', htmlAreaTab), T('label', 'Label', htmlLabelTab), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 27: return richInspect(el, 'Scroll Area Properties', [T('label', 'Label', label({})), T('options', 'Options', scrollOptionsTab), T('use', 'Use', use(USE_COMMON)), T('general', 'General', general({})), T('fluid', 'Fluid', fluidTab)]);
      case 30: return richInspect(el, 'Chart Properties', [T('record', 'Record', record()), T('general', 'General', general({}))]);
      default:
        if ((ft >= 12 && ft <= 17) || ft === 21 || ft === 26 || ft === 29) return richInspect(el, 'Push Button Properties', [T('record', 'Record', record()), T('label', 'Label', label({})), T('use', 'Use', use(USE_COMMON)), T('general', 'General', general({}))]);
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
  // Asks the extension for something the page does not carry (an image's size and picture, a catalog message, an image picked).
  let lookupSeq = 0; const lookups = new Map();
  function lookup(req) {
    if (!vscode) return Promise.resolve(undefined);
    const id = ++lookupSeq; vscode.postMessage({ type: 'lookup', id, req });
    return new Promise((resolve) => lookups.set(id, resolve));
  }
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'lookup') { const r = lookups.get(ev.data.id); if (r) { lookups.delete(ev.data.id); r(ev.data.result); } return; }
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
      // A stored grid column stays in its grid (its stored place is (0, 0)): it is selected, not moved.
      if (el.dataset.incol) { inspect(el); e.preventDefault(); return; }
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
      // A new field control dropped on a grid becomes its next column; dragged off, it is not one.
      if (d.moved && !d.resize && d.el && d.el.dataset.new && !['image', 'tree', 'chart'].includes(d.el.dataset.new) && (kinds[d.el.dataset.new].bound || kinds[d.el.dataset.new].gridOnly)) {
        const at = { x: d.el.offsetLeft + 2, y: d.el.offsetTop + 2 };
        const g = live().find((x) => gridOf(x) && x !== d.el && at.x >= x.offsetLeft && at.y >= x.offsetTop && at.x < x.offsetLeft + x.offsetWidth && at.y < x.offsetTop + x.offsetHeight);
        if (g) intoGrid(d.el, g); else delete d.el.dataset.into;
      }
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
    // A grid's next column: right of its last column, under its headings (App Designer's drop on a grid).
    function gridOf(el) { return el && [19, 32].includes(n(el, 'ftype')) ? el : null; }
    function columnSpot(g) {
      const cols = live().filter((c) => c.dataset.incol === g.dataset.id || c.dataset.into === g.dataset.id);
      const x = cols.length ? Math.max(...cols.map((c) => c.offsetLeft + c.offsetWidth)) + 1 : g.offsetLeft + (n(g, 'grh') ? 22 : 2);
      return [x, g.offsetTop + 20];
    }
    function intoGrid(el, g) {
      el.dataset.into = g.dataset.id;
      const [x, y] = columnSpot(g);
      const dx = x - el.offsetLeft, dy = y - el.offsetTop;
      moveBy(el, dx, dy);
    }
    function addControl(kind) {
      const k = kinds[kind];
      const targetGrid = gridOf(selected);
      if (k.gridOnly && !targetGrid) { status.textContent = 'A ' + k.typeName + ' goes inside a grid: select the grid first.'; status.classList.add('err'); return; }
      const id = -(++newSeq);
      const scroller = document.getElementById('panel-layout');
      // Cascade from the visible top-left so successive inserts do not stack.
      const step = 20 * ((newSeq - 1) % 8);
      const l = Math.round(scroller.scrollLeft + 24 + step), t = Math.round(scroller.scrollTop + 24 + step);
      const el = document.createElement('div');
      el.className = 'ctl s-' + k.shape + ' new-ctl' + ((k.fu & 1) ? ' u-display-only' : '') + ((k.fu & 2) ? ' u-invisible' : ''); el.id = 'c' + id; el.tabIndex = 0; el.title = 'New ' + k.typeName;
      // A new scroll's Occurs Level is 1 (lv03, lv17); every other control's follows from the tab order (relevel).
      Object.assign(el.dataset, { id: String(id), new: kind, num: '', level: SCROLL_TYPES.includes(k.ftype) ? '1' : '0', type: k.typeName, target: '', rec: '', field: '', pfn: '', defer: '1', ctlfld: '0',
        fl: String(l), ft: String(t), fr: String(k.w ? l + k.w : 0), fb: String(k.h ? t + k.h : 0), ell: '0', elt: '0', elr: '0', elb: '0',
        fst: String(k.fst), lt: String(k.lt), lx: k.lx, fu: String(k.fu || 0), si: (k.fu & 2) ? '1' : '0', ftype: String(k.ftype) });
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
      // Inserted with a grid selected, a field control (or Tab Separator) is the grid's next column.
      if (targetGrid && (k.bound || k.gridOnly) && !['image', 'tree', 'chart'].includes(kind)) intoGrid(el, targetGrid);
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
        Object.assign(el.dataset, { id: String(id), num: '' });
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
      // A record-bound control needs its record and field; an HTML Area may name the record alone.
      // An Image or Chart may be saved unbound (im-fresh, ch-fresh).
      const unbound = live.find((el) => { const k = el.dataset.new && kinds[el.dataset.new]; return k && k.bound && !k.recordOptional && !(el.dataset.rec && (el.dataset.field || k.fieldOptional)); });
      if (unbound) { inspect(unbound); status.textContent = 'Give the new ' + unbound.dataset.type + (kinds[unbound.dataset.new].fieldOptional ? ' a record.' : ' a record and field.'); status.classList.add('err'); return; }
      // A Grid's main record, an Analytic Grid's model, a Subpage's / Secondary Page's page, a Tab Separator's grid.
      const missing = live.map((el) => { const k = el.dataset.new && kinds[el.dataset.new]; if (!k) return null;
        if (k.recordOnly && !el.dataset.rec) return [el, 'its main record (Record tab)'];
        if (k.analytic && !el.dataset.acem) return [el, 'its analytic model (Analytics tab)'];
        if (k.pageRef && !el.dataset.sub) return [el, 'its page'];
        if (k.gridOnly && !el.dataset.into) return [el, 'a grid: drop it on one'];
        return null; }).find(Boolean);
      if (missing) { inspect(missing[0]); status.textContent = 'Give the new ' + missing[0].dataset.type + ' ' + missing[1] + '.'; status.classList.add('err'); return; }
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
          // A Group Box's Label / Use / Fluid settings (gb01-gb27).
          popupMenu: el.dataset.pop || '', assocFieldNum: n(el,'assoc'),
          labelSizeType: n(el,'lst'), expandField: n(el,'lex'), placeholderType: n(el,'plt'), placeholder: el.dataset.plh || '',
          placeholderMsgSet: n(el,'pls'), placeholderMsgNum: n(el,'pln'),
          // A Long Edit Box's Rich Text options (null: Rich Text off).
          ...(n(el,'ftype') === 6 ? { richText: el.dataset.rte === '1' ? { configSettingsId: el.dataset.rtc || '', imageLocationUrlId: el.dataset.rti || '',
            pluginFileId: el.dataset.rtp || '', templateFileId: el.dataset.rtt || '', styleFileId: el.dataset.rts || '' } : null } : {}),
          // An HTML Area's Constant value (null: a Field value).
          ...(n(el,'ftype') === 25 ? { htmlConstant: el.dataset.hc === '1' ? (el.dataset.html || '') : null } : {}),
          labelStyle: el.dataset.lsty || '', labelId: el.dataset.lid || '', useDefaultLabel: n(el,'udl'), hideFields: n(el,'hf'),
          collapseDataArea: n(el,'cda'), defaultExpanded: n(el,'dve'), imageCollapsed: el.dataset.imc || '', imageExpanded: el.dataset.ime || '',
          popupMsgSet: n(el,'pms'), popupMsgNum: n(el,'pmn'), groupBoxType: n(el,'gbt'), groupBoxHtmlType: n(el,'gbh'), scrollBars: n(el,'sb'),
          headerTextInfo: n(el,'hti'), headerActionInfo: n(el,'hai'), headerActionItems: n(el,'hac'),
          // An Edit Box's Fill Character, Family / Display Name, Mouse Over Page Popup, Input Type and Smart Prompt (eb01-eb81).
          dsplFill: el.dataset.dfill || '', formatFamily: el.dataset.ffam || '', displayFormatName: el.dataset.dfn || '', popupPage: el.dataset.ppg || '',
          inputType: n(el,'ity'), minNumber: el.dataset.mnn || '', maxNumber: el.dataset.mxn || '', stepNumber: el.dataset.stn || '', disableSmartPrompt: n(el,'nsp'),
          ...(el.dataset.fslEdited ? { fluidClasses: (el.dataset.fsl || '').split('|') } : {}) } : {}),
        // A scroll's own Occurs Level and a Set to Level rule's choice; the save assigns every other control's level from
        // the tab order. A pasted control's type, so the save knows a pasted scroll.
        ...(setsLevel(el) ? { occursLevel: n(el, 'level') } : {}),
        ...(el.dataset.lvlEdited ? { setLevel: n(el, 'n1') } : {}),
        fieldType: n(el, 'ftype'),
        ...(el.dataset.copyPage ? { copy: { pnlName: el.dataset.copyPage, pnlFldId: Number(el.dataset.copyId) } }
          : el.dataset.new ? { add: { kind: el.dataset.new, recName: el.dataset.rec || '', fieldName: el.dataset.field || '',
            ...(el.dataset.sub ? { subPage: el.dataset.sub } : {}), ...(el.dataset.into ? { intoGrid: Number(el.dataset.into) } : {}),
            ...(el.dataset.tl ? { treeLevels: JSON.parse(el.dataset.tl) } : {}),
            ...(el.dataset.new === 'analyticGrid' ? { analytic: { model: el.dataset.acem || '', collection: el.dataset.acec || '' } } : {}) } } : {})
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
