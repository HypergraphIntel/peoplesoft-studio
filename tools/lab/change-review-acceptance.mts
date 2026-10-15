/** Read-only native acceptance checks after a developer applies a reviewed lab Query. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { approvalHash, hash, type ChangeSet } from '../../src/changeReview/model.js';
import { querySnapshot } from '../../src/changeReview/query.js';
import type { QueryView } from '../../src/model/queryDefinition.js';

const changeSetId = process.argv[2];
assert.match(changeSetId ?? '', /^[0-9a-f-]{36}$/i, 'Pass the developer-applied lab Change Set ID.');
const reportPath = 'tools/lab/results/change-review-native-validation.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
let requestId = 0;
async function rpc(method: string, params: object) {
    const response = await fetch('http://127.0.0.1:7337/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }), signal: AbortSignal.timeout(30000)
    });
    assert.ok(response.ok, `MCP HTTP ${response.status}`);
    const body = await response.text();
    const value = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data:'))!.slice(5));
    assert.ok(!value.error, JSON.stringify(value.error));
    return value.result;
}
async function read(name: string, args: object) {
    assert.ok(['psft_get_change_set', 'psft_query_get', 'psft_get_object_diff', 'psft_get_object_timeline'].includes(name), 'Acceptance harness may only read.');
    const result = await rpc('tools/call', { name, arguments: args });
    assert.ok(!result.isError, result.content?.[0]?.text);
    return JSON.parse(result.content.find((c: { type: string }) => c.type === 'text').text);
}

const set: ChangeSet = await read('psft_get_change_set', { changeSetId });
assert.equal(set.status, 'APPLIED');
assert.equal(set.environment.connection, 'oracle:HRDMO');
assert.equal(set.objects.length, 1, 'This harness certifies only the single lab Query flow.');
const c = set.objects[0];
assert.equal(c.adapter, 'query');
assert.deepEqual(c.key, [report.query, '']);
assert.equal(c.review, 'APPROVED');
assert.equal(c.application, 'VERIFIED');
assert.equal(c.approvedHash, approvalHash(set, c));
const checkpoint = set.checkpoint?.objects.find(o => o.id === c.id);
assert.equal(checkpoint?.snapshot, c.before);
assert.equal(checkpoint?.token, c.baselineToken);
const live: { view: QueryView; token: string } = await read('psft_query_get', { connection: set.environment.connection, name: report.query });
const snapshotHash = hash(querySnapshot(live.view));
assert.equal(snapshotHash, c.after, 'Native semantic snapshot must equal the approved after-state.');
assert.equal(snapshotHash, c.verified);
assert.equal(live.token, c.verifiedToken, 'The current native revision must equal verified readback.');
const diff = await read('psft_get_object_diff', { changeSetId, objectId: c.id });
assert.equal(diff.differences.length, 1);
assert.equal(diff.differences[0].path, '$.query.DESCR');
const historyLinks: { changeSetId: string; status: string; reversedBy: string }[] = [];
const seen = new Set([set.id]);
let child = set;
while (child.reverses) {
    assert.ok(!seen.has(child.reverses), 'Reversal history must not contain a cycle.');
    seen.add(child.reverses);
    const parent: ChangeSet = await read('psft_get_change_set', { changeSetId: child.reverses });
    assert.equal(parent.status, 'REVERTED');
    assert.equal(parent.environment.connection, set.environment.connection);
    assert.equal(parent.environment.identity, set.environment.identity);
    assert.equal(parent.objects.length, 1);
    assert.equal(parent.objects[0].adapter, c.adapter);
    assert.deepEqual(parent.objects[0].key, c.key);
    assert.equal(child.objects[0].after, parent.objects[0].before);
    assert.equal(child.objects[0].before, parent.objects[0].after);
    assert.notEqual(child.objects[0].approvedHash, parent.objects[0].approvedHash, 'A reversal/redo must not reuse approval.');
    assert.ok(parent.journal.some(e => e.action === 'REVERSED_BY_VERIFIED_CHANGE_SET' && e.detail === child.id));
    historyLinks.push({ changeSetId: parent.id, status: parent.status, reversedBy: child.id });
    child = parent;
}
const tools = (await rpc('tools/list', {})).tools;
let timeline;
if (tools.some((tool: { name: string }) => tool.name === 'psft_get_object_timeline')) {
    timeline = await read('psft_get_object_timeline', { changeSetId, objectId: c.id, checkLive: true });
    assert.equal(timeline.live.status, 'MATCHES_RECORDED');
    assert.equal(timeline.live.matched, set.id + ':' + c.id);
}
const evidence = {
    checkedAt: new Date().toISOString(), changeSetId, status: set.status, origin: set.origin,
    ...(set.reverses ? { reverses: set.reverses } : {}), description: String(live.view.query.DESCR),
    version: live.view.query.VERSION, nativeToken: live.token, snapshotHash, checkpoint,
    approvedRevisionHash: c.approvedHash, semanticChanges: diff.differences,
    journal: set.journal, historyLinks, timeline: timeline ? { live: timeline.live, verifiedRevisions: timeline.revisions.length } : { available: false }
};
report.nativeApplications = [...(report.nativeApplications ?? []).filter((e: { changeSetId: string }) => e.changeSetId !== changeSetId), evidence];
report.mode = 'installed native MCP; developer-approved lab Query apply/readback verified';
if (changeSetId === report.changeSetId) {
    report.status = set.status;
    report.notVerified = report.notVerified.filter((item: string) => item !== 'native developer approve/apply/readback');
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
