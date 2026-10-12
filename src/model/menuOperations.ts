import * as z from 'zod/v4';
import {
  ALPHABETICAL, BAR_LABEL_MAX, BAR_NAME_MAX, COMPONENT_MAX, DESCR_MAX, ITEM_LABEL_MAX, ITEM_NAME_MAX, MENU_GROUP_MAX, MENU_LABEL_MAX, MENU_NAME_MAX,
  newMenu, POPUP_BAR, SEARCH_RECORD_MAX, type ItemSpec, type MenuDocItem, type MenuDocument, type MenuItemType, type MenuPatch, type MenuTransfer
} from './menuDocument.js';
import { applyMenuOp, type MenuOp } from './menuSession.js';

/*
 * Menus for agents (the MCP's psft_menu_* tools): a menu as a spec in App
 * Designer's terms, the Menu Designer's operations by name, and the two
 * turned into the designer's own document and operations (menuDocument.ts,
 * menuSession.ts) -- so an agent's menu is App Designer's.
 */

const ITEM_TYPE_NAMES = { component: 5, separator: 8, peoplecode: 9, transfer: 12 } as const;
const ITEM_TYPE_OF: Record<number, keyof typeof ITEM_TYPE_NAMES> = { 5: 'component', 8: 'separator', 9: 'peoplecode', 12: 'transfer' };
const ACTION_NAMES = { add: 0, update: 1, updateAll: 2, correction: 3 } as const;
const ACTION_OF: Record<number, keyof typeof ACTION_NAMES> = { 0: 'add', 1: 'update', 2: 'updateAll', 3: 'correction' };

export const transferSpec = z.object({
  portal: z.string().optional().describe('Portal; omitted or "" is Use Current.'),
  node: z.string().optional().describe('Node; omitted or "" is LOCAL.'),
  menu: z.string().max(30).optional(), component: z.string().max(COMPONENT_MAX).optional(), market: z.string().max(3).optional(),
  page: z.string().max(30).optional().describe('Component Item: the page of the component to open.'),
  action: z.union([z.enum(['add', 'update', 'updateAll', 'correction']), z.number().int()]).optional().describe('add, update (Update/Display, the default), updateAll, correction.'),
  newWindow: z.boolean().optional().describe('Use new window (minimize current window).'),
  useData: z.boolean().optional().describe('Use data from current page in search dialog (the default with a component).')
});

export const itemSpec = z.object({
  name: z.string().max(ITEM_NAME_MAX).optional().describe('Item name (A-Z, 0-9, _); a separator keeps App Designer\'s MENUITEMn; omitted: MENUITEMn.'),
  label: z.string().max(ITEM_LABEL_MAX).optional().describe('Label; & before a letter makes it the mnemonic.'),
  type: z.enum(['component', 'peoplecode', 'separator', 'transfer']).optional()
    .describe('Standard menus: component (the default), peoplecode, separator. Popup menus: transfer, peoplecode (the default), separator.'),
  component: z.string().max(COMPONENT_MAX).optional().describe('The component (component items), or the enabling component (PeopleCode items of a standard menu, required).'),
  market: z.string().max(3).optional().describe('The component\'s market (GBL when a component is given).'),
  searchRecord: z.string().max(SEARCH_RECORD_MAX).optional().describe('Search Rec Override (component items); "" for none.'),
  peopleCode: z.string().optional().describe('PeopleCode items: the ItemSelected program.'),
  transfer: transferSpec.optional().describe('Transfer items (popup menus): Transfer Properties.')
});

