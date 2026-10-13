import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import {
  describeMapping, EVENT_LEVEL_LABELS, EVENTS_BY_LEVEL, eventLabel, PROCESSING_LABELS, validateConfigRows, type EventMappingConfigRow
} from '../model/eventMapping.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, DESTRUCTIVE, GATES, READ_ONLY, WRITE, writable, type McpWriteHost } from './writeTools.js';

/*
 * Event Mapping configurations through the MCP (docs/CUSTOMIZATION.md
 * "Writing Event Mapping"): read and saved as the Configure Event Mapping
 * page lists and saves them (providers/eventMappingWriter.ts), proven
 * against the page's own saves on HRDMO.
 */

export const EVENT_MAPPING_REFERENCE = `Event Mapping, as PeopleTools' Configure Event Mapping page saves it (docs/CUSTOMIZATION.md):
- A configuration hangs off a content reference -- the component's registration in the portal registry (psft_customization_discover lists them) -- not the component, so Oracle's component definitions stay untouched.
- Each row maps one event to a related content service of URL type Application Class (PeopleTools > Portal > Related Content Service > Define Related Content Service), whose class extends PT_RCF:ServiceInterface and overrides execute().
- Levels and their events: C Component (PRE PreBuild, POST PostBuild, SPRE SavePreChange, SPOS SavePostChange, WFLO Workflow); R Page with a page (PACT Activate); P Record with a record (RINI RowInit, RINS RowInsert, RSEL RowSelect, RDEL RowDelete, SEDT SaveEdit, SPRE, SPOS, SINT SearchInit, SSVE SearchSave); F Record Field with a record and field (RFCH FieldChange, RFDT FieldDefault, RFED FieldEdit, SINT, SSVE).
- Processing: PRE runs before the delivered PeopleCode for the event, POST after it, OVER instead of it. Sequence orders several services on one event. A row can be disabled.
- The Event Map Parameter is passed to the service (EV_PARAM); the page uppercases it.
- The page offers the component's own pages, records and fields; Unrestricted Prompt (not stored) offers any -- the save warns when a row reaches outside the component.
- Save is the whole grid: rows keep their instanceId; a row left out is deleted; a row without instanceId is added. A saved row's level and service cannot change (remove it and add one). Every Save re-saves every row (Oracle's too: restamped as the page restamps them).`;

const row = z.object({
  instanceId: z.number().int().optional().describe('A stored configuration\'s ID (from psft_event_mapping_get); leave it out for a new row.'),
  level: z.enum(['C', 'R', 'P', 'F']).describe('C Component, R Page, P Record, F Record Field.'),
  page: z.string().optional().describe('R: the page.'),
  record: z.string().optional().describe('P and F: the record.'),
  field: z.string().optional().describe('F: the field.'),
  event: z.string().describe('The event code (psft_event_mapping_reference lists them per level).'),
  serviceId: z.string().describe('An Application Class related content service.'),
  processing: z.enum(['PRE', 'POST', 'OVER']),
  sequence: z.number().int().min(0).max(999),
  enabled: z.boolean(),
  parameter: z.string().optional().describe('The Event Map Parameter (uppercased).')
});

