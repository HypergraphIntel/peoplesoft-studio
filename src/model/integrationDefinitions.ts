/*
 * File Layouts and Component Interfaces, as the PeopleTools tables hold them
 * (HRDMO, PeopleTools 8.62; docs/FILE_LAYOUTS_COMPONENT_INTERFACES.md), and
 * their read-only text views. No PSXLATITEM labels exist for these codes;
 * each name below rests on the evidence noted.
 */

export type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();
const raw = (v: unknown) => String(v ?? '');
const num = (v: unknown) => Number(v ?? 0);
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

/** PSFLDDEFN.FLDFORMAT: 23 XML-named layouts are 2, 11 CSV-named are 1, the delimiterless are mostly 0. */
export const FILE_LAYOUT_FORMATS: Readonly<Record<number, string>> = { 0: 'FIXED', 1: 'CSV', 2: 'XML' };

/** PSFLDFIELDDEFN.FLDFIELDTYPE: PSDBFIELD.FIELDTYPE's numbers (12,864 Character fields are 0, 1,391 Number 2, 913 Date 4 ...). */
export const FILE_FIELD_TYPES: Readonly<Record<number, string>> = {
  0: 'Character', 1: 'Long Character', 2: 'Number', 3: 'Signed Number', 4: 'Date', 5: 'Time', 6: 'DateTime'
};

export interface FileLayoutView {
  layout: Row;
  segments: Row[];
  fields: Row[];
}

/** A file layout: its format and options, then its segments as a tree, each with its fields. */
export function renderFileLayout(name: string, view: FileLayoutView): string {
  const l = view.layout;
  const out: string[] = [];
  const format = num(l.FLDFORMAT);
  out.push(`File Layout ${name}${str(l.DESCR) ? ` -- ${str(l.DESCR)}` : ''}`);
  const options = [`Format: ${FILE_LAYOUT_FORMATS[format] ?? `Type ${format}`}`];
  if (format === 1 && raw(l.FLDDELIMITER).trim()) options.push(`Delimiter: ${JSON.stringify(raw(l.FLDDELIMITER).trim())}`);
  if (raw(l.FLDQUALIFIER).trim()) options.push(`Qualifier: ${JSON.stringify(raw(l.FLDQUALIFIER).trim())}`);
  if (str(l.FLDFILENAME)) options.push(`File: ${str(l.FLDFILENAME)}`);
  if (str(l.FLDSEGID)) options.push(`Segment ID: ${str(l.FLDSEGID)} at ${num(l.FLDSEGIDSTART)}, length ${num(l.FLDSEGIDLENGTH)}`);
  out.push(`  ${options.join('   ')}`);
  out.push(`  Version: ${num(l.VERSION)}   Last updated: ${stamp(l)} by ${str(l.LASTUPDOPRID)}`);
  const children = (parent: string) => view.segments.filter((s) => str(s.FLDSEGPARENT) === parent && str(s.FLDSEGNAME) !== parent)
    .sort((a, b) => num(a.FLDSEQNO) - num(b.FLDSEQNO));
  const roots = view.segments.filter((s) => !str(s.FLDSEGPARENT) || !view.segments.some((p) => str(p.FLDSEGNAME) === str(s.FLDSEGPARENT)))
    .sort((a, b) => num(a.FLDSEQNO) - num(b.FLDSEQNO));
  const segment = (s: Row, depth: number) => {
    const pad = '  '.repeat(depth + 1);
    const id = str(s.FLDSEGID) ? `   ID "${str(s.FLDSEGID)}"` : '';
    const tag = format === 2 && str(s.FLDTAG) ? `   Tag <${str(s.FLDTAG)}>` : '';
    out.push('', `${pad}Segment ${str(s.FLDSEGNAME)}${str(s.RECNAME_FILE) ? `   (record ${str(s.RECNAME_FILE)})` : ''}${id}${tag}` +
      `${str(s.DESCR100) ? ` -- ${str(s.DESCR100)}` : ''}`);
    const fields = view.fields.filter((f) => str(f.FLDSEGNAME) === str(s.FLDSEGNAME)).sort((a, b) => num(a.FLDSEQNO) - num(b.FLDSEQNO));
    for (const f of fields) {
      const type = FILE_FIELD_TYPES[num(f.FLDFIELDTYPE)] ?? `Type ${num(f.FLDFIELDTYPE)}`;
      const where = format === 0 ? `start ${num(f.FLDSTART)}, length ${num(f.FLDLENGTH)}` : `length ${num(f.FLDLENGTH)}`;
      const extra = [
        num(f.DECIMAL_POS) ? `decimals ${num(f.DECIMAL_POS)}` : '',
        format === 2 && str(f.FLDTAG) ? `tag <${str(f.FLDTAG)}>` : '',
        // FLDDATEFMT is filled on every field; it applies to date and time fields.
        [4, 5, 6].includes(num(f.FLDFIELDTYPE)) && str(f.FLDDATEFMT) ? `date format ${str(f.FLDDATEFMT)}` : '',
        raw(f.FLDFIELDDFLT).trim() ? `default ${JSON.stringify(raw(f.FLDFIELDDFLT).trim())}` : '',
        num(f.FLDSUPPRESS) ? 'suppressed' : ''
      ].filter(Boolean);
      out.push(`${pad}  ${str(f.FLDFIELDNAME).padEnd(20)} ${type.padEnd(14)} ${where}${extra.length ? `   ${extra.join(', ')}` : ''}`);
    }
    for (const c of children(str(s.FLDSEGNAME))) segment(c, depth + 1);
  };
  for (const r of roots) segment(r, 0);
  return out.join('\n') + '\n';
}

