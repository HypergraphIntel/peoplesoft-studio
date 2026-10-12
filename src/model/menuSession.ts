import {
  allItems, BAR_LABEL_MAX, BAR_NAME_MAX, COMPONENT_MAX, copyMenu, deleteBar, deleteItem, DESCR_MAX, insertBar, insertItem, ITEM_LABEL_MAX,
  ITEM_NAME_MAX, ITEM_TYPE_LABELS, ITEM_TYPES_BY_MENU, MENU_GROUP_MAX, MENU_LABEL_MAX, MENU_NAME_MAX, MenuEditError, moveBar, moveItem,
  NAME_PATTERN, pasteItem, SEARCH_RECORD_MAX, setBar, setItem, setMenu,
  type ItemRef, type ItemSpec, type MenuDocItem, type MenuDocument, type MenuPatch
} from './menuDocument.js';

/*
 * Editing a menu: operations (MenuOp) applied with App Designer's rules
 * (menuDocument.ts), App Designer's save checks (validateMenu), and a session
 * with undo / redo, shared by the Menu Designer and the MCP tools.
 */

export type MenuOp =
  | { kind: 'setMenu'; patch: MenuPatch }
  | { kind: 'insertBar'; name?: string; label?: string; index?: number }
  | { kind: 'setBar'; bar: string; name?: string; label?: string }
  | { kind: 'deleteBar'; bar: string }
  | { kind: 'moveBar'; bar: string; index: number }
  | { kind: 'insertItem'; bar: string; index?: number; item: ItemSpec }
  | { kind: 'setItem'; ref: ItemRef; item: ItemSpec }
  | { kind: 'deleteItem'; ref: ItemRef }
  | { kind: 'moveItem'; ref: ItemRef; bar: string; index: number }
  | { kind: 'pasteItem'; item: MenuDocItem; bar: string; index?: number };

/** Applies one operation; throws MenuEditError when App Designer would not make it. */
export function applyMenuOp(doc: MenuDocument, op: MenuOp, groups?: ReadonlyMap<string, { order: number; separator: boolean }>): MenuDocument {
  switch (op.kind) {
    case 'setMenu': return setMenu(doc, op.patch, groups);
    case 'insertBar': return insertBar(doc, op).doc;
    case 'setBar': return setBar(doc, op.bar, { ...(op.name !== undefined ? { name: op.name } : {}), ...(op.label !== undefined ? { label: op.label } : {}) });
    case 'deleteBar': return deleteBar(doc, op.bar);
    case 'moveBar': return moveBar(doc, op.bar, op.index);
    case 'insertItem': return insertItem(doc, op.bar, op.item, op.index).doc;
    case 'setItem': return setItem(doc, op.ref, op.item);
    case 'deleteItem': return deleteItem(doc, op.ref);
    case 'moveItem': return moveItem(doc, op.ref, { bar: op.bar, index: op.index });
    case 'pasteItem': return pasteItem(doc, op.item, { bar: op.bar, ...(op.index !== undefined ? { index: op.index } : {}) }).doc;
  }
}

/** Where an operation leaves the selection. */
export function menuSelectionAfter(before: MenuDocument, after: MenuDocument, op: MenuOp): MenuSelection | undefined {
  switch (op.kind) {
    case 'insertBar': return { bar: after.bars.find((b) => !before.bars.some((x) => x.name === b.name))?.name };
    case 'setBar': return { bar: op.name?.trim().toUpperCase() || op.bar };
    case 'insertItem': case 'pasteItem': {
      const had = new Set(allItems(before).map((x) => `${x.bar.name}|${x.item.name}`));
      const added = allItems(after).find((x) => !had.has(`${x.bar.name}|${x.item.name}`));
      return added ? { bar: added.bar.name, item: added.item.name } : undefined;
    }
    case 'setItem': return { bar: op.ref.bar, item: op.item.name?.trim().toUpperCase() || op.ref.item };
    case 'moveItem': return { bar: op.bar, item: op.ref.item };
    case 'moveBar': return { bar: op.bar };
    default: return undefined;
  }
}

export interface MenuSelection { bar?: string | undefined; item?: string }

export type Severity = 'error' | 'warning' | 'info';

