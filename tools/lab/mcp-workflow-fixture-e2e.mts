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
  assert.equal(init.serverInfo.version, require('./package.json').version, 'MCP handshake version must match the extension release.');
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
  const {pageTransaction}=require('./src/test/fixtures/pageTransaction.ts');
  const {buildPageLayout}=require('./src/model/pageLayout.ts');
  const pageDb=pageTransaction(), oldPageRead=provider.readPageLayout,oldConnection=provider.withConnection,oldGuard=provider.guard;
  let pageConnections=0,pageGuardCalls=0;
  provider.readPageLayout=async()=>({layout:buildPageLayout('ZZ_PREVIEW_PAGE',{page:pageDb.state().page,fields:[],components:[]}),order:''});
  provider.withConnection=async(fn:any)=>{pageConnections++;return fn(pageDb.connection);};
  provider.guard=async()=>{pageGuardCalls++;throw new Error('Fixture native save guard must not approve a preview.');};
  mode='confirm';accept=false;const pageConfirms=confirmed,pageRefreshes=refreshed;
  const pageArgs={page:'ZZ_PREVIEW_PAGE',expectedVersion:7,operations:[{op:'set_properties',description:'Preview page',comments:'Preview only'}],dryRun:true};
  const pagePreview=await tool('psft_edit_page',pageArgs);
  assert.equal(pagePreview.saved,false);assert.equal(pagePreview.preview,true);assert.equal(pagePreview.baseVersion,7);assert.equal(pagePreview.hypotheticalVersion,11);
  assert.deepEqual(pageDb.state(),pageDb.initial);assert.deepEqual(pageDb.counts(),{committed:0,rolledBack:1,updates:1});
  assert.equal(pageConnections,1,'provider must not verify a rolled-back hypothetical result on another connection');
  assert.equal(pageGuardCalls,0);assert.equal(confirmed,pageConfirms);assert.equal(refreshed,pageRefreshes);
  Object.defineProperty(provider,'types',{value:require('./src/db/connection.ts').ADAPTER_TYPES,configurable:true});
  const capturedPage=await tool('psft_edit_page',{...pageArgs,includeSnapshots:true});
  assert.equal(capturedPage.snapshots.before.value.tables.PSPNLDEFN[0].DESCR,'Original page');
  assert.equal(capturedPage.snapshots.after.value.tables.PSPNLDEFN[0].DESCR,'Preview page');
  assert.equal(capturedPage.snapshots.before.version,7);assert.equal(capturedPage.snapshots.after.version,11);
  assert.equal(pageDb.counts().committed,0);assert.deepEqual(pageDb.state(),pageDb.initial);
  assert.equal(pageConnections,2);delete provider.types;
  await tool('psft_edit_page',{...pageArgs,dryRun:false,includeSnapshots:true},false);
  await tool('psft_edit_page',{...pageArgs,expectedVersion:6},false);
  dirty=true;await tool('psft_edit_page',pageArgs,false);dirty=false;
  access=false;await tool('psft_edit_page',pageArgs,false);access=true;
  mode='off';await tool('psft_edit_page',pageArgs,false);mode='confirm';
  await tool('psft_edit_page',{...pageArgs,dryRun:false},false);
  assert.equal(confirmed,pageConfirms+1,'a normal save still asks the developer');assert.equal(pageConnections,2);assert.equal(refreshed,pageRefreshes);
  provider.readPageLayout=oldPageRead;provider.withConnection=oldConnection;provider.guard=oldGuard;mode='allow';accept=true;
  check('Page HTTP rollback preview uses the real native writer/provider, skips approval/refresh and refuses stale, dirty, readonly and disabled requests');
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
 const set=await reviewCall('psft_create_change_set',{title:'HTTP staged SQL <script>history</script>',connection:'FIXTURE'});
 const staged=await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_REVIEW_SQL',text:'SELECT 1 FROM DUAL',changeSetId:set.id});
 assert.equal(staged.status,'REVIEW_REQUIRED');assert.equal(nativeWrites,0);assert.equal(confirmed,confirmsBefore);
 assert.equal((await reviewCall('psft_validate_change_set',{changeSetId:set.id})).status,'READY_FOR_REVIEW');
 await reviewUi.show(set.id);const page=vscode._panels.at(-1);const current=await reviewService.store.get(set.id);
 // An older store read must not undo a newer explicit navigation selection.
 const originalList=reviewService.store.list;
 let releaseList!:()=>void, listEntered!:()=>void, holdList=true;
 const listGate=new Promise<void>(resolve=>{releaseList=resolve;}), listStarted=new Promise<void>(resolve=>{listEntered=resolve;});
 reviewService.store.list=async()=>{const sets=await originalList.call(reviewService.store);if(!holdList)return sets;holdList=false;listEntered();await listGate;return sets.filter((s:any)=>s.id!==set.id);};
 try {
  const obsolete=reviewUi.show(autoStaged.changeSetId);await listStarted;await reviewUi.show(set.id);
  const selectedHtml=page.webview.html;releaseList();await obsolete;
  assert.equal(reviewUi.selected,set.id,'an obsolete list must not reset the current selection');
  assert.equal(page.webview.html,selectedHtml,'an obsolete list must not replace the current review');
 } finally {releaseList();reviewService.store.list=originalList;}
 assert.equal(nativeWrites,0);assert.equal((await reviewService.store.get(set.id)).status,'READY_FOR_REVIEW');
 check('overlapping review navigation ignores an obsolete list without changing selection, approvals or writes');
 // A render that already selected its object can also finish its preview late.
 const originalDiff=reviewService.diff;
 let releaseDiff!:()=>void, diffEntered!:()=>void, holdDiff=true;
 const diffGate=new Promise<void>(resolve=>{releaseDiff=resolve;}), diffStarted=new Promise<void>(resolve=>{diffEntered=resolve;});
 reviewService.diff=async(...args:any[])=>{const result=await originalDiff.apply(reviewService,args);if(!holdDiff)return result;holdDiff=false;diffEntered();await diffGate;return result;};
 try {
  const obsolete=reviewUi.show(autoStaged.changeSetId);await diffStarted;await reviewUi.show(set.id);
  const selectedHtml=page.webview.html;releaseDiff();await obsolete;
  assert.equal(reviewUi.selected,set.id);assert.equal(page.webview.html,selectedHtml,'a late preview must not replace a newer review');
 } finally {releaseDiff();reviewService.diff=originalDiff;}
 assert.equal(nativeWrites,0);assert.equal((await reviewService.store.get(set.id)).status,'READY_FOR_REVIEW');
 check('overlapping review previews cannot replace a newer selection or its revision-bound actions');
 assert.ok(page.webview.html.includes('NEW OBJECT'));
 const {ChangeReviewView}=require('./src/views/changeReviewView.ts');
 const reviewTree=new ChangeReviewView(reviewService);
 const groups=await reviewTree.getChildren();
 const pendingNode=(await reviewTree.getChildren(groups.find((n:any)=>n.mode==='pending'))).find((n:any)=>n.set?.id===set.id);
 assert.ok(pendingNode);assert.deepEqual(reviewTree.getTreeItem(pendingNode).command.arguments,[set.id]);
 assert.equal(reviewTree.getTreeItem(pendingNode).command.command,'psft.changeReview.open');
 assert.ok(!/<button\b[^>]*data-action="apply"/.test(page.webview.html),'ready review must not offer application before approval');
 assert.ok(!/<button\b[^>]*data-action="reverse"/.test(page.webview.html),'unapplied proposals must not offer reversal');
 assert.ok(page.webview.html.includes('<summary>More actions</summary>'));
 if(process.env.PSFT_NAVIGATION_PREVIEW)await fs.writeFile('/tmp/psft-navigation-ready.html',page.webview.html);
 await reviewUi.show(undefined,'history');
 assert.ok(!page.webview.html.includes(`data-select="${set.id}"`),'pending proposal must not appear in completed history');
 page._receive({action:'listMode',mode:'pending'});
 await until(async()=>page.webview.html.includes(`data-select="${set.id}"`));
 assert.equal(nativeWrites,0);assert.equal((await reviewService.store.get(set.id)).status,'READY_FOR_REVIEW');
 await reviewUi.show(set.id);
 check('sidebar opens the exact pending set; history filtering and state-specific menus neither approve nor write');
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
 const completedGroups=await reviewTree.getChildren();
 assert.ok(!(await reviewTree.getChildren(completedGroups.find((n:any)=>n.mode==='pending'))).some((n:any)=>n.set?.id===set.id));
 assert.ok((await reviewTree.getChildren(completedGroups.find((n:any)=>n.mode==='history'))).some((n:any)=>n.set?.id===set.id));
 await reviewUi.show(undefined,'history');
 assert.ok(page.webview.html.includes(`data-select="${set.id}"`));
 assert.ok(!/<button\b[^>]*data-action="approve"/.test(page.webview.html),'applied history must not offer approval');
 if(process.env.PSFT_NAVIGATION_PREVIEW)await fs.writeFile('/tmp/psft-navigation-applied.html',page.webview.html);
 reviewTree.dispose();
 check('production HTTP staging writes nothing; stale UI refused; trusted review/apply verifies SQL without modal approval');

 const timelineArgs={changeSetId:set.id,objectId:current.objects[0].id};
 const timeline=await reviewCall('psft_get_object_timeline',{...timelineArgs,checkLive:true});
 assert.equal(timeline.revisions.length,1);assert.equal(timeline.proposals.length,0);assert.equal(timeline.live.status,'MATCHES_RECORDED');
 await reviewUi.show(set.id);assert.ok(page.webview.html.includes('Object revision timeline'));
 assert.ok(page.webview.html.includes('&lt;script&gt;history&lt;/script&gt;'));assert.ok(!page.webview.html.includes('<script>history</script>'));
 page._receive({action:'timelineLive',id:set.id,object:current.objects[0].id,revision:current.revision});
 await until(async()=>page.webview.html.includes('Live matched at the check above'));
 const diffsBefore=vscode._diffs.length;
 page._receive({action:'timelineCompare',id:set.id,object:current.objects[0].id,revision:current.revision,timelineRevision:timeline.revisions[0].id});
 await until(async()=>vscode._diffs.length===diffsBefore+1);
 assert.equal(vscode._diffs.at(-1).left.path,'/'+timeline.baseline.snapshot);
 assert.equal(vscode._diffs.at(-1).right.path,'/'+timeline.revisions[0].snapshot);
 page._receive({action:'timelineCompare',id:set.id,object:current.objects[0].id,revision:current.revision,timelineRevision:'another-object-revision'});
 await until(async()=>page.webview.html.includes('Revision is not in this object and environment history'));
 assert.equal(vscode._diffs.length,diffsBefore+1);assert.equal(nativeWrites,1);assert.equal(confirmed,confirmsBefore);
 check('HTTP object timeline and UI live check compare retained snapshots without writes, escape titles and reject foreign revisions');

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
 await reviewUi.show(set.id);
 assert.ok(page.webview.html.includes('NOT_CHECKED'),'a new retained revision invalidates the previous displayed live check');
 const history=await reviewCall('psft_get_object_timeline',{...timelineArgs,checkLive:true});
 assert.equal(history.revisions.length,2);assert.equal(history.live.matched,history.revisions.find((r:any)=>r.changeSetId===guardSet.id).id);
 page._receive({action:'select',id:guardSet.id,object:guarded.objects[0].id});
 await until(async()=>page.webview.html.includes('Delivered SQL exact revision')&&page.webview.html.includes('SELECT 2 FROM DUAL'));
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
 codePage._receive({action:'apply',id:reversal.id,revision:reversal.revision});await until(async()=>(await reviewService.store.get(reversal.id)).status==='APPLIED'&&(await reviewService.store.get(codeSet.id)).status==='REVERTED');assert.equal(codeDefinitions.size,0);
 assert.equal((await reviewService.store.get(codeSet.id)).status,'REVERTED');
 const forward=await reviewCall('psft_prepare_redo',{changeSetId:codeSet.id});assert.equal(forward.status,'DRAFT');assert.equal(codeDefinitions.size,0);
 check('authoritative event source stages, existing compiler validates, UI applies and checkpoint deletion/reversal prepares redo');

 // Fixture native writer commits B then loses its reply. Nothing automatically retries it.
 const saveBeforePartial=provider.saveSqlDefinition, partialWrites:string[]=[];
 let loseReply=true;
 provider.saveSqlDefinition=async(request:any)=>{const result=await saveBeforePartial(request);partialWrites.push(request.sqlId);if(request.sqlId==='ZZ_PARTIAL_B'&&loseReply)throw new Error('fixture connection lost after commit');return result;};
 const partialSet=await reviewCall('psft_create_change_set',{title:'Interrupted SQL dependency group',connection:'FIXTURE'});
 let dep:string|undefined;
 for(const name of ['ZZ_PARTIAL_A','ZZ_PARTIAL_B','ZZ_PARTIAL_C']){
   await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name,text:'SELECT 1 FROM DUAL',changeSetId:partialSet.id,...(dep?{dependsOn:[dep]}:{})});
   dep=(await reviewCall('psft_get_change_set',{changeSetId:partialSet.id})).objects.at(-1).id;
 }
 const partialReady=await reviewCall('psft_validate_change_set',{changeSetId:partialSet.id});
 await reviewUi.show(partialSet.id);const partialPage=vscode._panels.at(-1);
 partialPage._receive({action:'approve',id:partialSet.id,revision:partialReady.revision});await until(async()=>(await reviewService.store.get(partialSet.id)).status==='APPROVED');
 partialPage._receive({action:'apply',id:partialSet.id,revision:partialReady.revision});await until(async()=>(await reviewService.store.get(partialSet.id)).status==='PARTIALLY_APPLIED');
 const refused=await reviewRpc('tools/call',{name:'psft_prepare_remaining_work',arguments:{changeSetId:partialSet.id}});
 assert.equal(refused.isError,true);assert.deepEqual(partialWrites,['ZZ_PARTIAL_A','ZZ_PARTIAL_B']);
 partialPage._receive({action:'recover',id:partialSet.id,revision:partialReady.revision});
 await until(async()=>(await reviewService.store.get(partialSet.id)).objects[1].application==='VERIFIED');
 partialPage._receive({action:'remaining',id:partialSet.id,revision:partialReady.revision});
 await until(async()=>(await reviewService.store.list()).some((s:any)=>s.continuation?.changeSetId===partialSet.id));
 const followup=await reviewCall('psft_prepare_remaining_work',{changeSetId:partialSet.id});
 assert.equal(followup.schema,2);assert.deepEqual(followup.objects.map((c:any)=>c.key),['ZZ_PARTIAL_C']);assert.equal(followup.continuation.prerequisites.length,2);
 assert.deepEqual(partialWrites,['ZZ_PARTIAL_A','ZZ_PARTIAL_B']);assert.equal(followup.objects[0].approvedHash,undefined);
 check('partial HTTP/UI apply requires reconciliation and stages only untouched work with confirmed prerequisites and fresh approval');
 let resumed=await reviewCall('psft_validate_change_set',{changeSetId:followup.id});
 await reviewUi.show(followup.id);assert.ok(partialPage.webview.html.includes('Already verified prerequisites'));
 partialPage._receive({action:'approve',id:followup.id,revision:resumed.revision});await until(async()=>(await reviewService.store.get(followup.id)).status==='APPROVED');
 const prerequisite=sqlDefinitions.get('ZZ_PARTIAL_A')!,version=prerequisite.version;prerequisite.version++;
 partialPage._receive({action:'apply',id:followup.id,revision:resumed.revision});await until(async()=>(await reviewService.store.get(followup.id)).status==='CONFLICTED');
 assert.deepEqual(partialWrites,['ZZ_PARTIAL_A','ZZ_PARTIAL_B']);prerequisite.version=version;loseReply=false;
 resumed=await reviewCall('psft_validate_change_set',{changeSetId:followup.id});
 await reviewUi.show(followup.id);partialPage._receive({action:'approve',id:followup.id,revision:resumed.revision});await until(async()=>(await reviewService.store.get(followup.id)).status==='APPROVED');
 partialPage._receive({action:'apply',id:followup.id,revision:resumed.revision});await until(async()=>(await reviewService.store.get(followup.id)).status==='APPLIED');
 assert.deepEqual(partialWrites,['ZZ_PARTIAL_A','ZZ_PARTIAL_B','ZZ_PARTIAL_C']);
 assert.equal((await reviewCall('psft_prepare_remaining_work',{changeSetId:partialSet.id})).id,followup.id);
 assert.equal((await reviewService.store.get(partialSet.id)).status,'PARTIALLY_APPLIED');
 assert.equal(sqlDefinitions.get('ZZ_PARTIAL_C')?.text,'SELECT 1 FROM DUAL');
 provider.saveSqlDefinition=saveBeforePartial;
 check('fresh continuation approval blocks prerequisite token drift, completes remaining SQL once and retains original partial history');

 // Bounded Page review uses actual native SQL, snapshots, readonly reads and commit/rollback fixture semantics.
 const {pageTransaction:pageFixture}=require('./src/test/fixtures/pageTransaction.ts');
 const {buildPageLayout:pageLayout}=require('./src/model/pageLayout.ts');
 const pageNative=pageFixture({PSPNLFIELD:[{PNLNAME:'ZZ_PREVIEW_PAGE',PNLFLDID:1,FIELDNUM:1,FIELDTYPE:4,FIELDLEFT:10,FIELDTOP:20,FIELDRIGHT:90,FIELDBOTTOM:40,
   EDITLBLLEFT:0,EDITLBLTOP:0,EDITLBLRIGHT:0,EDITLBLBOTTOM:0,FIELDSIZETYPE:2,LBLTYPE:1,LBLTEXT:'Before',FIELDUSE:0,SECUREINVISIBLE:'0',OCCURSLEVEL:0,RECNAME:' ',FIELDNAME:' ',UNTOUCHED_COLUMN:'preserved'}],
   PSPNLFIELDEXT:[{PNLNAME:'ZZ_PREVIEW_PAGE',PNLFLDID:1,FFSTYLELONG:' | | | | '}]});
 const originalPageRead=provider.readPageLayout,originalPageConnection=provider.withConnection,originalPageGuard=provider.guard;
 Object.defineProperty(provider,'types',{value:require('./src/db/connection.ts').ADAPTER_TYPES,configurable:true});
 provider.withConnection=async(fn:any)=>fn(pageNative.connection);
 provider.readPageLayout=async()=>{const s=pageNative.state();return {layout:pageLayout('ZZ_PREVIEW_PAGE',{page:s.page,fields:s.tables.PSPNLFIELD,components:[]}),order:''};};
 provider.guard=async(key:any)=>{assert.deepEqual(key,{type:5,parts:['ZZ_PREVIEW_PAGE']});assert.ok(isReviewedWrite(provider.id,key));assert.equal(writeOrigin(),'agent');};
 const pageSet=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'Native Page existing-control review'}),pageConfirmBefore=confirmed;
 const pageStage=await reviewCall('psft_edit_page',{connection:'fixture',page:'ZZ_PREVIEW_PAGE',changeSetId:pageSet.id,expectedVersion:7,operations:[{op:'move',id:1,left:50,top:60},{op:'set_label',id:1,text:'After'},{op:'set_use',id:1,displayOnly:true,invisible:true},{op:'set_properties',description:'Reviewed Page'}]});
 assert.equal(pageStage.status,'REVIEW_REQUIRED');assert.equal(pageStage.persisted,false);assert.equal(pageNative.counts().committed,0);assert.deepEqual(pageNative.state(),pageNative.initial);assert.equal(confirmed,pageConfirmBefore);
 let pageReady=await reviewCall('psft_validate_change_set',{changeSetId:pageSet.id});assert.equal(pageReady.status,'READY_FOR_REVIEW');
 const pageObject=pageReady.objects[0],nativeDiff=await reviewCall('psft_get_object_diff',{changeSetId:pageSet.id,objectId:pageObject.id});
 assert.ok(nativeDiff.differences.some((d:any)=>d.path==='$.tables.PSPNLFIELD[1].FIELDLEFT'));
 await reviewUi.show(pageSet.id);const nativePageUi=vscode._panels.at(-1);
 assert.ok(nativePageUi.webview.html.includes('data-page-preview="proposal-"'));assert.ok(nativePageUi.webview.html.includes('data-page-control="1"'));assert.ok(nativePageUi.webview.html.includes('Hidden'));assert.ok(!nativePageUi.webview.html.includes('data-html='));
 nativePageUi._receive({action:'approve',id:pageSet.id,revision:pageReady.revision});await until(async()=>(await reviewService.store.get(pageSet.id)).status==='APPROVED');
 nativePageUi._receive({action:'apply',id:pageSet.id,revision:pageReady.revision});await until(async()=>(await reviewService.store.get(pageSet.id)).status==='APPLIED');
 assert.equal(pageNative.counts().committed,1);assert.equal(pageNative.state().tables.PSPNLFIELD[0].FIELDLEFT,50);assert.equal(pageNative.state().tables.PSPNLFIELD[0].LBLTEXT,'After');
 assert.equal(pageNative.state().tables.PSPNLFIELD[0].UNTOUCHED_COLUMN,'preserved');assert.equal(pageNative.state().tables.PSPNLFIELD[0].SECUREINVISIBLE,'1');assert.equal(confirmed,pageConfirmBefore);
 let pageRevert=await reviewCall('psft_prepare_revert',{changeSetId:pageSet.id});pageRevert=await reviewCall('psft_validate_change_set',{changeSetId:pageRevert.id});assert.equal(pageRevert.status,'READY_FOR_REVIEW');
 await reviewUi.show(pageRevert.id);nativePageUi._receive({action:'approve',id:pageRevert.id,revision:pageRevert.revision});await until(async()=>(await reviewService.store.get(pageRevert.id)).status==='APPROVED');
 nativePageUi._receive({action:'apply',id:pageRevert.id,revision:pageRevert.revision});await until(async()=>(await reviewService.store.get(pageRevert.id)).status==='APPLIED'&&(await reviewService.store.get(pageSet.id)).status==='REVERTED');
 assert.equal(pageNative.state().tables.PSPNLFIELD[0].SECUREINVISIBLE,'0');assert.equal(pageNative.state().page.DESCR,'Original page');assert.equal(pageNative.state().tables.PSPNLFIELD[0].FIELDLEFT,10);assert.equal(pageNative.state().tables.PSPNLFIELD[0].LBLTEXT,'Before');assert.equal((await reviewService.store.get(pageSet.id)).status,'REVERTED');
 const pageHistory=await reviewCall('psft_get_object_timeline',{changeSetId:pageRevert.id,objectId:pageRevert.objects[0].id});
 const pageCommits=pageNative.counts().committed;nativePageUi._receive({action:'timelineCompare',id:pageRevert.id,revision:pageRevert.revision,object:pageRevert.objects[0].id,timelineRevision:pageHistory.revisions[0].id});
 await until(async()=>nativePageUi.webview.html.includes('data-page-preview="history-"'));assert.equal(pageNative.counts().committed,pageCommits);
 check('bounded Page HTTP/UI staging captures native snapshots, renders visual and retained baseline comparisons, applies typed edits and verifies checkpoint reversal without raw row replay');
 const unsupported=await reviewRpc('tools/call',{name:'psft_edit_page',arguments:{connection:'FIXTURE',page:'ZZ_PREVIEW_PAGE',operations:[{op:'delete',id:1}]}});assert.equal(unsupported.isError,true);
 const maliciousSet=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'Unsupported native Page column'});
 const nativeBefore=await provider.readPageForReview('ZZ_PREVIEW_PAGE'), altered=structuredClone(nativeBefore.value);altered.tables.PSPNLFIELD[0].UNTOUCHED_COLUMN='must not be replayed';
 const malicious=await reviewCall('psft_stage_object_change',{changeSetId:maliciousSet.id,adapter:'page',key:'ZZ_PREVIEW_PAGE',after:altered});
 assert.equal((await reviewCall('psft_validate_change_set',{changeSetId:malicious.id})).status,'CONFLICTED');assert.equal(pageNative.state().tables.PSPNLFIELD[0].UNTOUCHED_COLUMN,'preserved');
 const driftSet=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'Native Page row drift without version change'});
 await reviewCall('psft_edit_page',{connection:'FIXTURE',page:'ZZ_PREVIEW_PAGE',changeSetId:driftSet.id,operations:[{op:'move',id:1,left:100,top:100}]});
 pageReady=await reviewCall('psft_validate_change_set',{changeSetId:driftSet.id});await reviewUi.show(driftSet.id);
 nativePageUi._receive({action:'approve',id:driftSet.id,revision:pageReady.revision});await until(async()=>(await reviewService.store.get(driftSet.id)).status==='APPROVED');
 const sameVersion=pageNative.state().page.VERSION;pageNative.editCommitted((s:any)=>{s.tables.PSPNLFIELD[0].FIELDLEFT=999;});assert.equal(pageNative.state().page.VERSION,sameVersion);
 nativePageUi._receive({action:'apply',id:driftSet.id,revision:pageReady.revision});await until(async()=>(await reviewService.store.get(driftSet.id)).status==='CONFLICTED');assert.equal(pageNative.counts().committed,2);assert.equal(pageNative.state().tables.PSPNLFIELD[0].FIELDLEFT,999);
 check('Page staging refuses structural operations and unhandled native columns; full snapshot tokens block unversioned control drift');
 const {setManualHistoryObserver}=require('./src/changeReview/manualHistory.ts');
 const {requestForPageSnapshot}=require('./src/providers/pageSnapshot.ts');
 setManualHistoryObserver((connection:string,key:any,write:any)=>key.type===5?reviewService.captureManual(connection,'page',key.parts[0],write):write());
 provider.guard=async()=>assert.equal(writeOrigin(),'user');
 try{
   const beforeManual=await provider.readPageForReview('ZZ_PREVIEW_PAGE'),desired=structuredClone(beforeManual.value);desired.tables.PSPNLDEFN[0].DESCR='Manual Page save';
   await provider.savePage(requestForPageSnapshot('ZZ_PREVIEW_PAGE',beforeManual.value,desired,beforeManual.version,'JARED'));
   const manual=(await reviewService.store.list()).find((s:any)=>s.origin==='manual'&&s.objects[0]?.adapter==='page');assert.ok(manual);assert.equal(manual.status,'APPLIED');
   assert.equal(manual.objects[0].application,'VERIFIED');assert.equal(manual.objects[0].verified,(await provider.readPageForReview('ZZ_PREVIEW_PAGE')).hash);
   const history=await reviewCall('psft_get_object_timeline',{changeSetId:manual.id,objectId:manual.objects[0].id,checkLive:true});
   assert.equal(history.revisions.length,3);assert.equal(history.live.status,'MATCHES_RECORDED');assert.equal(history.live.matched,manual.id+':'+manual.objects[0].id);
   assert.equal(history.revisions.find((r:any)=>r.origin==='manual').continuity,'GAP','the unrecorded native control edit remains a visible history gap');
   assert.equal(pageNative.counts().committed,3);
 }finally{setManualHistoryObserver(undefined);}
 check('real manual Page saves capture native before/after history and timeline preserves an external-edit gap');
 provider.readPageLayout=originalPageRead;provider.withConnection=originalPageConnection;provider.guard=originalPageGuard;delete provider.types;


 // Existing Record/AE header adapters run actual writers against a transactional fixture.
 const {structuredTransaction}=require('./src/test/fixtures/structuredTransaction.ts');
 const oldStructuredConnection=provider.withConnection,oldStructuredGuard=provider.guard,oldEnvironment=provider.readEnvironment;
 Object.defineProperty(provider,'types',{value:require('./src/db/connection.ts').ADAPTER_TYPES,configurable:true});
 provider.readEnvironment=async()=>({toolsRelease:'8.62'});
 for(const family of ['record','ae']){
   const native=structuredTransaction(family),type=family==='record'?0:33,toolName=family==='record'?'psft_edit_record':'psft_ae_edit';
   provider.withConnection=async(fn:any)=>fn(native.connection);
   provider.guard=async(key:any)=>{assert.deepEqual(key,{type,parts:[native.name]});assert.ok(isReviewedWrite(provider.id,key));assert.equal(writeOrigin(),'agent');};
   const request={connection:'FIXTURE',...(family==='record'?{record:native.name,expectedVersion:7}:{program:native.name}),operations:[{op:family==='record'?'set_properties':'set_program',description:'Reviewed header'}]};
   const set=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:family+' native header review'});
   const proposed=await reviewCall(toolName,{...request,changeSetId:set.id});assert.equal(proposed.persisted,false);assert.equal(native.counts().commits,0);assert.deepEqual(native.state(),native.initial);
   let ready=await reviewCall('psft_validate_change_set',{changeSetId:set.id});assert.equal(ready.status,'READY_FOR_REVIEW');
   await reviewUi.show(set.id);const ui=vscode._panels.at(-1);
   ui._receive({action:'approve',id:set.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(set.id)).status==='APPROVED');
   ui._receive({action:'apply',id:set.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(set.id)).status==='APPLIED');
   assert.equal(native.counts().commits,1);const header=native.state()[family==='record'?'PSRECDEFN':'PSAEAPPLDEFN'][0];assert.equal(header.FUTURE_COLUMN,'preserved');
   let reverse=await reviewCall('psft_prepare_revert',{changeSetId:set.id});reverse=await reviewCall('psft_validate_change_set',{changeSetId:reverse.id});assert.equal(reverse.status,'READY_FOR_REVIEW');
   await reviewUi.show(reverse.id);ui._receive({action:'approve',id:reverse.id,revision:reverse.revision});await until(async()=>(await reviewService.store.get(reverse.id)).status==='APPROVED');
   ui._receive({action:'apply',id:reverse.id,revision:reverse.revision});await until(async()=>(await reviewService.store.get(reverse.id)).status==='APPLIED'&&(await reviewService.store.get(set.id)).status==='REVERTED');
   assert.equal(native.counts().commits,2);
   const history=await reviewCall('psft_get_object_timeline',{changeSetId:reverse.id,objectId:reverse.objects[0].id,checkLive:true});assert.equal(history.live.status,'MATCHES_RECORDED');assert.equal(history.revisions.length,2);
   const count=(await reviewService.store.list()).length;
   const refused=await reviewRpc('tools/call',{name:toolName,arguments:{...request,operations:[{op:family==='record'?'remove_field':'delete_section',field:'DESCR',section:'MAIN'}]}});assert.equal(refused.isError,true);assert.equal((await reviewService.store.list()).length,count);
   const drift=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:family+' unversioned native drift'});
   await reviewCall(toolName,{...request,expectedVersion:undefined,changeSetId:drift.id});ready=await reviewCall('psft_validate_change_set',{changeSetId:drift.id});await reviewUi.show(drift.id);
   ui._receive({action:'approve',id:drift.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(drift.id)).status==='APPROVED');
   native.editCommitted((t:any)=>{t[family==='record'?'PSRECDEFN':'PSAEAPPLDEFN'][0].FUTURE_COLUMN='outside';});
   ui._receive({action:'apply',id:drift.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(drift.id)).status==='CONFLICTED');assert.equal(native.counts().commits,2);
   check(family+' bounded header HTTP/UI stages without writes, applies actual native writer, verifies inverse/timeline and blocks structural edits and unversioned drift');
 }
 provider.withConnection=oldStructuredConnection;provider.guard=oldStructuredGuard;provider.readEnvironment=oldEnvironment;delete provider.types;
 // Deliberate stop at one verified native writer boundary, with fresh continuation review.
 const pausedSet=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'Developer paced application'});
 for(const name of ['ZZ_PAUSED_A','ZZ_PAUSED_B'])await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name,text:'SELECT 1 FROM DUAL',changeSetId:pausedSet.id});
 let pausedReady=await reviewCall('psft_validate_change_set',{changeSetId:pausedSet.id});await reviewUi.show(pausedSet.id);const pausedUi=vscode._panels.at(-1);
 assert.match(pausedUi.webview.html, /<button data-action="applyOne" disabled>/);
 assert.ok(pausedUi.webview.html.includes('Approve at least two objects to enable this action.'));
 const writesBeforePauseApproval=nativeWrites;
 pausedUi._receive({action:'applyOne',id:pausedSet.id,revision:pausedReady.revision});
 await until(async()=>pausedUi.webview.html.includes('An approved Change Set is required.'));
 assert.equal(nativeWrites,writesBeforePauseApproval);assert.equal((await reviewService.store.get(pausedSet.id)).status,'READY_FOR_REVIEW');
 pausedUi._receive({action:'approve',id:pausedSet.id,revision:pausedReady.revision,object:pausedReady.objects[0].id});
 await until(async()=>(await reviewService.store.get(pausedSet.id)).status==='APPROVED'&&pausedUi.webview.html.includes('data-action="applyOne" disabled'));
 pausedUi._receive({action:'approve',id:pausedSet.id,revision:pausedReady.revision});await until(async()=>(await reviewService.store.get(pausedSet.id)).status==='APPROVED');
 await until(async()=>pausedUi.webview.html.includes('<button data-action="applyOne">'));
 pausedUi._receive({action:'applyOne',id:pausedSet.id,revision:pausedReady.revision});await until(async()=>(await reviewService.store.get(pausedSet.id)).status==='PARTIALLY_APPLIED');
 assert.ok(sqlDefinitions.has('ZZ_PAUSED_A'));assert.ok(!sqlDefinitions.has('ZZ_PAUSED_B'));
 const pausedRemaining=await reviewCall('psft_prepare_remaining_work',{changeSetId:pausedSet.id});assert.equal(pausedRemaining.objects.length,1);assert.equal(pausedRemaining.objects[0].key,'ZZ_PAUSED_B');assert.equal(pausedRemaining.objects[0].review,'PENDING');
 pausedReady=await reviewCall('psft_validate_change_set',{changeSetId:pausedRemaining.id});await reviewUi.show(pausedRemaining.id);
 pausedUi._receive({action:'approve',id:pausedRemaining.id,revision:pausedReady.revision});await until(async()=>(await reviewService.store.get(pausedRemaining.id)).status==='APPROVED');
 pausedUi._receive({action:'apply',id:pausedRemaining.id,revision:pausedReady.revision});await until(async()=>(await reviewService.store.get(pausedRemaining.id)).status==='APPLIED');assert.ok(sqlDefinitions.has('ZZ_PAUSED_B'));
 const {completedFollowUp,reviewList}=require('./src/changeReview/navigation.ts');
 const partialRecord=await reviewService.store.get(pausedSet.id),completedRecord=await reviewService.store.get(pausedRemaining.id);
 const retainedPartial=JSON.stringify(partialRecord);
 assert.equal(completedFollowUp(partialRecord,[partialRecord,completedRecord])?.id,completedRecord.id);
 assert.ok(!reviewList([partialRecord,completedRecord],'pending').some((s:any)=>s.id===partialRecord.id));
 assert.equal(reviewList([partialRecord,completedRecord],'history').length,2);
 assert.equal(partialRecord.status,'PARTIALLY_APPLIED');assert.equal(JSON.stringify(partialRecord),retainedPartial,'classification cannot rewrite historical outcomes');
 for(const status of ['DRAFT','APPROVED','FAILED','PARTIALLY_APPLIED'])assert.ok(reviewList([partialRecord,{...completedRecord,status}],'pending').some((s:any)=>s.id===partialRecord.id));
 for(const corrupt of [
   {...completedRecord,environment:{...completedRecord.environment,identity:'another-target'}},
   {...completedRecord,continuation:{...completedRecord.continuation,sourceRevision:partialRecord.revision+1}},
   {...completedRecord,continuation:{...completedRecord.continuation,prerequisites:[]}},
   {...completedRecord,objects:completedRecord.objects.map((c:any)=>({...c,application:'UNCERTAIN'}))}
 ])assert.equal(completedFollowUp(partialRecord,[partialRecord,corrupt]),undefined,'unverified/mismatched follow-up cannot hide a partial application');
 await reviewUi.show(partialRecord.id);
 assert.ok(pausedUi.webview.html.includes('Remaining work completed in'));
 assert.ok(!/<button\b[^>]*data-action="remaining"/.test(pausedUi.webview.html));
 assert.ok(!/<button\b[^>]*data-action="recover"/.test(pausedUi.webview.html));
 check('trusted one-object application pauses with a verified result and remaining work needs a fresh reviewed continuation');
 check('completed continuation moves the original partial record to history without rewriting it; unresolved or foreign follow-ups stay pending');


}finally{reviewUi.dispose();await reviewServer.dispose();await fs.rm(reviewRoot,{recursive:true,force:true,maxRetries:5,retryDelay:100});}

console.log(JSON.stringify({ mode: 'fixture-backed production HTTP MCP; no live database', checks: checks.length }));
