import { hasFlag, NEW_FIELD_USE_EDIT, RecordFlag, RecordType, UseEdit, UseEdit2 } from './record.js';
import { SETTABLE_PAGE_CONTROLS } from './recordLayout.js';

/*
 * Editing a record definition and planning its save, as App Designer saves
 * one (docs/RECORD_SAVE.md, cases r01-r07). Free of the `vscode` module and
 * of the database: recordWriter.ts reads the stored rows and moves the
 * planned ones.
 *
 * What a save writes, from the cases:
 *
 *   PSRECFIELD /    every row of the record deleted and reinserted in the
 *   PSRECFIELDDB    new order (FIELDNUM); a row whose values did not change
 *                   keeps its LASTUPDDTTM / LASTUPDOPRID (r01, r07), a
 *                   changed or new row takes the save's (r02, r04, r05);
 *                   a new field's USEEDIT carries 0x800000 (r02, r03);
 *                   PSRECFIELDDB is the same rows with RECNAME_PARENT
 *   PSINDEXDEFN /   an SQL Table's key index `_` rewritten every save:
 *   PSKEYDEFN       KEYCOUNT = its keys, one key row per key in field
 *                   order, ASCDESC 1 ascending / 0 descending (r03, r05);
 *                   a Derived/Work record has no index (1,231 delivered
 *                   Derived/Work records with keys, none with one)
 *   PSRECDEFN       FIELDCOUNT, INDEXCOUNT, VERSION = the new RDM, stamp
 *   PSVERSION       RDM + 1, SYS + 1, and PGM + 1 when a field is
 *                   removed (r03, r06, r07; not for r01, r02, r04, r05)
 *   PSLOCK          RDM + 1 (and PGM + 1 with it)
 *
 * Only the changes those cases cover are offered: reorder, insert, delete,
 * and the Key, Descending and List Box Item flags.
 */

export class RecordSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordSaveRefusedError';
  }
}

/**
 * The USEEDIT bits an edit may change: those the save cases exercised
 * (r03-r05, r08, r09, r11-r16). Not the translate edit: no case has set or
 * cleared it.
 */
export const EDITABLE_USE_BITS = UseEdit.Key | UseEdit.DuplicateOrderKey | UseEdit.DescendingKey | UseEdit.SearchKey |
  UseEdit.SearchEdit | UseEdit.ListBoxItem | UseEdit.FromSearchField | UseEdit.ThroughSearchField |
  UseEdit.DefaultSearchField | UseEdit.DisableAdvancedSearchOptions | UseEdit.AllowSearchEventsForPromptDialogs |
  UseEdit.AuditFieldAdd | UseEdit.AuditFieldChange | UseEdit.AuditFieldDelete | UseEdit.SystemMaintained |
  UseEdit.Required | UseEdit.PromptTable | UseEdit.YesNoTable | UseEdit.TranslateTable | UseEdit.UseDefaultLabel | UseEdit.AutoUpdate |
  UseEdit.AltSearchKey;

/** The USEEDIT2 bits an edit may change (r10, r15, r16). */
export const EDITABLE_USE2_BITS: number = UseEdit2.DoNotTraceValue | UseEdit2.SmartPrompt | UseEdit2.SmartDropDown;

/**
 * DEFGUICONTROL values that may be set: App Designer stored 99 (new fields)
 * and 5 (case r15) itself, and 4, 7 and 8 are its named controls on
 * delivered fields (PAGE_CONTROL_NAMES).
 */
export const KNOWN_PAGE_CONTROLS: readonly number[] = SETTABLE_PAGE_CONTROLS;

export interface RecordEditField {
  name: string;
  useEdit: number;
  /** PSRECFIELD.USEEDIT2; 0 when absent. */
  useEdit2?: number;
  /**
   * Column settings (r15), trimmed; absent means "as stored". EDITTABLE (the
   * prompt table), DEFRECNAME / DEFFIELDNAME (the default: a constant has no
   * record), LABEL_ID (blank: the default label), DEFGUICONTROL.
   */
  editTable?: string;
  defaultRecord?: string;
  defaultField?: string;
  labelId?: string;
  pageControl?: number;
  /** True for a field inserted in this edit. */
  isNew: boolean;
  /** A subrecord row (PSRECFIELD.SUBRECORD 'Y'): name is the subrecord's. */
  isSubrecord?: boolean;
}

export interface RecordEditState {
  recname: string;
  recordType: RecordType;
  /** PSRECDEFN.VERSION when the edit began: a save is refused if it moved. */
  openedVersion: number;
  fields: RecordEditField[];
  /** Record Properties changed in this edit (absent: as stored). */
  properties?: RecordPropertyEdits;
  /** A record not saved yet: its first save creates it (openedVersion is 0). */
  isNew?: boolean;
  /** Record Type tab changes (setRecordType). */
  type?: RecordTypeEdits;
}

/**
 * The Record Type tab's changes, as App Designer saved them (r26-r28):
 * the record type, the Non-Standard SQL Table Name (SQLTABLENAME), the
 * Build Sequence No (BUILDSEQNO) and a view's SQL (PSSQLDEFN SQLTYPE 2).
 */
export interface RecordTypeEdits {
  recordType?: RecordType;
  sqlTableName?: string;
  buildSequence?: number;
  viewSql?: string;
}

