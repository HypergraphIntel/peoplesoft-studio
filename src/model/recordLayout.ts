import { CONFIRMED_USE_EDIT_BITS, FieldType, hasFlag, RecordType, UseEdit, UseEdit2 } from './record.js';

/*
 * A record as App Designer's record editor shows it: the record's own
 * PSRECFIELD rows in FIELDNUM order -- a subrecord is one row, not its
 * fields -- with each field's type, length, format and labels, and the
 * Record Type tab. Free of the `vscode` module.
 */

export interface RecordLayoutField {
  /** PSRECFIELD.FIELDNUM. */
  fieldNum: number;
  /** FIELDNAME; for a subrecord row, the subrecord's name. */
  name: string;
  isSubrecord: boolean;
  /** PSDBFIELD values; absent for a subrecord row. */
  type?: FieldType;
  length?: number;
  decimalPositions?: number;
  format?: number;
  /** The record field's label: its LABEL_ID's, else the field's default label. */
  shortName: string;
  longName: string;
  /** PSRECFIELD.USEEDIT, a bit mask of UseEdit. */
  useEdit: number;
  /** Whether the field has Record Field PeopleCode: App Designer shows its name in bold. */
  hasPeopleCode: boolean;
  editTable: string;
  /** PSRECFIELD.SETCNTRLFLD. */
  setControlField?: string;
  /** PSRECFIELD.USEEDIT2, shown as stored: none of its bits is established yet. */
  useEdit2?: number;
  /** PSRECFIELD.LABEL_ID: blank for the field's default label. */
  labelId?: string;
  /** PSRECFIELD.DEFGUICONTROL: 99 is App Designer's "System Default" (a new field's value). */
  defGuiControl?: number;
  /** The field's labels (PSDBFLDLABL), for the Record Field Label ID choice. */
  labels?: { id: string; longName: string; shortName: string; isDefault: boolean }[];
  defaultRecord: string;
  defaultField: string;
}

export interface RecordLayout {
  name: string;
  description: string;
  recordType: RecordType;
  /** PSRECDEFN.SQLTABLENAME: App Designer's Non-Standard SQL Table Name; blank for the default. */
  sqlTableName: string;
  version: number;
  fields: RecordLayoutField[];
  /** PSINDEXDEFN.INDEXID of each of the record's indexes ('_' the key index). */
  indexIds?: string[];
  /** PSRECDEFN.BUILDSEQNO: App Designer's Build Sequence No (views and query views). */
  buildSequence?: number;
  /** PSRECDEFN.AUXFLAGMASK, as stored: which bit is Materialized View or Global Temporary Table is not established. */
  auxFlagMask?: number;
  /** For a query view, the query of the same name (PSQRYDEFN). */
  queryName?: string;
  /** App Designer's Record Properties dialog, from PSRECDEFN. */
  properties?: RecordPropertiesData;
  /** PSRECTBLSPC.DDLSPACENAME: the table's tablespace. */
  tablespace?: string;
  /** View text, for SQL and dynamic views. */
  viewSql?: string;
}

/** The record types in the order of App Designer's Record Type tab. */
export const RECORD_TYPE_CHOICES: readonly { type: RecordType; label: string }[] = [
  { type: RecordType.Table, label: 'SQL Table' },
  { type: RecordType.View, label: 'SQL View' },
  { type: RecordType.DynamicView, label: 'Dynamic View' },
  { type: RecordType.DerivedWork, label: 'Derived/Work' },
  { type: RecordType.Subrecord, label: 'SubRecord' },
  { type: RecordType.QueryView, label: 'Query View' },
  { type: RecordType.TemporaryTable, label: 'Temporary Table' }
];

/** The Type column's abbreviations. */
const TYPE_ABBREVIATIONS: Readonly<Record<number, string>> = {
  [FieldType.Character]: 'Char',
  [FieldType.LongCharacter]: 'Long',
  [FieldType.Number]: 'Nbr',
  [FieldType.SignedNumber]: 'Sign',
  [FieldType.Date]: 'Date',
  [FieldType.Time]: 'Time',
  [FieldType.DateTime]: 'DtTm',
  [FieldType.Image]: 'Img',
  [FieldType.ImageReference]: 'ImgR'
};