export const menuSpec = z.object({
  menu: z.string().min(1).max(MENU_NAME_MAX),
  type: z.enum(['standard', 'popup']).optional().describe('standard (the default) or popup.'),
  description: z.string().max(DESCR_MAX).optional(), comments: z.string().optional(), owner: z.string().optional().describe('Owner ID.'),
  label: z.string().max(MENU_LABEL_MAX).optional().describe('Menu Label; a new standard menu\'s is its name title-cased, as App Designer makes it.'),
  group: z.string().max(MENU_GROUP_MAX).optional().describe('Menu Group (standard menus); a new one\'s is its name title-cased.'),
  menuOrder: z.union([z.number().int().min(0).max(ALPHABETICAL), z.literal('alphabetical')]).optional(),
  menuSeparator: z.boolean().optional(),
  groupOrder: z.union([z.number().int().min(0).max(ALPHABETICAL), z.literal('alphabetical')]).optional().describe('The group\'s order: saving it writes every menu of the group.'),
  groupSeparator: z.boolean().optional(),
  installed: z.boolean().optional(),
  bars: z.array(z.object({ name: z.string().max(BAR_NAME_MAX), label: z.string().max(BAR_LABEL_MAX).optional(), items: z.array(itemSpec) })).optional()
    .describe('Standard menus: the bars in order, each with its items.'),
  items: z.array(itemSpec).optional().describe('Popup menus: the items in order.')
});
export type MenuSpec = z.infer<typeof menuSpec>;
type ItemInput = z.infer<typeof itemSpec>;

const ref = { bar: z.string().optional().describe('The bar (standard menus); a popup menu\'s items need none.'), item: z.string().min(1) };
export const menuOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_menu'), description: z.string().max(DESCR_MAX).optional(), comments: z.string().optional(), owner: z.string().optional(),
    label: z.string().max(MENU_LABEL_MAX).optional(), group: z.string().max(MENU_GROUP_MAX).optional(),
    menuOrder: z.union([z.number().int(), z.literal('alphabetical')]).optional(), menuSeparator: z.boolean().optional(),
    groupOrder: z.union([z.number().int(), z.literal('alphabetical')]).optional(), groupSeparator: z.boolean().optional(), installed: z.boolean().optional() })
    .describe('Menu Properties (General and Use).'),
  z.object({ op: z.literal('add_bar'), name: z.string().max(BAR_NAME_MAX).optional(), label: z.string().max(BAR_LABEL_MAX).optional(), index: z.number().int().optional() })
    .describe('A new bar (a bar is stored only once it has an item).'),
  z.object({ op: z.literal('set_bar'), bar: z.string().min(1), name: z.string().max(BAR_NAME_MAX).optional(), label: z.string().max(BAR_LABEL_MAX).optional() })
    .describe('Bar Item Properties; a new name renames the bar (its items, PeopleCode and permission-list items move).'),
  z.object({ op: z.literal('delete_bar'), bar: z.string().min(1) }),
  z.object({ op: z.literal('move_bar'), bar: z.string().min(1), index: z.number().int().min(0) }),
  z.object({ op: z.literal('add_item'), bar: z.string().optional(), index: z.number().int().optional(), item: itemSpec }),
  z.object({ op: z.literal('set_item'), ...ref, ...itemSpec.shape }).describe('Menu Item Properties; a new name renames the item (its PeopleCode moves).'),
  z.object({ op: z.literal('delete_item'), ...ref }),
  z.object({ op: z.literal('move_item'), ...ref, toBar: z.string().optional().describe('Another bar: a Cut and Paste.'), index: z.number().int().min(0) })
]);
export type MenuOperation = z.infer<typeof menuOperation>;

const order = (v: number | 'alphabetical' | undefined) => (v === 'alphabetical' ? ALPHABETICAL : v);
const action = (v: string | number | undefined) => (typeof v === 'string' ? ACTION_NAMES[v as keyof typeof ACTION_NAMES] : v);

