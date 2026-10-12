/*
 * A menu as an editable document: every column of every row it is stored in
 * (PSMENUDEFN, PSMENUITEM, PSXFERITEM, the language and origin rows; see
 * docs/MENUS.md), typed, so a document read and saved unchanged writes
 * nothing and an edit writes only what it changed. The Menu Designer, the
 * MCP tools and the writer (providers/menuWriter.ts) share it.
 *
 * Operations reproduce App Designer's Menu Designer: its default names,
 * defaults and checks, each proven by a controlled save (the case in
 * brackets, tools/corpus/save-protocol/results). They return a new document.
 *
 * Bars and items loaded from the database carry `origin`, their stored
 * identity, so a save can tell a rename or a move (PeopleCode moved, the old
 * key tombstoned) from a delete and an insert.
 */

export type Row = Record<string, unknown>;

export const MENU_NAME_MAX = 30;
export const BAR_NAME_MAX = 30;
export const ITEM_NAME_MAX = 30;
export const MENU_LABEL_MAX = 30;
export const MENU_GROUP_MAX = 30;
export const BAR_LABEL_MAX = 10;
export const ITEM_LABEL_MAX = 30;
export const DESCR_MAX = 30;
export const COMPONENT_MAX = 18;
export const SEARCH_RECORD_MAX = 15;
/** Menu Order / Menu Group Order "Alphabetical order" [mn07]. */
export const ALPHABETICAL = 9999;
/** The one bar of a popup menu: its items are stored under it [mp01]. */
export const POPUP_BAR = 'MENUITEM1';
/** Menu PeopleCode: menu, bar, item, ItemSelected (PSPCMPROG OBJECTIDs 3, 4, 5, 12) [mi06]. */
export const MENU_PC_IDS = [3, 4, 5, 12, 0, 0, 0] as const;
export const MENU_PC_EVENT = 'ItemSelected';

export type MenuType = 0 | 1;
export const MENU_TYPE_LABELS: Readonly<Record<MenuType, string>> = { 0: 'Standard', 1: 'Popup' };

/** PSMENUITEM.ITEMTYPE. */
export type MenuItemType = 5 | 8 | 9 | 12;
export const ITEM_TYPE_LABELS: Readonly<Record<MenuItemType, string>> = { 5: 'Component', 8: 'Separator', 9: 'PeopleCode', 12: 'Transfer' };
/** The item types App Designer offers on each kind of menu (Menu Item Properties' Type). */
export const ITEM_TYPES_BY_MENU: Readonly<Record<MenuType, readonly MenuItemType[]>> = { 0: [5, 9, 8], 1: [12, 9, 8] };

/** PSXFERITEM.XFERACTION as Transfer Properties' Action lists it [mp02-mp04]. */
export const TRANSFER_ACTIONS: Readonly<Record<number, string>> = { 0: 'Add', 1: 'Update/Display', 2: 'Update/Display All', 3: 'Correction' };

export interface MenuTransfer {
  /** XFERPORTALNAME: blank is "Use Current" [mp07]. */
  portal: string;
  /** XFERNODENAME: blank is LOCAL. */
  node: string;
  menu: string;
  component: string;
  market: string;
  /** XFERPNLITEMNAME: the component's page. */
  page: string;
  /** XFERACTION (TRANSFER_ACTIONS). */
  action: number;
  /** XFERTYPE 1: "Use new window (minimize current window)" [mp05]. */
  newWindow: boolean;
  /** KEYSEARCH 1: "Use data from current page in search dialog" [mp06]. */
  useData: boolean;
}

export interface MenuDocItem {
  name: string;
  label: string;
  type: MenuItemType;
  /** PNLGRPNAME / MARKET: the component (type 5) or enabling component (type 9). */
  component: string;
  market: string;
  /** SEARCHRECNAME: blank unless Search Rec Override [mi03]. */
  searchRecord: string;
  /** ItemSelected PeopleCode (type 9); undefined when there is none. */
  peopleCode?: string;
  transfer?: MenuTransfer;
  /** PSMENUITEMLANG rows, kept and re-keyed with the item. */
  languages: Row[];
  /** XFERCOUNT as stored (the writer keeps it consistent with the transfer). */
  xferCount: number;
  origin?: { bar: string; item: string };
}

