import { DefinitionKey } from './definitions.js';

/** PSDBFIELD.FIELDTYPE values. */
export enum FieldType {
  Character = 0,
  LongCharacter = 1,
  Number = 2,
  SignedNumber = 3,
  Date = 4,
  Time = 5,
  DateTime = 6,
  Image = 8,
  ImageReference = 9
}

/**
 * Bit flags in PSRECFIELD.USEEDIT. docs/RECORD_SAVE.md. Every value here is
 * confirmed against App Designer on HRDMO:
 *
 *   Use display (ABS_HIST_DET, PSOPRDEFN): Key, AltSearchKey, ListBoxItem,
 *     DescendingKey;
 *   Edits display (PSOPRDEFN): Required, TranslateTable, PromptTable;
 *   cases r08 / r09 (one setting per field of ZZ_PCODE_LAB_R1, saved):
 *     DuplicateOrderKey, SystemMaintained, AuditFieldAdd, SearchKey,
 *     AuditFieldChange, AuditFieldDelete, FromSearchField, ThroughSearchField;
 *   cases r11-r14: DefaultSearchField, SearchEdit, DisableAdvancedSearchOptions,
 *     AllowSearchEventsForPromptDialogs.
 *
 * cases r15 / r16: YesNoTable, UseDefaultLabel (0x800000, which App
 *     Designer sets on every field it inserts).
 *
 * case r19: AutoUpdate (set with the record's Timestamp Field).
 *
 * In Memory is not established yet.
 * "Prompt Table with No Edit" has no bit: it is EDITTABLE set without
 * PromptTable (r15; 2,211 delivered fields).
 */
export enum UseEdit {
  Key = 0x0001,
  /** A key of the key index that does not make it unique (r08: KEYCOUNT 2, UNIQUEFLAG 0). */
  DuplicateOrderKey = 0x0002,
  SystemMaintained = 0x0004,
  AuditFieldAdd = 0x0008,
  /** "Alt" in the Key column. */
  AltSearchKey = 0x0010,
  ListBoxItem = 0x0020,
  /** "D" in the Dir column (was wrongly 0x200, with 0x40 as Required). */
  DescendingKey = 0x0040,
  /** Was wrongly 0x1000. */
  AuditFieldChange = 0x0080,
  Required = 0x0100,
  /** "Xlat" in the Edit column. */
  TranslateTable = 0x0200,
  /** Was wrongly 0x2000. */
  AuditFieldDelete = 0x0400,
  /** "Yes/No Table Edit" (r15; 17,342 delivered fields, all character). */
  YesNoTable = 0x2000,
  SearchKey = 0x0800,
  /** "Prompt" in the Edit column; the table is EDITTABLE. */
  PromptTable = 0x4000,
  /** Was wrongly 0x4000. */
  FromSearchField = 0x40000,
  /** Was wrongly 0x8000. */
  ThroughSearchField = 0x80000,
  /** r13. */
  DisableAdvancedSearchOptions = 0x200000,
  /** r11. */
  DefaultSearchField = 0x1000000,
  /** r14. */
  AllowSearchEventsForPromptDialogs = 0x8000000,
  /**
   * Auto-Update. r19: choosing the record's Timestamp Field set it on that
   * field (10 of 11 delivered timestamp fields carry it).
   */
  AutoUpdate = 0x4000000,
  /** r12; under Search Key (all 135 delivered search edits are search keys). */
  SearchEdit = 0x10000000,
  /**
   * "*** Use Default Label ***": set exactly when LABEL_ID is blank (r15:
   * choosing a label cleared it; 495,108 of 495,111 delivered blank-label
   * fields carry it, 19,790 of 19,891 labelled ones do not). App Designer
   * sets it on every field it inserts.
   */
  UseDefaultLabel = 0x800000
}

/** Bit flags in PSRECFIELD.USEEDIT2, each confirmed by an App Designer case. */
export enum UseEdit2 {
  /** r10; 513 delivered fields. */
  DoNotTraceValue = 0x800000,
  /** r15 (VAL); 455 delivered fields. */
  SmartPrompt = 0x1000000,
  /** r15 (C07); 444 delivered fields. */
  SmartDropDown = 0x2000000,
  /**
   * Oracle In-Memory: the field is held in memory (r67 set it on every
   * field for All Fields, r72 on the fields chosen for Selective Fields).
   */
  InMemory = 0x80000
}

