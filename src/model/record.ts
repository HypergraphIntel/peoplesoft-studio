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

/** Bit flags in PSRECFIELD.USEEDIT. */
export enum UseEdit {
  Key = 0x0001,
  DuplicateOrderKey = 0x0002,
  SystemMaintained = 0x0004,
  AuditFieldAdd = 0x0008,
  AltSearchKey = 0x0010,
  ListBoxItem = 0x0020,
  Required = 0x0040,
  Reasonable = 0x0080,
  TranslateTable = 0x0100,
  DescendingKey = 0x0200,
  SearchKey = 0x0800,
  AuditFieldChange = 0x1000,
  AuditFieldDelete = 0x2000,
  FromSearchField = 0x4000,
  ThroughSearchField = 0x8000
}

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
export enum RecordType {
  Table = 0,
  View = 1,
  DerivedWork = 2,
  Subrecord = 3,
  DynamicView = 6,
  QueryView = 7,
  TemporaryTable = 8
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

export function hasFlag(useEdit: number, flag: UseEdit): boolean {
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
