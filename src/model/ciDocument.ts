import { UseEdit } from './record.js';
import type { ComponentStructure, StructureScroll } from './componentStructure.js';

/*
 * A Component Interface as App Designer's Component Interface window holds it
 * (docs/COMPONENT_INTERFACES.md): its PSBCDEFN row, its PSBCITEM items -- the
 * key sets, the properties and the collections, a tree under PS_ROOT -- and
 * its PSCISYNCDEFN row; the component's buffer the window's left tree shows
 * (ciBuffer), how App Designer defaults an interface from it (File > New >
 * Component Interface, "Do you want to default the properties based on the
 * underlying Component definition? (123,12)": ci01-ci04, ci28), and the
 * window's edits (ci05-ci23).
 */

/** PSBCITEM.BCTYPE. */
export const CI_GET_KEY = 1;
export const CI_CREATE_KEY = 2;
export const CI_COLLECTION = 3;
export const CI_PROPERTY = 4;
export const CI_FIND_KEY = 5;
/** The key sets in the order the window shows them when it makes an interface (ci03). */
export const CI_KEY_TYPES = [CI_GET_KEY, CI_FIND_KEY, CI_CREATE_KEY] as const;
export const CI_KEY_SET_NAMES: Record<number, string> = { [CI_GET_KEY]: 'GETKEYS', [CI_FIND_KEY]: 'FINDKEYS', [CI_CREATE_KEY]: 'CREATEKEYS' };
/** The tree's top (BCITEMPARENT). */
export const CI_ROOT = 'PS_ROOT';
/** Level 0's BCSCROLLNAME. */
export const CI_LEVEL0 = '00-00';
/** The key sets' BCSCROLLNAME, by BCTYPE. */
export const CI_KEY_SCROLL: Record<number, string> = { [CI_GET_KEY]: 'AA-AA-00-00', [CI_CREATE_KEY]: 'AA-AA-00-01', [CI_FIND_KEY]: 'AA-AA-00-02' };
/** PSBCDEFN.BCSTDMETHODS bits, the standard methods in App Designer's (alphabetical) order. */
export const CI_METHODS = { Cancel: 1, Create: 2, Find: 4, Get: 8, Save: 16 } as const;
export type CiMethod = keyof typeof CI_METHODS;
/** PSCISYNCDEFN.CONFLICTRESOLUTION (ci07-ci09). */
export const CI_CONFLICT = { 'Server Wins': 1, 'Device Wins': 2, Custom: 3 } as const;
/** PSCISYNCDEFN.MPDEVICEPERSIST, "Upload changes from mobile device?" (ci07-ci09). */
export const CI_UPLOAD = { Yes: 'N', 'No, restore server values at synchronization time': 'Y', 'No, retain current device values': 'D' } as const;
/** PSPNLGRPDEFN.ACTIONS bit for Add. */
const ACTION_ADD = 1;
/** PSPNLFIELD.FIELDTYPE: the controls that make properties when App Designer defaults (Edit Box, Drop Down List Box, Check Box, Radio Button). */
const DATA_CONTROLS = new Set([4, 5, 7, 8]);
/** PSPNLFIELD.FIELDUSE bits. */
const DISPLAY_ONLY = 0x1;
const INVISIBLE = 0x2;
/** PSRECDEFN.RECTYPE. */
const SQL_TABLE = 0;
const DERIVED = 2;
const DYNAMIC_VIEW = 5;
const SQL_VIEW = 1;
/** The record types whose every field is in the buffer, placed or not (ci02: an SQL view has only its placed fields; ci04: a dynamic view all). */
const WHOLE_RECORD = new Set([SQL_TABLE, DYNAMIC_VIEW]);
/**
 * An SQL view that is its scroll's primary record is in the buffer whole too, field by field in record order:
 * PRCSRQSTDLGLIST, the level-1 primary of PRCSRUNCNTL_SBP's process list, numbered so by App Designer on 8.62.09
 * (ZZ_CI_RCTEST) and 8.61.15 (XX_CI_AD). A view that is not the primary keeps only its placed fields (ci02).
 */
const wholeRecord = (type: number, rec: string, primary: string | undefined) => WHOLE_RECORD.has(type) || (type === SQL_VIEW && rec === primary);

export class CiEditError extends Error {
  constructor(message: string) { super(message); this.name = 'CiEditError'; }
}

export interface CiItem {
  type: number;
  /** BCITEMPARENT: PS_ROOT, or the collection's name. */
  parent: string;
  name: string;
  /** SEQUENCE_NBR_6: its place in the component's buffer. */
  seq: number;
  /** BCACCESS 2: Read Only. */
  readOnly: boolean;
  /** BCSCROLL: the scroll level. */
  level: number;
  /** BCSCROLLNUM: the scroll's place among its parent's. */
  scrollNum: number;
  scrollName: string;
  record: string;
  /** FIELDNAME (' ' for a collection). */
  field: string;
  /** COMMENTSHORT (' ' when none). */
  comment: string;
  /** 0 until the save gives it one (PSSYSTEMID PSBCITEM). */
  syncId: number;
  /** A key field of its record (the window's key icon; the save's names count it twice: saveNames). */
  key: boolean;
  /** MPDEVICEPERSISTINT, kept as stored. */
  devicePersist?: number;
}