async function databaseProvider(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const p = await requireProvider(workspace, connection);
  if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; Event Mapping is read from a database connection.`);
  if (!p.isConnected) throw new Error(`${p.displayName} is not connected.`);
  return p;
}

const shown = (cref: string, rows: EventMappingConfigRow[]) => rows.map((r) => ({
  ...r,
  summary: describeMapping({ ...r, contentReference: cref }),
  levelLabel: EVENT_LEVEL_LABELS[r.level], eventLabel: eventLabel(r), processingLabel: PROCESSING_LABELS[r.processing]
}));

export function registerEventMappingTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  server.registerTool('psft_event_mapping_reference', {
    title: 'Event Mapping: how configurations work',
    description: 'A compact reference to Event Mapping configurations as the Configure Event Mapping page saves them -- levels, events, processing, parameters. Read it before saving one.',
    inputSchema: z.object({}),
    annotations: READ_ONLY
  }, async () => ({ content: [{ type: 'text' as const, text: EVENT_MAPPING_REFERENCE }] }));

  server.registerTool('psft_event_mapping_get', {
    title: 'Event Mapping: get a content reference\'s configuration',
    description: 'The Event Mapping configuration of a content reference as the Configure Event Mapping page lists it: each row with its instanceId, level, ' +
      'target, event, service, processing, sequence, enabled and Event Map Parameter; the component it registers; and the token to pass to ' +
      'psft_event_mapping_save as expectedToken ("absent" when none is configured yet). psft_customization_discover finds a component\'s content references.',
    inputSchema: z.object({ connection: z.string().min(1), contentReference: z.string().min(1), portal: z.string().optional().describe('Default EMPLOYEE.') }),
    annotations: READ_ONLY
  }, async ({ connection, contentReference, portal }) => {
    const p = await databaseProvider(workspace, connection);
    const r = await p.readEventMappingConfiguration(contentReference, portal);
    if (!r.component) throw new Error(`${contentReference.toUpperCase()} is not a component content reference in the ${portal ?? 'EMPLOYEE'} portal.`);
    return jsonResult({ connection: p.displayName, contentReference: contentReference.toUpperCase(), component: r.component, configured: r.exists, token: r.token, rows: shown(contentReference.toUpperCase(), r.rows) });
  });

  if (!host) return;
  const componentKey = (c: { name: string; market: string }): DefinitionKey => ({ type: DefinitionType.Component, parts: [c.name, c.market] });

  server.registerTool('psft_event_mapping_save', {
    title: 'Event Mapping: save a content reference\'s configuration',
    description: 'Saves the whole Event Mapping configuration of a content reference -- the rows as the page\'s grid would hold them -- as the Configure ' +
      'Event Mapping page saves it: rows with an instanceId are kept (and changed), rows without one added, stored rows left out deleted. ' +
      'Configures the content reference when it is not yet. The services must be Application Class services. expectedToken comes from ' +
      'psft_event_mapping_get; dryRun returns the plan (changes, rows the page would restamp, warnings) without writing. ' + GATES +
      ' The write scope applies to the services added.',
    inputSchema: z.object({
      connection: z.string().min(1), contentReference: z.string().min(1), portal: z.string().optional(),
      rows: z.array(row), expectedToken: z.string().min(1), dryRun: z.boolean().optional()
    }),
    annotations: WRITE
  }, async ({ connection, contentReference, portal, rows, expectedToken, dryRun }) => {
    const cref = contentReference.trim().toUpperCase();
    const problems = validateConfigRows(rows as EventMappingConfigRow[]);
    if (problems.length) {
      return jsonResult({ saved: false, reason: 'validation errors', errors: problems.map((x) => (x.row ? `row ${x.row}: ` : '') + x.message), events: EVENTS_BY_LEVEL });
    }
    const p = await databaseProvider(workspace, connection);
    const current = await p.readEventMappingConfiguration(cref, portal);
    if (!current.component) throw new Error(`${cref} is not a component content reference in the ${portal ?? 'EMPLOYEE'} portal.`);
    const scopeName = (rows.find((r) => !r.instanceId) ?? rows[0])?.serviceId ?? cref;
    const gate = await writable(workspace, host, connection, scopeName.toUpperCase());
    const request = { cref, ...(portal ? { portal } : {}), rows: rows as EventMappingConfigRow[], openedToken: expectedToken, operatorId: gate.operatorId };
    const preview = await gate.provider.saveEventMappingConfiguration({ ...request, dryRun: true });
    const planned = { changes: preview.plan.summary.changes, restamped: preview.plan.summary.restamped, warnings: preview.plan.summary.warnings, statements: preview.plan.statements.length };
    if (dryRun || preview.plan.empty) return jsonResult({ saved: false, reason: dryRun ? 'dry run' : 'nothing to save', planned });
    await approve(host, gate, componentKey(current.component), `save the Event Mapping configuration of ${cref} (${current.component.label})`,
      [...planned.changes, ...(planned.restamped ? [`${planned.restamped} unchanged row(s) re-saved, as the page re-saves them`] : []), ...planned.warnings].slice(0, 25).join('\n'));
    const result = await gate.provider.saveEventMappingConfiguration(request);
    host.saved(gate.provider.id, componentKey(current.component));
    const after = await gate.provider.readEventMappingConfiguration(cref, portal);
    return jsonResult({ saved: result.written, token: after.token, planned, rows: shown(cref, after.rows) });
  });

  server.registerTool('psft_event_mapping_create_service', {
    title: 'Event Mapping: create a service (and its class)',
    description: 'Creates what an Event Mapping row runs: the Application Package when missing, the application class when missing (extends ' +
      'PT_RCF:ServiceInterface with execute() -- the given source, or a stub to fill in with psft_save_peoplecode), then the Application Class ' +
      'related content service, saved as the Define Related Content Service page saves it. Service Name holds 18 characters. dryRun says what ' +
      'would be created. Then map it with psft_event_mapping_save. ' + GATES,
    inputSchema: z.object({
      connection: z.string().min(1),
      serviceId: z.string().min(1).describe('The service ID (30 characters, letters, digits and _).'),
      name: z.string().min(1).describe('Service Name (18 characters).'),
      description: z.string().optional(),
      packageRoot: z.string().min(1),
      path: z.array(z.string()).optional().describe('Subpackages below the root; none: the class is at the root.'),
      classId: z.string().min(1),
      source: z.string().optional().describe('The class\'s PeopleCode when it does not exist yet; default a stub.'),
      purpose: z.string().optional().describe('A line for the stub\'s comment.'),
      dryRun: z.boolean().optional()
    }),
    annotations: WRITE
  }, async ({ connection, serviceId, name, description, packageRoot, path, classId, source, purpose, dryRun }) => {
    const id = serviceId.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, id);
    const request = {
      serviceId: id, name, ...(description ? { description } : {}), packageRoot, ...(path?.length ? { path } : {}), classId,
      ...(source ? { source } : {}), ...(purpose ? { purpose } : {}), operatorId: gate.operatorId
    };
    const preview = await gate.provider.createEventMappingService({ ...request, dryRun: true });
    const cls = [packageRoot.toUpperCase(), ...(path ?? []), classId].join(':');
    const steps = [
      ...(preview.packageCreated ? [`create Application Package ${packageRoot.toUpperCase()}`] : []),
      ...(preview.classCreated ? [`create class ${cls}${source ? '' : ' (a stub)'}`] : []),
      `define related content service ${id} ("${name}") -> ${cls}`
    ];
    if (dryRun) return jsonResult({ created: false, reason: 'dry run', steps });
    const classKey: DefinitionKey = { type: DefinitionType.ApplicationClassPeopleCode, parts: [packageRoot.toUpperCase(), ...(path ?? []), classId, 'OnExecute'] };
    await approve(host, gate, classKey, `create the Event Mapping service ${id}`, steps.join('\n'));
    const r = await gate.provider.createEventMappingService(request);
    if (r.classCreated) host.saved(gate.provider.id, classKey);
    return jsonResult({ created: true, steps, service: { serviceId: r.service.serviceId, version: r.service.version } });
  });

  server.registerTool('psft_event_mapping_remove', {
    title: 'Event Mapping: remove a content reference\'s configuration',
    description: 'Removes every Event Mapping configuration row of a content reference and the content reference\'s configuration, as the Configure ' +
      'Event Mapping list\'s Remove does (tombstones recorded; services keep their EV_PARAM parameter). ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), contentReference: z.string().min(1), portal: z.string().optional(), expectedToken: z.string().min(1) }),
    annotations: DESTRUCTIVE
  }, async ({ connection, contentReference, portal, expectedToken }) => {
    const cref = contentReference.trim().toUpperCase();
    const p = await databaseProvider(workspace, connection);
    const current = await p.readEventMappingConfiguration(cref, portal);
    if (!current.exists) throw new Error(`${cref} has no Event Mapping configuration.`);
    if (current.token !== expectedToken) throw new Error(`${cref}'s configuration changed since it was read.`);
    const gate = await writable(workspace, host, connection, (current.rows[0]?.serviceId ?? cref).toUpperCase());
    const key = current.component ? componentKey(current.component) : { type: DefinitionType.Component, parts: [cref, 'GBL'] };
    await approve(host, gate, key, `REMOVE the Event Mapping configuration of ${cref}`,
      current.rows.map((r) => describeMapping({ ...r, contentReference: cref })).slice(0, 25).join('\n'));
    await gate.provider.removeEventMappingConfiguration(cref, expectedToken, gate.operatorId);
    host.saved(gate.provider.id, key);
    return jsonResult({ removed: cref, rows: current.rows.length });
  });
}