/**
 * The record type changes App Designer has been seen to save: Derived/Work
 * to SQL Table (r26), SQL Table to SQL View (r28), Derived/Work to SQL View
 * (r28 without the tablespace row a Derived/Work record does not have), and
 * SQL Table to Derived/Work (r46).
 */
export const RECORD_TYPE_CHANGES: ReadonlyArray<readonly [RecordType, RecordType]> = [
  [RecordType.DerivedWork, RecordType.Table], [RecordType.Table, RecordType.View], [RecordType.DerivedWork, RecordType.View],
  // r46: SQLTABLENAME cleared, the tablespace row deleted (and the key index, which no Derived/Work record has).
  [RecordType.Table, RecordType.DerivedWork],
  // r57: the key index and tablespace row created, the view's SQL rows deleted (SRM + 1).
  [RecordType.View, RecordType.Table]
];

const isViewType = (t: RecordType) => t === RecordType.View || t === RecordType.DynamicView;

/** Changes the Record Type tab, refusing what App Designer has not been seen to save. */
export function setRecordType(state: RecordEditState, stored: RecordType, change: RecordTypeEdits): RecordEditState {
  const next: RecordTypeEdits = { ...state.type };
  if (change.recordType !== undefined) {
    if (change.recordType === stored) delete next.recordType;
    else if (!RECORD_TYPE_CHANGES.some(([from, to]) => from === stored && to === change.recordType)) {
      throw new RecordSaveRefusedError('That record type change has not been observed in App Designer; it cannot be made here yet.');
    } else next.recordType = change.recordType;
  }
  const type = next.recordType ?? stored;
  if (change.sqlTableName !== undefined) {
    const name = change.sqlTableName.trim().toUpperCase();
    // SQLTABLENAME is 18 characters.
    if (name !== '' && !/^[A-Z][A-Z0-9_#$@]{0,17}$/.test(name)) throw new RecordSaveRefusedError(`${change.sqlTableName} is not a valid table name (at most 18 characters).`);
    next.sqlTableName = name;
  }
  if (change.buildSequence !== undefined) {
    if (!Number.isInteger(change.buildSequence) || change.buildSequence < 1 || change.buildSequence > 99) {
      throw new RecordSaveRefusedError('The Build Sequence No is a whole number from 1 to 99.');
    }
    next.buildSequence = change.buildSequence;
  }
  if (change.viewSql !== undefined) {
    if (!isViewType(type)) throw new RecordSaveRefusedError('Only a view has SQL.');
    next.viewSql = change.viewSql.replace(/\r?\n/g, '\r\n').replace(/\s+$/, '');
    if (next.viewSql.length > 14000) throw new RecordSaveRefusedError('View SQL longer than 14,000 characters is not saved here yet.');
  }
  if (next.sqlTableName && type !== RecordType.Table && type !== RecordType.View) {
    throw new RecordSaveRefusedError('Only an SQL Table or SQL View has a Non-Standard SQL Table Name.');
  }
  return { ...state, recordType: type, type: next };
}

/**
 * The Record Properties a save can change: plain PSRECDEFN columns (cases
 * r18, r19) and the Tools Table / Managed flags (r24, r25). The audit
 * record and options and the system ID / timestamp fields are not offered:
 * App Designer changes other settings with them (r19).
 */
export interface RecordPropertyEdits {
  description?: string;
  /** DESCRLONG, at most 4,000 characters here. */
  definition?: string;
  ownerId?: string;
  setControlField?: string;
  parentRecord?: string;
  relatedLanguageRecord?: string;
  querySecurityRecord?: string;
  analyticDeleteRecord?: string;
  toolsTable?: boolean;
  managed?: boolean;
  /** AUDITRECNAME (r49). */
  auditRecord?: string;
  /** RECUSE, the audit options: RecordAuditOption bits (r49 set Add). */
  recUse?: number;
  /** TIMESTAMPFIELDNAME (r51); the field takes Auto-Update (USEEDIT 0x4000000), and a field it replaces loses it. */
  timestampField?: string;
  /** SYSTEMIDFIELDNAME (r54): a Number field, which takes Auto-Update the same way (7 of 7 on HRDMO). */
  systemIdField?: string;
}

const PROPERTY_COLUMNS: Readonly<Record<string, string>> = {
  description: 'RECDESCR', ownerId: 'OBJECTOWNERID', setControlField: 'SETCNTRLFLD', parentRecord: 'PARENTRECNAME',
  relatedLanguageRecord: 'RELLANGRECNAME', querySecurityRecord: 'QRYSECRECNAME', analyticDeleteRecord: 'OPTDELRECNAME',
  auditRecord: 'AUDITRECNAME', timestampField: 'TIMESTAMPFIELDNAME', systemIdField: 'SYSTEMIDFIELDNAME'
};

/** Changes Record Properties, validated as names / lengths App Designer allows. */
export function setRecordProperties(state: RecordEditState, change: RecordPropertyEdits): RecordEditState {
  const next: RecordPropertyEdits = { ...state.properties };
  for (const [k, v] of Object.entries(change) as [keyof RecordPropertyEdits, unknown][]) {
    if (v === undefined) continue;
    if (k === 'toolsTable' || k === 'managed') { next[k] = Boolean(v); continue; }
    if (k === 'recUse') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || (n & ~0xF) !== 0) throw new RecordSaveRefusedError('The audit options are Add, Change, Delete and Selective.');
      next.recUse = n;
      continue;
    }
    if (k === 'timestampField' || k === 'systemIdField') {
      const name = String(v).trim().toUpperCase();
      if (name !== '' && !state.fields.some((f) => f.name === name)) throw new RecordSaveRefusedError(`${name} is not a field of ${state.recname}.`);
      // App Designer sets Auto-Update on the Timestamp Field (r51) and the System ID Field (r54), and by the same
      // token not on a field it no longer is.
      const before = state.properties?.[k];
      const fields = state.fields.map((f) => f.name === name ? { ...f, useEdit: f.useEdit | UseEdit.AutoUpdate }
        : before !== undefined && f.name === before ? { ...f, useEdit: f.useEdit & ~UseEdit.AutoUpdate } : f);
      state = { ...state, fields };
      next[k] = name;
      continue;
    }
    if (k === 'definition') {
      const text = String(v).replace(/\s+$/, '');
      if (text.length > 4000) throw new RecordSaveRefusedError('The Record Definition text is limited to 4,000 characters here.');
      next.definition = text;
      continue;
    }
    if (k === 'description') {
      const d = String(v).trim();
      if (d.length > 30) throw new RecordSaveRefusedError('A record description is at most 30 characters.');
      next.description = d;
      continue;
    }
    const name = String(v).trim().toUpperCase();
    if (k === 'ownerId' ? !/^[A-Z0-9_]{0,4}$/.test(name) : name !== '' && !NAME.test(name)) {
      throw new RecordSaveRefusedError(`${String(v)} is not a valid ${k === 'ownerId' ? 'owner ID' : 'name'}.`);
    }
    next[k] = name;
  }
  return { ...state, properties: next };
}

