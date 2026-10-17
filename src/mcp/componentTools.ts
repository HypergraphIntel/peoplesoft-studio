import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import type { ComponentDefinition } from '../model/componentDefinition.js';
import { defaultItemLabel, type ComponentItemEdit, type ComponentPropertyEdits } from '../providers/componentWriter.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, GATES, READ_ONLY, writable, WRITE, type McpWriteHost } from './writeTools.js';

/*
 * Components through the MCP, on the component writer App Designer proved
 * (componentWriter.ts: c01-c08b create and edit, the Internet/Fluid/Style tabs
 * replayed): create one, and change its pages and Use-tab properties. The
 * Internet, Fluid and Style tabs are left as stored (as App Designer's
 * defaults on create). Component PeopleCode is psft_save_peoplecode (types
 * 46/47/48); registering it on a menu is psft_menu_edit.
 */

const pageItem = z.object({
  page: z.string().min(1).describe('The page (it must exist).'),
  itemName: z.string().optional().describe('Item name; the page name when omitted, as App Designer names it.'),
  label: z.string().optional().describe('Item label (the tab text); App Designer\'s default, the page name title-cased, when omitted.'),
  folderTabLabel: z.string().optional(),
  hidden: z.boolean().optional()
}).strict();

const actions = z.object({ add: z.boolean(), updateDisplay: z.boolean(), updateDisplayAll: z.boolean(), correction: z.boolean() }).strict();

const useProperties = {
  description: z.string().max(30).optional(),
  comments: z.string().optional(),
  searchRecord: z.string().optional().describe('Required on a component (the writer refuses one without it).'),
  addSearchRecord: z.string().optional().describe('Blank: the search record.'),
  detailPage: z.string().optional(),
  forceSearch: z.boolean().optional(),
  actions: actions.optional().describe('Use tab actions. A run control component is usually Add + Update/Display (1,504 of 1,523 PRCSRUNCNTL components on HRDMO).'),
  disableSave: z.boolean().optional(),
  includeInNavigation: z.boolean().optional()
};

function item(i: z.infer<typeof pageItem>): ComponentItemEdit {
  const page = i.page.trim().toUpperCase();
  return { pageName: page, itemName: (i.itemName ?? page).trim().toUpperCase(), itemLabel: i.label ?? defaultItemLabel(page), folderTabLabel: i.folderTabLabel ?? '', hidden: !!i.hidden };
}

async function checkPages(provider: DatabaseProvider, items: ComponentItemEdit[]): Promise<void> {
  if (!items.length) throw new Error('A component needs at least one page.');
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.itemName)) throw new Error(`Item name ${i.itemName} is used twice.`);
    seen.add(i.itemName);
    if (!(await provider.pageInfo(i.pageName))) throw new Error(`There is no page named ${i.pageName}.`);
  }
}

async function checkRecords(provider: DatabaseProvider, p: ComponentPropertyEdits): Promise<void> {
  for (const r of [p.searchRecord, p.addSearchRecord].filter(Boolean)) {
    if ((await provider.recordNameStatus(r)) !== 'exists') throw new Error(`There is no record named ${r}.`);
  }
}

/** The stored Use/General properties, as the writer takes them (other tabs absent: left as stored). */
export function storedProperties(d: ComponentDefinition): ComponentPropertyEdits {
  const u = d.properties.use;
  return { description: d.properties.general.description, comments: d.properties.general.comments, searchRecord: u.searchRecord, addSearchRecord: u.addSearchRecord,
    detailPage: u.detailPage, forceSearch: u.forceSearch, actions: { ...u.actions }, disableSave: u.disableSave, includeInNavigation: u.includeInNavigation };
}

function applyProperties(base: ComponentPropertyEdits, edit: Partial<Record<keyof typeof useProperties, unknown>>): ComponentPropertyEdits {
  const out = { ...base, actions: { ...base.actions } };
  for (const [k, v] of Object.entries(edit)) {
    if (v === undefined) continue;
    (out as unknown as Record<string, unknown>)[k] = ['searchRecord', 'addSearchRecord', 'detailPage'].includes(k) ? String(v).trim().toUpperCase() : v;
  }
  return out;
}

function describe(items: ComponentItemEdit[], p: ComponentPropertyEdits): string {
  const acts = Object.entries(p.actions).filter(([, on]) => on).map(([a]) => a).join(', ') || 'none';
  return `Pages: ${items.map((i) => `${i.pageName}${i.hidden ? ' (hidden)' : ''} "${i.itemLabel}"`).join(', ')}\n` +
    `Search record ${p.searchRecord}${p.addSearchRecord ? `, add search ${p.addSearchRecord}` : ''}; actions ${acts}${p.disableSave ? '; Disable Saving Page' : ''}` +
    `${p.description ? `\nDescription: ${p.description}` : ''}`;
}

