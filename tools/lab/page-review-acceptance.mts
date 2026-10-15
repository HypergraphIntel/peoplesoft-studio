/** Read-only acceptance after a developer applies the bounded HRDMO lab Page proposal or its inverse. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { approvalHash, hash, type ChangeSet } from '../../src/changeReview/model.js';
import { nativePageSnapshot } from '../../src/providers/pageSnapshot.js';

const changeSetId = process.argv[2];
const controls = process.argv.includes('--controls');
assert.match(changeSetId ?? '', /^[0-9a-f-]{36}$/i, 'Pass the developer-applied lab Page Change Set ID.');
const reportPath = controls ? 'tools/lab/results/page-control-review-native-validation.json' : 'tools/lab/results/page-review-native-validation.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
let requestId = 0;
async function read(name: string, args: object) {
    assert.ok(['psft_get_change_set', 'psft_get_object_diff', 'psft_get_object_timeline', 'psft_get_page_layout'].includes(name), 'Acceptance may only read.');
    const response = await fetch('http://127.0.0.1:7337/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } }),
        signal: AbortSignal.timeout(30000)
    });
    assert.ok(response.ok, `MCP HTTP ${response.status}`);
    const body = await response.text();
    const rpc = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data:'))!.slice(5));
    assert.ok(!rpc.error, JSON.stringify(rpc.error));
    assert.ok(!rpc.result.isError, rpc.result.content?.[0]?.text);
    return JSON.parse(rpc.result.content.find((c: { type: string }) => c.type === 'text').text);
}
function verifySet(set: ChangeSet) {
    assert.equal(set.environment.connection, 'oracle:HRDMO');
    assert.equal(set.objects.length, 1);
    const c = set.objects[0];
    assert.equal(c.adapter, 'page');
    assert.equal(c.key, 'ZZ_PCODE_LAB_PG');
    assert.equal(c.application, 'VERIFIED');
    assert.equal(c.review, 'APPROVED');
    assert.equal(c.approvedHash, approvalHash(set, c));
    assert.equal(c.verified, c.after);
    const checkpoint = set.checkpoint?.objects.find(o => o.id === c.id);
    assert.equal(checkpoint?.snapshot, c.before);
    assert.equal(checkpoint?.token, c.baselineToken);
    return c;
}
const set: ChangeSet = await read('psft_get_change_set', { changeSetId });
assert.equal(set.status, 'APPLIED');
const c = verifySet(set);
const diff = await read('psft_get_object_diff', { changeSetId, objectId: c.id });
assert.equal(hash(nativePageSnapshot(diff.before)), c.before);
assert.equal(hash(nativePageSnapshot(diff.after)), c.after);
if (controls) {
    assert.equal(diff.differences.length, 8);
    assert.deepEqual(diff.differences.map((d: { path: string }) => d.path).sort(),
        ['FIELDLEFT', 'FIELDTOP', 'FIELDRIGHT', 'FIELDBOTTOM', 'FIELDSIZETYPE', 'LBLTEXT', 'FIELDUSE', 'SECUREINVISIBLE'].map(k => '$.tables.PSPNLFIELD[21].' + k).sort());
} else {
    assert.equal(diff.differences.length, 1);
    assert.equal(diff.differences[0].path, '$.tables.PSPNLDEFN.DESCR');
}
const historyLinks = [], seen = new Set([set.id]);
let child = set;
let primary = set.id === report.changeSetId ? set : undefined;
while (child.reverses) {
    assert.ok(!seen.has(child.reverses), 'Reversal cycle.');
    seen.add(child.reverses);
    const parent: ChangeSet = await read('psft_get_change_set', { changeSetId: child.reverses });
    assert.equal(parent.status, 'REVERTED');
    assert.equal(parent.environment.identity, set.environment.identity);
    const p = verifySet(parent);
    if (parent.id === report.changeSetId) primary = parent;
    assert.equal(child.objects[0].before, p.after);
    assert.equal(child.objects[0].after, p.before);
    assert.notEqual(child.objects[0].approvedHash, p.approvedHash);
    assert.ok(parent.journal.some(e => e.action === 'REVERSED_BY_VERIFIED_CHANGE_SET' && e.detail === child.id));
    historyLinks.push({ changeSetId: parent.id, status: parent.status, reversedBy: child.id });
    child = parent;
}
const timeline = await read('psft_get_object_timeline', { changeSetId, objectId: c.id, checkLive: true });
assert.equal(timeline.live.status, 'MATCHES_RECORDED');
assert.equal(timeline.live.matched, set.id + ':' + c.id);
const revision = timeline.revisions.find((r: { id: string }) => r.id === timeline.live.matched);
assert.equal(revision.snapshot, c.after);
assert.equal(revision.token, c.verifiedToken);
assert.equal(revision.continuity, 'MATCHES_PREVIOUS');
const layout = await read('psft_get_page_layout', { connection: set.environment.connection, page: c.key });
assert.equal(layout.properties.description, diff.after.tables.PSPNLDEFN[0].DESCR);
const control = controls ? layout.controls.find((c: { id: number }) => c.id === 21) : undefined;
if (controls) {
    const native = diff.after.tables.PSPNLFIELD.find((r: { PNLFLDID: number }) => r.PNLFLDID === 21);
    assert.deepEqual([control.left, control.top, control.right, control.bottom, control.label, control.displayOnly, control.invisible],
        [native.FIELDLEFT, native.FIELDTOP, native.FIELDRIGHT, native.FIELDBOTTOM, native.LBLTEXT.trim(), !!(native.FIELDUSE & 1), !!(native.FIELDUSE & 2)]);
}
const evidence = { checkedAt: new Date().toISOString(), changeSetId, objectId: c.id, status: set.status,
    origin: set.origin, ...(set.reverses ? { reverses: set.reverses } : {}), version: layout.version,
    description: layout.properties.description, controlCount: layout.controls.length,
    beforeHash: c.before, afterHash: c.after, nativeToken: c.verifiedToken, approvedRevisionHash: c.approvedHash,
    checkpoint: set.checkpoint, semanticChanges: diff.differences, historyLinks, ...(controls ? { control } : {}),
    timeline: { live: timeline.live, verifiedRevisions: timeline.revisions.length }, journal: set.journal };
report.nativeApplications = [...(report.nativeApplications ?? []).filter((e: { changeSetId: string }) => e.changeSetId !== set.id), evidence];
report.mode = 'installed native MCP; developer-reviewed bounded lab Page applications independently read back';
report.notVerified = ['native visual reopen', 'global native counter readback',
    ...(!controls ? ['native Page geometry/label/use apply'] : ['other control types and structural edits']), 'native Page redo',
    ...(!set.reverses ? ['developer-reviewed Page checkpoint inverse'] : [])];
report.current = { checkedAt: evidence.checkedAt, changeSetId: set.id, status: set.status,
    version: layout.version, description: layout.properties.description, snapshotHash: c.after, token: c.verifiedToken };
if (primary) {
    report.status = primary.status; report.review = primary.objects[0].review; report.application = primary.objects[0].application;
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
