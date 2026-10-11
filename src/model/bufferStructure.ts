import type { ComponentStructure, StructureScroll } from './componentStructure.js';
import { checkPageScrolls, pageScrolls, type CheckedControl, type PageProblem } from './pageLevels.js';

/*
 * The scroll structure of a page and the component buffer of a component, as an agent needs them: each scroll level's
 * rowset, its primary record and that record's keys -- which of them tie a row to its parent row and which tell its rows
 * apart -- the other records in it, and how PeopleCode reaches it.
 *
 * What is App Designer's own and proven: the levels (pageLevels.ts occursLevels: 17354 of HRDMO's 17356 pages), its page
 * checks (checkPageScrolls, Message Set 15), the component Structure tab (componentStructure.ts, JOB_DATA and
 * ZZ_PCODE_LAB_LVC). The design notes are the Component Processor's rules for loading a scroll, not App Designer checks:
 * a child scroll's rows are selected by the keys it shares, by field name, with the rows above it.
 */

export interface RecordInfo {
  /** PSRECDEFN.RECTYPE: 0 SQL Table, 1 SQL View, 2 Derived/Work, 3 Subrecord, 5 Dynamic View, 6 Query View, 7 Temporary Table. */
  type: number;
  /** Key fields (USEEDIT Key / Duplicate Order Key), in record order. */
  keys: string[];
}

const RECORD_TYPES: Record<number, string> = { 0: 'SQL Table', 1: 'SQL View', 2: 'Derived/Work', 3: 'Subrecord', 5: 'Dynamic View', 6: 'Query View', 7: 'Temporary Table' };
export const recordTypeName = (t: number | undefined) => (t === undefined || t < 0 ? 'not found' : RECORD_TYPES[t] ?? `type ${t}`);

/** How PeopleCode reaches a scroll's rows and fields, from the top of the component buffer. */
export interface PeopleCodeAccess {
  /** The rowset object: GetLevel0()(1).GetRowset(Scroll.A)(&i1).GetRowset(Scroll.B). */
  rowset: string;
  /** One row's field value through the object path. */
  fieldValue: string;
  /** The built-in function forms with scroll paths (ActiveRowCount, FetchValue, UpdateValue, RowCount). */
  builtIns: string[];
}

/** One scroll level of a component buffer or a page. */
export interface BufferScroll {
  level: number;
  /** The rowset's record: Scroll.<primary> in PeopleCode. */
  primary: string;
  primaryType: string;
  /** The primary record's keys; `parentKeys` are those also keyed above it (they select its rows for each parent row), `rowKeys` the rest. */
  keys: string[];
  parentKeys: string[];
  rowKeys: string[];
  /** Every record in this rowset's rows, with its type and the fields placed on the pages. */
  records: Array<{ name: string; type: string; pageFields: string[] }>;
  peopleCode: PeopleCodeAccess;
  /** Design notes from the keys (not App Designer checks). */
  notes: string[];
  scrolls: BufferScroll[];
}

/** The PeopleCode for a scroll reached by `chain` (the primary records from level 1 down), its field `field` of `record`. */
export function peopleCodeAccess(chain: readonly string[], record: string, field: string): PeopleCodeAccess {
  const rowset = ['GetLevel0()(1)', ...chain.map((r, i) => `GetRowset(Scroll.${r})${i < chain.length - 1 ? `(&i${i + 1})` : ''}`)].join('.');
  const row = `${rowset}(&i${chain.length})`;
  const path = (withLast: boolean) => chain.map((r, i) => `Scroll.${r}${i < chain.length - 1 || withLast ? `, &i${i + 1}` : ''}`).join(', ');
  const f = field || 'FIELD';
  return {
    rowset,
    fieldValue: `${row}.GetRecord(Record.${record}).GetField(Field.${f}).Value`,
    builtIns: [
      `ActiveRowCount(${path(false)})`,
      `FetchValue(${path(true)}, ${record}.${f})`,
      `UpdateValue(${path(true)}, ${record}.${f}, &value)`,
      `CurrentRowNumber(${chain.length})`
    ]
  };
}

