import {RELEASE_SUPPORT,toolReleaseSupport} from '../model/releaseSupport.js';
import { DefinitionType, typeLabel } from '../model/definitions.js';
import { TOOL_TREES, type ToolNode } from '../model/toolTrees.js';
import { DEFINITION_TYPE_GUIDE } from './definitionTypes.js';

// Describe the current product, including unavailable features. Reuse the UI
// inventory so adding a pane entry cannot silently hide it from MCP clients.
export const CONFIGURATION_GUIDES: Record<string, { tools: string[]; limitation?: string }> = {
  'Data Mover Scripts': { tools: [], limitation: 'Studio UI creates untitled scripts from templates. RichardWood.peoplesoft-datamover supplies language support when installed. No Data Mover execution or MCP authoring tool.' },
  'Promote Project to Another Environment…': { tools: ['psft_project_promote'], limitation: 'Oracle to a different Oracle environment (refused when database, container, schema and PeopleSoft GUID match): exports the project, previews the target and stages its exact changes in durable Change Review on the target; the developer approves and applies there, with migration undo/redo. Same export contract as Export Migration Package; no physical DDL or application data.' },
  'Import Migration Package…': { tools: [], limitation: 'Trusted Studio UI previews a definition migration package and stages its exact target changes in durable Change Review; the developer approves and applies there. No MCP import/apply tool; this is not Data Mover execution.' },
  'PS Query': { tools: ['psft_query_reference', 'psft_query_list', 'psft_query_get', 'psft_query_prepare', 'psft_query_run', 'psft_query_create', 'psft_query_save', 'psft_query_copy', 'psft_query_rename', 'psft_query_delete'], limitation: 'Oracle 8.62.09 query authoring calibrated against Windows Query: joins, subqueries, unions, aggregates/HAVING/DISTINCT, expressions, translates and effective dating (8.61.15: one record, one equal-to criterion); Query access checks apply. Delete and rename are review-only on 8.62.' },
  'Run and Monitor': { tools: ['psft_process_runtime_reference', 'psft_process_runtime_choices', 'psft_process_prepare_run', 'psft_process_submit_run', 'psft_process_run_list', 'psft_process_run_status', 'psft_process_run_reports', 'psft_process_report_read'], limitation: 'Oracle 8.62 Application Engine runtime via authenticated delivered PROCESSREQUEST. Existing operator run control, run now, Web/TXT; explicit per-run approval, no automatic retry after an uncertain response. Native/installed runtime acceptance is tracked separately.' },
  'Process Definitions': { tools: ['psft_search_definitions', 'psft_process_reference', 'psft_process_get', 'psft_process_save'], limitation: 'Existing definitions only; Oracle saves and rollback previews. These tools edit metadata; native runtime uses Run and Monitor.' },
  'Page and Field Configurator': { tools: ['psft_page_field_config_get', 'psft_page_field_config_fields', 'psft_page_field_config_save', 'psft_page_field_config_apply'], limitation: 'Standard and Masking saves; Change Tracking is read only. On 8.61 a save maps nothing; psft_page_field_config_apply maps it (Apply Configuration). Runtime application depends on EOCC Event Mapping.' },
  'Event Mapping': { tools: ['psft_event_mapping_reference', 'psft_event_mapping_get', 'psft_event_mapping_create_service', 'psft_event_mapping_save', 'psft_event_mapping_remove'] },
  'Drop Zones': { tools: ['psft_customization_discover', 'psft_drop_zone_get', 'psft_drop_zone_save'], limitation: 'Configure existing delivered drop zones; adding a drop zone to a delivered page changes that definition.' },
  'Message Catalog': { tools: ['psft_admin_reference', 'psft_admin_list', 'psft_admin_get', 'psft_admin_save'] },
  'Text Catalog': { tools: ['psft_admin_reference', 'psft_admin_choices', 'psft_admin_list', 'psft_admin_get', 'psft_admin_save'] },
  'URL Definitions': { tools: ['psft_admin_reference', 'psft_admin_list', 'psft_admin_get', 'psft_admin_save'] },
  'Structure & Content': { tools: ['psft_portal_list', 'psft_portal_structure', 'psft_portal_get', 'psft_portal_create_folder', 'psft_portal_create_content_reference', 'psft_portal_edit'] },
  ...Object.fromEntries(['Message Definitions', 'Document Definitions', 'Service', 'Service Operation', 'Nodes', 'Routes'].map(label => [label, { tools: ['psft_ib_reference', 'psft_ib_list', 'psft_ib_get', 'psft_ib_new', 'psft_ib_validate', 'psft_ib_create', 'psft_ib_save'] }])),
  ...Object.fromEntries(['Service','Service Operation'].map(label=>[label,{tools:['psft_ib_reference','psft_ib_list','psft_ib_get','psft_ib_definition_get','psft_ib_new','psft_ib_validate','psft_ib_create','psft_ib_save','psft_ib_delete']}])),
  OAuth: { tools: ['psft_security_reference', 'psft_security_list', 'psft_security_get', 'psft_oauth_save'], limitation: 'Configuration support does not test authentication. Secrets are excluded from reads.' },
  SAML: { tools: ['psft_security_reference', 'psft_security_list', 'psft_security_get'], limitation: 'Read only legacy inbound web service mapping; not browser SSO.' }
};

function describeNodes(nodes: readonly ToolNode[]): unknown[] {
  return nodes.map(node => ({
    label: node.label,
    releaseSupport: toolReleaseSupport(node.label,node.planned),
    studioStatus: node.planned ? 'PLANNED' : node.children ? 'GROUP' : 'AVAILABLE',
    ...(node.command ? { command: node.command } : {}),
    ...(node.children ? { children: describeNodes(node.children) } : CONFIGURATION_GUIDES[node.label] ?? {
      tools: [], limitation: node.planned ? 'Placeholder only; no implemented Studio or MCP workflow.' : 'No dedicated MCP workflow documented.'
    })
  }));
}

