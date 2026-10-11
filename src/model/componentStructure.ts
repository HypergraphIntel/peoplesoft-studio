import type { Row } from './uiDefinitions.js';

/*
 * App Designer's component Structure tab: the component buffer -- the search
 * record, then the records at each scroll level -- built from the pages'
 * PSPNLFIELD rows. Matched against App Designer's Structure tab for
 * JOB_DATA.GBL on HRDMO (docs/COMPONENTS.md): every record and scroll shown,
 * in App Designer's order. The rules:
 *
 *  - The component's pages are walked in order (PSPNLGROUP.SUBITEMNUM), each
 *    page's controls by FIELDNUM; a subpage (FIELDTYPE 11) or secondary page
 *    (18) is walked in place, its levels offset by the control's OCCURSLEVEL.
 *  - A Scroll Bar (10), Grid (19) or Scroll Area (27) starts a scroll at its
 *    OCCURSLEVEL; the fields after it at that level belong to it. Its primary
 *    record is the record the control names, else the first non-Derived/Work
 *    record among its fields.
 *  - Related-display fields (FIELDUSE 0x10) are not in the buffer.
 *  - A subpage control naming a record substitutes it for the record the
 *    subpage is built on (its first non-derived record) when the named record
 *    is not Derived/Work, or when the subpage is built on a subrecord.
 *  - Scrolls under the same parent with the same primary record are one
 *    scroll (the same rowset on several pages).
 *  - A subpage placed on a non-derived record whose own fields are on the
 *    subpage's level goes, with that level's fields, to the scroll that
 *    record is primary of (JOB_JR's subpages placed in JOB's scroll are in the
 *    JOB_JR scroll).
 *  - Records are listed in the order their fields first appear.
 */

/** PSPNLFIELD columns the walk reads. */
export interface StructureField {
  FIELDNUM: number;
  FIELDTYPE: number;
  OCCURSLEVEL: number;
  RECNAME: string;
  FIELDNAME: string;
  SUBPNLNAME: string;
  FIELDUSE: number;
}

export interface StructureRecord {
  name: string;
  /** PSRECDEFN.RECTYPE (-1 when the record does not exist). */
  type: number;
}

export interface StructureScroll {
  level: number;
  primary: string;
  records: StructureRecord[];
  scrolls: StructureScroll[];
}

export interface ComponentStructure {
  searchRecord?: StructureRecord;
  /** Level 0: its records and level-1 scrolls. */
  level0: StructureScroll;
  /** Each record's fields placed on the component's pages, in the order they first appear (related displays aside). */
  pageFields: Record<string, string[]>;
}

const SUBPAGE = 11;
const SECONDARY_PAGE = 18;
const SCROLLS = new Set([10, 19, 27]);
const RELATED_DISPLAY = 0x10;
const DERIVED = 2;
const SUBRECORD = 3;

const trim = (v: unknown) => String(v ?? '').trim();

interface Node { level: number; primary?: string; recs: string[]; kids: Node[]; into?: Node }
interface Context { rec: string; level: number; id: number }
interface FieldEvent { kind: 'field'; level: number; rec: string; field: string; ctx?: Context; node?: Node }
interface ScrollEvent { kind: 'scroll'; level: number; rec: string }

/**
 * The Structure tab for a component's pages. `fieldsOf` gives a page's
 * PSPNLFIELD rows (subpages and secondary pages included, by name); `typeOf`
 * a record's RECTYPE.
 */