export function typeAbbreviation(f: RecordLayoutField): string {
  if (f.isSubrecord) return 'SRec';
  return f.type === undefined ? '' : TYPE_ABBREVIATIONS[f.type] ?? String(f.type);
}

export function lengthText(f: RecordLayoutField): string {
  if (f.isSubrecord || f.length === undefined) return '';
  // App Designer shows every field's length, dates (10) and long character (0) included.
  return f.decimalPositions ? `${f.length}.${f.decimalPositions}` : String(f.length);
}

/**
 * The Format column, as App Designer's record grid abbreviates it. Read off
 * HRDMO's PSOPRDEFN: 0 on a character field is "Upper", 6 "Mixed", 7 "Raw B"
 * (VERSION, a number), 12 "Scnds" (date/times); 0 on any other type is
 * blank. 1 (Name) and 14 (Custom) are established formats whose grid
 * abbreviation has not been seen, so their names are shown; other codes as
 * stored.
 */
export function formatText(f: RecordLayoutField): string {
  if (f.isSubrecord || f.format === undefined) return '';
  if (f.format === 0) return f.type === FieldType.Character ? 'Upper' : '';
  return ({ 1: 'Name', 6: 'Mixed', 7: 'Raw B', 12: 'Scnds', 14: 'Custom' } as Record<number, string>)[f.format] ?? String(f.format);
}

/**
 * App Designer's Use display, from the confirmed USEEDIT bits only: Key
 * ("Key", or "Alt" for an alternate search key), Ordr (the key's position
 * among the record's keys), Dir ("Asc" / "Desc" for keys and alternate
 * keys), List ("Yes" / "No"; blank for a subrecord). Default as App
 * Designer writes it: a constant quoted, a %-variable as is, a
 * record.field default as REC.FIELD.
 */
export interface UseRow { key: string; order: string; dir: string; list: string; defaultValue: string }

export function useRows(fields: readonly RecordLayoutField[]): UseRow[] {
  let keyOrder = 0;
  return fields.map((f) => {
    if (f.isSubrecord) return { key: '', order: '', dir: '', list: '', defaultValue: '' };
    const key = hasFlag(f.useEdit, UseEdit.Key);
    const dup = hasFlag(f.useEdit, UseEdit.DuplicateOrderKey);
    const alt = hasFlag(f.useEdit, UseEdit.AltSearchKey);
    return {
      // A duplicate order key is a key of the key index (case r08): it has an order and a direction.
      key: key ? 'Key' : dup ? 'Dup' : alt ? 'Alt' : '',
      order: key || dup ? String(++keyOrder) : '',
      dir: key || dup || alt ? (hasFlag(f.useEdit, UseEdit.DescendingKey) ? 'Desc' : 'Asc') : '',
      list: hasFlag(f.useEdit, UseEdit.ListBoxItem) ? 'Yes' : 'No',
      defaultValue: defaultText(f)
    };
  });
}

export function defaultText(f: RecordLayoutField): string {
  if (f.defaultRecord) return `${f.defaultRecord}.${f.defaultField}`;
  if (!f.defaultField) return '';
  return f.defaultField.startsWith('%') ? f.defaultField : `'${f.defaultField}'`;
}

/**
 * App Designer's Edits display, from confirmed bits only: Req (Yes/No),
 * Edit ("Prompt" with the table in EDITTABLE, or "Xlat"), Prompt Table,
 * Set Control Field, Event (Yes when the field has Record Field PeopleCode).
 */
export interface EditsRow { required: string; edit: string; promptTable: string; setControlField: string; event: string }

