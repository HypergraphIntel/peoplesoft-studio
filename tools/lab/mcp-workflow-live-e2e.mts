/** Live checks through the installed MCP and its saved connection; no credentials read. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const connection = 'HRDMO';
const endpoint = 'http://127.0.0.1:7337/mcp';
const writes = process.argv.includes('--writes');
const checks: string[] = [], created: string[] = [];
const report: Record<string, unknown> = { connection, endpoint, writes, checks, created };
let id = 0;
async function rpc(method: string, params: unknown) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const body = await response.text();
  const value = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data:'))!.slice(5));
  if (value.error) throw new Error(JSON.stringify(value.error));
  return value.result;
}
async function call(name: string, args: object = {}, expectError = false) {
  const result = await rpc('tools/call', { name, arguments: { connection, ...args } });
  if (expectError) { assert.ok(result.isError, `${name} unexpectedly succeeded`); return; }
  if (result.isError) throw new Error(`${name}: ${result.content?.[0]?.text}`);
  return JSON.parse(result.content[0].text);
}
function pass(name: string) { checks.push(name); console.log('PASS ' + name); }
try {
  const listed = (await rpc('tools/list', {})).tools.map((tool: { name: string }) => tool.name);
  for (const name of ['psft_capability_catalog', 'psft_query_get', 'psft_query_run', 'psft_query_save', 'psft_query_create', 'psft_query_copy', 'psft_process_get', 'psft_process_save']) assert.ok(listed.includes(name), `${name} missing; reload the installed extension first`);
  pass('installed MCP advertises new workflows');
  const catalog = await rpc('tools/call', { name: 'psft_capability_catalog', arguments: { kind: 'definition', type: 10 } });
  assert.equal(JSON.parse(catalog.content[0].text).entries.length, 1);
  pass('installed structured capability catalog');
  assert.ok((await call('psft_list_connections')).connections.some((c: any) => c.name === connection && c.connected));
  const processKey = { processType: 'SQR Report', name: 'ABS002' };
  const processOwner = await call('psft_object_classify', { type: 20, parts: ['SQR Report', 'ABS002'] });
  assert.equal(processOwner.stored, true, 'ownership reader must establish stored Process Definition');
  assert.match(processOwner.ownership, /^DELIVERED/);
  pass('live Process Definition ownership is delivered and stored');
  const processBefore = await call('psft_process_get', processKey);
  const input = structuredClone(processBefore.input); input.properties.DESCR = 'MCP preview only';
  const processArgs = { ...processKey, expectedToken: processBefore.token, input };
  assert.equal((await call('psft_process_save', { ...processArgs, dryRun: true })).saved, false);
  assert.equal((await call('psft_process_get', processKey)).token, processBefore.token);
  await call('psft_process_save', { ...processArgs, expectedToken: 'stale', dryRun: true }, true);
  pass('Process Definition real writer preview rolls back and stale token is refused');
  const sourceKey = { name: 'ZZ_QRY_LAB02', owner: '' };
  const sourceOwner = await call('psft_object_classify', { type: 10, parts: [sourceKey.name, ''] });
  assert.equal(sourceOwner.stored, true, 'ownership reader must establish stored public Query');
  pass('live public Query ownership uses its blank-owner key');
  const source = await call('psft_query_get', sourceKey);
  assert.equal(source.execution.supported, true, source.execution.reason);
  await call('psft_query_list', { pattern: 'ZZ_QRY_%' });
  const plan = await call('psft_query_prepare', sourceKey);
  const values: Record<string, string> = {};
  for (const prompt of plan.prompts) {
    assert.equal(Number(prompt.USEEDIT), 0, 'Live fixture prompt must use No Table Edit.');
    values[String(prompt.BNDNUM)] = 'MCP live validation';
  }
  if (plan.prompts.length) await call('psft_query_run', { ...sourceKey, values: {}, maxRows: 1 }, true);
  const result = await call('psft_query_run', { ...sourceKey, values, maxRows: 1 });
  assert.ok(result.rows.length <= 1);
  await call('psft_query_run', { ...sourceKey, maxRows: 10001 }, true);
  await call('psft_query_get', { ...sourceKey, owner: '__OTHER_OPERATOR__' }, true);
  pass('Query list/read/prepare/bounded run and private-owner/input refusals');
  const operations = [{ kind: 'properties', description: 'MCP preview only', comments: '' }];
  await call('psft_query_save', { ...sourceKey, expectedToken: source.token, operations, dryRun: true });
  assert.equal((await call('psft_query_get', sourceKey)).token, source.token);
  await call('psft_query_save', { ...sourceKey, expectedToken: 'stale', operations, dryRun: true }, true);
  pass('Query real writer preview rolls back and stale token is refused');
  if (writes) {
    // Retain two inert custom query fixtures: there is no calibrated MCP delete.
    // Never modify the existing source or any delivered Process Definition.
    const suffix = Date.now().toString(36).toUpperCase();
    const name = `ZZ_QRY_MCP_${suffix}`;
    const copyName = `ZZ_QRY_MCC_${suffix}`;
    const record = String(source.view.records[0].RECNAME).trim();
    const field = String(source.view.fields.find((f: any) => Number(f.COLUMNNUM) > 0).FIELDNAME).trim();
    const create = { name, owner: '', record, operations: [{ kind: 'select', field, selected: true }, { kind: 'properties', description: 'MCP live test fixture', comments: 'Retained for repeatable MCP validation.' }] };
    await call('psft_query_create', { ...create, dryRun: true });
    assert.equal((await call('psft_query_create', create)).saved, true); created.push(name);
    const first = await call('psft_query_get', { name });
    assert.equal(String(first.view.query.DESCR).trim(), 'MCP live test fixture');
    await call('psft_query_create', create, true);
    pass('Query creation commits, readback matches and existing target is refused');
    // Existing-definition save still passes the actual MCP and ownership gates.
    assert.equal((await call('psft_query_save', { name, expectedToken: first.token, operations: [{ kind: 'properties', description: 'MCP save verified', comments: 'Retained for repeatable MCP validation.' }] })).saved, true);
    const edited = await call('psft_query_get', { name });
    assert.equal(String(edited.view.query.DESCR).trim(), 'MCP save verified');
    await call('psft_query_save', { name, expectedToken: first.token, operations: [] }, true);
    pass('Query existing-definition save commits through guards and readback verifies');
    const copy = { name, expectedSourceToken: edited.token, targetName: copyName };
    assert.equal((await call('psft_query_copy', copy)).saved, true); created.push(copyName);
    assert.equal((await call('psft_query_get', { name })).token, edited.token);
    assert.equal(String((await call('psft_query_get', { name: copyName })).view.query.DESCR).trim(), 'MCP save verified');
    await call('psft_query_copy', copy, true);
    pass('Query copy commits, preserves source and refuses an existing target');
    assert.equal((await call('psft_query_get', sourceKey)).token, source.token);
    assert.equal((await call('psft_process_get', processKey)).token, processBefore.token);
    pass('original lab Query and delivered Process Definition remain unchanged');
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1; console.error(report.error);
} finally {
  writeFileSync('tools/lab/results/mcp-workflow-live-e2e.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: checks.length, created }));
}
