import { querySnapshot } from '../changeReview/query.js';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { RecordType } from '../model/record.js';
import { applyQueryOp, copyQueryDocument, newQueryDocument, queryOpSchema, type QueryFieldInfo, type QueryOp } from '../model/queryDocument.js';
import type { QueryView } from '../model/queryDefinition.js';
import type { QueryEdit } from '../providers/queryWriter.js';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { READ_ONLY, WRITE, GATES, writable, approve, type McpWriteHost } from './writeTools.js';

const keyInput = { connection: z.string().min(1), name: z.string().min(1), owner: z.string().default('') };
const operations = z.array(queryOpSchema).max(100).default([]);

async function context(workspace: Workspace, connection: string, owner?: string) {
  const provider = await requireProvider(workspace, connection);
  if (!(provider instanceof DatabaseProvider)) throw new Error('PS Query tools require a database connection.');
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim() ?? '';
  if (!operatorId) throw new Error('Configure a PeopleSoft Operator ID before using PS Query tools.');
  if (owner?.trim() && owner.trim() !== operatorId) throw new Error('Only public queries and the configured operator\'s own private queries are accessible.');
  return { provider, operatorId };
}

async function load(provider: DatabaseProvider, name: string, owner: string): Promise<QueryEdit> {
  const edit = await provider.readQueryDocument(name, owner);
  if (!edit) throw new Error('Query not found.');
  return edit;
}

async function metadata(provider: DatabaseProvider, view: QueryView): Promise<Record<string, QueryFieldInfo>> {
  if (view.records.length !== 1) throw new Error('Editing requires one record; joins are not calibrated.');
  const layout = await provider.readRecordLayout(makeKey(DefinitionType.Record, String(view.records[0].RECNAME).trim()));
  if (!layout || layout.recordType !== RecordType.Table || layout.fields.some(field => field.isSubrecord)) throw new Error('Editing requires a SQL Table record without unexpanded subrecords.');
  return Object.fromEntries(layout.fields.filter(field => field.type !== undefined && field.length !== undefined).map(field => [field.name, {
    type: field.type!, length: field.length!, decimalPositions: field.decimalPositions ?? 0, format: field.format ?? 0,
    shortName: field.shortName, longName: field.longName, editTable: field.editTable, useEdit: field.useEdit
  }]));
}

