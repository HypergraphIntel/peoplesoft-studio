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
// The 8.62 reviewed Query path (queryProjectReversal.ts), over the same fixture map: complete token, rollback preview
// without an agent write, and the reviewed after-image checked on commit. Deletion is not modelled here.
provider.readQueryForReview = async (name: string, owner = '') => {
  const { hash } = require('./src/changeReview/model.ts'), { querySnapshot } = require('./src/changeReview/query.ts');
  const read = await provider.readQueryDocument(name, owner), value = read ? querySnapshot(read.view) : null;
  return { value, token: read?.token ?? 'absent', hash: hash(value), deleted: false };
};
provider.writeQueryForReview = async (r: any) => {
  const { hash } = require('./src/changeReview/model.ts'), { queryView, querySnapshot } = require('./src/changeReview/query.ts');
  const before = await provider.readQueryForReview(r.name, r.owner);
  assert.equal(before.token, r.expectedSnapshotToken, 'stale reviewed Query baseline');
  if (r.after === null) throw new Error('Fixture Query deletion is not modelled.');
  const view = queryView(r.after);
  if (r.dryRun) { await provider.prepareQuery(view); const value = querySnapshot(view); assert.equal(hash(value), r.expectedAfterHash); return { before, after: { value, token: 'preview', hash: hash(value), deleted: false } }; }
  await provider.saveQueryDocument({ view, openedToken: before.token, operatorId: r.operatorId });
  const after = await provider.readQueryForReview(r.name, r.owner);
  assert.equal(after.hash, r.expectedAfterHash, 'Complete Query after-image differs from review.');
  return { before, after };
};
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
const pfcPages = [{ page: 'ZZ_MCP_PAGE', label: 'Fixture page', type: 'P' }, { page: 'ZZ_MCP_SEC', label: 'Secondary page', type: 'S', level: 2 }];
const pfcFields = [{ pageField: '0.AAP_TBL.DESCR.1.0.P', level: 0, occursLevel: 0, record: 'AAP_TBL', field: 'DESCR', pnlfldid: 1, ownLevel: 0,
  page: 'ZZ_MCP_PAGE', componentPage: 'ZZ_MCP_PAGE', label: 'Description', fieldType: 4, fieldUse: 0, record1: '', field1: '', recordBase: '' }];
