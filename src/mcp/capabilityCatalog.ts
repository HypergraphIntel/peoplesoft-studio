import {RELEASE_SUPPORT,definitionReleaseSupport,toolReleaseSupport} from '../model/releaseSupport.js';
import { DefinitionType as D, typeLabel } from '../model/definitions.js';
import { TOOL_TREES, type ToolNode } from '../model/toolTrees.js';
import { DEFINITION_TYPE_GUIDE } from './definitionTypes.js';
import { CONFIGURATION_GUIDES, studioReference } from './studioReference.js';

type Operation = 'search' | 'read' | 'create' | 'edit' | 'copy' | 'rename' | 'delete' | 'validate' | 'execute' | 'migrate';
interface Meaning { purpose: string; relatedTypes: D[] }
// Exhaustive over the model: a new type needs an explanation, even if unsupported.
const MEANINGS: Record<D, Meaning> = {
  [D.Project]: { purpose: 'Groups definition memberships for development and migration.', relatedTypes: [] },
  [D.Record]: { purpose: 'Defines a record, its fields, keys and record-specific properties; physical storage depends on record type.', relatedTypes: [D.Field, D.Index, D.RecordPeopleCode] },
  [D.Field]: { purpose: 'Reusable field type, length, labels and attributes used by records.', relatedTypes: [D.Record, D.TranslateValue] },
  [D.Index]: { purpose: 'Record index definition; independent MCP key and editing workflow are not exposed.', relatedTypes: [D.Record, D.Field] },
  [D.TranslateValue]: { purpose: 'Effective-dated values and labels of a translate field.', relatedTypes: [D.Field, D.Record] },
  [D.Page]: { purpose: 'Classic or Fluid page controls, layout, record bindings, subpages and secondary pages.', relatedTypes: [D.Component, D.Record, D.PagePeopleCode] },
  [D.Menu]: { purpose: 'Menu bars/items that target components or Menu PeopleCode.', relatedTypes: [D.Component, D.MenuPeopleCode, D.PortalRegistry] },
  [D.Component]: { purpose: 'Pages and component-processing properties with component, record and field event programs.', relatedTypes: [D.Page, D.Record, D.ComponentPeopleCode, D.ComponentRecordPeopleCode, D.ComponentRecordFieldPeopleCode] },
  [D.Query]: { purpose: 'Public or private PS Query definition with selects, record/field references, criteria, expressions and prompts.', relatedTypes: [D.Record, D.Field, D.PermissionList, D.Role] },
  [D.Tree]: { purpose: 'Effective-dated tree hierarchy, nodes, leaves and structure; some trees supply Query access groups.', relatedTypes: [D.Record, D.PermissionList] },
  [D.BusinessProcess]: { purpose: 'Workflow Business Process definition; modeled identity does not imply an implemented viewer.', relatedTypes: [D.Activity] },
  [D.Activity]: { purpose: 'Workflow activity associated with a Business Process; dedicated MCP workflow is not exposed.', relatedTypes: [D.BusinessProcess] },
  [D.Role]: { purpose: 'Security role and its permission-list relationships.', relatedTypes: [D.PermissionList] },
  [D.PermissionList]: { purpose: 'Security permissions including component, process and Query access.', relatedTypes: [D.Role, D.Component, D.ProcessDefinition] },
  [D.ProcessDefinition]: { purpose: 'Process Scheduler definition: scheduling defaults, overrides, output, recovery, components and groups.', relatedTypes: [D.Component, D.AppEngineProgram] },
  [D.MessageCatalog]: { purpose: 'Numbered message text, severity and explanation in a message set.', relatedTypes: [] },
  [D.SqlDefinition]: { purpose: 'Reusable SQL text; project SQL types also distinguish AE SQL and view SQL.', relatedTypes: [D.Record, D.AppEngineProgram] },
  [D.FileLayout]: { purpose: 'File layout describing hierarchical file records and fields.', relatedTypes: [D.Record, D.FileLayoutPeopleCode] },
  [D.ComponentInterface]: { purpose: 'Programmatic component interface with keys, properties, collections, methods and Methods PeopleCode.', relatedTypes: [D.Component, D.ComponentInterfacePeopleCode] },
  [D.AppEngineProgram]: { purpose: 'Application Engine program with properties, state/temporary records, sections, steps and actions.', relatedTypes: [D.Record, D.AppEngineSection, D.AppEnginePeopleCode, D.SqlDefinition] },
  [D.AppEngineSection]: { purpose: 'Section of an AE program; variant identity also involves market, platform and effective date.', relatedTypes: [D.AppEngineProgram, D.AppEnginePeopleCode] },
  [D.MessageNode]: { purpose: 'Integration Broker node configuration and routing endpoint identity; secret material is excluded.', relatedTypes: [D.IbRouting, D.IbServiceOperation] },
  [D.MessageChannel]: { purpose: 'Integration Broker message channel/queue properties, messages and partition fields.', relatedTypes: [D.IbMessage, D.IbServiceOperation] },
  [D.IbMessage]: { purpose: 'Integration Broker message definition and versions used by operations.', relatedTypes: [D.Record, D.MessageChannel, D.IbDocument, D.IbServiceOperation] },
  [D.IbService]: { purpose: 'Integration Broker standard or REST service containing service operations.', relatedTypes: [D.IbServiceOperation] },
  [D.IbServiceOperation]: { purpose: 'Service operation with versions, messages and handlers; service kind and REST role matter.', relatedTypes: [D.IbService, D.IbMessage, D.IbRouting] },
  [D.IbRouting]: { purpose: 'Effective-dated service-operation routing between nodes.', relatedTypes: [D.IbServiceOperation, D.MessageNode, D.Xslt] },
  [D.IbDocument]: { purpose: 'Document schema identified by package, document and version; current authoring supports bounded flat documents.', relatedTypes: [D.IbMessage] },
  [D.Image]: { purpose: 'Image content used by pages and other definitions.', relatedTypes: [D.Page] },
  [D.StyleSheet]: { purpose: 'Style sheet used by page presentation; text authoring is limited to freeform sheets.', relatedTypes: [D.Page] },
  [D.HtmlDefinition]: { purpose: 'Stored HTML text referenced by application code.', relatedTypes: [D.ApplicationClassPeopleCode, D.RecordPeopleCode] },
  [D.PortalRegistry]: { purpose: 'Portal folders and content references with target, security and attributes.', relatedTypes: [D.Menu, D.Component, D.Role, D.PermissionList] },
  [D.UrlDefinition]: { purpose: 'Named URL and protocol properties; secret property values are excluded.', relatedTypes: [] },
  [D.ApplicationPackage]: { purpose: 'Hierarchy of packages/subpackages containing Application Classes.', relatedTypes: [D.ApplicationClassPeopleCode] },
  [D.Xslt]: { purpose: 'XSLT transformation stored as SQLTYPE 6, including Integration Broker transforms.', relatedTypes: [D.IbRouting] },
  [D.OptimizationModel]: { purpose: 'Optimization model; no dedicated MCP workflow currently documented.', relatedTypes: [] },
  [D.AnalyticModel]: { purpose: 'Analytic model referenced by analytic page controls; no dedicated MCP workflow currently documented.', relatedTypes: [D.Page] },
  [D.RecordPeopleCode]: { purpose: 'PeopleCode event program on a record field.', relatedTypes: [D.Record, D.Field] },
  [D.MenuPeopleCode]: { purpose: 'PeopleCode program on a menu bar item.', relatedTypes: [D.Menu] },
  [D.PagePeopleCode]: { purpose: 'Page event PeopleCode; generic save tool does not expose Page PeopleCode saves.', relatedTypes: [D.Page] },
  [D.ComponentPeopleCode]: { purpose: 'Component-level event PeopleCode.', relatedTypes: [D.Component] },
  [D.ComponentRecordPeopleCode]: { purpose: 'Component record event PeopleCode.', relatedTypes: [D.Component, D.Record] },
  [D.ComponentRecordFieldPeopleCode]: { purpose: 'Component record-field event PeopleCode.', relatedTypes: [D.Component, D.Record, D.Field] },
  [D.AppEnginePeopleCode]: { purpose: 'PeopleCode action on an AE step and section variant.', relatedTypes: [D.AppEngineProgram, D.AppEngineSection] },
  [D.ComponentInterfacePeopleCode]: { purpose: 'Component Interface Methods PeopleCode; use the CI key and reference, not an invented generic key.', relatedTypes: [D.ComponentInterface] },
  [D.ApplicationClassPeopleCode]: { purpose: 'Application Class source within a root package and optional subpackages.', relatedTypes: [D.ApplicationPackage] },
  [D.FileLayoutPeopleCode]: { purpose: 'Modeled File Layout PeopleCode code without a calibrated generic key shape.', relatedTypes: [D.FileLayout] }
};