export function registerQueryTools(server: McpServer, workspace: Workspace, host?: McpWriteHost): void {
  server.registerTool('psft_query_reference', {
    title: 'PS Query workflow and supported operations',
    description: 'Read before authoring or executing PS Query: supported shapes, public/private ownership, access checks, typed operations, prompts, concurrency and rollback previews.',
    inputSchema: z.object({}), annotations: READ_ONLY
  }, async () => jsonResult({
    key: ['query name', 'owner (blank for public; otherwise configured Operator ID)'],
    workflow: ['psft_query_list', 'psft_query_get', 'psft_query_prepare', 'psft_query_run or psft_query_save'],
    operationKinds: ['select', 'heading', 'order', 'constant', 'prompt', 'clearCriteria', 'properties'],
    limits: ['Authoring calibrated for Oracle PeopleTools 8.62.09 and 8.61.15 (other releases are refused): one SQL Table record, direct character fields, at most one ungrouped equal-to constant/prompt criterion. A constant or prompt on a field that is not selected adds it as a criteria-only field, as Windows Query\'s New Criteria does.', 'Joins, unions, subqueries, aggregates, DISTINCT, row-security SQL and other unsupported shapes are refused for execution/saving; definitions remain inspectable.', 'Only public queries and the configured operator\'s own private queries. Execution and saving check record Query access.', 'No rename or delete tool. Copy creates a new name/owner and requires an absent target.', 'Preview save rolls back after writer validation and readback; its token is hypothetical. Run executes bounded generated SELECT SQL in a read-only transaction, then rolls back.'],
    evidence: ['docs/PS_QUERY_WINDOWS.md', 'src/test/fixtures/query', 'src/providers/queryWriter.ts', 'src/providers/queryRunner.ts']
  }));

  server.registerTool('psft_query_list', {
    title: 'Find public and own private PS Queries', description: 'Search public queries and the configured operator\'s own private queries. SQL LIKE pattern; at most 500 entries.',
    inputSchema: z.object({ connection: z.string().min(1), pattern: z.string().default('%') }).strict(), annotations: READ_ONLY
  }, async ({ connection, pattern }) => {
    const { provider, operatorId } = await context(workspace, connection);
    const items = await provider.searchQueries(pattern, operatorId);
    return jsonResult({ items, limit: 500, possiblyTruncated: items.length === 500 });
  });

  server.registerTool('psft_query_get', {
    title: 'Read a PS Query with its concurrency token', description: 'Read native query rows and a save token. Returns execution support diagnostics without hiding an unsupported definition. Private owner must match the configured Operator ID.',
    inputSchema: z.object(keyInput).strict(), annotations: READ_ONLY
  }, async ({ connection, name, owner }) => {
    const { provider, operatorId } = await context(workspace, connection, owner);
    const edit = await load(provider, name, owner);
    let execution;
    try { execution = { supported: true, plan: await provider.prepareQuery(edit.view, operatorId) }; }
    catch (error) { execution = { supported: false, reason: error instanceof Error ? error.message : String(error) }; }
    return jsonResult({ ...edit, execution });
  });

  server.registerTool('psft_query_prepare', {
    title: 'Preview generated PS Query SQL and prompts', description: 'Generate SQL and active prompts for a saved query using the existing Query access checks and supported-shape compiler. Does not run SQL or save changes.',
    inputSchema: z.object(keyInput).strict(), annotations: READ_ONLY
  }, async ({ connection, name, owner }) => {
    const { provider, operatorId } = await context(workspace, connection, owner);
    return jsonResult(await provider.prepareQuery((await load(provider, name, owner)).view, operatorId));
  });

  server.registerTool('psft_query_run', {
    title: 'Run a bounded read-only PS Query', description: 'Execute generated SQL for a saved public or own private query with record Query access and prompt validation. Values are keyed by prompt number. Always rolls back the read-only transaction; 1–10000 rows, default 500. Unsupported query shapes are refused.',
    inputSchema: z.object({ ...keyInput, values: z.record(z.string(), z.string()).default({}), maxRows: z.number().int().min(1).max(10000).default(500) }).strict(), annotations: READ_ONLY
  }, async ({ connection, name, owner, values, maxRows }) => {
    const { provider, operatorId } = await context(workspace, connection, owner);
    return jsonResult(await provider.runQuery((await load(provider, name, owner)).view, operatorId, values, maxRows));
  });

  if (!host) return;
  // Each mutation starts from host-read rows. The agent supplies typed operations,
  // never arbitrary table rows or executable SQL.
  async function save(connection: string, name: string, owner: string, expectedToken: string, ops: QueryOp[], dryRun: boolean,
    initial?: QueryView) {
    const gate = await writable(workspace, host!, connection, name);
    await context(workspace, connection, owner);
    const key = makeKey(DefinitionType.Query, name, owner.trim());
    if (host!.hasUnsavedEditor(gate.provider.id, key)) throw new Error('Query designer has unsaved changes. Save or discard them first.');
    const edit = initial ? { view: initial, token: 'absent' } : await load(gate.provider, name, owner);
    if (edit.token !== expectedToken) throw new Error('Query changed since it was read. Reload before saving.');
    const fields = await metadata(gate.provider, edit.view);
    let view = edit.view;
    for (const op of ops) view = applyQueryOp(view, op, fields);
    if (!dryRun) await approve(host!, gate, key, (initial ? 'create' : 'edit') + ' PS Query ' + name,
      JSON.stringify({ owner, operations: ops, record: view.records[0]?.RECNAME }, null, 2));
    const result = await gate.provider.saveQueryDocument({ view, openedToken: expectedToken, operatorId: gate.operatorId, dryRun });
    if (result.written) host!.saved(gate.provider.id, key);
    return jsonResult({ saved: result.written, dryRun, ...result });
  }

  server.registerTool('psft_query_save', {
    title: 'Preview or edit a saved PS Query', description: 'Apply typed Query designer operations to a host-read definition. Supply the token from psft_query_get; stale input is refused. dryRun runs the shared writer and readback, then rolls back without save approval. ' + GATES,
    inputSchema: z.object({ ...keyInput, expectedToken: z.string().min(1), operations, dryRun: z.boolean().default(false) }).strict(), annotations: WRITE
  }, async ({ connection, name, owner, expectedToken, operations, dryRun }) => save(connection, name, owner, expectedToken, operations, dryRun));

  server.registerTool('psft_query_create', {
    title: 'Preview or create a PS Query', description: 'Create a public or own private query from one SQL Table record and typed operations; select at least one character field. Existing targets are refused. dryRun rolls back. ' + GATES,
    inputSchema: z.object({ ...keyInput, record: z.string().min(1), operations, dryRun: z.boolean().default(false) }).strict(), annotations: WRITE
  }, async ({ connection, name, owner, record, operations, dryRun }) => {
    const view = newQueryDocument(name, owner, record);
    return save(connection, String(view.query.QRYNAME), owner, 'absent', operations, dryRun, view);
  });

  server.registerTool('psft_query_copy', {
    title: 'Preview or copy a PS Query to a new key', description: 'Save As using the existing Query designer model. Read the source first and supply expectedSourceToken. Source and target private owners must match the configured operator. Target must not exist; source is preserved. dryRun rolls back. ' + GATES,
    inputSchema: z.object({ ...keyInput, expectedSourceToken: z.string().min(1), targetName: z.string().min(1), targetOwner: z.string().default(''), operations, dryRun: z.boolean().default(false) }).strict(), annotations: WRITE
  }, async ({ connection, name, owner, expectedSourceToken, targetName, targetOwner, operations, dryRun }) => {
    const { provider } = await context(workspace, connection, owner);
    const source = await load(provider, name, owner);
    if (source.token !== expectedSourceToken) throw new Error('Source query changed since it was read. Reload before copying.');
    const view = copyQueryDocument(source.view, targetName, targetOwner);
    return save(connection, String(view.query.QRYNAME), targetOwner, 'absent', operations, dryRun, view);
  });
}

/** Same host-read operation construction as the designer, without invoking a writer. */
export async function prepareQueryReview(workspace:Workspace,tool:string,args:Record<string,unknown>) {
 const connection=String(args.connection),name=String(args.name),owner=String(args.owner??'');
 const {provider}=await context(workspace,connection,owner);
 let view:QueryView,expectedToken:string;
 if(tool==='psft_query_create'){view=newQueryDocument(name,owner,String(args.record));expectedToken='absent';}
 else {
  const source=await load(provider,name,owner);
  const supplied=tool==='psft_query_copy'?args.expectedSourceToken:args.expectedToken;
  if(source.token!==supplied)throw new Error('Query changed since it was read.');
  if(tool==='psft_query_copy'){
   await context(workspace,connection,String(args.targetOwner??''));view=copyQueryDocument(source.view,String(args.targetName),String(args.targetOwner??''));expectedToken='absent';
  }else{view=source.view;expectedToken=source.token;}
 }
 const fields=await metadata(provider,view);
 for(const op of (args.operations??[]) as QueryOp[])view=applyQueryOp(view,op,fields);
 return {key:[String(view.query.QRYNAME).trim(),String(view.query.OPRID).trim()],after:querySnapshot(view),expectedToken};
}