/**
 * PSBCITEM.BCTYPE. 2 is Create Keys (301 of the 303 interfaces with the Create
 * method bit have them, 5 without the bit); 5 holds the most fields of the
 * three root key sets (Find Keys); 1, in 444 of 457 interfaces, Get Keys.
 * 3 names a record and no field (a collection); 4 a record field (a property).
 */
export const CI_ITEM_TYPES: Readonly<Record<number, string>> = {
  1: 'Get Key', 2: 'Create Key', 3: 'Collection', 4: 'Property', 5: 'Find Key'
};

/** PSBCDEFN.BCSTDMETHODS bits: 2 Create (above); the others in the same alphabetical order, not yet confirmed. */
export const CI_STANDARD_METHODS: readonly [number, string][] = [[1, 'Cancel'], [2, 'Create'], [4, 'Find'], [8, 'Get'], [16, 'Save']];

export interface ComponentInterfaceView {
  ci: Row;
  items: Row[];
}

/** A component interface: its component, standard methods, keys, then its collections and properties as a tree. */
export function renderComponentInterface(name: string, view: ComponentInterfaceView): string {
  const ci = view.ci;
  const out: string[] = [];
  out.push(`Component Interface ${name}${str(ci.DESCR) ? ` -- ${str(ci.DESCR)}` : ''}`);
  out.push(`  Component: ${str(ci.BCPGNAME)}${str(ci.MARKET) ? `.${str(ci.MARKET)}` : ''}   Menu: ${str(ci.MENUNAME) || '(none)'}` +
    `   Search record: ${str(ci.SEARCHRECNAME) || '(none)'}${str(ci.ADDSRCHRECNAME) && str(ci.ADDSRCHRECNAME) !== str(ci.SEARCHRECNAME) ? `   Add search record: ${str(ci.ADDSRCHRECNAME)}` : ''}`);
  const methods = CI_STANDARD_METHODS.filter(([bit]) => (num(ci.BCSTDMETHODS) & bit) !== 0).map(([, m]) => m);
  out.push(`  Standard methods: ${methods.join(', ') || '(none)'}`);
  out.push(`  Owner ID: ${str(ci.OBJECTOWNERID) || '(none)'}   Version: ${num(ci.VERSION)}   Last updated: ${stamp(ci)} by ${str(ci.LASTUPDOPRID)}`);
  const items = [...view.items].sort((a, b) => num(a.SEQUENCE_NBR_6) - num(b.SEQUENCE_NBR_6));
  const field = (i: Row) => `${str(i.RECNAME)}.${str(i.FIELDNAME)}`;
  for (const [type, title] of [[1, 'Get Keys'], [5, 'Find Keys'], [2, 'Create Keys']] as const) {
    const keys = items.filter((i) => num(i.BCTYPE) === type);
    if (keys.length) out.push(`  ${title}: ${keys.map((k) => (str(k.BCITEMNAME) === str(k.FIELDNAME) ? field(k) : `${str(k.BCITEMNAME)} (${field(k)})`)).join(', ')}`);
  }
  const tree = (parent: string, depth: number) => {
    for (const i of items.filter((x) => str(x.BCITEMPARENT) === parent && (num(x.BCTYPE) === 3 || num(x.BCTYPE) === 4))) {
      const pad = '  '.repeat(depth + 1);
      // BCACCESS is 1 except on 2,445 properties: what 2 means is not established, so it is shown as stored.
      const readOnly = num(i.BCACCESS) !== 1 ? `  [access ${num(i.BCACCESS)}]` : '';
      if (num(i.BCTYPE) === 3) {
        out.push(`${pad}Collection ${str(i.BCITEMNAME)}   (record ${str(i.RECNAME)}, scroll ${str(i.BCSCROLLNAME) || num(i.BCSCROLLNUM)})${readOnly}`);
        tree(str(i.BCITEMNAME), depth + 1);
      } else {
        out.push(`${pad}${str(i.BCITEMNAME).padEnd(24)} ${field(i)}${readOnly}`);
      }
    }
  };
  out.push('', '  Properties');
  tree('PS_ROOT', 1);
  return out.join('\n') + '\n';
}