const authoredPeopleCode = [D.RecordPeopleCode, D.MenuPeopleCode, D.ComponentPeopleCode, D.ComponentRecordPeopleCode,
  D.ComponentRecordFieldPeopleCode, D.AppEnginePeopleCode, D.ApplicationClassPeopleCode, D.ComponentInterfacePeopleCode];
const familyRoutes: Partial<Record<D, Partial<Record<Operation, string[]>>>> = {
  [D.Record]: { create: ['psft_create_record'], edit: ['psft_edit_record'], delete: ['psft_delete_record'] },
  [D.Field]: { create: ['psft_create_field'], edit: ['psft_edit_field'] },
  [D.TranslateValue]: { edit: ['psft_edit_translate'] },
  [D.Page]: { read: ['psft_get_page_layout', 'psft_get_page_structure'], create: ['psft_page_create'], edit: ['psft_edit_page'] },
  [D.Component]: { read: ['psft_get_component', 'psft_get_component_structure'], create: ['psft_component_create'], edit: ['psft_component_edit'] },
  [D.Project]: { create: ['psft_create_project'], edit: ['psft_add_to_project'], migrate: ['psft_project_related', 'psft_project_migration_review', 'psft_project_export_migration', 'psft_project_preview_migration'] },
  [D.ApplicationPackage]: { create: ['psft_create_package'], read: ['psft_list_children'] },
  [D.Query]: { search: ['psft_query_list'], read: ['psft_query_get'], create: ['psft_query_create'], edit: ['psft_query_save'], copy: ['psft_query_copy'], rename: ['psft_query_rename'], delete: ['psft_query_delete'], validate: ['psft_query_prepare'], execute: ['psft_query_run'] },
  [D.ProcessDefinition]: { read: ['psft_process_get'], create: ['psft_process_create'], edit: ['psft_process_save'], execute: ['psft_process_prepare_run', 'psft_process_submit_run'] },
  [D.PermissionList]: { edit: ['psft_security_grant'] },
  [D.FileLayout]: { read: ['psft_file_layout_get'], create: ['psft_file_layout_create'], edit: ['psft_file_layout_edit'], copy: ['psft_file_layout_copy'], rename: ['psft_file_layout_rename'], delete: ['psft_file_layout_delete'] },
  [D.SqlDefinition]: { create: ['psft_save_text_definition'], edit: ['psft_save_text_definition'] },
  [D.HtmlDefinition]: { create: ['psft_save_text_definition'], edit: ['psft_save_text_definition'] },
  [D.StyleSheet]: { create: ['psft_save_text_definition'], edit: ['psft_save_text_definition'] },
  [D.PortalRegistry]: { read: ['psft_portal_get', 'psft_portal_structure'], create: ['psft_portal_create_folder', 'psft_portal_create_content_reference'], edit: ['psft_portal_edit'] },
  ...Object.fromEntries([D.AppEngineProgram, D.Menu, D.ComponentInterface, D.MessageChannel].map((type, i) => {
    const prefix = ['ae', 'menu', 'ci', 'channel'][i];
    return [type, { read: [`psft_${prefix}_get`], create: [`psft_${prefix}_create`], edit: [`psft_${prefix}_edit`], copy: [`psft_${prefix}_copy`], rename: [`psft_${prefix}_rename`], delete: [`psft_${prefix}_delete`], validate: [`psft_${prefix}_validate`], ...(i === 0 ? { execute: ['psft_process_prepare_run', 'psft_process_submit_run'] } : {}) }];
  })),
  ...Object.fromEntries([D.MessageNode, D.IbMessage, D.IbService, D.IbServiceOperation, D.IbRouting, D.IbDocument].map(type => [type,
    { search: ['psft_ib_list'], read: ['psft_ib_get'], create: ['psft_ib_create'], edit: ['psft_ib_save'], validate: ['psft_ib_validate'] }])),
  ...Object.fromEntries([D.IbService,D.IbServiceOperation].map(type=>[type,{search:['psft_ib_list'],read:['psft_ib_get','psft_ib_definition_get'],create:['psft_ib_create'],edit:['psft_ib_save'],delete:['psft_ib_delete'],validate:['psft_ib_validate']}])),
  ...Object.fromEntries([D.MessageCatalog, D.UrlDefinition].map(type => [type, { search: ['psft_admin_list'], read: ['psft_admin_get'], create: ['psft_admin_save'], edit: ['psft_admin_save'] }])),
  ...Object.fromEntries(authoredPeopleCode.map(type => [type, { create: ['psft_save_peoplecode'], edit: ['psft_save_peoplecode'] }]))
};

