/*
 * A File Layout as App Designer's File Layout window holds it, and the edits
 * that window makes (docs/FILE_LAYOUTS.md, captures fl01-fl15 on HRDMO
 * 8.62.09 in tools/corpus/save-protocol/results).
 *
 * The document keeps every stored column of PSFLDDEFN, PSFLDSEGDEFN and
 * PSFLDFIELDDEFN as App Designer wrote it (`v`), so a save changes only what
 * was edited. What App Designer derives is derived here on the way back to
 * rows: FLDSEQNO (order among siblings / within a segment, from 1),
 * PSFLDSEGDEFN.FLDFIELDCOUNT and FLDSEGCOUNT (fields and child segments),
 * PSFLDDEFN.FLDSEGCOUNT (top-level segments) -- true of all 533 layouts on
 * HRDMO.
 */

export type Value = string | number | null;
export type Values = Record<string, Value>;
export type Row = Record<string, unknown>;

export interface FileLayoutField { name: string; v: Values }
export interface FileLayoutSegment { name: string; parent: string; v: Values; fields: FileLayoutField[] }
export interface FileLayoutDocument {
  name: string;
  /** PSFLDDEFN but its key, FLDSEGCOUNT and the save stamp (VERSION, LASTUPDOPRID, LASTUPDDTTM). */
  v: Values;
  /** In tree order: each segment after its parent, siblings in their sequence. */
  segments: FileLayoutSegment[];
}

export interface FileLayoutRows { layout: Row; segments: Row[]; fields: Row[] }

export const FORMAT = { FIXED: 0, CSV: 1, XML: 2 } as const;
export const FORMAT_NAMES: Readonly<Record<number, string>> = { 0: 'FIXED', 1: 'CSV', 2: 'XML' };
/** The Field Type list: PSDBFIELD.FIELDTYPE's numbers. Long Character (1) is stored but not offered [fl06]. */
export const FIELD_TYPES: Readonly<Record<number, string>> = { 0: 'Character', 1: 'Long Character', 2: 'Number', 3: 'Signed Number', 4: 'Date', 5: 'Time', 6: 'Datetime' };
/** Segment Field Delimiter: Comma 0 [fl01], Other 4 with its character [fl04]; the others by the list's order. */
export const DELIMITER_TYPES: Readonly<Record<number, string>> = { 0: 'Comma', 1: 'Semicolon', 2: 'Tab', 3: 'Space', 4: 'Other' };
const DELIMITER_CHARS: Readonly<Record<number, string>> = { 0: ',', 1: ';', 2: '\t', 3: ' ' };

const LAYOUT_STAMP = ['FLDDEFNNAME', 'FLDSEGCOUNT', 'VERSION', 'LASTUPDOPRID', 'LASTUPDDTTM'];
const SEGMENT_DERIVED = ['FLDDEFNNAME', 'FLDSEGNAME', 'FLDSEGPARENT', 'FLDSEQNO', 'FLDSEGCOUNT', 'FLDFIELDCOUNT'];
const FIELD_DERIVED = ['FLDDEFNNAME', 'FLDSEGNAME', 'FLDFIELDNAME', 'FLDSEQNO'];

/** PSFLDDEFN of a new layout (File > New, never opened) [fl01]: FIXED, everything blank or off. */
export const NEW_LAYOUT: Readonly<Values> = {
  FLDFORMAT: 0, FLDTAG: ' ', FLDQUALIFIER: ' ', FLDQUALIFIEROPT: 0, FLDDELIMITERTYPE: 0, FLDDELIMITER: ' ', FLDIMPLYDECIMAL: 0, FLDEXCELFORMAT: 0,
  FLDCONVERTTABS: 0, FLDSTRIPSPACE: 0, FLDINTRPBACKSLASH: 0, FLDEMBQUOTEFMT: 0, FLDFILENAME: ' ', DESCR: ' ', FLDSEGID: ' ', FLDSEGIDSTART: 0,
  FLDSEGIDLENGTH: 0, FLDXMLBUFFSIZE: 0, DESCRLONG: null
};