export interface MenuDiagnostic {
  severity: Severity;
  code: string;
  path: string;
  message: string;
  at?: MenuSelection;
}

/**
 * App Designer's checks: what its Save refuses (errors, with its message
 * numbers) and what its dialogs cannot produce; warnings for what it saves
 * but that will not work.
 */
export function validateMenu(doc: MenuDocument): MenuDiagnostic[] {
  const out: MenuDiagnostic[] = [];
  const err = (code: string, path: string, message: string, at?: MenuSelection) => out.push({ severity: 'error', code, path, message, ...(at ? { at } : {}) });
  const warn = (code: string, path: string, message: string, at?: MenuSelection) => out.push({ severity: 'warning', code, path, message, ...(at ? { at } : {}) });
  const name = (n: string, max: number, what: string, path: string, at?: MenuSelection) => {
    if (!n) err('name-required', path, `A ${what} name is required.`, at);
    else if (n.length > max) err('name-length', path, `${n}: a ${what} name is at most ${max} characters.`, at);
    else if (!NAME_PATTERN.test(n)) err('name-chars', path, `${n}: a ${what} name has only A-Z, 0-9, _, #, @ and $.`, at);
  };
  name(doc.name, MENU_NAME_MAX, 'menu', doc.name);
  if (doc.descr.length > DESCR_MAX) err('length', 'Description', `A description is at most ${DESCR_MAX} characters.`);
  if (doc.label.length > MENU_LABEL_MAX) err('length', 'Menu Label', `A menu label is at most ${MENU_LABEL_MAX} characters.`);
  if (doc.group.length > MENU_GROUP_MAX) err('length', 'Menu Group', `A menu group is at most ${MENU_GROUP_MAX} characters.`);
  for (const [v, what] of [[doc.menuOrder, 'Menu Order'], [doc.groupOrder, 'Menu Group Order']] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 9999) err('order', what, `${what} is a whole number from 0 to 9999.`);
  }
  const items = allItems(doc);
  // Save is disabled until the menu has an item [mn01].
  if (!items.length) err('menu-empty', doc.name, doc.type === 1 ? 'A popup menu needs an item before it can be saved.' : 'A menu needs a bar with an item before it can be saved.');
  const barNames = new Set<string>();
  for (const bar of doc.bars) {
    if (doc.type === 0) {
      name(bar.name, BAR_NAME_MAX, 'bar', bar.name, { bar: bar.name });
      if (barNames.has(bar.name)) err('bar-duplicate', bar.name, `Bar ${bar.name} appears twice.`, { bar: bar.name });
      barNames.add(bar.name);
      if (bar.label.length > BAR_LABEL_MAX) err('length', `${bar.name}.Label`, `A bar label is at most ${BAR_LABEL_MAX} characters.`, { bar: bar.name });
      if (!bar.items.length) out.push({ severity: 'info', code: 'bar-empty', path: bar.name, message: `Bar ${bar.name} has no items: it is not stored.`, at: { bar: bar.name } });
    }
    const itemNames = new Set<string>();
    for (const it of bar.items) {
      const at = { bar: bar.name, item: it.name };
      const path = doc.type === 1 ? it.name : `${bar.name}.${it.name}`;
      name(it.name, ITEM_NAME_MAX, 'item', path, at);
      if (itemNames.has(it.name)) err('item-duplicate', path, `Item ${it.name} appears twice.`, at);
      itemNames.add(it.name);
      if (!ITEM_TYPES_BY_MENU[doc.type].includes(it.type)) err('item-type', path, `A ${doc.type === 1 ? 'popup' : 'standard'} menu has no ${ITEM_TYPE_LABELS[it.type] ?? it.type} items.`, at);
      if (it.label.length > ITEM_LABEL_MAX) err('length', `${path}.Label`, `An item label is at most ${ITEM_LABEL_MAX} characters.`, at);
      if (it.component.length > COMPONENT_MAX) err('length', `${path}.Component`, `A component name is at most ${COMPONENT_MAX} characters.`, at);
      if (it.searchRecord.length > SEARCH_RECORD_MAX) err('length', `${path}.Search Record`, `A search record name is at most ${SEARCH_RECORD_MAX} characters.`, at);
      if (it.type !== 8 && !it.label) warn('label-missing', path, `${it.name} has no label: it shows as blank.`, at);
      // "Component name is required. (43,4)" -- component and PeopleCode items of a standard menu [mi05].
      if (doc.type === 0 && (it.type === 5 || it.type === 9) && !it.component) err('component-required', path, `${it.name}: Component name is required. (43,4)`, at);
      if (it.type === 9 && !(it.peopleCode ?? '').trim()) warn('peoplecode-missing', path, `${it.name} has no ItemSelected PeopleCode: selecting it does nothing.`, at);
      if (it.type === 12 && !it.transfer?.menu) warn('transfer-menu', path, `${it.name} transfers to no menu.`, at);
    }
  }
  if (doc.type === 1 && new Set(items.map((x) => x.item.name)).size !== items.length) err('item-duplicate', doc.name, 'A popup menu\'s item names are unique.');
  // "Component name X not unique. (43,5)" -- among component items [mb01].
  const seen = new Map<string, string>();
  for (const { bar, item } of items) {
    if (item.type !== 5 || !item.component) continue;
    const k = `${item.component}.${item.market}`;
    const path = `${bar.name}.${item.name}`;
    if (seen.has(k)) err('component-duplicate', path, `Component name ${item.component} not unique. (43,5) It is also ${seen.get(k)}.`, { bar: bar.name, item: item.name });
    else seen.set(k, path);
  }
  return out;
}