function toItemSpec(i: ItemInput): ItemSpec {
  const t = i.transfer;
  return {
    ...(i.name !== undefined ? { name: i.name } : {}), ...(i.label !== undefined ? { label: i.label } : {}),
    ...(i.type ? { type: ITEM_TYPE_NAMES[i.type] as MenuItemType } : {}),
    ...(i.component !== undefined ? { component: i.component } : {}), ...(i.market !== undefined ? { market: i.market } : {}),
    ...(i.searchRecord !== undefined ? { searchRecord: i.searchRecord } : {}), ...(i.peopleCode !== undefined ? { peopleCode: i.peopleCode } : {}),
    ...(t ? { transfer: Object.fromEntries(Object.entries({ ...t, action: action(t.action) }).filter(([, v]) => v !== undefined)) as Partial<MenuTransfer> } : {})
  };
}

function menuPatch(s: Partial<MenuSpec>): MenuPatch {
  const p: MenuPatch = {};
  if (s.description !== undefined) p.descr = s.description;
  if (s.comments !== undefined) p.descrlong = s.comments;
  if (s.owner !== undefined) p.owner = s.owner;
  if (s.label !== undefined) p.label = s.label;
  if (s.group !== undefined) p.group = s.group;
  if (s.menuOrder !== undefined) p.menuOrder = order(s.menuOrder);
  if (s.menuSeparator !== undefined) p.menuSeparator = s.menuSeparator;
  if (s.groupOrder !== undefined) p.groupOrder = order(s.groupOrder);
  if (s.groupSeparator !== undefined) p.groupSeparator = s.groupSeparator;
  if (s.installed !== undefined) p.installed = s.installed;
  return p;
}

/** A new menu from a spec, built by the designer's operations (App Designer's defaults for whatever the spec leaves out). */
export function documentFromSpec(spec: MenuSpec): MenuDocument {
  const type = spec.type === 'popup' ? 1 : 0;
  let doc = newMenu(spec.menu.trim().toUpperCase(), type);
  const patch = menuPatch(spec);
  if (Object.keys(patch).length) doc = applyMenuOp(doc, { kind: 'setMenu', patch });
  if (type === 1) {
    for (const i of spec.items ?? []) doc = applyMenuOp(doc, { kind: 'insertItem', bar: POPUP_BAR, item: toItemSpec(i) });
  } else {
    for (const b of spec.bars ?? []) {
      doc = applyMenuOp(doc, { kind: 'insertBar', name: b.name, ...(b.label !== undefined ? { label: b.label } : {}) });
      const name = b.name.trim().toUpperCase();
      for (const i of b.items) doc = applyMenuOp(doc, { kind: 'insertItem', bar: name, item: toItemSpec(i) });
    }
  }
  return doc;
}

function itemToSpec(i: MenuDocItem, includeText: boolean): ItemInput {
  const x = i.transfer;
  return {
    name: i.name, ...(i.type !== 8 ? { label: i.label } : {}), type: ITEM_TYPE_OF[i.type],
    ...(i.component ? { component: i.component, market: i.market } : {}), ...(i.searchRecord ? { searchRecord: i.searchRecord } : {}),
    ...(i.type === 9 && includeText ? { peopleCode: i.peopleCode ?? '' } : {}),
    ...(x ? { transfer: { portal: x.portal, node: x.node, menu: x.menu, component: x.component, market: x.market, page: x.page,
      action: ACTION_OF[x.action] ?? x.action, newWindow: x.newWindow, useData: x.useData } } : {})
  };
}

/** A menu as a spec, as psft_menu_get returns it. */
export function specFromDocument(doc: MenuDocument, opts: { includeText?: boolean } = {}): MenuSpec {
  const text = opts.includeText !== false;
  const base: MenuSpec = {
    menu: doc.name, type: doc.type === 1 ? 'popup' : 'standard', description: doc.descr, comments: doc.descrlong ?? '', owner: doc.owner, label: doc.label
  };
  if (doc.type === 1) return { ...base, items: (doc.bars[0]?.items ?? []).map((i) => itemToSpec(i, text)) };
  return {
    ...base, group: doc.group, menuOrder: doc.menuOrder === ALPHABETICAL ? 'alphabetical' : doc.menuOrder, menuSeparator: doc.menuSeparator,
    groupOrder: doc.groupOrder === ALPHABETICAL ? 'alphabetical' : doc.groupOrder, groupSeparator: doc.groupSeparator, installed: doc.installed,
    bars: doc.bars.map((b) => ({ name: b.name, label: b.label, items: b.items.map((i) => itemToSpec(i, text)) }))
  };
}