const NEW_SEGMENT_BASE: Readonly<Values> = {
  FLDSEGID: ' ', FLDSEGIDSTART: 0, FLDSEGIDLENGTH: 0, FLDOFFSET: 0, FLDDELIMITERTYPE: 0, FLDDELIMITER: ',', DESCR100: ' ', RECNAME_FILE: ' ',
  SQLID: ' ', SQLTYPE: ' ', PTFLDSEGTERM: ' '
};

const NEW_FIELD_BASE: Readonly<Values> = {
  FLDOFFSET: 0, FLDSUPPRESS: 0, FLDDATEFMT: 'MMDDYYYY', FLDDATESEPARATOR: '/', FLDTRIMSPACES: 0, FLDIPVSEG: ' ', FLDIPVFIELD: ' ', FLDFIELDDFLT: ' ',
  DESCR100: ' ', FLDUPPER: 0, FLDSTRIPCHAR: ' ', PTFLDPADFIELD: 0
};

export class FileLayoutEditError extends Error {
  constructor(message: string) { super(message); this.name = 'FileLayoutEditError'; }
}

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0) || 0;
/** Stored text as App Designer stores it: blank is one space. */
export const text = (v: unknown): string => { const s = String(v ?? ''); return s.trim() === '' ? ' ' : s.replace(/\s+$/, ''); };
const omit = (row: Row, keys: string[]): Values =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)).map(([k, v]) => [k, v === undefined ? null : v as Value]));

// ---------------------------------------------------------------------------
// Rows <-> document

export function documentFromRows(name: string, rows: FileLayoutRows): FileLayoutDocument {
  const segs = [...rows.segments];
  const byParent = new Map<string, Row[]>();
  for (const s of segs) {
    const p = str(s.FLDSEGPARENT) === str(s.FLDSEGNAME) ? '' : str(s.FLDSEGPARENT);
    byParent.set(p, [...(byParent.get(p) ?? []), s]);
  }
  for (const list of byParent.values()) list.sort((a, b) => num(a.FLDSEQNO) - num(b.FLDSEQNO));
  const known = new Set(segs.map((s) => str(s.FLDSEGNAME)));
  const out: FileLayoutSegment[] = [];
  const visit = (parent: string) => {
    for (const s of byParent.get(parent) ?? []) {
      const name = str(s.FLDSEGNAME);
      const fields = rows.fields.filter((f) => str(f.FLDSEGNAME) === name).sort((a, b) => num(a.FLDSEQNO) - num(b.FLDSEQNO))
        .map((f) => ({ name: str(f.FLDFIELDNAME), v: omit(f, FIELD_DERIVED) }));
      out.push({ name, parent, v: omit(s, SEGMENT_DERIVED), fields });
      visit(name);
    }
  };
  visit('');
  // Orphans (a parent that is not a segment) are kept at the top level, as the read-only view shows them.
  for (const [p, list] of byParent) if (p && !known.has(p)) for (const s of list) if (!out.some((o) => o.name === str(s.FLDSEGNAME))) {
    out.push({ name: str(s.FLDSEGNAME), parent: '', v: omit(s, SEGMENT_DERIVED), fields: rows.fields.filter((f) => str(f.FLDSEGNAME) === str(s.FLDSEGNAME))
      .sort((a, b) => num(a.FLDSEQNO) - num(b.FLDSEQNO)).map((f) => ({ name: str(f.FLDFIELDNAME), v: omit(f, FIELD_DERIVED) })) });
  }
  return { name, v: omit(rows.layout, LAYOUT_STAMP), segments: out };
}

/** The rows the document stands for: PSFLDDEFN without its stamp; segments and fields with their derived columns. */
export function rowsFromDocument(doc: FileLayoutDocument): FileLayoutRows {
  const children = (p: string) => doc.segments.filter((s) => s.parent === p);
  const segments: Row[] = doc.segments.map((s) => ({
    FLDDEFNNAME: doc.name, FLDSEGNAME: s.name, FLDSEGPARENT: s.parent || ' ', FLDSEQNO: children(s.parent).indexOf(s) + 1,
    FLDSEGCOUNT: children(s.name).length, FLDFIELDCOUNT: s.fields.length, ...s.v
  }));
  const fields: Row[] = doc.segments.flatMap((s) => s.fields.map((f, i) => ({ FLDDEFNNAME: doc.name, FLDSEGNAME: s.name, FLDFIELDNAME: f.name, FLDSEQNO: i + 1, ...f.v })));
  return { layout: { FLDDEFNNAME: doc.name, FLDSEGCOUNT: children('').length, ...doc.v }, segments, fields };
}

