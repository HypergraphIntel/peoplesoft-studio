import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { allItems, copyMenu, MENU_NAME_MAX, type MenuDocument } from '../model/menuDocument.js';
import { applyMenuOperation, diffMenuSpec, documentFromSpec, menuOperation, menuSpec, specFromDocument, type MenuSpec } from '../model/menuOperations.js';
import { validateMenu, validateMenuReferences, type MenuDiagnostic } from '../model/menuSession.js';
import { compileForSave, prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, DESTRUCTIVE, GATES, READ_ONLY, WRITE, writable, type McpWriteHost } from './writeTools.js';

/*
 * Menus through the MCP (docs/MENUS.md): the Menu Designer's model --
 * menus read as documents (model/menuDocument.ts), shown and built as specs
 * (menuOperations.ts), changed by the designer's operations, checked by its
 * validator (App Designer's save checks, references, PeopleCode compiled) and
 * saved by its writer (providers/menuWriter.ts), proven against App
 * Designer's own saves.
 */

async function databaseProvider(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const p = await requireProvider(workspace, connection);
  if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; menus are read from a database connection.`);
  if (!p.isConnected) throw new Error(`${p.displayName} is not connected.`);
  return p;
}

async function deepValidate(p: DatabaseProvider, doc: MenuDocument): Promise<MenuDiagnostic[]> {
  const out = [...validateMenu(doc), ...await validateMenuReferences(doc, p.menuReferenceLookup())];
  const release = (await p.readEnvironment()).toolsRelease;
  for (const { bar, item } of allItems(doc)) {
    if (item.type !== 9 || !(item.peopleCode ?? '').trim()) continue;
    try { compileForSave(prepareSourceForSave(item.peopleCode!), { applicationClass: false, recordName: '', fieldName: '' }, release); } catch (e) {
      out.push({ severity: 'error', code: 'peoplecode-compile', path: `${bar.name}.${item.name}.ItemSelected`, message: e instanceof Error ? e.message : String(e), at: { bar: bar.name, item: item.name } });
    }
  }
  return out;
}

const brief = (ds: MenuDiagnostic[]) => ({
  errors: ds.filter((d) => d.severity === 'error').map((d) => `${d.path}: ${d.message}`),
  warnings: ds.filter((d) => d.severity === 'warning').map((d) => `${d.path}: ${d.message}`),
  notes: ds.filter((d) => d.severity === 'info').map((d) => `${d.path}: ${d.message}`)
});

export const MENU_REFERENCE = `Menus, as App Designer builds them (docs/MENUS.md):
- A standard menu has bars (Use, Process, Inquire ...) each with items; a popup menu (MENUTYPE 1) has items alone. A bar is stored only through its items: an empty bar is not saved.
- Item types: Component (opens a component; its search record can be overridden), PeopleCode (runs its ItemSelected PeopleCode; a standard menu's needs an enabling component), Separator, and in popups Transfer (opens a portal / node / menu / component / page with an action: Add, Update/Display, Update/Display All, Correction).
- App Designer refuses a save without an item, a component or PeopleCode item of a standard menu without a component (43,4), and two component items on one component (43,5).
- Labels: & before a letter makes it the mnemonic (&Use). Item names are keys within their bar (a popup's within the menu).
- Menu Group and its order / separator are shared: the group's order and separator are written to every menu of the group.
- Renaming an item or bar moves its ItemSelected PeopleCode and permission-list items (PSAUTHITEM); deleting one removes them. Renaming a menu repoints transfers in other menus; deleting one leaves them dangling.
- Component items become usable once a permission list grants the menu, bar and item (Security), and portal content references point at them (Register Menu Item).`;

export function registerMenuTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  const read = async (connection: string, menu: string) => {
    const p = await databaseProvider(workspace, connection);
    const name = menu.trim().toUpperCase();
    const r = await p.readMenuDocument(name);
    if (!r) throw new Error(`There is no menu ${name} on ${p.displayName}.`);
    return { p, name, ...r };
  };

  server.registerTool('psft_menu_get', {
    title: 'Menu: get a menu',
    description: 'A menu as a spec in App Designer\'s terms: Menu Properties (description, label, group, orders, installed), its bars with their items ' +
      '(component, PeopleCode with its ItemSelected program, separator; a popup\'s transfers), its concurrency token and validation. ' +
      'Find menus with psft_search_definitions. psft_menu_reference explains menus. Pass the token to psft_menu_edit as expectedToken.',
    inputSchema: z.object({ connection: z.string().min(1), menu: z.string().min(1), includeText: z.boolean().optional().describe('Include PeopleCode text (default true).') }),
    annotations: READ_ONLY
  }, async ({ connection, menu, includeText }) => {
    const { p, doc, token } = await read(connection, menu);
    return jsonResult({ connection: p.displayName, token, spec: specFromDocument(doc, { includeText: includeText !== false }), validation: brief(validateMenu(doc)) });
  });

  server.registerTool('psft_menu_reference', {
    title: 'Menu: how menus work',
    description: 'A compact reference to PeopleSoft menus as App Designer builds and saves them -- read it before creating or changing a menu.',
    inputSchema: z.object({}),
    annotations: READ_ONLY
  }, async () => ({ content: [{ type: 'text' as const, text: MENU_REFERENCE }] }));

  server.registerTool('psft_menu_validate', {
    title: 'Menu: validate a menu',
    description: 'Validates a menu -- or the menu as proposed operations (psft_menu_edit\'s) or a spec would leave it, without saving: App Designer\'s save ' +
      'checks (43,4 / 43,5, an item to save), names and lengths, the components, search records and transfer menus named, and ItemSelected PeopleCode compiled.',
    inputSchema: z.object({ connection: z.string().min(1), menu: z.string().optional(), operations: z.array(menuOperation).optional(), spec: menuSpec.optional() }),
    annotations: READ_ONLY
  }, async ({ connection, menu, operations, spec }) => {
    const p = await databaseProvider(workspace, connection);
    let doc: MenuDocument;
    if (spec) doc = documentFromSpec(spec as MenuSpec);
    else if (menu) doc = (await read(connection, menu)).doc;
    else throw new Error('Give a menu or a spec.');
    for (const o of operations ?? []) doc = applyMenuOperation(doc, o);
    return jsonResult({ validation: brief(await deepValidate(p, doc)), ...(spec || operations ? { result: specFromDocument(doc, { includeText: false }) } : {}) });
  });

  if (!host) return;
  const key = (name: string): DefinitionKey => ({ type: DefinitionType.Menu, parts: [name] });
  const saveDoc = async (gate: Awaited<ReturnType<typeof writable>>, doc: MenuDocument, token: string, dryRun: boolean, action: string) => {
    const diagnostics = await deepValidate(gate.provider, doc);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const preview = await gate.provider.saveMenuDocument({ doc, openedToken: token, operatorId: gate.operatorId, dryRun: true });
    const planned = { changes: preview.plan.summary, counters: preview.plan.increments, statements: preview.plan.statements.length };
    if (dryRun || errors.length || preview.plan.empty) {
      return jsonResult({ saved: false, reason: dryRun ? 'dry run' : errors.length ? 'validation errors' : 'nothing to save', planned, validation: brief(diagnostics) });
    }
    await approve(host, gate, key(doc.name), action,
      `${preview.plan.summary.changes.slice(0, 20).join('\n')}` +
      `${preview.plan.summary.peopleCodeChanged.length ? `\nPeopleCode: ${preview.plan.summary.peopleCodeChanged.join(', ')}` : ''}` +
      `${preview.plan.summary.groupMenus.length ? `\nAlso the group's menus: ${preview.plan.summary.groupMenus.join(', ')}` : ''}` +
      `${preview.plan.summary.tombstones.length ? `\nDeleted: ${preview.plan.summary.tombstones.join(', ')}` : ''}`);
    const result = await gate.provider.saveMenuDocument({ doc, openedToken: token, operatorId: gate.operatorId });
    host.saved(gate.provider.id, key(doc.name));
    const stored = await gate.provider.readMenuDocument(doc.name);
    const differences = stored ? diffMenuSpec(stored.doc, specFromDocument(doc)) : ['the menu is not stored'];
    return jsonResult({ saved: result.written, token: stored?.token, planned, verification: differences.length ? differences : 'stored menu matches', validation: brief(diagnostics) });
  };

  server.registerTool('psft_menu_create', {
    title: 'Menu: create a menu',
    description: 'Creates a menu from a spec (as psft_menu_get returns one): standard with bars and items, or popup with items and transfers. Built with ' +
      'App Designer\'s defaults (label and group from the name, Alphabetical order, installed), validated, saved as App Designer saves, then read back and ' +
      'compared. dryRun returns the plan and validation without writing. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), spec: menuSpec, dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, spec, dryRun }) => {
    const name = spec.menu.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    if (await gate.provider.readMenuDocument(name)) throw new Error(`A menu named ${name} already exists; use psft_menu_edit.`);
    return saveDoc(gate, documentFromSpec({ ...(spec as MenuSpec), menu: name }), 'absent', !!dryRun, `create menu ${name}`);
  });

  server.registerTool('psft_menu_edit', {
    title: 'Menu: edit a menu',
    description: 'Applies operations to a menu and saves it as App Designer does, changing only what they name: Menu Properties; add / rename / relabel / ' +
      'move / delete bars; add / set / rename / move / delete items (type, component, search record override, ItemSelected PeopleCode, transfer). Renames ' +
      'move PeopleCode and permission-list items as App Designer does; a group\'s order and separator are written to every menu of the group. ' +
      'expectedToken (from psft_menu_get) refuses the edit if the menu changed since; dryRun previews. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), menu: z.string().min(1), operations: z.array(menuOperation).min(1),
      expectedToken: z.string().optional(), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, menu, operations, expectedToken, dryRun }) => {
    const name = menu.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    const current = await gate.provider.readMenuDocument(name);
    if (!current) throw new Error(`There is no menu ${name}; use psft_menu_create.`);
    if (expectedToken && expectedToken !== current.token) throw new Error(`${name} changed since it was read (token ${current.token}); read it again with psft_menu_get.`);
    const groups = new Map((await gate.provider.menuChoices('groups')).map((g) => [g.value, { order: g.order ?? 0, separator: !!g.separator }]));
    let doc = current.doc;
    for (const [i, o] of operations.entries()) {
      try { doc = applyMenuOperation(doc, o, groups); } catch (e) { throw new Error(`Operation ${i + 1} (${o.op}): ${e instanceof Error ? e.message : String(e)}`); }
    }
    return saveDoc(gate, doc, current.token, !!dryRun, `edit menu ${name} (${operations.length} change${operations.length === 1 ? '' : 's'})`);
  });

  server.registerTool('psft_menu_copy', {
    title: 'Menu: copy a menu (Save As)',
    description: 'Saves a copy of a menu under a new name, as App Designer\'s Save As does (its origin recorded); withPeopleCode copies the items\' PeopleCode (App Designer asks). ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), menu: z.string().min(1), to: z.string().min(1).max(MENU_NAME_MAX), withPeopleCode: z.boolean().optional(), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, menu, to, withPeopleCode, dryRun }) => {
    const target = to.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, target);
    const { doc } = await read(connection, menu);
    if (await gate.provider.readMenuDocument(target)) throw new Error(`A menu named ${target} already exists.`);
    return saveDoc(gate, copyMenu(doc, target, withPeopleCode !== false), 'absent', !!dryRun, `copy menu ${doc.name} to ${target}`);
  });

  server.registerTool('psft_menu_rename', {
    title: 'Menu: rename a menu',
    description: 'Renames a menu as App Designer\'s Rename does: its rows and PeopleCode under the new name, transfers in other menus repointed, permission-list items renamed, the old name recorded as deleted. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), menu: z.string().min(1), to: z.string().min(1).max(MENU_NAME_MAX), expectedToken: z.string().optional() }),
    annotations: DESTRUCTIVE
  }, async ({ connection, menu, to, expectedToken }) => {
    const target = to.trim().toUpperCase();
    const { name, token } = await read(connection, menu);
    const gate = await writable(workspace, host, connection, name);
    await writable(workspace, host, connection, target);
    if (expectedToken && expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `rename menu ${name} to ${target}`, `${name} becomes ${target}; its PeopleCode, transfers naming it and permission-list items follow.`);
    await gate.provider.renameMenuDefinition(name, target, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ renamed: { from: name, to: target }, token: (await gate.provider.readMenuDocument(target))?.token });
  });

  server.registerTool('psft_menu_delete', {
    title: 'Menu: delete a menu',
    description: 'Deletes a menu with its PeopleCode and permission-list items, as App Designer\'s Delete does (transfers in other menus that name it are left). Cannot be undone from here. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), menu: z.string().min(1), expectedToken: z.string().min(1).describe('From psft_menu_get: the menu as you last read it.') }),
    annotations: DESTRUCTIVE
  }, async ({ connection, menu, expectedToken }) => {
    const { name, token, doc } = await read(connection, menu);
    const gate = await writable(workspace, host, connection, name);
    if (expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `DELETE menu ${name}`, `${name} (${allItems(doc).length} items) and its PeopleCode are deleted.`);
    await gate.provider.deleteMenuDefinition(name, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ deleted: name });
  });
}