/** Database answers for deeper validation: components, records, menus, pages. */
export interface MenuReferenceLookup {
  componentExists(component: string, market: string): Promise<boolean>;
  recordExists(record: string): Promise<boolean>;
  menuExists(menu: string): Promise<boolean>;
}

export async function validateMenuReferences(doc: MenuDocument, lookup: MenuReferenceLookup): Promise<MenuDiagnostic[]> {
  const out: MenuDiagnostic[] = [];
  for (const { bar, item } of allItems(doc)) {
    const at = { bar: bar.name, item: item.name };
    const path = doc.type === 1 ? item.name : `${bar.name}.${item.name}`;
    if ((item.type === 5 || item.type === 9) && item.component && !(await lookup.componentExists(item.component, item.market || 'GBL'))) {
      out.push({ severity: 'error', code: 'component-missing', path, message: `Component ${item.component}.${item.market || 'GBL'} does not exist.`, at });
    }
    if (item.type === 5 && item.searchRecord && !(await lookup.recordExists(item.searchRecord))) {
      out.push({ severity: 'error', code: 'record-missing', path, message: `Search record ${item.searchRecord} does not exist.`, at });
    }
    const x = item.transfer;
    if (item.type === 12 && x) {
      if (x.menu && !x.node && !(await lookup.menuExists(x.menu))) out.push({ severity: 'warning', code: 'transfer-menu-missing', path, message: `Transfer menu ${x.menu} does not exist.`, at });
      if (x.component && !x.node && !(await lookup.componentExists(x.component, x.market || 'GBL'))) out.push({ severity: 'warning', code: 'transfer-component-missing', path, message: `Transfer component ${x.component} does not exist.`, at });
    }
  }
  return out;
}

export class MenuSession {
  private past: MenuDocument[] = [];
  private future: MenuDocument[] = [];
  private saved: string;

  constructor(public doc: MenuDocument, public token: string, private readonly limit = 200) {
    this.saved = JSON.stringify(doc);
  }

  get dirty(): boolean { return JSON.stringify(this.doc) !== this.saved; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  apply(op: MenuOp, groups?: ReadonlyMap<string, { order: number; separator: boolean }>): MenuDocument {
    return this.replace(applyMenuOp(this.doc, op, groups));
  }

  replace(doc: MenuDocument): MenuDocument {
    this.past.push(this.doc);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.doc = doc;
    return doc;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.doc);
    this.doc = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.doc);
    this.doc = next;
    return true;
  }

  reset(doc: MenuDocument, token: string): void {
    this.doc = doc;
    this.token = token;
    this.saved = JSON.stringify(doc);
    this.past = [];
    this.future = [];
  }

  diagnostics(): MenuDiagnostic[] {
    return validateMenu(this.doc);
  }
}

export { copyMenu, MenuEditError };