export interface CiSync {
  /** CONFLICTRESOLUTION: 1 Server Wins, 2 Device Wins, 3 Custom. */
  conflict: number;
  /** MSGSET. */
  messageSet: number;
  /** MPDEVICEPERSIST: 'N' upload, 'Y' restore server values, 'D' retain device values, ' ' none chosen. */
  upload: string;
  /** RELCONTENTPROJ. */
  relatedProject: string;
  /** SYNCID: 0 until the save gives it one (PSSYSTEMID PSCISYNCDEFN). */
  syncId: number;
}

export interface CiDocument {
  name: string;
  displayName: string;
  component: string;
  market: string;
  /** MENUNAME: a menu with an item for the component, or ' '. */
  menu: string;
  searchRecord: string;
  addSearchRecord: string;
  description: string;
  /** DESCRLONG ('' when none). */
  comments: string;
  owner: string;
  /** BCSTDMETHODS. */
  methods: number;
  sync?: CiSync;
  /** The window's order: the key sets, then the properties tree (children follow their collection). */
  items: CiItem[];
}

/** A record field as the CI walk reads it (PSRECFIELDDB order, subrecords expanded). */
export interface CiRecordField {
  name: string;
  useEdit: number;
  fieldType: number;
}

/** What App Designer reads from a component to default its interface. */
export interface CiSource {
  component: string;
  market: string;
  searchRecord: string;
  addSearchRecord: string;
  /** PSPNLGRPDEFN.ACTIONS. */
  actions: number;
  structure: ComponentStructure;
  /** PSRECDEFN.RECTYPE, -1 when there is no such record. */
  recordType(name: string): number;
  recordFields(name: string): readonly CiRecordField[] | undefined;
  /** Record Properties' System ID and Row Timestamp fields. */
  recordSyncFields?(name: string): [string, string] | undefined;
}

// ---------------------------------------------------------------------------
// The component's buffer, numbered

export interface CiBufferField {
  seq: number;
  record: string;
  field: string;
  /** A key field of its record. */
  key: boolean;
  /** A key the levels above have (ci01): never a property. */
  ancestorKey: boolean;
  /** Placed in this scroll on the component's own pages, visible, in a data control: App Designer's default makes it a property. */
  defaulted: boolean;
  /** Read Only by default: a visible data placement is display only (ci04). */
  readOnly: boolean;
  /** Only on the Fluid system header / side page: numbered, never offered. */
  system: boolean;
}

export interface CiBufferScroll {
  /** The collection's SEQUENCE_NBR_6 (level 0's is its own number). */
  seq: number;
  level: number;
  scrollNum: number;
  scrollName: string;
  /** The record a collection of it is named for (0 for level 0). */
  record: string;
  /** The records in the window's left tree order. */
  records: string[];
  fields: CiBufferField[];
  scrolls: CiBufferScroll[];
  /** Only on the Fluid system header / side page. */
  system: boolean;
}

export interface CiBufferKey { type: number; seq: number; record: string; field: string }