/** Notes on a child scroll's keys against the keys above it. */
function keyNotes(level: number, primary: string, info: RecordInfo | undefined, above: readonly string[]): { parentKeys: string[]; rowKeys: string[]; notes: string[] } {
  const keys = info?.keys ?? [];
  const parentKeys = keys.filter((k) => above.includes(k)), rowKeys = keys.filter((k) => !above.includes(k));
  const notes: string[] = [];
  if (!info) notes.push(`${primary} is not a record in this database.`);
  else if (info.type === 2) notes.push(`${primary} is Derived/Work: its rows are not read from or saved to the database.`);
  else {
    const missing = above.filter((k) => !keys.includes(k));
    if (level > 0 && missing.length) notes.push(`${primary} is not keyed by ${missing.join(', ')} (keyed above it): the Component Processor selects its rows by the keys it shares with the rows above, by field name, so it ignores ${missing.join(', ')}.`);
    if (level > 0 && !rowKeys.length) notes.push(`${primary} has no key of its own beyond its parent's: at most one row per parent row.`);
  }
  return { parentKeys, rowKeys, notes };
}

/**
 * A component's buffer: its search record and keys, level 0's records, and each scroll level below with its primary
 * record's keys, records, PeopleCode and notes. Built on the Structure tab (componentStructure.ts).
 */
export function componentBuffer(structure: ComponentStructure, info: ReadonlyMap<string, RecordInfo>): {
  searchRecord?: { name: string; type: string; keys: string[] };
  level0: { records: Array<{ name: string; type: string; keys: string[]; pageFields: string[] }>; peopleCode: string; notes: string[] };
  scrolls: BufferScroll[];
  notes: string[];
} {
  const fields = (r: string) => structure.pageFields[r] ?? [];
  const search = structure.searchRecord;
  const searchKeys = search ? info.get(search.name)?.keys ?? [] : [];
  const level0Notes: string[] = [];
  for (const r of structure.level0.records) {
    const i = info.get(r.name);
    if (!i || i.type === 2 || !searchKeys.length) continue;
    const unkeyed = i.keys.filter((k) => !searchKeys.includes(k));
    if (unkeyed.length) level0Notes.push(`${r.name} has keys the search record ${search!.name} does not (${unkeyed.join(', ')}): level 0 holds one row, read by the search keys.`);
  }
  const notes: string[] = [];
  const primaries = new Map<string, number>();
  const walk = (s: StructureScroll, chain: string[], above: string[]): BufferScroll => {
    const here = [...chain, s.primary];
    const i = info.get(s.primary);
    const k = keyNotes(s.level, s.primary, i, above);
    primaries.set(s.primary, (primaries.get(s.primary) ?? 0) + 1);
    const first = fields(s.primary)[0] ?? i?.keys[0] ?? '';
    return {
      level: s.level, primary: s.primary, primaryType: recordTypeName(i?.type), keys: i?.keys ?? [], parentKeys: k.parentKeys, rowKeys: k.rowKeys,
      records: s.records.map((r) => ({ name: r.name, type: recordTypeName(r.type), pageFields: fields(r.name) })),
      peopleCode: peopleCodeAccess(here, s.primary, first), notes: k.notes,
      scrolls: s.scrolls.map((c) => walk(c, here, [...new Set([...above, ...(i?.keys ?? [])])]))
    };
  };
  const top = [...new Set([...searchKeys, ...structure.level0.records.flatMap((r) => (info.get(r.name)?.type === 2 ? [] : info.get(r.name)?.keys ?? []))])];
  const scrolls = structure.level0.scrolls.map((s) => walk(s, [], top));
  for (const [r, n] of primaries) if (n > 1) notes.push(`${r} is the primary record of ${n} scrolls: Scroll.${r} names the first; reach the others through their parent rowsets.`);
  return {
    ...(search ? { searchRecord: { name: search.name, type: recordTypeName(search.type), keys: searchKeys } } : {}),
    level0: {
      records: structure.level0.records.map((r) => ({ name: r.name, type: recordTypeName(r.type), keys: info.get(r.name)?.keys ?? [], pageFields: fields(r.name) })),
      peopleCode: 'GetLevel0()(1).GetRecord(Record.<RECORD>).<FIELD>.Value -- or GetRecord(Record.<RECORD>) in level-0 PeopleCode', notes: level0Notes
    },
    scrolls,
    notes
  };
}

/** A control of a page, for its structure. */
export interface StructureControl extends CheckedControl {
  id: number;
  typeName: string;
}

/**
 * A page's scroll structure: each control's level and scroll in tab order, the scrolls as a tree with their primary
 * records, keys and fields, App Designer's checks on it, and design notes from the keys.
 */
