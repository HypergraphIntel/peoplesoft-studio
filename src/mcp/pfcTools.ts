import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { DatabaseProvider } from '../providers/database.js';
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

const row = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
const TYPE = z.enum(['STD', 'MASK', 'TRK']).optional().describe('Configuration type: STD (Standard, the default), MASK (Masking), TRK (change tracking; read only).');

export function registerPageFieldConfiguratorTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  server.registerTool('psft_page_field_config_get', {
    title: 'Page and Field Configurator: get a component\'s configuration',
    description: 'A component\'s Page and Field Configurator configuration of one type as PeopleTools stores it: the header (PS_EOCC_CONFIG_HDR), ' +
      'sequences (_SEQ), criteria (_CRT), page settings (_PNL) and field settings (_FLD), each row by column name with the values a save fills in ' +
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

  if (!host) return;

  server.registerTool('psft_page_field_config_save', {
    title: 'Page and Field Configurator: save a component\'s configuration',
    description: 'Saves a component\'s Page and Field Configurator configuration as the EOCC_CONFIGURE page saves it: the rows given become the ' +
      'configuration (rows are by column name, as psft_page_field_config_get returns them; a column left out takes its blank or record default), ' +
      'then the type\'s Event Mapping is regenerated on each of the component\'s content references (header EFF_STATUS A), or removed (I). ' +
      'Standard (STD) and Masking (MASK) configurations are written. A field row\'s PTCS_PNLFLDNAME, PNLNAME and STDPNLNAME place it on a page: take ' +
      'them from an existing row or the page structure. expectedToken comes from psft_page_field_config_get ("absent" for a new configuration); ' +
      'dryRun returns the changes and the derived mapping without writing. Writes need a database connection set to Writable with an Operator ID; ' +
      'no name prefix applies (no definition changes); unless peoplesoft.mcp.writes is "allow", the user approves each write in VS Code.',
    inputSchema: z.object({
      connection: z.string().min(1), component: z.string().min(1), market: z.string().optional(), type: z.enum(['STD', 'MASK']).optional(),
      configuration: z.object({ header: row, sequences: z.array(row), criteria: z.array(row).optional(), pages: z.array(row).optional(), fields: z.array(row).optional() }),
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
