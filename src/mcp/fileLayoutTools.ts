import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { copyLayout, newLayout, validateFileLayout, type FileLayoutDocument } from '../model/fileLayoutDocument.js';
import { applyFileLayoutOperations, fileLayoutOperation, fileLayoutView, type FileLayoutOperation } from '../model/fileLayoutOperations.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, DESTRUCTIVE, GATES, READ_ONLY, WRITE, writable, type Gate, type McpWriteHost } from './writeTools.js';

/*
 * File Layouts through the MCP (docs/FILE_LAYOUTS.md): the File Layout
 * window's model (model/fileLayoutDocument.ts), changed by its Insert menu,
 * property dialogs, Delete and move operations (fileLayoutOperations.ts) and
 * saved by its writer (providers/fileLayoutWriter.ts), proven against App
 * Designer's own saves (fl01-fl15) and App Designer reopening and saving a
 * writer-made layout (nfl01).
 */

export const FILE_LAYOUT_REFERENCE = `File Layouts, as App Designer builds them (docs/FILE_LAYOUTS.md):
- A layout (PSFLDDEFN) has a format -- FIXED (positions), CSV (delimited, qualified) or XML (tags) -- and a tree of segments (PSFLDSEGDEFN), each a kind of line in the file, with its fields (PSFLDFIELDDEFN).
- Insert > Record makes a segment named after the record with every record field (type, length and decimals from the field definition; Time and Datetime 5 longer) at consecutive positions. PeopleCode reads and writes such a segment with ReadRowset / WriteRecord into that record.
- Insert > Segment / ChildSegment and FileField build segments that are not a record (headers, trailers, totals).
- A multi-segment file tells its lines apart by each segment's File Record ID (recordId, with idStart / idLength); set shiftStarts to the ID length to move FIXED fields past it, as App Designer offers.
- CSV: the layout's qualifier (") and delimiter; each segment's Field Delimiter (Comma, Semicolon, Tab, Space, Other) and Default Qualifier (copied to its fields).
- FIXED: start and length per field; overlaps are allowed (App Designer saves them); Propagate moves a field and all after it.
- Strip characters are stored with a ~ terminator, added on save. A field's date separator is cleared unless it is a date, time or datetime.`;