const CONSTRAINTS: Partial<Record<D, string[]>> = {
  [D.Project]: ['On Oracle with Change Review, psft_create_project stages a new project and explicit Record, Field, SQL and AE program/section/PeopleCode members. Calibrated create/membership writers share one transaction, including rollback preview; proposed existence assumptions are preview-only and require declared dependencies. Fixed noncredential checkpoints exclude target credentials. No credential freshness, existing-project edits, automatic related closure or creation undo is certified. Other project operations retain legacy gates. New creation review has local fixture evidence; installed native acceptance remains pending.'],
  ...Object.fromEntries([D.IbService, D.IbServiceOperation].map(type => [type, ['With Oracle Change Review, existing service/operation headers and bounded structural edits use fixed noncredential checkpoints and exact native rollback previews. Existing REST URI template text preserves ordered variables and mappings. Paired ApplicationClass REQUESTHDLR/OnRequest removal and marker-bound recreation are calibrated on 8.62.09 only. psft_ib_create stages empty standard or REST services and single-version synchronous operations on 8.62.09 (REST with URI templates and their writer-generated routing); psft_ib_definition_get supplies their complete checkpoint/token and psft_ib_delete stages review-only deletion. Typed inverse/redo binds native root/version/handler markers, the REST routing tombstone, references, cache movement and owning-service resave. The owning service must exist and is explicitly authorized; overlapping parent scopes require separate Change Sets. Credentials, manual routings, translations, runtime/deployment rows and wider shapes refuse. Other creations/edits retain legacy gates outside explicit Change Sets. Local native replay and production HTTP/UI fixture coverage are separate from installed acceptance; consult IB_STRUCTURE.md for current release evidence.']])),
  [D.Record]: ['With Oracle Change Review, psft_edit_record stages only description/definition-text edits on existing SQL Table and Derived/Work records. Full six-table preservation snapshots, exact rollback preview and locked native token checks apply. Related Language referrers are refused. Other existing Record edits retain legacy gates outside a Change Set. psft_create_record stages new Derived/Work records with existing fields and no subrecords: complete vacant-scope checks, rollback previews and exact precommit after-image checks. SQL Table creation and deletion retain legacy gates. Calibrated Derived/Work creation deletion/recreation and combined continuation inverse/redo have separate native and installed HRDMO acceptance. Physical DDL/data and general field-removal reversal remain unsupported.'],
  [D.AppEngineProgram]: ['With Oracle Change Review, psft_ae_edit stages only existing-program description/comments edits, preserving twenty native tables including SQL, PeopleCode and tombstones. Existing validators and an actual rollback preview prove exact equivalence. Other existing AE edit operations retain legacy gates outside a Change Set; copy/rename/delete remain legacy. psft_ae_create stages new programs with full vacant-scope checks, rollback previews and exact precommit after-image checks. Explicit same-set dependencies supply proposed Record/SQL/AE references for validation; application requires their live verified persistence. Calibrated AE creation deletion/recreation and combined continuation inverse/redo have separate native and installed HRDMO acceptance. General structural reversal remains unsupported. Separate Run and Monitor tools expose bounded Oracle 8.62 Application Engine runtime through the delivered PROCESSREQUEST service, with operator sign-in and explicit per-run confirmation; runtime is not reversible metadata review. Native/installed runtime acceptance is tracked in docs/PROCESS_SCHEDULER_RUNTIME.md. Customization AE plug-in availability remains UNKNOWN.'],
  [D.Query]: ['Oracle PeopleTools 8.62.09 and 8.61.15 authoring (other patches of those releases when their query tables match); SQL Table records without subrecords. 8.61.15: one record, character fields and at most one equal-to constant/prompt criterion. 8.62.09, calibrated against Windows Query saves and its SQL: character, number and date fields; criteria with AND/OR, NOT, grouping and every comparison, like, null, in-list, between, exists and effective-date operator (constants, field comparison, prompts, lists, expressions, IN/EXISTS subqueries with correlation); standard, left outer and related-record joins; aggregates with derived GROUP BY, HAVING and DISTINCT; expression columns; translate short/long values; unions; the default effective-date criterion on a new effective-dated query.', 'Public or configured-operator private queries only; Query record access checked for prepare/run/save. Delete and rename (copy plus reviewed delete) are review-only Change Review operations on 8.62. No row-security SQL, nested subqueries, subqueries with unions or effective-dated subquery/union records.'],
  [D.ProcessDefinition]: ['Edit (staged in Change Review) and create (psft_process_create, Add-mode defaults then the same writer; legacy per-write confirmation) on Oracle. No metadata copy/rename/delete. Separate runtime tools prepare/submit native Application Engine requests on Oracle 8.62 with operator authentication and explicit per-run confirmation; uncertain outcomes never auto-retry.', 'Complete editable properties and component/group arrays, concurrency token, installed translates and reference checks.'],
  [D.Field]: ['Only calibrated field types and attributes; migration adapters impose additional restrictions.'],
  [D.Page]: ['Bounded layout/property operations; psft_page_create creates a classic page from the same operations (legacy per-write confirmation, not Change Review). No complete page-designer parity asserted.', 'dryRun executes the shared writer/verification then rolls back; includeSnapshots returns scoped native before/after rows with full CLOB text. expectedVersion rejects stale input. With Change Review on Oracle, existing-control move/resize, labels/use and description/comments stage exact native proposals. Other Page operations/saveInvalid are refused for staging; other platforms and servers without Change Review retain legacy gates. Static Text does not support Display Only/Invisible. One native description apply/inverse is verified; valid control-type/native visual acceptance remains pending.'],
  [D.FileLayout]: ['Create, edit, copy, rename and delete on Oracle with the App Designer-proven writer (captures fl01-fl15; App Designer reopened and saved a writer-made layout, nfl01). Legacy per-write confirmation; no Change Review adapter. File Layout PeopleCode is not authored here.'],
  [D.Component]: ['Create and edit pages and Use-tab properties on the App Designer-proven component writer; Internet/Fluid/Style tabs are left as stored (defaults on create). Legacy per-write confirmation; no Change Review adapter. Menu registration is psft_menu_edit; security is separate.'],
  ...Object.fromEntries([D.SqlDefinition,D.HtmlDefinition,D.StyleSheet].map(type=>[type,['On Oracle PeopleTools 8.62, portable text saves stage complete sql-definition/html-definition/stylesheet-definition checkpoints with native tokens. Guarded creation inverse and freshly reviewed redo preserve supported metadata and native deletion markers; SQL includes description, complete comments and owner. HTML/style scope is plain HTML and freeform sheets with supported default auxiliary metadata. Known project, metadata and stored-source mentions can block deletion, including comments; dynamic references remain unknown. Older partial history remains readable and retains its original reversal limits. No direct agent approval or apply tool exists. Other releases/nonportable existing edits retain legacy save gates and history scope.']])),
  [D.PortalRegistry]: ['Ordinary component/external content references and folders; advanced target kinds and existing properties are preserved rather than inferred.'],
};