/** One operation, as the designer's MenuOp. */
export function applyMenuOperation(doc: MenuDocument, o: MenuOperation, groups?: ReadonlyMap<string, { order: number; separator: boolean }>): MenuDocument {
  const bar = (b: string | undefined) => (doc.type === 1 ? POPUP_BAR : (b ?? '').trim().toUpperCase());
  const it = (name: string) => name.trim().toUpperCase();
  let op: MenuOp;
  switch (o.op) {
    case 'set_menu': op = { kind: 'setMenu', patch: menuPatch(o) }; break;
    case 'add_bar': op = { kind: 'insertBar', ...(o.name ? { name: o.name } : {}), ...(o.label !== undefined ? { label: o.label } : {}), ...(o.index !== undefined ? { index: o.index } : {}) }; break;
    case 'set_bar': op = { kind: 'setBar', bar: it(o.bar), ...(o.name !== undefined ? { name: o.name } : {}), ...(o.label !== undefined ? { label: o.label } : {}) }; break;
    case 'delete_bar': op = { kind: 'deleteBar', bar: it(o.bar) }; break;
    case 'move_bar': op = { kind: 'moveBar', bar: it(o.bar), index: o.index }; break;
    case 'add_item': op = { kind: 'insertItem', bar: bar(o.bar), item: toItemSpec(o.item), ...(o.index !== undefined ? { index: o.index } : {}) }; break;
    case 'set_item': {
      const { op: _op, bar: b, item, ...spec } = o;
      op = { kind: 'setItem', ref: { bar: bar(b), item: it(item) }, item: toItemSpec(spec) };
      break;
    }
    case 'delete_item': op = { kind: 'deleteItem', ref: { bar: bar(o.bar), item: it(o.item) } }; break;
    case 'move_item': op = { kind: 'moveItem', ref: { bar: bar(o.bar), item: it(o.item) }, bar: bar(o.toBar ?? o.bar), index: o.index }; break;
  }
  return applyMenuOp(doc, op, groups);
}

/** What a stored menu differs in from a spec: only what the spec states, bar by bar and item by item. */
export function diffMenuSpec(doc: MenuDocument, spec: MenuSpec): string[] {
  const have = specFromDocument(doc) as unknown as Record<string, unknown>;
  const out: string[] = [];
  const norm = (k: string, v: unknown) => (k === 'name' && typeof v === 'string' ? v.trim().toUpperCase()
    : k === 'peopleCode' && typeof v === 'string' ? v.replace(/\r\n/g, '\n').trimEnd() : v);
  const walk = (path: string, want: unknown, got: unknown) => {
    if (Array.isArray(want)) {
      if (!Array.isArray(got) || got.length !== want.length) { out.push(`${path}: stored ${Array.isArray(got) ? got.length : 0} entries, spec ${want.length}`); return; }
      want.forEach((w, i) => walk(`${path}[${i}]`, w, got[i]));
      return;
    }
    if (want && typeof want === 'object') {
      for (const [k, v] of Object.entries(want as Record<string, unknown>)) {
        if (v === undefined) continue;
        walk(path ? `${path}.${k}` : k, norm(k, v), norm(k, (got as Record<string, unknown> | undefined)?.[k]));
      }
      return;
    }
    if (JSON.stringify(want) !== JSON.stringify(got ?? (typeof want === 'string' ? '' : got))) out.push(`${path}: stored ${JSON.stringify(got)}, spec ${JSON.stringify(want)}`);
  };
  const { menu: _menu, ...rest } = spec;
  walk('', rest, have);
  return out;
}
