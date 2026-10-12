import * as z from 'zod/v4';
import {
  addField, addKey, addScroll, bufferScrolls, CI_COLLECTION, CI_CREATE_KEY, CI_FIND_KEY, CI_GET_KEY, CI_METHODS, CI_PROPERTY, CI_ROOT, CiEditError,
  deleteItem, setCi, setItem, setMethods, setSync, windowOrder, type CiBuffer, type CiDocument, type CiItem, type CiMethod
} from './ciDocument.js';

/*
 * Component Interfaces as JSON for the MCP: a spec in App Designer's terms
 * (specFromDocument), the window's edits as named operations
 * (applyCiOperation), and the component's buffer as the window's left tree
 * shows it (bufferSummary) -- what can be dragged in, and where.
 */

const TYPE_OF = { property: CI_PROPERTY, collection: CI_COLLECTION, getkey: CI_GET_KEY, findkey: CI_FIND_KEY, createkey: CI_CREATE_KEY } as const;
const KEY_SET = { get: CI_GET_KEY, find: CI_FIND_KEY, create: CI_CREATE_KEY } as const;
const itemType = z.enum(['property', 'collection', 'getkey', 'findkey', 'createkey']);
const methodNames = z.enum(['Cancel', 'Create', 'Find', 'Get', 'Save']);

export const ciOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_interface'), description: z.string().max(30).optional(), comments: z.string().optional(),
    owner: z.string().optional().describe('Owner ID (PSXLATITEM OBJECTOWNERID value), blank for none.'),
    menu: z.string().optional().describe('Menu Name: a menu with an item for the component, blank for none.') }),
  z.object({ op: z.literal('set_methods'), methods: z.record(methodNames, z.boolean()).describe('Standard methods on or off, e.g. {"Find": false}. Create needs a component that can Add.') }),
  z.object({ op: z.literal('set_sync'), synchronizable: z.boolean(), conflict: z.enum(['Server Wins', 'Device Wins', 'Custom']).optional(),
    messageSet: z.number().int().min(0).optional(), upload: z.enum(['Yes', 'No, restore server values', 'No, retain device values']).optional(),
    relatedProject: z.string().optional() }),
  z.object({ op: z.literal('set_item'), type: itemType, parent: z.string().optional().describe('The collection the item is in (PS_ROOT, the default, for level 0 and keys).'),
    name: z.string(), newName: z.string().optional(), comment: z.string().max(30).optional(), readOnly: z.boolean().optional() }),
  z.object({ op: z.literal('delete_item'), type: itemType, parent: z.string().optional(), name: z.string() }),
  z.object({ op: z.literal('add_key'), set: z.enum(['get', 'find', 'create']), field: z.string().describe('A search record field App Designer would make that key of.') }),
  z.object({ op: z.literal('add_field'), scroll: z.string().describe("The field's scroll (BCSCROLLNAME, e.g. 00-00 for level 0, 00-00-01-00): see psft_ci_buffer."),
    record: z.string(), field: z.string() }),
  z.object({ op: z.literal('add_scroll'), scroll: z.string().describe('A scroll below level 0 (e.g. 00-00-01-00): its collection, made or merged into, with all its fields and child scrolls.') })
]);
export type CiOperation = z.infer<typeof ciOperation>;

const CONFLICT = { 'Server Wins': 1, 'Device Wins': 2, Custom: 3 } as const;
const UPLOAD = { Yes: 'N', 'No, restore server values': 'Y', 'No, retain device values': 'D' } as const;

export function applyCiOperation(doc: CiDocument, o: CiOperation, buffer: CiBuffer | undefined, actions: number): CiDocument {
  const need = () => { if (!buffer) throw new CiEditError(`The component ${doc.component}.${doc.market} cannot be read; fields and keys cannot be added.`); return buffer; };
  const up = (s: string) => s.trim().toUpperCase();
  switch (o.op) {
    case 'set_interface': return setCi(doc, { ...(o.description !== undefined ? { description: o.description } : {}), ...(o.comments !== undefined ? { comments: o.comments } : {}),
      ...(o.owner !== undefined ? { owner: o.owner } : {}), ...(o.menu !== undefined ? { menu: o.menu } : {}) });
    case 'set_methods': return setMethods(doc, o.methods as Partial<Record<CiMethod, boolean>>, actions);
    case 'set_sync': return setSync(doc, o.synchronizable ? {
      ...(o.conflict ? { conflict: CONFLICT[o.conflict] } : {}), ...(o.messageSet !== undefined ? { messageSet: o.messageSet } : {}),
      ...(o.upload ? { upload: UPLOAD[o.upload] } : {}), ...(o.relatedProject !== undefined ? { relatedProject: o.relatedProject } : {})
    } : undefined);
    case 'set_item': return setItem(doc, { type: TYPE_OF[o.type], parent: o.parent ? up(o.parent) : CI_ROOT, name: up(o.name) },
      { ...(o.newName !== undefined ? { name: up(o.newName) } : {}), ...(o.comment !== undefined ? { comment: o.comment } : {}), ...(o.readOnly !== undefined ? { readOnly: o.readOnly } : {}) });
    case 'delete_item': return deleteItem(doc, { type: TYPE_OF[o.type], parent: o.parent ? up(o.parent) : CI_ROOT, name: up(o.name) });
    case 'add_key': return addKey(doc, need(), KEY_SET[o.set], up(o.field));
    case 'add_field': return addField(doc, need(), o.scroll.trim(), up(o.record), up(o.field));
    case 'add_scroll': return addScroll(doc, need(), o.scroll.trim());
  }
}