export function editsRows(fields: readonly RecordLayoutField[]): EditsRow[] {
  return fields.map((f) => {
    if (f.isSubrecord) return { required: '', edit: '', promptTable: '', setControlField: '', event: '' };
    const prompt = hasFlag(f.useEdit, UseEdit.PromptTable);
    return {
      required: hasFlag(f.useEdit, UseEdit.Required) ? 'Yes' : 'No',
      edit: prompt ? 'Prompt' : hasFlag(f.useEdit, UseEdit.TranslateTable) ? 'Xlat'
        : hasFlag(f.useEdit, UseEdit.YesNoTable) ? 'Y/N' : f.editTable ? 'Prompt (no edit)' : '',
      promptTable: f.editTable,
      setControlField: f.setControlField ?? '',
      event: f.hasPeopleCode ? 'Yes' : 'No'
    };
  });
}

/** A translate value, as App Designer's View Translates lists it (PSXLATITEM). */
export interface TranslateValue {
  value: string;
  effectiveDate: string;
  status: string;
  longName: string;
  shortName: string;
}

/**
 * App Designer's Record Field Properties dialog for one field. A check is
 * true / false only where its USEEDIT bit is confirmed (model/record.ts);
 * the dialog's other checks are 'unknown', and the stored bits nothing here
 * explains are given as is, so a setting is never shown cleared when it may
 * be set.
 */
export type CheckState = boolean | 'unknown';

/** The UseChange setting a check edits (model/recordEdit.ts). */
export type UseFlagName = 'key' | 'dupOrder' | 'descending' | 'searchKey' | 'searchEdit' | 'listBox' | 'fromSearch' |
  'throughSearch' | 'defaultSearch' | 'disableAdvancedSearch' | 'allowSearchEvents' | 'auditAdd' | 'auditChange' |
  'auditDelete' | 'systemMaintained' | 'doNotTrace' | 'smartPrompt' | 'smartDropDown';

export interface PropertyCheck { label: string; state: CheckState; flag?: UseFlagName }

export interface RecordFieldPropertiesView {
  name: string;
  keys: PropertyCheck[];
  audit: PropertyCheck[];
  other: PropertyCheck[];
  label: string;
  /** LABEL_ID ('' for the default label) and the labels to choose from. */
  labelId: string;
  labels: { id: string; text: string }[];
  defaultConstant: string;
  defaultRecord: string;
  defaultField: string;
  pageControl: string;
  pageControlValue?: number;
  required: boolean;
  /** App Designer's table edit type. */
  edit: 'No Edit' | 'Prompt Table Edit' | 'Prompt Table with No Edit' | 'Yes/No Table Edit' | 'Translate Table Edit';
  promptTable: string;
  setControlField: string;
  /** USEEDIT bits no check here accounts for (beyond the 0x800000 App Designer sets on new fields), and USEEDIT2. */
  unexplained: { useEdit: number; useEdit2: number };
}

const CONFIRMED_BITS = CONFIRMED_USE_EDIT_BITS;

