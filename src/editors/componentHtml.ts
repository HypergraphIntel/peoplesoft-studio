import { escapeHtml as esc } from './propertiesHtml.js';
import type { Choice, ComponentDefinition, MessageRef } from '../model/componentDefinition.js';
import { COMPONENT_TYPES, PRIMARY_ACTIONS, SEARCH_PAGE_TYPES, SEARCH_TYPES } from '../model/componentFlags.js';
import type { StructureRecord, StructureScroll } from '../model/componentStructure.js';

/*
 * A component in App Designer's component window: the Definition tab (the
 * page grid), the Structure tab (the component buffer as a tree) and a
 * Component Properties sidebar with the dialog's General / Use / Internet /
 * Fluid / Style tabs. Read-only. A page row's right-click menu is App
 * Designer's: View Definition opens the page, Component Properties shows the
 * sidebar; Cut / Copy / Paste / Delete wait on a captured component save.
 * View PeopleCode (the header, or right-click in the Structure tab) offers
 * the component's, a record's and a field's component PeopleCode.
 */

const RECORD_TYPES: Record<number, string> = {
  0: 'Table', 1: 'View', 2: 'Derived', 3: 'SubRecord', 5: 'Dynamic View', 6: 'Query View', 7: 'Temp Table'
};

const check = (on: boolean) => `<span class="cb${on ? ' on' : ''}" aria-label="${on ? 'checked' : 'unchecked'}">${on ? '✔' : ''}</span>`;
const choiceText = (c: Choice) => ('label' in c ? c.label : `code ${c.code}`);
const msgText = (m: MessageRef) => `${m.set} / ${m.number}${m.default ? ' (default)' : ''}`;
const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`;
const text = (v: string) => (v ? esc(v) : '<span class="none">—</span>');

/** One grid row; editable, the Hidden box and the labels are inputs and the row can be dragged. */
export function gridRow(i: { num: number; pageName: string; itemName: string; hidden: boolean; itemLabel: string; folderTabLabel: string; deferred: boolean }, editable: boolean): string {
  if (!editable) {
    return `<tr data-page="${esc(i.pageName)}" tabindex="0"><td class="n">${i.num}</td><td>${esc(i.pageName)}</td><td>${esc(i.itemName)}</td><td class="c">${check(i.hidden)}</td>` +
      `<td>${esc(i.itemLabel)}</td><td>${esc(i.folderTabLabel)}</td><td class="c">${check(i.deferred)}</td></tr>`;
  }
  return `<tr data-page="${esc(i.pageName)}" data-item="${esc(i.itemName)}" data-deferred="${i.deferred ? 1 : 0}" tabindex="0" draggable="true">` +
    `<td class="n">${i.num}</td><td>${esc(i.pageName)}</td><td>${esc(i.itemName)}</td>` +
    `<td class="c"><input type="checkbox" class="hidden"${i.hidden ? ' checked' : ''} aria-label="Hidden"></td>` +
    `<td><input type="text" class="label" maxlength="30" value="${esc(i.itemLabel)}" aria-label="Item Label"></td>` +
    `<td><input type="text" class="tab" maxlength="30" value="${esc(i.folderTabLabel)}" aria-label="Folder Tab Label"></td><td class="c">${check(i.deferred)}</td></tr>`;
}

function definitionGrid(def: ComponentDefinition, editable: boolean): string {
  const head = ['', 'Page Name', 'Item Name', 'Hidden', 'Item Label', 'Folder Tab Label', 'Allow Deferred Processing'];
  const rows = def.items.map((i) => gridRow(i, editable)).join('\n');
  return `<table class="grid"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function recordNode(r: StructureRecord, pc: Set<string>, search = false): string {
  const type = RECORD_TYPES[r.type] ?? (r.type < 0 ? 'not found' : `type ${r.type}`);
  return `<li class="rec" data-record="${esc(r.name)}"><span class="ico ${r.type === 2 ? 'derived' : 'table'}" aria-hidden="true"></span>${pc.has(r.name) ? '<span class="pc" title="Component Record PeopleCode">⚡</span>' : ''}` +
    `${esc(r.name)} <span class="t">(${esc(type)})</span>${search ? ' - Search Record' : ''}</li>`;
}

function scrollNode(s: StructureScroll, pc: Set<string>, level: number): string {
  const label = level === 0 ? 'Scroll - Level 0' : `Scroll - Level ${level}&nbsp; Primary Record: ${esc(s.primary)}`;
  const inner = s.records.map((r) => recordNode(r, pc)).join('') + s.scrolls.map((k) => scrollNode(k, pc, level + 1)).join('');
  // Level 0 and level 1 open, as App Designer opens the tree; deeper scrolls start closed.
  return `<li class="scroll"><details${level <= 1 ? ' open' : ''}><summary><span class="ico scroll" aria-hidden="true"></span>${label}</summary><ul>${inner}</ul></details></li>`;
}