export function newLayout(name: string): FileLayoutDocument {
  return { name, v: { ...NEW_LAYOUT }, segments: [] };
}

/** File > Save As [fl12]: every row copied under the new name. */
export function copyLayout(doc: FileLayoutDocument, name: string): FileLayoutDocument {
  return { name, v: { ...doc.v }, segments: doc.segments.map((s) => ({ ...s, v: { ...s.v }, fields: s.fields.map((f) => ({ ...f, v: { ...f.v } })) })) };
}

// ---------------------------------------------------------------------------
// Lookups

export function segment(doc: FileLayoutDocument, name: string): FileLayoutSegment {
  const s = doc.segments.find((x) => x.name === name.trim().toUpperCase());
  if (!s) throw new FileLayoutEditError(`${doc.name} has no segment ${name}.`);
  return s;
}

export function field(doc: FileLayoutDocument, seg: string, name: string): FileLayoutField {
  const s = segment(doc, seg);
  const f = s.fields.find((x) => x.name === name.trim().toUpperCase());
  if (!f) throw new FileLayoutEditError(`Segment ${s.name} has no field ${name}.`);
  return f;
}

/** The last position a FIXED segment's fields reach (start + length - 1), 0 when it has none. */
export function segmentEnd(s: FileLayoutSegment): number {
  return s.fields.reduce((m, f) => Math.max(m, num(f.v.FLDSTART) + num(f.v.FLDLENGTH) - 1), 0);
}