export function recordFieldProperties(f: RecordLayoutField): RecordFieldPropertiesView {
  const on = (bit: UseEdit) => hasFlag(f.useEdit, bit);
  const unknown = (label: string) => ({ label, state: 'unknown' as const });
  const constant = !f.defaultRecord;
  return {
    name: f.name,
    keys: [
      { label: 'Key', state: on(UseEdit.Key), flag: 'key' },
      { label: 'Duplicate Order Key', state: on(UseEdit.DuplicateOrderKey), flag: 'dupOrder' },
      { label: 'Alternate Search Key', state: on(UseEdit.AltSearchKey) },
      { label: 'Descending Key', state: on(UseEdit.DescendingKey), flag: 'descending' },
      { label: 'Search Key', state: on(UseEdit.SearchKey), flag: 'searchKey' },
      { label: 'Search Edit', state: on(UseEdit.SearchEdit), flag: 'searchEdit' },
      { label: 'List Box Item', state: on(UseEdit.ListBoxItem), flag: 'listBox' },
      { label: 'From Search Field', state: on(UseEdit.FromSearchField), flag: 'fromSearch' },
      { label: 'Through Search Field', state: on(UseEdit.ThroughSearchField), flag: 'throughSearch' },
      { label: 'Default Search Field', state: on(UseEdit.DefaultSearchField), flag: 'defaultSearch' },
      { label: 'Disable Advanced Search Options', state: on(UseEdit.DisableAdvancedSearchOptions), flag: 'disableAdvancedSearch' },
      { label: 'Allow Search Events for Prompt Dialogs', state: on(UseEdit.AllowSearchEventsForPromptDialogs), flag: 'allowSearchEvents' }
    ],
    audit: [
      { label: 'Field Add', state: on(UseEdit.AuditFieldAdd), flag: 'auditAdd' },
      { label: 'Field Change', state: on(UseEdit.AuditFieldChange), flag: 'auditChange' },
      { label: 'Field Delete', state: on(UseEdit.AuditFieldDelete), flag: 'auditDelete' }
    ],
    other: [{ label: 'System Maintained', state: on(UseEdit.SystemMaintained), flag: 'systemMaintained' },
      { label: 'Auto-Update', state: on(UseEdit.AutoUpdate) },
      { label: 'Do Not Trace Value', state: hasFlag(f.useEdit2 ?? 0, UseEdit2.DoNotTraceValue), flag: 'doNotTrace' },
      unknown('In Memory'),
      { label: 'Smart Drop-Down', state: hasFlag(f.useEdit2 ?? 0, UseEdit2.SmartDropDown), flag: 'smartDropDown' },
      { label: 'Smart Prompt', state: hasFlag(f.useEdit2 ?? 0, UseEdit2.SmartPrompt), flag: 'smartPrompt' }],
    label: f.labelId ? f.labelId : '*** Use Default Label ***',
    labelId: f.labelId ?? '',
    labels: (f.labels ?? []).map((l) => ({ id: l.id, text: `${l.id} (${l.longName})` })),
    defaultConstant: constant ? f.defaultField : '',
    defaultRecord: constant ? '' : f.defaultRecord,
    defaultField: constant ? '' : f.defaultField,
    pageControl: f.defGuiControl === undefined ? '' : f.defGuiControl === 99 ? 'System Default' : `${f.defGuiControl} (stored value)`,
    ...(f.defGuiControl !== undefined ? { pageControlValue: f.defGuiControl } : {}),
    required: on(UseEdit.Required),
    edit: on(UseEdit.PromptTable) ? 'Prompt Table Edit' : on(UseEdit.TranslateTable) ? 'Translate Table Edit'
      : on(UseEdit.YesNoTable) ? 'Yes/No Table Edit' : f.editTable ? 'Prompt Table with No Edit' : 'No Edit',
    promptTable: f.editTable,
    setControlField: f.setControlField ?? '',
    unexplained: {
      useEdit: f.useEdit & ~CONFIRMED_BITS,
      useEdit2: (f.useEdit2 ?? 0) & ~(UseEdit2.DoNotTraceValue | UseEdit2.SmartPrompt | UseEdit2.SmartDropDown)
    }
  };
}

/**
 * App Designer's Record Properties dialog, from PSRECDEFN. Column-backed
 * values are shown as stored; the dialog's checkboxes are not established
 * yet (they are expected in AUXFLAGMASK), so the page shows them "–" with
 * the stored mask.
 */
export interface RecordPropertiesData {
  description: string;
  /** DESCRLONG: the dialog's Record Definition text. */
  definition: string;
  ownerId: string;
  lastUpdated: string;
  lastUpdatedBy: string;
  setControlField: string;
  parentRecord: string;
  relatedLanguageRecord: string;
  querySecurityRecord: string;
  /** OPTDELRECNAME, shown as Analytic Delete Record (by column; not yet confirmed by a case). */
  analyticDeleteRecord: string;
  auditRecord: string;
  systemIdField: string;
  timestampField: string;
  auxFlagMask: number;
  /** RECUSE: the audit options (RecordAuditOption bits). */
  recUse: number;
  /** OPTTRIGFLAG, as stored: what App Designer shows it as is not established. */
  optTrigFlag: string;
}
