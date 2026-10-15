/** Production HTTP MCP routing with fixture-backed providers; no database writes. */
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = process.cwd();
const { createStub } = await import(pathToFileURL(join(root, 'scripts/vscode-stub.mjs')).href);
const { vscode } = createStub();
const loader = (Module as any)._load;
(Module as any)._load = function(name: string, parent: unknown, main: boolean) { return name === 'vscode' ? vscode : loader.call(this, name, parent, main); };
const require = createRequire(join(root, 'package.json'));
const { DatabaseProvider } = require('./src/providers/database.ts');
const { startPeopleSoftMcpServer } = require('./src/mcp/server.ts');
const { setWriteNamePrefix } = require('./src/providers/writeScope.ts');
const { writeOrigin } = require('./src/providers/writeGuard.ts');
const { processEdit, processToken, validateProcessEdit } = require('./src/model/processEdit.ts');
const { newQueryDocument, applyQueryOp } = require('./src/model/queryDocument.ts');
const { queryToken } = require('./src/model/querySavePlan.ts');
const { compileQuerySql } = require('./src/model/querySql.ts');
const provider = new DatabaseProvider({ name: 'FIXTURE', platform: 'oracle', connectString: 'fixture', user: 'fixture', password: '' });
Object.defineProperty(provider, 'isConnected', { get: () => true });
let access = true, operator = 'JARED', mode = 'allow', dirty = false, accept = true, confirmed = 0, refreshed = 0;
const calls: string[] = [];
let processView = { process: { PRCSTYPE: 'SQR Report', PRCSNAME: 'ZZ_MCP_PROC', DESCR: 'Fixture process', VERSION: 1 }, components: [], groups: [{ PRCSGRP: 'ZZ_REPORT' }], translates: new Map() };
const field = { type: 0, length: 30, decimalPositions: 0, format: 6, shortName: 'Descr', longName: 'Description', editTable: '', useEdit: 0 };
const initial = applyQueryOp(newQueryDocument('ZZ_MCP_QRY', '', 'AAP_TBL'), { kind: 'select', field: 'DESCR', selected: true }, { DESCR: field });
const queries = new Map([[JSON.stringify(['ZZ_MCP_QRY', '']), initial]]);
provider.readProcessDocument = async () => structuredClone(processView);
provider.saveProcessDocument = async (request: any) => {
  assert.equal(writeOrigin(), 'agent'); calls.push('processSave');
  assert.equal(request.token, processToken(processView), 'stale process token');
  const edit = validateProcessEdit(request.edit, processView);
  const after = { ...structuredClone(processView), process: { ...processView.process, ...edit.properties, VERSION: processView.process.VERSION + 1 }, components: edit.components.map((PNLGRPNAME: string) => ({ PNLGRPNAME })), groups: edit.groups.map((PRCSGRP: string) => ({ PRCSGRP })) };
  if (!request.dryRun) processView = after;
  return after;
};
provider.readQueryDocument = async (name: string, owner: string) => { const view = queries.get(JSON.stringify([name, owner.trim()])); return view ? { view: structuredClone(view), token: queryToken(view) } : undefined; };
provider.searchQueries = async () => [{ key: { type: 10, parts: ['ZZ_MCP_QRY', ''] } }];
provider.readRecordLayout = async () => ({ recordType: 0, fields: [{ name: 'DESCR', ...field }] });
provider.prepareQuery = async (view: any) => compileQuerySql(view, { record: 'AAP_TBL', table: 'PS_AAP_TBL', recordType: 0, querySecurityRecord: '', fields: { DESCR: { type: 0 } } });
provider.runQuery = async (view: any, op: string, values: any, maxRows: number) => {
  assert.equal(op, 'JARED'); calls.push('queryRun');
  return { sql: (await provider.prepareQuery(view)).sql, rows: [{ DESCR: 'Fixture' }], maxRows, truncated: false, ms: 0, values };
};
provider.saveQueryDocument = async (request: any) => {
  assert.equal(writeOrigin(), 'agent'); calls.push('querySave');
  await provider.prepareQuery(request.view);
  const key = JSON.stringify([request.view.query.QRYNAME, request.view.query.OPRID.trim()]);
  const before = queries.get(key);
  assert.equal(request.openedToken, before ? queryToken(before) : 'absent', 'stale or existing query target');
  const after = structuredClone(request.view); after.query.VERSION = Number(before?.query.VERSION ?? 0) + 1;
  if (!request.dryRun) queries.set(key, after);
  return { view: after, token: queryToken(after), written: !request.dryRun, replaced: {} };
};
// Populate every configuration list so HTTP schema stripping cannot hide behind empty fixtures.
const pfcSequence = { SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1 };
const pfcConfiguration = {
  header: { DESCR: 'Fixture configuration', EFF_STATUS: 'A', EOCC_APPLY_LVL: 'S' },
  sequences: [{ ...pfcSequence, EOCC_APPLY_TO: 'U' }],
  criteria: [{ ...pfcSequence, RECNAME: 'AAP_TBL', FIELDNAME: 'DESCR', EOCC_CRITERIA_SYM: 'A', EOCC_VALUE_MATCH: 'Fixture' }],
  pages: [{ ...pfcSequence, PNLNAME: 'ZZ_MCP_PAGE', EOCC_VISIBLE_FLAG: 'N' }],
  fields: [{ ...pfcSequence, RECNAME: 'AAP_TBL', FIELDNAME: 'DESCR', EOCC_DISABLED: 'Y' }],
  seqUsers: [{ ...pfcSequence, OPRID: 'PS' }],
  seqExcludedUsers: [{ ...pfcSequence, OPRID: 'EXCLUDED' }],
  seqRoles: [{ ...pfcSequence, ROLENAME: 'Manager' }],
  seqExcludedRoles: [{ ...pfcSequence, ROLENAME: 'Employee' }],
  users: [{ OPRID: 'JARED' }], excludedUsers: [{ OPRID: 'EXCLUDED_HEADER' }],
  roles: [{ ROLENAME: 'HR Administrator' }], excludedRoles: [{ ROLENAME: 'HR Admin Approver Fluid' }]
};
const pfcPages = [{ page: 'ZZ_MCP_PAGE', label: 'Fixture page', type: 'P' }];
const pfcFields = [{ pageField: '0.AAP_TBL.DESCR.1.0.P', level: 0, record: 'AAP_TBL', field: 'DESCR', pnlfldid: 1, ownLevel: 0,
  page: 'ZZ_MCP_PAGE', componentPage: 'ZZ_MCP_PAGE', label: 'Description', fieldType: 4, fieldUse: 0, record1: '', field1: '', recordBase: '' }];