/** Every USEEDIT bit above: all confirmed. */
export const CONFIRMED_USE_EDIT_BITS = Object.values(UseEdit)
  .filter((v): v is number => typeof v === 'number').reduce((a, b) => a | b, 0);

/** The USEEDIT of a field App Designer inserts into a record (cases r02, r03): default label, nothing else. */
export const NEW_FIELD_USE_EDIT: number = UseEdit.UseDefaultLabel;

export interface RecordField {
  name: string;
  /** Position within the record; PSRECFIELD.FIELDNUM. */
  fieldNum: number;
  type: FieldType;
  length: number;
  decimalPositions: number;
  /** Bit mask of {@link UseEdit}. */
  useEdit: number;
  /** Record name this field is keyed to for prompting, if any. */
  editTable?: string;
  defaultValue?: string;
  /** Longest label text from PSDBFLDLABL, for display only. */
  label?: string;
  /** True when the field is inherited from a subrecord rather than declared here. */
  fromSubrecord?: string;
}

/** PSRECDEFN.RECTYPE. */
/**
 * PSRECDEFN.RECTYPE. 5-7 read off HRDMO's delivered records (was 6-8):
 * 5 holds the *_DVW dynamic views (1,830), 6 the query views, 7 the *_TMP
 * temporary tables (1,292); no record has 8.
 */
export enum RecordType {
  Table = 0,
  View = 1,
  DerivedWork = 2,
  Subrecord = 3,
  DynamicView = 5,
  QueryView = 6,
  TemporaryTable = 7
}

export interface RecordDefinition {
  key: DefinitionKey;
  name: string;
  description: string;
  recordType: RecordType;
  fields: RecordField[];
  /** SQL text for view/dynamic-view records (PSRECTBLSPC / PSSQLTEXTDEFN). */
  viewSql?: string;
  /** Number of temp table instances, for RecordType.TemporaryTable. */
  tempTableInstances?: number;
  /** PSRECDEFN.VERSION — must be echoed back on save so PeopleTools invalidates caches. */
  version: number;
  auditRecord?: string;
}

export function hasFlag(useEdit: number, flag: UseEdit | UseEdit2): boolean {
  return (useEdit & flag) !== 0;
}

export function isKeyField(f: RecordField): boolean {
  return hasFlag(f.useEdit, UseEdit.Key);
}

export const FIELD_TYPE_LABELS: Readonly<Record<FieldType, string>> = {
  [FieldType.Character]: 'Character',
  [FieldType.LongCharacter]: 'Long Character',
  [FieldType.Number]: 'Number',
  [FieldType.SignedNumber]: 'Signed Number',
  [FieldType.Date]: 'Date',
  [FieldType.Time]: 'Time',
  [FieldType.DateTime]: 'DateTime',
  [FieldType.Image]: 'Image',
  [FieldType.ImageReference]: 'Image Reference'
};

/**
 * The attribute summary shown beside a field when a record is expanded.
 *
 * Mirrors the columns App Designer puts in its field grid: key membership
 * first, because that is what distinguishes one field from the next at a
 * glance, then type and length.
 */
export function describeField(f: RecordField): string {
  const parts: string[] = [];
  if (isKeyField(f)) parts.push('Key');
  parts.push(FIELD_TYPE_LABELS[f.type] ?? `Type ${f.type}`);
  parts.push(f.decimalPositions > 0 ? `${f.length}.${f.decimalPositions}` : String(f.length));
  return parts.join(' \u00b7 ');
}

/** PSRECDEFN.RECUSE: the Record Audit options (case r20-r23, one per save). */
export enum RecordAuditOption {
  Add = 1,
  Change = 2,
  Delete = 4,
  Selective = 8
}

/** PSRECDEFN.AUXFLAGMASK bits confirmed by App Designer cases. */
export enum RecordFlag {
  /** Record Information: Tools Table (r24). */
  ToolsTable = 0x10000,
  /** Record Information: Managed (r25). */
  Managed = 0x20000,
  /** Temporary Table: Global Temporary Table (GTT) (r31). */
  GlobalTemporaryTable = 0x400000,
  /** SQL View / Query View: Materialized View (r29; the five delivered views carrying it, e.g. ACA_MONTHLY_JOB). */
  MaterializedView = 0x1000000,
  /** Use tab: Oracle In-Memory, All Fields (r67). */
  InMemoryAllFields = 0x10000000,
  /** Use tab: Oracle In-Memory, Selective Fields (r71; and R6's All Fields, which held a CLOB, r65). */
  InMemorySelectiveFields = 0x20000000
}