export function pageStructure(pnlName: string, controls: readonly StructureControl[], info: ReadonlyMap<string, RecordInfo>): {
  controls: Array<{ order: number; id: number; type: string; level: number; scroll: number | null; record?: string; field?: string; note?: string }>;
  level0: { records: string[] };
  scrolls: BufferScroll[];
  problems: PageProblem[];
} {
  const { scrolls, scrollOf, levels } = pageScrolls(controls);
  const isField = (c: StructureControl) => !!(c.recName.trim() && c.fieldName.trim());
  const recordsOf = (at: number) => {
    const out = new Map<string, string[]>();
    controls.forEach((c, i) => { if (scrollOf[i] === at && isField(c) && !(c.fieldUse & 0x10)) out.set(c.recName.trim(), [...(out.get(c.recName.trim()) ?? []), c.fieldName.trim()]); });
    return out;
  };
  const level0 = recordsOf(-1);
  const top = [...new Set([...level0.keys()].flatMap((r) => (info.get(r)?.type === 2 ? [] : info.get(r)?.keys ?? [])))];
  const build = (s: (typeof scrolls)[number], chain: string[], above: string[]): BufferScroll => {
    const recs = recordsOf(s.at);
    const primary = s.primary || [...recs.keys()][0] || controls[s.at].recName.trim();
    const i = info.get(primary);
    const here = [...chain, primary];
    const k = keyNotes(s.level, primary, i, above);
    return {
      level: s.level, primary, primaryType: recordTypeName(i?.type), keys: i?.keys ?? [], parentKeys: k.parentKeys, rowKeys: k.rowKeys,
      records: [...recs].map(([name, f]) => ({ name, type: recordTypeName(info.get(name)?.type), pageFields: f })),
      peopleCode: peopleCodeAccess(here, primary, recs.get(primary)?.[0] ?? ''), notes: k.notes,
      scrolls: scrolls.filter((c) => c.parent === s.at).map((c) => build(c, here, [...new Set([...above, ...(i?.keys ?? [])])]))
    };
  };
  const SCROLL_TYPES = new Set([10, 19, 27, 32]);
  return {
    controls: controls.map((c, i) => ({
      order: i + 1, id: c.id, type: c.typeName, level: levels[i], scroll: scrollOf[i] >= 0 ? controls[scrollOf[i]].id : null,
      ...(c.recName.trim() ? { record: c.recName.trim() } : {}), ...(c.fieldName.trim() ? { field: c.fieldName.trim() } : {}),
      ...(SCROLL_TYPES.has(c.fieldType) ? { note: `scroll at Occurs Level ${levels[i]}` } : c.fieldType === 23 && (c.fieldUse & 2) ? { note: `Set to Level ${levels[i]}` } : {})
    })),
    level0: { records: [...level0.keys()] },
    scrolls: scrolls.filter((s) => s.parent < 0).map((s) => build(s, [], top)),
    problems: checkPageScrolls(pnlName, controls)
  };
}

/**
 * How PeopleSoft pages, scrolls, components and PeopleCode fit together -- what psft_explain_scrolls returns. Each rule
 * names where it was proven.
 */