async function databaseProvider(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const p = await requireProvider(workspace, connection);
  if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; File Layouts are read from a database connection.`);
  if (!p.isConnected) throw new Error(`${p.displayName} is not connected.`);
  return p;
}

const key = (name: string): DefinitionKey => ({ type: DefinitionType.FileLayout, parts: [name] });
const problems = (doc: FileLayoutDocument) => {
  const ps = validateFileLayout(doc);
  return { errors: ps.filter((p) => p.severity === 'error').map((p) => `${p.path}: ${p.message}`), warnings: ps.filter((p) => p.severity === 'warning').map((p) => `${p.path}: ${p.message}`) };
};

export function registerFileLayoutTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  const read = async (connection: string, layout: string) => {
    const p = await databaseProvider(workspace, connection);
    const name = layout.trim().toUpperCase();
    const r = await p.readFileLayoutDocument(name);
    if (!r) throw new Error(`There is no File Layout ${name} on ${p.displayName}.`);
    return { p, name, ...r };
  };

  server.registerTool('psft_file_layout_reference', {
    title: 'File Layout: how layouts are built',
    description: 'How File Layouts are built in App Designer and what the File Layout tools take. Read before creating or editing one.',
    inputSchema: z.object({}).strict(), annotations: READ_ONLY
  }, async () => jsonResult({ reference: FILE_LAYOUT_REFERENCE }));

  server.registerTool('psft_file_layout_get', {
    title: 'File Layout: get a layout',
    description: 'A File Layout as its window shows it: format and options, segments as a tree (parent), each field\'s type, start, length, decimals, qualifier, ' +
      'date format, strip characters, default and flags; its concurrency token and VERSION. Pass the token to psft_file_layout_edit as expectedToken.',
    inputSchema: z.object({ connection: z.string().min(1), layout: z.string().min(1) }).strict(), annotations: READ_ONLY
  }, async ({ connection, layout }) => {
    const { p, doc, token, version } = await read(connection, layout);
    return jsonResult({ connection: p.displayName, token, version, layout: fileLayoutView(doc), validation: problems(doc) });
  });

  if (!host) return;

  const save = async (gate: Gate, doc: FileLayoutDocument, token: string, dryRun: boolean, action: string, steps: string[]) => {
    const v = problems(doc);
    if (v.errors.length) throw new Error(`The File Layout has errors: ${v.errors.join('; ')}`);
    if (!dryRun) await approve(host, gate, key(doc.name), action, `${steps.join('\n')}${v.warnings.length ? `\n\nWarnings:\n${v.warnings.join('\n')}` : ''}`);
    const r = await gate.provider.saveFileLayoutDocument({ doc, openedToken: token, operatorId: gate.operatorId, dryRun });
    if (r.written) host.saved(gate.provider.id, key(doc.name));
    return jsonResult({ saved: r.written, dryRun, version: r.version, token: r.token, changes: r.plan.summary.changes, warnings: v.warnings, layout: fileLayoutView(doc) });
  };
  const records = (p: DatabaseProvider) => (record: string) => p.fileLayoutRecordFields(record);

  server.registerTool('psft_file_layout_create', {
    title: 'File Layout: create a layout',
    description: 'Creates a File Layout as App Designer\'s File > New does, built by the same operations as psft_file_layout_edit (set_layout for the format, ' +
      'insert_record for a record\'s segment, insert_segment / insert_field for headers and trailers, set_segment / set_field for their properties). ' +
      'At least one segment. dryRun writes and verifies the rows, then rolls back. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), layout: z.string().min(1).max(30), operations: z.array(fileLayoutOperation).min(1), dryRun: z.boolean().optional() }).strict(),
    annotations: WRITE
  }, async ({ connection, layout, operations, dryRun }) => {
    const name = layout.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    if (await gate.provider.readFileLayoutDocument(name)) throw new Error(`A File Layout named ${name} already exists; change it with psft_file_layout_edit.`);
    const doc = newLayout(name);
    const steps = await applyFileLayoutOperations(doc, operations as FileLayoutOperation[], records(gate.provider));
    return save(gate, doc, 'absent', !!dryRun, `create File Layout ${name}`, steps);
  });

  server.registerTool('psft_file_layout_edit', {
    title: 'File Layout: edit a layout',
    description: 'Applies operations to a File Layout and saves it as App Designer does: layout properties, Insert Record / Segment / ChildSegment / FileField, ' +
      'segment and field properties (with App Designer\'s side effects: a segment\'s qualifier goes to its fields, strip characters get their ~, Propagate), ' +
      'delete and move segments and fields. expectedToken from psft_file_layout_get rejects a stale edit. dryRun rolls back. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), layout: z.string().min(1), expectedToken: z.string().min(1), operations: z.array(fileLayoutOperation).min(1),
      dryRun: z.boolean().optional() }).strict(),
    annotations: WRITE
  }, async ({ connection, layout, expectedToken, operations, dryRun }) => {
    const { name, doc, token } = await read(connection, layout);
    const gate = await writable(workspace, host, connection, name);
    if (expectedToken !== token) throw new Error(`${name} changed since it was read; read it again with psft_file_layout_get.`);
    if (host.hasUnsavedEditor(gate.provider.id, key(name))) throw new Error(`${name} is open in VS Code with unsaved changes; the user must save or revert them first.`);
    const steps = await applyFileLayoutOperations(doc, operations as FileLayoutOperation[], records(gate.provider));
    return save(gate, doc, token, !!dryRun, `edit File Layout ${name}`, steps);
  });

  server.registerTool('psft_file_layout_copy', {
    title: 'File Layout: copy a layout (Save As)',
    description: 'Saves a copy of a File Layout under a new name, as App Designer\'s Save As does: every segment and field. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), layout: z.string().min(1), to: z.string().min(1).max(30), dryRun: z.boolean().optional() }).strict(),
    annotations: WRITE
  }, async ({ connection, layout, to, dryRun }) => {
    const target = to.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, target);
    const { doc } = await read(connection, layout);
    if (await gate.provider.readFileLayoutDocument(target)) throw new Error(`A File Layout named ${target} already exists.`);
    return save(gate, copyLayout(doc, target), 'absent', !!dryRun, `copy File Layout ${doc.name} to ${target}`, [`${doc.name} saved as ${target}`]);
  });

  server.registerTool('psft_file_layout_rename', {
    title: 'File Layout: rename a layout',
    description: 'Renames a File Layout as App Designer\'s Rename does: its rows under the new name, the old name recorded in PSFLDDEL, project items repointed. ' +
      'PeopleCode that names the layout (FileLayout.NAME, SetFileLayout) is not changed. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), layout: z.string().min(1), to: z.string().min(1).max(30), expectedToken: z.string().min(1) }).strict(),
    annotations: DESTRUCTIVE
  }, async ({ connection, layout, to, expectedToken }) => {
    const target = to.trim().toUpperCase();
    const { name, token } = await read(connection, layout);
    const gate = await writable(workspace, host, connection, name);
    await writable(workspace, host, connection, target);
    if (expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `rename File Layout ${name} to ${target}`, `${name} becomes ${target}; project items naming it follow. PeopleCode naming ${name} is not changed.`);
    const r = await gate.provider.renameFileLayoutDefinition(name, target, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ renamed: { from: name, to: target }, token: r.token, version: r.version });
  });

  server.registerTool('psft_file_layout_delete', {
    title: 'File Layout: delete a layout',
    description: 'Deletes a File Layout as App Designer\'s Delete does (the name is recorded in PSFLDDEL; project items keep it). Cannot be undone from here. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), layout: z.string().min(1), expectedToken: z.string().min(1) }).strict(),
    annotations: DESTRUCTIVE
  }, async ({ connection, layout, expectedToken }) => {
    const { name, token, doc } = await read(connection, layout);
    const gate = await writable(workspace, host, connection, name);
    if (expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `DELETE File Layout ${name}`, `${name} (${doc.segments.length} segment(s)) is deleted.`);
    await gate.provider.deleteFileLayoutDefinition(name, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ deleted: name });
  });
}