export interface MenuDocBar {
  name: string;
  /** BARLABEL, repeated on every item of the bar (bars exist only through their items). */
  label: string;
  items: MenuDocItem[];
  origin?: string;
}

export interface MenuDocument {
  name: string;
  type: MenuType;
  descr: string;
  descrlong: string | null;
  owner: string;
  label: string;
  group: string;
  /** MENUORDER / GROUPORDER: 9999 is Alphabetical order. */
  menuOrder: number;
  menuSeparator: boolean;
  groupOrder: number;
  groupSeparator: boolean;
  installed: boolean;
  bars: MenuDocBar[];
  /** PSMENUDEFNLANG rows, kept. */
  languages: Row[];
  /** PSMENUORIGIN rows (PTORIGINTYPE C: copied from, R: renamed from), kept. */
  origins: { type: string; name: string }[];
  /** The stored stamp, read-only (the save sets it). */
  version?: number;
  lastUpdated?: string;
  lastUpdatedBy?: string;
  /** Save As: the menu this one was copied from (a PSMENUORIGIN C row) [mn12]. */
  copiedFrom?: string;
  /** The stored group membership when read, for group-wide saves. */
  storedGroup?: { group: string; groupOrder: number; groupSeparator: boolean };
}

export interface MenuRows {
  menu: Row;
  items: Row[];
  transfers: Row[];
  languages: Row[];
  itemLanguages: Row[];
  origins: Row[];
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const trim = (v: unknown) => str(v).trim();
const num = (v: unknown) => Number(v ?? 0) || 0;
const blank = (v: string) => (v === '' ? ' ' : v);

export const pcKeyOf = (bar: string, item: string) => `${bar}|${item}`;

/** The document of stored rows; peopleCode maps bar|item to the ItemSelected source. */
export function documentFromRows(rows: MenuRows, peopleCode: ReadonlyMap<string, string> = new Map()): MenuDocument {
  const m = rows.menu;
  const type = (num(m.MENUTYPE) === 1 ? 1 : 0) as MenuType;
  const items = [...rows.items].sort((a, b) => num(a.ITEMNUM) - num(b.ITEMNUM));
  const bars: MenuDocBar[] = [];
  for (const r of items) {
    const barName = trim(r.BARNAME);
    let bar = bars.find((b) => b.name === barName);
    if (!bar) {
      bar = { name: barName, label: trim(r.BARLABEL), items: [], origin: barName };
      bars.push(bar);
    }
    const itemName = trim(r.ITEMNAME);
    const x = rows.transfers.find((t) => trim(t.ITEMNAME) === itemName);
    const item: MenuDocItem = {
      name: itemName, label: trim(r.ITEMLABEL), type: num(r.ITEMTYPE) as MenuItemType,
      component: trim(r.PNLGRPNAME), market: trim(r.MARKET), searchRecord: trim(r.SEARCHRECNAME),
      languages: rows.itemLanguages.filter((l) => trim(l.BARNAME) === barName && trim(l.ITEMNAME) === itemName),
      xferCount: num(r.XFERCOUNT), origin: { bar: barName, item: itemName }
    };
    if (x) item.transfer = transferOf(x);
    const pc = peopleCode.get(pcKeyOf(barName, itemName));
    if (pc !== undefined) item.peopleCode = pc;
    bar.items.push(item);
  }
  const doc: MenuDocument = {
    name: trim(m.MENUNAME), type, descr: trim(m.DESCR), descrlong: m.DESCRLONG === null || m.DESCRLONG === undefined ? null : str(m.DESCRLONG),
    owner: trim(m.OBJECTOWNERID), label: trim(m.MENULABEL), group: trim(m.MENUGROUP),
    menuOrder: num(m.MENUORDER), menuSeparator: num(m.MENUSEP) === 1, groupOrder: num(m.GROUPORDER), groupSeparator: num(m.GROUPSEP) === 1,
    installed: num(m.INSTALLED) === 1, bars, languages: rows.languages.map((r) => ({ ...r })),
    origins: rows.origins.map((r) => ({ type: trim(r.PTORIGINTYPE), name: trim(r.PTORIGINNAME) })),
    version: num(m.VERSION), lastUpdated: str(m.LASTUPDDTTM), lastUpdatedBy: trim(m.LASTUPDOPRID)
  };
  doc.storedGroup = { group: doc.group, groupOrder: doc.groupOrder, groupSeparator: doc.groupSeparator };
  return doc;
}

function transferOf(x: Row): MenuTransfer {
  return {
    portal: trim(x.XFERPORTALNAME), node: trim(x.XFERNODENAME), menu: trim(x.XFERMENUNAME), component: trim(x.XFERPNLGRPNAME),
    market: trim(x.XFERMKTNAME), page: trim(x.XFERPNLITEMNAME), action: num(x.XFERACTION), newWindow: num(x.XFERTYPE) === 1, useData: num(x.KEYSEARCH) === 1
  };
}

export interface MenuPeopleCode { bar: string; item: string; source: string; origin?: { bar: string; item: string } }

export interface MenuDesiredRows extends MenuRows { peopleCode: MenuPeopleCode[] }

/** The rows the document is stored as (VERSION / LASTUPDDTTM / LASTUPDOPRID are the save's). */
export function rowsFromDocument(doc: MenuDocument): MenuDesiredRows {
  const name = doc.name;
  const menu: Row = {
    MENUNAME: name, MENUGROUP: blank(doc.group), INSTALLED: doc.installed ? 1 : 0, GROUPORDER: doc.groupOrder, MENUORDER: doc.menuOrder,
    GROUPSEP: doc.groupSeparator ? 1 : 0, MENUSEP: doc.menuSeparator ? 1 : 0, MENULABEL: blank(doc.label), MENUTYPE: doc.type,
    DESCR: blank(doc.descr), OBJECTOWNERID: blank(doc.owner), DESCRLONG: doc.descrlong
  };
  const items: Row[] = [];
  const transfers: Row[] = [];
  const itemLanguages: Row[] = [];
  const peopleCode: MenuPeopleCode[] = [];
  let n = 0;
  for (const bar of doc.bars) {
    for (const it of bar.items) {
      n++;
      const sep = it.type === 8;
      items.push({
        MENUNAME: name, BARNAME: bar.name, ITEMNAME: it.name, ITEMNUM: n, ITEMTYPE: it.type,
        PNLGRPNAME: blank(sep || it.type === 12 ? '' : it.component), MARKET: blank(sep || it.type === 12 ? '' : it.market),
        BARLABEL: blank(doc.type === 1 ? '' : bar.label), ITEMLABEL: blank(sep ? '' : it.label),
        XFERCOUNT: it.type === 12 && it.transfer ? 1 : 0, SEARCHRECNAME: blank(it.type === 5 ? it.searchRecord : '')
      });
      if (it.type === 12 && it.transfer) {
        const x = it.transfer;
        transfers.push({
          MENUNAME: name, ITEMNAME: it.name, XFERTYPE: x.newWindow ? 1 : 0, KEYSEARCH: x.useData ? 1 : 0,
          XFERPORTALNAME: blank(x.portal), XFERNODENAME: blank(x.node), XFERMENUNAME: blank(x.menu), XFERPNLGRPNAME: blank(x.component),
          XFERMKTNAME: blank(x.market), XFERPNLITEMNAME: blank(x.page), XFERACTION: x.action
        });
      }
      for (const l of it.languages) itemLanguages.push({ ...l, MENUNAME: name, BARNAME: bar.name, ITEMNAME: it.name });
      if (it.type === 9 && it.peopleCode !== undefined && it.peopleCode.trim() !== '') {
        peopleCode.push({ bar: bar.name, item: it.name, source: it.peopleCode, ...(it.origin ? { origin: it.origin } : {}) });
      }
    }
  }
  return {
    menu, items, transfers, itemLanguages, peopleCode,
    languages: doc.languages.map((r) => ({ ...r, MENUNAME: name })),
    origins: [...doc.origins, ...(doc.copiedFrom && !doc.origins.length ? [{ type: 'C', name: doc.copiedFrom }] : [])]
      .map((o) => ({ MENUNAME: name, PTORIGINTYPE: o.type, PTORIGINNAME: o.name }))
  };
}

/** The PSPCMPROG key of an item's ItemSelected program. */
export function menuPeopleCodeKey(menu: string, bar: string, item: string): string[] {
  return [menu, bar, item, MENU_PC_EVENT, ' ', ' ', ' '];
}

// ---------------------------------------------------------------------------
// Names and defaults

export const NAME_PATTERN = /^[A-Z0-9_#@$]+$/;

export class MenuEditError extends Error {
  constructor(message: string) { super(message); this.name = 'MenuEditError'; }
}

/** App Designer's new menu name derived label and group: ZZ_PCODE_LAB_MENU -> "Zz Pcode Lab Menu" [mn01]. */
export function titleCase(name: string): string {
  return name.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ').slice(0, MENU_LABEL_MAX);
}

/** MENUITEMn, the smallest n not taken [mi04, mi05, mb01]. */
export function nextName(taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let n = 1; ; n++) if (!set.has(`MENUITEM${n}`)) return `MENUITEM${n}`;
}

export const allItems = (doc: MenuDocument) => doc.bars.flatMap((b) => b.items.map((item) => ({ bar: b, item })));
export const nextItemName = (doc: MenuDocument) => nextName(allItems(doc).map((x) => x.item.name));
export const nextBarName = (doc: MenuDocument) => nextName(doc.bars.map((b) => b.name));

/**
 * A new menu as App Designer's File > New > Menu makes it: Standard with a
 * USE bar (its first item still to add), or Popup [mn01, mp01].
 */
export function newMenu(name: string, type: MenuType): MenuDocument {
  const standard = type === 0;
  return {
    name, type, descr: '', descrlong: null, owner: '', label: standard ? titleCase(name) : '', group: standard ? titleCase(name) : '',
    menuOrder: standard ? ALPHABETICAL : 0, menuSeparator: false, groupOrder: standard ? ALPHABETICAL : 0, groupSeparator: false, installed: true,
    bars: standard ? [] : [{ name: POPUP_BAR, label: '', items: [] }], languages: [], origins: []
  };
}

export function newItem(type: MenuItemType, name: string): MenuDocItem {
  return { name, label: '', type, component: '', market: '', searchRecord: '', languages: [], xferCount: 0,
    ...(type === 12 ? { transfer: newTransfer() } : {}) };
}

export function newTransfer(): MenuTransfer {
  return { portal: '', node: '', menu: '', component: '', market: '', page: '', action: 1, newWindow: false, useData: true };
}

// ---------------------------------------------------------------------------
// Operations

export interface ItemRef { bar: string; item: string }

const clone = <T>(v: T): T => structuredClone(v);

export function findBar(doc: MenuDocument, name: string): MenuDocBar {
  const b = doc.bars.find((x) => x.name === name);
  if (!b) throw new MenuEditError(`${doc.name} has no bar ${name}.`);
  return b;
}

export function findItem(doc: MenuDocument, ref: ItemRef): { bar: MenuDocBar; item: MenuDocItem; index: number } {
  const bar = findBar(doc, ref.bar);
  const index = bar.items.findIndex((i) => i.name === ref.item);
  if (index < 0) throw new MenuEditError(`Bar ${ref.bar} has no item ${ref.item}.`);
  return { bar, item: bar.items[index], index };
}

export function checkName(name: string, max: number, what: string): string {
  const n = name.trim().toUpperCase();
  if (!n) throw new MenuEditError(`A ${what} name is required.`);
  if (n.length > max) throw new MenuEditError(`A ${what} name is at most ${max} characters.`);
  if (!NAME_PATTERN.test(n)) throw new MenuEditError(`${n}: a ${what} name has only A-Z, 0-9, _, #, @ and $.`);
  return n;
}

function checkLabel(label: string, max: number, what: string): string {
  if (label.length > max) throw new MenuEditError(`A ${what} label is at most ${max} characters.`);
  return label;
}

/** Bar Item Properties on the empty bar slot: a new bar (default name MENUITEMn) [mb01]. */
export function insertBar(doc: MenuDocument, opts: { name?: string; label?: string; index?: number } = {}): { doc: MenuDocument; bar: string } {
  if (doc.type === 1) throw new MenuEditError('A popup menu has no bars.');
  const next = clone(doc);
  const name = opts.name ? checkName(opts.name, BAR_NAME_MAX, 'bar') : nextBarName(next);
  if (next.bars.some((b) => b.name === name)) throw new MenuEditError(`${doc.name} already has a bar ${name}.`);
  const bar: MenuDocBar = { name, label: checkLabel(opts.label ?? '', BAR_LABEL_MAX, 'bar'), items: [] };
  const at = opts.index === undefined ? next.bars.length : Math.max(0, Math.min(opts.index, next.bars.length));
  next.bars.splice(at, 0, bar);
  return { doc: next, bar: name };
}

export interface ItemSpec {
  name?: string;
  label?: string;
  type?: MenuItemType;
  component?: string;
  market?: string;
  searchRecord?: string;
  peopleCode?: string;
  transfer?: Partial<MenuTransfer>;
}

/** Menu Item Properties on a bar's empty slot (or a popup's): a new item [mi01, mi04, mi05, mp01, mp09]. */
export function insertItem(doc: MenuDocument, bar: string, spec: ItemSpec = {}, index?: number): { doc: MenuDocument; item: string } {
  const next = clone(doc);
  const b = findBar(next, doc.type === 1 ? POPUP_BAR : bar);
  const type = spec.type ?? (doc.type === 1 ? 9 : 5);
  if (!ITEM_TYPES_BY_MENU[doc.type].includes(type)) throw new MenuEditError(`A ${MENU_TYPE_LABELS[doc.type].toLowerCase()} menu has no ${ITEM_TYPE_LABELS[type]} items.`);
  // A separator keeps its default name [mi04].
  const name = type === 8 || !spec.name ? nextItemName(next) : checkName(spec.name, ITEM_NAME_MAX, 'item');
  if (itemNameTaken(next, b.name, name)) throw new MenuEditError(`${name} is already an item ${doc.type === 1 ? 'of this menu' : `of bar ${b.name}`}.`);
  const item = applyItemSpec(newItem(type, name), { ...spec, type }, doc.type);
  const at = index === undefined ? b.items.length : Math.max(0, Math.min(index, b.items.length));
  b.items.splice(at, 0, item);
  return { doc: next, item: name };
}

/** Item names are PSMENUITEM keys within a bar; transfers (PSXFERITEM) key them by menu, so a popup's are unique in it. */
function itemNameTaken(doc: MenuDocument, bar: string, name: string, except?: MenuDocItem): boolean {
  if (doc.type === 1) return allItems(doc).some((x) => x.item !== except && x.item.name === name);
  return findBar(doc, bar).items.some((i) => i !== except && i.name === name);
}

function applyItemSpec(item: MenuDocItem, spec: ItemSpec, menuType: MenuType): MenuDocItem {
  const it = item;
  if (spec.type !== undefined && spec.type !== it.type) {
    if (!ITEM_TYPES_BY_MENU[menuType].includes(spec.type)) throw new MenuEditError(`A ${MENU_TYPE_LABELS[menuType].toLowerCase()} menu has no ${ITEM_TYPE_LABELS[spec.type]} items.`);
    it.type = spec.type;
    if (it.type === 12 && !it.transfer) it.transfer = newTransfer();
    if (it.type !== 12) delete it.transfer;
    if (it.type !== 9) delete it.peopleCode;
    if (it.type !== 5) it.searchRecord = '';
    if (it.type === 12 || it.type === 8) { it.component = ''; it.market = ''; }
  }
  if (it.type === 8) { it.label = ''; return it; }
  if (spec.label !== undefined) it.label = checkLabel(spec.label, ITEM_LABEL_MAX, 'item');
  if (spec.component !== undefined && it.type !== 12) {
    const c = spec.component.trim().toUpperCase();
    if (c.length > COMPONENT_MAX) throw new MenuEditError(`A component name is at most ${COMPONENT_MAX} characters.`);
    it.component = c;
    if (spec.market === undefined && c && !it.market) it.market = 'GBL';
    if (!c) it.market = '';
  }
  if (spec.market !== undefined && it.type !== 12) {
    const m = spec.market.trim().toUpperCase();
    if (m.length > 3) throw new MenuEditError('A market is at most 3 characters.');
    it.market = m;
  }
  if (spec.searchRecord !== undefined && it.type === 5) {
    const r = spec.searchRecord.trim().toUpperCase();
    if (r.length > SEARCH_RECORD_MAX) throw new MenuEditError(`A search record name is at most ${SEARCH_RECORD_MAX} characters.`);
    it.searchRecord = r;
  }
  if (spec.peopleCode !== undefined && it.type === 9) it.peopleCode = spec.peopleCode;
  if (spec.transfer && it.type === 12) it.transfer = setTransferFields(it.transfer ?? newTransfer(), spec.transfer);
  return it;
}

/**
 * Transfer Properties: a field set clears the ones that depend on it, as the
 * dialog's lists do -- Portal or Node clears Menu and below, Menu clears
 * Component and below, Component clears Market, Page and Action [mp07, mp08].
 */
export function setTransferFields(x: MenuTransfer, patch: Partial<MenuTransfer>): MenuTransfer {
  const t = { ...x };
  const up = (v: string | undefined) => (v === undefined ? undefined : v.trim().toUpperCase());
  const order: (keyof MenuTransfer)[] = ['portal', 'node', 'menu', 'component', 'market', 'page', 'action'];
  const clearBelow = (k: keyof MenuTransfer) => {
    const from = order.indexOf(k) + 1;
    for (const f of order.slice(from)) {
      if (patch[f] !== undefined) continue;
      if (f === 'action') t.action = 1; else (t as Record<string, unknown>)[f] = '';
    }
  };
  for (const k of ['portal', 'node', 'menu', 'component'] as const) {
    const raw = up(patch[k]);
    const v = raw === undefined ? undefined : k === 'portal' && raw === 'USE CURRENT' ? '' : k === 'node' && raw === 'LOCAL' ? '' : raw;
    if (v !== undefined && v !== t[k]) {
      t[k] = v;
      clearBelow(k === 'portal' ? 'node' : k);
    }
  }
  if (patch.market !== undefined) t.market = patch.market.trim().toUpperCase();
  if (patch.page !== undefined) t.page = patch.page.trim().toUpperCase();
  if (patch.action !== undefined) t.action = Number(patch.action);
  if (patch.newWindow !== undefined) t.newWindow = patch.newWindow;
  if (patch.useData !== undefined) t.useData = patch.useData;
  // Without a component the search-dialog option is off and greyed [mp07].
  if (!t.component) t.useData = false;
  return t;
}

/** Menu Item Properties: name (a rename), label, type, component, search record override, transfer [mi02, mi03, mi08]. */
export function setItem(doc: MenuDocument, ref: ItemRef, spec: ItemSpec): MenuDocument {
  const next = clone(doc);
  const { bar, item } = findItem(next, ref);
  if (spec.name !== undefined && item.type !== 8) {
    const name = checkName(spec.name, ITEM_NAME_MAX, 'item');
    if (name !== item.name) {
      if (itemNameTaken(next, bar.name, name, item)) throw new MenuEditError(`${name} is already an item of bar ${bar.name}.`);
      item.name = name;
    }
  }
  applyItemSpec(item, { ...spec, name: undefined }, doc.type);
  return next;
}

/** Bar Item Properties: name (a rename of every item's key) and label [mb02, mb05]. */
export function setBar(doc: MenuDocument, name: string, patch: { name?: string; label?: string }): MenuDocument {
  if (doc.type === 1) throw new MenuEditError('A popup menu has no bars.');
  const next = clone(doc);
  const bar = findBar(next, name);
  if (patch.name !== undefined) {
    const to = checkName(patch.name, BAR_NAME_MAX, 'bar');
    if (to !== bar.name && next.bars.some((b) => b.name === to)) throw new MenuEditError(`${doc.name} already has a bar ${to}.`);
    bar.name = to;
  }
  if (patch.label !== undefined) bar.label = checkLabel(patch.label, BAR_LABEL_MAX, 'bar');
  return next;
}

/** Delete on an item: its PeopleCode goes with it [mi10, mi11, mi12]. */
export function deleteItem(doc: MenuDocument, ref: ItemRef): MenuDocument {
  const next = clone(doc);
  const { bar, index } = findItem(next, ref);
  bar.items.splice(index, 1);
  // A bar with no items is not stored: it goes at the save [mi14].
  return next;
}

/** Delete on a bar: the bar and every item [mb07]. */
export function deleteBar(doc: MenuDocument, name: string): MenuDocument {
  if (doc.type === 1) throw new MenuEditError('A popup menu has no bars.');
  const next = clone(doc);
  const i = next.bars.findIndex((b) => b.name === name);
  if (i < 0) throw new MenuEditError(`${doc.name} has no bar ${name}.`);
  next.bars.splice(i, 1);
  return next;
}

/**
 * Drag within a bar, or Cut and Paste into another bar [mi07, mi14]: the item
 * at index of the target bar. Moving it to another bar re-keys it.
 */
export function moveItem(doc: MenuDocument, ref: ItemRef, to: { bar: string; index: number }): MenuDocument {
  const next = clone(doc);
  const { bar, item, index } = findItem(next, ref);
  const target = findBar(next, doc.type === 1 ? POPUP_BAR : to.bar);
  if (target !== bar && itemNameTaken(next, target.name, item.name)) throw new MenuEditError(`${item.name} is already an item of bar ${target.name}.`);
  bar.items.splice(index, 1);
  const at = Math.max(0, Math.min(to.index, target.items.length));
  target.items.splice(at, 0, item);
  return next;
}

/** Drag a bar along the menu bar [mb06]. */
export function moveBar(doc: MenuDocument, name: string, index: number): MenuDocument {
  const next = clone(doc);
  const i = next.bars.findIndex((b) => b.name === name);
  if (i < 0) throw new MenuEditError(`${doc.name} has no bar ${name}.`);
  const [bar] = next.bars.splice(i, 1);
  next.bars.splice(Math.max(0, Math.min(index, next.bars.length)), 0, bar);
  return next;
}

/** Paste of a copied item: a new item (its name made unique), PeopleCode with it. */
export function pasteItem(doc: MenuDocument, copied: MenuDocItem, to: { bar: string; index?: number }): { doc: MenuDocument; item: string } {
  const next = clone(doc);
  const target = findBar(next, doc.type === 1 ? POPUP_BAR : to.bar);
  if (!ITEM_TYPES_BY_MENU[doc.type].includes(copied.type)) throw new MenuEditError(`A ${MENU_TYPE_LABELS[doc.type].toLowerCase()} menu has no ${ITEM_TYPE_LABELS[copied.type]} items.`);
  const item = clone(copied);
  delete item.origin;
  if (copied.type === 8 || itemNameTaken(next, target.name, item.name)) item.name = nextItemName(next);
  target.items.splice(to.index === undefined ? target.items.length : Math.max(0, Math.min(to.index, target.items.length)), 0, item);
  return { doc: next, item: item.name };
}

export interface MenuPatch {
  descr?: string;
  descrlong?: string | null;
  owner?: string;
  label?: string;
  group?: string;
  menuOrder?: number;
  menuSeparator?: boolean;
  groupOrder?: number;
  groupSeparator?: boolean;
  installed?: boolean;
}

/** Menu Properties' General and Use tabs [mn02-mn11]. A popup's Use tab has only Menu Label [mp11]. */
export function setMenu(doc: MenuDocument, patch: MenuPatch, groups: ReadonlyMap<string, { order: number; separator: boolean }> = new Map()): MenuDocument {
  const next = clone(doc);
  if (patch.descr !== undefined) { if (patch.descr.length > DESCR_MAX) throw new MenuEditError(`A description is at most ${DESCR_MAX} characters.`); next.descr = patch.descr; }
  if (patch.descrlong !== undefined) next.descrlong = patch.descrlong === '' ? null : patch.descrlong;
  if (patch.owner !== undefined) next.owner = patch.owner.trim();
  if (patch.label !== undefined) next.label = checkLabel(patch.label, MENU_LABEL_MAX, 'menu');
  const popupOnly = ['group', 'menuOrder', 'menuSeparator', 'groupOrder', 'groupSeparator', 'installed'] as const;
  if (doc.type === 1 && popupOnly.some((k) => patch[k] !== undefined)) throw new MenuEditError('A popup menu has only a Menu Label on its Use tab.');
  if (patch.group !== undefined) {
    const g = patch.group.trim();
    if (g.length > MENU_GROUP_MAX) throw new MenuEditError(`A menu group is at most ${MENU_GROUP_MAX} characters.`);
    next.group = g;
    // Choosing a group from the list shows that group's order and separator (they are the group's).
    const known = groups.get(g);
    if (known && g !== doc.group) {
      if (patch.groupOrder === undefined) next.groupOrder = known.order;
      if (patch.groupSeparator === undefined) next.groupSeparator = known.separator;
    }
  }
  const order = (v: number, what: string) => {
    if (!Number.isInteger(v) || v < 0 || v > ALPHABETICAL) throw new MenuEditError(`${what} is a whole number from 0 to ${ALPHABETICAL} (${ALPHABETICAL}: alphabetical).`);
    return v;
  };
  if (patch.menuOrder !== undefined) next.menuOrder = order(patch.menuOrder, 'Menu Order');
  if (patch.groupOrder !== undefined) next.groupOrder = order(patch.groupOrder, 'Menu Group Order');
  if (patch.menuSeparator !== undefined) next.menuSeparator = patch.menuSeparator;
  if (patch.groupSeparator !== undefined) next.groupSeparator = patch.groupSeparator;
  if (patch.installed !== undefined) next.installed = patch.installed;
  return next;
}

/** Save As: the document under a new name, its origin a copy [mn12]. PeopleCode is copied when asked. */
export function copyMenu(doc: MenuDocument, name: string, withPeopleCode: boolean): MenuDocument {
  const to = checkName(name, MENU_NAME_MAX, 'menu');
  const next = clone(doc);
  next.name = to;
  next.copiedFrom = doc.name;
  next.origins = [];
  delete next.version; delete next.lastUpdated; delete next.lastUpdatedBy; delete next.storedGroup;
  for (const b of next.bars) {
    delete b.origin;
    for (const it of b.items) {
      delete it.origin;
      if (!withPeopleCode) delete it.peopleCode;
    }
  }
  return next;
}