const CONFIGURATION_MEANINGS: Record<string, { purpose: string; relationships: string[] }> = {
  'PS Query': { purpose: MEANINGS[D.Query].purpose, relationships: ['Record definitions', 'Query access trees and permission lists', 'Configured operator owns private queries'] },
  'Run and Monitor': { purpose: 'Submit Application Engine requests through native PROCESSREQUEST, monitor native status and inspect authorized logs/output.', relationships: ['Process Definition', 'Existing operator run control', 'Scheduler server', 'Native process instance', 'Report repository', 'Explicit per-run confirmation'] },
  'Process Definitions': { purpose: MEANINGS[D.ProcessDefinition].purpose, relationships: ['Process type', 'Server/category', 'Recurrence', 'Component associations', 'Process groups', 'Recovery process'] },
  'Page and Field Configurator': { purpose: 'Configure component pages and fields without changing delivered definitions.', relationships: ['Component and market', 'Criteria and sequences', 'Page-field placement keys', 'EOCC Event Mapping on content references'] },
  'Event Mapping': { purpose: 'Map custom Application Class services into component, record, field or page event processing.', relationships: ['Component content reference', 'Application Class service', 'Event level and processing sequence'] },
  'Drop Zones': { purpose: 'Insert a custom subpage into an existing delivered page drop zone at runtime.', relationships: ['Component pages', 'Drop-zone placement key', 'Custom subpage', 'Related Content configuration'] },
  'Message Catalog': { purpose: MEANINGS[D.MessageCatalog].purpose, relationships: ['Message set and message number', 'Language-specific message text'] },
  'Text Catalog': { purpose: 'Maintain HCM Text Catalog entries and translations using installed owner/sub-ID configuration.', relationships: ['Owner and sub-ID', 'Text ID', 'Effective date', 'Six context keys', 'Language'] },
  'URL Definitions': { purpose: MEANINGS[D.UrlDefinition].purpose, relationships: ['URL ID', 'Protocol properties'] },
  'Structure & Content': { purpose: MEANINGS[D.PortalRegistry].purpose, relationships: ['Selected portal', 'Parent folder', 'Component or external target', 'Roles and permission lists', 'Registry cache'] },
  'Message Definitions': { purpose: MEANINGS[D.IbMessage].purpose, relationships: ['Message versions', 'Record or document schema', 'Service operations'] },
  'Document Definitions': { purpose: MEANINGS[D.IbDocument].purpose, relationships: ['Package/document/version', 'Logical and serialized schemas', 'Messages'] },
  Service: { purpose: MEANINGS[D.IbService].purpose, relationships: ['Standard versus REST', 'REST consumer versus provider', 'Service operations'] },
  'Service Operation': { purpose: MEANINGS[D.IbServiceOperation].purpose, relationships: ['Owning service', 'Messages', 'Version', 'Handlers', 'Routings'] },
  Nodes: { purpose: MEANINGS[D.MessageNode].purpose, relationships: ['Service operations', 'Routing endpoints'] },
  Routes: { purpose: MEANINGS[D.IbRouting].purpose, relationships: ['Effective date', 'Operation/version', 'Sending and receiving nodes', 'Transforms'] },
  OAuth: { purpose: 'Inspect OAuth public configuration and edit calibrated existing applications.', relationships: ['Application and authorization server', 'Application type and grant', 'Audiences', 'Roles', 'Secrets excluded'] },
  SAML: { purpose: 'Inspect legacy inbound web-service SAML mapping; browser SSO is outside current support.', relationships: ['Certificate alias', 'Issuer', 'Subject', 'Qualifier'] },
  'Data Mover Scripts': { purpose: 'Creates untitled Data Mover scripts from templates in Studio, with language support from RichardWood.peoplesoft-datamover when installed. Studio does not run Data Mover.', relationships: ['Application data migration; distinct from Studio definition packages'] },
  'Data Migration Workbench': { purpose: 'Planned workflow for Data Migration Workbench; no implementation is exposed.', relationships: ['Application configuration data migration; distinct from Studio definition packages'] }
};
const CONFIG_OPERATION_TOOLS: Partial<Record<Operation, string[]>> = {
  search: ['psft_search_definitions', 'psft_query_list', 'psft_admin_list', 'psft_portal_list', 'psft_ib_list', 'psft_security_list'],
  read: ['psft_process_runtime_choices', 'psft_process_run_list', 'psft_process_run_status', 'psft_process_run_reports', 'psft_process_report_read', 'psft_process_get', 'psft_query_get', 'psft_page_field_config_get', 'psft_page_field_config_fields', 'psft_event_mapping_get', 'psft_drop_zone_get', 'psft_admin_get', 'psft_admin_choices', 'psft_portal_structure', 'psft_portal_get', 'psft_ib_get', 'psft_ib_definition_get', 'psft_security_get'],
  create: ['psft_query_create', 'psft_event_mapping_create_service', 'psft_event_mapping_save', 'psft_page_field_config_save', 'psft_drop_zone_save', 'psft_admin_save', 'psft_portal_create_folder', 'psft_portal_create_content_reference', 'psft_ib_create'],
  edit: ['psft_process_save', 'psft_query_save', 'psft_page_field_config_save', 'psft_page_field_config_apply', 'psft_event_mapping_save', 'psft_drop_zone_save', 'psft_admin_save', 'psft_portal_edit', 'psft_ib_save', 'psft_oauth_save'],
  copy: ['psft_query_copy'], delete: ['psft_event_mapping_remove', 'psft_ib_delete'],
  validate: ['psft_query_prepare', 'psft_ib_validate'], execute: ['psft_query_run', 'psft_process_prepare_run', 'psft_process_submit_run']
};

