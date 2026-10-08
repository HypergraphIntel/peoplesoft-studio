import {
  DefinitionType,
  typeLabel
} from '../model/definitions.js';

/**
 * The definition types an MCP caller can name, with the key parts each one
 * takes, in the order `parts` lists them. A caller that finds a definition
 * through psft_search_definitions gets its key back whole; this is for a
 * caller that builds a key itself.
 *
 * `databaseSearch` says whether a database connection can search the type
 * (DatabaseProvider.search). A project export searches whatever it contains.
 */
export interface DefinitionTypeGuide {
  type: DefinitionType;
  keyParts: readonly string[];
  databaseSearch: boolean;
  note?: string;
}

export const DEFINITION_TYPE_GUIDE: readonly DefinitionTypeGuide[] = [
  { type: DefinitionType.Project, keyParts: ['project'], databaseSearch: true, note: 'Not a PeopleTools OBJECTTYPE: a local code. psft_list_project_items lists its contents.' },
  { type: DefinitionType.Record, keyParts: ['record'], databaseSearch: true, note: 'Read as structured record metadata.' },
  { type: DefinitionType.Field, keyParts: ['field'], databaseSearch: true },
  { type: DefinitionType.Page, keyParts: ['page'], databaseSearch: true },
  { type: DefinitionType.Menu, keyParts: ['menu'], databaseSearch: true },
  { type: DefinitionType.Component, keyParts: ['component', 'market (GBL ...)'], databaseSearch: true },
  { type: DefinitionType.RecordPeopleCode, keyParts: ['record', 'field', 'event'], databaseSearch: true, note: 'Searched by record. psft_get_record_peoplecode reads a record\'s programs.' },
  { type: DefinitionType.MenuPeopleCode, keyParts: ['menu', 'bar', 'item', 'event'], databaseSearch: true },
  { type: DefinitionType.Query, keyParts: ['query'], databaseSearch: true, note: 'Public queries.' },
  { type: DefinitionType.Tree, keyParts: ['SetID (blank: " ")', 'set control value (blank: " ")', 'tree', 'effective date YYYY-MM-DD'], databaseSearch: true, note: 'Searched by tree name; every effective-dated version is listed.' },
  { type: DefinitionType.Role, keyParts: ['role'], databaseSearch: true },
  { type: DefinitionType.ProcessDefinition, keyParts: ['process type', 'process name'], databaseSearch: true, note: 'Searched by process name.' },
  { type: DefinitionType.MessageCatalog, keyParts: ['message set number', 'message number'], databaseSearch: true, note: 'The pattern matches a set ("1000"), a message ("1000.25") or the message text ("%NOT FOUND%").' },
  { type: DefinitionType.SqlDefinition, keyParts: ['SQL ID'], databaseSearch: true },
  { type: DefinitionType.FileLayout, keyParts: ['file layout'], databaseSearch: true },
  { type: DefinitionType.ComponentInterface, keyParts: ['component interface'], databaseSearch: true },
  { type: DefinitionType.AppEngineProgram, keyParts: ['program'], databaseSearch: true, note: 'Read as the program as text: sections, steps, actions, SQL and decoded PeopleCode.' },
  { type: DefinitionType.AppEngineSection, keyParts: ['program', 'section'], databaseSearch: true, note: 'The pattern matches the program ("BEN110") or program.section ("BEN110.M%").' },
  { type: DefinitionType.MessageNode, keyParts: ['node'], databaseSearch: true, note: 'Passwords are never read.' },
  { type: DefinitionType.IbMessage, keyParts: ['message'], databaseSearch: true },
  { type: DefinitionType.AppEnginePeopleCode, keyParts: ['program', 'section', 'market', 'platform (default ...)', 'effective date YYYY-MM-DD', 'step', 'OnExecute'], databaseSearch: true, note: 'Searched by program.' },
  { type: DefinitionType.PagePeopleCode, keyParts: ['page', 'event (Activate)'], databaseSearch: true },
  { type: DefinitionType.ComponentPeopleCode, keyParts: ['component', 'market', 'event'], databaseSearch: true, note: 'Searched by component. psft_get_component_peoplecode reads a component\'s programs.' },
  { type: DefinitionType.ComponentRecordPeopleCode, keyParts: ['component', 'market', 'record', 'event'], databaseSearch: true, note: 'Searched by component.' },
  { type: DefinitionType.ComponentRecordFieldPeopleCode, keyParts: ['component', 'market', 'record', 'field', 'event'], databaseSearch: true, note: 'Searched by component.' },
  { type: DefinitionType.Image, keyParts: ['image'], databaseSearch: true, note: 'Read as the image itself (PNG, GIF, JPEG, WebP) with its details.' },
  { type: DefinitionType.StyleSheet, keyParts: ['style sheet'], databaseSearch: true },
  { type: DefinitionType.HtmlDefinition, keyParts: ['HTML definition', '4'], databaseSearch: true },
  { type: DefinitionType.PermissionList, keyParts: ['permission list'], databaseSearch: true },
  { type: DefinitionType.PortalRegistry, keyParts: ['portal (EMPLOYEE ...)', 'C (content reference) or F (folder)', 'object name'], databaseSearch: true, note: 'Searched by object name.' },
  { type: DefinitionType.UrlDefinition, keyParts: ['URL ID'], databaseSearch: true },
  { type: DefinitionType.ApplicationPackage, keyParts: ['root package'], databaseSearch: true, note: 'psft_list_children lists its classes and subpackages.' },
  { type: DefinitionType.ApplicationClassPeopleCode, keyParts: ['package', '...subpackages', 'class'], databaseSearch: true, note: 'Searched by root package. psft_get_application_class reads a package\'s classes.' },
  { type: DefinitionType.Xslt, keyParts: ['SQL ID', '6'], databaseSearch: true },
  { type: DefinitionType.IbService, keyParts: ['service'], databaseSearch: true },
  { type: DefinitionType.IbServiceOperation, keyParts: ['service operation'], databaseSearch: true }
];

/** "0 Records, 2 Fields, ..." for a tool description. */
export function typeCodeSummary(): string {
  return DEFINITION_TYPE_GUIDE
    .map(guide => `${guide.type} ${typeLabel(guide.type)}`)
    .join(', ');
}