const pfcMasks = { profiles: [{ id: 'ZZ_MASK', label: 'Fixture mask', description: 'Fixture mask profile', type: 'C', isDefault: true }], fieldDefaults: { DESCR: 'ZZ_MASK' } };
const pfcSaveCalls: any[] = [];
const pfcCatalogCalls: any[] = [];
const pfcApplyCalls: any[] = [];
let pfcMapsOnSave = false;
let pfcApplyOrigin = 'agent';
provider.tablespaces = async () => [{ name: 'AAAPP', database: 'PSDB', comments: 'Fixture tablespace' }];
provider.readPageFieldConfiguration = async (component: string, market: string, type: string) => {
  assert.deepEqual([component, market, type], ['ZZ_MCP_COMP', 'GBL', 'STD']);
  return { exists: true, token: 'fixture-pfc-token', configuration: structuredClone(pfcConfiguration), derived: [], contentReferences: [{ cref: 'ZZ_MCP_CREF', mappingRows: 0, inSync: false }], mapsOnSave: pfcMapsOnSave };
};
provider.readPageFieldCatalogPages = async (component: string, market: string) => {
  assert.deepEqual([component, market], ['ZZ_MCP_COMP', 'GBL']);
  return structuredClone(pfcPages);
};
provider.readPageFieldCatalogFields = async (page: string, type: string, options: any) => {
  pfcCatalogCalls.push({ page, type, options: structuredClone(options) });
  return structuredClone(pfcFields).map(f => ({ ...f, occursLevel: f.level + (options.secondaryLevel ?? 0) }));
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
provider.applyPageFieldMapping = async (request: any) => {
  assert.equal(writeOrigin(), pfcApplyOrigin);
  assert.equal(request.operatorId, 'JARED');
  assert.equal(request.openedToken, 'fixture-pfc-token', 'stale configuration');
  assert.equal(pfcMapsOnSave, false, 'this release maps on save');
  assert.deepEqual(request.contentReferences, ['ZZ_MCP_CREF'], 'only component content references');
  pfcApplyCalls.push(structuredClone(request));
  return { written: !request.dryRun, mappings: { statements: [{}], changes: [request.remove ? 'Remove mapping' : 'Apply mapping'] }, derived: [] };
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
  for (const name of ['psft_page_field_config_get', 'psft_page_field_config_fields', 'psft_page_field_config_save', 'psft_page_field_config_apply', 'psft_list_tablespaces']) assert.ok(advertised.some((t: any) => t.name === name));
  assert.deepEqual((await tool('psft_list_tablespaces')).tablespaces, await provider.tablespaces());
  for (const name of ['psft_create_record', 'psft_edit_record']) assert.ok(advertised.find((t: any) => t.name === name).inputSchema.properties.tablespace);
  check('PFC apply and tablespace discovery are advertised; record tools accept a tablespace');
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
  assert.equal(pfcBefore.mapsOnSave, false);
  assert.match(pfcBefore.mapping, /Apply Configuration/);
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
  assert.deepEqual(pfcCatalogCalls.at(-1), { page: 'ZZ_MCP_PAGE', type: 'P', options: { mask: false, criteria: true, secondaryLevel: undefined } });
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
  assert.deepEqual(pfcCatalogCalls.at(-1), { page: 'ZZ_MCP_PAGE', type: 'P', options: { mask: true, criteria: false, secondaryLevel: undefined } });
  assert.deepEqual(pfcMasked.maskProfiles, pfcMasks.profiles);
  assert.equal(pfcMasked.count, 1);
  assert.equal(pfcMasked.fields[0].recordField, 'AAP_TBL.DESCR');
  assert.equal(pfcMasked.fields[0].row.EOCC_MASK_FLAG, 'Y');
  assert.equal(pfcMasked.fields[0].row.EOCC_MASK_ID, 'ZZ_MASK');
  check('PFC mask discovery returns maskProfiles and applies the fixture mask to field rows');
  const secondary = await tool('psft_page_field_config_fields', { ...pfk, page: 'ZZ_MCP_SEC', type: 'S' });
  assert.equal(pfcCatalogCalls.at(-1).options.secondaryLevel, 2);
  assert.equal(secondary.fields[0].level, 2);
  assert.equal(secondary.fields[0].row.OCCURSLEVEL, 2);
  check('PFC secondary field discovery uses the level reached from the component');
  const mapping = { ...pfk, expectedToken: pfcBefore.token, contentReferences: ['ZZ_MCP_CREF'] };
  const mapConfirms = confirmed, mapRefreshes = refreshed;
  assert.equal((await tool('psft_page_field_config_apply', { ...mapping, dryRun: true })).applied, false);
  assert.equal(confirmed, mapConfirms); assert.equal(refreshed, mapRefreshes);
  mode = 'off'; await tool('psft_page_field_config_apply', mapping, false); mode = 'confirm';
  access = false; await tool('psft_page_field_config_apply', mapping, false); access = true;
  operator = ''; await tool('psft_page_field_config_apply', mapping, false); operator = 'JARED';
  await tool('psft_page_field_config_apply', { ...mapping, expectedToken: 'stale' }, false);
  await tool('psft_page_field_config_apply', { ...mapping, contentReferences: ['OTHER'] }, false);
  assert.equal(pfcApplyCalls.length, 1);
  accept = false; await tool('psft_page_field_config_apply', mapping, false); accept = true;
  assert.equal(pfcApplyCalls.filter(r => !r.dryRun).length, 0);
  assert.equal((await tool('psft_page_field_config_apply', mapping)).applied, true);
  assert.equal((await tool('psft_page_field_config_apply', { ...mapping, remove: true })).applied, true);
  assert.deepEqual(pfcApplyCalls.filter(r => !r.dryRun).map(r => r.remove), [false, true]);
  assert.equal(confirmed, mapConfirms + 3); assert.equal(refreshed, mapRefreshes + 2);
  pfcMapsOnSave = true;
  await tool('psft_page_field_config_apply', mapping, false);
  assert.equal((await tool('psft_page_field_config_get', pfk)).mapping, undefined);
  pfcMapsOnSave = false;
  check('PFC mapping preview, write gates, decline, apply/remove and maps-on-save refusal use production HTTP routing');
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
  assert.ok(!names.includes('psft_page_field_config_save') && !names.includes('psft_page_field_config_apply'));
  assert.ok(names.includes('psft_list_tablespaces'));
  check('read-only server advertises PFC and tablespace reads without configuration writes');
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

// Exercise the real record save handler: the picker is a VS Code API boundary.
const { RecordEditorProvider } = require('./src/editors/recordEditor.ts');
const recordEditor = new RecordEditorProvider(workspace);
const oldPicker = vscode.window.showQuickPick, oldRecordSave = provider.saveRecord;
const recordSaves: any[] = [];
let spacePicks = 0, cancelSpace = false, recordLoads = 0;
vscode.window.showQuickPick = async (items: any[]) => { spacePicks++; return cancelSpace ? undefined : items[0]; };
provider.saveRecord = async (request: any) => { recordSaves.push(structuredClone(request)); return { version: 2 }; };
const recordDoc: any = {
  provider, recname: 'ZZ_MCP_RECORD', uri: toUri(provider.id, { type: 0, parts: ['ZZ_MCP_RECORD'] }), dirty: true,
  state: { recname: 'ZZ_MCP_RECORD', recordType: 0, isNew: true, fields: [] },
  load: async () => { recordLoads++; }, paint: () => {}
};
try {
  await recordEditor.saveCustomDocument(recordDoc);
  assert.equal(spacePicks, 1); assert.equal(recordSaves.at(-1).tablespace, 'AAAPP');
  recordDoc.state.isNew = false; recordDoc.layout = { recordType: 0 };
  await recordEditor.saveCustomDocument(recordDoc);
  assert.equal(spacePicks, 1); assert.equal(recordSaves.at(-1).tablespace, undefined);
  recordDoc.layout.recordType = 1;
  await recordEditor.saveCustomDocument(recordDoc);
  assert.equal(spacePicks, 2); assert.equal(recordSaves.at(-1).tablespace, 'AAAPP');
  cancelSpace = true;
  await assert.rejects(recordEditor.saveCustomDocument(recordDoc), /was not saved/);
  assert.equal(recordSaves.length, 3); assert.equal(recordLoads, 3); assert.equal(recordDoc.dirty, true);
  access = false;
  await assert.rejects(recordEditor.saveCustomDocument(recordDoc), /not Writable/);
  assert.equal(spacePicks, 3); assert.equal(recordSaves.length, 3);
} finally { vscode.window.showQuickPick = oldPicker; provider.saveRecord = oldRecordSave; access = true; }
check('real record save handler asks for a tablespace on creation/type conversion, preserves cancellation and gates writes');

const { openPageFieldConfigurator } = require('./src/editors/pfcPanel.ts');
const configurationRefresh = vscode.commands.registerCommand('psft.customization.refresh', () => {});
const oldWarning = vscode.window.showWarningMessage;
let removeMapping = false, declineMapping = false;
pfcApplyOrigin = 'user';
vscode.window.showQuickPick = async (items: any[], options: any) => options.canPickMany ? items : items[removeMapping ? 1 : 0];
vscode.window.showWarningMessage = async (_message: string, _options: any, action: string) => declineMapping ? undefined : action;
try {
  await openPageFieldConfigurator(workspace, provider.id, 'ZZ_MCP_COMP', 'GBL');
  const panel = vscode._panels.at(-1);
  const message = async (m: object) => {
    const n = panel.webview.posted.length; panel._receive(m);
    await until(async () => panel.webview.posted.length > n);
    return panel.webview.posted.at(-1);
  };
  assert.equal((await message({ type: 'ready' })).mapsOnSave, false);
  const start = pfcApplyCalls.length;
  assert.match((await message({ type: 'map' })).message, /done and verified/);
  removeMapping = true;
  assert.match((await message({ type: 'map' })).message, /Remove Mapping: done and verified/);
  assert.deepEqual(pfcApplyCalls.slice(start).map(r => [r.remove, !!r.dryRun]), [[false, true], [false, false], [true, true], [true, false]]);
  declineMapping = true;
  assert.equal((await message({ type: 'map' })).message, 'Cancelled.');
  assert.equal(pfcApplyCalls.filter(r => !r.dryRun).length, 4, 'declining the panel writes nothing');
  access = false;
  assert.match((await message({ type: 'map' })).message, /Writable/);
  assert.equal(pfcApplyCalls.length, start + 5);
  panel.dispose();
} finally { configurationRefresh.dispose(); vscode.window.showQuickPick = oldPicker; vscode.window.showWarningMessage = oldWarning; access = true; pfcApplyOrigin = 'agent'; }
check('real PFC panel selects content references, previews, confirms apply/remove and preserves cancellation/access gates');

// Build Requests: the production page handler and HTTP MCP share the real durable store.
// Approval below is a fixture response only, never native developer acceptance.
const buildFs = await import('node:fs/promises');
const { tmpdir: buildTmpdir } = await import('node:os');
const { BuildRequestStore } = require('./src/buildRequest/store.ts');
const { BuildRequestPanel } = require('./src/editors/buildRequestPanel.ts');
const buildRoot = await buildFs.mkdtemp(join(buildTmpdir(), 'psft-build-request-ui-'));
const buildStore = new BuildRequestStore(join(buildRoot, 'requests'));
const buildServer = await startPeopleSoftMcpServer(workspace, { port: 39522, writeHost: () => host, buildRequests: buildStore });
const oldBuildOpen = vscode.window.showOpenDialog, oldBuildInformation = vscode.window.showInformationMessage;
const oldBuildTerminal = vscode.window.createTerminal, oldBuildEnv = vscode.env, oldBuildFs = vscode.workspace.fs;
const terminals: any[] = [];
let buildApproval = false;
vscode.window.createTerminal = (options: any) => {
  const terminal = { options, shown: false, commands: [] as string[], show() { this.shown = true; }, sendText(text: string) { this.commands.push(text); } };
  terminals.push(terminal); return terminal;
};
vscode.window.showInformationMessage = async (_message: string, _options: any, choice: string) => buildApproval ? choice : undefined;
vscode.workspace.fs = { readFile: async (uri: any) => buildFs.readFile(uri.fsPath) };
async function buildRpc(method: string, params: object) {
  const response = await fetch(buildServer.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const body = await response.text(), result = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(l => l.startsWith('data:'))!.slice(5));
  assert.ok(!result.error, JSON.stringify(result.error)); return result.result;
}
async function buildTool(name: string, args: object, success = true) {
  const result = await buildRpc('tools/call', { name, arguments: args });
  assert.equal(!!result.isError, !success, result.content?.[0]?.text);
  return success ? JSON.parse(result.content[0].text) : undefined;
}
let requestPanel: any;
try {
  const request = await buildStore.create({ title: 'Fixture build acceptance', connection: 'FIXTURE', project: 'ZZ_BR_TEST', kind: 'ae-batch' });
  BuildRequestPanel.show({ store: buildStore, extensionUri: vscode.Uri.file(root), connections: () => ['FIXTURE'], mcp: () => ({ running: true, writes: true, url: buildServer.url }) }, request.id);
  requestPanel = vscode._panels.at(-1);
  requestPanel._receive({ type: 'ready' });
  await until(async () => requestPanel.webview.posted.length > 0);
  const originalEdit = buildStore.edit.bind(buildStore);
  let releaseEdit!: () => void, enteredEdit!: () => void;
  const heldEdit = new Promise<void>(resolve => { releaseEdit = resolve; });
  const entered = new Promise<void>(resolve => { enteredEdit = resolve; });
  buildStore.edit = async (...args: any[]) => { enteredEdit(); await heldEdit; return originalEdit(...args); };
  requestPanel._receive({ type: 'edit', edit: { narrative: 'Build a disposable SQL definition from the attachment.' } });
  await entered;
  requestPanel._receive({ type: 'handoff', phase: 'analyze', agent: 'codex' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(terminals.length, 0, 'handoff must wait for the pending edit');
  releaseEdit();
  await until(async () => (await buildStore.get(request.id)).handoffs.length === 1);
  buildStore.edit = originalEdit;
  assert.equal(terminals.length, 1); assert.equal(terminals[0].shown, true);
  assert.equal(terminals[0].options.shellPath, 'codex');
  assert.match(terminals[0].options.shellArgs[1], /39522\/mcp/);
  assert.match(terminals[0].options.shellArgs.at(-1), new RegExp(`^Analyze PeopleSoft Studio build request ${request.id}:`));
  check('Build Request handoff waits for pending page edits before launching the configured agent');

  const file = join(buildRoot, 'requirements.txt');
  await buildFs.writeFile(file, 'Create ZZ_BR_SQL. Read-only SQL: SELECT 1 FROM PS_INSTALLATION. No business data writes.');
  vscode.window.showOpenDialog = async () => [vscode.Uri.file(file)];
  requestPanel._receive({ type: 'addFiles' });
  await until(async () => (await buildStore.get(request.id)).attachments.length === 1);
  const read = await buildTool('psft_build_request_get', { id: request.id });
  assert.equal(read.buildAuthorized, false); assert.match(read.attachments[0].text, /SELECT 1 FROM PS_INSTALLATION/);
  const names = (await buildRpc('tools/list', {})).tools.map((t: any) => t.name);
  assert.ok(!names.includes('psft_build_request_approve') && !names.includes('psft_build_request_answer'));
  await buildTool('psft_build_request_report', { id: request.id, entries: [{ ref: 'sql', status: 'BUILT', detail: 'Not authorized' }] }, false);
  await buildTool('psft_build_request_ask', { id: request.id, questions: [{ text: 'Keep the lab SQL read only?' }] });
  const spec = { summary: 'Create the disposable SQL only.', objects: [{ ref: 'sql', definitionType: 30, kind: 'SQL definition', name: 'ZZ_BR_SQL', action: 'create', purpose: 'Acceptance check', details: 'SELECT 1 FROM PS_INSTALLATION', sources: ['requirements.txt'] }], testPlan: 'Read back and compare the SQL.' };
  await buildTool('psft_build_request_propose_spec', { id: request.id, spec });
  requestPanel._receive({ type: 'approve', specRevision: 1 });
  await until(async () => vscode._messages.some((m: any) => /Answer the open questions/.test(m[1])));
  assert.equal((await buildTool('psft_build_request_get', { id: request.id })).buildAuthorized, false);
  requestPanel._receive({ type: 'answer', questionId: 'q1', answer: 'Yes, read only.' });
  await until(async () => (await buildStore.get(request.id)).questions[0].answer === 'Yes, read only.');
  assert.equal((await buildTool('psft_build_request_get', { id: request.id })).status, 'SPEC_STALE');
  await buildTool('psft_build_request_propose_spec', { id: request.id, spec });
  check('Build Request attachment intake and HTTP analysis preserve provenance; questions and changed inputs block approval');

  buildApproval = true;
  requestPanel._receive({ type: 'approve', specRevision: 1 });
  await until(async () => vscode._messages.some((m: any) => /spec changed while you were reviewing/.test(m[1])));
  assert.equal((await buildTool('psft_build_request_get', { id: request.id })).buildAuthorized, false);
  requestPanel._receive({ type: 'approve', specRevision: 2 });
  await until(async () => (await buildTool('psft_build_request_get', { id: request.id })).buildAuthorized);
  requestPanel._receive({ type: 'handoff', phase: 'build', agent: 'codex' });
  await until(async () => terminals.length === 2);
  assert.match(terminals[1].options.shellArgs.at(-1), /confirm buildAuthorized is true/);
  assert.equal(terminals[1].commands.length, 0, 'handoff must not reconstruct a shell command');
  const stagedReport = await buildTool('psft_build_request_report', { id: request.id, entries: [{ ref: 'sql', status: 'STAGED', detail: 'Fixture proposal only', changeSetId: '00000000-0000-4000-8000-000000000000' }] });
  assert.equal(stagedReport.status, 'AWAITING_REVIEW');
  assert.deepEqual(stagedReport.remaining, ['sql']);
  assert.deepEqual(stagedReport.awaitingReview, [{ref:'sql',changeSetId:'00000000-0000-4000-8000-000000000000'}]);
  assert.equal((await buildTool('psft_build_request_get', {id:request.id})).status, 'AWAITING_REVIEW');
  assert.equal((await buildTool('psft_build_request_list', {})).requests.find((r:any)=>r.id===request.id).status, 'AWAITING_REVIEW');
  await until(async()=>requestPanel.webview.posted.some((m:any)=>m.state?.statusLabel==='Awaiting Change Review application'));
  const reportTool = (await buildRpc('tools/list', {})).tools.find((t:any)=>t.name==='psft_build_request_report');
  assert.ok(reportTool.inputSchema.properties.entries.items.properties.status.enum.includes('PENDING'));
  const deferredReport = await buildTool('psft_build_request_report', {id:request.id,entries:[{ref:'sql',status:'PENDING',detail:'Waiting for prerequisite approval; resume later.'}]});
  assert.deepEqual(deferredReport.remaining,['sql']);assert.notEqual(deferredReport.status,'BUILT');
  const deferredRequest = await buildTool('psft_build_request_get',{id:request.id});
  assert.equal(deferredRequest.spec.objects[0].progress.status,'PENDING');
  assert.equal(deferredRequest.spec.objects[0].progress.history.at(-2).status,'STAGED');
  check('HTTP discovery and reporting accept deferred PENDING work without completing it or losing history');
  requestPanel._receive({ type: 'edit', edit: { project: 'ZZ_BR_CHANGED' } });
  await until(async () => (await buildStore.get(request.id)).project === 'ZZ_BR_CHANGED');
  assert.equal((await buildTool('psft_build_request_get', { id: request.id })).buildAuthorized, false);
  await buildTool('psft_build_request_report', { id: request.id, entries: [{ ref: 'sql', status: 'BUILT', detail: 'Approval withdrawn' }] }, false);
  check('Build Request fixture UI requires the current spec revision; build handoff/report gates follow approval and later edits withdraw it');
} finally {
  requestPanel?.dispose(); await buildServer.dispose();
  vscode.window.showOpenDialog = oldBuildOpen; vscode.window.showInformationMessage = oldBuildInformation;
  vscode.window.createTerminal = oldBuildTerminal; vscode.env = oldBuildEnv; vscode.workspace.fs = oldBuildFs;
  await buildFs.rm(buildRoot, { recursive: true, force: true });
}

// Staged workflow uses the production MCP wrapper and real review UI handlers.
const { ReviewService } = require('./src/changeReview/service.ts');
const { ReviewStore } = require('./src/changeReview/store.ts');
const { ReviewWorkspace } = require('./src/changeReview/workspace.ts');
const { databaseReviewAdapters } = require('./src/changeReview/adapters.ts');
const { isReviewedWrite } = require('./src/changeReview/authorization.ts');
const fs = await import('node:fs/promises');
const os = await import('node:os');
const reviewRoot = await fs.mkdtemp(join(os.tmpdir(),'psft-review-http-'));
const sqlDefinitions = new Map<string,{text:string;version:number;description?:string;definition?:string;ownerId?:string}>();
const textMarkers=new Map<string,string>(),textVersions=new Map<string,number>();
const contentDefinitions=new Map<string,{text:string;description:string;version:number}>();
let nativeWrites = 0;
provider.changeReviewIdentity = async () => 'fixture-database-and-schema';
provider.readEnvironment = async () => ({toolsRelease:'8.62'});
provider.readSqlForEdit = async (key:any) => sqlDefinitions.get(key.parts[0]);
provider.sqlIdTaken = async (name:string) => sqlDefinitions.has(name);
provider.classifyDefinition = async () => ({ classification:{ownership:'CUSTOM',confidence:'HIGH',evidence:['Fixture ownership only']},evidence:{exists:true} });
provider.saveSqlDefinition = async (request:any) => {
 assert.ok(isReviewedWrite(provider.id,{type:30,parts:[request.sqlId,'0']}),'exact reviewed key must match the provider guard');
 assert.equal(writeOrigin(),'agent');
 const old = sqlDefinitions.get(request.sqlId);
 assert.equal(request.openedVersion,old?.version);
 const version=Math.max(old?.version??0,textVersions.get('sql:'+request.sqlId)??0)+1;textVersions.set('sql:'+request.sqlId,version);
 sqlDefinitions.set(request.sqlId,{text:request.text,version,...(request.metadata??{})});nativeWrites++;
 return {version,created:!old};
};
// Portable full-scope HTTP fixture. Native row/counter behavior is exercised separately on HRDMO.
provider.readTextDefinitionForReview=async(kind:string,name:string,allowDeleted=false)=>{
 const id=kind+':'+name,marker=textMarkers.get(id);if(marker&&!allowDeleted)throw Error('Deleted fixture requires explicit reviewed restoration.');
 const nativeKey=JSON.stringify({type:kind==='html'?51:50,parts:kind==='html'?[name,'4']:[name]});
 const row=kind==='sql'?sqlDefinitions.get(name):contentDefinitions.get(nativeKey);
 const value=row?kind==='sql'?{name,text:row.text,description:row.description??'',definition:(row as any).definition??'',ownerId:(row as any).ownerId??''}:{name,text:row.text,description:row.description}:null;
 return {value,token:row?String(row.version):marker??'absent',version:row?.version??0,deleted:!!marker};
};
provider.writeTextDefinitionForReview=async(request:any)=>{
 const {hash}=require('./src/changeReview/model.ts'),before=await provider.readTextDefinitionForReview(request.kind,request.name,true),id=request.kind+':'+request.name;
 assert.equal(request.expectedSnapshotToken,before.token);assert.equal(request.expectedAfterHash,hash(request.after));
 if(before.deleted&&!request.allowDeletedBaseline)throw Error('Deleted fixture requires explicit reviewed restoration.');
 const version=Math.max(before.version,textVersions.get(id)??0)+1;
 const after={value:request.after,token:request.after===null?'fixture-text-deleted:'+version:String(version),version:request.after===null?0:version,deleted:request.after===null};
 if(!request.dryRun){
  const key={type:request.kind==='sql'?30:request.kind==='html'?51:50,parts:request.kind==='sql'?[request.name,'0']:request.kind==='html'?[request.name,'4']:[request.name]};
  assert.equal(writeOrigin(),'agent');assert.ok(isReviewedWrite(provider.id,key));
  if(request.after===null){if(request.kind==='sql'){sqlDefinitions.delete(request.name);nativeWrites++;}else contentDefinitions.delete(JSON.stringify(key));textMarkers.set(id,after.token);textVersions.set(id,version);}
  else{
   textMarkers.delete(id);
   if(request.kind==='sql')await provider.saveSqlDefinition({sqlId:request.name,text:request.after.text,metadata:{description:request.after.description,definition:request.after.definition,ownerId:request.after.ownerId},openedVersion:before.value===null?undefined:before.version});
   else{const requestOld={name:request.name,text:request.after.text,description:request.after.description,openedVersion:before.value===null?undefined:before.version};if(request.kind==='html')await provider.saveHtmlDefinition(requestOld);else await provider.saveStyleSheet(requestOld);const row=contentDefinitions.get(JSON.stringify(key))!;row.version=version;textVersions.set(id,version);}
  }
 }
 return {before,after};
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
async function reviewCall(name:string,args:object,expect=true){const r=await reviewRpc('tools/call',{name,arguments:args});if(!expect){assert.equal(r.isError,true,'Expected refusal: '+name);return r;}assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);}
async function until(test:()=>Promise<boolean>){for(let n=0;n<2000;n++){if(await test())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Review UI did not reach expected state');}

// Evaluate the actual rendered webview script with a minimal DOM: capture its exact click payload,
// including JSON-decoded data attributes and duplicate-click suppression. No browser/DB claim.
function clickRenderedReview(html:string, action:string, destructive=false) {
 const {runInNewContext}=require('node:vm');
 const decode=(s:string)=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
 const messages:any[]=[];const body:Record<string,string>={};
 const buttons=[...html.matchAll(/<button\b([^>]*)>/g)].map(match=>{
   const dataset:Record<string,string>={},listeners:Record<string,()=>void>={};
   for(const [,key,value] of match[1].matchAll(/(data-[\w-]+)="([^"]*)"/g))dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=decode(value);
   return {dataset,disabled:/\bdisabled\b/.test(match[1]),listeners,addEventListener:(name:string,fn:()=>void)=>{listeners[name]=fn;}};
 });
 if(destructive)assert.ok(html.includes('id="destructive"'),'Explicit consent must exist in the rendered page.');
 const document={body:{setAttribute:(k:string,v:string)=>{body[k]=v;}},getElementById:(id:string)=>id==='destructive'?{checked:destructive}:null,
   querySelectorAll:(selector:string)=>selector==='[data-action]'?buttons.filter(b=>b.dataset.action):selector==='[data-select]'?buttons.filter(b=>b.dataset.select):selector==='[data-list-mode]'?buttons.filter(b=>b.dataset.listMode):[]};
 const script=/<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)?.[1];assert.ok(script);
 runInNewContext(script,{document,window:{},acquireVsCodeApi:()=>({postMessage:(message:any)=>messages.push(message)})});
 const button=buttons.find(b=>b.dataset.action===action);assert.ok(button&&!button.disabled,'The intended rendered action must be enabled.');
 button.listeners.click();button.listeners.click();
 assert.equal(messages.length,1,'The rendered handler must suppress a duplicate apply click.');
 assert.equal(body['aria-busy'],'true');assert.ok(button.disabled);
 return JSON.parse(JSON.stringify(messages[0]));
}

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
 assert.equal((await reviewService.reversalSupport(await reviewService.store.get(contentSet.id))).supported,true);
 check('HTML/style proposals use complete reversible checkpoints and normalize before approval');
 let contentInverse=await reviewCall('psft_prepare_revert',{changeSetId:contentSet.id});contentInverse=await reviewCall('psft_validate_change_set',{changeSetId:contentInverse.id});assert.equal(contentInverse.status,'READY_FOR_REVIEW');await reviewUi.show(contentInverse.id);
 contentPage._receive(clickRenderedReview(contentPage.webview.html,'approveAndApply',true));
 await until(async()=>(await reviewService.store.get(contentInverse.id)).status==='APPLIED'&&(await reviewService.store.get(contentSet.id)).status==='REVERTED'&&!require('node:fs').existsSync(join(reviewRoot,'writer.lock')));assert.equal(contentDefinitions.size,0);
 const nativeCountBeforeRedo=nativeWrites;
 await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:51,name:'ZZ_REVIEW_HTML',text:'unreviewed recreation'},false);assert.equal(contentDefinitions.size,0);assert.equal(nativeWrites,nativeCountBeforeRedo);
 let contentRedo=await reviewCall('psft_prepare_redo',{changeSetId:contentSet.id});contentRedo=await reviewCall('psft_validate_change_set',{changeSetId:contentRedo.id});await reviewUi.show(contentRedo.id);contentPage._receive(clickRenderedReview(contentPage.webview.html,'approveAndApply'));
 await until(async()=>(await reviewService.store.get(contentRedo.id)).status==='APPLIED'&&!require('node:fs').existsSync(join(reviewRoot,'writer.lock')));assert.equal(contentDefinitions.size,2);
 assert.equal((await provider.readTextDefinitionForReview('html','ZZ_REVIEW_HTML')).value?.description,'Review HTML');assert.equal((await provider.readTextDefinitionForReview('stylesheet','ZZ_REVIEW_CSS')).value?.description,'Review CSS');
 check('HTTP content creation inverse needs rendered destructive consent; ordinary recreation refuses markers and fresh reviewed redo restores complete payloads');
 let completeSql=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'Complete SQL metadata creation undo'});
 await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_FULL_SQL',text:'SELECT 7 FROM DUAL',changeSetId:completeSql.id});completeSql=await reviewCall('psft_get_change_set',{changeSetId:completeSql.id});assert.equal(completeSql.objects[0].adapter,'sql-definition');
 const sqlPayload={name:'ZZ_FULL_SQL',text:'SELECT 7 FROM DUAL',description:'Full SQL metadata',definition:'Complete comments é😀 '.repeat(600),ownerId:'PPT'};
 completeSql=await reviewCall('psft_stage_object_change',{changeSetId:completeSql.id,adapter:'sql-definition',key:'ZZ_FULL_SQL',objectId:completeSql.objects[0].id,after:sqlPayload});
 sqlPayload.text='SELECT 8 FROM DUAL';await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_FULL_SQL',text:sqlPayload.text,changeSetId:completeSql.id});completeSql=await reviewCall('psft_get_change_set',{changeSetId:completeSql.id});assert.deepEqual(await reviewService.store.readBlob(completeSql.objects[0].after),sqlPayload);
 completeSql=await reviewCall('psft_validate_change_set',{changeSetId:completeSql.id});await reviewUi.show(completeSql.id);contentPage._receive(clickRenderedReview(contentPage.webview.html,'approveAndApply'));
 await until(async()=>(await reviewService.store.get(completeSql.id)).status==='APPLIED'&&!require('node:fs').existsSync(join(reviewRoot,'writer.lock')));
 let sqlInverse=await reviewCall('psft_prepare_revert',{changeSetId:completeSql.id});sqlInverse=await reviewCall('psft_validate_change_set',{changeSetId:sqlInverse.id});await reviewUi.show(sqlInverse.id);contentPage._receive(clickRenderedReview(contentPage.webview.html,'approveAndApply',true));
 await until(async()=>(await reviewService.store.get(sqlInverse.id)).status==='APPLIED'&&(await reviewService.store.get(completeSql.id)).status==='REVERTED'&&!require('node:fs').existsSync(join(reviewRoot,'writer.lock')));assert.equal(sqlDefinitions.has('ZZ_FULL_SQL'),false);
 let sqlRedo=await reviewCall('psft_prepare_redo',{changeSetId:completeSql.id});sqlRedo=await reviewCall('psft_validate_change_set',{changeSetId:sqlRedo.id});await reviewUi.show(sqlRedo.id);contentPage._receive(clickRenderedReview(contentPage.webview.html,'approveAndApply'));
 await until(async()=>(await reviewService.store.get(sqlRedo.id)).status==='APPLIED'&&!require('node:fs').existsSync(join(reviewRoot,'writer.lock')));assert.deepEqual((await provider.readTextDefinitionForReview('sql','ZZ_FULL_SQL')).value,sqlPayload);
 check('HTTP SQL creation uses a complete checkpoint and rendered inverse/redo retains long comments, description and owner');
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
 await reviewUi.show(reversal.id);const deletionHtml=codePage.webview.html;assert.ok(deletionHtml.includes('id="destructive"'));await reviewUi.show(reversal.id);assert.equal(codePage.webview.html,deletionHtml,'Exact-state refresh must retain the existing DOM.');
 check('identical review refresh retains the rendered consent form instead of replacing its DOM');
 codePage._receive(clickRenderedReview(codePage.webview.html,'approveAndApply'));
 await until(async()=>codePage.webview.html.includes('Distinct destructive-operation approval is required.'));
 const refusedHtml=codePage.webview.html;
 codePage._receive(clickRenderedReview(codePage.webview.html,'approveAndApply'));
 await until(async()=>codePage.webview.html!==refusedHtml);
 assert.equal((await reviewService.store.get(reversal.id)).status,'READY_FOR_REVIEW');assert.equal(codeDefinitions.size,1);
 check('repeated identical destructive-approval refusal rebuilds the locally disabled form and remains retryable without writing');
 codePage._receive({action:'approve',id:reversal.id,revision:reversal.revision,destructive:true});await until(async()=>(await reviewService.store.get(reversal.id)).status==='APPROVED');
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

 // A failed existing-definition writer left the exact native baseline intact.
 // Reconciliation may prepare a fresh proposal, but cannot reuse its approval.
 let rollbackAttempts=0,refuseRolledBack=true;
 provider.saveSqlDefinition=async(request:any)=>{
   if(request.sqlId==='ZZ_PARTIAL_C') { rollbackAttempts++; if(refuseRolledBack)throw new Error('fixture writer rolled back before commit'); }
   return saveBeforePartial(request);
 };
 const rollbackSet=await reviewCall('psft_create_change_set',{title:'Rolled-back UPDATE recovery',connection:'FIXTURE'});
 await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_PARTIAL_C',text:'SELECT 2 FROM DUAL',changeSetId:rollbackSet.id});
 const rollbackReady=await reviewCall('psft_validate_change_set',{changeSetId:rollbackSet.id});
 await reviewUi.show(rollbackSet.id);const rollbackPage=vscode._panels.at(-1);
 rollbackPage._receive({action:'approve',id:rollbackSet.id,revision:rollbackReady.revision});await until(async()=>(await reviewService.store.get(rollbackSet.id)).status==='APPROVED');
 rollbackPage._receive({action:'apply',id:rollbackSet.id,revision:rollbackReady.revision});await until(async()=>(await reviewService.store.get(rollbackSet.id)).objects[0].application==='UNCERTAIN');
 assert.equal(sqlDefinitions.get('ZZ_PARTIAL_C')?.text,'SELECT 1 FROM DUAL');assert.equal(rollbackAttempts,1);
 rollbackPage._receive({action:'recover',id:rollbackSet.id,revision:rollbackReady.revision});
 await until(async()=>(await reviewService.store.get(rollbackSet.id)).objects[0].application==='PENDING');
 await reviewUi.show(rollbackSet.id);
 const remainingButton=rollbackPage.webview.html.match(/<button\b[^>]*data-action="remaining"[^>]*>/)?.[0];
 assert.ok(remainingButton&&!/\bdisabled\b/.test(remainingButton));assert.equal(rollbackAttempts,1);
 rollbackPage._receive({action:'remaining',id:rollbackSet.id,revision:rollbackReady.revision});
 await until(async()=>(await reviewService.store.list()).some((s:any)=>s.continuation?.changeSetId===rollbackSet.id));
 let rollbackFollowup=await reviewCall('psft_prepare_remaining_work',{changeSetId:rollbackSet.id});
 assert.equal(rollbackFollowup.objects[0].approvedHash,undefined);assert.equal(rollbackAttempts,1);
 rollbackFollowup=await reviewCall('psft_validate_change_set',{changeSetId:rollbackFollowup.id});
 await reviewUi.show(rollbackFollowup.id);
 rollbackPage._receive({action:'apply',id:rollbackFollowup.id,revision:rollbackFollowup.revision});
 await until(async()=>rollbackPage.webview.html.includes('An approved Change Set is required'));
 assert.equal(rollbackAttempts,1);refuseRolledBack=false;
 rollbackPage._receive({action:'approve',id:rollbackFollowup.id,revision:rollbackFollowup.revision});await until(async()=>(await reviewService.store.get(rollbackFollowup.id)).status==='APPROVED');
 rollbackPage._receive({action:'apply',id:rollbackFollowup.id,revision:rollbackFollowup.revision});await until(async()=>(await reviewService.store.get(rollbackFollowup.id)).status==='APPLIED');
 assert.equal(rollbackAttempts,2);assert.equal(sqlDefinitions.get('ZZ_PARTIAL_C')?.text,'SELECT 2 FROM DUAL');
 provider.saveSqlDefinition=saveBeforePartial;
 check('exact existing baseline reconciliation enables UI remaining work, refuses inherited approval and applies only a freshly reviewed continuation');

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
 // Deleting a control has no Page adapter: grouped into a Change Set it is refused, never written outside the set the developer reviews.
 const structuralSet=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'Structural Page operation'}),committedBefore=pageNative.counts().committed;
 const unsupported=await reviewRpc('tools/call',{name:'psft_edit_page',arguments:{connection:'FIXTURE',page:'ZZ_PREVIEW_PAGE',changeSetId:structuralSet.id,operations:[{op:'delete',id:1}]}});assert.equal(unsupported.isError,true,'a structural Page edit in a Change Set is refused');assert.match(unsupported.content[0].text,/inserted or deleted Page control is not staged.*cannot be grouped into a Change Set/,'refused by review routing, not by a write guard');assert.equal(pageNative.counts().committed,committedBefore,'nothing written');
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
   const structural=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:family+' structural operation'});
   const count=(await reviewService.store.list()).length;const refused=await reviewRpc('tools/call',{name:toolName,arguments:{...request,changeSetId:structural.id,operations:[{op:family==='record'?'remove_field':'delete_section',field:'DESCR',section:'MAIN'}]}});assert.equal(refused.isError,true,'a structural '+family+' edit in a Change Set is refused');assert.match(refused.content[0].text,/structural Record or App Engine operation is not staged.*cannot be grouped into a Change Set/,'refused by review routing, not by a write guard');assert.equal((await reviewService.store.list()).length,count);
   const drift=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:family+' unversioned native drift'});
   await reviewCall(toolName,{...request,expectedVersion:undefined,changeSetId:drift.id});ready=await reviewCall('psft_validate_change_set',{changeSetId:drift.id});await reviewUi.show(drift.id);
   ui._receive({action:'approve',id:drift.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(drift.id)).status==='APPROVED');
   native.editCommitted((t:any)=>{t[family==='record'?'PSRECDEFN':'PSAEAPPLDEFN'][0].FUTURE_COLUMN='outside';});
   ui._receive({action:'apply',id:drift.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(drift.id)).status==='CONFLICTED');assert.equal(native.counts().commits,2);
   check(family+' bounded header HTTP/UI stages without writes, applies actual native writer, verifies inverse/timeline and blocks structural edits and unversioned drift');
 }
 // Coherent creation: real Record/AE/project writers; SQL persistence remains the HTTP fixture above.
 {
   const {documentFromSpec}=require('./src/model/aeSpec.ts');
   const {projectTransaction}=require('./src/test/fixtures/projectTransaction.ts');
   const source=await fs.readFile(join(root,'tools/lab/request-file/export.peoplecode'),'utf8');
   const spec={program:'ZZ_RF_EXPORT',description:'Synthetic CSV export',disableRestart:true,stateRecords:[{record:'ZZ_RF_AET',default:true}],sections:[{name:'MAIN',steps:[{name:'Export',actions:[{type:'PeopleCode',peopleCode:source}]}]}]};
   const recordNative=structuredTransaction('record',true,undefined,'ZZ_RF_AET');
   const aeNative=structuredTransaction('ae',true,documentFromSpec(spec),'ZZ_RF_EXPORT');
   const projectNative=projectTransaction();
   const beforeReceipt=provider.noteCreation;provider.noteCreation=async()=>{};
   const fields=new Map([['PROCESS_INSTANCE',{F:'PROCESS_INSTANCE',T:2,L:10,D:0}],['DESCR',{F:'DESCR',T:0,L:30,D:0}]]);
   provider.withConnection=async(fn:any)=>{
     let active:any,owner:any;
     const pick=(table:string)=>table.startsWith('PSPROJECT')?projectNative:(table.startsWith('PSREC')||['PSINDEXDEFN','PSKEYDEFN'].includes(table))?recordNative:aeNative;
     const connection={catalog:{tableExists:async()=>true,columns:async(_c:any,table:string)=>pick(table).connection.catalog.columns(connection,table)},
       execute:async(sql:string,binds:any={},opts?:any)=>{
         const text=sql.replace(/\s+/g,' ').trim();
         if(text==='SET TRANSACTION READ ONLY')return{rows:[]};
         if(text.includes('FROM PSOPRDEFN'))return{rows:[{N:1}]};
         if(text.includes('FROM PSDBFIELD'))return{rows:text.includes('COUNT(*)')?[{N:fields.has(binds.f)?1:0}]:fields.has(binds.f)?[fields.get(binds.f)]:[]};
         if(text.includes('FROM PSRECFIELDDB R, PSDBFIELD D'))return{rows:recordNative.state().PSRECFIELDDB.map((r:any)=>fields.get(r.FIELDNAME))};
         if(text.startsWith('SELECT RECTYPE AS T'))return{rows:recordNative.state().PSRECDEFN.map((r:any)=>({T:r.RECTYPE}))};
         if(text.startsWith('SELECT FIELDNAME AS F FROM PSRECFIELDDB'))return{rows:recordNative.state().PSRECFIELDDB.map((r:any)=>({F:r.FIELDNAME}))};
         if(text.includes('SELECT COUNT(*) AS N FROM PSSQLDEFN WHERE')&&binds.b0)return{rows:[{N:sqlDefinitions.has(binds.b0)?1:0}]};
         if(text.includes('SELECT SQLTEXT AS T FROM PSSQLTEXTDEFN WHERE SQLID = :i'))return{rows:sqlDefinitions.has(binds.i)?[{T:sqlDefinitions.get(binds.i)!.text}]:[]};
         // The 8.62 project reversal writer opens with PSSTATUS and scans the catalog for project-keyed tables.
         if(text==='SELECT TOOLSREL FROM PSSTATUS'||text.includes('FROM ALL_TABLES')){active=projectNative;owner??=active;}
         const table=text.match(/(?:FROM|INTO|UPDATE) (\w+)/)?.[1];
         if(table&&!['PSVERSION','PSLOCK','DUAL','PSOPRDEFN','PSSTATUS','ALL_TABLES'].includes(table)){active=pick(table);owner??=active;}
         if(!active)throw new Error('Unscoped creation fixture SQL: '+text);
         projectNative.definitionsExist(recordNative.state().PSRECDEFN.length>0&&aeNative.state().PSPCMPROG.length>0&&sqlDefinitions.has('ZZ_RF_ROWS'));
         return active.connection.execute(sql,binds,opts);
       },commit:async()=>owner.connection.commit(),rollback:async()=>owner?.connection.rollback(),close:async()=>{}};
     return fn(connection);
   };
   provider.guard=async()=>{throw new Error('New definitions must retain creation-only native paths');};
   try{
     const set=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'Synthetic Record SQL AE project creation'});
     const recordRequest={connection:'FIXTURE',record:'ZZ_RF_AET',recordType:'derivedWork',operations:[{op:'insert_field',field:'PROCESS_INSTANCE'},{op:'insert_field',field:'DESCR',after:'PROCESS_INSTANCE'},{op:'set_properties',description:'Synthetic file state'}],changeSetId:set.id};
     Object.defineProperty(provider,'platform',{value:'sqlserver',configurable:true});
     try { await reviewCall('psft_create_record',recordRequest,false); } finally { delete provider.platform; }
     await reviewCall('psft_create_record',recordRequest);
     const recordId=(await reviewService.store.get(set.id)).objects[0].id;
     await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_RF_ROWS',text:await fs.readFile(join(root,'tools/lab/request-file/rows.sql'),'utf8'),changeSetId:set.id});
     const sqlId=(await reviewService.store.get(set.id)).objects[1].id;
     await reviewCall('psft_ae_create',{connection:'FIXTURE',spec,changeSetId:set.id},false);
     await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_RF_ROWS',text:'SELECT A, B, C FROM DUAL WHERE A = :1',changeSetId:set.id});
     await reviewCall('psft_ae_create',{connection:'FIXTURE',spec,changeSetId:set.id,dependsOn:[recordId,sqlId]},false);
     await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_RF_ROWS',text:await fs.readFile(join(root,'tools/lab/request-file/rows.sql'),'utf8'),changeSetId:set.id});
     await reviewCall('psft_ae_create',{connection:'FIXTURE',spec,changeSetId:set.id,dependsOn:[recordId,sqlId]});
     const aeId=(await reviewService.store.get(set.id)).objects[2].id;
     const items=[{type:0,parts:['ZZ_RF_AET']},{type:30,parts:['ZZ_RF_ROWS','0']},{type:33,parts:['ZZ_RF_EXPORT']},{type:34,parts:['ZZ_RF_EXPORT','MAIN']},{type:43,parts:['ZZ_RF_EXPORT','MAIN','GBL','default','1900-01-01','Export','OnExecute']}];
     await reviewCall('psft_create_project',{connection:'FIXTURE',project:'ZZ_RF_PRJ',items,changeSetId:set.id},false);
     await reviewCall('psft_create_project',{connection:'FIXTURE',project:'ZZ_RF_PRJ',items,changeSetId:set.id,dependsOn:[aeId]});
     assert.equal(recordNative.counts().commits+aeNative.counts().commits+projectNative.counts().commits,0);
     assert.equal(sqlDefinitions.has('ZZ_RF_ROWS'),false);
     let ready=await reviewCall('psft_validate_change_set',{changeSetId:set.id});
     assert.equal(ready.status,'READY_FOR_REVIEW',JSON.stringify(ready.objects.map((c:any)=>c.validation)));
     assert.deepEqual(ready.objects.map((c:any)=>c.adapter),['record-create','sql-definition','ae-create','project-create']);
     assert.equal(ready.objects.every((c:any)=>c.operation==='CREATE'&&c.application==='PENDING'),true);
     check('Record SQL AE and project creation stage together through real HTTP without persistence; absent proposed dependencies refuse validation');
     await reviewUi.show(set.id);const ui=vscode._panels.at(-1);
     ui._receive({action:'approve',id:set.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(set.id)).status==='APPROVED');
     ui._receive({action:'apply',id:set.id,revision:ready.revision});await until(async()=>['APPLIED','PARTIALLY_APPLIED','CONFLICTED','FAILED'].includes((await reviewService.store.get(set.id)).status));
     const applied=await reviewService.store.get(set.id);
     assert.equal(applied.status,'APPLIED',JSON.stringify(applied.journal.at(-1)));
     assert.ok(applied.objects.every((c:any)=>c.application==='VERIFIED'&&c.verified===c.after));
     assert.deepEqual([recordNative.counts().commits,aeNative.counts().commits,projectNative.counts().commits],[1,1,1]);
     assert.equal(projectNative.state().PSPROJECTITEM.length,5);
     // Creation reversal now covers every family here (record/AE/SQL deletion and 8.62 project deletion): the inverse
     // is prepared, unapproved, as deletions in reverse dependency order, the project before what it lists.
     const inverse=await reviewCall('psft_prepare_revert',{changeSetId:set.id});
     assert.deepEqual(inverse.objects.map((c:any)=>[c.adapter,c.operation]).sort(),[['ae-create','DELETE'],['project-create','DELETE'],['record-create','DELETE'],['sql-definition','DELETE']]);
     const order=(adapter:string)=>inverse.objects.findIndex((c:any)=>c.adapter===adapter),requires=(a:string,b:string)=>inverse.objects[order(a)].dependencies.includes(inverse.objects[order(b)].id);
     assert.ok(requires('ae-create','project-create')&&requires('record-create','ae-create'),JSON.stringify(inverse.objects.map((c:any)=>[c.adapter,c.dependencies])));
     assert.equal(projectNative.state().PSPROJECTITEM.length,5);
     await reviewCall('psft_create_record',recordRequest,false);
     check('trusted UI applies exact dependency-ordered creation with real native writers and project membership; occupied names refuse and the creation inverse is prepared in reverse dependency order without writing');
   }finally{provider.noteCreation=beforeReceipt;}
 }
 // New IB adapters use the same trusted UI, real provider/writer and durable review service.
 const {ibTransaction}=require('./src/test/fixtures/ibTransaction.ts');
 const {inputForIb}=require('./src/model/ibOperations.ts');
 for(const kind of ['service','operation']){
   const native=ibTransaction(kind),type=kind==='service'?79:80;let legacyIb=false;
   provider.withConnection=async(fn:any)=>fn(native.connection);
   provider.guard=async(key:any)=>{assert.deepEqual(key,{type,parts:[native.name]});assert.equal(isReviewedWrite(provider.id,key),!legacyIb);assert.equal(writeOrigin(),'agent');};
   const live=await provider.readIntegrationBroker(kind,[native.name]),input=inputForIb(live);input.properties.DESCR='Reviewed IB';
   const request={connection:'FIXTURE',input,expectedToken:live.token};
   const set=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'IB '+kind+' header fixture'});
   const proposed=await reviewCall('psft_ib_save',{...request,changeSetId:set.id});assert.equal(proposed.persisted,false);assert.deepEqual(native.state(),native.initial);assert.equal(native.counts().commits,0);
   let ready=await reviewCall('psft_validate_change_set',{changeSetId:set.id});assert.equal(ready.status,'READY_FOR_REVIEW');
   await reviewUi.show(set.id);const ui=vscode._panels.at(-1);
   ui._receive({action:'approve',id:set.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(set.id)).status==='APPROVED');
   ui._receive({action:'apply',id:set.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(set.id)).status==='APPLIED');assert.equal(native.counts().commits,1);
   let reverse=await reviewCall('psft_prepare_revert',{changeSetId:set.id});reverse=await reviewCall('psft_validate_change_set',{changeSetId:reverse.id});assert.equal(reverse.status,'READY_FOR_REVIEW');
   await reviewUi.show(reverse.id);ui._receive({action:'approve',id:reverse.id,revision:reverse.revision});await until(async()=>(await reviewService.store.get(reverse.id)).status==='APPROVED');
   ui._receive({action:'apply',id:reverse.id,revision:reverse.revision});await until(async()=>(await reviewService.store.get(reverse.id)).status==='APPLIED');assert.equal(native.counts().commits,2);
   const timeline=await reviewCall('psft_get_object_timeline',{changeSetId:reverse.id,objectId:reverse.objects[0].id,checkLive:true});assert.equal(timeline.live.status,'MATCHES_RECORDED');assert.equal(timeline.revisions.length,2);
   check('IB '+kind+' production HTTP/UI stages rollback preview, applies/reverses actual writer and verifies timeline');
   const structuralInput=structuredClone(input);structuralInput.properties.IB_ALIASNAME='ZZ_OUTSIDE';
   const structural=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'IB structural refusal'});
   const fresh=await provider.readIntegrationBroker(kind,[native.name]);
   const refused=await reviewRpc('tools/call',{name:'psft_ib_save',arguments:{connection:'FIXTURE',input:structuralInput,expectedToken:fresh.token,changeSetId:structural.id}});assert.equal(refused.isError,true);assert.match(refused.content[0].text,/IB_ALIASNAME is outside reviewed IB structure.*cannot be grouped/s);assert.equal(native.counts().commits,2);
   const drift=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'IB drift refusal'});
   await reviewCall('psft_ib_save',{connection:'FIXTURE',input,expectedToken:fresh.token,changeSetId:drift.id});ready=await reviewCall('psft_validate_change_set',{changeSetId:drift.id});
   await reviewUi.show(drift.id);ui._receive({action:'approve',id:drift.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(drift.id)).status==='APPROVED');
   native.drift();ui._receive({action:'apply',id:drift.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(drift.id)).status==='CONFLICTED');assert.equal(native.counts().commits,2);
   const legacyLive=await provider.readIntegrationBroker(kind,[native.name]);
   const legacyInput=inputForIb(legacyLive);legacyInput.properties.IB_ALIASNAME='ZZ_OUTSIDE';
   const confirmationCount=confirmed;legacyIb=true;
   const legacyResult=await reviewCall('psft_ib_save',{connection:'FIXTURE',input:legacyInput,expectedToken:legacyLive.token});
   assert.equal(legacyResult.saved,true);assert.equal(confirmed,confirmationCount+1);assert.equal(native.counts().commits,3);legacyIb=false;
   check('IB '+kind+' grouped out-of-contract edits and unversioned drift cannot write; ungrouped ones retain confirmation');
   // Bounded structure: the writer's rollback preview defines the after-image; apply reproduces it exactly.
   const shaped=ibTransaction(kind,true);provider.withConnection=async(fn:any)=>fn(shaped.connection);
   const shapedLive=await provider.readIntegrationBroker(kind,[shaped.name]),shapedInput=inputForIb(shapedLive);
   if(kind==='service'){shapedInput.properties.OBJECTOWNERID='ZZ';shapedInput.properties.IB_NAMESPACE='urn:reviewed';}
   else{shapedInput.sections.handlers.push({HANDLERNAME:'REQUESTHDLR',HANDLERID:'RQST',HANDLERTYPE:'ApplicationClass',ACTIVE_FLAG:'A'});shapedInput.sections.applicationClassHandlers.push({HANDLERNAME:'REQUESTHDLR',PACKAGEID:' ',PACKAGEROOT:'ZZ_PKG',QUALIFYPATH:':',APPCLASSID:'Handler',APPCLASSMETHOD:'OnRequest'});}
   const shapedSet=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'IB '+kind+' structure fixture'});
   const shapedStage=await reviewCall('psft_ib_save',{connection:'FIXTURE',input:shapedInput,expectedToken:shapedLive.token,changeSetId:shapedSet.id});
   assert.equal(shapedStage.persisted,false);assert.deepEqual(shaped.state(),shaped.initial);assert.equal(shaped.counts().commits,0);
   ready=await reviewCall('psft_validate_change_set',{changeSetId:shapedSet.id});assert.equal(ready.status,'READY_FOR_REVIEW');
   await reviewUi.show(shapedSet.id);ui._receive({action:'approve',id:shapedSet.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(shapedSet.id)).status==='APPROVED');
   ui._receive({action:'apply',id:shapedSet.id,revision:ready.revision});await until(async()=>(await reviewService.store.get(shapedSet.id)).status==='APPLIED');assert.equal(shaped.counts().commits,1);
   if(kind==='service'){
    assert.equal(shaped.state().PSSERVICE[0].IB_NAMESPACE,'urn:reviewed');assert.equal(shaped.state().PSSERVICE[0].IBEXTERNALPWD,'fixture-private');
    let back=await reviewCall('psft_prepare_revert',{changeSetId:shapedSet.id});back=await reviewCall('psft_validate_change_set',{changeSetId:back.id});assert.equal(back.status,'READY_FOR_REVIEW');
    await reviewUi.show(back.id);ui._receive({action:'approve',id:back.id,revision:back.revision});await until(async()=>(await reviewService.store.get(back.id)).status==='APPROVED');
    ui._receive({action:'apply',id:back.id,revision:back.revision});await until(async()=>(await reviewService.store.get(back.id)).status==='APPLIED');
    assert.equal(shaped.state().PSSERVICE[0].IB_NAMESPACE,'urn:fixture');assert.equal(shaped.counts().commits,2);
    // APPLIED is saved before the original is marked REVERTED inside the same exclusive section.
    await until(async()=>(await reviewService.store.get(shapedSet.id)).status==='REVERTED'&&!require('node:fs').existsSync(require('node:path').join(reviewService.store.root,'writer.lock')));
   }else{
    assert.ok(shaped.state().PSOPRHDLR.some((r:any)=>r.HANDLERNAME==='REQUESTHDLR'));
    let back=await reviewCall('psft_prepare_revert',{changeSetId:shapedSet.id});back=await reviewCall('psft_validate_change_set',{changeSetId:back.id});assert.equal(back.status,'READY_FOR_REVIEW',JSON.stringify(back.objects.map((c:any)=>c.validation)));
    await reviewUi.show(back.id);ui._receive({action:'approve',id:back.id,revision:back.revision});await until(async()=>(await reviewService.store.get(back.id)).status==='APPROVED');
    ui._receive({action:'apply',id:back.id,revision:back.revision});await until(async()=>['APPLIED','CONFLICTED','FAILED'].includes((await reviewService.store.get(back.id)).status));assert.equal((await reviewService.store.get(back.id)).status,'APPLIED');
    assert.equal(shaped.counts().commits,2);assert.equal(shaped.state().PSOPRHDLRDEL.length,1);assert.equal(shaped.state().PSOPRHDLR.some((r:any)=>r.HANDLERNAME==='REQUESTHDLR'),false);
   }
   check('IB '+kind+' bounded structure stages the writer preview, applies exactly through trusted UI and '+(kind==='service'?'reverses by typed inverse':'reverses an added handler with native deletion marker/counter rules'));
 }
 for(const release of ['8.61.15','8.62.09'])for(const restRole of ['consumer','provider']){
   const native=ibTransaction('operation',true,{release,restRole});provider.withConnection=async(fn:any)=>fn(native.connection);
   provider.guard=async(key:any)=>{assert.deepEqual(key,{type:80,parts:[native.name]});assert.equal(isReviewedWrite(provider.id,key),true);assert.equal(writeOrigin(),'agent');};
   const baseline=await provider.readIbForReview('operation',native.name),live=await provider.readIntegrationBroker('operation',[native.name]),input=inputForIb(live);
   input.sections.uriTemplates[0].IB_URI_TEMPLATE='v2/items/{item}';
   const set=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:`REST ${restRole} ${release} URI review`});
   const staged=await reviewCall('psft_ib_save',{connection:'FIXTURE',input,expectedToken:live.token,changeSetId:set.id});assert.equal(staged.persisted,false);assert.deepEqual(native.state(),native.initial);
   const apply=async(id:string)=>{const ready=await reviewCall('psft_validate_change_set',{changeSetId:id});assert.equal(ready.status,'READY_FOR_REVIEW',JSON.stringify(ready.objects.map((c:any)=>c.validation)));
     await reviewUi.show(id);const ui=vscode._panels.at(-1);ui._receive({action:'approve',id,revision:ready.revision});await until(async()=>(await reviewService.store.get(id)).status==='APPROVED');
     ui._receive({action:'apply',id,revision:ready.revision});await until(async()=>['APPLIED','CONFLICTED','FAILED'].includes((await reviewService.store.get(id)).status));assert.equal((await reviewService.store.get(id)).status,'APPLIED');};
   await apply(set.id);assert.equal(native.state().PSOPERATIONURI[0].IB_URI_TEMPLATE,'v2/items/{item}');
   for(const t of ['PSOPRURIDATA','PSIBOPRROOT','PSIBRTNGDEFN','PSSERVICEOPR'])assert.deepEqual(native.state()[t],native.initial[t]);
   const inverse=await reviewCall('psft_prepare_revert',{changeSetId:set.id});await apply(inverse.id);assert.equal((await provider.readIbForReview('operation',native.name)).hash,baseline.hash);
   const timeline=await reviewCall('psft_get_object_timeline',{changeSetId:inverse.id,objectId:inverse.objects[0].id,checkLive:true});assert.equal(timeline.live.status,'MATCHES_RECORDED');
   check(`IB ${release} REST ${restRole} URI review stages/applies/reverses through production HTTP and trusted UI, preserving mappings and routing`);
 }
 const lifecycleCaptures=JSON.parse(require('node:fs').readFileSync('src/test/fixtures/ib-native-8.62.09/definition-lifecycle.json','utf8'));
 for(const kind of ['service','operation']){
   const capture=lifecycleCaptures.find((c:any)=>c.kind===kind&&c.case.includes('recreate'));
   const name=kind==='service'?'ZZ_PCODE_LAB_IBE':'ZZ_PCODE_LAB_IBO',owner=kind==='operation'?'ZZ_PCODE_LAB_IBS':undefined;
   const rows=structuredClone(capture.before);for(const t of ['PSSERVICEDEL','PSOPERATIONDEL','PSOPRVERDFNDEL','PSOPRHDLRDEL'])if(rows[t])rows[t]=[];
   const native=ibTransaction(kind,true,{name,schema:capture.schema,nativeRows:{...rows,PSPROJECTITEM:[],PSPCMTXT:[],PSSQLTEXTDEFN:[]}});
   provider.withConnection=async(fn:any)=>fn(native.connection);
   provider.guard=async(key:any)=>{assert.ok([[kind==='service'?79:80,name],...(owner?[[79,owner]]:[])].some(([t,n])=>key.type===t&&key.parts[0]===n));assert.equal(isReviewedWrite(provider.id,key),true);assert.equal(writeOrigin(),'agent');};
   const target=ibTransaction(kind,true,{name,schema:capture.schema,nativeRows:capture.after});
   const {readIbLifecycle,ibLifecycleInput}=require('./src/providers/ibLifecycle.ts'),identity={kind,name,...(owner?{service:owner}:{})};
   const after=await readIbLifecycle(target.connection,provider.types,identity);
   const input=ibLifecycleInput(after.value,identity),fresh=await reviewCall('psft_ib_definition_get',{connection:'FIXTURE',...identity});assert.equal(fresh.value,null);
   const staged=await reviewCall('psft_ib_create',{connection:'FIXTURE',input});assert.equal(staged.persisted,false);assert.equal(native.counts().commits,0);
   const apply=async(id:string)=>{const ready=await reviewCall('psft_validate_change_set',{changeSetId:id});assert.equal(ready.status,'READY_FOR_REVIEW',JSON.stringify(ready.objects.map((c:any)=>c.validation)));
     await reviewUi.show(id);const ui=vscode._panels.at(-1);ui._receive({action:'approve',id,revision:ready.revision,destructive:ready.objects.some((c:any)=>c.operation==='DELETE')});await until(async()=>(await reviewService.store.get(id)).status==='APPROVED');
     ui._receive({action:'apply',id,revision:ready.revision});await until(async()=>['APPLIED','CONFLICTED','FAILED'].includes((await reviewService.store.get(id)).status));assert.equal((await reviewService.store.get(id)).status,'APPLIED');};
   await apply(staged.changeSetId);assert.equal((await provider.readIbDefinitionForReview(identity,true)).hash,after.hash);
   const inverse=await reviewCall('psft_prepare_revert',{changeSetId:staged.changeSetId});await apply(inverse.id);assert.equal((await provider.readIbDefinitionForReview(identity,true)).value,null);
   const redo=await reviewCall('psft_prepare_redo',{changeSetId:staged.changeSetId});await apply(redo.id);assert.equal((await provider.readIbDefinitionForReview(identity,true)).hash,after.hash);
   const checkpoint=await reviewCall('psft_ib_definition_get',{connection:'FIXTURE',...identity});
   const deletion=await reviewCall('psft_ib_delete',{connection:'FIXTURE',...identity,expectedToken:checkpoint.token});assert.equal(deletion.persisted,false);
   await apply(deletion.changeSetId);assert.equal((await provider.readIbDefinitionForReview(identity,true)).value,null);
   const restore=await reviewCall('psft_prepare_revert',{changeSetId:deletion.changeSetId});await apply(restore.id);assert.equal((await provider.readIbDefinitionForReview(identity,true)).hash,after.hash);
   check('IB '+kind+' complete lifecycle stages creation/deletion through HTTP, requires destructive UI consent and applies typed inverse/redo with native markers and parent authorization');
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


 // A completed continuation's inverse includes both source revisions and remains a normal trusted UI review.
 for(const name of ['ZZ_CONT_UPDATE_A','ZZ_CONT_UPDATE_B'])sqlDefinitions.set(name,{text:'SELECT 0 FROM DUAL',version:1});
 const continuationWrites=nativeWrites;
 let chain=await reviewCall('psft_create_change_set',{connection:'FIXTURE',title:'Continuation inverse UI'});
 for(const name of ['ZZ_CONT_UPDATE_A','ZZ_CONT_UPDATE_B'])await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name,text:'SELECT 9 FROM DUAL',changeSetId:chain.id});
 chain=await reviewCall('psft_validate_change_set',{changeSetId:chain.id});await reviewUi.show(chain.id);
 pausedUi._receive({action:'approve',id:chain.id,revision:chain.revision});await until(async()=>(await reviewService.store.get(chain.id)).status==='APPROVED');
 pausedUi._receive({action:'applyOne',id:chain.id,revision:chain.revision});await until(async()=>(await reviewService.store.get(chain.id)).status==='PARTIALLY_APPLIED');
 let chainLeaf=await reviewCall('psft_prepare_remaining_work',{changeSetId:chain.id});chainLeaf=await reviewCall('psft_validate_change_set',{changeSetId:chainLeaf.id});await reviewUi.show(chainLeaf.id);
 pausedUi._receive(clickRenderedReview(pausedUi.webview.html,'approveAndApply'));await until(async()=>(await reviewService.store.get(chainLeaf.id)).status==='APPLIED');
 await until(async()=>!require('node:fs').existsSync(require('node:path').join(reviewRoot,'writer.lock')));
 let chainInverse=await reviewCall('psft_prepare_revert',{changeSetId:chainLeaf.id});assert.equal(chainInverse.schema,3);assert.equal(chainInverse.objects.length,2);assert.equal(chainInverse.reversalSources.length,2);
 await reviewCall('psft_validate_change_set',{changeSetId:chainInverse.id});await reviewUi.show(chainInverse.id);
 assert.ok(pausedUi.webview.html.includes('Combined reversal of a completed continuation'));assert.ok(pausedUi.webview.html.includes('all inverse objects must be approved'));
 assert.ok(pausedUi.webview.html.includes(chain.id)&&pausedUi.webview.html.includes(chainLeaf.id));
 pausedUi._receive({action:'approve',id:chainInverse.id,revision:chainInverse.revision});await until(async()=>(await reviewService.store.get(chainInverse.id)).status==='APPROVED');
 await until(async()=>!require('node:fs').existsSync(require('node:path').join(reviewRoot,'writer.lock')));await reviewUi.show(chainInverse.id);
 pausedUi._receive(clickRenderedReview(pausedUi.webview.html,'applyOne'));await until(async()=>(await reviewService.store.get(chainInverse.id)).status==='PARTIALLY_APPLIED');
 await until(async()=>!require('node:fs').existsSync(require('node:path').join(reviewRoot,'writer.lock')));
 assert.equal((await reviewService.store.get(chainLeaf.id)).status,'APPLIED');assert.equal((await reviewService.store.get(chain.id)).status,'PARTIALLY_APPLIED');
 const inverseRoot=chainInverse;chainInverse=await reviewCall('psft_prepare_remaining_work',{changeSetId:inverseRoot.id});
 assert.equal(chainInverse.schema,4);assert.equal(chainInverse.objects.length,1);assert.equal(chainInverse.objects[0].review,'PENDING');assert.equal(chainInverse.continuation.prerequisites.length,1);
 await reviewCall('psft_validate_change_set',{changeSetId:chainInverse.id});await reviewUi.show(chainInverse.id);assert.ok(pausedUi.webview.html.includes('Continue an interrupted reversal'));
 pausedUi._receive(clickRenderedReview(pausedUi.webview.html,'approveAndApply'));await until(async()=>(await reviewService.store.get(chainInverse.id)).status==='APPLIED');
 await until(async()=>(await reviewService.store.get(chain.id)).status==='REVERTED'&&(await reviewService.store.get(chainLeaf.id)).status==='REVERTED'&&!require('node:fs').existsSync(require('node:path').join(reviewRoot,'writer.lock')));
 assert.equal((await reviewService.store.get(chain.id)).status,'REVERTED');assert.equal((await reviewService.store.get(chainLeaf.id)).status,'REVERTED');
 for(const name of ['ZZ_CONT_UPDATE_A','ZZ_CONT_UPDATE_B'])assert.equal(sqlDefinitions.get(name)?.text,'SELECT 0 FROM DUAL');
 check('HTTP paused inverse retains source histories, uses schema-4 remaining work and restores both fixture updates only after fresh rendered approval');
 const chainRedo=await reviewCall('psft_prepare_redo',{changeSetId:chainLeaf.id});await reviewCall('psft_validate_change_set',{changeSetId:chainRedo.id});await reviewUi.show(chainRedo.id);
 pausedUi._receive(clickRenderedReview(pausedUi.webview.html,'approveAndApply'));await until(async()=>(await reviewService.store.get(chainRedo.id)).status==='APPLIED');
 for(const name of ['ZZ_CONT_UPDATE_A','ZZ_CONT_UPDATE_B'])assert.equal(sqlDefinitions.get(name)?.text,'SELECT 9 FROM DUAL');assert.equal(nativeWrites,continuationWrites+6);
 await until(async()=>!require('node:fs').existsSync(require('node:path').join(reviewRoot,'writer.lock')));
 check('HTTP continuation redo is a newly reviewed forward proposal and never inherits an inverse approval');

 // Combined approval/application is a trusted UI action, never a new MCP capability.
 const { reviewStateToken, reviewEligibleIds, approvalHash } = require('./src/changeReview/model.ts');
 assert.ok(!names.some((name:string)=>/approve.*apply|approve_change_set|apply_approved/.test(name)));
 const confirmsBeforeCombined=confirmed;
 const combinedSet=await reviewCall('psft_create_change_set',{title:'Combined SQL review',connection:'FIXTURE',plan:'Review the two SQL definitions together; retain exact object review.'});
 await reviewUi.show(combinedSet.id);const combinedUi=vscode._panels.at(-1);
 assert.ok(!/<button\b[^>]*data-action="approveAndApply"/.test(combinedUi.webview.html));
 combinedUi._receive({action:'approvePlan',id:combinedSet.id,revision:combinedSet.revision});
 await until(async()=>(await reviewService.store.get(combinedSet.id)).plan.review==='APPROVED');
 for(const name of ['ZZ_COMBINED_A','ZZ_COMBINED_B'])await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name,text:'SELECT 7 FROM DUAL',changeSetId:combinedSet.id});
 let combinedReady=await reviewCall('psft_validate_change_set',{changeSetId:combinedSet.id});
 await reviewUi.show(combinedSet.id);
 const combinedHtml=combinedUi.webview.html;
 const combinedButton=/<button\b([^>]*data-action="approveAndApply"[^>]*)>Approve and apply<\/button>/.exec(combinedHtml);
 assert.ok(combinedButton&&!combinedButton[1].includes('disabled'));
 assert.ok(combinedHtml.includes('Approves and applies 2 eligible objects'));
 assert.ok(combinedHtml.includes('Approve only — all eligible'));
 assert.ok(combinedHtml.includes('Exact native before/after snapshots')&&combinedHtml.includes('Semantic/property differences'));
 assert.ok(combinedHtml.includes('ZZ_COMBINED_A')&&combinedHtml.includes('ZZ_COMBINED_B'));
 const combinedMessage=clickRenderedReview(combinedHtml,'approveAndApply');
 assert.equal(combinedMessage.reviewToken,reviewStateToken(combinedReady));assert.deepEqual(combinedMessage.objects,reviewEligibleIds(combinedReady));
 assert.equal(combinedMessage.destructive,false);
 if(process.env.PSFT_REVIEW_PREVIEW)await fs.writeFile('/tmp/psft-review-approve-apply.html',combinedHtml);
 const beforeCombined=nativeWrites;
 // Same revision, changed object review: the old rendered page is still stale.
 combinedReady=await reviewService.review(combinedReady.id,[combinedReady.objects[1].id],'REJECTED',combinedReady.revision);
 combinedUi._receive(combinedMessage);
 await until(async()=>combinedUi.webview.html.includes('Review page is stale'));
 assert.equal(nativeWrites,beforeCombined);
 assert.equal((await reviewService.store.get(combinedReady.id)).objects[1].review,'REJECTED');
 await reviewUi.show(combinedReady.id);
 assert.ok(combinedUi.webview.html.includes('1 rejected or dependency-blocked objects excluded'));
 const exactMessage=clickRenderedReview(combinedUi.webview.html,'approveAndApply');
 assert.equal(exactMessage.reviewToken,reviewStateToken(combinedReady));assert.deepEqual(exactMessage.objects,reviewEligibleIds(combinedReady));
 combinedUi._receive(exactMessage);combinedUi._receive(exactMessage);
 await until(async()=>(await reviewService.store.get(combinedReady.id)).status==='APPLIED');
 await until(async()=>combinedUi.webview.html.includes('data-review-status="APPLIED"'));
 const combinedApplied=await reviewService.store.get(combinedReady.id);
 assert.equal(nativeWrites,beforeCombined+1);
 assert.equal(sqlDefinitions.get('ZZ_COMBINED_A')?.text,'SELECT 7 FROM DUAL');assert.ok(!sqlDefinitions.has('ZZ_COMBINED_B'));
 assert.equal(combinedApplied.objects[1].review,'REJECTED');
 assert.equal(combinedApplied.objects[0].approvedHash,approvalHash(combinedApplied,combinedApplied.objects[0]));
 assert.ok(combinedApplied.journal.some((e:any)=>e.action==='APPROVE_AND_APPLY_REQUESTED'));
 assert.equal(combinedApplied.checkpoint.objects.length,1);assert.equal(confirmed,confirmsBeforeCombined,'combined action must not add modal approval prompts');
 assert.ok(!/<button\b[^>]*data-action="approveAndApply"/.test(combinedUi.webview.html));
 check('primary Approve and apply preserves object review, separate plan approval, same-revision stale checks, rejected exclusions and exactly-once guarded SQL application');

 // Fresh combined clicks repeat all native review gates and retain a conflicted result without writes.
 const blockedSet=await reviewCall('psft_create_change_set',{title:'Combined policy refusal',connection:'FIXTURE'});
 await reviewCall('psft_save_text_definition',{connection:'FIXTURE',type:30,name:'ZZ_COMBINED_BLOCK',text:'SELECT 8 FROM DUAL',changeSetId:blockedSet.id});
 const blockedReady=await reviewCall('psft_validate_change_set',{changeSetId:blockedSet.id});
 await reviewUi.show(blockedReady.id);
 dirty=true;
 combinedUi._receive({action:'approveAndApply',id:blockedReady.id,revision:blockedReady.revision,reviewToken:reviewStateToken(blockedReady),objects:reviewEligibleIds(blockedReady)});
 await until(async()=>(await reviewService.store.get(blockedReady.id)).status==='CONFLICTED');dirty=false;
 assert.equal(nativeWrites,beforeCombined+1);assert.ok(!sqlDefinitions.has('ZZ_COMBINED_BLOCK'));
 assert.ok((await reviewService.store.get(blockedReady.id)).journal.some((e:any)=>e.action==='APPLICATION_STOPPED'));
 check('combined UI application retains dirty-editor refusal, conflict journaling and native writer guards without adding an MCP approval/apply tool');


}finally{reviewUi.dispose();await reviewServer.dispose();await fs.rm(reviewRoot,{recursive:true,force:true,maxRetries:5,retryDelay:100});}

console.log(JSON.stringify({ mode: 'fixture-backed production HTTP MCP; no live database', checks: checks.length }));
