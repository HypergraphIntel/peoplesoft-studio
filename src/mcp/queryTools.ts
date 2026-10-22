import { querySnapshot } from '../changeReview/query.js';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { RecordType } from '../model/record.js';
import { applyQueryOp, copyQueryDocument, describeQueryCriteria, newQueryDocument, queryOpSchema, type QueryCriterion, type QueryFieldInfo, type QueryOp, type QueryRecordInfo } from '../model/queryDocument.js';
import type { QueryView } from '../model/queryDefinition.js';
import type { QueryEdit } from '../providers/queryWriter.js';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { READ_ONLY, WRITE, DESTRUCTIVE, GATES, writable, approve, type McpWriteHost } from './writeTools.js';

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

async function recordFields(provider: DatabaseProvider, record: string): Promise<Record<string, QueryFieldInfo>> {
  const layout = await provider.readRecordLayout(makeKey(DefinitionType.Record, record));
  if (!layout || layout.recordType !== RecordType.Table) throw new Error(`${record}: editing requires a SQL Table record. Subrecord fields are not expanded.`);
  return Object.fromEntries(layout.fields.filter(field => field.type !== undefined && field.length !== undefined).map(field => [field.name, {
    type: field.type!, length: field.length!, decimalPositions: field.decimalPositions ?? 0, format: field.format ?? 0,
    shortName: field.shortName, longName: field.longName, editTable: field.editTable, useEdit: field.useEdit
  }]));
}
/** Records named by subquery operands, at any depth. */
const subqueryRecords = (criteria: QueryCriterion[]): string[] => criteria.flatMap(c => [c.value, c.value2].flatMap(v =>
  v && 'subquery' in v ? [v.subquery.record, ...subqueryRecords(v.subquery.criteria ?? [])] : []));
/** Field metadata for record A and every record the query has or a join, union or subquery operation adds. */
async function metadata(provider: DatabaseProvider, view: QueryView, ops: QueryOp[] = []): Promise<{ base: Record<string, QueryFieldInfo>; records: Record<string, QueryRecordInfo> }> {
  const names = [...new Set([...view.records.map(r => String(r.RECNAME).trim()), ...ops.flatMap(op => op.kind === 'join' || op.kind === 'union' ? [op.record]
    : op.kind === 'criteria' || op.kind === 'having' ? subqueryRecords(op.criteria) : [])])];
  const records: Record<string, QueryRecordInfo> = {};
  for (const name of names) records[name] = { fields: await recordFields(provider, name) };
  return { base: records[String(view.records[0].RECNAME).trim()].fields, records };
}