const OPS: Operation[] = ['search', 'read', 'create', 'edit', 'copy', 'rename', 'delete', 'validate', 'execute', 'migrate'];
const MUTATIONS = new Set<Operation>(['create', 'edit', 'copy', 'rename', 'delete']);
export interface CatalogFilter { kind?: 'definition' | 'configuration' | 'dataMigration' | 'strategy' | 'projectMigration'; type?: number; query?: string }
export function capabilityCatalog(filter: CatalogFilter = {}, writeHostAvailable = false) {
  const definitions = Object.entries(MEANINGS).map(([code, meaning]) => {
    const type = Number(code) as D, guide = DEFINITION_TYPE_GUIDE.find(entry => entry.type === type);
    const routes: Partial<Record<Operation, string[]>> = {
      ...(guide?.databaseSearch ? { search: ['psft_search_definitions'] } : {}),
      ...(guide ? { read: ['psft_get_definition'] } : {}),
      ...([D.Field, D.Record, D.AppEngineProgram, D.AppEngineSection, D.AppEnginePeopleCode].includes(type) ? { migrate: ['psft_project_migration_review', 'psft_project_export_migration', 'psft_project_preview_migration'] } : {}), ...familyRoutes[type]
    };
    return {
      id: `definition:${type}`, kind: 'definition', type, label: typeLabel(type), ...meaning,
      constraints: CONSTRAINTS[type] ?? ['Bounded tool schemas and shared provider validators define supported shapes; generic read support does not imply authoring parity.'],
      releaseEvidence: { status: 'NOT_CHECKED_FOR_CONNECTION', sources: type === D.Query ? ['src/test/fixtures/query', 'docs/PS_QUERY_WINDOWS.md'] : ['src/mcp', 'src/providers'], lookup: ['psft_knowledge_capability', 'psft_knowledge_evidence'] },
      keyParts: guide?.keyParts ?? null, keyNote: guide?.note ?? 'Consult the dedicated tool reference; no generic key shape is asserted.',
      operations: Object.fromEntries(OPS.map(op => [op, {
        status: routes[op]?.length ? 'BOUNDED' : 'NOT_EXPOSED', tools: routes[op] ?? [],
        releaseSupport: definitionReleaseSupport(type,op,!!routes[op]?.length),
        session: routes[op]?.length ? (MUTATIONS.has(op)||!!routes[op]?.includes('psft_process_submit_run')) && !writeHostAvailable ? 'WRITE_HOST_REQUIRED' : 'CONSULT_TOOLS_LIST' : 'NOT_EXPOSED'
      }])),
      migration: [D.Field, D.Record, D.AppEngineProgram, D.AppEngineSection, D.AppEnginePeopleCode, D.SqlDefinition, D.HtmlDefinition, D.StyleSheet, D.Query, D.Menu,
        D.Page, D.Component, D.ApplicationPackage, D.ApplicationClassPeopleCode, D.RecordPeopleCode, D.PagePeopleCode, D.ComponentPeopleCode, D.ComponentRecordPeopleCode,
        D.ComponentRecordFieldPeopleCode, D.MenuPeopleCode, D.Project].includes(type)
        ? 'Supported package members with bounded shapes (docs/PROJECT_MIGRATION.md); AE sections/PeopleCode travel with the program, a package carries its classes, a record its PeopleCode. Import stages reviewed Change Review proposals and applied migrations can be undone/redone through calibrated deletion writers. No MCP import/apply tool.'
        : 'No Studio migration package adapter asserted for this type.',
      evidence: ['src/model/definitions.ts', 'src/mcp/definitionTypes.ts', 'src/mcp', 'docs/PROJECT_MIGRATION.md']
    };
  });
  const nodes = (items: readonly ToolNode[], kind: 'configuration' | 'dataMigration', parent: string[] = []): { id: string; kind: string; label: string; [key: string]: unknown }[] => items.flatMap(node => {
    const path = [...parent, node.label];
    if (node.children) return nodes(node.children, kind, path);
    const guide = CONFIGURATION_GUIDES[node.label];
    return [{ id: `${kind}:${path.join('/')}`, kind, label: node.label, path,
      studioStatus: node.planned ? 'PLANNED' : 'AVAILABLE', tools: guide?.tools ?? [],
      releaseSupport: toolReleaseSupport(node.label,node.planned),
      ...(CONFIGURATION_MEANINGS[node.label] ?? { purpose: 'New pane entry requires capability documentation.', relationships: [] }),
      operations: Object.fromEntries(OPS.map(op => {
        const tools = (guide?.tools ?? []).filter(tool => CONFIG_OPERATION_TOOLS[op]?.includes(tool));
        return [op, { status: tools.length ? 'BOUNDED' : 'NOT_EXPOSED', tools,
          session: tools.length ? MUTATIONS.has(op) && !writeHostAvailable ? 'WRITE_HOST_REQUIRED' : 'CONSULT_TOOLS_LIST' : 'NOT_EXPOSED' }];
      })),
      limitation: guide?.limitation ?? (node.planned ? 'Not implemented.' : 'Use the corresponding reference and live tools/list for bounded operation support.'),
      releaseEvidence: { status: 'NOT_CHECKED_FOR_CONNECTION', lookup: ['psft_knowledge_capability', 'psft_knowledge_evidence'] },
      evidence: ['src/model/toolTrees.ts', 'src/mcp/studioReference.ts'] }];
  });
  const reference = studioReference();
  const entries = [...definitions, ...nodes(TOOL_TREES['psft.configurationTools'].nodes, 'configuration'),
    ...nodes(TOOL_TREES['psft.dataMigrationTools'].nodes, 'dataMigration'),
    { id: 'strategy:customization', kind: 'strategy', label: 'Customization Strategy', ...reference.customizationStrategy },
    { id: 'migration:projects', kind: 'projectMigration', label: 'Studio project migration', ...reference.projectMigration }];
  const query = filter.query?.trim().toLowerCase();
  return {
    schema: 'psft-capabilities/1', writeHostAvailable, releaseSupport: RELEASE_SUPPORT,
    scope: 'Implementation catalog, not database/release certification or authorization. BOUNDED means at least one routed tool exists, not full parity. tools/list is authoritative for this server session.',
    verification: { tools: ['psft_customization_get_policy', 'psft_object_classify', 'psft_customization_discover', 'psft_knowledge_capability', 'psft_knowledge_evidence'],
      note: 'Inspect effective policy and live database discovery. Use release-scoped knowledge evidence; local observations do not establish universal support.' },
    entries: entries.filter(entry => (!filter.kind || entry.kind === filter.kind) &&
      (filter.type === undefined || ('type' in entry && entry.type === filter.type)) && (!query || JSON.stringify(entry).toLowerCase().includes(query)))
  };
}