export function registerComponentTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  server.registerTool('psft_get_component', {
    title: 'Read a component definition',
    description: 'A component as App Designer\'s component window shows it: its pages (item name, label, hidden), the General/Use/Internet/Fluid/Style properties, ' +
      'the menus it is registered on and its PeopleCode programs. Read only.',
    inputSchema: z.object({ connection: z.string().min(1), component: z.string().min(1), market: z.string().default('GBL') }).strict(),
    annotations: READ_ONLY
  }, async ({ connection, component, market }) => {
    const provider = await requireProvider(workspace, connection);
    if (!(provider instanceof DatabaseProvider)) throw new Error(`${provider.displayName} is not a database connection.`);
    const name = component.trim().toUpperCase(), mkt = market.trim().toUpperCase();
    if (!(await provider.componentExists(name, mkt))) throw new Error(`There is no component ${name}.${mkt}.`);
    const d = await provider.readComponentDefinition({ type: DefinitionType.Component, parts: [name, mkt] });
    return jsonResult({ name: d.name, market: d.market, version: d.properties.general.version, items: d.items, properties: d.properties, menus: d.menus,
      peopleCodeEvents: d.peopleCodeEvents, peopleCodeRecords: d.peopleCodeRecords });
  });

  if (!host) return;

  server.registerTool('psft_component_create', {
    title: 'Create a component',
    description: 'Create a component as App Designer\'s New Component and first save do (c01): its pages in order and its Use-tab properties; the Internet, ' +
      'Fluid and Style tabs take App Designer\'s defaults. A search record is required. A classic run control component is usually search record ' +
      'PRCSRUNCNTL with Add and Update/Display (1,504 of 1,523 on HRDMO). Register it on a menu with psft_menu_edit and give it security ' +
      'separately. Refused if it exists. ' + GATES,
    inputSchema: z.object({
      connection: z.string().min(1), component: z.string().min(1).max(18), market: z.string().default('GBL'),
      pages: z.array(pageItem).min(1), ...useProperties, searchRecord: z.string().min(1)
    }).strict(),
    annotations: WRITE
  }, async ({ connection, component, market, pages, ...props }) => {
    const name = component.trim().toUpperCase(), mkt = market.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_#@$]{0,17}$/.test(name)) throw new Error(`${name} is not a component name.`);
    if (!/^[A-Z0-9]{1,3}$/.test(mkt)) throw new Error('Market is up to 3 letters or digits.');
    const key: DefinitionKey = { type: DefinitionType.Component, parts: [name, mkt] };
    const gate = await writable(workspace, host, connection, name);
    if (await gate.provider.componentExists(name, mkt)) throw new Error(`A component ${name}.${mkt} already exists; change it with psft_component_edit.`);
    const items = pages.map(item);
    const properties = applyProperties({ description: '', comments: '', searchRecord: '', addSearchRecord: '', detailPage: '', forceSearch: false,
      actions: { add: false, updateDisplay: true, updateDisplayAll: false, correction: false }, disableSave: false, includeInNavigation: true }, props);
    await checkPages(gate.provider, items);
    await checkRecords(gate.provider, properties);
    await approve(host, gate, key, `create component ${name}.${mkt}`, describe(items, properties));
    const r = await gate.provider.saveComponent({ name, market: mkt, operatorId: gate.operatorId, items, properties });
    host.saved(gate.provider.id, key);
    return jsonResult({ connection: gate.provider.displayName, component: `${name}.${mkt}`, saved: true, created: r.created, version: r.version });
  });

  server.registerTool('psft_component_edit', {
    title: 'Edit a component',
    description: 'Change an existing component\'s pages and Use-tab properties as App Designer\'s save does (c02-c08b). pages, when given, replaces the page ' +
      'list in that order (read it first with psft_get_component); properties not given keep their stored values, and the Internet/Fluid/Style tabs are ' +
      'left as stored. expectedVersion rejects a stale edit. ' + GATES,
    inputSchema: z.object({
      connection: z.string().min(1), component: z.string().min(1), market: z.string().default('GBL'), expectedVersion: z.number().int().nonnegative().optional(),
      pages: z.array(pageItem).min(1).optional(), ...useProperties
    }).strict(),
    annotations: WRITE
  }, async ({ connection, component, market, expectedVersion, pages, ...props }) => {
    const name = component.trim().toUpperCase(), mkt = market.trim().toUpperCase();
    const key: DefinitionKey = { type: DefinitionType.Component, parts: [name, mkt] };
    const gate = await writable(workspace, host, connection, name);
    if (!(await gate.provider.componentExists(name, mkt))) throw new Error(`There is no component ${name}.${mkt}; create it with psft_component_create.`);
    const d = await gate.provider.readComponentDefinition(key);
    const version = d.properties.general.version;
    if (expectedVersion !== undefined && expectedVersion !== version) throw new Error('The component changed since it was read; read it again before editing.');
    const items = pages ? pages.map(item) : d.items.map((i) => ({ pageName: i.pageName, itemName: i.itemName, itemLabel: i.itemLabel, folderTabLabel: i.folderTabLabel, hidden: i.hidden }));
    const properties = applyProperties(storedProperties(d), props);
    if (pages) await checkPages(gate.provider, items);
    await checkRecords(gate.provider, properties);
    await approve(host, gate, key, `edit component ${name}.${mkt}`, describe(items, properties));
    const r = await gate.provider.saveComponent({ name, market: mkt, openedVersion: version, operatorId: gate.operatorId, items, properties });
    host.saved(gate.provider.id, key);
    return jsonResult({ connection: gate.provider.displayName, component: `${name}.${mkt}`, saved: true, version: r.version });
  });
}
