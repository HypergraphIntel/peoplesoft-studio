import { DefinitionKey, DefinitionType, displayName, typeLabel } from './definitions.js';
import { FIELD_TYPE_LABELS, FieldType, RecordType } from './record.js';

/*
 * Definition Properties, as App Designer's Properties dialog shows them: a
 * General section every definition has (description, comments, owner ID,
 * last update, version), a section particular to the definition's type, and
 * -- so nothing is hidden -- every column stored in its definition row.
 *
 * Read-only. Values are shown as stored; a code is given a name only where
 * this repository already defines one (RecordType, FieldType). Free of the
 * `vscode` module; OracleProvider reads the rows, this module labels them.
 */

export interface PropertyItem {
  label: string;
  /** Empty when the stored value is blank. */
  value: string;
  /** Long text (comments) shown as a block, line breaks kept. */
  multiline?: boolean;
}

export interface PropertySection {
  title: string;
  items: PropertyItem[];
}

export interface DefinitionProperties {
  name: string;
  typeLabel: string;
  sections: PropertySection[];
  /** Every column of each definition row read, by table, in column order. */
  stored: { table: string; columns: PropertyItem[] }[];
}

/** One stored row, column name -> value as the driver returned it. */
export type StoredRow = Record<string, unknown>;

interface FieldSpec {
  column: string;
  label: string;
  format?: (value: unknown) => string;
}

export interface PropertiesSpec {
  /** The definition type, singular: "Record". */
  kind: string;
  table: string;
  /** WHERE-clause columns and their values for the definition. */
  where(key: DefinitionKey): Record<string, string | number>;
  /** Where a key matches several rows, which comes first (HTML: alternate content). */
  orderBy?: string;
  /** The column holding the short description; absent when the table has none (SQL: PSSQLDESCR). */
  description?: string;
  title: string;
  fields: FieldSpec[];
}

