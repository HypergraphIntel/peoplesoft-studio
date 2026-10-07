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
  UseEdit.Required | UseEdit.PromptTable | UseEdit.YesNoTable | UseEdit.UseDefaultLabel;

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
}

const PROPERTY_COLUMNS: Readonly<Record<string, string>> = {
  description: 'RECDESCR', ownerId: 'OBJECTOWNERID', setControlField: 'SETCNTRLFLD', parentRecord: 'PARENTRECNAME',
  relatedLanguageRecord: 'RELLANGRECNAME', querySecurityRecord: 'QRYSECRECNAME', analyticDeleteRecord: 'OPTDELRECNAME'
};

/** Changes Record Properties, validated as names / lengths App Designer allows. */
export function setRecordProperties(state: RecordEditState, change: RecordPropertyEdits): RecordEditState {
  const next: RecordPropertyEdits = { ...state.properties };
  for (const [k, v] of Object.entries(change) as [keyof RecordPropertyEdits, unknown][]) {
    if (v === undefined) continue;
    if (k === 'toolsTable' || k === 'managed') { next[k] = Boolean(v); continue; }
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
  key?: boolean; dupOrder?: boolean; descending?: boolean; searchKey?: boolean; searchEdit?: boolean; listBox?: boolean;
  fromSearch?: boolean; throughSearch?: boolean; defaultSearch?: boolean; disableAdvancedSearch?: boolean;
  allowSearchEvents?: boolean; auditAdd?: boolean; auditChange?: boolean; auditDelete?: boolean;
  systemMaintained?: boolean; doNotTrace?: boolean; smartPrompt?: boolean; smartDropDown?: boolean;
}

const CHANGE_BITS: readonly [keyof UseChange, UseEdit][] = [
  ['key', UseEdit.Key], ['dupOrder', UseEdit.DuplicateOrderKey], ['searchKey', UseEdit.SearchKey],
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
    if (v && name === 'key') set(UseEdit.DuplicateOrderKey, false);
    if (v && name === 'dupOrder') { set(UseEdit.Key, false); set(UseEdit.SearchKey, false); }
  }
  const keyed = () => hasFlag(useEdit, UseEdit.Key) || hasFlag(useEdit, UseEdit.DuplicateOrderKey);
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

export type EditType = 'none' | 'prompt' | 'promptNoEdit' | 'yesNo';

/**
 * The Edits tab (r15): Required, and the table edit -- Prompt Table Edit
 * (the prompt bit and EDITTABLE), Prompt Table with No Edit (EDITTABLE
 * alone), Yes/No Table Edit (its bit, no table), or No Edit. A translate
 * edit is kept as stored: no case has set or cleared one.
 */
export function setEdits(state: RecordEditState, index: number, change: { required?: boolean; edit?: EditType; promptTable?: string }): RecordEditState {
  check(state, index);
  const f = state.fields[index];
  let useEdit = f.useEdit;
  let editTable = f.editTable;
  if (change.required !== undefined) useEdit = change.required ? useEdit | UseEdit.Required : useEdit & ~UseEdit.Required;
  if (change.edit !== undefined) {
    if (hasFlag(useEdit, UseEdit.TranslateTable)) throw new RecordSaveRefusedError(`${f.name} has a translate table edit, which cannot be changed here yet.`);
    useEdit &= ~(UseEdit.PromptTable | UseEdit.YesNoTable);
    if (change.edit === 'prompt' || change.edit === 'promptNoEdit') {
      const table = (change.promptTable ?? '').trim().toUpperCase();
      if (!NAME.test(table)) throw new RecordSaveRefusedError(`${change.promptTable ?? ''} is not a record name.`);
      editTable = table;
      if (change.edit === 'prompt') useEdit |= UseEdit.PromptTable;
    } else {
      editTable = '';
      if (change.edit === 'yesNo') useEdit |= UseEdit.YesNoTable;
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

/** The `_` index App Designer creates for an SQL Table's first key (case r03), besides RECNAME and KEYCOUNT. */
export const NEW_KEY_INDEX_VALUES: Readonly<Row> = {
  INDEXID: '_', INDEXTYPE: 1, UNIQUEFLAG: 1, CLUSTERFLAG: 1, ACTIVEFLAG: 1, CUSTKEYORDER: 0, DDLCOUNT: 0,
  PLATFORM_SBS: 1, PLATFORM_DB2: 1, PLATFORM_ORA: 1, PLATFORM_INF: 1, PLATFORM_DBX: 1, PLATFORM_ALB: 1,
  PLATFORM_SYB: 1, PLATFORM_MSS: 1, PLATFORM_DB4: 1, IDXCOMMENTS: ' '
};

export interface StoredRecord {
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
  /** PSRECFIELD rows to insert, in order; PSRECFIELDDB is the same with RECNAME_PARENT. */
  fields: Row[];
  /** PSRECDEFN columns the save changes besides its counts and stamp (Record Properties). */
  recordColumns: Row;
  /** The key index and its key rows, for an SQL Table; absent for Derived/Work. */
  index?: { row: Row; keys: Row[] };
  fieldCount: number;
  indexCount: number;
  removed: string[];
  /** PGM moves with RDM when a field is removed. */
  bumpPgm: boolean;
}

const str = (v: unknown) => String(v ?? '').trim();

/**
 * Why a record cannot be edited here, or undefined. Only records shaped
 * like the cases': an SQL Table or Derived/Work record, no subrecords, no
 * alternate search keys, no index but the key index `_`.
 */
export function editRefusal(stored: StoredRecord): string | undefined {
  if (stored.recordType !== RecordType.Table && stored.recordType !== RecordType.DerivedWork) {
    return 'Only SQL Table and Derived/Work records can be edited yet.';
  }
  if (stored.fields.some((f) => str(f.SUBRECORD) === 'Y')) return 'Records with subrecords cannot be edited yet.';
  if (stored.fields.some((f) => hasFlag(Number(f.USEEDIT), UseEdit.AltSearchKey))) {
    return 'Records with alternate search keys cannot be edited yet (their indexes are not modelled).';
  }
  const other = stored.indexes.filter((i) => str(i.INDEXID) !== '_');
  if (other.length > 0) return `Records with indexes other than the key index cannot be edited yet (${other.map((i) => str(i.INDEXID)).join(', ')}).`;
  if (stored.recordType === RecordType.DerivedWork && stored.indexes.length > 0) return 'This Derived/Work record has an index, which none observed has.';
  if (stored.indexes.some((i) => Number(i.CUSTKEYORDER) === 1)) {
    return 'Records whose key index has a custom key order cannot be edited yet.';
  }
  return undefined;
}

/** editRefusal for the record as the editor reads it (model/recordLayout.ts). */
export function layoutEditRefusal(layout: { recordType: RecordType; fields: { isSubrecord: boolean; useEdit: number }[]; indexIds?: string[] }): string | undefined {
  return editRefusal({
    recname: '', recordType: layout.recordType, version: 0,
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

/** The edit state a record opens with. */
export function editStateFor(stored: StoredRecord): RecordEditState {
  return {
    recname: stored.recname,
    recordType: stored.recordType,
    openedVersion: stored.version,
    fields: stored.fields.map((f) => ({ name: str(f.FIELDNAME), useEdit: Number(f.USEEDIT), useEdit2: Number(f.USEEDIT2 ?? 0), isNew: false }))
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
    if (f.isNew) {
      if (byName.has(f.name)) throw new RecordSaveRefusedError(`${f.name} is already in ${stored.recname}.`);
      return {
        RECNAME: stored.recname, FIELDNAME: f.name, FIELDNUM: fieldNum, ...NEW_RECFIELD_VALUES, ...columns(f),
        USEEDIT: f.useEdit, USEEDIT2: f.useEdit2 ?? 0, LASTUPDDTTM: stamp.ts, LASTUPDOPRID: stamp.operatorId
      };
    }
    const old = byName.get(f.name);
    if (!old) throw new RecordSaveRefusedError(`${f.name} is not in ${stored.recname} any more; reopen it.`);
    const useEdit2 = f.useEdit2 ?? Number(old.USEEDIT2 ?? 0);
    const offLimits = ((Number(old.USEEDIT) ^ f.useEdit) & ~EDITABLE_USE_BITS) | ((Number(old.USEEDIT2 ?? 0) ^ useEdit2) & ~EDITABLE_USE2_BITS);
    if (offLimits !== 0) throw new RecordSaveRefusedError(`${f.name}: that setting cannot be changed here yet.`);
    const cols = columns(f);
    const changed = Number(old.USEEDIT) !== f.useEdit || Number(old.USEEDIT2 ?? 0) !== useEdit2 ||
      Object.entries(cols).some(([k, v]) => str(old[k]) !== str(v));
    return {
      ...old, ...cols, FIELDNUM: fieldNum, USEEDIT: f.useEdit, ...('USEEDIT2' in old ? { USEEDIT2: useEdit2 } : {}),
      ...(changed ? { LASTUPDDTTM: stamp.ts, LASTUPDOPRID: stamp.operatorId } : {})
    };
  });
  const removed = [...byName.keys()].filter((n) => !seen.has(n));

  let index: RecordSavePlan['index'];
  if (stored.recordType === RecordType.Table) {
    // The key index holds the keys and duplicate order keys, in field order;
    // a duplicate order key makes it non-unique (r08; all 17,961 delivered
    // SQL Tables without subrecords agree on both).
    const isKey = (f: Row) => hasFlag(Number(f.USEEDIT), UseEdit.Key) || hasFlag(Number(f.USEEDIT), UseEdit.DuplicateOrderKey);
    const keys = fields.filter(isKey);
    const hadIndex = stored.indexes.some((i) => str(i.INDEXID) === '_');
    if (keys.length === 0 && hadIndex) {
      throw new RecordSaveRefusedError('Removing the last key of an SQL Table has not been observed in App Designer; it cannot be done here yet.');
    }
    // An SQL Table without keys has no key index (r26: App Designer saved one, INDEXCOUNT 0).
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
  }

  const recordColumns: Row = {};
  const props = edit.properties ?? {};
  for (const [k, col] of Object.entries(PROPERTY_COLUMNS)) {
    const v = props[k as keyof RecordPropertyEdits];
    if (typeof v === 'string') recordColumns[col] = v === '' ? ' ' : v;
  }
  if (props.definition !== undefined) recordColumns.DESCRLONG = props.definition === '' ? null : props.definition;
  if (props.toolsTable !== undefined || props.managed !== undefined) {
    if (!stored.defn) throw new RecordSaveRefusedError('The stored record row is needed to change its flags.');
    let mask = Number(stored.defn.AUXFLAGMASK);
    const flag = (bit: RecordFlag, on: boolean | undefined) => { if (on !== undefined) mask = on ? mask | bit : mask & ~bit; };
    flag(RecordFlag.ToolsTable, props.toolsTable);
    flag(RecordFlag.Managed, props.managed);
    recordColumns.AUXFLAGMASK = mask;
  }

  return {
    fields,
    recordColumns,
    ...(index ? { index } : {}),
    fieldCount: fields.length,
    indexCount: index ? 1 : 0,
    removed,
    bumpPgm: removed.length > 0
  };
}
