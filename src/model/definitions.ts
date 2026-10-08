/**
 * PeopleTools definition types.
 *
 * These are the OBJECTTYPE codes used by PSPROJECTITEM and by the eObjectType
 * field of an App Designer project export.
 *
 * The values marked CONFIRMED were read off a real project export, or off
 * PSPROJECTITEM rows cross-checked one by one against the definition table
 * each type's name should exist in (e.g. an OBJECTTYPE 32 item's OBJECTVALUE1
 * was confirmed to name a row in PSBCDEFN, so 32 is Component Interface). The
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
  TranslateValue = 4,
  Page = 5,
  Menu = 6,
  Component = 7,
  RecordPeopleCode = 8,
  BusinessProcess = 17,
  Activity = 18,
  ComponentInterface = 32,
  AppEngineProgram = 33,
  /** PSPROJECTITEM 10, OBJECTIDs 30 / 25: a query, by name and owner (blank: public); 310 of 377 project items in PSQRYDEFN. */
  Query = 10,
  /** PSPROJECTITEM 56, OBJECTID1 103: a URL definition (59 of 66 in PSURLDEFN). */
  UrlDefinition = 56,
  /** PSPROJECTITEM 62, OBJECTIDs 65 / 81: XSLT, an SQL definition of SQLTYPE 6 (19 of 19 in PSSQLDEFN). */
  Xslt = 62,
  /** PSPROJECTITEM 35, OBJECTID1 62: an Integration Broker node (17 of 19 in PSMSGNODEDEFN). */
  MessageNode = 35,
  /** PSPROJECTITEM 55, OBJECTIDs 99 / 100 / 101: a portal registry folder or content reference -- portal, type (C / F), name (7,340 of 7,358 in PSPRSMDEFN). */
  PortalRegistry = 55,
  /** PSPROJECTITEM 49, OBJECTIDs 91 / 95: an image, name and alternate (1,918 of 2,069 in PSCONTDEFN, CONTTYPE 1). */
  Image = 49,
  /** PSPROJECTITEM 37, OBJECTID1 60: an Integration Broker message (768 of 851 in PSMSGDEFN). */
  IbMessage = 37,
  /** PSPROJECTITEM 79, OBJECTID1 138: a service (185 of 216 in PSSERVICE). */
  IbService = 79,
  /** PSPROJECTITEM 80, OBJECTID1 139: a service operation (510 of 563 in PSOPERATION). */
  IbServiceOperation = 80,
  /** PSPROJECTITEM 12, OBJECTIDs 34 / 68 / 36 / 21: a tree -- SetID, set control value, name, effective date (84 of 84 in PSTREEDEFN). */
  Tree = 12,
  /** PSPROJECTITEM 20, OBJECTIDs 29 / 28: a process definition, by process type and name (269 of 307 in PS_PRCSDEFN). */
  ProcessDefinition = 20,
  /** PSPROJECTITEM 19, OBJECTID1 32: a role (947 of 956 project items in PSROLEDEFN). */
  Role = 19,
  /** PSPROJECTITEM 25, OBJECTIDs 48 / 49: a Message Catalog entry, set and number (1,294 of 1,294 in PSMSGCATDEFN). */
  MessageCatalog = 25,
  /** PSPROJECTITEM 53, OBJECTID1 89: a permission list (67 of 71 in PSCLASSDEFN). */
  PermissionList = 53,
  /** PSPROJECTITEM OBJECTTYPE 34, OBJECTID1 66 / OBJECTID2 77 (program, section): 970 on HRDMO. */
  AppEngineSection = 34,
  AppEnginePeopleCode = 43,
  ComponentPeopleCode = 46,
  /**
   * PSPROJECTITEM 48, OBJECTIDs 10 / 39 / 1 / 2: component, market, record,
   * then the field (padded to 18) and the event in one value
   * ("SAVE_PB           FieldChange"); PSPCMPROG keys it 10 / 39 / 1 / 2 / 12.
   */
  ComponentRecordFieldPeopleCode = 48,
  /** PSPROJECTITEM 47, OBJECTIDs 10 / 39 / 1 / 12: component, market, record, event (488 on HRDMO). */
  ComponentRecordPeopleCode = 47,
  PagePeopleCode = 44,
  /** PSPROJECTITEM OBJECTTYPE 50, OBJECTID1 94 (STYLESHEETNAME): 295 on HRDMO, every one a PSSTYLSHEETDEFN name. */
  StyleSheet = 50,
  HtmlDefinition = 51,
  ApplicationPackage = 57,
  ApplicationClassPeopleCode = 58,
  OptimizationModel = 60,
  AnalyticModel = 73,
  FileLayout = 31,

  // UNCONFIRMED — not yet observed in a real export.
  Index = 1,
  MenuPeopleCode = 9,
  ComponentInterfacePeopleCode = 42,
  FileLayoutPeopleCode = 59,

  /**
   * PSPROJECTITEM OBJECTTYPE 30, OBJECTIDs 65 SQLID / 81 SQLTYPE: 7,205 items
   * on HRDMO, every SQLTYPE (0 SQL definitions, 1 App Engine action SQL, 2
   * view text, 6 XSLT). Keyed [SQLID] for SQLTYPE 0 -- the SQL definitions
   * this extension opens and saves -- else [SQLID, SQLTYPE]. (Before this
   * was established the type was the sentinel -1; keyFromString still reads
   * it.)
   */
  SqlDefinition = 30,

  /**
   * A project.
   *
   * Projects are not definitions in PSPROJECTITEM -- a project contains items,
   * it is not one -- so there is no OBJECTTYPE for them. A local sentinel lets
   * a project be searched and opened through the same path as everything else,
   * which is what makes "open a project" work from the Open Definition dialog.
   */
  Project = -2
}