export function studioReference() {
  return {
    releaseSupport: RELEASE_SUPPORT,
    scope: 'Current Studio implementation. Tool names describe routing, not permission or verified availability on a particular database. Consult tools/list for this server session; write tools require a write host.',
    configurationTools: describeNodes(TOOL_TREES['psft.configurationTools'].nodes),
    dataMigrationTools: describeNodes(TOOL_TREES['psft.dataMigrationTools'].nodes),
    definitionTypes: Object.values(DefinitionType).filter((value): value is DefinitionType => typeof value === 'number').map(type => {
      const guide = DEFINITION_TYPE_GUIDE.find(entry => entry.type === type);
      return { type, label: typeLabel(type), ...(guide ?? {}),
        mcpAccess: guide ? 'Search/read via the definition tools; this does not imply create/edit/migration support.' : 'Not in the generic MCP definition guide; do not invent a key or assume generic search/read support.' };
    }),
    customizationStrategy: {
      workflow: ['Read psft_customization_get_policy for the effective settings.', 'Classify the target with psft_object_classify; prefixes alone are not proof of ownership.', 'Use psft_customization_discover for database evidence of available frameworks.', 'When configurationFirst is preferred, evaluate configuration and custom definitions before a delivered-object change.', 'Read the framework reference and current configuration; preview supported changes, save through the guarded tool, then read back.'],
      implemented: ['Evidence-based ownership, including delivered baselines and matching creation receipts', 'Separate human and agent delivered-object policies at the provider write guard', 'Event Mapping, Drop Zones and Page and Field Configurator discovery and configuration', 'Release-scoped discovery findings and knowledge evidence'],
      limits: ['defaultStrategy is a preference, not an enforced planning engine.', 'Configurable Search is discovered read only (configurations are not written); AE plug-in discovery is UNKNOWN.', 'Customization plans, customization registry and upgrade-impact analysis remain previews; do not claim they ran.', 'Knowledge evidence never grants write permission; local observations are not published verified knowledge.'],
      writeGates: 'Writable connection, Operator ID, write scope where applicable, MCP write mode, concurrency checks where supported, and agent delivered-object policy still apply. An agent cannot approve a user approval gate.'
    },
    configurationData: {
      principle: 'Configuration VALUES live in setup tables and are maintained by the people who own them, through a setup Component and its Pages. Building the setup record without the component that maintains it is an unfinished job: it leaves the only way in as raw INSERT/UPDATE or a Data Mover script, which is a migration and cutover tool, not how configuration is administered.',
      workflow: ['Create the setup record(s) with psft_create_record; key a child map by the parent setup key plus its own row key so it can be a level 1 grid.', 'Build the maintenance page with psft_page_create: the parent record\'s fields at level 0, each child map as a grid.', 'Build the component with psft_component_create over the parent setup record, with Add so the first configuration set can be created.', 'Register it (psft_menu_create / psft_menu_edit), give it navigation (psft_portal_create_content_reference) and grant it (psft_security_grant).', 'The administrator then enters the values online. Seed rows, where a first row is genuinely needed to run at all, are data for Data Mover or the project\'s own load step -- not the maintenance route.'],
      limits: 'Studio has no row-insert tool, deliberately: writing configuration rows directly would bypass the component\'s own validation, prompts, defaults and PeopleCode, and leaves no audit of who set a value. When an agent proposes configuration, the deliverable is the maintenance component, not INSERT statements.'
    },
    projectMigration: {
      tools: ['psft_project_migration_review', 'psft_project_export_migration', 'psft_project_preview_migration'],
      scope: 'Studio versioned definition packages: supported fields, SQL Table/Derived Work records, bounded Oracle standalone SQL with descriptions/comments/owner, full Application Engine documents, bounded HTML/freeform stylesheets, authoritative standalone/associated Record PeopleCode, bounded Oracle PS Queries, and scoped standard/popup menus with ItemSelected PeopleCode. Trusted UI import stages exact target changes and project membership in durable Change Review for developer approval. Preview compares target payloads and binds the target identity and concurrency tokens; import verifies complete readback. Unsupported members block export. Review is not complete dependency closure; preview does not apply changes.',
      limits: 'No MCP import/apply tool. Studio project packages are distinct from Data Mover data scripts and Data Migration Workbench; Studio creates Data Mover scripts from templates and uses RichardWood.peoplesoft-datamover for language support when installed; it does not run Data Mover. Data Migration Workbench remains planned.'
    },
    buildRequests: {
      tools: ['psft_build_request_list', 'psft_build_request_get', 'psft_build_request_read_attachment', 'psft_build_request_ask', 'psft_build_request_propose_spec', 'psft_build_request_report'],
      workflow: 'A developer assembles a request (narrative, attachments, kind, connection, project) in VS Code. Read it with psft_build_request_get and follow its workflow: ask questions, propose a build spec, stop for the developer\'s review; build only when buildAuthorized is true, reporting each object.',
      limits: 'Only the developer approves a spec, answers questions or edits the request, in VS Code. Approval lapses when the request or spec changes. These tools write the local request only; building uses the ordinary psft_* tools and all their gates. Objects without a catalog create/edit route are manual steps; pages, components, process definitions, permission list grants and File Layouts have tools.'
    },
    evidence: 'For release-specific claims use psft_knowledge_capability and psft_knowledge_evidence, and inspect the connected database. UNKNOWN and unsupported coverage must remain explicit.'
  };
}