function structureTree(def: ComponentDefinition): string {
  const pc = new Set(def.peopleCodeRecords);
  const st = def.structure;
  const root = `${def.peopleCodeEvents.length ? '<span class="pc" title="Component PeopleCode">⚡</span>' : ''}${esc(def.name)} (Component)`;
  return `<ul class="tree"><li><details open><summary><span class="ico comp" aria-hidden="true"></span>${root}</summary><ul>` +
    `${st.searchRecord ? recordNode(st.searchRecord, pc, true) : ''}${scrollNode(st.level0, pc, 0)}</ul></details></li></ul>`;
}

const field = (label: string, id: string, value: string, max = 30) =>
  `<label for="${id}">${esc(label)}</label><input type="text" id="${id}" maxlength="${max}" value="${esc(value)}">`;
const box = (label: string, id: string, on: boolean) => `<div class="row"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><label for="${id}">${esc(label)}</label></div>`;

function propertiesTabs(def: ComponentDefinition, editable: boolean): string {
  const p = def.properties, g = p.general, u = p.use, n = p.internet, f = p.fluid;
  const generalEdit = `<div class="form">${field('Description', 'p-descr', g.description)}<label for="p-comments">Comments</label>` +
    `<textarea id="p-comments" rows="6">${esc(g.comments)}</textarea></div>` +
    `<table class="props">${row('Component', esc(def.name))}${row('Market', esc(def.market))}${row('Owner ID', text(g.ownerId))}` +
    `${row('Last updated', text(`${g.lastUpdated}${g.lastUpdatedBy ? ` by ${g.lastUpdatedBy}` : ''}`))}${row('Version', String(g.version))}</table>`;
  const useEdit = `<h3>Access</h3><div class="form">${field('Search record (required)', 'p-search', u.searchRecord, 15)}${field('Add search record', 'p-addsearch', u.addSearchRecord, 15)}` +
    `${box('Force Search Processing', 'p-force', u.forceSearch)}${field('Detail page', 'p-detail', u.detailPage, 18)}</div>` +
    `<table class="props">${row('Context search record', text(u.contextSearchRecord))}</table>` +
    `<h3>Actions</h3><div class="form">${box('Add', 'p-add', u.actions.add)}${box('Update/Display', 'p-ud', u.actions.updateDisplay)}` +
    `${box('Update/Display All', 'p-uda', u.actions.updateDisplayAll)}${box('Correction', 'p-corr', u.actions.correction)}` +
    `${box('Disable Saving Page', 'p-nosave', u.disableSave)}${box('Include in Navigation', 'p-nav', u.includeInNavigation)}</div>` +
    `<h3>3-Tier Execution Location</h3><table class="props">${row('Component Build', esc(choiceText(u.build)))}${row('Component Save', esc(choiceText(u.save)))}</table>`;
  const general = `<table class="props">${row('Component', esc(def.name))}${row('Market', esc(def.market))}${row('Description', text(g.description))}` +
    `${row('Comments', g.comments ? `<span class="pre">${esc(g.comments)}</span>` : text(''))}${row('Owner ID', text(g.ownerId))}` +
    `${row('Last updated', text(`${g.lastUpdated}${g.lastUpdatedBy ? ` by ${g.lastUpdatedBy}` : ''}`))}${row('Version', String(g.version))}</table>`;
  const use = `<h3>Access</h3><table class="props">${row('Search record', text(u.searchRecord))}${row('Add search record', text(u.addSearchRecord))}` +
    `${row('Force Search Processing', check(u.forceSearch))}${row('Detail page', text(u.detailPage))}${row('Context search record', text(u.contextSearchRecord))}</table>` +
    `<h3>Actions</h3><table class="props">${row('Add', check(u.actions.add))}${row('Update/Display', check(u.actions.updateDisplay))}` +
    `${row('Update/Display All', check(u.actions.updateDisplayAll))}${row('Correction', check(u.actions.correction))}` +
    `${row('Disable Saving Page', check(u.disableSave))}${row('Include in Navigation', check(u.includeInNavigation))}</table>` +
    `<h3>3-Tier Execution Location</h3><table class="props">${row('Component Build', esc(choiceText(u.build)))}${row('Component Save', esc(choiceText(u.save)))}</table>`;
  // Internet and Fluid: App Designer's boxes and choices, decoded (componentFlags.ts). Editable, each is an input; the boxes the
  // two tabs share carry data-sync so ticking one ticks the other.
  const flag = (label: string, id: string, on: boolean, sync = '') => editable
    ? `<div class="row"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${sync ? ` data-sync="${sync}"` : ''}><label for="${id}">${esc(label)}</label></div>`
    : `<div class="row">${check(on)} ${esc(label)}</div>`;
  const pickOne = (label: string, id: string, choice: Choice, options: Record<number, string>) => {
    if (!editable) return row(label, esc(choiceText(choice)));
    const current = 'code' in choice ? choice.code : Number(Object.entries(options).find(([, l]) => l === choice.label)?.[0]);
    const all = { ...options, ...(Object.keys(options).includes(String(current)) ? {} : { [current]: `code ${current}` }) };
    return `<tr><td class="k"><label for="${id}">${esc(label)}</label></td><td><select id="${id}">${Object.entries(all).map(([v, l]) =>
      `<option value="${v}"${Number(v) === current ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`;
  };
  const toolbarBox = (t: { label: string; bit: number; on: boolean }) => flag(t.label, `tb-${t.bit}`, t.on);
  const internet = `<h3>Search Page</h3><table class="props">${pickOne('Primary Action', 'i-primary', n.primaryAction, PRIMARY_ACTIONS)}` +
    `${row('Default Search Action', esc(choiceText(n.defaultSearchAction)))}${pickOne('Default Search/Lookup Type', 'i-stype', n.defaultSearchType, SEARCH_TYPES)}` +
    `${row('Link To Add Page', msgText(n.addLink))}${row('Link To Find Existing Value Page', msgText(n.findLink))}` +
    `${row('Link To Realtime Search Page', msgText(n.realtimeLink))}${row('Link To Keyword Search Page', msgText(n.keywordLink))}` +
    `${row('Instructional Text', msgText(n.instructions))}${row('Search category', text(n.searchCategory))}</table>` +
    `${flag('Allow Action Mode Selection', 'i-actmode', n.allowActionModeSelection)}` +
    `<h3>Multi-Page Navigation</h3>${flag('Display Folder Tabs (top)', 'i-tabs', n.folderTabs)}${flag('Display Hyperlinks (bottom)', 'i-links', n.hyperlinks)}` +
    `${flag('Page Navigation in History', 'i-navhist', n.pageNavigationInHistory, 'navhist')}${flag('Return to Last Page in History', 'i-lastpage', n.returnToLastPageInHistory, 'lastpage')}` +
    `<h3>Processing Mode</h3>${editable
      ? `<div class="row"><input type="radio" name="i-mode" id="i-interactive"${n.deferred ? '' : ' checked'}><label for="i-interactive">Interactive</label> ` +
        `<input type="radio" name="i-mode" id="i-deferred"${n.deferred ? ' checked' : ''}><label for="i-deferred">Deferred</label></div>`
      : `<div class="row">${n.deferred ? 'Deferred' : 'Interactive'}</div>`}` +
    `${flag('Allow Expert Entry', 'i-expert', n.expertEntry)}${flag('WSRP Compliant', 'i-wsrp', n.wsrpCompliant)}` +
    `<h3>Pagebar</h3>${n.pagebar.map((l) => flag(l.label, `pb-${l.bit}`, l.on, l.label === 'Help Link' ? 'help' : l.label === 'New Window Link' ? 'newwin' : '')).join('')}` +
    `${flag('Disable Pagebar', 'i-nopagebar', n.disablePagebar)}` +
    `<h3>Toolbar</h3><div class="cols">${n.toolbar.map(toolbarBox).join('')}</div>${flag('Disable Toolbar', 'i-notoolbar', !n.showToolbar, 'notoolbar')}`;
  const header = f.headerActions.map((h) => flag(h.label, `ha-${h.label.replace(/\W/g, '')}`, h.on,
    h.label === 'Help' ? 'help' : h.label === 'New Window' ? 'newwin' : '')).join('');
  const fluid = `<h3>Component Attributes</h3>${flag('Fluid Mode', 'f-fluid', f.fluidMode)}${flag('Layout Only', 'f-layout', f.layoutOnly)}` +
    `${flag('Page Navigation in History', 'f-navhist', n.pageNavigationInHistory, 'navhist')}${flag('Return to Last Page in History', 'f-lastpage', n.returnToLastPageInHistory, 'lastpage')}` +
    `${flag('Display on Small Form Factor Homepage', 'f-small', f.smallFormFactor)}${flag('No System Header Page', 'f-noheader', f.noSystemHeader)}` +
    `${flag('No System Side Page', 'f-noside', f.noSystemSide)}<table class="props">${pickOne('Component Type', 'f-ctype', f.componentType, COMPONENT_TYPES)}` +
    `${pickOne('Search Page Type', 'f-stype', f.searchPageType, SEARCH_PAGE_TYPES)}</table>${flag('Enable Configurable Search', 'f-confsearch', f.configurableSearch)}` +
    `<h3>Header Toolbar Actions</h3>${flag('Disable All Actions', 'f-noactions', f.disableAllActions, 'notoolbar')}<div class="cols">${header}</div>`;
  // Style: the Component lists (editable: Move Up / Move Down / Delete / Add, as App Designer's), Classic Plus, the Custom lists.
  const st = def.properties.style;
  const objects = (title: string, id: string, names: string[], custom: string[], placeholder: string) =>
    `<h3>${esc(title)}</h3><ul class="objlist" id="${id}">${names.map((n) => `<li tabindex="0">${esc(n)}</li>`).join('') || (editable ? '' : '<li class="none">—</li>')}</ul>` +
    (editable ? `<div class="row objbar"><button class="mini" data-list="${id}" data-op="up">Move Up</button><button class="mini" data-list="${id}" data-op="down">Move Down</button>` +
      `<button class="mini" data-list="${id}" data-op="delete">Delete</button></div>` +
      `<div class="row objbar"><input type="text" id="${id}-new" placeholder="${esc(placeholder)}"><button class="mini" data-list="${id}" data-op="add">Add</button></div>` : '') +
    `<div class="hint">Custom: ${custom.length ? custom.map(esc).join(', ') : 'none'}</div>`;
  const style = `${objects('Component Style Sheet Objects', 'st-css', st.styleSheets, st.customStyleSheets, 'Freeform style sheet name')}` +
    `<h3>Theme Selection</h3>${flag('Classic Plus', 's-classic', st.classicPlus)}` +
    `${objects('Component JavaScript Objects', 'st-js', st.javaScripts, st.customJavaScripts, 'HTML definition name')}`;
  const tabs = [['general', 'General', editable ? generalEdit : general], ['use', 'Use', editable ? useEdit : use], ['internet', 'Internet', internet], ['fluid', 'Fluid', fluid], ['style', 'Style', style]];
  // App Designer shows the Style tab only when Fluid Mode is off.
  return `<div class="ptabs" role="tablist">${tabs.map(([id, label], i) => `<button class="ptab${i === 0 ? ' selected' : ''}${id === 'style' && f.fluidMode ? ' gone' : ''}" data-p="${id}">${label}</button>`).join('')}</div>` +
    tabs.map(([id, , body], i) => `<div class="ppanel${i === 0 ? ' selected' : ''}" id="pp-${id}">${body}</div>`).join('');
}

export interface ComponentHtmlOptions {
  /** A Writable connection with an operator, the name in the write scope: the grid and properties can be edited and saved. */
  editable: boolean;
  /** The toolbar's opening status (after a save re-rendered the panel). */
  status?: string;
}

export function renderComponentHtml(def: ComponentDefinition, nonce: string, options: ComponentHtmlOptions = { editable: false }): string {
  const g = def.properties.general;
  const editable = options.editable;
  const subtitle = [`${def.items.length} pages`, `v${g.version}`, editable ? 'editable' : 'read-only', g.description].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>${esc(def.name)}.${esc(def.market)}</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  header { padding: 0.5rem 1rem 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  button.action { font: inherit; padding: 0.25rem 0.8rem; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border-radius: 3px; cursor: pointer; margin-top: 0.3rem; }
  h1 { font-size: 1.1em; margin: 0; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0.1rem 0 0.4rem; }
  .tabs { display: flex; gap: 2px; padding: 0 1rem; border-bottom: 1px solid var(--vscode-panel-border, #8884); }
  .tab, .ptab { background: transparent; color: var(--vscode-foreground); border: none; border-bottom: 2px solid transparent; padding: 0.35rem 0.9rem; opacity: 0.75; cursor: pointer; font: inherit; }
  .tab.selected, .ptab.selected { opacity: 1; border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder)); }
  .main { display: flex; height: calc(100vh - 78px); }
  .content { flex: 1; min-width: 0; position: relative; }
  .panel { display: none; position: absolute; inset: 0; overflow: auto; padding: 12px 16px; } .panel.selected { display: block; }
  .grid { border-collapse: collapse; font-size: 0.9em; }
  .grid th, .grid td { border: 1px solid var(--vscode-panel-border, #8884); padding: 2px 8px; text-align: left; white-space: nowrap; }
  .grid th { background: var(--vscode-editorWidget-background, transparent); }
  .grid td.n, .grid td.c { text-align: center; }
  .cb { display: inline-block; width: 12px; height: 12px; line-height: 12px; font-size: 10px; border: 1px solid var(--vscode-descriptionForeground, #888); text-align: center; }
  ul.tree, ul.tree ul { list-style: none; margin: 0; padding-left: 1.2rem; }
  ul.tree { padding-left: 0; }
  ul.tree li { white-space: nowrap; line-height: 1.55; }
  ul.tree summary { cursor: pointer; }
  .ico { display: inline-block; width: 12px; height: 12px; margin-right: 5px; vertical-align: -1px; border-radius: 2px; }
  .ico.table { background: #3a9; } .ico.derived { background: #6bd; border-radius: 50%; } .ico.scroll { background: #888; width: 7px; } .ico.comp { background: #c93; }
  .t { color: var(--vscode-descriptionForeground); }
  .pc { margin-right: 3px; }
  .inspector { width: 340px; flex: 0 0 340px; border-left: 1px solid var(--vscode-panel-border, #8884); overflow: auto; background: var(--vscode-editorWidget-background, transparent); }
  .inspector h2 { font-size: 0.95em; margin: 12px 12px 4px; }
  .ptabs { display: flex; flex-wrap: wrap; padding: 0 8px; border-bottom: 1px solid var(--vscode-panel-border, #8884); }
  .ptab { padding: 0.25rem 0.6rem; }
  .ppanel { display: none; padding: 8px 12px; } .ppanel.selected { display: block; }
  .ppanel h3 { font-size: 0.85em; margin: 0.8rem 0 0.2rem; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.03em; }
  table.props { border-collapse: collapse; width: 100%; }
  table.props td { padding: 1px 4px; vertical-align: top; word-break: break-word; }
  table.props td.k { color: var(--vscode-descriptionForeground); width: 48%; }
  .pre { white-space: pre-wrap; }
  .hint, .none { color: var(--vscode-descriptionForeground); }
  .hint { font-size: 0.85em; }
  .toolbar { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.3rem; }
  .status { color: var(--vscode-descriptionForeground, #888); font-size: 0.9em; } .status.err { color: var(--vscode-errorForeground, #f66); }
  button.action:disabled { opacity: 0.5; cursor: default; }
  button.action.secondary { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); }
  .grid input[type=text] { font: inherit; width: 100%; box-sizing: border-box; background: transparent; color: inherit; border: 1px solid transparent; }
  .grid input[type=text]:focus { border-color: var(--vscode-focusBorder, #07f); }
  .grid tr.dragging { opacity: 0.4; } .grid tr.drop { box-shadow: inset 0 2px 0 var(--vscode-focusBorder, #07f); }
  .form label { display: block; margin: 0.4rem 0 0.1rem; color: var(--vscode-descriptionForeground, #888); }
  .form .row label { display: inline; margin: 0; color: inherit; }
  .form .row { margin: 0.25rem 0; }
  .form input[type=text], .form textarea { width: 100%; box-sizing: border-box; font: inherit; }
  .ptab.gone { display: none; }
  ul.objlist { list-style: none; margin: 0.2rem 0; padding: 2px; min-height: 2.6em; border: 1px solid var(--vscode-panel-border, #8884); }
  ul.objlist li { padding: 1px 4px; cursor: default; } ul.objlist li.sel { background: var(--vscode-list-activeSelectionBackground, #0978); }
  .objbar { gap: 0.3rem; display: flex; } .objbar input { flex: 1; font: inherit; }
  button.mini { font: inherit; font-size: 0.85em; padding: 0.05rem 0.5rem; cursor: pointer; }
  .ppanel .row { margin: 0.15rem 0; }
  .ppanel .cols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 0.6rem; }
  .ppanel select { font: inherit; }
  .menus { padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border, #8884); }
  .menus h3 { font-size: 0.85em; margin: 0 0 0.2rem; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
  .grid tbody tr { cursor: default; }
  .grid tbody tr.sel { background: var(--vscode-list-activeSelectionBackground, #0978); color: var(--vscode-list-activeSelectionForeground, inherit); }
  .ctx { position: fixed; z-index: 10; min-width: 190px; padding: 4px 0; background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #2b2b2b)); color: var(--vscode-menu-foreground, inherit);
    border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border, #8888)); box-shadow: 0 2px 8px #0005; display: none; }
  .ctx.open { display: block; }
  .ctx button { display: block; width: 100%; text-align: left; background: none; border: none; color: inherit; font: inherit; padding: 3px 16px; cursor: pointer; }
  .ctx button:hover:not(:disabled) { background: var(--vscode-menu-selectionBackground, #0978); color: var(--vscode-menu-selectionForeground, inherit); }
  .ctx button:disabled { opacity: 0.45; cursor: default; }
  .ctx hr { border: none; border-top: 1px solid var(--vscode-menu-separatorBackground, #8886); margin: 4px 0; }
</style>
</head>
<body>
  <header><div><h1>${esc(def.name)}.${esc(def.market)} (Component)</h1><p class="sub">${esc(subtitle)}</p></div>
    <div class="toolbar">${editable ? `<button class="action secondary" id="insert-page" title="Insert > Page into Component">Insert Page…</button>` +
      `<span class="status" id="status">${esc(options.status ?? 'No changes')}</span><button class="action" id="save" disabled>Save</button>` : ''}
    <button class="action" id="view-pc" title="App Designer's View > View PeopleCode">View PeopleCode${def.programs.length ? ` (${def.programs.length})` : ''}</button></div></header>
  <div class="tabs" role="tablist">
    <button class="tab selected" id="tab-definition" data-t="definition">Definition</button>
    <button class="tab" id="tab-structure" data-t="structure">Structure</button>
  </div>
  <div class="main">
    <div class="content">
      <div class="panel selected" id="panel-definition">${definitionGrid(def, editable)}</div>
      <div class="panel" id="panel-structure">${structureTree(def)}</div>
    </div>
    <aside class="inspector"><h2>Component Properties</h2>${propertiesTabs(def, editable)}
      ${def.menus.length ? `<div class="menus"><h3>On menus</h3>${def.menus.map((m) => `<div>${esc(m)}</div>`).join('')}</div>` : ''}
    </aside>
  </div>
<div class="ctx" id="ctx" role="menu">
  <button data-a="view">View Definition</button><hr>
  ${['Cut', 'Copy', 'Paste', 'Delete'].map((a) => editable ? `<button data-a="${a.toLowerCase()}">${a}</button>` :
    `<button disabled title="Read-only: a Writable connection with an Operator ID edits components">${a}</button>`).join('\n  ')}<hr>
  <button data-a="props">Component Properties</button>
</div>
<div class="ctx" id="ctx-tree" role="menu"><button data-a="pc">View PeopleCode</button></div>
<script nonce="${nonce}">
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const pick = (sel, attr, panelPrefix, v) => {
    for (const b of document.querySelectorAll(sel)) b.classList.toggle('selected', b.dataset[attr] === v);
    for (const b of document.querySelectorAll(sel)) document.getElementById(panelPrefix + b.dataset[attr]).classList.toggle('selected', b.dataset[attr] === v);
  };
  for (const b of document.querySelectorAll('.tab')) b.onclick = () => pick('.tab', 't', 'panel-', b.dataset.t);
  for (const b of document.querySelectorAll('.ptab')) b.onclick = () => pick('.ptab', 'p', 'pp-', b.dataset.p);

  // A page row: select on click; App Designer's right-click menu; double-click views the page.
  const ctx = document.getElementById('ctx');
  let row = null;
  const select = (tr) => { for (const r of document.querySelectorAll('.grid tbody tr')) r.classList.toggle('sel', r === tr); row = tr; };
  const close = () => ctx.classList.remove('open');
  const view = () => { if (row && vscode) vscode.postMessage({ type: 'openPage', page: row.dataset.page }); };
  const grid = document.querySelector('.grid tbody');
  grid.addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) select(tr); });
  grid.addEventListener('dblclick', (e) => { const tr = e.target.closest('tr'); if (tr) { select(tr); view(); } });
  grid.addEventListener('contextmenu', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    e.preventDefault(); select(tr);
    ctx.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px'; ctx.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
    ctx.classList.add('open');
  });
  ctx.addEventListener('click', (e) => {
    const a = e.target.dataset && e.target.dataset.a; if (!a) return;
    close();
    if (a === 'view') view();
    if (a === 'props') { pick('.ptab', 'p', 'pp-', 'general'); document.querySelector('.inspector').scrollTop = 0; }
  });
  // View PeopleCode: the header button (the component), or right-click a record or the component in the Structure tab.
  const viewPc = (record) => { if (vscode) vscode.postMessage({ type: 'viewPeopleCode', ...(record ? { record } : {}) }); };
  document.getElementById('view-pc').onclick = () => viewPc();
  const ctxTree = document.getElementById('ctx-tree');
  let treeRecord;
  document.getElementById('panel-structure').addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li.rec'); const root = e.target.closest('summary') && !e.target.closest('li.scroll');
    if (!li && !root) return;
    e.preventDefault(); treeRecord = li ? li.dataset.record : undefined;
    ctxTree.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px'; ctxTree.style.top = Math.min(e.clientY, window.innerHeight - 60) + 'px';
    ctxTree.classList.add('open');
  });
  ctxTree.addEventListener('click', (e) => { if (e.target.dataset && e.target.dataset.a === 'pc') { ctxTree.classList.remove('open'); viewPc(treeRecord); } });
  window.addEventListener('click', (e) => { if (!ctx.contains(e.target)) close(); if (!ctxTree.contains(e.target)) ctxTree.classList.remove('open'); });
  // Editing: the grid (labels, Hidden, order, Cut / Copy / Paste / Delete, Insert Page) and General / Use, then Save.
  const editable = ${editable};
  const saveBtn = document.getElementById('save'), status = document.getElementById('status');
  const dirty = () => { if (!editable) return; saveBtn.disabled = false; status.textContent = 'Unsaved changes'; status.classList.remove('err'); };
  const renumber = () => [...grid.querySelectorAll('tr')].forEach((tr, i) => { tr.children[0].textContent = String(i + 1); });
  let clip = null;
  if (editable) {
    grid.addEventListener('input', dirty);
    grid.addEventListener('change', dirty);
    document.querySelector('.inspector').addEventListener('input', dirty);
    document.querySelector('.inspector').addEventListener('change', dirty);
    let dragged = null;
    grid.addEventListener('dragstart', (e) => { dragged = e.target.closest('tr'); dragged.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    grid.addEventListener('dragover', (e) => { const tr = e.target.closest('tr'); if (!dragged || !tr) return; e.preventDefault(); for (const r of grid.querySelectorAll('tr.drop')) r.classList.remove('drop'); tr.classList.add('drop'); });
    grid.addEventListener('drop', (e) => { const tr = e.target.closest('tr'); e.preventDefault(); if (dragged && tr && tr !== dragged) { grid.insertBefore(dragged, tr); renumber(); dirty(); } });
    grid.addEventListener('dragend', () => { if (dragged) dragged.classList.remove('dragging'); dragged = null; for (const r of grid.querySelectorAll('tr.drop')) r.classList.remove('drop'); });
    const take = (tr) => ({ html: tr.outerHTML });
    const act = (a) => {
      if (a === 'copy' && row) clip = take(row);
      if ((a === 'cut' || a === 'delete') && row) { if (a === 'cut') clip = take(row); const next = row.nextElementSibling || row.previousElementSibling; row.remove(); select(next); renumber(); dirty(); }
      if (a === 'paste' && clip) {
        const t = document.createElement('tbody'); t.innerHTML = clip.html; const tr = t.firstElementChild;
        if ([...grid.querySelectorAll('tr')].some((r) => r.dataset.page === tr.dataset.page)) { status.textContent = tr.dataset.page + ' is already in the component.'; status.classList.add('err'); return; }
        if (row) row.after(tr); else grid.appendChild(tr); select(tr); renumber(); dirty();
      }
    };
    ctx.addEventListener('click', (e) => { const a = e.target.dataset && e.target.dataset.a; if (['cut', 'copy', 'paste', 'delete'].includes(a)) act(a); });
    document.getElementById('insert-page').onclick = () => vscode && vscode.postMessage({ type: 'insertPage', pages: [...grid.querySelectorAll('tr')].map((r) => r.dataset.page) });
    const val = (id) => document.getElementById(id).value, on = (id) => document.getElementById(id).checked;
    // Checkboxes whose id starts with a prefix, by their label: the toolbar, pagebar and header-action boxes.
    const boxes = (prefix) => Object.fromEntries([...document.querySelectorAll('input[id^="' + prefix + '"]')]
      .map((b) => [document.querySelector('label[for="' + b.id + '"]').textContent, b.checked]));
    const inspector = document.querySelector('.inspector');
    const names = (id) => [...document.getElementById(id).querySelectorAll('li:not(.none)')].map((li) => li.textContent);
    // The Style lists: select an entry, then Move Up / Move Down / Delete; Add takes the name typed.
    inspector.addEventListener('click', (e) => {
      const li = e.target.closest('ul.objlist li');
      if (li) { for (const x of li.parentElement.children) x.classList.toggle('sel', x === li); return; }
      const b = e.target.closest('button.mini'); if (!b) return;
      const list = document.getElementById(b.dataset.list), sel = list.querySelector('li.sel');
      if (b.dataset.op === 'up' && sel && sel.previousElementSibling) list.insertBefore(sel, sel.previousElementSibling);
      else if (b.dataset.op === 'down' && sel && sel.nextElementSibling) list.insertBefore(sel.nextElementSibling, sel);
      else if (b.dataset.op === 'delete' && sel) sel.remove();
      else if (b.dataset.op === 'add') {
        const input = document.getElementById(b.dataset.list + '-new'), v = input.value.trim().toUpperCase();
        if (!v) return;
        if (names(b.dataset.list).includes(v)) { status.textContent = v + ' is already in the list.'; status.classList.add('err'); return; }
        const item = document.createElement('li'); item.tabIndex = 0; item.textContent = v; list.appendChild(item); input.value = '';
      } else return;
      dirty();
    });
    const setBox = (id, v) => { const b = document.getElementById(id); if (b) b.checked = v; };
    // The boxes the Internet and Fluid tabs share move together; App Designer's own follow-on rules apply as boxes change.
    inspector.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.sync) for (const b of inspector.querySelectorAll('[data-sync="' + t.dataset.sync + '"]')) b.checked = t.checked;
      if (t.id === 'i-lastpage' || t.id === 'f-lastpage') { if (t.checked) { setBox('i-navhist', true); setBox('f-navhist', true); } }
      if (t.id === 'i-expert' && t.checked) setBox('tb-2048', true); // Allow Expert Entry turns Refresh on (i342)
      const action = { 'p-add': 16, 'p-ud': 32, 'p-uda': 64, 'p-corr': 128 }[t.id];
      if (action) setBox('tb-' + action, t.checked); // an action brings its toolbar button (c08a)
      if (t.id === 'p-nosave') setBox('tb-1', !t.checked); // Disable Saving Page drops Save (c08b)
      if (t.id === 'f-fluid') {
        inspector.querySelector('.ptab[data-p="style"]').classList.toggle('gone', t.checked);
        if (!t.checked) { setBox('ha-Notify', false); setBox('f-confsearch', false); } // fluid-only settings (s399)
      }
    });
    saveBtn.onclick = () => {
      const items = [...grid.querySelectorAll('tr')].map((tr) => ({ pageName: tr.dataset.page, itemName: tr.dataset.item,
        itemLabel: tr.querySelector('.label').value, folderTabLabel: tr.querySelector('.tab').value, hidden: tr.querySelector('.hidden').checked }));
      const properties = { description: val('p-descr'), comments: val('p-comments'), searchRecord: val('p-search').trim().toUpperCase(),
        addSearchRecord: val('p-addsearch').trim().toUpperCase(), detailPage: val('p-detail').trim().toUpperCase(), forceSearch: on('p-force'),
        actions: { add: on('p-add'), updateDisplay: on('p-ud'), updateDisplayAll: on('p-uda'), correction: on('p-corr') },
        disableSave: on('p-nosave'), includeInNavigation: on('p-nav'),
        internet: { primaryAction: Number(val('i-primary')), defaultSearchType: Number(val('i-stype')), allowActionModeSelection: on('i-actmode'),
          deferred: on('i-deferred'), expertEntry: on('i-expert'), wsrpCompliant: on('i-wsrp'), disableToolbar: on('i-notoolbar'),
          toolbar: boxes('tb-'), folderTabs: on('i-tabs'), hyperlinks: on('i-links'), pageNavigationInHistory: on('i-navhist'),
          returnToLastPageInHistory: on('i-lastpage'), pagebar: boxes('pb-'), disablePagebar: on('i-nopagebar') },
        fluid: { fluidMode: on('f-fluid'), layoutOnly: on('f-layout'), smallFormFactor: on('f-small'), noSystemHeader: on('f-noheader'),
          noSystemSide: on('f-noside'), componentType: Number(val('f-ctype')), searchPageType: Number(val('f-stype')),
          configurableSearch: on('f-confsearch'), headerActions: boxes('ha-'), disableAllActions: on('f-noactions') },
        style: { classicPlus: on('s-classic'), styleSheets: names('st-css'), javaScripts: names('st-js') } };
      if (!properties.searchRecord) { status.textContent = 'Add a search record (Component Properties > Use) before saving.'; status.classList.add('err'); pick('.ptab', 'p', 'pp-', 'use'); document.getElementById('p-search').focus(); return; }
      saveBtn.disabled = true; status.textContent = 'Saving…'; status.classList.remove('err');
      vscode.postMessage({ type: 'save', items, properties });
    };
    window.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m.type === 'pageInserted') { const t = document.createElement('tbody'); t.innerHTML = m.row; const tr = t.firstElementChild; grid.appendChild(tr); select(tr); renumber(); dirty(); }
      if (m.type === 'error') { saveBtn.disabled = false; status.textContent = m.message; status.classList.add('err'); }
    });
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && row && document.activeElement === row) view(); });
</script>
</body>
</html>`;
}