/** Types whose key layout and code were verified against a real project export. */
export const CONFIRMED_TYPES: ReadonlySet<DefinitionType> = new Set([
  DefinitionType.Record,
  DefinitionType.Field,
  DefinitionType.TranslateValue,
  DefinitionType.Page,
  DefinitionType.Menu,
  DefinitionType.Component,
  DefinitionType.RecordPeopleCode,
  DefinitionType.BusinessProcess,
  DefinitionType.Activity,
  DefinitionType.ComponentInterface,
  DefinitionType.AppEngineProgram,
  DefinitionType.AppEnginePeopleCode,
  DefinitionType.ComponentPeopleCode,
  DefinitionType.ComponentRecordFieldPeopleCode,
  DefinitionType.PagePeopleCode,
  DefinitionType.HtmlDefinition,
  DefinitionType.ApplicationPackage,
  DefinitionType.ApplicationClassPeopleCode,
  DefinitionType.OptimizationModel,
  DefinitionType.AnalyticModel,
  DefinitionType.FileLayout
]);

/** Definition types whose payload is PeopleCode held in PSPCMPROG. */
export const PEOPLECODE_TYPES: ReadonlySet<DefinitionType> = new Set([
  DefinitionType.RecordPeopleCode,
  DefinitionType.PagePeopleCode,
  DefinitionType.ApplicationClassPeopleCode,
  DefinitionType.MenuPeopleCode,
  DefinitionType.ComponentPeopleCode,
  DefinitionType.ComponentRecordPeopleCode,
  DefinitionType.ComponentRecordFieldPeopleCode,
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
  let type = Number(s.slice(0, sep));
  if (!Number.isInteger(type)) throw new Error(`Malformed definition type in key: ${s}`);
  // SQL definitions were keyed -1 before their OBJECTTYPE (30) was established; old links still open.
  if (type === -1) type = DefinitionType.SqlDefinition;
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
    case DefinitionType.Field:
      // A field listed under a record carries the record as a second part
      // (see canExpand); the field is still named by itself.
      return key.parts[0] ?? '';
    case DefinitionType.Tree: {
      // SetID, set control value, name, effective date: named by the tree, with what tells versions apart.
      const [setid, setcntrl, name, effdt] = key.parts;
      return `${name ?? ''} (${[setid, setcntrl].filter((p) => p?.trim()).join(', ')}${setid?.trim() || setcntrl?.trim() ? ', ' : ''}${effdt ?? ''})`;
    }
    case DefinitionType.PortalRegistry:
      // Portal, type (C content reference / F folder), name.
      return key.parts.length > 2 ? `${key.parts[2]} (${key.parts[0]}${key.parts[1] === 'F' ? ' folder' : ''})` : key.parts.join('.');
    case DefinitionType.ProcessDefinition:
      // Keyed type then name; named as Process Scheduler lists them.
      return key.parts.length > 1 ? `${key.parts[1]} (${key.parts[0]})` : key.parts.join('.');
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
  [DefinitionType.StyleSheet]: 'Style Sheets',
  [DefinitionType.ApplicationPackage]: 'Application Packages',
  [DefinitionType.ApplicationClassPeopleCode]: 'Application Classes',
  [DefinitionType.Index]: 'Indexes',
  [DefinitionType.TranslateValue]: 'Translate Values',
  [DefinitionType.MenuPeopleCode]: 'Menu PeopleCode',
  [DefinitionType.ComponentPeopleCode]: 'Component PeopleCode',
  [DefinitionType.ComponentRecordPeopleCode]: 'Component Record PeopleCode',
  [DefinitionType.ComponentRecordFieldPeopleCode]: 'Component Record Field PeopleCode',
  [DefinitionType.ComponentInterface]: 'Component Interfaces',
  [DefinitionType.AppEngineProgram]: 'App Engine Programs',
  [DefinitionType.AppEngineSection]: 'App Engine Sections',
  [DefinitionType.Query]: 'Queries',
  [DefinitionType.ProcessDefinition]: 'Process Definitions',
  [DefinitionType.Tree]: 'Trees',
  [DefinitionType.Image]: 'Images',
  [DefinitionType.PortalRegistry]: 'Portal Registry Structures',
  [DefinitionType.UrlDefinition]: 'URL Definitions',
  [DefinitionType.Xslt]: 'XSLT',
  [DefinitionType.MessageNode]: 'Message Nodes',
  [DefinitionType.IbMessage]: 'Messages',
  [DefinitionType.IbService]: 'Services',
  [DefinitionType.IbServiceOperation]: 'Service Operations',
  [DefinitionType.Role]: 'Roles',
  [DefinitionType.MessageCatalog]: 'Message Catalog Entries',
  [DefinitionType.PermissionList]: 'Permission Lists',
  [DefinitionType.AppEnginePeopleCode]: 'App Engine PeopleCode',
  [DefinitionType.ComponentInterfacePeopleCode]: 'Component Interface PeopleCode',
  [DefinitionType.FileLayout]: 'File Layouts',
  [DefinitionType.FileLayoutPeopleCode]: 'File Layout PeopleCode',
  [DefinitionType.SqlDefinition]: 'SQL Definitions',
  [DefinitionType.Project]: 'Projects',
  [DefinitionType.BusinessProcess]: 'Business Processes',
  [DefinitionType.Activity]: 'Activities',
  [DefinitionType.OptimizationModel]: 'Optimization Models',
  [DefinitionType.AnalyticModel]: 'Analytic Models'
};

/**
 * A label for any type code, including ones not in the enum.
 *
 * A project export may legitimately contain type codes this extension has not
 * mapped. Showing "Type 63" is honest and still lets the items be browsed;
 * silently dropping them would make a project look smaller than it is.
 */
export function typeLabel(type: DefinitionType | number): string {
  return TYPE_LABELS[type as DefinitionType] ?? PROJECT_ITEM_LABELS[type] ?? `Type ${type}`;
}

/**
 * Names for project item types this extension lists but does not open:
 * each type's OBJECTVALUE1 found in the PeopleTools table that defines it,
 * for HRDMO's project items (queries 310 of 377 in PSQRYDEFN, roles 947 of
 * 956 in PSROLEDEFN, images 1,918 of 2,069 in PSCONTDEFN, message catalog
 * 1,294 of 1,294 ...; the rest name definitions not installed there).
 */
export const PROJECT_ITEM_LABELS: Readonly<Record<number, string>> = {
  3: 'Field Formats', 11: 'Tree Structures', 14: 'Colors', 15: 'Styles',
  21: 'Process Servers', 24: 'Recurrence Definitions'
};

/** File extension used when a definition is surfaced through the virtual FS. */
export function fileExtension(type: DefinitionType): string {
  if (isPeopleCode(type)) return '.peoplecode';
  switch (type) {
    case DefinitionType.SqlDefinition: return '.pssql';
    case DefinitionType.HtmlDefinition: return '.html';
    case DefinitionType.StyleSheet: return '.css';
    case DefinitionType.Record: return '.psrecord';
    case DefinitionType.Field: return '.psfield';
    case DefinitionType.Page: return '.pspage';
    case DefinitionType.Component: return '.pscomponent';
    case DefinitionType.Menu: return '.psmenu';
    case DefinitionType.AppEngineProgram:
    case DefinitionType.AppEngineSection: return '.psae';
    case DefinitionType.FileLayout: return '.psfl';
    case DefinitionType.Query: return '.psqry';
    case DefinitionType.ProcessDefinition: return '.psprcs';
    case DefinitionType.Tree: return '.pstree';
    case DefinitionType.IbMessage: return '.psmsgdefn';
    case DefinitionType.PortalRegistry: return '.psportal';
    case DefinitionType.UrlDefinition: return '.psurl';
    case DefinitionType.Xslt: return '.xsl';
    case DefinitionType.MessageNode: return '.psnode';
    case DefinitionType.IbService: return '.psservice';
    case DefinitionType.IbServiceOperation: return '.psoperation';
    case DefinitionType.Role: return '.psrole';
    case DefinitionType.MessageCatalog: return '.psmsg';
    case DefinitionType.PermissionList: return '.psperm';
    case DefinitionType.ComponentInterface: return '.psci';
    default: return '.psdef';
  }
}