export function buildComponentStructure(pages: readonly string[], searchRecord: string,
  fieldsOf: (page: string) => readonly StructureField[] | undefined, typeOf: (record: string) => number): ComponentStructure {
  const derived = (r: string) => typeOf(r) === DERIVED;
  const fields = (p: string) => [...(fieldsOf(p) ?? [])].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM));
  const infoRecord = (page: string) => fields(page).find((f) =>
    trim(f.RECNAME) && trim(f.FIELDNAME) && !(Number(f.FIELDUSE) & RELATED_DISPLAY) && !derived(trim(f.RECNAME)))?.RECNAME.trim();

  const events: Array<FieldEvent | ScrollEvent> = [];
  let contexts = 0;
  const walk = (page: string, base: number, subst: Record<string, string>, ctx: Context | undefined, seen: Set<string>) => {
    if (seen.has(page)) return; // a page that includes itself
    const inner = new Set(seen).add(page);
    for (const f of fields(page)) {
      const level = base + Number(f.OCCURSLEVEL);
      const type = Number(f.FIELDTYPE);
      const rec = trim(f.RECNAME), sub = trim(f.SUBPNLNAME);
      if ((type === SUBPAGE || type === SECONDARY_PAGE) && sub) {
        let next = subst, nextCtx = ctx;
        if (type === SUBPAGE && rec) {
          const from = infoRecord(sub), toDerived = derived(rec);
          if (from && from !== rec && (!toDerived || typeOf(from) === SUBRECORD)) next = { ...subst, [from]: rec };
          if (!toDerived) nextCtx = { rec, level, id: ++contexts };
        }
        walk(sub, level, next, nextCtx, inner);
        continue;
      }
      const record = subst[rec] ?? rec;
      if (SCROLLS.has(type)) events.push({ kind: 'scroll', level, rec: record });
      else if (record && trim(f.FIELDNAME) && !(Number(f.FIELDUSE) & RELATED_DISPLAY)) events.push({ kind: 'field', level, rec: record, field: trim(f.FIELDNAME), ...(ctx ? { ctx } : {}) });
    }
  };
  for (const p of pages) walk(p, 0, {}, undefined, new Set());

  // First pass: scrolls and the records seen in each.
  const root: Node = { level: 0, recs: [], kids: [] };
  const stack: Node[] = [root];
  for (const e of events) {
    if (e.kind === 'scroll') {
      const parent = stack[e.level - 1] ?? stack[stack.length - 1];
      const node: Node = { level: e.level, ...(e.rec ? { primary: e.rec } : {}), recs: [], kids: [] };
      parent.kids.push(node);
      stack[e.level] = node;
      stack.length = e.level + 1;
    } else {
      const node = stack[e.level] ?? stack[stack.length - 1];
      e.node = node;
      if (!node.recs.includes(e.rec)) node.recs.push(e.rec);
    }
  }

  // Primaries, then one scroll per primary under each parent.
  const resolve = (node: Node) => {
    for (const k of node.kids) {
      k.primary ??= k.recs.find((r) => !derived(r)) ?? k.recs[0] ?? '';
      resolve(k);
    }
    const merged: Node[] = [];
    for (const k of node.kids) {
      const same = merged.find((m) => m.primary === k.primary);
      if (same) { k.into = same; same.kids.push(...k.kids); } else merged.push(k);
    }
    node.kids = merged;
    if (merged.some((k) => k.kids.length)) for (const k of merged) resolve(k);
  };
  resolve(root);

  // Second pass: each field to its scroll, or with its subpage to that subpage's record's scroll.
  const canon = (n: Node) => { while (n.into) n = n.into; return n; };
  const byPrimary = new Map<string, Node>();
  const index = (n: Node) => { for (const k of n.kids) { if (k.primary && !byPrimary.has(k.primary)) byPrimary.set(k.primary, k); index(k); } };
  index(root);
  const clear = (n: Node) => { n.recs = []; n.kids.forEach(clear); };
  clear(root);
  const moving = new Set(events.filter((e): e is FieldEvent => e.kind === 'field' && !!e.ctx && e.rec === e.ctx.rec && e.level === e.ctx.level)
    .map((e) => e.ctx!.id));
  for (const e of events) {
    if (e.kind !== 'field' || !e.node) continue;
    let node = canon(e.node);
    const home = e.ctx && e.level === e.ctx.level && moving.has(e.ctx.id) ? byPrimary.get(e.ctx.rec) : undefined;
    if (home && home !== node) node = home;
    if (!node.recs.includes(e.rec)) node.recs.push(e.rec);
  }

  const out = (n: Node): StructureScroll => {
    const primary = n.primary ?? '';
    const recs = n.recs.includes(primary) ? [primary, ...n.recs.filter((r) => r !== primary)] : n.recs;
    return { level: n.level, primary, records: recs.map((r) => ({ name: r, type: typeOf(r) })), scrolls: n.kids.map(out) };
  };
  const pageFields: Record<string, string[]> = {};
  for (const e of events) {
    if (e.kind !== 'field') continue;
    const list = (pageFields[e.rec] ??= []);
    if (!list.includes(e.field)) list.push(e.field);
  }
  const search = searchRecord.trim();
  return { ...(search ? { searchRecord: { name: search, type: typeOf(search) } } : {}), level0: out(root), pageFields };
}

/** The pages a walk reaches from these: subpages and secondary pages, recursively (for loading their fields). */
export function referencedPages(rows: readonly Row[]): string[] {
  return [...new Set(rows.filter((r) => [SUBPAGE, SECONDARY_PAGE].includes(Number(r.FIELDTYPE)) && trim(r.SUBPNLNAME)).map((r) => trim(r.SUBPNLNAME)))];
}