export const SCROLLS_GUIDE = `PeopleSoft scroll levels, component buffers and PeopleCode navigation

PAGES: ONE TAB ORDER, LEVELS FROM IT
- A page's controls have a tab order (PSPNLFIELD.FIELDNUM, the Order tab). Each control's scroll level (OCCURSLEVEL) follows from it: walk the controls in tab order with a running level from 0.
  - A Scroll Area, Scroll Bar, Grid or Analytic Grid keeps its own Occurs Level (set in its dialog, 1 to 3; 1 when inserted) and the running level becomes it.
  - A Horizontal Rule with Set to Level (FIELDUSE 0x2) takes the level it chose (also in PSPNLFIELDEXT.PT_NUMFLD1) and the running level becomes that: this is how a page goes back up to level 1 or 0.
  - Every other control takes the running level. Where a control sits on the page plays no part; only its place in the tab order.
  App Designer assigns every level again on each change. The rule reproduces 17354 of HRDMO's 17356 pages.
- Level 0 holds one row. A level-1 scroll holds the rows of its primary record; a scroll placed after a level-1 scroll at level 2 holds level-2 rows for each level-1 row; and so on to level 3.
- Typical build: level-0 fields; a Scroll Area or Grid (level 1) with the level-1 record's fields after it; inside it a Scroll Bar / Grid at level 2 and the level-2 record's fields; a Horizontal Rule Set to Level 1 to continue level 1 below the nested scroll; one Set to Level 0 to return to level 0.

APP DESIGNER'S CHECKS ON SAVE (Message Set 15, then "Invalid page. Do you still want to save the page?" 46,2)
- 15,19 No data for scroll: a scroll needs a record field (or a Subpage / Secondary Page) after it, before the next scroll or Set to Level rule.
- 15,22 More than one data record in scroll: a scroll's rowset is one record (its primary: its first record that is not Derived/Work). Fields of another table or view in it must be related displays (FIELDUSE 0x10). Derived/Work fields are allowed. Level 0 may hold several records.
- 15,18 Invalid field level: a scroll may be at most one level below the running level (no level-3 scroll inside a level-1 scroll).
- 15,17 Invalid related display: a related display must follow its display control field, in the same scroll.
psft_edit_page refuses a page that fails these unless saveInvalid is true (App Designer's Yes).

RECORD KEYING FOR SCROLLS
- The Component Processor reads level 0 by the search record's keys (the search keys the user entered), then each scroll's rows WHERE its record's keys that also key the rows above it (matched by field name) equal those rows' values. A child record therefore carries its parent's keys plus its own: ZZ_R_L0_A (ZZ_KEY0) -> ZZ_R_L1_A (ZZ_KEY0, ZZ_KEY1) -> ZZ_R_L2_A (ZZ_KEY0, ZZ_KEY1, ZZ_KEY2).
- Keys the child shares with its parent ("parentKeys") tie each child row to one parent row; the rest ("rowKeys") tell its rows apart. A child keyed by nothing above it is not tied to the parent row; one with no key of its own has at most one row per parent row.

COMPONENTS: THE BUFFER IS THE UNION OF THE PAGES' SCROLLS
- A component's buffer (App Designer's Structure tab) is built from its pages in order (PSPNLGROUP.SUBITEMNUM), each page's controls in tab order; a subpage or secondary page is walked in place, its levels offset by its control's level.
- Scrolls under one parent with the same primary record are one rowset, however many pages show it. The same record as primary of scrolls under different parents is different rowsets (App Designer shows both; Scroll.RECORD names the first).
- Related displays are not in the buffer. Records are listed in the order their fields first appear. Nothing about the structure is stored: it is built from the pages each time.

PEOPLECODE NAVIGATION
- Rowsets and rows are 1-based. GetLevel0() is the level-0 rowset (one row). A scroll is named by its primary record: GetRowset(Scroll.ZZ_R_L1_A).
- Object path: GetLevel0()(1).GetRowset(Scroll.ZZ_R_L1_A)(&i1).GetRowset(Scroll.ZZ_R_L2_A)(&i2).GetRecord(Record.ZZ_R_L2_A).ZZ_KEY2.Value
  In an event, GetRowset() / GetRow() / GetRecord() / GetField() with no argument are the current context; GetRowset(Scroll.CHILD) from a row is that row's child rowset.
- Built-in functions take a scroll path: the scroll names down the levels, each with its row number, the last row number dropped where the function wants a rowset: ActiveRowCount(Scroll.ZZ_R_L1_A, &i1, Scroll.ZZ_R_L2_A); FetchValue(Scroll.ZZ_R_L1_A, &i1, Scroll.ZZ_R_L2_A, &i2, ZZ_R_L2_A.ZZ_KEY2); UpdateValue(..., &value); CurrentRowNumber(level). (RECORD.X is the older spelling of Scroll.X in these paths.)
- Record field PeopleCode runs in the context of the row it fires for: a ZZ_R_L1_A.ZZ_KEY1 FieldChange runs on the current level-1 row; ZZ_R_L0_A.ZZ_KEY0 there refers to the level-0 row above it.
- Loading and refreshing a rowset: Rowset.Select / SelectAll (ScrollSelect), Rowset.Flush (ScrollFlush), InsertRow / DeleteRow (RowInsert / RowDelete).

ASKING THIS SERVER
- psft_get_page_structure: one page's controls with level and scroll, its scroll tree with primary records, keys and PeopleCode paths, and App Designer's checks.
- psft_get_component_structure: a component's search record and keys, level 0, and every scroll level with its primary record, keys (parentKeys / rowKeys), records with their page fields, PeopleCode paths and notes.
- psft_edit_page: add_scroll operations (add with kind scrollArea / scrollBar), set_occurs_level, set_level on a Horizontal Rule, set_order for the tab order; every save reassigns levels and runs the checks.`;
