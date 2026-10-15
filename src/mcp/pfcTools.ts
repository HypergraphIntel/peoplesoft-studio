import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { DatabaseProvider } from '../providers/database.js';
import { catalogCriteriaRow, catalogFieldRow } from '../providers/pfcCatalog.js';
import { PFC_CONFIGURATION_SCHEMA } from './pfcSchema.js';
import { CRITERIA_OPERATORS } from '../model/pfcCriteria.js';
import { defaultMaskFor, withMask } from '../model/pfcFieldEdits.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, READ_ONLY, WRITE, writable, type McpWriteHost } from './writeTools.js';

/*
 * The Page and Field Configurator through the MCP (docs/CUSTOMIZATION.md "Page
 * and Field Configurator discovery", "Writing Page and Field Configurator"):
 * a component's configuration read and saved as EOCC_CONFIGURE saves it,
 * Event Mapping regenerated on the component's content references
 * (providers/pfcWriter.ts), proven against the page's own saves on HRDMO.
 */

async function databaseProvider(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const p = await requireProvider(workspace, connection);
  if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; configurations are read from a database connection.`);
  if (!p.isConnected) throw new Error(`${p.displayName} is not connected.`);
  return p;
}

const TYPE = z.enum(['STD', 'MASK', 'TRK']).optional().describe('Configuration type: STD (Standard, the default), MASK (Masking), TRK (change tracking; read only).');

export function registerPageFieldConfiguratorTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  server.registerTool('psft_page_field_config_get', {
    title: 'Page and Field Configurator: get a component\'s configuration',
    description: 'A component\'s Page and Field Configurator configuration of one type as PeopleTools stores it: the header (PS_EOCC_CONFIG_HDR), ' +
      'sequences (_SEQ), criteria (_CRT), page rules (_PNL), field settings (_FLD) and who it applies to (seqUsers, seqExcludedUsers, seqRoles, ' +
      'seqExcludedRoles per sequence; users, excludedUsers, roles, excludedRoles at the header, present only when not empty), each row by column name with the values a save fills in ' +
      'anyway (blanks, zeros, record defaults) left out; the Event Mapping the configuration needs (derived as the configurator derives it) and, per ' +
      'content reference, whether what is mapped there matches; and the token to pass to psft_page_field_config_save as expectedToken. ' +
      'A configuration changes no delivered definition: the configurator applies it at run time through Event Mapping. Read only.',
    inputSchema: z.object({ connection: z.string().min(1), component: z.string().min(1), market: z.string().optional().describe('Default GBL.'), type: TYPE }),
    annotations: READ_ONLY
  }, async ({ connection, component, market, type }) => {
    const p = await databaseProvider(workspace, connection);
    const r = await p.readPageFieldConfiguration(component, market ?? 'GBL', type ?? 'STD');
    return jsonResult({
      connection: p.displayName, component: `${component.toUpperCase()}.${(market ?? 'GBL').toUpperCase()}`, type: type ?? 'STD', ...r,
      derived: r.derived.map((m) => [m.serviceId, m.level, m.record ? `${m.record}${m.field ? `.${m.field}` : ''}` : m.page ?? '', m.event].filter(Boolean).join(' ')),
      ...(r.exists ? {} : { note: 'No configuration of this type; psft_page_field_config_save with expectedToken "absent" creates one.' })
    });
  });

  server.registerTool('psft_page_field_config_fields', {
    title: 'Page and Field Configurator: the fields a configuration can name',
    description: 'The fields the configurator\'s Select Fields page offers for a component, as that page lists them. Without page: the component\'s ' +
      'pages and the secondary pages reached from them (type P or S). With page and type: that page\'s fields (subpages walked, invisible fields ' +
      'left out), each with its label and the field row to put in psft_page_field_config_save\'s fields (add SEQUENCE_NBR and EOCC_SEQUENCE_NBR, ' +
      'and the settings: EOCC_VISIBLE_FLAG N hides it, EOCC_DISABLED Y makes it display only, EOCC_IS_REQUIRED Y requires it, EOCC_LBL_OVERRIDE Y ' +
      'with LBLTEXT relabels it; for a Masking configuration EOCC_MASK_FLAG Y with a profile in EOCC_MASK_ID). Read only.',
    inputSchema: z.object({
      connection: z.string().min(1), component: z.string().min(1), market: z.string().optional().describe('Default GBL.'),
      page: z.string().optional(), type: z.enum(['P', 'S']).optional().describe('P: a component page (default); S: a secondary page.'),
      filter: z.string().optional().describe('Only fields whose label or record.field contains this (case-insensitive).'),
      mask: z.boolean().optional().describe('For a Masking (MASK) configuration: long fields left out, each row given its default mask profile, and the profiles listed.'),
      criteria: z.boolean().optional().describe('The fields criteria can test (levels 0 and 1; edit boxes, drop-downs, check boxes), each with the criteria row to put in criteria (set EOCC_CRITERIA_SYM and EOCC_VALUE_MATCH).')
    }),
    annotations: READ_ONLY
  }, async ({ connection, component, market, page, type, filter, mask, criteria }) => {
    const p = await databaseProvider(workspace, connection);
    if (!page) return jsonResult({ connection: p.displayName, component: `${component.toUpperCase()}.${(market ?? 'GBL').toUpperCase()}`, pages: await p.readPageFieldCatalogPages(component, market ?? 'GBL') });
    const f = (filter ?? '').toLowerCase();
    const masks = mask ? await p.readPageFieldMaskProfiles() : undefined;
    const fields = (await p.readPageFieldCatalogFields(page, type ?? 'P', { mask: !!mask, criteria: !!criteria }))
      .filter((x) => !f || x.label.toLowerCase().includes(f) || `${x.record}.${x.field}`.toLowerCase().includes(f));
    if (criteria) {
      const types = await p.readFieldDatabaseTypes(fields.slice(0, 300).map((x) => x.field));
      return jsonResult({
        page: page.toUpperCase(), type: 'P', count: fields.length,
        operators: Object.fromEntries(Object.entries(CRITERIA_OPERATORS).map(([code, o]) => [code, `${o.label}${o.values === 0 ? ' (no value)' : o.values === 2 ? ' (EOCC_VALUE_MATCH and EOCC_VALUE_MATCH2)' : o.values === 'list' ? ' (comma-separated values)' : ''}`])),
        fields: fields.slice(0, 300).map((x) => ({ label: x.label, recordField: `${x.record}.${x.field}`, level: x.level,
          row: (({ SEQUENCE_NBR: _a, EOCC_SEQUENCE_NBR: _b, ...rest }) => rest)(catalogCriteriaRow(x, types.get(x.field) ?? 0, { SEQUENCE_NBR: 0, EOCC_SEQUENCE_NBR: 0 }, 'A')) })),
        ...(fields.length > 300 ? { note: 'First 300 shown; pass filter to narrow.' } : {})
      });
    }
    return jsonResult({
      page: page.toUpperCase(), type: type ?? 'P', count: fields.length,
      fields: fields.slice(0, 300).map((x) => ({ label: x.label, recordField: `${x.record}.${x.field}`, level: x.level, ...(x.page !== x.componentPage ? { onSubpage: x.page } : {}),
        row: (({ SEQUENCE_NBR: _a, EOCC_SEQUENCE_NBR: _b, ...rest }) => rest)(masks
          ? withMask(catalogFieldRow(x, { SEQUENCE_NBR: 0, EOCC_SEQUENCE_NBR: 0 }), defaultMaskFor(x.field, masks.profiles, masks.fieldDefaults))
          : catalogFieldRow(x, { SEQUENCE_NBR: 0, EOCC_SEQUENCE_NBR: 0 })) })),
      ...(masks ? { maskProfiles: masks.profiles } : {}),
      ...(fields.length > 300 ? { note: 'First 300 shown; pass filter to narrow.' } : {})
    });
  });

  if (!host) return;

  server.registerTool('psft_page_field_config_save', {
    title: 'Page and Field Configurator: save a component\'s configuration',
    description: 'Saves a component\'s Page and Field Configurator configuration as the EOCC_CONFIGURE page saves it: the rows given become the ' +
      'configuration (rows are by column name, as psft_page_field_config_get returns them; a column left out takes its blank or record default), ' +
      'then the type\'s Event Mapping is regenerated on each of the component\'s content references (header EFF_STATUS A), or removed (I). ' +
      'Standard (STD) and Masking (MASK) configurations are written. Take field and criteria rows from psft_page_field_config_fields. ' +
      'Who a sequence applies to is its EOCC_APPLY_TO (A everyone but seqExcludedRoles/seqExcludedUsers, R ROLENAME but seqExcludedUsers, S ' +
      'seqRoles but seqExcludedUsers, U seqUsers), or the header\'s with the header lists when its EOCC_APPLY_LVL is H (the default); list rows ' +
      'carry SEQUENCE_NBR and EOCC_SEQUENCE_NBR (sequence lists) and ROLENAME or OPRID. Every criterion must hold. Page rules: EOCC_VISIBLE_FLAG N ' +
      'hides a page, Y shows it, DISPLAYONLY 1 makes it display only. Field defaults: EOCC_DFLT_VALUE (EOCC_DFLTOVRD_FLAG Y replaces the value); ' +
      'EOCC_SET_BLANK Y on a hidden or display-only field. Pass back every list psft_page_field_config_get returned: a list left out is saved empty. expectedToken comes from psft_page_field_config_get ("absent" for a new configuration); ' +
      'dryRun returns the changes and the derived mapping without writing. Writes need a database connection set to Writable with an Operator ID; ' +
      'no name prefix applies (no definition changes); unless peoplesoft.mcp.writes is "allow", the user approves each write in VS Code.',
    inputSchema: z.object({
      connection: z.string().min(1), component: z.string().min(1), market: z.string().optional(), type: z.enum(['STD', 'MASK']).optional(),
      configuration: PFC_CONFIGURATION_SCHEMA,
      expectedToken: z.string().min(1), dryRun: z.boolean().optional()
    }),
    annotations: WRITE
  }, async ({ connection, component, market, type, configuration, expectedToken, dryRun }) => {
    const name = component.trim().toUpperCase();
    const mkt = (market ?? 'GBL').trim().toUpperCase();
    const key: DefinitionKey = { type: DefinitionType.Component, parts: [name, mkt] };
    const gate = await writable(workspace, host, connection, null);
    const request = { component: name, market: mkt, type: type ?? 'STD', configuration, openedToken: expectedToken, operatorId: gate.operatorId };
    const preview = await gate.provider.savePageFieldConfiguration({ ...request, dryRun: true });
    const changes = [...preview.rows.changes, ...(preview.mappings?.changes ?? [])];
    if (dryRun || preview.rows.empty) {
      return jsonResult({
        saved: false, reason: dryRun ? 'dry run' : 'nothing to save', changes, warnings: preview.warnings,
        derived: preview.derived.map((m) => `${m.serviceId} ${m.level} ${m.record ?? m.page ?? ''}`.trim())
      });
    }
    await approve(host, gate, key, `save the ${request.type} Page and Field Configurator configuration of ${name}.${mkt}`, changes.slice(0, 25).join('\n'));
    const result = await gate.provider.savePageFieldConfiguration(request);
    host.saved(gate.provider.id, key);
    return jsonResult({ saved: result.written, changes: [...result.rows.changes, ...(result.mappings?.changes ?? [])], warnings: result.warnings, token: result.token });
  });
}
