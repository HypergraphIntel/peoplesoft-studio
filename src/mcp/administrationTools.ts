import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { adminKind, adminInputKey, validateAdminInput, messageInput, textInput, urlInput, inputForAdminDocument } from '../model/administration.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { DatabaseProvider } from '../providers/database.js';
import { hasUnsavedAdministration } from '../editors/administrationPanel.js';
import type { Workspace } from '../workspace.js';
import { requireProvider, jsonResult } from './tools.js';
import { writable, approve, READ_ONLY, WRITE, GATES, type McpWriteHost } from './writeTools.js';

export function registerAdministrationTools(server: McpServer, workspace: Workspace, host?: McpWriteHost): void {
  server.registerTool('psft_admin_list', {
    title: 'Search administration catalogs',
    description: 'Search Message Catalog (message), HCM Text Catalog (text), or URL definitions (url). Pages contain at most 100 entries; pass offset + 100 when more is true. Text keys include owner, sub-ID, text ID, effective date, all six context keys, and language (blank for base).',
    inputSchema: z.object({ connection: z.string().min(1), kind: adminKind, query: z.string().max(254).default(''), offset: z.number().int().nonnegative().default(0) }),
    annotations: READ_ONLY
  }, async ({ connection, kind, query, offset }) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error('Administration requires a database connection.');
    return jsonResult(await p.listAdministration(kind, query, offset));
  });
  server.registerTool('psft_admin_get', {
    title: 'Read administration entry',
    description: 'Read a message [set, number], URL [id], or HCM text [owner, subId, id, YYYY-MM-DD, key1..key6, language] with its concurrency token. Includes related language text or URL property names; secret URL property values are not read.',
    inputSchema: z.object({ connection: z.string().min(1), kind: adminKind, key: z.array(z.string()).min(1).max(11) }), annotations: READ_ONLY
  }, async ({ connection, kind, key }) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error('Administration requires a database connection.');
    const document = await p.readAdministration(kind, key);
    if (!document) throw new Error('Administration entry not found.');
    return jsonResult({ ...document, input: inputForAdminDocument(document) });
  });
  server.registerTool('psft_admin_choices', {
    title: 'Administration: Text Catalog choices',
    description: 'Read installed Text Catalog owner/sub-ID configurations, languages and usage codes before creating a text entry or translation.',
    inputSchema: z.object({ connection: z.string().min(1) }), annotations: READ_ONLY
  }, async ({ connection }) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error('Administration requires a database connection.');
    return jsonResult(await p.administrationChoices());
  });
  server.registerTool('psft_admin_reference', {
    title: 'Administration: Message Catalog, Text Catalog and URL definitions',
    description: 'Read before creating or editing catalog entries: how Message Catalog, HCM Text Catalog and URL definitions are keyed, read, created and saved.',
    inputSchema: z.object({}), annotations: READ_ONLY
  }, async () => jsonResult({
    workflow: 'Use psft_admin_list to search, psft_admin_get to read input and token, then psft_admin_save with the edited input and expectedToken. Use absent only for creation.',
    message: { key: ['set', 'number'], notes: 'Custom message sets 20000..32767; message numbers 1..32767. Severity M message, W warning, E error, C cancel. Text supports %1 substitution. Message sets have descriptions shared by their messages. Leave the set descriptions blank to keep the existing ones -- adding a sibling or editing a message alike; supply them only to change them. Oracle-reserved sets are not writable.' },
    text: { key: ['owner', 'subId', 'id', 'YYYY-MM-DD', 'key1', 'key2', 'key3', 'key4', 'key5', 'key6', 'language'], notes: 'HCM Text Catalog: owner/sub-ID configuration must exist; call psft_admin_choices. ID is at most 18 characters. Six context keys and an effective date select the text; blank language means base language. A translation requires its base context. Existing shared ID metadata is preserved when adding contexts/dates. Tags are validated against installed definitions.' },
    url: { key: ['id'], notes: 'URL definitions contain ID, description, URL, Owner ID and comments. IDs are at most 30 characters; URLs at most 254. Protocol properties are preserved, and secret property values are never returned. A protocol change with existing properties is refused.' }
  }));
  if (!host) return;
  server.registerTool('psft_admin_save', {
    title: 'Save administration entry',
    description: 'Create or edit an administration entry. Read with psft_admin_get first and supply expectedToken; use absent only for a new entry. Message input: set (20000..32767), number, setDescription, setShortDescription, text, severity (M/W/E/C), explanation. URL input: id, description, url, owner, comments. Text input: owner, subId, id, effectiveDate, keys (six strings), language (blank for base), text, description, usage, systemData. Existing text-ID metadata is preserved when adding contexts or dates. URL protocol properties are preserved; changing protocol with properties is refused. ' + GATES,
    inputSchema: z.discriminatedUnion('kind', [
      z.object({ connection: z.string().min(1), kind: z.literal('message'), input: messageInput, expectedToken: z.string().min(1) }),
      z.object({ connection: z.string().min(1), kind: z.literal('text'), input: textInput, expectedToken: z.string().min(1) }),
      z.object({ connection: z.string().min(1), kind: z.literal('url'), input: urlInput, expectedToken: z.string().min(1) })
    ]), annotations: WRITE
  }, async ({ connection, kind, input, expectedToken }) => {
    const value = validateAdminInput(kind, input);
    const parts = adminInputKey(kind, value);
    const gate = await writable(workspace, host, connection, kind === 'message' ? null : kind === 'url' ? parts[0] : parts[2]);
    if (hasUnsavedAdministration(gate.provider.id, kind)) throw new Error('This administration tool has unsaved edits. Save or discard them first.');
    const key = makeKey(kind === 'url' ? DefinitionType.UrlDefinition : kind === 'message' ? DefinitionType.MessageCatalog : DefinitionType.Record,
      ...(kind === 'text' ? ['HR_SSTEXT_TEXT', ...parts] : parts));
    await approve(host, gate, key, 'save ' + kind + ' catalog entry ' + parts.join(' / '), JSON.stringify(value, null, 2));
    const saved = await gate.provider.saveAdministration({ kind, input: value, expectedToken, operatorId: gate.operatorId });
    host.saved(gate.provider.id, key);
    return jsonResult({ saved: true, document: saved });
  });
}