interface SpecProperty { property: string; record: string; field: string; readOnly?: true; comment?: string; key?: true }
interface SpecCollection { collection: string; record: string; scroll: string; items: (SpecProperty | SpecCollection)[] }

/** An interface in App Designer's terms, the tree as the window shows it. */
export function specFromDocument(doc: CiDocument) {
  const keys = (t: number) => doc.items.filter((i) => i.type === t).map((i) => i.field.trim());
  const node = (parent: string): (SpecProperty | SpecCollection)[] => windowOrder(doc.items).filter((i) => i.parent === parent && (i.type === CI_PROPERTY || i.type === CI_COLLECTION))
    .map((i: CiItem) => i.type === CI_COLLECTION
      ? { collection: i.name, record: i.record, scroll: i.scrollName, items: node(i.name) }
      : { property: i.name, record: i.record, field: i.field.trim(), ...(i.readOnly ? { readOnly: true as const } : {}), ...(i.comment.trim() ? { comment: i.comment.trim() } : {}), ...(i.key ? { key: true as const } : {}) });
  return {
    interface: doc.name, component: doc.component, market: doc.market, description: doc.description.trim(), comments: doc.comments,
    owner: doc.owner.trim(), menu: doc.menu.trim(),
    methods: Object.entries(CI_METHODS).filter(([, b]) => doc.methods & b).map(([m]) => m),
    ...(doc.sync ? { synchronization: { conflict: ['', 'Server Wins', 'Device Wins', 'Custom'][doc.sync.conflict] ?? doc.sync.conflict, messageSet: doc.sync.messageSet,
      upload: ({ N: 'Yes', Y: 'No, restore server values', D: 'No, retain device values' } as Record<string, string>)[doc.sync.upload.trim()] ?? 'not chosen',
      relatedProject: doc.sync.relatedProject.trim() } } : {}),
    keys: { get: keys(CI_GET_KEY), find: keys(CI_FIND_KEY), create: keys(CI_CREATE_KEY) },
    properties: node(CI_ROOT),
    itemCount: doc.items.length
  };
}

/** The component's buffer as the window's left tree shows it: each scroll, its fields, which are properties already and which can be added. */
export function bufferSummary(buffer: CiBuffer, doc?: CiDocument) {
  const have = new Set(doc?.items.filter((i) => i.type === CI_PROPERTY).map((i) => `${i.scrollName}|${i.record}|${i.field.trim()}`) ?? []);
  const collections = new Map(doc?.items.filter((i) => i.type === CI_COLLECTION).map((i) => [i.scrollName, i.name]) ?? []);
  return {
    component: `${buffer.component}.${buffer.market}`, searchRecord: buffer.searchRecord, addSearchRecord: buffer.addSearchRecord,
    keysOffered: buffer.keys.map((k) => ({ set: k.type === CI_GET_KEY ? 'get' : k.type === CI_FIND_KEY ? 'find' : 'create', field: k.field,
      present: !!doc?.items.some((i) => i.type === k.type && i.field.trim() === k.field) })),
    scrolls: bufferScrolls(buffer).filter((s) => !s.system).map((s) => ({
      scroll: s.scrollName, level: s.level, record: s.record || '(level 0)', collection: s.scrollName === '00-00' ? 'PS_ROOT' : collections.get(s.scrollName) ?? null,
      fields: s.fields.filter((f) => !f.system).map((f) => ({ record: f.record, field: f.field, ...(f.key ? { key: true } : {}),
        ...(f.ancestorKey ? { parentKey: true } : {}), ...(f.defaulted ? { defaulted: true } : {}), present: have.has(`${s.scrollName}|${f.record}|${f.field}`) }))
    }))
  };
}
