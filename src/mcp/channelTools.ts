import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { CHANNEL_NAME_MAX, copyChannel, validateChannel, validateChannelReferences, type ChannelDiagnostic, type ChannelDocument } from '../model/channelDocument.js';
import { applyChannelOperation, channelOperation, channelSpec, diffChannelSpec, documentFromSpec, specFromDocument, type ChannelSpec } from '../model/channelOperations.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, DESTRUCTIVE, GATES, READ_ONLY, WRITE, writable, type McpWriteHost } from './writeTools.js';

/*
 * Message channels through the MCP (docs/MESSAGE_CHANNELS.md): the Message
 * Channel window's model -- channels read as documents
 * (model/channelDocument.ts), shown and built as specs
 * (channelOperations.ts), changed by the window's operations, checked by its
 * validator and saved by its writer (providers/channelWriter.ts), proven
 * against App Designer's own saves.
 */

async function databaseProvider(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const p = await requireProvider(workspace, connection);
  if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; message channels are read from a database connection.`);
  if (!p.isConnected) throw new Error(`${p.displayName} is not connected.`);
  return p;
}

async function deepValidate(p: DatabaseProvider, doc: ChannelDocument): Promise<ChannelDiagnostic[]> {
  return [...validateChannel(doc), ...await validateChannelReferences(doc, p.channelReferenceLookup())];
}

const brief = (ds: ChannelDiagnostic[]) => ({
  errors: ds.filter((d) => d.severity === 'error').map((d) => `${d.path}: ${d.message}`),
  warnings: ds.filter((d) => d.severity === 'warning').map((d) => `${d.path}: ${d.message}`),
  notes: ds.filter((d) => d.severity === 'info').map((d) => `${d.path}: ${d.message}`)
});

export const CHANNEL_REFERENCE = `Message channels, as App Designer builds them (docs/MESSAGE_CHANNELS.md):
- A channel (PSCHNLDEFN) groups Integration Broker messages; a message names its channel (PSMSGDEFN.CHNLNAME -- App Designer 8.62's message window does not set it). The channel's window lists those messages, read-only.
- Message Channel Properties: General (Description, Comments, Owner ID) and Use (Message Channel Status Run / Pause, Archive Messages?, Unordered?). A new channel saved without opening its properties stores status 0 and ordering 0 (shown as Run, ordered); any OK of the properties writes them as Run (1) / ordered (2) unless set otherwise.
- Use These Fields to Partition: App Designer lists the level-0 record fields every message on the channel shares (each message's default version; Long fields left out), then MSGNAME, MSGNAMEDETAIL, PUBLISHER and PUBPROC -- nothing when no message names the channel. Checked fields are PSSUBCHNL rows. Add Partition Field takes any field (PSDBFIELD; otherwise (78,1)), appended checked.
- App Designer drops stored partition fields it does not list when it opens a channel, so its next save deletes them; these tools do the same (the read reports them as dropped).
- Rename repoints the messages naming the channel and its project items; Delete leaves them, and records the name in PSCHNLDEL.
- Timeouts, retries, error threshold and quality of service are not in App Designer's window: a new channel takes the IB defaults (14400 min, 300 s, 100, 1) and they are kept as stored.`;

export function registerChannelTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  const read = async (connection: string, channel: string) => {
    const p = await databaseProvider(workspace, connection);
    const name = channel.trim().toUpperCase();
    const r = await p.readChannelDocument(name);
    if (!r) throw new Error(`There is no message channel ${name} on ${p.displayName}.`);
    return { p, name, ...r };
  };

  server.registerTool('psft_channel_get', {
    title: 'Message channel: get a channel',
    description: 'A message channel as a spec in App Designer\'s terms: Message Channel Properties (description, comments, owner, status, archive, unordered), ' +
      'its messages, the fields its window offers to partition by (partitionChoices) and those checked (partitions), its concurrency token and validation. ' +
      'Find channels with psft_search_definitions. psft_channel_reference explains channels. Pass the token to psft_channel_edit as expectedToken.',
    inputSchema: z.object({ connection: z.string().min(1), channel: z.string().min(1) }),
    annotations: READ_ONLY
  }, async ({ connection, channel }) => {
    const { p, doc, token } = await read(connection, channel);
    return jsonResult({ connection: p.displayName, token, spec: specFromDocument(doc), ...(doc.dropped.length ? { droppedPartitions: doc.dropped } : {}), validation: brief(validateChannel(doc)) });
  });

  server.registerTool('psft_channel_reference', {
    title: 'Message channel: how channels work',
    description: 'A compact reference to message channels as App Designer builds and saves them -- read it before creating or changing one.',
    inputSchema: z.object({}),
    annotations: READ_ONLY
  }, async () => ({ content: [{ type: 'text' as const, text: CHANNEL_REFERENCE }] }));

  server.registerTool('psft_channel_validate', {
    title: 'Message channel: validate a channel',
    description: 'Validates a message channel -- or the channel as proposed operations (psft_channel_edit\'s) or a spec would leave it, without saving: names and lengths, ' +
      'the partition fields (PSDBFIELD, (78,1)), the Owner ID, and stored partition fields App Designer would drop.',
    inputSchema: z.object({ connection: z.string().min(1), channel: z.string().optional(), operations: z.array(channelOperation).optional(), spec: channelSpec.optional() }),
    annotations: READ_ONLY
  }, async ({ connection, channel, operations, spec }) => {
    const p = await databaseProvider(workspace, connection);
    let doc: ChannelDocument;
    if (spec) {
      const fresh = await p.newChannelDocument(spec.channel.trim().toUpperCase());
      doc = documentFromSpec(spec as ChannelSpec, fresh.messages, fresh.partitions.map((x) => x.field));
    } else if (channel) doc = (await read(connection, channel)).doc;
    else throw new Error('Give a channel or a spec.');
    for (const o of operations ?? []) doc = applyChannelOperation(doc, o);
    return jsonResult({ validation: brief(await deepValidate(p, doc)), ...(spec || operations ? { result: specFromDocument(doc) } : {}) });
  });

  if (!host) return;
  const key = (name: string): DefinitionKey => ({ type: DefinitionType.MessageChannel, parts: [name] });
  const saveDoc = async (gate: Awaited<ReturnType<typeof writable>>, doc: ChannelDocument, token: string, dryRun: boolean, action: string, spec?: ChannelSpec) => {
    const diagnostics = await deepValidate(gate.provider, doc);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const preview = await gate.provider.saveChannelDocument({ doc, openedToken: token, operatorId: gate.operatorId, dryRun: true });
    const planned = { changes: preview.plan.summary, counters: preview.plan.increments, statements: preview.plan.statements.length };
    if (dryRun || errors.length || preview.plan.empty) {
      return jsonResult({ saved: false, reason: dryRun ? 'dry run' : errors.length ? 'validation errors' : 'nothing to save', planned, validation: brief(diagnostics) });
    }
    await approve(host, gate, key(doc.name), action, preview.plan.summary.changes.slice(0, 20).join('\n'));
    const result = await gate.provider.saveChannelDocument({ doc, openedToken: token, operatorId: gate.operatorId });
    host.saved(gate.provider.id, key(doc.name));
    const stored = await gate.provider.readChannelDocument(doc.name);
    const differences = stored ? diffChannelSpec(stored.doc, spec ?? specFromDocument(doc)) : ['the message channel is not stored'];
    return jsonResult({ saved: result.written, token: stored?.token, planned, verification: differences.length ? differences : 'stored channel matches', validation: brief(diagnostics) });
  };

  server.registerTool('psft_channel_create', {
    title: 'Message channel: create a channel',
    description: 'Creates a message channel from a spec (as psft_channel_get returns one), as App Designer\'s File > New > Message Channel: its defaults, then ' +
      'Message Channel Properties when the spec gives any, then each partition field added. Validated, saved as App Designer saves, then read back and compared. ' +
      'dryRun returns the plan and validation without writing. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), spec: channelSpec, dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, spec, dryRun }) => {
    const name = spec.channel.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    if (await gate.provider.readChannelDocument(name)) throw new Error(`A message channel named ${name} already exists; use psft_channel_edit.`);
    const fresh = await gate.provider.newChannelDocument(name);
    const doc = documentFromSpec({ ...(spec as ChannelSpec), channel: name }, fresh.messages, fresh.partitions.map((x) => x.field));
    return saveDoc(gate, doc, 'absent', !!dryRun, `create message channel ${name}`, spec as ChannelSpec);
  });

  server.registerTool('psft_channel_edit', {
    title: 'Message channel: edit a channel',
    description: 'Applies operations to a message channel and saves it as App Designer does: set_channel (Message Channel Properties), add_partition ' +
      '(Add Partition Field), check_partition (a listed field\'s check box). expectedToken (from psft_channel_get) refuses the edit if the channel changed since; ' +
      'dryRun previews. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), channel: z.string().min(1), operations: z.array(channelOperation).min(1),
      expectedToken: z.string().optional(), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, channel, operations, expectedToken, dryRun }) => {
    const name = channel.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    const current = await gate.provider.readChannelDocument(name);
    if (!current) throw new Error(`There is no message channel ${name}; use psft_channel_create.`);
    if (expectedToken && expectedToken !== current.token) throw new Error(`${name} changed since it was read (token ${current.token}); read it again with psft_channel_get.`);
    let doc = current.doc;
    for (const [i, o] of operations.entries()) {
      try { doc = applyChannelOperation(doc, o); } catch (e) { throw new Error(`Operation ${i + 1} (${o.op}): ${e instanceof Error ? e.message : String(e)}`); }
    }
    return saveDoc(gate, doc, current.token, !!dryRun, `edit message channel ${name} (${operations.length} change${operations.length === 1 ? '' : 's'})`);
  });

  server.registerTool('psft_channel_copy', {
    title: 'Message channel: copy a channel (Save As)',
    description: 'Saves a copy of a message channel under a new name, as App Designer\'s Save As does: its properties and checked partition fields. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), channel: z.string().min(1), to: z.string().min(1).max(CHANNEL_NAME_MAX), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, channel, to, dryRun }) => {
    const target = to.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, target);
    const { doc } = await read(connection, channel);
    if (await gate.provider.readChannelDocument(target)) throw new Error(`A message channel named ${target} already exists.`);
    return saveDoc(gate, copyChannel(doc, target), 'absent', !!dryRun, `copy message channel ${doc.name} to ${target}`);
  });

  server.registerTool('psft_channel_rename', {
    title: 'Message channel: rename a channel',
    description: 'Renames a message channel as App Designer\'s Rename does: its rows under the new name, the messages naming it and its project items repointed. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), channel: z.string().min(1), to: z.string().min(1).max(CHANNEL_NAME_MAX), expectedToken: z.string().optional() }),
    annotations: DESTRUCTIVE
  }, async ({ connection, channel, to, expectedToken }) => {
    const target = to.trim().toUpperCase();
    const { name, token, doc } = await read(connection, channel);
    const gate = await writable(workspace, host, connection, name);
    await writable(workspace, host, connection, target);
    if (expectedToken && expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `rename message channel ${name} to ${target}`,
      `${name} becomes ${target}${doc.messages.length ? `; messages repointed: ${doc.messages.join(', ')}` : ''}; project items naming it follow.`);
    await gate.provider.renameChannelDefinition(name, target, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ renamed: { from: name, to: target }, token: (await gate.provider.readChannelDocument(target))?.token });
  });

  server.registerTool('psft_channel_delete', {
    title: 'Message channel: delete a channel',
    description: 'Deletes a message channel, as App Designer\'s Delete does (messages naming it keep the name; the name is recorded in PSCHNLDEL). Cannot be undone from here. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), channel: z.string().min(1), expectedToken: z.string().min(1).describe('From psft_channel_get: the channel as you last read it.') }),
    annotations: DESTRUCTIVE
  }, async ({ connection, channel, expectedToken }) => {
    const { name, token, doc } = await read(connection, channel);
    const gate = await writable(workspace, host, connection, name);
    if (expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `DELETE message channel ${name}`,
      `${name} is deleted${doc.messages.length ? `; ${doc.messages.length} message(s) still name it` : ''}.`);
    await gate.provider.deleteChannelDefinition(name, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ deleted: name });
  });
}