const NAME = /^[A-Z][A-Z0-9_#@$]*$/;
function checkName(kind: string, name: string, max: number): string {
  const n = name.trim().toUpperCase();
  if (!n || n.length > max || !NAME.test(n)) throw new FileLayoutEditError(`${n || '(blank)'} is not a ${kind} name (a letter, then letters, digits or _; at most ${max}).`);
  return n;
}

/** The subtree of a segment: it and every descendant, in tree order. */
function subtree(doc: FileLayoutDocument, name: string): FileLayoutSegment[] {
  const out: FileLayoutSegment[] = [];
  const visit = (n: string) => { const s = doc.segments.find((x) => x.name === n); if (!s) return; out.push(s); for (const c of doc.segments.filter((x) => x.parent === n)) visit(c.name); };
  visit(name);
  return out;
}

/** Puts a new segment after `after` (and its subtree) among its siblings, or last under its parent. */
function placeSegment(doc: FileLayoutDocument, s: FileLayoutSegment, after?: string): void {
  if (doc.segments.some((x) => x.name === s.name)) throw new FileLayoutEditError(`${doc.name} already has a segment ${s.name}.`);
  let at: number;
  if (after) {
    const tree = subtree(doc, after);
    at = doc.segments.indexOf(tree[tree.length - 1]) + 1;
  } else {
    const siblings = doc.segments.filter((x) => x.parent === s.parent);
    const last = siblings.length ? subtree(doc, siblings[siblings.length - 1].name) : s.parent ? [segment(doc, s.parent)] : [];
    at = last.length ? doc.segments.indexOf(last[last.length - 1]) + 1 : doc.segments.length;
  }
  doc.segments.splice(at, 0, s);
}

// ---------------------------------------------------------------------------
// Insert menu

/** A record field as Insert > Record turns it into a file field: PSRECFIELDDB order, PSDBFIELD type, length and decimals. */
export interface RecordFieldInfo { name: string; type: number; length: number; decimals: number }

/**
 * File field length from the record field [fl01, fl07; HRDMO corpus]: PSDBFIELD.LENGTH as stored (a signed
 * 10.2 number is 12), but Time and Datetime five longer (15 -> 20, 26 -> 31: 81 of 87 delivered fields).
 */
export function fileFieldLength(f: RecordFieldInfo): number {
  return f.type === 5 || f.type === 6 ? f.length + 5 : f.length;
}

/**
 * Insert > Record [fl01, fl07, fl15]: a segment named and tagged as the record, after the selected segment
 * (or last at the top level), each record field a file field at consecutive positions from 1; Max Rec Length
 * the last position; ID Seq No 0. Field qualifiers take the segment's (the layout's).
 */
export function insertRecord(doc: FileLayoutDocument, record: string, fields: RecordFieldInfo[], opts: { parent?: string; after?: string } = {}): FileLayoutSegment {
  const name = checkName('record', record, 15);
  if (!fields.length) throw new FileLayoutEditError(`Record ${name} has no fields.`);
  const qualifier = text(doc.v.FLDQUALIFIER);
  let start = 1;
  const out: FileLayoutField[] = fields.map((f) => {
    const length = fileFieldLength(f);
    const row: FileLayoutField = { name: f.name, v: { FLDSTART: start, FLDLENGTH: length, FLDFIELDTYPE: f.type, DECIMAL_POS: f.decimals, FLDTAG: f.name, ...NEW_FIELD_BASE, FLDQUALIFIER: qualifier } };
    start += length;
    return row;
  });
  const s: FileLayoutSegment = { name, parent: opts.parent ? segment(doc, opts.parent).name : '', fields: out,
    v: { ...NEW_SEGMENT_BASE, FLDTAG: name, FLDQUALIFIER: qualifier, FLDIDSEQNO: 0, FLDMAXSEGLEN: start - 1 } };
  placeSegment(doc, s, opts.after);
  return s;
}

/** Insert > Segment / ChildSegment [fl06]: no fields, Max Rec Length 0, ID Seq No 1, the layout's qualifier, Comma. */
export function insertSegment(doc: FileLayoutDocument, name: string, opts: { parent?: string; after?: string } = {}): FileLayoutSegment {
  const n = checkName('segment', name, 15);
  const s: FileLayoutSegment = { name: n, parent: opts.parent ? segment(doc, opts.parent).name : '', fields: [],
    v: { ...NEW_SEGMENT_BASE, FLDTAG: n, FLDQUALIFIER: text(doc.v.FLDQUALIFIER), FLDIDSEQNO: 1, FLDMAXSEGLEN: 0 } };
  placeSegment(doc, s, opts.after);
  return s;
}

/**
 * Insert > FileField [fl06]: Character unless given, the segment's qualifier, positioned after the segment's
 * last position (1 in an empty segment), appended last (or after `after`).
 */
export function insertField(doc: FileLayoutDocument, seg: string, name: string, props: { type?: number; length?: number; decimals?: number; after?: string } = {}): FileLayoutField {
  const s = segment(doc, seg);
  const n = checkName('field', name, 18);
  if (s.fields.some((f) => f.name === n)) throw new FileLayoutEditError(`Segment ${s.name} already has a field ${n}.`);
  const type = props.type ?? 0;
  if (!(type in FIELD_TYPES)) throw new FileLayoutEditError(`Unknown field type ${type}.`);
  const f: FileLayoutField = { name: n, v: { FLDSTART: segmentEnd(s) + 1, FLDLENGTH: props.length ?? 0, FLDFIELDTYPE: type, DECIMAL_POS: props.decimals ?? 0, FLDTAG: n,
    ...NEW_FIELD_BASE, FLDQUALIFIER: text(s.v.FLDQUALIFIER) } };
  const at = props.after ? s.fields.indexOf(field(doc, s.name, props.after)) + 1 : s.fields.length;
  s.fields.splice(at, 0, f);
  return f;
}

// ---------------------------------------------------------------------------
// Properties dialogs

export interface LayoutProperties {
  description?: string; comments?: string | null; format?: number; fileName?: string; definitionTag?: string; bufferSize?: number;
  implyDecimal?: boolean; excelFormat?: boolean; qualifierOptional?: boolean; convertTabs?: boolean; interpretBackslash?: boolean; stripWhiteSpace?: boolean;
  /** Embedded Strings Interpretation: Double Quote (false) or Backslash Quote (true). */
  backslashQuote?: boolean;
}

/**
 * File Layout Definition Properties OK [fl02, fl03, fl15]. Choosing CSV sets the definition qualifier " and
 * delimiter , ; choosing XML the delimiter , . Each check box is its own column.
 */
export function setLayoutProperties(doc: FileLayoutDocument, p: LayoutProperties): void {
  const v = doc.v;
  if (p.format !== undefined && p.format !== num(v.FLDFORMAT)) {
    if (!(p.format in FORMAT_NAMES)) throw new FileLayoutEditError(`Unknown File Layout Format ${p.format}.`);
    v.FLDFORMAT = p.format;
    if (p.format === FORMAT.CSV) { v.FLDQUALIFIER = '"'; v.FLDDELIMITER = ','; }
    if (p.format === FORMAT.XML) v.FLDDELIMITER = ',';
  }
  if (p.description !== undefined) v.DESCR = text(p.description.slice(0, 30));
  if (p.comments !== undefined) v.DESCRLONG = p.comments === null || p.comments === '' ? null : p.comments;
  if (p.fileName !== undefined) v.FLDFILENAME = text(p.fileName);
  if (p.definitionTag !== undefined) v.FLDTAG = text(p.definitionTag);
  if (p.bufferSize !== undefined) v.FLDXMLBUFFSIZE = Math.max(0, Math.trunc(p.bufferSize));
  const flag = (key: keyof LayoutProperties, col: string) => { if (p[key] !== undefined) v[col] = p[key] ? 1 : 0; };
  flag('implyDecimal', 'FLDIMPLYDECIMAL'); flag('excelFormat', 'FLDEXCELFORMAT'); flag('qualifierOptional', 'FLDQUALIFIEROPT'); flag('convertTabs', 'FLDCONVERTTABS');
  flag('interpretBackslash', 'FLDINTRPBACKSLASH'); flag('stripWhiteSpace', 'FLDSTRIPSPACE'); flag('backslashQuote', 'FLDEMBQUOTEFMT');
}

export interface SegmentProperties {
  recordId?: string; idStart?: number; idLength?: number; idSeqNo?: number; maxRecordLength?: number; qualifier?: string; terminator?: string;
  /** 0 Comma, 1 Semicolon, 2 Tab, 3 Space, 4 Other (with `delimiter`). */
  delimiterType?: number; delimiter?: string; description?: string;
  /** "Increment start positions for all fields? (116,14)" Yes: add this to every field's start. */
  shiftStarts?: number;
}

/**
 * File Layout Segment Properties OK [fl04]: the record ID with its start (1 when an ID is set) and length; the
 * default qualifier, which every field of the segment takes; the delimiter (Other stores its character);
 * ID Seq No stored 1. Max Rec Length is kept as typed (App Designer does not recompute it).
 */
export function setSegmentProperties(doc: FileLayoutDocument, seg: string, p: SegmentProperties): void {
  const s = segment(doc, seg);
  const v = s.v;
  if (p.recordId !== undefined) { v.FLDSEGID = text(p.recordId); if (str(p.recordId) && !num(v.FLDSEGIDSTART) && p.idStart === undefined) v.FLDSEGIDSTART = 1; }
  if (p.idStart !== undefined) v.FLDSEGIDSTART = p.idStart;
  if (p.idLength !== undefined) v.FLDSEGIDLENGTH = p.idLength;
  if (p.maxRecordLength !== undefined) v.FLDMAXSEGLEN = p.maxRecordLength;
  if (p.terminator !== undefined) v.PTFLDSEGTERM = text(p.terminator);
  if (p.description !== undefined) v.DESCR100 = text(p.description);
  if (p.delimiterType !== undefined) {
    if (!(p.delimiterType in DELIMITER_TYPES)) throw new FileLayoutEditError(`Unknown field delimiter ${p.delimiterType}.`);
    v.FLDDELIMITERTYPE = p.delimiterType;
    v.FLDDELIMITER = p.delimiterType === 4 ? text((p.delimiter ?? str(v.FLDDELIMITER)).slice(0, 1) || ',') : DELIMITER_CHARS[p.delimiterType];
  } else if (p.delimiter !== undefined && num(v.FLDDELIMITERTYPE) === 4) v.FLDDELIMITER = text(p.delimiter.slice(0, 1));
  v.FLDIDSEQNO = p.idSeqNo ?? (num(v.FLDIDSEQNO) || 1);
  if (p.qualifier !== undefined) {
    v.FLDQUALIFIER = text(p.qualifier.slice(0, 1));
    for (const f of s.fields) f.v.FLDQUALIFIER = v.FLDQUALIFIER;
  }
  if (p.shiftStarts) for (const f of s.fields) f.v.FLDSTART = num(f.v.FLDSTART) + p.shiftStarts;
}

export interface FieldProperties {
  name?: string; start?: number; length?: number; type?: number; decimals?: number; qualifier?: string; tag?: string;
  /** Without App Designer's terminating ~, which is added on save. */
  stripCharacters?: string; defaultValue?: string; description?: string; dateFormat?: string; dateSeparator?: string;
  trimSpaces?: boolean; upperCase?: boolean; padField?: boolean;
  /** Propagate >>> (positive) or <<< (negative): this field's start and every later field's move by it. */
  propagate?: number;
}

/**
 * File Layout Field Properties OK [fl05, fl08, fl09]: the dialog writes the strip characters back with their ~
 * terminator (blank becomes ~) and clears the date separator of a field that is not a date, time or datetime.
 * Lengths and starts move nothing else; Propagate moves this field and all after it.
 */
export function setFieldProperties(doc: FileLayoutDocument, seg: string, name: string, p: FieldProperties): FileLayoutField {
  const s = segment(doc, seg);
  const f = field(doc, s.name, name);
  const v = f.v;
  if (p.name !== undefined) {
    const n = checkName('field', p.name, 18);
    if (n !== f.name && s.fields.some((x) => x.name === n)) throw new FileLayoutEditError(`Segment ${s.name} already has a field ${n}.`);
    f.name = n;
  }
  if (p.type !== undefined) { if (!(p.type in FIELD_TYPES)) throw new FileLayoutEditError(`Unknown field type ${p.type}.`); v.FLDFIELDTYPE = p.type; }
  if (p.start !== undefined) v.FLDSTART = p.start;
  if (p.length !== undefined) v.FLDLENGTH = p.length;
  if (p.decimals !== undefined) v.DECIMAL_POS = p.decimals;
  if (p.qualifier !== undefined) v.FLDQUALIFIER = text(p.qualifier.slice(0, 1));
  if (p.tag !== undefined) v.FLDTAG = text(p.tag);
  if (p.defaultValue !== undefined) v.FLDFIELDDFLT = text(p.defaultValue);
  if (p.description !== undefined) v.DESCR100 = text(p.description);
  if (p.dateFormat !== undefined) v.FLDDATEFMT = text(p.dateFormat);
  if (p.dateSeparator !== undefined) v.FLDDATESEPARATOR = text(p.dateSeparator.slice(0, 1));
  if (p.trimSpaces !== undefined) v.FLDTRIMSPACES = p.trimSpaces ? 1 : 0;
  if (p.upperCase !== undefined) v.FLDUPPER = p.upperCase ? 1 : 0;
  if (p.padField !== undefined) v.PTFLDPADFIELD = p.padField ? 1 : 0;
  const strip = p.stripCharacters ?? stripCharacters(v.FLDSTRIPCHAR);
  v.FLDSTRIPCHAR = `${strip}~`;
  if (![4, 5, 6].includes(num(v.FLDFIELDTYPE))) v.FLDDATESEPARATOR = ' ';
  if (p.propagate) {
    const from = s.fields.indexOf(f);
    for (const x of s.fields.slice(from)) x.v.FLDSTART = num(x.v.FLDSTART) + p.propagate;
  }
  return f;
}

/** The strip characters the dialog shows: the stored text without its ~ terminator. */
export function stripCharacters(stored: unknown): string {
  const s = String(stored ?? '').trim();
  return s.endsWith('~') ? s.slice(0, -1) : s;
}

// ---------------------------------------------------------------------------
// Delete, move

/** Delete on a field (40,6) [fl10]: the field goes; the rest keep their positions, sequences close up. */
export function deleteField(doc: FileLayoutDocument, seg: string, name: string): void {
  const s = segment(doc, seg);
  s.fields.splice(s.fields.indexOf(field(doc, s.name, name)), 1);
}

/** Delete on a segment: it and its child segments, with their fields. */
export function deleteSegment(doc: FileLayoutDocument, name: string): void {
  const gone = new Set(subtree(doc, segment(doc, name).name));
  doc.segments = doc.segments.filter((s) => !gone.has(s));
}

/** The toolbar's move up / down on a field [fl11]: it swaps with its neighbour; positions stay. */
export function moveField(doc: FileLayoutDocument, seg: string, name: string, by: -1 | 1): void {
  const s = segment(doc, seg);
  const i = s.fields.indexOf(field(doc, s.name, name));
  const j = i + by;
  if (j < 0 || j >= s.fields.length) return;
  [s.fields[i], s.fields[j]] = [s.fields[j], s.fields[i]];
}

/** Move up / down on a segment: it (with its subtree) swaps with its sibling. */
export function moveSegment(doc: FileLayoutDocument, name: string, by: -1 | 1): void {
  const s = segment(doc, name);
  const siblings = doc.segments.filter((x) => x.parent === s.parent);
  const other = siblings[siblings.indexOf(s) + by];
  if (!other) return;
  const [first, second] = by < 0 ? [other, s] : [s, other];
  const a = subtree(doc, first.name), b = subtree(doc, second.name);
  const at = doc.segments.indexOf(a[0]);
  doc.segments.splice(at, a.length + b.length, ...b, ...a);
}

// ---------------------------------------------------------------------------
// Validation

export interface FileLayoutProblem { severity: 'error' | 'warning'; path: string; message: string }

export function validateFileLayout(doc: FileLayoutDocument): FileLayoutProblem[] {
  const out: FileLayoutProblem[] = [];
  if (!/^[A-Z][A-Z0-9_#@$]{0,29}$/.test(doc.name)) out.push({ severity: 'error', path: 'name', message: `${doc.name || '(blank)'} is not a File Layout name.` });
  if (!doc.segments.length) out.push({ severity: 'error', path: 'segments', message: 'A File Layout needs at least one segment.' });
  const names = new Set<string>();
  for (const s of doc.segments) {
    if (names.has(s.name)) out.push({ severity: 'error', path: s.name, message: `Segment ${s.name} appears twice.` });
    names.add(s.name);
    if (s.parent && !doc.segments.some((x) => x.name === s.parent)) out.push({ severity: 'error', path: s.name, message: `Parent segment ${s.parent} does not exist.` });
    const fields = new Set<string>();
    for (const f of s.fields) {
      if (fields.has(f.name)) out.push({ severity: 'error', path: `${s.name}.${f.name}`, message: `Field ${f.name} appears twice.` });
      fields.add(f.name);
      if (num(f.v.FLDLENGTH) <= 0 && num(f.v.FLDFIELDTYPE) !== 1) out.push({ severity: 'warning', path: `${s.name}.${f.name}`, message: 'Length is 0.' });
    }
    if (num(doc.v.FLDFORMAT) === FORMAT.FIXED) {
      const sorted = [...s.fields].sort((a, b) => num(a.v.FLDSTART) - num(b.v.FLDSTART));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        if (num(prev.v.FLDSTART) + num(prev.v.FLDLENGTH) > num(sorted[i].v.FLDSTART)) {
          out.push({ severity: 'warning', path: `${s.name}.${sorted[i].name}`, message: `Overlaps ${prev.name} (App Designer saves overlapping FIXED fields).` });
        }
      }
    }
  }
  return out;
}
