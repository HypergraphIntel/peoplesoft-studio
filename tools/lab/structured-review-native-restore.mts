/** Stage exact original lab baselines through typed adapters; never approve/apply. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { canonical, type ChangeSet } from '../../src/changeReview/model.js';
const headers = process.argv.includes('--headers');
const reportPath = headers ? 'tools/lab/results/header-pause-native-validation.json' : 'tools/lab/results/structured-review-native-validation.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.ok(report.remaining?.changeSetId, 'Read-only continuation acceptance must pass before restoration is prepared.');
let request = 0;
async function tool(name: string, args: object) {
    assert.ok(['psft_get_change_set', 'psft_get_object_diff', 'psft_get_object_timeline', 'psft_create_change_set',
        'psft_stage_object_change', 'psft_validate_change_set', 'psft_request_change_review'].includes(name), 'No approve/apply tools.');
    const response = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++request, method: 'tools/call', params: { name, arguments: args } }) });
    assert.ok(response.ok, `MCP HTTP ${response.status}`);
    const body = await response.text(), rpc = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(s => s.startsWith('data:'))!.slice(5));
    assert.ok(!rpc.error, JSON.stringify(rpc.error)); assert.ok(!rpc.result.isError, rpc.result.content?.[0]?.text);
    return JSON.parse(rpc.result.content.find((c: { type: string }) => c.type === 'text').text);
}
const original: ChangeSet = await tool('psft_get_change_set', { changeSetId: report.changeSetId });
const remaining: ChangeSet = await tool('psft_get_change_set', { changeSetId: report.remaining.changeSetId });
assert.equal(original.environment.connection, 'oracle:HRDMO'); assert.equal(original.status, 'PARTIALLY_APPLIED');
assert.equal(remaining.status, 'APPLIED'); assert.equal(remaining.continuation?.changeSetId, original.id);
assert.deepEqual(remaining.environment, original.environment);
assert.deepEqual(original.objects.map(c => [c.adapter, c.key]), headers ? [['record', 'ZZ_RPT_LINE'], ['ae', 'ZZ_AE_LAB01']] : [['page', 'ZZ_PCODE_LAB_PG'], ['record', 'ZZ_RPT_LINE'], ['ae', 'ZZ_AE_LAB01']]);
const desired = [];
for (const source of original.objects) {
    const currentSet = source.application === 'VERIFIED' ? original : remaining;
    const current = currentSet.objects.find(c => c.adapter === source.adapter && canonical(c.key) === canonical(source.key));
    assert.ok(current && current.application === 'VERIFIED');
    const timeline = await tool('psft_get_object_timeline', { changeSetId: currentSet.id, objectId: current.id, checkLive: true });
    assert.equal(timeline.live.status, 'MATCHES_RECORDED');
    const live = timeline.revisions.find((r: { id: string }) => r.id === timeline.live.matched);
    assert.ok(live); assert.equal(live.snapshot, current.verified); assert.equal(live.token, current.verifiedToken);
    const diff = await tool('psft_get_object_diff', { changeSetId: original.id, objectId: source.id });
    desired.push({ source, after: diff.before });
}
let set: ChangeSet = await tool('psft_create_change_set', { connection: original.environment.connection,
    title: headers ? 'Restore native header pause — original lab baselines' : 'Restore native structured review — original lab baselines', requestKey: 'structured-lab-baseline-restoration:' + original.id });
assert.ok(['DRAFT', 'READY_FOR_REVIEW', 'CONFLICTED'].includes(set.status), 'Do not replay an applied/interrupted restoration.');
for (const { source, after } of desired) {
    const existing = set.objects.find(c => c.adapter === source.adapter && canonical(c.key) === canonical(source.key));
    set = await tool('psft_stage_object_change', { changeSetId: set.id, adapter: source.adapter, key: source.key, after,
        ...(existing ? { objectId: existing.id } : {}) });
    const object = set.objects.find(c => c.adapter === source.adapter && canonical(c.key) === canonical(source.key));
    assert.equal(object?.after, source.before, 'Typed projection must restore the whole retained baseline scope.');
}
set = await tool('psft_validate_change_set', { changeSetId: set.id });
assert.equal(set.status, 'READY_FOR_REVIEW', JSON.stringify(set.objects.map(c => c.validation)));
await tool('psft_request_change_review', { changeSetId: set.id });
report.restorationProposal = { changeSetId: set.id, revision: set.revision, status: set.status,
    mode: 'Fresh typed baseline restoration staged/validated only; separate developer approval/application required.' };
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.restorationProposal, null, 2));