export interface CiBuffer {
  component: string;
  market: string;
  searchRecord: string;
  addSearchRecord: string;
  actions: number;
  /** The key items App Designer offers, numbered. */
  keys: CiBufferKey[];
  level0: CiBufferScroll;
  /** The search record's (and add search record's) fields, as the left tree lists them. */
  searchFields: { record: string; field: string; searchKey: boolean; altKey: boolean }[];
  /** PSRECDEFN.RECTYPE of every record the tree names (0 table, 1 view, 2 derived, 5 dynamic view ...). */
  recordTypes: Record<string, number>;
  /** Record Properties' System ID and Row Timestamp fields of those records (when read). */
  recordSync?: Record<string, [string, string]>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The standard methods App Designer gives an interface on a component with these actions (ci01: Add + Update 31; ci02: Update 29). */
export function defaultMethods(actions: number): number {
  return CI_METHODS.Cancel | CI_METHODS.Find | CI_METHODS.Get | CI_METHODS.Save | (actions & ACTION_ADD ? CI_METHODS.Create : 0);
}

/** Whether the component can Add (the Create method and Create keys need it). */
export const canAdd = (actions: number) => !!(actions & ACTION_ADD);

/**
 * The buffer as the window's left tree shows it, every item numbered as
 * SEQUENCE_NBR_6 counts it (ci01-ci04):
 *
 *  - Keys from the search record, field by field in record order: a Get key
 *    for a search key, a Create key for it when the component can Add, a
 *    Find key for a search or alternate search key; a separate add search
 *    record's search keys then as Create keys.
 *  - Level 0 takes a number; then its records in the order their fields first
 *    appear on the pages -- an SQL table's or dynamic view's every field in
 *    record order, another record's keys and its fields placed in the scroll --
 *    each field a number; then each child scroll a number, likewise.
 *  - A Fluid component's system side page, then header page, follow the
 *    component's pages: numbered, never offered (ci04).
 */
export function ciBuffer(src: CiSource): CiBuffer {
  let seq = 0;
  const keys: CiBufferKey[] = [];
  const add = canAdd(src.actions);
  for (const f of src.recordFields(src.searchRecord) ?? []) {
    const search = !!(f.useEdit & UseEdit.SearchKey), alt = !!(f.useEdit & UseEdit.AltSearchKey);
    if (search) keys.push({ type: CI_GET_KEY, seq: ++seq, record: src.searchRecord, field: f.name });
    if (search && add && src.addSearchRecord === src.searchRecord) keys.push({ type: CI_CREATE_KEY, seq: ++seq, record: src.searchRecord, field: f.name });
    if (search || alt) keys.push({ type: CI_FIND_KEY, seq: ++seq, record: src.searchRecord, field: f.name });
  }
  if (add && src.addSearchRecord && src.addSearchRecord !== src.searchRecord) {
    for (const f of src.recordFields(src.addSearchRecord) ?? []) {
      if (f.useEdit & UseEdit.SearchKey) keys.push({ type: CI_CREATE_KEY, seq: ++seq, record: src.addSearchRecord, field: f.name });
    }
  }

  const walk = (scroll: StructureScroll, record: string, scrollName: string, scrollNum: number, aboveKeys: ReadonlySet<string>, collSeq: number): CiBufferScroll => {
    const records = scroll.pageOrder ?? scroll.records.map((r) => r.name);
    // The keys this level gives the levels below: its records' keys, and level 0's the search record's search keys (ci01, ci20).
    const keysHere = new Set(aboveKeys);
    for (const rec of records) for (const f of src.recordFields(rec) ?? []) if (f.useEdit & UseEdit.Key) keysHere.add(f.name);
    if (scroll.level === 0) for (const f of src.recordFields(src.searchRecord) ?? []) if (f.useEdit & UseEdit.SearchKey) keysHere.add(f.name);
    const out: CiBufferScroll = { seq: collSeq, level: scroll.level, scrollNum, scrollName, record, records, fields: [], scrolls: [], system: true };
    for (const rec of records) {
      const whole = wholeRecord(src.recordType(rec), rec, scroll.primary);
      const recordFields = src.recordFields(rec) ?? [];
      const placements = new Map((scroll.placed?.[rec] ?? []).map((p) => [p.field, p]));
      const fields = whole ? recordFields : recordFields.filter((f) => placements.has(f.name) || (f.useEdit & UseEdit.Key));
      for (const f of fields) {
        const p = placements.get(f.name);
        const all = p ? p.controls.map((c, i) => ({ c, u: p.uses[i], sys: p.system?.[i] ?? false, nested: p.nested?.[i] ?? false })) : [];
        const own = all.filter((x) => !x.sys);
        // Defaulting looks at the component's pages and the secondary pages they open, not further (StructurePlacement.nested).
        const shown = own.filter((x) => DATA_CONTROLS.has(x.c) && !(x.u & INVISIBLE) && !x.nested);
        const isKey = !!(f.useEdit & UseEdit.Key);
        const ancestorKey = isKey && aboveKeys.has(f.name);
        const system = all.length > 0 && own.length === 0;
        if (!system) out.system = false;
        out.fields.push({
          seq: ++seq, record: rec, field: f.name, key: isKey, ancestorKey,
          defaulted: !ancestorKey && shown.length > 0, readOnly: shown.some((x) => x.u & DISPLAY_ONLY), system
        });
      }
    }
    scroll.scrolls.forEach((child, i) => {
      const s = ++seq;
      // Named for the scroll's primary record when that is a record of the scroll and not derived, else its first such record
      // (ci04: a grid naming a work record; CI_FPM_CA_CTG_GRP: a grid naming a record it has no field of).
      const inScroll = child.pageOrder ?? [];
      const rec = inScroll.includes(child.primary) && src.recordType(child.primary) !== DERIVED ? child.primary
        : inScroll.find((r) => src.recordType(r) !== DERIVED) ?? child.primary;
      const k = walk(child, rec, `${scrollName}-${pad(child.level)}-${pad(i)}`, i, keysHere, s);
      if (!k.system) out.system = false;
      out.scrolls.push(k);
    });
    return out;
  };
  const level0Seq = ++seq;
  const level0 = walk(src.structure.level0, '', CI_LEVEL0, 0, new Set(), level0Seq);
  level0.system = false;
  const searchFields = [...new Set([src.searchRecord, src.addSearchRecord].filter(Boolean))].flatMap((rec) => (src.recordFields(rec) ?? []).map((f) => ({
    record: rec, field: f.name, searchKey: !!(f.useEdit & UseEdit.SearchKey), altKey: !!(f.useEdit & UseEdit.AltSearchKey)
  })));
  const recordTypes: Record<string, number> = {};
  const note = (s: CiBufferScroll) => { for (const r of s.records) recordTypes[r] = src.recordType(r); s.scrolls.forEach(note); };
  note(level0);
  for (const r of [src.searchRecord, src.addSearchRecord]) if (r) recordTypes[r] = src.recordType(r);
  const recordSync = src.recordSyncFields ? Object.fromEntries(Object.keys(recordTypes).map((r) => [r, src.recordSyncFields!(r) ?? [' ', ' ']])) as Record<string, [string, string]> : undefined;
  return { component: src.component, market: src.market, searchRecord: src.searchRecord, addSearchRecord: src.addSearchRecord, actions: src.actions, keys, level0,
    searchFields, recordTypes, ...(recordSync ? { recordSync } : {}) };
}

/** Every scroll of the buffer, level 0 first. */
export function bufferScrolls(buffer: CiBuffer): CiBufferScroll[] {
  const out: CiBufferScroll[] = [];
  const go = (s: CiBufferScroll) => { out.push(s); s.scrolls.forEach(go); };
  go(buffer.level0);
  return out;
}

export const findBufferScroll = (buffer: CiBuffer, scrollName: string) => bufferScrolls(buffer).find((s) => s.scrollName === scrollName);

const keyItem = (k: CiBufferKey): CiItem => ({
  type: k.type, parent: CI_ROOT, name: k.field, seq: k.seq, readOnly: false, level: 0, scrollNum: 0, scrollName: CI_KEY_SCROLL[k.type],
  record: k.record, field: k.field, comment: ' ', syncId: 0, key: true
});

const propertyItem = (s: CiBufferScroll, f: CiBufferField, parent: string, readOnly: boolean): CiItem => ({
  type: CI_PROPERTY, parent, name: f.field, seq: f.seq, readOnly, level: s.level, scrollNum: s.scrollNum, scrollName: s.scrollName,
  record: f.record, field: f.field, comment: ' ', syncId: 0, key: f.key
});

const collectionItem = (s: CiBufferScroll, parent: string, name: string): CiItem => ({
  type: CI_COLLECTION, parent, name, seq: s.seq, readOnly: false, level: s.level, scrollNum: s.scrollNum, scrollName: s.scrollName,
  record: s.record, field: ' ', comment: ' ', syncId: 0, key: false
});

const byName = (a: CiItem, b: CiItem) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const byRecordThenName = (a: CiItem, b: CiItem) => (a.record < b.record ? -1 : a.record > b.record ? 1 : byName(a, b));

/** A property name its collection does not have yet: NAME, else NAME_0, NAME_1 ... (ci01, ci04). */
function freePropertyName(base: string, taken: ReadonlySet<string>): string {
  let name = base;
  for (let n = 0; taken.has(name); n++) name = `${base}_${n}`;
  return name;
}

/** A collection name no collection has yet: NAME, else NAME2, NAME3 ... (ci01). */
function freeCollectionName(base: string, items: readonly CiItem[]): string {
  const taken = new Set(items.filter((i) => i.type === CI_COLLECTION).map((i) => i.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
  return name;
}

/**
 * A collection's items as App Designer makes them, in the window's order --
 * its properties by record, then name (named NAME_0 ... against each other),
 * then its child collections in their scrolls' order, each followed by its
 * own. `pick` chooses the fields (defaulting: the defaulted ones; a drag:
 * every field but the ancestor keys) and their Read Only.
 */
function makeSubtree(s: CiBufferScroll, parent: string, existing: CiItem[], pick: (f: CiBufferField) => boolean, readOnly: (f: CiBufferField) => boolean,
  keepEmpty: boolean): CiItem[] {
  const props = s.fields.filter(pick).map((f) => propertyItem(s, f, parent, readOnly(f))).sort(byRecordThenName);
  const taken = new Set(existing.filter((i) => i.parent === parent && i.type === CI_PROPERTY).map((i) => i.name));
  for (const p of props) { p.name = freePropertyName(p.name, taken); taken.add(p.name); }
  const out: CiItem[] = [...props];
  for (const k of s.scrolls) {
    const name = freeCollectionName(k.record, [...existing, ...out]);
    const coll = collectionItem(k, parent, name);
    const kids = makeSubtree(k, name, [...existing, ...out, coll], pick, readOnly, keepEmpty);
    // A collection with nothing in it is not kept (ci04: scrolls of push buttons only); it keeps its numbers.
    if (kids.length || keepEmpty) out.push(coll, ...kids);
  }
  return out;
}

/**
 * The interface App Designer defaults from a component: its key items, then
 * (`properties`, the (123,12) prompt's Yes) every field the buffer defaults,
 * in the window's order and with the names it first shows (ci01-ci04; No:
 * ci28). SYNCIDs are 0 and the save's names not yet applied: the save gives
 * both (assignSyncIds, saveNames).
 */
export function ciFromBuffer(name: string, buffer: CiBuffer, properties = true): CiDocument {
  const items: CiItem[] = [];
  for (const t of CI_KEY_TYPES) items.push(...buffer.keys.filter((k) => k.type === t).map(keyItem).sort(byName));
  if (properties) items.push(...makeSubtree(buffer.level0, CI_ROOT, items, (f) => f.defaulted, (f) => f.readOnly, false));
  return {
    name, displayName: name, component: buffer.component, market: buffer.market, menu: ' ', searchRecord: buffer.searchRecord,
    addSearchRecord: buffer.addSearchRecord, description: ' ', comments: '', owner: ' ', methods: defaultMethods(buffer.actions), items
  };
}

/** ciFromBuffer, from the component's source, with SYNCIDs from `nextSyncId` and the save's names: what App Designer's first save stores. */
export function ciFromComponent(name: string, src: CiSource, nextSyncId = 1): CiDocument {
  const doc = ciFromBuffer(name, ciBuffer(src));
  assignSyncIds(doc.items, nextSyncId);
  saveNames(doc.items);
  return doc;
}

// ---------------------------------------------------------------------------
// The window's order, SYNCIDs and the save's names

/** The items in the window's order: the key sets, then the properties tree in the order the items array gives each node's children. */
export function windowOrder(items: readonly CiItem[]): CiItem[] {
  const out: CiItem[] = [];
  for (const t of CI_KEY_TYPES) out.push(...items.filter((i) => i.type === t));
  const node = (parent: string) => {
    for (const i of items) {
      if (i.parent !== parent || (i.type !== CI_PROPERTY && i.type !== CI_COLLECTION)) continue;
      out.push(i);
      if (i.type === CI_COLLECTION) node(i.name);
    }
  };
  node(CI_ROOT);
  return out;
}

/** The window's order of an interface as read: the key sets, then the properties tree, each node's children by SEQUENCE_NBR_6 (ci05). */
export function readOrder(items: readonly CiItem[]): CiItem[] {
  const bySeq = [...items].sort((a, b) => a.seq - b.seq || byName(a, b));
  return windowOrder(bySeq);
}

/** Gives every item without a SYNCID the next, in the window's order (ci01-ci04, ci14, ci20, ci25); returns the last given (or `next - 1`). */
export function assignSyncIds(items: readonly CiItem[], next: number): number {
  let id = next;
  for (const it of windowOrder(items)) if (!it.syncId) it.syncId = id++;
  return id - 1;
}

/**
 * The names App Designer's save stores, across collections (ci01, ci03,
 * ci04): in buffer order, each name counts the items that had it -- a key
 * property or a collection twice, another property once -- and an item
 * whose name n were counted against is stored NAME_(n-1): EONC_TOKENID (a
 * key), _1, _3, _5; DESCR100, _0, _1, _2; GPFR_DA_CODE (a collection),
 * then its key property _1, then a property _3. A collection's items follow
 * its new name. The window keeps showing the names it had until the
 * interface is opened again. Renames in place; returns the renamed items'
 * old names.
 */
export function saveNames(items: CiItem[]): Map<CiItem, string> {
  const seen = new Map<string, number>();
  const renamed = new Map<CiItem, string>();
  for (const it of [...items].filter((i) => i.type === CI_PROPERTY || i.type === CI_COLLECTION).sort((a, b) => a.seq - b.seq)) {
    const n = seen.get(it.name) ?? 0;
    seen.set(it.name, n + (it.type === CI_COLLECTION || it.key ? 2 : 1));
    if (n === 0) continue;
    const old = it.name;
    it.name = `${old}_${n - 1}`;
    renamed.set(it, old);
    if (it.type === CI_COLLECTION) for (const child of items) if (child.parent === old && child !== it) child.parent = it.name;
  }
  return renamed;
}

/** The order App Designer's tree shows an interface it has just made (ci01-ci04): keys by name, properties by record, then name, collections in scroll order. */
export function displayOrder(items: readonly CiItem[]): CiItem[] {
  const out: CiItem[] = [];
  for (const t of CI_KEY_TYPES) out.push(...items.filter((i) => i.type === t).sort(byName));
  const node = (parent: string) => {
    out.push(...items.filter((i) => i.type === CI_PROPERTY && i.parent === parent).sort(byRecordThenName));
    for (const c of items.filter((i) => i.type === CI_COLLECTION && i.parent === parent).sort((a, b) => a.seq - b.seq)) { out.push(c); node(c.name); }
  };
  node(CI_ROOT);
  return out;
}

// ---------------------------------------------------------------------------
// Rows

export type Row = Record<string, unknown>;

export interface CiRows {
  defn: Row;
  items: Row[];
  sync: Row[];
}

const trim = (v: unknown) => String(v ?? '').trim();
const blank = (v: string) => (v.trim() === '' ? ' ' : v);

export function documentFromRows(rows: CiRows): CiDocument {
  const d = rows.defn;
  const items: CiItem[] = rows.items.map((r) => ({
    type: Number(r.BCTYPE), parent: trim(r.BCITEMPARENT), name: trim(r.BCITEMNAME), seq: Number(r.SEQUENCE_NBR_6),
    readOnly: Number(r.BCACCESS) === 2, level: Number(r.BCSCROLL), scrollNum: Number(r.BCSCROLLNUM), scrollName: trim(r.BCSCROLLNAME),
    record: trim(r.RECNAME), field: blank(trim(r.FIELDNAME)), comment: blank(String(r.COMMENTSHORT ?? '').trimEnd()), syncId: Number(r.SYNCID),
    key: false, devicePersist: Number(r.MPDEVICEPERSISTINT ?? 0)
  }));
  const [s] = rows.sync;
  return {
    name: trim(d.BCNAME), displayName: trim(d.BCDISPLAYNAME), component: trim(d.BCPGNAME), market: trim(d.MARKET), menu: blank(trim(d.MENUNAME)),
    searchRecord: trim(d.SEARCHRECNAME), addSearchRecord: trim(d.ADDSRCHRECNAME), description: blank(trim(d.DESCR)),
    comments: d.DESCRLONG === null || d.DESCRLONG === undefined ? '' : String(d.DESCRLONG), owner: blank(trim(d.OBJECTOWNERID)),
    methods: Number(d.BCSTDMETHODS),
    ...(s ? { sync: { conflict: Number(s.CONFLICTRESOLUTION), messageSet: Number(s.MSGSET), upload: blank(trim(s.MPDEVICEPERSIST)),
      relatedProject: blank(trim(s.RELCONTENTPROJ)), syncId: Number(s.SYNCID) } } : {}),
    items: readOrder(items)
  };
}

/** Marks the items that are key fields of their records (for the save's names and the window's icons). */
export function markKeys(doc: CiDocument, isKey: (record: string, field: string) => boolean): void {
  for (const it of doc.items) it.key = it.type !== CI_COLLECTION && isKey(it.record, it.field.trim());
}

/** The rows a document stores (stamps -- VERSION, LASTUPDDTTM, LASTUPDOPRID -- left to the save). */
export function rowsFromDocument(doc: CiDocument): CiRows {
  const defn: Row = {
    BCNAME: doc.name, BCDISPLAYNAME: doc.displayName || doc.name, BCPGNAME: doc.component, MARKET: doc.market, MENUNAME: blank(doc.menu),
    SEARCHRECNAME: doc.searchRecord, ADDSRCHRECNAME: doc.addSearchRecord, ITEMCOUNT: doc.items.length, DESCR: blank(doc.description),
    BCSTDMETHODS: doc.methods, OBJECTOWNERID: blank(doc.owner), DESCRLONG: doc.comments === '' ? null : doc.comments
  };
  const items: Row[] = doc.items.map((it) => ({
    BCNAME: doc.name, BCTYPE: it.type, BCITEMPARENT: it.parent, BCITEMNAME: it.name, SEQUENCE_NBR_6: it.seq, BCACCESS: it.readOnly ? 2 : 1,
    BCSCROLL: it.level, BCSCROLLNUM: it.scrollNum, BCSCROLLNAME: it.scrollName, RECNAME: it.record, FIELDNAME: blank(it.field), SUBRECNAME: ' ',
    COMMENTSHORT: blank(it.comment), SYNCID: it.syncId, MPDEVICEPERSISTINT: it.devicePersist ?? 0
  }));
  const sync: Row[] = doc.sync ? [{
    BCNAME: doc.name, SYNCID: doc.sync.syncId, CONFLICTRESOLUTION: doc.sync.conflict, MSGSET: doc.sync.messageSet,
    RELCONTENTPROJ: blank(doc.sync.relatedProject), MPDEVICEPERSIST: blank(doc.sync.upload)
  }] : [];
  return { defn, items, sync };
}

// ---------------------------------------------------------------------------
// The window's edits (pure: each returns a new document)

const clone = (doc: CiDocument): CiDocument => ({ ...doc, ...(doc.sync ? { sync: { ...doc.sync } } : {}), items: doc.items.map((i) => ({ ...i })) });

/** An item by its key: BCTYPE, parent, name. */
export interface CiItemRef { type: number; parent: string; name: string }
const refOf = (i: CiItem): CiItemRef => ({ type: i.type, parent: i.parent, name: i.name });
const isRef = (i: CiItem, r: CiItemRef) => i.type === r.type && i.parent === r.parent && i.name === r.name;

function find(doc: CiDocument, ref: CiItemRef): CiItem {
  const it = doc.items.find((i) => isRef(i, ref));
  if (!it) throw new CiEditError(`${ref.parent === CI_ROOT ? '' : `${ref.parent}.`}${ref.name} is not in ${doc.name}.`);
  return it;
}

/** A collection's name and all its descendants'. */
function subtree(items: readonly CiItem[], collection: string): CiItem[] {
  const out: CiItem[] = [];
  const go = (parent: string) => { for (const i of items) if (i.parent === parent && i.type !== CI_GET_KEY && i.type !== CI_FIND_KEY && i.type !== CI_CREATE_KEY) { out.push(i); if (i.type === CI_COLLECTION) go(i.name); } };
  go(collection);
  return out;
}

/** Index in `items` after a node's last descendant (where the window appends to it). */
function endOf(items: readonly CiItem[], parent: string): number {
  if (parent === CI_ROOT) return items.length;
  const coll = items.findIndex((i) => i.type === CI_COLLECTION && i.name === parent);
  const desc = new Set(subtree(items, parent));
  let at = coll;
  for (let i = coll + 1; i < items.length; i++) if (desc.has(items[i])) at = i;
  return at + 1;
}

/** Definition Properties > General (ci05). */
export function setCi(doc: CiDocument, patch: Partial<Pick<CiDocument, 'description' | 'comments' | 'owner' | 'menu'>>): CiDocument {
  const d = clone(doc);
  if (patch.description !== undefined) d.description = blank(patch.description.slice(0, 30));
  if (patch.comments !== undefined) d.comments = patch.comments;
  if (patch.owner !== undefined) d.owner = blank(patch.owner);
  if (patch.menu !== undefined) d.menu = blank(patch.menu);
  return d;
}

/** Definition Properties > Standard Methods (ci06): Create only on a component that can Add (it is greyed otherwise). */
export function setMethods(doc: CiDocument, methods: Partial<Record<CiMethod, boolean>>, actions: number): CiDocument {
  const d = clone(doc);
  for (const [m, on] of Object.entries(methods) as [CiMethod, boolean][]) {
    if (m === 'Create' && on && !canAdd(actions)) throw new CiEditError(`Create needs a component that can Add; ${doc.component} cannot.`);
    d.methods = on ? d.methods | CI_METHODS[m] : d.methods & ~CI_METHODS[m];
  }
  return d;
}

/** Definition Properties > Synchronization (ci07-ci10): undefined clears Synchronizable (the row goes). */
export function setSync(doc: CiDocument, sync: Partial<Omit<CiSync, 'syncId'>> | undefined): CiDocument {
  const d = clone(doc);
  if (!sync) { delete d.sync; return d; }
  const was = d.sync ?? { conflict: 1, messageSet: 0, upload: ' ', relatedProject: ' ', syncId: 0 };
  d.sync = {
    conflict: sync.conflict ?? was.conflict, messageSet: sync.messageSet ?? was.messageSet, upload: blank(sync.upload ?? was.upload),
    relatedProject: blank(sync.relatedProject ?? was.relatedProject), syncId: was.syncId
  };
  if (![1, 2, 3].includes(d.sync.conflict)) throw new CiEditError('Conflict resolution is 1 (Server Wins), 2 (Device Wins) or 3 (Custom).');
  if (![' ', 'N', 'Y', 'D'].includes(d.sync.upload)) throw new CiEditError("Upload is 'N' (Yes), 'Y' (restore server values) or 'D' (retain device values).");
  return d;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Edit Property: Name, Comment, Read Only Access (ci11, ci12); a collection's Name only. A rename keeps the SYNCID. */
export function setItem(doc: CiDocument, ref: CiItemRef, patch: { name?: string; comment?: string; readOnly?: boolean }): CiDocument {
  const d = clone(doc);
  const it = find(d, ref);
  if (patch.name !== undefined && patch.name !== it.name) {
    const name = patch.name.trim();
    if (!NAME_RE.test(name) || name.length > 30) throw new CiEditError(`${name} is not a valid name (a letter, then letters, digits and _; 30 at most).`);
    const clash = it.type === CI_COLLECTION
      ? d.items.some((i) => i.type === CI_COLLECTION && i.name === name)
      : d.items.some((i) => i !== it && i.type === it.type && i.parent === it.parent && i.name === name);
    if (clash) throw new CiEditError(`${name} is already in ${it.type === CI_COLLECTION ? doc.name : it.parent}.`);
    if (it.type === CI_COLLECTION) for (const c of d.items) if (c.parent === it.name && c !== it) c.parent = name;
    it.name = name;
  }
  if (patch.comment !== undefined) {
    if (it.type === CI_COLLECTION) throw new CiEditError('A collection has no comment.');
    it.comment = blank(patch.comment.slice(0, 30));
  }
  if (patch.readOnly !== undefined) {
    if (it.type === CI_COLLECTION) throw new CiEditError('A collection has no Read Only Access (it is greyed).');
    it.readOnly = patch.readOnly;
  }
  return d;
}

/** Delete: an item, a collection with everything under it (ci13, ci16, ci19); no prompt. */
export function deleteItem(doc: CiDocument, ref: CiItemRef): CiDocument {
  const d = clone(doc);
  const it = find(d, ref);
  const gone = new Set([it, ...(it.type === CI_COLLECTION ? subtree(d.items, it.name) : [])]);
  d.items = d.items.filter((i) => !gone.has(i));
  return d;
}

/**
 * A key dragged from the search record onto GETKEYS, FINDKEYS or CREATEKEYS
 * (ci17): only a key App Designer would make (a field that is not a search
 * key on GETKEYS is not taken: ci18); numbered as the buffer numbers it.
 */
export function addKey(doc: CiDocument, buffer: CiBuffer, type: number, field: string): CiDocument {
  const k = buffer.keys.find((x) => x.type === type && x.field === field);
  if (!k) throw new CiEditError(`${field} cannot be a ${CI_KEY_SET_NAMES[type] ?? 'key'} item (${type === CI_GET_KEY ? 'a search key' : type === CI_FIND_KEY ? 'a search or alternate search key' : "the add search record's search key"} of a component that ${type === CI_CREATE_KEY ? 'can Add' : 'has it'}).`);
  if (doc.items.some((i) => i.type === type && i.field.trim() === field)) throw new CiEditError(`${field} is already in ${CI_KEY_SET_NAMES[type]}.`);
  const d = clone(doc);
  const item = keyItem(k);
  // Appended after the set's last key (the window adds it at the end).
  let at = -1;
  d.items.forEach((i, n) => { if (i.type === type) at = n; });
  d.items.splice(at >= 0 ? at + 1 : d.items.length, 0, item);
  return d;
}

/**
 * A record field dragged from the left tree onto a collection (or
 * PROPERTIES for level 0) of its scroll (ci14, ci15): any control, Long
 * Edit Boxes and push buttons too; numbered as the buffer numbers it;
 * Read Only off; named NAME_0 ... against the collection's properties.
 */
export function addField(doc: CiDocument, buffer: CiBuffer, scrollName: string, record: string, field: string): CiDocument {
  const s = findBufferScroll(buffer, scrollName);
  const f = s?.fields.find((x) => x.record === record && x.field === field);
  if (!s || !f) throw new CiEditError(`${record}.${field} is not in the component's buffer at ${scrollName}.`);
  if (f.ancestorKey) throw new CiEditError(`${record}.${field} is a key of the level above; it is the parent's.`);
  const parent = s.scrollName === CI_LEVEL0 ? CI_ROOT : doc.items.find((i) => i.type === CI_COLLECTION && i.scrollName === s.scrollName)?.name;
  if (!parent) throw new CiEditError(`There is no collection for the scroll of ${s.record} (${scrollName}); add the scroll first.`);
  if (doc.items.some((i) => i.type === CI_PROPERTY && i.scrollName === scrollName && i.record === record && i.field.trim() === field)) {
    throw new CiEditError(`${record}.${field} is already a property of ${parent}.`);
  }
  const d = clone(doc);
  const item = propertyItem(s, f, parent, false);
  item.name = freePropertyName(field, new Set(d.items.filter((i) => i.parent === parent && i.type === CI_PROPERTY).map((i) => i.name)));
  d.items.splice(endOf(d.items, parent), 0, item);
  return d;
}

/**
 * A scroll dragged from the left tree onto PROPERTIES or its parent's
 * collection (ci20-ci23): its collection -- made, or the one there is,
 * merged into -- with every field of the scroll but the keys of the levels
 * above (any control, invisible ones too), and its child scrolls likewise;
 * Read Only off.
 */
export function addScroll(doc: CiDocument, buffer: CiBuffer, scrollName: string): CiDocument {
  const s = findBufferScroll(buffer, scrollName);
  if (!s || s.scrollName === CI_LEVEL0) throw new CiEditError(`${scrollName} is not a scroll of the component below level 0.`);
  const parentScroll = scrollName.split('-').slice(0, -2).join('-');
  const parent = parentScroll === CI_LEVEL0 ? CI_ROOT : doc.items.find((i) => i.type === CI_COLLECTION && i.scrollName === parentScroll)?.name;
  if (!parent) throw new CiEditError(`The scroll above ${s.record} has no collection; add it first.`);
  const d = clone(doc);
  const pick = (f: CiBufferField) => !f.ancestorKey;
  const merge = (sc: CiBufferScroll, under: string) => {
    const existing = d.items.find((i) => i.type === CI_COLLECTION && i.scrollName === sc.scrollName);
    if (!existing) {
      const name = freeCollectionName(sc.record, d.items);
      const coll = collectionItem(sc, under, name);
      const kids = makeSubtree(sc, name, [...d.items, coll], pick, () => false, true);
      d.items.splice(endOf(d.items, under), 0, coll, ...kids);
      return;
    }
    const have = new Set(d.items.filter((i) => i.type === CI_PROPERTY && i.scrollName === sc.scrollName).map((i) => `${i.record}.${i.field.trim()}`));
    const fresh = sc.fields.filter((f) => pick(f) && !have.has(`${f.record}.${f.field}`))
      .map((f) => propertyItem(sc, f, existing.name, false)).sort(byRecordThenName);
    const taken = new Set(d.items.filter((i) => i.parent === existing.name && i.type === CI_PROPERTY).map((i) => i.name));
    for (const p of fresh) { p.name = freePropertyName(p.name, taken); taken.add(p.name); }
    d.items.splice(endOf(d.items, existing.name), 0, ...fresh);
    for (const k of sc.scrolls) merge(k, existing.name);
  };
  merge(s, parent);
  return d;
}

/** File > Save As (ci25): the copy's every item gets a new SYNCID at its save, in the window's order. */
export function copyCi(doc: CiDocument, name: string): CiDocument {
  const d = clone(doc);
  d.name = name;
  d.displayName = name;
  for (const i of d.items) i.syncId = 0;
  if (d.sync) d.sync.syncId = 0;
  return d;
}

/** The key of every item, in the window's order (for tests and the MCP). */
export const itemRefs = (doc: CiDocument): CiItemRef[] => windowOrder(doc.items).map(refOf);

// ---------------------------------------------------------------------------
// Checks (App Designer's Validate for Consistency, as far as the save needs it)

export interface CiDiagnostic { severity: 'error' | 'warning'; code: string; path: string; message: string }

export function validateCi(doc: CiDocument, buffer?: CiBuffer): CiDiagnostic[] {
  const out: CiDiagnostic[] = [];
  const err = (code: string, path: string, message: string) => out.push({ severity: 'error', code, path, message });
  if (!NAME_RE.test(doc.name) || doc.name.length > 30) err('name', doc.name, `${doc.name} is not a valid Component Interface name.`);
  const seen = new Set<string>();
  const collections = new Set(doc.items.filter((i) => i.type === CI_COLLECTION).map((i) => i.name));
  for (const i of doc.items) {
    const k = `${i.type}|${i.parent}|${i.name}`;
    if (seen.has(k)) err('duplicate', `${i.parent}.${i.name}`, `${i.name} is twice in ${i.parent}.`);
    seen.add(k);
    if (i.parent !== CI_ROOT && !collections.has(i.parent)) err('orphan', `${i.parent}.${i.name}`, `${i.name}'s collection ${i.parent} is not in the interface.`);
    if (!NAME_RE.test(i.name)) err('item-name', `${i.parent}.${i.name}`, `${i.name} is not a valid name.`);
  }
  // Synchronizable: the search record and each non-derived record with items need Record Properties' System ID and Row
  // Timestamp fields -- App Designer's Validate reports each missing one (and still saves).
  if (doc.sync && buffer?.recordSync) {
    const records = [doc.searchRecord, ...[...doc.items].sort((a, b) => a.seq - b.seq).filter((i) => i.type !== CI_COLLECTION).map((i) => i.record)];
    for (const r of [...new Set(records)]) {
      if (buffer.recordTypes[r] === DERIVED) continue;
      const [systemId, timestamp] = buffer.recordSync[r] ?? [' ', ' '];
      if (!systemId.trim()) out.push({ severity: 'warning', code: 'sync-systemid', path: r, message: `Record '${r}' must have a SystemID field selected in Record Properties to be synchronizable` });
      if (!timestamp.trim()) out.push({ severity: 'warning', code: 'sync-timestamp', path: r, message: `Record '${r}' must have a Row Timestamp field selected in Record Properties to be synchronizable` });
    }
  }
  if ((doc.methods & CI_METHODS.Create) && !doc.items.some((i) => i.type === CI_CREATE_KEY)) {
    out.push({ severity: 'warning', code: 'create-keys', path: 'CREATEKEYS', message: 'Create is a standard method but there are no Create keys.' });
  }
  return out;
}