const pfcMasks = { profiles: [{ id: 'ZZ_MASK', label: 'Fixture mask', description: 'Fixture mask profile', type: 'C', isDefault: true }], fieldDefaults: { DESCR: 'ZZ_MASK' } };
const pfcSaveCalls: any[] = [];
const pfcCatalogCalls: any[] = [];
provider.readPageFieldConfiguration = async (component: string, market: string, type: string) => {
  assert.deepEqual([component, market, type], ['ZZ_MCP_COMP', 'GBL', 'STD']);
  return { exists: true, token: 'fixture-pfc-token', configuration: structuredClone(pfcConfiguration), derived: [], contentReferences: [] };
};
provider.readPageFieldCatalogPages = async (component: string, market: string) => {
  assert.deepEqual([component, market], ['ZZ_MCP_COMP', 'GBL']);
  return structuredClone(pfcPages);
};
provider.readPageFieldCatalogFields = async (page: string, type: string, options: any) => {
  pfcCatalogCalls.push({ page, type, options: structuredClone(options) });
  return structuredClone(pfcFields);
};
provider.readFieldDatabaseTypes = async (fields: readonly string[]) => { assert.deepEqual(fields, ['DESCR']); return new Map([['DESCR', 0]]); };
provider.readPageFieldMaskProfiles = async () => structuredClone(pfcMasks);
provider.savePageFieldConfiguration = async (request: any) => {
  assert.equal(writeOrigin(), 'agent');
  assert.equal(request.openedToken, 'fixture-pfc-token');
  assert.equal(request.operatorId, 'JARED');
  pfcSaveCalls.push(structuredClone(request));
  return { written: !request.dryRun, token: 'fixture-pfc-saved', rows: { empty: false, changes: ['Fixture PFC row change'] },
    mappings: { changes: [] }, warnings: [], derived: [] };
};
const workspace: any = { connections: [], activeProviders: [provider], require: async (id: string) => { assert.equal(id, provider.id, 'Workspace.require accepts canonical IDs, not connection names'); return provider; }, isWritable: () => access, configFor: () => ({ peoplesoftOperatorId: operator }) };
const host = { mode: () => mode, hasUnsavedEditor: () => dirty, saved: () => { refreshed++; }, confirm: async () => { confirmed++; return accept; } };
const server = await startPeopleSoftMcpServer(workspace, { port: 39519, writeHost: () => host });
let id = 0;
async function rpc(method: string, params: unknown) {
  const response = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const body = await response.text();
  const value = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data:'))!.slice(5));
  if (value.error) throw new Error(JSON.stringify(value.error));
  return value.result;
}
async function tool(name: string, args: object = {}, success = true) {
  const result = await rpc('tools/call', { name, arguments: { connection: 'FIXTURE', ...args } });
  assert.equal(!!result.isError, !success, result.content?.[0]?.text);
  return success ? JSON.parse(result.content[0].text) : undefined;
}
const checks: string[] = [];
const check = (name: string) => { checks.push(name); console.log('PASS ' + name); };
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-workflows', version: '1' } });
  assert.match(init.instructions, /psft_capability_catalog/);
  const advertised = (await rpc('tools/list', {})).tools;
  for (const name of ['psft_capability_catalog', 'psft_process_get', 'psft_process_save', 'psft_query_list', 'psft_query_get', 'psft_query_prepare', 'psft_query_run', 'psft_query_save', 'psft_query_create', 'psft_query_copy']) assert.ok(advertised.some((t: any) => t.name === name));
  check('server instructions and tools/list advertise the workflows');
  for (const name of ['psft_page_field_config_get', 'psft_page_field_config_fields', 'psft_page_field_config_save']) assert.ok(advertised.some((t: any) => t.name === name));
  check('PFC tools/list advertises get, fields and save');
  // Catalog has no connection input.
  const catalog = await rpc('tools/call', { name: 'psft_capability_catalog', arguments: { kind: 'definition', type: 10 } });
  assert.equal(JSON.parse(catalog.content[0].text).entries.length, 1);
  check('structured catalog filters via HTTP');
  const pk = { processType: 'SQR Report', name: 'ZZ_MCP_PROC' };
  const processBefore = await tool('psft_process_get', pk);
  const input = structuredClone(processBefore.input); input.properties.DESCR = 'Updated process';
  const edit = { ...pk, expectedToken: processBefore.token, input };
  mode = 'off'; await tool('psft_process_save', edit, false); mode = 'allow';
  access = false; await tool('psft_process_save', edit, false); access = true;
  operator = ''; await tool('psft_process_save', edit, false); operator = 'JARED';
  dirty = true; await tool('psft_process_save', edit, false); dirty = false;
  check('process off, read-only connection, missing operator and unsaved editor gates');
  mode = 'confirm'; accept = false; await tool('psft_process_save', edit, false); accept = true;
  const previews = confirmed;
  assert.equal((await tool('psft_process_save', { ...edit, dryRun: true })).saved, false);
  assert.equal(confirmed, previews);
  assert.equal((await tool('psft_process_get', pk)).token, processBefore.token);
  assert.equal((await tool('psft_process_save', edit)).saved, true);
  await tool('psft_process_save', edit, false);
  check('process decline, preview preservation, confirmed save and stale-token refusal');
  const pfk = { component: 'ZZ_MCP_COMP' };
  const pfcBefore = await tool('psft_page_field_config_get', pfk);
  assert.deepEqual(pfcBefore.configuration, pfcConfiguration);
  const pfcEdit = { ...pfk, expectedToken: pfcBefore.token, configuration: pfcBefore.configuration };
  const pfcConfirmsBefore = confirmed, pfcRefreshesBefore = refreshed;
  assert.equal((await tool('psft_page_field_config_save', { ...pfcEdit, dryRun: true })).saved, false);
  assert.equal(pfcSaveCalls.length, 1);
  assert.deepEqual(pfcSaveCalls[0].configuration, pfcConfiguration);
  check('PFC get to save HTTP round trip preserves every configuration and targeting list');
  assert.deepEqual(pfcSaveCalls.map(request => request.dryRun), [true]);
  assert.equal(confirmed, pfcConfirmsBefore);
  assert.equal(refreshed, pfcRefreshesBefore);
  check('PFC dry run only previews, without a write, confirmation or refresh');
  mode = 'off'; await tool('psft_page_field_config_save', pfcEdit, false); mode = 'confirm';
  assert.equal(pfcSaveCalls.length, 1);
  access = false; await tool('psft_page_field_config_save', pfcEdit, false); access = true;
  assert.equal(pfcSaveCalls.length, 1);
  operator = ''; await tool('psft_page_field_config_save', pfcEdit, false); operator = 'JARED';
  assert.equal(pfcSaveCalls.length, 1);
  assert.equal(confirmed, pfcConfirmsBefore);
  check('PFC off, read-only connection and missing operator gates refuse provider saves');
  accept = false; await tool('psft_page_field_config_save', pfcEdit, false); accept = true;
  assert.deepEqual(pfcSaveCalls.map(request => request.dryRun), [true, true]);
  assert.equal(confirmed, pfcConfirmsBefore + 1);
  assert.equal(refreshed, pfcRefreshesBefore);
  assert.equal((await tool('psft_page_field_config_save', pfcEdit)).saved, true);
  assert.deepEqual(pfcSaveCalls.map(request => request.dryRun), [true, true, true, undefined]);
  assert.equal(pfcSaveCalls.filter(request => !request.dryRun).length, 1);
  assert.deepEqual(pfcSaveCalls.at(-1).configuration, pfcConfiguration);
  assert.equal(confirmed, pfcConfirmsBefore + 2);
  assert.equal(refreshed, pfcRefreshesBefore + 1);
  check('PFC declined confirmation only previews; confirmed save writes once and refreshes');
  assert.deepEqual((await tool('psft_page_field_config_fields', pfk)).pages, pfcPages);
  const pfcCriteria = await tool('psft_page_field_config_fields', { ...pfk, page: 'ZZ_MCP_PAGE', criteria: true });
  assert.deepEqual(pfcCatalogCalls.at(-1), { page: 'ZZ_MCP_PAGE', type: 'P', options: { mask: false, criteria: true } });
  assert.equal(pfcCriteria.count, 1);
  assert.deepEqual(pfcCriteria.fields, [{ label: 'Description', recordField: 'AAP_TBL.DESCR', level: 0,
    row: { RECNAME: 'AAP_TBL', FIELDNAME: 'DESCR', PNLFLDID: 1, EOCC_CRITERIA_SYM: 'A', PNLNAME: 'ZZ_MCP_PAGE', EOCC_VALUE_MATCH: '',
      OCCURSLEVEL: 0, EOCC_FIELD_TYPE: 0, LBLTEXT: 'Description', RECNAME1: ' ', FIELDNAME1: ' ', RECNAME_BASE: ' ' } }]);
  assert.deepEqual(pfcCriteria.operators, {
    A: 'Equals', F: 'Not Equals', B: 'Less Than', C: 'Greater Than', D: 'Not Greater Than', E: 'Not Less Than',
    G: 'Contains No Value (no value)', H: 'Contains Value (no value)', I: 'Between (EOCC_VALUE_MATCH and EOCC_VALUE_MATCH2)',
    J: 'Not Between (EOCC_VALUE_MATCH and EOCC_VALUE_MATCH2)', K: 'In List (comma-separated values)', O: 'Not in List (comma-separated values)',
    L: 'Begins With', M: 'Contains', N: 'Does not Contain'
  });
  check('PFC field discovery returns fixture pages, criteria rows and the operators map');
  const pfcMasked = await tool('psft_page_field_config_fields', { ...pfk, page: 'ZZ_MCP_PAGE', mask: true });
  assert.deepEqual(pfcCatalogCalls.at(-1), { page: 'ZZ_MCP_PAGE', type: 'P', options: { mask: true, criteria: false } });
  assert.deepEqual(pfcMasked.maskProfiles, pfcMasks.profiles);
  assert.equal(pfcMasked.count, 1);
  assert.equal(pfcMasked.fields[0].recordField, 'AAP_TBL.DESCR');
  assert.equal(pfcMasked.fields[0].row.EOCC_MASK_FLAG, 'Y');
  assert.equal(pfcMasked.fields[0].row.EOCC_MASK_ID, 'ZZ_MASK');
  check('PFC mask discovery returns maskProfiles and applies the fixture mask to field rows');
  const qk = { name: 'ZZ_MCP_QRY' };
  await tool('psft_query_list');
  const qb = await tool('psft_query_get', qk);
  assert.equal(qb.execution.supported, true);
  assert.match((await tool('psft_query_prepare', qk)).sql, /PS_AAP_TBL/);
  await tool('psft_query_get', { ...qk, owner: 'OTHER' }, false);
  const runCount = calls.filter(c => c === 'queryRun').length;
  await tool('psft_query_run', { ...qk, maxRows: 10001 }, false);
  assert.equal(calls.filter(c => c === 'queryRun').length, runCount);
  assert.equal((await tool('psft_query_run', { ...qk, maxRows: 1 })).rows.length, 1);
  check('Query list, get, SQL preview, private owner refusal and bounded run');
  const qedit = { ...qk, expectedToken: qb.token, operations: [{ kind: 'properties', description: 'MCP query', comments: '' }] };
  dirty = true; await tool('psft_query_save', qedit, false); dirty = false;
  const beforePreview = confirmed;
  await tool('psft_query_save', { ...qedit, dryRun: true });
  assert.equal(confirmed, beforePreview);
  assert.equal((await tool('psft_query_get', qk)).token, qb.token);
  assert.equal((await tool('psft_query_save', qedit)).saved, true);
  await tool('psft_query_save', qedit, false);
  mode = 'off'; await tool('psft_query_save', qedit, false); mode = 'confirm';
  access = false; await tool('psft_query_save', qedit, false); access = true;
  setWriteNamePrefix('ZZ_');
  await tool('psft_query_save', { ...qedit, name: 'OUTSIDE_SCOPE' }, false);
  await tool('psft_process_save', { ...edit, name: 'OUTSIDE_SCOPE' }, false);
  setWriteNamePrefix('');
  check('Query dirty editor, off, access and shared name-scope gates; preview preservation and stale-token refusal');
  const latest = await tool('psft_query_get', qk);
  const copy = { ...qk, expectedSourceToken: latest.token, targetName: 'ZZ_MCP_COPY' };
  await tool('psft_query_copy', { ...copy, targetOwner: 'OTHER' }, false);
  assert.equal((await tool('psft_query_copy', copy)).saved, true);
  assert.equal((await tool('psft_query_get', qk)).token, latest.token);
  await tool('psft_query_copy', copy, false);
  const create = { name: 'ZZ_MCP_NEW', owner: 'JARED', record: 'AAP_TBL', operations: [{ kind: 'select', field: 'DESCR', selected: true }] };
  assert.equal((await tool('psft_query_create', create)).saved, true);
  await tool('psft_query_create', create, false);
  check('Query copy preserves source and create/copy refuse existing or foreign-owner targets');
  assert.ok(refreshed >= 4);
} finally { await server.dispose(); setWriteNamePrefix(''); }
const readOnly = await startPeopleSoftMcpServer(workspace, { port: 39520 });
try {
  const response = await fetch(readOnly.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  const body = await response.text();
  const value = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data:'))!.slice(5));
  const names = value.result.tools.map((tool: any) => tool.name);
  assert.ok(names.includes('psft_query_run') && names.includes('psft_process_get'));
  for (const name of ['psft_process_save', 'psft_query_save', 'psft_query_create', 'psft_query_copy']) assert.ok(!names.includes(name));
  check('read-only server exposes reads and bounded Query execution without authoring tools');
  assert.ok(names.includes('psft_page_field_config_get') && names.includes('psft_page_field_config_fields'));
  assert.ok(!names.includes('psft_page_field_config_save'));
  check('read-only server advertises PFC get and fields without save');
} finally { await readOnly.dispose(); }


// Real editor session registries: clean panels refresh, dirty drafts survive.
const { QueryDesignerPanel } = require('./src/editors/queryDesignerPanel.ts');
const queryKey = JSON.stringify(['ZZ_MCP_QRY', '']);
let queryReloads = 0;
await QueryDesignerPanel.show(provider, { view: queries.get(queryKey), token: queryToken(queries.get(queryKey)) }, {
  editable: true, metadata: { DESCR: { ...field, labels: [] } },
  prepare: (view: any) => provider.prepareQuery(view),
  reload: async () => { queryReloads++; return provider.readQueryDocument('ZZ_MCP_QRY', ''); },
  run: async () => { throw new Error('not used'); }, save: async () => { throw new Error('not used'); }, saveAs: async () => {}
});
const queryPanel = vscode._panels.at(-1);
await QueryDesignerPanel.reloadIfOpen(provider.id, 'ZZ_MCP_QRY', '');
assert.equal(queryReloads, 1);
queryPanel._receive({ kind: 'op', op: { kind: 'properties', description: 'Unsaved draft', comments: '' } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(QueryDesignerPanel.hasUnsaved(provider.id, 'ZZ_MCP_QRY', ''), true);
await QueryDesignerPanel.reloadIfOpen(provider.id, 'ZZ_MCP_QRY', '');
assert.equal(queryReloads, 1, 'dirty draft must not be reloaded');
queryPanel.dispose();
assert.equal(QueryDesignerPanel.hasUnsaved(provider.id, 'ZZ_MCP_QRY', ''), false);
check('real Query designer registry protects dirty drafts and refreshes clean sessions');

const { ProcessEditorProvider } = require('./src/editors/processEditor.ts');
const { toUri } = require('./src/util/uri.ts');
workspace.requireByHandle = async () => provider;
const processEditor = new ProcessEditorProvider(workspace);
const processKey = { type: 20, parts: ['SQR Report', 'ZZ_MCP_PROC'] };
const doc = await processEditor.openCustomDocument(toUri(provider.id, processKey), {});
const processPanel = vscode.window.createWebviewPanel('psft.processEditor', 'Fixture', 1, {});
await processEditor.resolveCustomEditor(doc, processPanel);
const draft = processEdit(processView); draft.properties.DESCR = 'Dirty process draft';
processPanel._receive({ type: 'edit', edit: draft });
await doc.queue;
assert.equal(ProcessEditorProvider.hasUnsaved(provider.id, processKey), true);
await ProcessEditorProvider.reloadIfOpen(provider.id, processKey);
assert.equal(doc.edit.properties.DESCR, 'Dirty process draft');
await processEditor.revertCustomDocument(doc);
processView.process.DESCR = 'External process save';
await ProcessEditorProvider.reloadIfOpen(provider.id, processKey);
assert.equal(doc.edit.properties.DESCR, 'External process save');
doc.dispose(); processPanel.dispose();
assert.equal(ProcessEditorProvider.hasUnsaved(provider.id, processKey), false);
check('real Process editor registry protects dirty drafts and refreshes clean documents');


// Staged workflow uses the production MCP wrapper and real review UI handlers.
const { ReviewService } = require('./src/changeReview/service.ts');
const { ReviewStore } = require('./src/changeReview/store.ts');
const { ReviewWorkspace } = require('./src/changeReview/workspace.ts');
const { databaseReviewAdapters } = require('./src/changeReview/adapters.ts');
const { isReviewedWrite } = require('./src/changeReview/authorization.ts');
const fs = await import('node:fs/promises');
const os = await import('node:os');
const reviewRoot = await fs.mkdtemp(join(os.tmpdir(),'psft-review-http-'));
const sqlDefinitions = new Map<string,{text:string;version:number}>();
let nativeWrites = 0;
provider.changeReviewIdentity = async () => 'fixture-database-and-schema';
provider.readSqlForEdit = async (key:any) => sqlDefinitions.get(key.parts[0]);
provider.sqlIdTaken = async (name:string) => sqlDefinitions.has(name);
provider.classifyDefinition = async () => ({ classification:{ownership:'CUSTOM',confidence:'HIGH',evidence:['Fixture ownership only']},evidence:{exists:true} });
provider.saveSqlDefinition = async (request:any) => {
 assert.ok(isReviewedWrite(provider.id,{type:30,parts:[request.sqlId,'0']}),'exact reviewed key must match the provider guard');
 assert.equal(writeOrigin(),'agent');
 const old = sqlDefinitions.get(request.sqlId);
 assert.equal(request.openedVersion,old?.version);
 sqlDefinitions.set(request.sqlId,{text:request.text,version:(old?.version??0)+1});nativeWrites++;
 return {version:(old?.version??0)+1,created:!old};
};
workspace.isSqlWritable = () => true;
let reviewUi:any;
const nativeAdapters = databaseReviewAdapters(workspace,()=>host);
const reviewService = new ReviewService(new ReviewStore(reviewRoot),{environment:nativeAdapters.environment,changed:()=>reviewUi?.changed()},nativeAdapters.adapters);
reviewUi = new ReviewWorkspace(reviewService);
const reviewServer = await startPeopleSoftMcpServer(workspace,{port:39521,writeHost:()=>host,reviewService});
async function reviewRpc(method:string,params:unknown) {
 const response=await fetch(reviewServer.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
 const body=await response.text(),value=JSON.parse(body.startsWith('{')?body:body.split('\n').find(line=>line.startsWith('data:'))!.slice(5));
 if(value.error)throw new Error(JSON.stringify(value.error));return value.result;
}
async function reviewCall(name:string,args:object){const r=await reviewRpc('tools/call',{name,arguments:args});assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);}
async function until(test:()=>Promise<boolean>){for(let n=0;n<200;n++){if(await test())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Review UI did not reach expected state');}
try{
 mode='confirm';const confirmsBefore=confirmed;
 const names=(await reviewRpc('tools/list',{})).tools.map((tool:any)=>tool.name);
 assert.ok(names.includes('psft_stage_object_change'));
 assert.ok(!names.includes('psft_approve_change_set')&&!names.includes('psft_apply_approved_change_set'));
 assert.deepEqual(await nativeAdapters.environment('FIXTURE'),await nativeAdapters.environment(provider.id),'connection names and canonical IDs resolve to the same reviewed environment');
 const autoStaged=await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_AUTO_REVIEW',text:'SELECT 1 FROM PS_INSTALLATION'});
 assert.equal(autoStaged.status,'REVIEW_REQUIRED');assert.equal(autoStaged.persisted,false);assert.equal(nativeWrites,0);
 await reviewService.cancel(autoStaged.changeSetId);
 check('review environment resolves connection names and IDs; compatibility save creates a staged set without writes');
 const set=await reviewCall('psft_create_change_set',{title:'HTTP staged SQL',connection:'FIXTURE'});
 const staged=await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_REVIEW_SQL',text:'SELECT 1 FROM DUAL',changeSetId:set.id});
 assert.equal(staged.status,'REVIEW_REQUIRED');assert.equal(nativeWrites,0);assert.equal(confirmed,confirmsBefore);
 assert.equal((await reviewCall('psft_validate_change_set',{changeSetId:set.id})).status,'READY_FOR_REVIEW');
 await reviewUi.show(set.id);const page=vscode._panels.at(-1);const current=await reviewService.store.get(set.id);
 assert.ok(page.webview.html.includes('NEW OBJECT'));
 page._receive({action:'approve',id:set.id,revision:current.revision-1});
 await until(async()=>page.webview.html.includes('Review page is stale'));
 assert.equal((await reviewService.store.get(set.id)).status,'READY_FOR_REVIEW');
 page._receive({action:'approve',id:set.id,revision:current.revision});
 await until(async()=>(await reviewService.store.get(set.id)).status==='APPROVED');
 page._receive({action:'apply',id:set.id,revision:current.revision});
 await until(async()=>(await reviewService.store.get(set.id)).status==='APPLIED');
 assert.equal(nativeWrites,1);assert.equal(confirmed,confirmsBefore);
 assert.equal(sqlDefinitions.get('ZZ_REVIEW_SQL')?.text,'SELECT 1 FROM DUAL');
 assert.ok((await reviewService.store.get(set.id)).checkpoint);
 check('production HTTP staging writes nothing; stale UI refused; trusted review/apply verifies SQL without modal approval');

 const {installCustomizationGuard}=require('./src/customizationGuard.ts');
 const {guardWrite,runAsAgent}=require('./src/providers/writeGuard.ts');
 const {withReviewedWrite}=require('./src/changeReview/authorization.ts');
 const guardContext={globalStorageUri:vscode.Uri.file(join(reviewRoot,'policy')),subscriptions:[] as any[]};
 installCustomizationGuard(guardContext,workspace);
 const originalClassification=provider.classifyDefinition;
 provider.classifyDefinition=async()=>({classification:{ownership:'DELIVERED',confidence:'HIGH',evidence:['Fixture delivered definition']},evidence:{exists:true}});
 const sqlKey={type:30,parts:['ZZ_REVIEW_SQL','0']};
 const priorSaveSql=provider.saveSqlDefinition;
 provider.saveSqlDefinition=async(request:any)=>{await guardWrite({provider,key:{type:30,parts:[request.sqlId,'0']},action:'save'});return priorSaveSql(request);};
 const guardSet=await reviewCall('psft_create_change_set',{title:'Delivered SQL exact revision',connection:'FIXTURE'});
 await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_REVIEW_SQL',text:'SELECT 2 FROM DUAL',changeSetId:guardSet.id});
 const guarded=await reviewCall('psft_validate_change_set',{changeSetId:guardSet.id});assert.equal(guarded.status,'READY_FOR_REVIEW');
 await reviewUi.show(guardSet.id);const guardPage=vscode._panels.at(-1);
 guardPage._receive({action:'approve',id:guardSet.id,revision:guarded.revision});await until(async()=>(await reviewService.store.get(guardSet.id)).status==='APPROVED');
 guardPage._receive({action:'apply',id:guardSet.id,revision:guarded.revision});await until(async()=>(await reviewService.store.get(guardSet.id)).status==='APPLIED');
 await assert.rejects(withReviewedWrite(provider.id,sqlKey,()=>runAsAgent(()=>guardWrite({provider,key:sqlKey,action:'save'})),'outdated-proof'),/Ownership or policy changed/);
 provider.classifyDefinition=originalClassification;
 guardContext.subscriptions.forEach((d:any)=>d.dispose());
 check('real delivered-object guard accepts exact reviewed revision and refuses changed proof without another modal');
 const querySet=await reviewCall('psft_create_change_set',{title:'HTTP staged Query',connection:'FIXTURE'});
 const stagedQuery=await reviewCall('psft_query_create',{connection:'FIXTURE',name:'ZZ_QRY_REVIEW',record:'AAP_TBL',operations:[{kind:'select',field:'DESCR',selected:true}],changeSetId:querySet.id});
 assert.equal(stagedQuery.status,'REVIEW_REQUIRED');assert.equal(await provider.readQueryDocument('ZZ_QRY_REVIEW',''),undefined);
 let validated=await reviewCall('psft_validate_change_set',{changeSetId:querySet.id});assert.equal(validated.status,'READY_FOR_REVIEW');
 await reviewUi.show(querySet.id);const queryReviewPage=vscode._panels.at(-1);
 queryReviewPage._receive({action:'approve',id:querySet.id,revision:validated.revision});
 await until(async()=>(await reviewService.store.get(querySet.id)).status==='APPROVED');
 queryReviewPage._receive({action:'apply',id:querySet.id,revision:validated.revision});
 await until(async()=>(await reviewService.store.get(querySet.id)).status==='APPLIED');
 assert.ok(await provider.readQueryDocument('ZZ_QRY_REVIEW',''));assert.equal(confirmed,confirmsBefore);
 check('production Query create stages and trusted UI applies exact semantic snapshot without modal approvals');

 const contentDefinitions=new Map<string,{text:string;description:string;version:number}>();
 provider.readReviewContent=async(key:any)=>contentDefinitions.get(JSON.stringify(key));
 const saveContent=async(type:number,request:any)=>{const key={type,parts:[request.name,...(type===51?['4']:[])]};assert.ok(isReviewedWrite(provider.id,key));const old=contentDefinitions.get(JSON.stringify(key));assert.equal(request.openedVersion,old?.version);contentDefinitions.set(JSON.stringify(key),{text:request.text,description:request.description,version:(old?.version??0)+1});return {version:(old?.version??0)+1};};
 provider.saveHtmlDefinition=async(request:any)=>saveContent(51,request);
 provider.saveStyleSheet=async(request:any)=>saveContent(50,request);
 const contentSet=await reviewCall('psft_create_change_set',{title:'HTTP content dependency group',connection:'FIXTURE'});
 await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:51,name:'ZZ_REVIEW_HTML',text:'<div>Review</div>\n',description:'Review HTML',changeSetId:contentSet.id});
 const firstContent=await reviewCall('psft_get_change_set',{changeSetId:contentSet.id});
 await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:50,name:'ZZ_REVIEW_CSS',text:'.review { color: blue; }\n',description:'Review CSS',changeSetId:contentSet.id,dependsOn:[firstContent.objects[0].id]});
 assert.equal(contentDefinitions.size,0);validated=await reviewCall('psft_validate_change_set',{changeSetId:contentSet.id});assert.equal(validated.status,'READY_FOR_REVIEW');
 await reviewUi.show(contentSet.id);const contentPage=vscode._panels.at(-1);
 contentPage._receive({action:'approve',id:contentSet.id,revision:validated.revision});await until(async()=>(await reviewService.store.get(contentSet.id)).status==='APPROVED');
 contentPage._receive({action:'apply',id:contentSet.id,revision:validated.revision});await until(async()=>(await reviewService.store.get(contentSet.id)).status==='APPLIED');assert.equal(contentDefinitions.size,2);
 assert.equal((await reviewService.reversalSupport(await reviewService.store.get(contentSet.id))).supported,false);
 check('HTML/style proposals share dependency-aware review, normalize before approval and disable unsupported creation reversal');
 const codeDefinitions=new Map<string,{text:string;fingerprint:string}>();
 const {compileForSave,compileTargetFor,prepareSourceForSave}=require('./src/peoplecode/writeback/savePlan.ts');
 provider.readPeopleCodeForEdit=async(key:any)=>codeDefinitions.get(JSON.stringify(key));
 provider.hasPeopleCode=async(key:any)=>codeDefinitions.has(JSON.stringify(key));
 provider.validateReviewedPeopleCode=async(_key:any,source:string)=>{compileForSave(prepareSourceForSave(source),compileTargetFor({objectIds:[1,2,12],objectValues:['ZZ_CODE','FIELD','FieldChange']}),'8.62');};
 provider.savePeopleCode=async(key:any,request:any)=>{
   assert.ok(isReviewedWrite(provider.id,key));const id=JSON.stringify(key),before=codeDefinitions.get(id);assert.equal(request.openedFingerprint,before?.fingerprint??'absent');
   if(request.source.trim())codeDefinitions.set(id,{text:prepareSourceForSave(request.source),fingerprint:String(Number(before?.fingerprint??0)+1)});else codeDefinitions.delete(id);
   return {kind:request.source.trim()?'saved':'deleted',fingerprint:codeDefinitions.get(id)?.fingerprint??'absent',storedSource:request.source,version:1};
 };
 workspace.isPeopleCodeWritable=()=>true;
 const codeSet=await reviewCall('psft_create_change_set',{title:'HTTP reviewed event PeopleCode',connection:'FIXTURE'});
 await reviewCall('psft_save_peoplecode',{connection:'FIXTURE',type:8,parts:['ZZ_CODE','FIELD','FieldChange'],source:'WinMessage("Review");',changeSetId:codeSet.id});
 assert.equal(codeDefinitions.size,0);validated=await reviewCall('psft_validate_change_set',{changeSetId:codeSet.id});assert.equal(validated.status,'READY_FOR_REVIEW');
 await reviewUi.show(codeSet.id);const codePage=vscode._panels.at(-1);
 codePage._receive({action:'approve',id:codeSet.id,revision:validated.revision});await until(async()=>(await reviewService.store.get(codeSet.id)).status==='APPROVED');
 codePage._receive({action:'apply',id:codeSet.id,revision:validated.revision});await until(async()=>(await reviewService.store.get(codeSet.id)).status==='APPLIED');assert.equal(codeDefinitions.size,1);
 let reversal=await reviewCall('psft_prepare_revert',{changeSetId:codeSet.id});reversal=await reviewCall('psft_validate_change_set',{changeSetId:reversal.id});
 await reviewUi.show(reversal.id);codePage._receive({action:'approve',id:reversal.id,revision:reversal.revision,destructive:true});await until(async()=>(await reviewService.store.get(reversal.id)).status==='APPROVED');
 codePage._receive({action:'apply',id:reversal.id,revision:reversal.revision});await until(async()=>(await reviewService.store.get(reversal.id)).status==='APPLIED');assert.equal(codeDefinitions.size,0);
 assert.equal((await reviewService.store.get(codeSet.id)).status,'REVERTED');
 const forward=await reviewCall('psft_prepare_redo',{changeSetId:codeSet.id});assert.equal(forward.status,'DRAFT');assert.equal(codeDefinitions.size,0);
 check('authoritative event source stages, existing compiler validates, UI applies and checkpoint deletion/reversal prepares redo');


}finally{reviewUi.dispose();await reviewServer.dispose();await fs.rm(reviewRoot,{recursive:true,force:true});}

console.log(JSON.stringify({ mode: 'fixture-backed production HTTP MCP; no live database', checks: checks.length }));
