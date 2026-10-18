import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DatabaseProvider } from '../providers/database.js';
import { portalIdentity, portalInput, portalInputFields, portalInputForDocument, portalKey } from '../model/portalDocument.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { hasUnsavedPortal } from '../editors/portalPanel.js';
import type { Workspace } from '../workspace.js';
import { requireProvider, jsonResult } from './tools.js';
import { approve, writable, READ_ONLY, WRITE, GATES, type McpWriteHost } from './writeTools.js';

export function registerPortalTools(server: McpServer, workspace: Workspace, host?: McpWriteHost): void {
  const provider = async (connection: string) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error('Portal Registry requires a database connection.');
    return p;
  };
  const connection = z.string().min(1), portal = portalIdentity.shape.portal;
  server.registerTool('psft_portal_list', {
    title: 'Portal Registry: list portals',
    description: 'The top level of the registry is portals (EMPLOYEE, CUSTOMER, VENDOR, SUPPLIER, and any others installed). Call this first to select a portal; folders and content references belong to that portal, not to a global tree.',
    inputSchema: z.object({ connection }), annotations: READ_ONLY
  }, async args => jsonResult({ portals: await (await provider(args.connection)).menuChoices('portals') }));
  server.registerTool('psft_portal_structure', {
    title: 'Portal Registry: Structure & Content tree',
    description: 'All folder and content-reference nodes within the selected portal, in sibling sequence order. PORTAL_PRNTOBJNAME points to the parent folder; PORTAL_ROOT_OBJECT is the root folder. F means folder, C content reference. Use psft_portal_get for editable properties and its concurrency token.',
    inputSchema: z.object({ connection, portal }), annotations: READ_ONLY
  }, async args => jsonResult({ portal: args.portal, root: 'PORTAL_ROOT_OBJECT', nodes: await (await provider(args.connection)).portalStructure(args.portal) }));
  server.registerTool('psft_portal_get', {
    title: 'Portal Registry: read folder or content reference',
    description: 'Read a folder (F) or content reference (C) by portal and name. Returns its editable input, raw stored properties, security grants, attributes and token. Use the input and token with psft_portal_edit. Omitted target/access fields preserve the stored values; advanced target types remain intact.',
    inputSchema: portalIdentity.extend({ connection }), annotations: READ_ONLY
  }, async ({ connection, ...id }) => {
    const document = await (await provider(connection)).readPortalDocument(id);
    if (!document) throw new Error('Registry entry not found.');
    return jsonResult({ ...document, input: portalInputForDocument(document) });
  });
  if (!host) return;
  const save = async (connection: string, input: unknown, expectedToken: string, dryRun: boolean) => {
    const value = portalInput.parse(input);
    const gate = await writable(workspace, host, connection, value.name);
    if (hasUnsavedPortal(gate.provider.id, value.portal)) throw new Error('This portal has unsaved Structure & Content edits. Save or discard them first.');
    const key = makeKey(DefinitionType.PortalRegistry, ...portalKey(value));
    if (dryRun) {
      await gate.provider.savePortalDocument({ input: value, expectedToken, operatorId: gate.operatorId, dryRun: true });
      return jsonResult({ saved: false, validated: true, input: value });
    }
    await approve(host, gate, key, (expectedToken === 'absent' ? 'create ' : 'edit ') + (value.refType === 'F' ? 'folder ' : 'content reference ') + value.name + ' in portal ' + value.portal, JSON.stringify(value, null, 2));
    const document = await gate.provider.savePortalDocument({ input: value, expectedToken, operatorId: gate.operatorId });
    host.saved(gate.provider.id, key);
    return jsonResult({ saved: true, ...document, input: portalInputForDocument(document) });
  };
  server.registerTool('psft_portal_create_folder', {
    title: 'Portal Registry: create folder',
    description: 'Create a folder in a selected portal under an existing parent folder (PORTAL_ROOT_OBJECT for top-level content). Supply label and sequence; optional description, owner, access (public, author or permissions; a new entry defaults to author, as PIA does) and security. A reference to a component on a local node takes its permission lists from the component\'s security, as PIA does; do not supply them. Cannot overwrite an existing folder. dryRun validates and rolls back. ' + GATES,
    inputSchema: z.object({ connection, input: portalInputFields.omit({ refType: true, target: true }), dryRun: z.boolean().default(false) }), annotations: WRITE
  }, args => save(args.connection, { ...args.input, refType: 'F' }, 'absent', args.dryRun));
  server.registerTool('psft_portal_create_content_reference', {
    title: 'Portal Registry: create content reference',
    description: 'Create an ordinary target content reference under an existing folder in a selected portal. Target is a PeopleSoft component (node, menu, component, market, optional page/parameters) or external HTTP(S) URL. Supply label and sequence; optional security and properties. Creates supporting display settings and updates registry caches. Cannot overwrite an existing reference. ' + GATES,
    inputSchema: z.object({ connection, input: portalInputFields.omit({ refType: true }).required({ target: true }), dryRun: z.boolean().default(false) }), annotations: WRITE
  }, args => save(args.connection, { ...args.input, refType: 'C' }, 'absent', args.dryRun));
  server.registerTool('psft_portal_edit', {
    title: 'Portal Registry: edit folder or content reference',
    description: 'Edit the input returned by psft_portal_get, supplying its token as expectedToken. Supports label, description, parent folder (move), sequence, owner, access, direct security, and ordinary content-reference targets. Identity stays the same; omitted target/security/access values preserve them. Existing attributes, translations, Fluid and advanced settings are preserved. Root edits and folder cycles are refused. ' + GATES,
    inputSchema: z.object({ connection, input: portalInput, expectedToken: z.string().min(1).refine(v => v !== 'absent', 'Read the existing entry first'), dryRun: z.boolean().default(false) }), annotations: WRITE
  }, args => save(args.connection, args.input, args.expectedToken, args.dryRun));
}