// ---------------------------------------------------------------------------
// Edits. Each returns a new state, or throws with the reason.

function check(state: RecordEditState, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= state.fields.length) {
    throw new RecordSaveRefusedError(`There is no field at position ${index + 1}.`);
  }
}

export function moveField(state: RecordEditState, from: number, to: number): RecordEditState {
  check(state, from);
  check(state, to);
  const fields = [...state.fields];
  const [moved] = fields.splice(from, 1);
  fields.splice(to, 0, moved);
  return { ...state, fields };
}

export function insertField(state: RecordEditState, name: string, at = state.fields.length): RecordEditState {
  const field = name.trim().toUpperCase();
  if (!/^[A-Z0-9_#$@]{1,18}$/.test(field)) throw new RecordSaveRefusedError(`${name} is not a field name.`);
  if (state.fields.some((f) => f.name === field)) throw new RecordSaveRefusedError(`${field} is already in ${state.recname}.`);
  if (at < 0 || at > state.fields.length) throw new RecordSaveRefusedError(`Cannot insert at position ${at + 1}.`);
  const fields = [...state.fields];
  fields.splice(at, 0, { name: field, useEdit: NEW_FIELD_USE_EDIT, isNew: true });
  return { ...state, fields };
}

/** Inserts a subrecord (App Designer's Insert > Subrecord, r53): a Derived/Work record's only, and not twice. */
export function insertSubrecord(state: RecordEditState, name: string, at = state.fields.length): RecordEditState {
  const sub = name.trim().toUpperCase();
  if (!NAME.test(sub)) throw new RecordSaveRefusedError(`${name} is not a record name.`);
  if ((state.type?.recordType ?? state.recordType) !== RecordType.DerivedWork) {
    throw new RecordSaveRefusedError('Subrecords can be inserted into Derived/Work records only, as yet.');
  }
  if (state.fields.some((f) => f.name === sub)) throw new RecordSaveRefusedError(`${sub} is already in ${state.recname}.`);
  if (at < 0 || at > state.fields.length) throw new RecordSaveRefusedError(`Cannot insert at position ${at + 1}.`);
  const fields = [...state.fields];
  fields.splice(at, 0, { name: sub, useEdit: 0, useEdit2: 0, isNew: true, isSubrecord: true });
  return { ...state, fields };
}

export function removeField(state: RecordEditState, index: number): RecordEditState {
  check(state, index);
  return { ...state, fields: state.fields.filter((_, i) => i !== index) };
}

/** Removes several fields at once (multi-select Delete / Cut). */
export function removeFields(state: RecordEditState, indexes: readonly number[]): RecordEditState {
  for (const i of indexes) check(state, i);
  const drop = new Set(indexes);
  return { ...state, fields: state.fields.filter((_, i) => !drop.has(i)) };
}

export interface UseChange {
  key?: boolean; dupOrder?: boolean; altSearch?: boolean; descending?: boolean; searchKey?: boolean; searchEdit?: boolean; listBox?: boolean;
  fromSearch?: boolean; throughSearch?: boolean; defaultSearch?: boolean; disableAdvancedSearch?: boolean;
  allowSearchEvents?: boolean; auditAdd?: boolean; auditChange?: boolean; auditDelete?: boolean;
  systemMaintained?: boolean; doNotTrace?: boolean; smartPrompt?: boolean; smartDropDown?: boolean;
}

const CHANGE_BITS: readonly [keyof UseChange, UseEdit][] = [
  ['key', UseEdit.Key], ['dupOrder', UseEdit.DuplicateOrderKey], ['altSearch', UseEdit.AltSearchKey], ['searchKey', UseEdit.SearchKey],
  ['listBox', UseEdit.ListBoxItem], ['fromSearch', UseEdit.FromSearchField], ['throughSearch', UseEdit.ThroughSearchField],
  ['auditAdd', UseEdit.AuditFieldAdd], ['auditChange', UseEdit.AuditFieldChange], ['auditDelete', UseEdit.AuditFieldDelete],
  ['systemMaintained', UseEdit.SystemMaintained], ['searchEdit', UseEdit.SearchEdit], ['defaultSearch', UseEdit.DefaultSearchField],
  ['disableAdvancedSearch', UseEdit.DisableAdvancedSearchOptions], ['allowSearchEvents', UseEdit.AllowSearchEventsForPromptDialogs]
];

/**
 * Sets Use settings, keeping the combinations HRDMO's delivered fields
 * keep: Key and Duplicate Order Key exclude each other (none of 809
 * duplicate order keys is also a key); Search Key needs Key (53,053 of
 * 53,054); Search Edit needs Search Key (all 135); Descending needs a key
 * of either kind (no exception).
 */
export function setUse(state: RecordEditState, index: number, change: UseChange): RecordEditState {
  check(state, index);
  const f = state.fields[index];
  let useEdit = f.useEdit;
  let useEdit2 = f.useEdit2 ?? 0;
  const set = (bit: UseEdit, on: boolean) => { useEdit = on ? useEdit | bit : useEdit & ~bit; };
  for (const [name, bit] of [['doNotTrace', UseEdit2.DoNotTraceValue], ['smartPrompt', UseEdit2.SmartPrompt],
    ['smartDropDown', UseEdit2.SmartDropDown]] as const) {
    const v = change[name];
    if (v !== undefined) useEdit2 = v ? useEdit2 | bit : useEdit2 & ~bit;
  }
  for (const [name, bit] of CHANGE_BITS) {
    const v = change[name];
    if (v === undefined) continue;
    set(bit, v);
    // An alternate search key is never also a key of either kind (none on HRDMO).
    if (v && name === 'key') { set(UseEdit.DuplicateOrderKey, false); set(UseEdit.AltSearchKey, false); }
    if (v && name === 'dupOrder') { set(UseEdit.Key, false); set(UseEdit.SearchKey, false); set(UseEdit.AltSearchKey, false); }
    if (v && name === 'altSearch') { set(UseEdit.Key, false); set(UseEdit.DuplicateOrderKey, false); set(UseEdit.SearchKey, false); }
  }
  // Descending: a key of either kind, or an alternate search key (11 delivered tables index one descending).
  const keyed = () => hasFlag(useEdit, UseEdit.Key) || hasFlag(useEdit, UseEdit.DuplicateOrderKey) || hasFlag(useEdit, UseEdit.AltSearchKey);
  if (change.searchEdit && !hasFlag(useEdit, UseEdit.SearchKey)) {
    throw new RecordSaveRefusedError(`${f.name} is not a search key: only a search key can have Search Edit.`);
  }
  if (change.searchKey && !hasFlag(useEdit, UseEdit.Key)) {
    throw new RecordSaveRefusedError(`${f.name} is not a key: only a key can be a search key.`);
  }
  if (change.descending !== undefined) {
    if (change.descending && !keyed()) throw new RecordSaveRefusedError(`${f.name} is not a key: only a key can be descending.`);
    set(UseEdit.DescendingKey, change.descending);
  }
  if (!hasFlag(useEdit, UseEdit.Key)) set(UseEdit.SearchKey, false);
  if (!hasFlag(useEdit, UseEdit.SearchKey)) set(UseEdit.SearchEdit, false);
  if (!keyed()) set(UseEdit.DescendingKey, false);
  const fields = state.fields.map((x, i) => (i === index ? { ...x, useEdit, useEdit2 } : x));
  return { ...state, fields };
}

const NAME = /^[A-Z0-9_#$@]{1,18}$/;

export type EditType = 'none' | 'prompt' | 'promptNoEdit' | 'yesNo' | 'translate';

/**
 * The Edits tab (r15): Required, and the table edit -- Prompt Table Edit
 * (the prompt bit and EDITTABLE), Prompt Table with No Edit (EDITTABLE
 * alone), Yes/No Table Edit (its bit, no table), Translate Table Edit (its
 * bit, no table: all 52,909 translate-edited record fields on HRDMO but 52
 * store it that way, and every one's field has translate values -- the
 * save checks that), or No Edit.
 */
export function setEdits(state: RecordEditState, index: number, change: { required?: boolean; edit?: EditType; promptTable?: string }): RecordEditState {
  check(state, index);
  const f = state.fields[index];
  let useEdit = f.useEdit;
  let editTable = f.editTable;
  if (change.required !== undefined) useEdit = change.required ? useEdit | UseEdit.Required : useEdit & ~UseEdit.Required;
  if (change.edit !== undefined) {
    useEdit &= ~(UseEdit.PromptTable | UseEdit.YesNoTable | UseEdit.TranslateTable);
    if (change.edit === 'prompt' || change.edit === 'promptNoEdit') {
      const table = (change.promptTable ?? '').trim().toUpperCase();
      if (!NAME.test(table)) throw new RecordSaveRefusedError(`${change.promptTable ?? ''} is not a record name.`);
      editTable = table;
      if (change.edit === 'prompt') useEdit |= UseEdit.PromptTable;
    } else {
      editTable = '';
      if (change.edit === 'yesNo') useEdit |= UseEdit.YesNoTable;
      if (change.edit === 'translate') useEdit |= UseEdit.TranslateTable;
    }
  }
  return { ...state, fields: state.fields.map((x, i) => (i === index ? { ...x, useEdit, editTable } : x)) };
}

/** The Default Value (r15): a constant (DEFFIELDNAME alone), a record and field, or none. */
export function setDefault(state: RecordEditState, index: number, value: { constant: string } | { record: string; field: string } | null): RecordEditState {
  check(state, index);
  let defaultRecord = '';
  let defaultField = '';
  if (value && 'constant' in value) {
    defaultField = value.constant.trim();
    if (defaultField.length > 254) throw new RecordSaveRefusedError('A default constant is at most 254 characters.');
  } else if (value) {
    defaultRecord = value.record.trim().toUpperCase();
    defaultField = value.field.trim().toUpperCase();
    if (!NAME.test(defaultRecord) || !NAME.test(defaultField)) throw new RecordSaveRefusedError('A default needs a record name and a field name.');
  }
  return { ...state, fields: state.fields.map((x, i) => (i === index ? { ...x, defaultRecord, defaultField } : x)) };
}

/** The Record Field Label ID (r15): a label, or '' for the default label (UseDefaultLabel set). */
export function setLabel(state: RecordEditState, index: number, labelId: string): RecordEditState {
  check(state, index);
  const id = labelId.trim();
  return {
    ...state,
    fields: state.fields.map((x, i) => (i === index ? {
      ...x, labelId: id,
      useEdit: id ? x.useEdit & ~UseEdit.UseDefaultLabel : x.useEdit | UseEdit.UseDefaultLabel
    } : x))
  };
}

/** The Default Page Control: only values App Designer has been seen to store (KNOWN_PAGE_CONTROLS). */
export function setPageControl(state: RecordEditState, index: number, value: number): RecordEditState {
  check(state, index);
  if (!KNOWN_PAGE_CONTROLS.includes(value)) throw new RecordSaveRefusedError(`Page control ${value} has not been observed; it cannot be set here yet.`);
  return { ...state, fields: state.fields.map((x, i) => (i === index ? { ...x, pageControl: value } : x)) };
}

// ---------------------------------------------------------------------------
// The save plan

/** A stored row, column -> value (TIMESTAMPs as 'YYYY-MM-DDTHH24:MI:SS.FF6' strings). */
export type Row = Record<string, string | number | null>;

/** The values App Designer gives a field it inserts (cases r02, r03), besides the key, FIELDNUM, USEEDIT and stamp. */
export const NEW_RECFIELD_VALUES: Readonly<Row> = {
  DEFRECNAME: ' ', DEFFIELDNAME: ' ', CURCTLFIELDNAME: ' ', EDITTABLE: ' ', USEEDIT2: 0, SUBRECORD: 'N',
  SUBRECVER: 0, SETCNTRLFLD: ' ', DEFGUICONTROL: 99, LABEL_ID: ' ', TIMEZONEUSE: 0, TIMEZONEFIELDNAME: ' ',
  RELTMDTFIELDNAME: ' ', CURRCTLUSE: 0
};

/** An alternate search key's index as App Designer created it (r55), besides RECNAME, INDEXID and KEYCOUNT. */
export const NEW_ALT_INDEX_VALUES: Readonly<Row> = {
  INDEXTYPE: 3, UNIQUEFLAG: 0, CLUSTERFLAG: 0, ACTIVEFLAG: 1, CUSTKEYORDER: 0, DDLCOUNT: 0, PLATFORM_SBS: 1, PLATFORM_DB2: 1,
  PLATFORM_ORA: 1, PLATFORM_INF: 1, PLATFORM_DBX: 1, PLATFORM_ALB: 1, PLATFORM_SYB: 1, PLATFORM_MSS: 1, PLATFORM_DB4: 1, IDXCOMMENTS: ' '
};

/** The `_` index App Designer creates for an SQL Table's first key (case r03), besides RECNAME and KEYCOUNT. */
export const NEW_KEY_INDEX_VALUES: Readonly<Row> = {
  INDEXID: '_', INDEXTYPE: 1, UNIQUEFLAG: 1, CLUSTERFLAG: 1, ACTIVEFLAG: 1, CUSTKEYORDER: 0, DDLCOUNT: 0,
  PLATFORM_SBS: 1, PLATFORM_DB2: 1, PLATFORM_ORA: 1, PLATFORM_INF: 1, PLATFORM_DBX: 1, PLATFORM_ALB: 1,
  PLATFORM_SYB: 1, PLATFORM_MSS: 1, PLATFORM_DB4: 1, IDXCOMMENTS: ' '
};

export interface StoredRecord {
  /** Each subrecord the record holds (or an edit inserts): its own PSRECFIELD rows, in FIELDNUM order. */
  subrecords?: Readonly<Record<string, Row[]>>;
  recname: string;
  recordType: RecordType;
  version: number;
  /** The PSRECDEFN row (its Record Properties columns; DESCRLONG as text), when a save changes them. */
  defn?: Row;
  /** PSRECFIELD rows in FIELDNUM order, every column. */
  fields: Row[];
  /** PSINDEXDEFN rows. */
  indexes: Row[];
}

export interface RecordSavePlan {
  /** PSRECFIELD rows to insert, in order. */
  fields: Row[];
  /** PSRECFIELDDB rows to insert: the fields with each subrecord expanded in place. */
  dbFields: Row[];
  /** PSRECDEFN columns the save changes besides its counts and stamp (Record Properties). */
  recordColumns: Row;
  /** The key index and its key rows, for an SQL Table; absent for Derived/Work. */
  index?: { row: Row; keys: Row[] };
  fieldCount: number;
  indexCount: number;
  removed: string[];
  /** PGM moves with RDM when a field is removed. */
  bumpPgm: boolean;
  /** The record's type after the save. */
  recordType: RecordType;
  /** PSRECTBLSPC: inserted on becoming an SQL Table (r26), deleted on leaving one (r28). */
  tablespace?: 'insert' | 'delete';
  /** The view's SQL to write (PSSQLDEFN SQLTYPE 2 and its rows): when it changed, or the record became a view (r28). */
  viewSql?: string;
  /** An SQL Table's alternate search key indexes, '0', '1', ... (r55). */
  altIndexes: { row: Row; keys: Row[] }[];
  /** The view's SQL rows are deleted: a view became an SQL Table (r57). */
  dropViewSql?: boolean;
}

const str = (v: unknown) => String(v ?? '').trim();

/**
 * Why a record cannot be edited here, or undefined. Only records shaped
 * like the cases': an SQL Table or Derived/Work record, no subrecords, no
 * alternate search keys, no index but the key index `_`.
 */
export function editRefusal(stored: StoredRecord): string | undefined {
  if (stored.recordType !== RecordType.Table && stored.recordType !== RecordType.DerivedWork && !isViewType(stored.recordType)) {
    return 'Only SQL Table, SQL View, Dynamic View and Derived/Work records can be edited yet.';
  }
  if (isViewType(stored.recordType) && (Number(stored.defn?.AUXFLAGMASK ?? 0) & RecordFlag.MaterializedView) !== 0) {
    return 'Materialized views cannot be edited yet.';
  }
  if (isViewType(stored.recordType) && stored.indexes.length > 0) return 'This view has an index, which views here do not (4 of 20,167).';
  // Subrecords: as App Designer saved one into a Derived/Work record (r53).
  if (stored.recordType !== RecordType.DerivedWork && stored.fields.some((f) => str(f.SUBRECORD) === 'Y')) {
    return 'Only Derived/Work records with subrecords can be edited yet.';
  }
  // An SQL Table's alternate search keys are its indexes '0', '1', ... (r55); a Derived/Work record or view has none.
  const other = stored.indexes.filter((i) => str(i.INDEXID) !== '_' && !(/^[0-9]$/.test(str(i.INDEXID)) && Number(i.INDEXTYPE ?? 3) === 3));
  if (other.length > 0) return `Records with indexes other than the key index cannot be edited yet (${other.map((i) => str(i.INDEXID)).join(', ')}).`;
  if (stored.recordType === RecordType.DerivedWork && stored.indexes.length > 0) return 'This Derived/Work record has an index, which none observed has.';
  if (stored.indexes.some((i) => Number(i.CUSTKEYORDER) === 1)) {
    return 'Records whose key index has a custom key order cannot be edited yet.';
  }
  return undefined;
}

/** editRefusal for the record as the editor reads it (model/recordLayout.ts). */
export function layoutEditRefusal(layout: {
  recordType: RecordType; fields: { isSubrecord: boolean; useEdit: number }[]; indexIds?: string[]; auxFlagMask?: number;
}): string | undefined {
  return editRefusal({
    recname: '', recordType: layout.recordType, version: 0, defn: { AUXFLAGMASK: layout.auxFlagMask ?? 0 },
    fields: layout.fields.map((f) => ({ SUBRECORD: f.isSubrecord ? 'Y' : 'N', USEEDIT: f.useEdit })),
    indexes: (layout.indexIds ?? []).map((id) => ({ INDEXID: id }))
  });
}

/** The column settings an edit field carries (absent ones stay as stored); blanks stored as ' '. */
function columns(f: RecordEditField): Row {
  const blank = (v: string) => (v === '' ? ' ' : v);
  const out: Row = {};
  if (f.editTable !== undefined) out.EDITTABLE = blank(f.editTable);
  if (f.defaultRecord !== undefined) out.DEFRECNAME = blank(f.defaultRecord);
  if (f.defaultField !== undefined) out.DEFFIELDNAME = blank(f.defaultField);
  if (f.labelId !== undefined) out.LABEL_ID = blank(f.labelId);
  if (f.pageControl !== undefined) out.DEFGUICONTROL = f.pageControl;
  return out;
}

/**
 * PSRECFIELDDB for PSRECFIELD rows: each own row as itself, each subrecord
 * row replaced by the subrecord's own rows (RECNAME_PARENT the subrecord),
 * numbered straight through -- r53, and ADHOC_SALCHG_WK's fields after its
 * subrecord SS_PROC_SBR continuing the numbering. Nested subrecords are
 * refused.
 */
export function expandDbFields(recname: string, fields: readonly Row[], subrecords: Readonly<Record<string, Row[]>>): Row[] {
  const out: Row[] = [];
  for (const f of fields) {
    if (str(f.SUBRECORD) !== 'Y') { out.push({ ...f, RECNAME_PARENT: recname, FIELDNUM: out.length + 1 }); continue; }
    const sub = str(f.FIELDNAME);
    const rows = subrecords[sub];
    if (!rows) throw new RecordSaveRefusedError(`The fields of subrecord ${sub} are not known; refusing to write.`);
    for (const r of rows) {
      if (str(r.SUBRECORD) === 'Y') throw new RecordSaveRefusedError(`${sub} holds a subrecord itself; nested subrecords are not saved here yet.`);
      out.push({ ...r, RECNAME: recname, RECNAME_PARENT: sub, FIELDNUM: out.length + 1 });
    }
  }
  return out;
}

/** The edit state a record opens with. */
export function editStateFor(stored: StoredRecord): RecordEditState {
  return {
    recname: stored.recname,
    recordType: stored.recordType,
    openedVersion: stored.version,
    fields: stored.fields.map((f) => ({
      name: str(f.FIELDNAME), useEdit: Number(f.USEEDIT), useEdit2: Number(f.USEEDIT2 ?? 0), isNew: false,
      ...(str(f.SUBRECORD) === 'Y' ? { isSubrecord: true } : {})
    }))
  };
}

/**
 * The rows the save writes. `stamp` is the save's one database timestamp
 * and operator. Refused when the edit does not fit the stored record.
 */
export function planRecordSave(stored: StoredRecord, edit: RecordEditState, stamp: { ts: string; operatorId: string }): RecordSavePlan {
  const refusal = editRefusal(stored);
  if (refusal) throw new RecordSaveRefusedError(refusal);
  if (edit.recname !== stored.recname) throw new RecordSaveRefusedError('The edit is for another record.');
  if (edit.fields.length === 0) throw new RecordSaveRefusedError('A record needs at least one field.');

  const byName = new Map(stored.fields.map((f) => [str(f.FIELDNAME), f]));
  const seen = new Set<string>();
  const fields: Row[] = edit.fields.map((f, i) => {
    if (seen.has(f.name)) throw new RecordSaveRefusedError(`${f.name} is listed twice.`);
    seen.add(f.name);
    const fieldNum = i + 1;
    if (f.isNew && f.isSubrecord) {
      if (byName.has(f.name)) throw new RecordSaveRefusedError(`${f.name} is already in ${stored.recname}.`);
      // r53: the subrecord's row -- SUBRECORD 'Y', USEEDIT 0, the new-row values, stamped.
      return {
        RECNAME: stored.recname, FIELDNAME: f.name, FIELDNUM: fieldNum, ...NEW_RECFIELD_VALUES, SUBRECORD: 'Y',
        USEEDIT: 0, USEEDIT2: 0, LASTUPDDTTM: stamp.ts, LASTUPDOPRID: stamp.operatorId
      };
    }
    if (f.isNew) {
      if (byName.has(f.name)) throw new RecordSaveRefusedError(`${f.name} is already in ${stored.recname}.`);
      return {
        RECNAME: stored.recname, FIELDNAME: f.name, FIELDNUM: fieldNum, ...NEW_RECFIELD_VALUES, ...columns(f),
        USEEDIT: f.useEdit, USEEDIT2: f.useEdit2 ?? 0, LASTUPDDTTM: stamp.ts, LASTUPDOPRID: stamp.operatorId
      };
    }
    const old = byName.get(f.name);
    if (!old) throw new RecordSaveRefusedError(`${f.name} is not in ${stored.recname} any more; reopen it.`);
    if (str(old.SUBRECORD) === 'Y') {
      if (f.useEdit !== Number(old.USEEDIT)) throw new RecordSaveRefusedError(`${f.name} is a subrecord: it has no settings of its own.`);
      return { ...old, FIELDNUM: fieldNum };
    }
    const useEdit2 = f.useEdit2 ?? Number(old.USEEDIT2 ?? 0);
    const offLimits = ((Number(old.USEEDIT) ^ f.useEdit) & ~EDITABLE_USE_BITS) | ((Number(old.USEEDIT2 ?? 0) ^ useEdit2) & ~EDITABLE_USE2_BITS);
    if (offLimits !== 0) throw new RecordSaveRefusedError(`${f.name}: that setting cannot be changed here yet.`);
    const cols = columns(f);
    // Auto-Update follows the record's Timestamp Field without restamping the field row (r51).
    const changed = ((Number(old.USEEDIT) ^ f.useEdit) & ~UseEdit.AutoUpdate) !== 0 || Number(old.USEEDIT2 ?? 0) !== useEdit2 ||
      Object.entries(cols).some(([k, v]) => str(old[k]) !== str(v));
    return {
      ...old, ...cols, FIELDNUM: fieldNum, USEEDIT: f.useEdit, ...('USEEDIT2' in old ? { USEEDIT2: useEdit2 } : {}),
      ...(changed ? { LASTUPDDTTM: stamp.ts, LASTUPDOPRID: stamp.operatorId } : {})
    };
  });
  const removed = [...byName.keys()].filter((n) => !seen.has(n));
  // Removing a subrecord removes its row and its expanded rows; PGM moves, as for a removed field (r56).

  const finalType = edit.type?.recordType ?? stored.recordType;
  if (finalType !== RecordType.DerivedWork && fields.some((f) => str(f.SUBRECORD) === 'Y')) {
    throw new RecordSaveRefusedError('A record with subrecords stays Derived/Work here, as yet.');
  }
  const dbFields = expandDbFields(stored.recname, fields, stored.subrecords ?? {});
  let index: RecordSavePlan['index'];
  const altIndexes: NonNullable<RecordSavePlan['index']>[] = [];
  // Only an SQL Table has a key index: views and Derived/Work records with keys have none
  // (20,163 of 20,167 keyed SQL Views; all 1,233 keyed Derived/Work records).
  if (finalType === RecordType.Table) {
    // The key index holds the keys and duplicate order keys, in field order;
    // a duplicate order key makes it non-unique (r08; all 17,961 delivered
    // SQL Tables without subrecords agree on both).
    const isKey = (f: Row) => hasFlag(Number(f.USEEDIT), UseEdit.Key) || hasFlag(Number(f.USEEDIT), UseEdit.DuplicateOrderKey);
    const keys = fields.filter(isKey);
    // An SQL Table without keys has no key index (r26), and removing its last key drops it (r45).
    if (keys.length > 0) {
    const unique = keys.some((k) => hasFlag(Number(k.USEEDIT), UseEdit.DuplicateOrderKey)) ? 0 : 1;
    const existing = stored.indexes.find((i) => str(i.INDEXID) === '_');
    const row: Row = existing
      ? { ...existing, KEYCOUNT: keys.length, UNIQUEFLAG: unique }
      : { RECNAME: stored.recname, ...NEW_KEY_INDEX_VALUES, KEYCOUNT: keys.length, UNIQUEFLAG: unique };
    index = {
      row,
      keys: keys.map((k, i) => ({
        RECNAME: stored.recname, INDEXID: '_', KEYPOSN: i + 1, FIELDNAME: str(k.FIELDNAME),
        ASCDESC: hasFlag(Number(k.USEEDIT), UseEdit.DescendingKey) ? 0 : 1
      }))
    };
    }
    // Each alternate search key, in field order, is index '0', '1', ...: INDEXTYPE 3, not unique or clustered,
    // the alternate field then the record's keys -- not its duplicate order keys (r55; 2,136 of HRDMO's 2,140
    // SQL Tables with alternate search keys agree; the 4 others carry hand-added columns, refused by the writer).
    const altFields = fields.filter((f) => hasFlag(Number(f.USEEDIT), UseEdit.AltSearchKey));
    if (altFields.length > 10) throw new RecordSaveRefusedError('More than ten alternate search keys is not saved here.');
    const keyFields = fields.filter((f) => hasFlag(Number(f.USEEDIT), UseEdit.Key));
    const asc = (f: Row) => (hasFlag(Number(f.USEEDIT), UseEdit.DescendingKey) ? 0 : 1);
    for (const [i, alt] of altFields.entries()) {
      const id = String(i);
      const cols = [alt, ...keyFields];
      const existing = stored.indexes.find((x) => str(x.INDEXID) === id);
      altIndexes.push({
        row: existing ? { ...existing, KEYCOUNT: cols.length } : { RECNAME: stored.recname, INDEXID: id, ...NEW_ALT_INDEX_VALUES, KEYCOUNT: cols.length },
        keys: cols.map((f, n) => ({ RECNAME: stored.recname, INDEXID: id, KEYPOSN: n + 1, FIELDNAME: str(f.FIELDNAME), ASCDESC: asc(f) }))
      });
    }
  }

  const recordColumns: Row = {};
  const props = edit.properties ?? {};
  for (const [k, col] of Object.entries(PROPERTY_COLUMNS)) {
    const v = props[k as keyof RecordPropertyEdits];
    if (typeof v === 'string') recordColumns[col] = v === '' ? ' ' : v;
  }
  if (props.recUse !== undefined) recordColumns.RECUSE = props.recUse;
  if (props.definition !== undefined) recordColumns.DESCRLONG = props.definition === '' ? null : props.definition;
  if (props.toolsTable !== undefined || props.managed !== undefined) {
    if (!stored.defn) throw new RecordSaveRefusedError('The stored record row is needed to change its flags.');
    let mask = Number(stored.defn.AUXFLAGMASK);
    const flag = (bit: RecordFlag, on: boolean | undefined) => { if (on !== undefined) mask = on ? mask | bit : mask & ~bit; };
    flag(RecordFlag.ToolsTable, props.toolsTable);
    flag(RecordFlag.Managed, props.managed);
    recordColumns.AUXFLAGMASK = mask;
  }

  const type = edit.type ?? {};
  if (finalType !== stored.recordType) recordColumns.RECTYPE = finalType;
  // A Derived/Work record has no SQL table name (r46 cleared it).
  if (finalType === RecordType.DerivedWork && stored.recordType !== RecordType.DerivedWork) recordColumns.SQLTABLENAME = ' ';
  if (type.sqlTableName !== undefined) recordColumns.SQLTABLENAME = type.sqlTableName === '' ? ' ' : type.sqlTableName;
  if (type.buildSequence !== undefined) recordColumns.BUILDSEQNO = type.buildSequence;
  const tablespace = stored.recordType === RecordType.Table && finalType !== RecordType.Table ? 'delete'
    : stored.recordType !== RecordType.Table && finalType === RecordType.Table ? 'insert' : undefined;
  let viewSql: string | undefined;
  if (isViewType(finalType)) {
    viewSql = type.viewSql;
    if (!isViewType(stored.recordType) && !viewSql) throw new RecordSaveRefusedError('A view needs its SQL: write it on the Record Type tab.');
  }

  return {
    fields,
    dbFields,
    recordColumns,
    recordType: finalType,
    ...(tablespace ? { tablespace } : {}),
    ...(viewSql !== undefined ? { viewSql } : {}),
    ...(index ? { index } : {}),
    altIndexes,
    ...(isViewType(stored.recordType) && !isViewType(finalType) ? { dropViewSql: true } : {}),
    fieldCount: fields.length,
    indexCount: (index ? 1 : 0) + altIndexes.length,
    removed,
    bumpPgm: removed.length > 0
  };
}
