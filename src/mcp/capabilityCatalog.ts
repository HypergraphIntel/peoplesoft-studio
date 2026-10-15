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
  [D.Page]: { read: ['psft_get_page_layout', 'psft_get_page_structure'], edit: ['psft_edit_page'] },
  [D.Component]: { read: ['psft_get_component_structure'] },
  [D.Project]: { create: ['psft_create_project'], edit: ['psft_add_to_project'], migrate: ['psft_project_migration_review', 'psft_project_export_migration', 'psft_project_preview_migration'] },
  [D.ApplicationPackage]: { create: ['psft_create_package'], read: ['psft_list_children'] },
  [D.Query]: { search: ['psft_query_list'], read: ['psft_query_get'], create: ['psft_query_create'], edit: ['psft_query_save'], copy: ['psft_query_copy'], validate: ['psft_query_prepare'], execute: ['psft_query_run'] },
  [D.ProcessDefinition]: { read: ['psft_process_get'], edit: ['psft_process_save'] },
  [D.SqlDefinition]: { create: ['psft_save_text_definition'], edit: ['psft_save_text_definition'] },
  [D.HtmlDefinition]: { create: ['psft_save_text_definition'], edit: ['psft_save_text_definition'] },
  [D.StyleSheet]: { create: ['psft_save_text_definition'], edit: ['psft_save_text_definition'] },
  [D.PortalRegistry]: { read: ['psft_portal_get', 'psft_portal_structure'], create: ['psft_portal_create_folder', 'psft_portal_create_content_reference'], edit: ['psft_portal_edit'] },
  ...Object.fromEntries([D.AppEngineProgram, D.Menu, D.ComponentInterface, D.MessageChannel].map((type, i) => {
    const prefix = ['ae', 'menu', 'ci', 'channel'][i];
    return [type, { read: [`psft_${prefix}_get`], create: [`psft_${prefix}_create`], edit: [`psft_${prefix}_edit`], copy: [`psft_${prefix}_copy`], rename: [`psft_${prefix}_rename`], delete: [`psft_${prefix}_delete`], validate: [`psft_${prefix}_validate`] }];
  })),
  ...Object.fromEntries([D.MessageNode, D.IbMessage, D.IbService, D.IbServiceOperation, D.IbRouting, D.IbDocument].map(type => [type,
    { search: ['psft_ib_list'], read: ['psft_ib_get'], create: ['psft_ib_create'], edit: ['psft_ib_save'], validate: ['psft_ib_validate'] }])),
  ...Object.fromEntries([D.MessageCatalog, D.UrlDefinition].map(type => [type, { search: ['psft_admin_list'], read: ['psft_admin_get'], create: ['psft_admin_save'], edit: ['psft_admin_save'] }])),
  ...Object.fromEntries(authoredPeopleCode.map(type => [type, { create: ['psft_save_peoplecode'], edit: ['psft_save_peoplecode'] }]))
};

const CONSTRAINTS: Partial<Record<D, string[]>> = {
  [D.Query]: ['Oracle PeopleTools 8.62.09 authoring; one SQL Table record without subrecords, direct character fields, at most one ungrouped equal-to constant/prompt criterion.', 'Public or configured-operator private queries only; Query record access checked for prepare/run/save. No joins, unions, aggregates, row-security SQL, rename or delete.'],
  [D.ProcessDefinition]: ['Existing definitions only; saves on Oracle. No scheduling, execution, create/copy/rename/delete.', 'Complete editable properties and component/group arrays, concurrency token, installed translates and reference checks.'],
  [D.Record]: ['Writer-supported record shapes only; record metadata changes do not build or migrate physical tables or application data.'],
  [D.Field]: ['Only calibrated field types and attributes; migration adapters impose additional restrictions.'],
  [D.Page]: ['Bounded layout/property operations; no MCP page creation or complete page-designer parity asserted.'],
  [D.Component]: ['Structured reads only; component editing is not exposed through MCP.'],
  [D.StyleSheet]: ['Text saves support freeform style sheets only.'],
  [D.PortalRegistry]: ['Ordinary component/external content references and folders; advanced target kinds and existing properties are preserved rather than inferred.'],
  [D.AppEngineProgram]: ['Program definition authoring and validation only; no AE execution. Customization AE plug-in discovery remains UNKNOWN.']
};

const CONFIGURATION_MEANINGS: Record<string, { purpose: string; relationships: string[] }> = {
  'PS Query': { purpose: MEANINGS[D.Query].purpose, relationships: ['Record definitions', 'Query access trees and permission lists', 'Configured operator owns private queries'] },
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
  'Data Mover Scripts': { purpose: 'Planned workflow for PeopleSoft Data Mover scripts; no implementation or execution is exposed.', relationships: ['Application data migration; distinct from Studio definition packages'] },
  'Data Migration Workbench': { purpose: 'Planned workflow for Data Migration Workbench; no implementation is exposed.', relationships: ['Application configuration data migration; distinct from Studio definition packages'] }
};
const CONFIG_OPERATION_TOOLS: Partial<Record<Operation, string[]>> = {
  search: ['psft_search_definitions', 'psft_query_list', 'psft_admin_list', 'psft_portal_list', 'psft_ib_list', 'psft_security_list'],
  read: ['psft_process_get', 'psft_query_get', 'psft_page_field_config_get', 'psft_page_field_config_fields', 'psft_event_mapping_get', 'psft_drop_zone_get', 'psft_admin_get', 'psft_admin_choices', 'psft_portal_structure', 'psft_portal_get', 'psft_ib_get', 'psft_security_get'],
  create: ['psft_query_create', 'psft_event_mapping_create_service', 'psft_event_mapping_save', 'psft_page_field_config_save', 'psft_drop_zone_save', 'psft_admin_save', 'psft_portal_create_folder', 'psft_portal_create_content_reference', 'psft_ib_create'],
  edit: ['psft_process_save', 'psft_query_save', 'psft_page_field_config_save', 'psft_event_mapping_save', 'psft_drop_zone_save', 'psft_admin_save', 'psft_portal_edit', 'psft_ib_save', 'psft_oauth_save'],
  copy: ['psft_query_copy'], delete: ['psft_event_mapping_remove'],
  validate: ['psft_query_prepare', 'psft_ib_validate'], execute: ['psft_query_run']
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
        session: routes[op]?.length ? MUTATIONS.has(op) && !writeHostAvailable ? 'WRITE_HOST_REQUIRED' : 'CONSULT_TOOLS_LIST' : 'NOT_EXPOSED'
      }])),
      migration: [D.Field, D.Record, D.AppEngineProgram, D.AppEngineSection, D.AppEnginePeopleCode].includes(type)
        ? 'Supported package members only; record/field shapes are bounded and AE sections/PeopleCode travel with the program. No MCP import/apply tool.'
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
    schema: 'psft-capabilities/1', writeHostAvailable,
    scope: 'Implementation catalog, not database/release certification or authorization. BOUNDED means at least one routed tool exists, not full parity. tools/list is authoritative for this server session.',
    verification: { tools: ['psft_customization_get_policy', 'psft_object_classify', 'psft_customization_discover', 'psft_knowledge_capability', 'psft_knowledge_evidence'],
      note: 'Inspect effective policy and live database discovery. Use release-scoped knowledge evidence; local observations do not establish universal support.' },
    entries: entries.filter(entry => (!filter.kind || entry.kind === filter.kind) &&
      (filter.type === undefined || ('type' in entry && entry.type === filter.type)) && (!query || JSON.stringify(entry).toLowerCase().includes(query)))
  };
}
