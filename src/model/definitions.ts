/**
 * PeopleTools definition types.
 *
 * The numeric values are the OBJECTTYPE codes used by PSPROJECTITEM, which is
 * also how App Designer project exports identify their contents. Keeping the
 * enum aligned with those codes means project XML and the database agree
 * without a translation table.
 */
export enum DefinitionType {
  Record = 0,
  Index = 1,
  Field = 2,
  TranslateValue = 3,
  Page = 4,
  Menu = 5,
  Component = 6,
  RecordPeopleCode = 8,
  MenuPeopleCode = 9,
  ComponentPeopleCode = 10,
  ComponentRecordPeopleCode = 11,
  PagePeopleCode = 12,
  ComponentInterface = 14,
  AppEngineProgram = 33,
  AppEnginePeopleCode = 40,
  ComponentInterfacePeopleCode = 42,
  ApplicationPackage = 44,
  ApplicationClassPeopleCode = 46,
  PageFieldPeopleCode = 47,
  SqlDefinition = 51,
  FileLayout = 53,
  FileLayoutPeopleCode = 58
}

/** Definition types whose payload is PeopleCode held in PSPCMPROG. */
export const PEOPLECODE_TYPES: ReadonlySet<DefinitionType> = new Set([
  DefinitionType.RecordPeopleCode,
  DefinitionType.MenuPeopleCode,
  DefinitionType.ComponentPeopleCode,
  DefinitionType.ComponentRecordPeopleCode,
  DefinitionType.PagePeopleCode,
  DefinitionType.AppEnginePeopleCode,
  DefinitionType.ComponentInterfacePeopleCode,
  DefinitionType.ApplicationClassPeopleCode,
  DefinitionType.PageFieldPeopleCode,
  DefinitionType.FileLayoutPeopleCode
]);

export function isPeopleCode(type: DefinitionType): boolean {
  return PEOPLECODE_TYPES.has(type);
}

/**
 * A definition's identity.
 *
 * PeopleTools keys every definition with up to seven positional key parts
 * (OBJECTID1/OBJECTVALUE1 .. OBJECTID7/OBJECTVALUE7). A record definition uses
 * one; a record-field PeopleCode program uses four; an application class
 * program uses as many as the package nesting requires. Rather than model each
 * type separately we carry the positional values and let each provider
 * interpret them, exactly as PSPROJECTITEM does.
 */
export interface DefinitionKey {
  readonly type: DefinitionType;
  /** Key values, in PeopleTools positional order, trailing blanks trimmed. */
  readonly parts: readonly string[];
}

export function makeKey(type: DefinitionType, ...parts: string[]): DefinitionKey {
  // PeopleTools pads unused key slots; drop them so equality is stable.
  const trimmed = [...parts];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
  return { type, parts: trimmed.map((p) => p.trim()) };
}

export function keyEquals(a: DefinitionKey, b: DefinitionKey): boolean {
  return a.type === b.type
    && a.parts.length === b.parts.length
    && a.parts.every((p, i) => p.toUpperCase() === b.parts[i].toUpperCase());
}

/** Stable string form, used for cache keys and as the URI path. */
export function keyToString(key: DefinitionKey): string {
  return `${key.type}:${key.parts.join('.')}`;
}

export function keyFromString(s: string): DefinitionKey {
  const sep = s.indexOf(':');
  if (sep < 0) throw new Error(`Malformed definition key: ${s}`);
  const type = Number(s.slice(0, sep));
  if (!(type in DefinitionType)) throw new Error(`Unknown definition type in key: ${s}`);
  const rest = s.slice(sep + 1);
  return { type, parts: rest === '' ? [] : rest.split('.') };
}

/** Human-readable name shown in trees and editor tabs. */
export function displayName(key: DefinitionKey): string {
  switch (key.type) {
    case DefinitionType.RecordPeopleCode:
      // RECORD.FIELD.EVENT — the middle "method" slot is always "GBL"/"1" noise.
      return key.parts.filter((p) => p !== 'GBL' && p !== '1').join('.');
    case DefinitionType.ApplicationClassPeopleCode:
      return key.parts.filter((p) => p !== 'OnExecute').join(':') || key.parts.join(':');
    default:
      return key.parts.join('.');
  }
}

export const TYPE_LABELS: Readonly<Record<DefinitionType, string>> = {
  [DefinitionType.Record]: 'Records',
  [DefinitionType.Index]: 'Indexes',
  [DefinitionType.Field]: 'Fields',
  [DefinitionType.TranslateValue]: 'Translate Values',
  [DefinitionType.Page]: 'Pages',
  [DefinitionType.Menu]: 'Menus',
  [DefinitionType.Component]: 'Components',
  [DefinitionType.RecordPeopleCode]: 'Record PeopleCode',
  [DefinitionType.MenuPeopleCode]: 'Menu PeopleCode',
  [DefinitionType.ComponentPeopleCode]: 'Component PeopleCode',
  [DefinitionType.ComponentRecordPeopleCode]: 'Component Record PeopleCode',
  [DefinitionType.PagePeopleCode]: 'Page PeopleCode',
  [DefinitionType.ComponentInterface]: 'Component Interfaces',
  [DefinitionType.AppEngineProgram]: 'App Engine Programs',
  [DefinitionType.AppEnginePeopleCode]: 'App Engine PeopleCode',
  [DefinitionType.ComponentInterfacePeopleCode]: 'Component Interface PeopleCode',
  [DefinitionType.ApplicationPackage]: 'Application Packages',
  [DefinitionType.ApplicationClassPeopleCode]: 'Application Classes',
  [DefinitionType.PageFieldPeopleCode]: 'Page Field PeopleCode',
  [DefinitionType.SqlDefinition]: 'SQL Definitions',
  [DefinitionType.FileLayout]: 'File Layouts',
  [DefinitionType.FileLayoutPeopleCode]: 'File Layout PeopleCode'
};

/** File extension used when a definition is surfaced through the virtual FS. */
export function fileExtension(type: DefinitionType): string {
  if (isPeopleCode(type)) return '.pcode';
  switch (type) {
    case DefinitionType.SqlDefinition: return '.pssql';
    case DefinitionType.Record: return '.psrecord';
    case DefinitionType.Field: return '.psfield';
    case DefinitionType.Page: return '.pspage';
    case DefinitionType.Component: return '.pscomponent';
    case DefinitionType.Menu: return '.psmenu';
    case DefinitionType.AppEngineProgram: return '.psae';
    default: return '.psdef';
  }
}