// ---------------------------------------------------------------------------
// Formatting

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function formatValue(value: unknown): string {
  if (blank(value)) return '';
  if (value instanceof Date) {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
      `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  if (Buffer.isBuffer(value)) return `(${value.length} bytes)`;
  return String(value).replace(/\s+$/, '');
}

/** A code with its name where one is known: "0 — SQL Table". */
const named = (names: Readonly<Record<number, string>>) => (value: unknown): string => {
  if (blank(value)) return '';
  const n = Number(value);
  return names[n] !== undefined ? `${names[n]} (${n})` : String(value);
};

/** PSSTYLSHEETDEFN.STYLESHEETTYPE: the 510 type 2 are exactly the freeform (PSCONTDEFN CONTTYPE 9) ones. */
const STYLE_SHEET_TYPE_NAMES: Readonly<Record<number, string>> = { 0: 'Style Sheet', 1: 'Sub Style Sheet', 2: 'Freeform Style Sheet' };

const RECORD_TYPE_NAMES: Readonly<Record<number, string>> = {
  [RecordType.Table]: 'SQL Table',
  [RecordType.View]: 'SQL View',
  [RecordType.DerivedWork]: 'Derived/Work',
  [RecordType.Subrecord]: 'SubRecord',
  [RecordType.DynamicView]: 'Dynamic View',
  [RecordType.QueryView]: 'Query View',
  [RecordType.TemporaryTable]: 'Temporary Table'
};

const FIELD_TYPE_NAMES: Readonly<Record<number, string>> = FIELD_TYPE_LABELS as Readonly<Record<FieldType, string>>;

// ---------------------------------------------------------------------------
// Specs, per definition type

/** The types that have a Properties panel. */
export const PROPERTIES_SPECS: Readonly<Partial<Record<DefinitionType, PropertiesSpec>>> = {
  [DefinitionType.ApplicationPackage]: {
    kind: 'Application Package',
    table: 'PSPACKAGEDEFN',
    // Searched, a package is keyed by its root (PACKAGELEVEL 0); as a project
    // item, by PACKAGEID, PACKAGEROOT and QUALIFYPATH ('.' root, ':' first level).
    where: (key): Record<string, string | number> => key.parts.length >= 3
      ? { PACKAGEID: key.parts[0], PACKAGEROOT: key.parts[1], QUALIFYPATH: key.parts[2] }
      : { PACKAGEROOT: key.parts[0], PACKAGELEVEL: 0 },
    description: 'DESCR',
    title: 'Application Package',
    fields: [
      { column: 'PACKAGEID', label: 'Package' },
      { column: 'PACKAGEROOT', label: 'Package Root' },
      { column: 'QUALIFYPATH', label: 'Qualify Path' },
      { column: 'PACKAGELEVEL', label: 'Package Level' },
      { column: 'PACKAGEREF', label: 'Package Reference' }
    ]
  },
  [DefinitionType.Record]: {
    kind: 'Record',
    table: 'PSRECDEFN',
    where: (key) => ({ RECNAME: key.parts[0] }),
    description: 'RECDESCR',
    title: 'Record Type and Use',
    fields: [
      { column: 'RECTYPE', label: 'Record Type', format: named(RECORD_TYPE_NAMES) },
      { column: 'SQLTABLENAME', label: 'SQL Table Name' },
      { column: 'PARENTRECNAME', label: 'Parent Record' },
      { column: 'RELLANGRECNAME', label: 'Related Language Record' },
      { column: 'AUDITRECNAME', label: 'Record Name for Auditing' },
      { column: 'QRYSECRECNAME', label: 'Query Security Record' },
      { column: 'OPTDELRECNAME', label: 'Optimization Delete Record' },
      { column: 'SETCNTRLFLD', label: 'Set Control Field' },
      { column: 'SYSTEMIDFIELDNAME', label: 'System ID Field' },
      { column: 'TIMESTAMPFIELDNAME', label: 'Timestamp Field' },
      { column: 'FIELDCOUNT', label: 'Field Count' },
      { column: 'INDEXCOUNT', label: 'Index Count' },
      { column: 'BUILDSEQNO', label: 'Build Sequence' },
      { column: 'RECUSE', label: 'Record Use (stored value)' }
    ]
  },
  [DefinitionType.Field]: {
    kind: 'Field',
    table: 'PSDBFIELD',
    // A field listed under a record carries the record as a second part; the field is the first.
    where: (key) => ({ FIELDNAME: key.parts[0] }),
    title: 'Field Type and Format',
    fields: [
      { column: 'FIELDTYPE', label: 'Field Type', format: named(FIELD_TYPE_NAMES) },
      { column: 'LENGTH', label: 'Length' },
      { column: 'DECIMALPOS', label: 'Decimal Positions' },
      { column: 'FORMAT', label: 'Format (stored value)' },
      { column: 'FORMATFAMILY', label: 'Format Family' },
      { column: 'DISPFMTNAME', label: 'Display Format' },
      { column: 'DEFCNTRYYR', label: 'Default Century Year' }
    ]
  },
  [DefinitionType.Component]: {
    kind: 'Component',
    table: 'PSPNLGRPDEFN',
    where: (key) => ({ PNLGRPNAME: key.parts[0], MARKET: key.parts[1] || 'GBL' }),
    description: 'DESCR',
    title: 'Component Use',
    fields: [
      { column: 'MARKET', label: 'Market' },
      { column: 'SEARCHRECNAME', label: 'Search Record' },
      { column: 'ADDSRCHRECNAME', label: 'Add Search Record' },
      { column: 'SEARCHPNLNAME', label: 'Search Page' },
      { column: 'ACTIONS', label: 'Actions (stored value)' },
      { column: 'PRIMARYACTION', label: 'Primary Action (stored value)' },
      { column: 'DFLTACTION', label: 'Default Action (stored value)' },
      { column: 'DISABLESAVE', label: 'Disable Saving Page (stored value)' },
      { column: 'FLUIDMODE', label: 'Fluid Mode (stored value)' },
      { column: 'PNLGRPUSE', label: 'Component Use (stored value)' }
    ]
  },
  [DefinitionType.Page]: {
    kind: 'Page',
    table: 'PSPNLDEFN',
    where: (key) => ({ PNLNAME: key.parts[0] }),
    description: 'DESCR',
    title: 'Page Use',
    fields: [
      { column: 'PNLTYPE', label: 'Page Type (stored value)' },
      { column: 'PNLSTYLE', label: 'Page Style' },
      { column: 'STYLESHEETNAME', label: 'Style Sheet' },
      { column: 'FFSTYLESHEETNAME', label: 'Fluid Style Sheet' },
      { column: 'POPUPMENU', label: 'Pop-up Menu' },
      { column: 'HELPCONTEXTNUM', label: 'Help Context Number' },
      { column: 'FIELDCOUNT', label: 'Field Count' },
      { column: 'PNLUSE', label: 'Page Use (stored value)' }
    ]
  },
  [DefinitionType.Project]: {
    kind: 'Project',
    table: 'PSPROJECTDEFN',
    where: (key) => ({ PROJECTNAME: key.parts[0] }),
    description: 'PROJECTDESCR',
    title: 'Project',
    fields: [
      { column: 'TGTSERVERNAME', label: 'Target Server' },
      { column: 'TGTDBNAME', label: 'Target Database' },
      { column: 'TGTOPRID', label: 'Target Operator' },
      { column: 'COMPRELEASE', label: 'Compare Release' },
      { column: 'RELEASELABEL', label: 'Release Label' },
      { column: 'RELEASEDTTM', label: 'Release Date/Time' },
      { column: 'MAINTPROJ', label: 'Maintenance Project (stored value)' }
    ]
  },
  [DefinitionType.Menu]: {
    kind: 'Menu',
    table: 'PSMENUDEFN',
    where: (key) => ({ MENUNAME: key.parts[0] }),
    description: 'DESCR',
    title: 'Menu Use',
    fields: [
      { column: 'MENULABEL', label: 'Menu Label' },
      { column: 'MENUGROUP', label: 'Menu Group' },
      { column: 'MENUTYPE', label: 'Menu Type (stored value)' },
      { column: 'GROUPORDER', label: 'Group Order' },
      { column: 'MENUORDER', label: 'Menu Order' },
      { column: 'INSTALLED', label: 'Installed (stored value)' }
    ]
  },
  [DefinitionType.AppEngineProgram]: {
    kind: 'App Engine Program',
    table: 'PSAEAPPLDEFN',
    where: (key) => ({ AE_APPLID: key.parts[0] }),
    description: 'DESCR',
    title: 'Program Properties',
    fields: [
      { column: 'AEPROGTYPE', label: 'Program Type (stored value)' },
      { column: 'AE_DISABLE_RESTART', label: 'Disable Restart' },
      { column: 'AE_APPLLIBRARY', label: 'Application Library' },
      { column: 'MESSAGE_SET_NBR', label: 'Message Set' },
      { column: 'TEMPTBLINSTANCES', label: 'Temporary Table Instances' },
      { column: 'ASOF_DT', label: 'As Of Date' },
      { column: 'AE_DATE_OVERRIDE', label: 'Date Override' }
    ]
  },
  [DefinitionType.SqlDefinition]: {
    kind: 'SQL Definition',
    table: 'PSSQLDEFN',
    where: (key) => ({ SQLID: key.parts[0], SQLTYPE: '0' }),
    // The description and comments live in PSSQLDESCR.
    title: 'SQL Definition',
    fields: [
      { column: 'SQLTYPE', label: 'SQL Type (stored value)' },
      { column: 'ENABLEEFFDT', label: 'Effective-Dated' }
    ]
  },
  [DefinitionType.HtmlDefinition]: {
    kind: 'HTML Definition',
    table: 'PSCONTDEFN',
    where: (key) => ({ CONTNAME: key.parts[0], ...(key.parts[1] ? { CONTTYPE: Number(key.parts[1]) } : {}) }),
    orderBy: 'ALTCONTNUM',
    description: 'DESCR',
    title: 'HTML Definition',
    fields: [
      { column: 'CONTTYPE', label: 'Content Type (stored value)' },
      { column: 'CONTFMT', label: 'Content Format' },
      { column: 'CONTSTYLE', label: 'Content Style (stored value)' },
      { column: 'URL', label: 'URL' },
      { column: 'ALTCONTNUM', label: 'Alternate Content Number' },
      { column: 'COMPALG', label: 'Compression (stored value)' }
    ]
  },
  [DefinitionType.StyleSheet]: {
    kind: 'Style Sheet',
    table: 'PSSTYLSHEETDEFN',
    where: (key) => ({ STYLESHEETNAME: key.parts[0] }),
    description: 'DESCR',
    title: 'Style Sheet',
    fields: [
      { column: 'STYLESHEETTYPE', label: 'Style Sheet Type', format: named(STYLE_SHEET_TYPE_NAMES) },
      { column: 'PARENTSTYLENAME', label: 'Parent Style Sheet' },
      { column: 'NUMSTYLECLASS', label: 'Style Classes' }
    ]
  }
};

export function hasProperties(type: DefinitionType): boolean {
  return PROPERTIES_SPECS[type] !== undefined;
}

// ---------------------------------------------------------------------------
// Building

export interface PropertiesInput {
  key: DefinitionKey;
  /** The definition row, columns in table order. */
  row: StoredRow;
  /** Where description and comments are kept apart (PSSQLDESCR), that row. */
  descriptionRow?: StoredRow;
  /** Field labels (PSDBFLDLABL) for a field. */
  labels?: StoredRow[];
}

/**
 * A package's full path from its row: QUALIFYPATH is '.' for a root, ':' for
 * a first-level package, and the intermediate path beyond that.
 */
function packagePath(row: StoredRow): string {
  const root = formatValue(row.PACKAGEROOT);
  const id = formatValue(row.PACKAGEID);
  const path = formatValue(row.QUALIFYPATH);
  if (path === '.' || id === root && path === '') return root;
  return [root, ...(path === ':' ? [] : path.split(':')), id].join(':');
}

/** The Properties panel's content for one definition. */
export function buildProperties(input: PropertiesInput): DefinitionProperties {
  const spec = PROPERTIES_SPECS[input.key.type];
  if (!spec) throw new Error(`${typeLabel(input.key.type)} has no Properties panel.`);
  const { row } = input;
  const descriptionSource = input.descriptionRow ?? row;
  // A field has no description column; App Designer shows its default label.
  const defaultLabel = input.labels?.find((l) => Number(l.DEFAULT_LABEL) === 1);
  const description = spec.description || input.descriptionRow
    ? descriptionSource[spec.description ?? 'DESCR']
    : defaultLabel?.LONGNAME;

  const general: PropertyItem[] = [
    { label: 'Description', value: formatValue(description) },
    { label: 'Comments', value: formatValue(descriptionSource.DESCRLONG), multiline: true },
    { label: 'Owner ID', value: formatValue(row.OBJECTOWNERID) },
    { label: 'Last Updated', value: formatValue(row.LASTUPDDTTM) },
    { label: 'Last Updated By', value: formatValue(row.LASTUPDOPRID) },
    { label: 'Version', value: formatValue(row.VERSION) }
  ];

  const specific: PropertyItem[] = spec.fields
    .filter((f) => f.column in row)
    .map((f) => ({ label: f.label, value: (f.format ?? formatValue)(row[f.column]) }));

  const sections: PropertySection[] = [
    { title: 'General', items: general },
    { title: spec.title, items: specific }
  ];
  if (input.labels && input.labels.length > 0) {
    sections.push({
      title: 'Labels',
      items: input.labels.map((l) => ({
        label: `${formatValue(l.LABEL_ID)}${Number(l.DEFAULT_LABEL) === 1 ? ' (default)' : ''}`,
        value: `${formatValue(l.LONGNAME)}${blank(l.SHORTNAME) ? '' : ` · short: ${formatValue(l.SHORTNAME)}`}`
      }))
    });
  }

  const storedOf = (table: string, r: StoredRow) => ({
    table,
    columns: Object.keys(r).map((column) => ({ label: column, value: formatValue(r[column]), ...(column === 'DESCRLONG' ? { multiline: true } : {}) }))
  });
  return {
    name: input.key.type === DefinitionType.ApplicationPackage ? packagePath(row) : displayName(input.key),
    typeLabel: spec.kind,
    sections,
    stored: [storedOf(spec.table, row), ...(input.descriptionRow ? [storedOf('PSSQLDESCR', input.descriptionRow)] : [])]
  };
}
