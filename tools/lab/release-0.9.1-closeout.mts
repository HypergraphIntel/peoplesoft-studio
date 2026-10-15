/** Native reads plus local evidence only. No staging, approval, application or history rewriting. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { completedFollowUp, reviewList } from '../../src/changeReview/navigation.js';
import type { ChangeSet } from '../../src/changeReview/model.js';
const evidence = (name: string) => JSON.parse(readFileSync('tools/lab/results/' + name, 'utf8'));
const structured = evidence('structured-review-native-validation.json'), headers = evidence('header-pause-native-validation.json');
assert.equal(structured.reverted?.status, 'APPLIED'); assert.equal(headers.restored?.status, 'APPLIED');
let request = 0;
async function read(name: string, args: object = {}) {
    assert.ok(['psft_list_change_sets', 'psft_get_change_set', 'psft_get_object_timeline', 'psft_get_page_layout'].includes(name));
    const response = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++request, method: 'tools/call', params: { name, arguments: args } }) });
    assert.ok(response.ok);
    const body = await response.text(), rpc = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(l => l.startsWith('data:'))!.slice(5));
    assert.ok(!rpc.error, JSON.stringify(rpc.error)); assert.ok(!rpc.result.isError, rpc.result.content?.[0]?.text);
    return JSON.parse(rpc.result.content.find((c: { type: string }) => c.type === 'text').text);
}
const inventory = await read('psft_list_change_sets'), sets: ChangeSet[] = inventory.changeSets;
assert.equal(inventory.adapters.length, 9);
const pending = reviewList(sets, 'pending');
assert.equal(pending.length, 0, JSON.stringify(pending.map(s => ({ id: s.id, status: s.status, title: s.title }))));
const uncertain = sets.flatMap(s => s.objects.filter(c => ['UNCERTAIN', 'APPLYING'].includes(c.application)).map(c => ({ set: s.id, object: c.id })));
assert.equal(uncertain.length, 0, JSON.stringify(uncertain));
const partial = sets.find(s => s.id === headers.changeSetId);
assert.ok(partial); assert.equal(partial.status, 'PARTIALLY_APPLIED');
const followUp = completedFollowUp(partial, sets);
assert.equal(followUp?.id, headers.remaining.changeSetId, 'Operational completion must be proven while preserving the original partial record.');

const liveObjects = [];
for (const [id, families] of [[structured.reverted.changeSetId, ['page']], [headers.restored.changeSetId, ['record', 'ae']]] as const) {
    const set: ChangeSet = await read('psft_get_change_set', { changeSetId: id });
    assert.equal(set.status, 'APPLIED');
    for (const c of set.objects.filter(c => (families as readonly string[]).includes(c.adapter))) {
        const original = structured.objects.find((o: { adapter: string }) => o.adapter === c.adapter);
        assert.ok(original); assert.equal(c.verified, original.before);
        const timeline = await read('psft_get_object_timeline', { changeSetId: set.id, objectId: c.id, checkLive: true });
        assert.equal(timeline.live.status, 'MATCHES_RECORDED');
        const matched = timeline.revisions.find((r: { id: string }) => r.id === timeline.live.matched);
        assert.ok(matched); assert.equal(matched.snapshot, original.before); assert.equal(matched.token, c.verifiedToken);
        liveObjects.push({ adapter: c.adapter, key: c.key, snapshot: matched.snapshot, token: matched.token, checkedAt: timeline.live.checkedAt });
    }
}
assert.equal(liveObjects.length, 3);
const page = await read('psft_get_page_layout', { connection: 'HRDMO', page: 'ZZ_PCODE_LAB_PG' });
assert.equal(page.version, structured.reverted.nativePageVersion, 'Header continuation/restoration must not write the Page.');
const record = evidence('release-0.9.1-readiness.json');
record.nativeCloseout = { checkedAt: new Date().toISOString(), status: 'PASS', mode: 'Native read-only verification; local queue classification uses current candidate source',
    labObjectsRestored: liveObjects, pageVersion: page.version, operationalPendingChangeSets: 0, uncertainObjects: 0,
    retainedPartialHistory: { changeSetId: partial.id, status: partial.status, completedBy: followUp!.id, historyRewritten: false } };
record.nativeControlledPause = headers.paused; record.nativeReviewedContinuation = headers.remaining;
record.nativeFinalHeaderRestoration = headers.restored;
record.outstanding = record.developerUiAcceptance?.status === 'PASS' ? [] : [record.finalCandidateReloadVerified
    ? 'Inspect actual menu placement and completed-history navigation'
    : 'Reload final UI fixes and inspect actual menu placement and completed-history navigation'];
writeFileSync('tools/lab/results/release-0.9.1-readiness.json', JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record.nativeCloseout, null, 2));