export function registerQueryTools(server: McpServer, workspace: Workspace, host?: McpWriteHost): void {
  server.registerTool('psft_query_reference', {
    title: 'PS Query workflow and supported operations',
    description: 'Read before authoring or executing PS Query: supported shapes, public/private ownership, access checks, typed operations, prompts, concurrency and rollback previews.',
    inputSchema: z.object({}), annotations: READ_ONLY
  }, async () => jsonResult({
    key: ['query name', 'owner (blank for public; otherwise configured Operator ID)'],
    workflow: ['psft_query_list', 'psft_query_get', 'psft_query_prepare', 'psft_query_run or psft_query_save'],
    operationKinds: ['select', 'heading', 'order', 'aggregate', 'translate', 'expression', 'distinct', 'constant', 'prompt', 'criteria', 'having', 'clearCriteria', 'join', 'union', 'properties'],
    limits: ['Authoring calibrated for Oracle PeopleTools 8.62.09 and 8.61.15 (other patches of those releases when their query tables match; other releases are refused). On 8.61.15: one SQL Table record, character fields and at most one equal-to constant/prompt criterion.',
      'On 8.62.09: number and date fields; criteria (replacing every WHERE criterion of the top level, or of a union with select): AND/OR, NOT, parentheses, equal, notEqual, greater, notGreater, less, notLess, like, notLike, isNull, isNotNull, inList/notInList (constant lists or a subquery), between/notBetween (two constants), exists/notExists (a subquery, no field), effective dating on a record EFFDT: effectiveDate (<=), effectiveDateNotLess (>=), effectiveDateLess (<), effectiveDateGreater (>) with currentDate, firstEffectiveDate and lastEffectiveDate with no value, with constant, field, prompt (existing number or new), list, expression (SQL text using A.FIELD references) or subquery {record, field, criteria} operands; dates as YYYY-MM-DD. Inside a subquery an unaliased field is its own record; A.FIELD correlates to the top level.',
      'Joins: standard and left outer (keys detected), related (prompt record, effective-dated as EFFDT <= current date). Aggregates sum/count/min/max/average on character and number columns derive GROUP BY; having criteria (AND only) compare an aggregated field. distinct; expression columns (character or number, with type length); translate short/long of a selected translate field with current date or a date field; union adds a select on the next alias, whose fields are named B.FIELD. A new query on an effective-dated record gets the EFFDT <= current date criterion, as Windows Query adds it.',
      'psft_query_get returns criteria described as criteria/having specs per select, ready to edit and send back. Row security combined with joins, translates, subqueries or unions (or keyed by OPRCLASS/ROWSECCLASS), nested subqueries, subqueries with unions, effective-dated subquery/union records, HAVING OR and other shapes are refused for execution/saving; definitions remain inspectable.', 'Only public queries and the configured operator\'s own private queries. Execution and saving check record Query access.', 'On Oracle PeopleTools 8.62, psft_query_delete and psft_query_rename are review-only: deletion has a typed recreation inverse; rename stages an absent-target copy plus old-key deletion and does not rewrite references. Both require developer approval/application in Change Review. Copy creates a new name/owner and requires an absent target.', 'Preview save rolls back after writer validation and readback; its token is hypothetical. Run executes bounded generated SELECT SQL in a read-only transaction, then rolls back.'],
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
    let criteria;
    try { criteria = Object.fromEntries(edit.view.selects.filter(sel => Number(sel.SELECTTYPE) !== 2).map(sel => [String(Number(sel.SELNUM)), describeQueryCriteria(edit.view, Number(sel.SELNUM))])); }
    catch (error) { criteria = { unsupported: error instanceof Error ? error.message : String(error) }; }
    return jsonResult({ ...edit, criteria, execution });
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
    const fields = await metadata(gate.provider, edit.view, ops);
    let view = edit.view;
    for (const op of ops) view = applyQueryOp(view, op, fields.base, fields.records);
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
    title: 'Preview or create a PS Query', description: 'Create a public or own private query from one SQL Table record and typed operations; select at least one field. Existing targets are refused. dryRun rolls back. ' + GATES,
    inputSchema: z.object({ ...keyInput, record: z.string().min(1), operations, dryRun: z.boolean().default(false) }).strict(), annotations: WRITE
  }, async ({ connection, name, owner, record, operations, dryRun }) => {
    const { provider } = await context(workspace, connection, owner);
    const view = newQueryDocument(name, owner, record, await recordFields(provider, record.trim().toUpperCase()));
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

  // Deletion and rename are Change Review operations only (8.62: PSQRYDEL tombstone, QDM counters, project/source reference checks).
  server.registerTool('psft_query_delete', {
    title: 'Stage deletion of a PS Query', description: 'Review-only DELETE of a public or own private query on Oracle PeopleTools 8.62. Supply the token from psft_query_get. The reviewed writer deletes the seven query tables\' rows and writes the PSQRYDEL marker with the next QDM version, as Query Manager\'s delete does; a project member or stored PeopleCode/SQL/content mention blocks it. Returns REVIEW_REQUIRED; the developer approves and applies in Change Review, which also offers typed undo (recreation).',
    inputSchema: z.object({ ...keyInput, expectedToken: z.string().min(1) }).strict(), annotations: DESTRUCTIVE
  }, async () => { throw new Error('Query deletion requires Change Review; no legacy deletion was performed.'); });
  server.registerTool('psft_query_rename', {
    title: 'Stage a PS Query rename', description: 'Review-only rename on Oracle PeopleTools 8.62, staged as one Change Set: the query copied to the new name/owner (the target must not exist) and the old key deleted with its PSQRYDEL marker. This is Save As plus reviewed deletion, not Query Manager\'s in-place Rename: references to the old name are not rewritten, and a project member or stored source mention of the old name blocks the deletion. Returns REVIEW_REQUIRED.',
    inputSchema: z.object({ ...keyInput, expectedToken: z.string().min(1), targetName: z.string().min(1), targetOwner: z.string().default('') }).strict(), annotations: DESTRUCTIVE
  }, async () => { throw new Error('Query rename requires Change Review; nothing was written.'); });
}

/** Deletion (one proposal) or rename (copy then delete) of a host-read query, for Change Review staging. */
export async function prepareQueryLifecycleReview(workspace: Workspace, tool: string, args: Record<string, unknown>) {
  const connection = String(args.connection), name = String(args.name).trim().toUpperCase(), owner = String(args.owner ?? '').trim();
  const { provider } = await context(workspace, connection, owner);
  if ((await provider.readEnvironment()).toolsRelease !== '8.62') throw new Error('Query deletion and rename are calibrated on Oracle PeopleTools 8.62.');
  const source = await load(provider, name, owner);
  if (source.token !== args.expectedToken) throw new Error('Query changed since it was read.');
  const remove = { key: [name, owner], after: null, expectedToken: source.token };
  if (tool === 'psft_query_delete') return [remove];
  const targetOwner = String(args.targetOwner ?? '').trim();
  await context(workspace, connection, targetOwner);
  const copy = copyQueryDocument(source.view, String(args.targetName), targetOwner), targetName = String(copy.query.QRYNAME).trim();
  if (targetName === name && targetOwner === owner) throw new Error('Rename to a different name or owner.');
  if (await provider.readQueryDocument(targetName, targetOwner)) throw new Error(`${targetName} already exists.`);
  return [{ key: [targetName, targetOwner], after: querySnapshot(copy), expectedToken: 'absent' }, remove];
}

/** Same host-read operation construction as the designer, without invoking a writer. */
export async function prepareQueryReview(workspace:Workspace,tool:string,args:Record<string,unknown>) {
 const connection=String(args.connection),name=String(args.name),owner=String(args.owner??'');
 const {provider}=await context(workspace,connection,owner);
 let view:QueryView,expectedToken:string;
 if(tool==='psft_query_create'){view=newQueryDocument(name,owner,String(args.record),await recordFields(provider,String(args.record).trim().toUpperCase()));expectedToken='absent';}
 else {
  const source=await load(provider,name,owner);
  const supplied=tool==='psft_query_copy'?args.expectedSourceToken:args.expectedToken;
  if(source.token!==supplied)throw new Error('Query changed since it was read.');
  if(tool==='psft_query_copy'){
   await context(workspace,connection,String(args.targetOwner??''));view=copyQueryDocument(source.view,String(args.targetName),String(args.targetOwner??''));expectedToken='absent';
  }else{view=source.view;expectedToken=source.token;}
 }
 const ops=(args.operations??[]) as QueryOp[],fields=await metadata(provider,view,ops);
 for(const op of ops)view=applyQueryOp(view,op,fields.base,fields.records);
 return {key:[String(view.query.QRYNAME).trim(),String(view.query.OPRID).trim()],after:querySnapshot(view),expectedToken};
}
