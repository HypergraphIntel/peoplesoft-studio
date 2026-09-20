/**
 * PeopleTools definition types.
 *
 * These are the OBJECTTYPE codes used by PSPROJECTITEM and by the eObjectType
 * field of an App Designer project export.
 *
 * The values marked CONFIRMED were read off a real project export and
 * cross-checked against the definitions it carries: the export's item list and
 * its instance blocks agree on both the type code and the key layout. The
 * values marked UNCONFIRMED have not been seen in real data yet. Treat them as
 * provisional — an earlier revision of this file had several codes wrong
 * because they were written from memory, which put Pages under Menus and
 * Application Classes under File Layouts.
 *
 * Anything not listed here is handled as an unknown type rather than guessed
 * at; see {@link typeLabel}.
 */
export enum DefinitionType {
  // CONFIRMED
  Record = 0,
  Field = 2,
  Page = 5,
  Menu = 6,
  Component = 7,
  RecordPeopleCode = 8,
  PagePeopleCode = 44,
  HtmlDefinition = 51,
  ApplicationPackage = 57,
  ApplicationClassPeopleCode = 58,

  // UNCONFIRMED — not yet observed in a real export.
  Index = 1,
  TranslateValue = 3,
  MenuPeopleCode = 9,
  ComponentPeopleCode = 10,
  ComponentRecordPeopleCode = 11,
  ComponentInterface = 14,
  AppEngineProgram = 33,
  AppEnginePeopleCode = 40,
  ComponentInterfacePeopleCode = 42,
  FileLayout = 53,
  FileLayoutPeopleCode = 59,

  /**
   * SQL definitions have a real OBJECTTYPE code, but code 51 turned out to be
   * HTML definitions, so the value this once used was wrong and the correct one
   * is not yet known. A negative sentinel is used instead: it cannot collide
   * with a real code, and it is obviously not one.
   *
   * The database provider still reads and writes SQL definitions, because it
   * queries PSSQLDEFN by name rather than by OBJECTTYPE. Only SQL items inside
   * a project export are affected — they surface as an unknown type until the
   * real code is confirmed.
   */
  SqlDefinition = -1
}

/** Types whose key layout and code were verified against a real project export. */
export const CONFIRMED_TYPES: ReadonlySet<DefinitionType> = new Set([
  DefinitionType.Record,
  DefinitionType.Field,
  DefinitionType.Page,
  DefinitionType.Menu,
  DefinitionType.Component,
  DefinitionType.RecordPeopleCode,
  DefinitionType.PagePeopleCode,
  DefinitionType.HtmlDefinition,
  DefinitionType.ApplicationPackage,
  DefinitionType.ApplicationClassPeopleCode
]);

/** Definition types whose payload is PeopleCode held in PSPCMPROG. */
export const PEOPLECODE_TYPES: ReadonlySet<DefinitionType> = new Set([
  DefinitionType.RecordPeopleCode,
  DefinitionType.PagePeopleCode,
  DefinitionType.ApplicationClassPeopleCode,
  DefinitionType.MenuPeopleCode,
  DefinitionType.ComponentPeopleCode,
  DefinitionType.ComponentRecordPeopleCode,
  DefinitionType.AppEnginePeopleCode,
  DefinitionType.ComponentInterfacePeopleCode,
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
  if (!Number.isInteger(type)) throw new Error(`Malformed definition type in key: ${s}`);
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

export const TYPE_LABELS: Readonly<Partial<Record<DefinitionType, string>>> = {
  [DefinitionType.Record]: 'Records',
  [DefinitionType.Field]: 'Fields',
  [DefinitionType.Page]: 'Pages',
  [DefinitionType.Menu]: 'Menus',
  [DefinitionType.Component]: 'Components',
  [DefinitionType.RecordPeopleCode]: 'Record PeopleCode',
  [DefinitionType.PagePeopleCode]: 'Page PeopleCode',
  [DefinitionType.HtmlDefinition]: 'HTML Definitions',
  [DefinitionType.ApplicationPackage]: 'Application Packages',
  [DefinitionType.ApplicationClassPeopleCode]: 'Application Classes',
  [DefinitionType.Index]: 'Indexes',
  [DefinitionType.TranslateValue]: 'Translate Values',
  [DefinitionType.MenuPeopleCode]: 'Menu PeopleCode',
  [DefinitionType.ComponentPeopleCode]: 'Component PeopleCode',
  [DefinitionType.ComponentRecordPeopleCode]: 'Component Record PeopleCode',
  [DefinitionType.ComponentInterface]: 'Component Interfaces',
  [DefinitionType.AppEngineProgram]: 'App Engine Programs',
  [DefinitionType.AppEnginePeopleCode]: 'App Engine PeopleCode',
  [DefinitionType.ComponentInterfacePeopleCode]: 'Component Interface PeopleCode',
  [DefinitionType.FileLayout]: 'File Layouts',
  [DefinitionType.FileLayoutPeopleCode]: 'File Layout PeopleCode',
  [DefinitionType.SqlDefinition]: 'SQL Definitions'
};

/**
 * A label for any type code, including ones not in the enum.
 *
 * A project export may legitimately contain type codes this extension has not
 * mapped. Showing "Type 63" is honest and still lets the items be browsed;
 * silently dropping them would make a project look smaller than it is.
 */
export function typeLabel(type: DefinitionType | number): string {
  return TYPE_LABELS[type as DefinitionType] ?? `Type ${type}`;
}

/** File extension used when a definition is surfaced through the virtual FS. */
export function fileExtension(type: DefinitionType): string {
  if (isPeopleCode(type)) return '.peoplecode';
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
