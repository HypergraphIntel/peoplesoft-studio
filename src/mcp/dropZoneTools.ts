import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import type { DropZone } from '../model/dropZones.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, GATES, READ_ONLY, WRITE, writable, type McpWriteHost } from './writeTools.js';

/*
 * Drop Zones through the MCP (docs/CUSTOMIZATION.md "Drop Zone discovery",
 * "Writing Drop Zones"): a component's drop zones read and their subpages set
 * as PeopleTools' Configure Drop Zones page lists and saves them
 * (providers/dropZoneWriter.ts), proven against the page's own saves on HRDMO.
 */

async function databaseProvider(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const p = await requireProvider(workspace, connection);
  if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; drop zones are read from a database connection.`);
  if (!p.isConnected) throw new Error(`${p.displayName} is not connected.`);
  return p;
}

const shown = (zones: DropZone[]) => zones.map((z) => ({
  label: z.label, page: z.page, definedOn: z.container, tabOrder: z.tabOrder, key: z.fieldName,
  recordField: z.record ? `${z.record}.${z.field}` : undefined, subpage: z.subpage ?? null
}));

export function registerDropZoneTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  server.registerTool('psft_drop_zone_get', {
    title: 'Drop Zones: get a component\'s drop zones',
    description: 'A component\'s drop zones as the Configure Drop Zones page lists them: each with its page, label, tab order, key (pass it to ' +
      'psft_drop_zone_save) and the custom subpage configured into it (null when none); where the configuration is stored (the component\'s ' +
      'content references, or PT_DZ_UNREGCOMP when it is not registered); and the token to pass to psft_drop_zone_save as expectedToken. ' +
      'A drop zone is a place Oracle left on a page for a custom subpage: configuring one changes no delivered definition. Read only.',
    inputSchema: z.object({ connection: z.string().min(1), component: z.string().min(1), market: z.string().optional().describe('Default GBL.') }),
    annotations: READ_ONLY
  }, async ({ connection, component, market }) => {
    const p = await databaseProvider(workspace, connection);
    const r = await p.readDropZoneConfiguration(component, market ?? 'GBL');
    return jsonResult({
      connection: p.displayName, component: `${component.toUpperCase()}.${(market ?? 'GBL').toUpperCase()}`, token: r.token,
      storedUnder: r.owners.map((o) => `${o.portal}/${o.cref}`), dropZones: shown(r.zones),
      ...(r.zones.length ? {} : { note: 'No drop zone on this component\'s pages, subpages or secondary pages; adding one to a delivered page is itself a customization.' })
    });
  });

  if (!host) return;

  server.registerTool('psft_drop_zone_save', {
    title: 'Drop Zones: set the subpages a component\'s drop zones show',
    description: 'Sets drop zones\' custom subpages as the Configure Drop Zones page saves them: each assignment names a drop zone by page and key ' +
      '(from psft_drop_zone_get) and the subpage it should show, or "" to clear it; drop zones not listed are left as they are. The subpage must ' +
      'be a subpage (page type 1) built on records the component\'s level 0 can supply; its embedded-subpage service is created when missing. ' +
      'expectedToken comes from psft_drop_zone_get; dryRun returns the changes without writing. ' + GATES + ' The write scope applies to the ' +
      'subpages configured or removed.',
    inputSchema: z.object({
      connection: z.string().min(1), component: z.string().min(1), market: z.string().optional(),
      assignments: z.array(z.object({
        page: z.string().min(1), key: z.string().min(1).describe('The drop zone\'s key (level.record.field.pnlfldid).'),
        subpage: z.string().describe('The subpage to show; "" clears it.')
      })).min(1),
      expectedToken: z.string().min(1), dryRun: z.boolean().optional()
    }),
    annotations: WRITE
  }, async ({ connection, component, market, assignments, expectedToken, dryRun }) => {
    const name = component.trim().toUpperCase();
    const mkt = (market ?? 'GBL').trim().toUpperCase();
    const key: DefinitionKey = { type: DefinitionType.Component, parts: [name, mkt] };
    const scopeName = (assignments.find((a) => a.subpage.trim()) ?? assignments[0]).subpage.trim().toUpperCase() || name;
    const gate = await writable(workspace, host, connection, scopeName);
    const request = {
      component: name, market: mkt, openedToken: expectedToken, operatorId: gate.operatorId,
      assignments: assignments.map((a) => ({ page: a.page, fieldName: a.key, subpage: a.subpage }))
    };
    const preview = await gate.provider.saveDropZoneConfiguration({ ...request, dryRun: true });
    if (dryRun || preview.plan.empty) {
      return jsonResult({ saved: false, reason: dryRun ? 'dry run' : 'nothing to save', changes: preview.plan.changes, statements: preview.plan.statements.length });
    }
    await approve(host, gate, key, `set the drop zones of ${name}.${mkt}`, preview.plan.changes.slice(0, 25).join('\n'));
    const result = await gate.provider.saveDropZoneConfiguration(request);
    host.saved(gate.provider.id, key);
    const after = await gate.provider.readDropZoneConfiguration(name, mkt);
    return jsonResult({ saved: result.written, changes: result.plan.changes, token: after.token, dropZones: shown(after.zones) });
  });
}
