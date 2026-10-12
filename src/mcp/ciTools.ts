import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { copyCi, validateCi, type CiBuffer, type CiDiagnostic, type CiDocument } from '../model/ciDocument.js';
import { applyCiOperation, bufferSummary, ciOperation, specFromDocument } from '../model/ciOperations.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, DESTRUCTIVE, GATES, READ_ONLY, WRITE, writable, type McpWriteHost } from './writeTools.js';

/*
 * Component Interfaces through the MCP (docs/COMPONENT_INTERFACES.md): the CI
 * Designer's model -- interfaces read as documents (model/ciDocument.ts),
 * shown as specs and changed by the window's edits as operations
 * (ciOperations.ts), made from a component as App Designer makes them, and
 * saved by its writer (providers/ciWriter.ts), proven against App Designer's
 * own saves. Their Methods PeopleCode saves through psft_save_peoplecode.
 */

const CI_NAME_MAX = 30;

async function databaseProvider(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const p = await requireProvider(workspace, connection);
  if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; Component Interfaces are read from a database connection.`);
  if (!p.isConnected) throw new Error(`${p.displayName} is not connected.`);
  return p;
}

const brief = (ds: CiDiagnostic[]) => ({
  errors: ds.filter((d) => d.severity === 'error').map((d) => `${d.path}: ${d.message}`),
  warnings: ds.filter((d) => d.severity === 'warning').map((d) => `${d.path}: ${d.message}`)
});

export const CI_REFERENCE = `Component Interfaces, as App Designer builds them (docs/COMPONENT_INTERFACES.md):
- A Component Interface (CI) exposes one component (and market) to PeopleCode, Integration Broker and Excel-to-CI: its keys, properties, collections and methods.
- Keys come from the component's search record: GETKEYS (its search keys: Get), FINDKEYS (search and alternate search keys: Find), CREATEKEYS (the add search record's search keys, only when the component can Add: Create).
- PROPERTIES mirror the component's buffer: level 0 fields are properties at PS_ROOT; each scroll (grid / scroll area) below is a collection named for its record, with its own properties and child collections. A collection's keys that belong to the level above are not its properties.
- Making a CI (File > New, psft_ci_create) on a component, App Designer asks to default the properties: Yes makes a property of every field shown on the component's own pages in a visible edit box, drop-down, check box or radio button (Read Only when shown display-only), a collection of every scroll that has one; No makes the keys only.
- Edits: rename a property or collection, its comment, Read Only; delete one (a collection with everything under it); drag in a record field (any field of its scroll: add_field) or a whole scroll (add_scroll: all its fields but the parent's keys, merged into its collection if it has one); a key App Designer would make (add_key). psft_ci_buffer lists the scrolls and fields.
- Standard methods Cancel, Create, Find, Get, Save (Create only on a component that can Add); user methods are the Functions in the CI's Methods PeopleCode (psft_save_peoplecode, type 42, parts [CI, "Methods"]).
- Synchronizable (mobile): conflict resolution, message set, upload behaviour.
- Item names are App Designer's: a name taken in the collection becomes NAME_0, NAME_1 ...; the save makes names unique across collections (NAME_1, NAME_3 ... for keys and collections).
- Security: permission lists grant a CI's methods (PSAUTHBUSCOMP); taking a method away, renaming or deleting the CI updates them.`;

export function registerCiTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  const read = async (connection: string, ci: string) => {
    const p = await databaseProvider(workspace, connection);
    const name = ci.trim().toUpperCase();
    const r = await p.readCiDocument(name);
    if (!r) throw new Error(`There is no Component Interface ${name} on ${p.displayName}.`);
    return { p, name, ...r };
  };

  server.registerTool('psft_ci_reference', {
    title: 'Component Interface: how CIs work',
    description: 'A compact reference to PeopleSoft Component Interfaces as App Designer builds and saves them -- read it before creating or changing one.',
    inputSchema: z.object({}),
    annotations: READ_ONLY
  }, async () => ({ content: [{ type: 'text' as const, text: CI_REFERENCE }] }));

  server.registerTool('psft_ci_get', {
    title: 'Component Interface: get a CI',
    description: 'A Component Interface as a spec: its component, properties (description, comments, owner, menu), standard methods, synchronization, ' +
      'keys, and the properties / collections tree; its concurrency token and validation. psft_ci_buffer shows what can be added. Pass the token to psft_ci_edit as expectedToken.',
    inputSchema: z.object({ connection: z.string().min(1), ci: z.string().min(1) }),
    annotations: READ_ONLY
  }, async ({ connection, ci }) => {
    const { p, doc, token, buffer } = await read(connection, ci);
    return jsonResult({ connection: p.displayName, token, spec: specFromDocument(doc), validation: brief(validateCi(doc, buffer)) });
  });

  server.registerTool('psft_ci_buffer', {
    title: 'Component Interface: the component\'s buffer',
    description: 'The component\'s buffer as App Designer\'s CI window shows it (its left tree): the keys App Designer offers, each scroll (BCSCROLLNAME) with its ' +
      'fields -- which are properties already, which defaulting makes, which are the parent\'s keys. Give a CI, or a component (and market) for one not made yet.',
    inputSchema: z.object({ connection: z.string().min(1), ci: z.string().optional(), component: z.string().optional(), market: z.string().optional() }),
    annotations: READ_ONLY
  }, async ({ connection, ci, component, market }) => {
    const p = await databaseProvider(workspace, connection);
    let buffer: CiBuffer | undefined, doc: CiDocument | undefined;
    if (ci) { const r = await read(connection, ci); buffer = r.buffer; doc = r.doc; }
    else if (component) buffer = (await p.newCiDocument('ZZ_PREVIEW', component.trim().toUpperCase(), (market ?? 'GBL').trim().toUpperCase(), false)).buffer;
    else throw new Error('Give a ci or a component.');
    if (!buffer) throw new Error(`The CI's component ${doc?.component}.${doc?.market} cannot be read.`);
    return jsonResult(bufferSummary(buffer, doc));
  });

  server.registerTool('psft_ci_validate', {
    title: 'Component Interface: validate',
    description: 'Validates a CI -- or the CI as proposed operations (psft_ci_edit\'s) would leave it, without saving -- and returns the resulting spec.',
    inputSchema: z.object({ connection: z.string().min(1), ci: z.string().min(1), operations: z.array(ciOperation).optional() }),
    annotations: READ_ONLY
  }, async ({ connection, ci, operations }) => {
    const { doc: start, buffer } = await read(connection, ci);
    let doc = start;
    for (const [i, o] of (operations ?? []).entries()) {
      try { doc = applyCiOperation(doc, o, buffer, buffer?.actions ?? 0); } catch (e) { throw new Error(`Operation ${i + 1} (${o.op}): ${e instanceof Error ? e.message : String(e)}`); }
    }
    return jsonResult({ validation: brief(validateCi(doc, buffer)), ...(operations?.length ? { result: specFromDocument(doc) } : {}) });
  });

  if (!host) return;
  const key = (name: string): DefinitionKey => ({ type: DefinitionType.ComponentInterface, parts: [name] });
  const saveDoc = async (gate: Awaited<ReturnType<typeof writable>>, doc: CiDocument, token: string, dryRun: boolean, action: string, copyPeopleCodeFrom?: string) => {
    const diagnostics = validateCi(doc);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const request = { doc, openedToken: token, operatorId: gate.operatorId, ...(copyPeopleCodeFrom ? { copyPeopleCodeFrom } : {}) };
    const preview = await gate.provider.saveCiDocument({ ...request, dryRun: true });
    const planned = { changes: preview.plan.summary, counters: preview.plan.increments, statements: preview.plan.statements.length };
    if (dryRun || errors.length || preview.plan.empty) {
      return jsonResult({ saved: false, reason: dryRun ? 'dry run' : errors.length ? 'validation errors' : 'nothing to save', planned, result: specFromDocument(preview.plan.saved), validation: brief(diagnostics) });
    }
    await approve(host, gate, key(doc.name), action,
      `${preview.plan.summary.changes.slice(0, 20).join('\n')}${preview.plan.summary.renamedOnSave.length ? `\nNames the save stores: ${preview.plan.summary.renamedOnSave.join(', ')}` : ''}`);
    const result = await gate.provider.saveCiDocument(request);
    host.saved(gate.provider.id, key(doc.name));
    const stored = await gate.provider.readCiDocument(doc.name);
    return jsonResult({ saved: result.written, token: stored?.token, planned, spec: stored ? specFromDocument(stored.doc) : undefined, validation: brief(diagnostics) });
  };

  server.registerTool('psft_ci_create', {
    title: 'Component Interface: create a CI on a component',
    description: 'Creates a Component Interface on a component as App Designer\'s File > New does: its keys from the search records, standard methods from the ' +
      'component\'s actions, and (defaultProperties, App Designer\'s "default the properties?" Yes -- the default) its properties and collections from the ' +
      'component\'s pages; then operations (as psft_ci_edit\'s) if given. Saved as App Designer saves, read back. dryRun previews. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), ci: z.string().min(1).max(CI_NAME_MAX), component: z.string().min(1), market: z.string().optional(),
      defaultProperties: z.boolean().optional(), operations: z.array(ciOperation).optional(), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, ci, component, market, defaultProperties, operations, dryRun }) => {
    const name = ci.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    if (await gate.provider.readCiDocument(name)) throw new Error(`A Component Interface named ${name} already exists; use psft_ci_edit.`);
    const made = await gate.provider.newCiDocument(name, component.trim().toUpperCase(), (market ?? 'GBL').trim().toUpperCase(), defaultProperties !== false);
    let doc = made.doc;
    for (const [i, o] of (operations ?? []).entries()) {
      try { doc = applyCiOperation(doc, o, made.buffer, made.buffer.actions); } catch (e) { throw new Error(`Operation ${i + 1} (${o.op}): ${e instanceof Error ? e.message : String(e)}`); }
    }
    return saveDoc(gate, doc, 'absent', !!dryRun, `create Component Interface ${name} on ${doc.component}.${doc.market}`);
  });

  server.registerTool('psft_ci_edit', {
    title: 'Component Interface: edit a CI',
    description: 'Applies the CI window\'s edits as operations and saves as App Designer does, changing only what they name: set_interface (description, ' +
      'comments, owner, menu), set_methods, set_sync, set_item (rename, comment, Read Only), delete_item, add_key, add_field, add_scroll (psft_ci_buffer lists ' +
      'scrolls and fields). expectedToken (from psft_ci_get) refuses the edit if the CI changed since; dryRun previews. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), ci: z.string().min(1), operations: z.array(ciOperation).min(1),
      expectedToken: z.string().optional(), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, ci, operations, expectedToken, dryRun }) => {
    const name = ci.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    const current = await gate.provider.readCiDocument(name);
    if (!current) throw new Error(`There is no Component Interface ${name}; use psft_ci_create.`);
    if (expectedToken && expectedToken !== current.token) throw new Error(`${name} changed since it was read (token ${current.token}); read it again with psft_ci_get.`);
    let doc = current.doc;
    for (const [i, o] of operations.entries()) {
      try { doc = applyCiOperation(doc, o, current.buffer, current.buffer?.actions ?? 0); } catch (e) { throw new Error(`Operation ${i + 1} (${o.op}): ${e instanceof Error ? e.message : String(e)}`); }
    }
    return saveDoc(gate, doc, current.token, !!dryRun, `edit Component Interface ${name} (${operations.length} change${operations.length === 1 ? '' : 's'})`);
  });

  server.registerTool('psft_ci_copy', {
    title: 'Component Interface: copy a CI (Save As)',
    description: 'Saves a copy of a CI under a new name, as App Designer\'s Save As does (its items get SYNCIDs of their own); withPeopleCode copies its Methods PeopleCode (App Designer asks). ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), ci: z.string().min(1), to: z.string().min(1).max(CI_NAME_MAX), withPeopleCode: z.boolean().optional(), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, ci, to, withPeopleCode, dryRun }) => {
    const target = to.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, target);
    const { doc, name } = await read(connection, ci);
    if (await gate.provider.readCiDocument(target)) throw new Error(`A Component Interface named ${target} already exists.`);
    return saveDoc(gate, copyCi(doc, target), 'absent', !!dryRun, `copy Component Interface ${name} to ${target}`, withPeopleCode !== false ? name : undefined);
  });

  server.registerTool('psft_ci_rename', {
    title: 'Component Interface: rename a CI',
    description: 'Renames a CI as App Designer\'s Rename does: its rows and Methods PeopleCode under the new name, permission-list grants renamed, the old name recorded as deleted. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), ci: z.string().min(1), to: z.string().min(1).max(CI_NAME_MAX), expectedToken: z.string().optional() }),
    annotations: DESTRUCTIVE
  }, async ({ connection, ci, to, expectedToken }) => {
    const target = to.trim().toUpperCase();
    const { name, token } = await read(connection, ci);
    const gate = await writable(workspace, host, connection, name);
    await writable(workspace, host, connection, target);
    if (expectedToken && expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `rename Component Interface ${name} to ${target}`, `${name} becomes ${target}; its PeopleCode and permission-list grants follow.`);
    await gate.provider.renameCiDefinition(name, target, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ renamed: { from: name, to: target }, token: (await gate.provider.readCiDocument(target))?.token });
  });

  server.registerTool('psft_ci_delete', {
    title: 'Component Interface: delete a CI',
    description: 'Deletes a CI with its Methods PeopleCode and permission-list grants, as App Designer\'s Delete does. Cannot be undone from here. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), ci: z.string().min(1), expectedToken: z.string().min(1).describe('From psft_ci_get: the CI as you last read it.') }),
    annotations: DESTRUCTIVE
  }, async ({ connection, ci, expectedToken }) => {
    const { name, token, doc } = await read(connection, ci);
    const gate = await writable(workspace, host, connection, name);
    if (expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `DELETE Component Interface ${name}`, `${name} (${doc.items.length} items) and its PeopleCode are deleted.`);
    await gate.provider.deleteCiDefinition(name, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ deleted: name });
  });
}
