/** Read-only installed IB review acceptance. No staging, approval or writer endpoints. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { approvalHash, canonical, hash, type ChangeSet } from '../../src/changeReview/model.js';
import { ibSnapshot, type IbReviewKind } from '../../src/providers/ibSnapshot.js';
const [phase, id, originalId] = process.argv.slice(2);
assert.ok(['staged', 'applied', 'reverted'].includes(phase), 'Pass staged | applied | reverted <set ID> [original ID].');
assert.match(id ?? '', /^[0-9a-f-]{36}$/i);
if (phase === 'reverted') assert.match(originalId ?? '', /^[0-9a-f-]{36}$/i);
let sequence = 0;
async function read(name: string, args: object) {
    assert.ok(['psft_get_change_set', 'psft_get_object_diff', 'psft_get_object_timeline', 'psft_ib_get'].includes(name));
    const r = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name, arguments: args } }) });
    const text = await r.text(), body = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data:'))!.slice(5));
    assert.ok(!body.error, JSON.stringify(body.error)); assert.ok(!body.result.isError, body.result.content?.[0]?.text);
    return JSON.parse(body.result.content[0].text);
}
const set: ChangeSet = await read('psft_get_change_set', { changeSetId: id });
assert.equal(set.environment.label, 'HRDMO'); assert.equal(set.environment.connection, 'oracle:HRDMO');
assert.equal(set.objects.length, 2);
assert.deepEqual(set.objects.map(c => [c.adapter, c.key]).sort(), [['ib-operation', 'ZZ_IB_STDOP'], ['ib-service', 'ZZ_IB_STD']]);
assert.equal(set.status, phase === 'staged' ? 'READY_FOR_REVIEW' : 'APPLIED');
const original: ChangeSet | undefined = phase === 'reverted' ? await read('psft_get_change_set', { changeSetId: originalId }) : undefined;
if (original) {
    assert.equal(original.status, 'REVERTED'); assert.equal(set.reverses, original.id);
    assert.deepEqual(set.environment, original.environment);
    assert.ok(original.journal.some(e => e.action === 'REVERSED_BY_VERIFIED_CHANGE_SET' && e.detail === set.id));
}
const checks = [];
for (const c of set.objects) {
    const kind = c.adapter.slice(3) as IbReviewKind;
    const d = await read('psft_get_object_diff', { changeSetId: id, objectId: c.id });
    assert.equal(hash(ibSnapshot(d.before, kind)), c.before); assert.equal(hash(ibSnapshot(d.after, kind)), c.after);
    const expectedPaths = ['$.tables.' + (kind === 'service' ? 'PSSERVICE' : 'PSOPERATION') + '.DESCR', '$.tables.' + (kind === 'service' ? 'PSSERVICE' : 'PSOPERATION') + '.DESCRLONG'];
    assert.deepEqual(d.differences.map((x: { path: string }) => x.path).sort(), expectedPaths.sort());
    if (phase === 'staged') { assert.equal(c.review, 'PENDING'); assert.equal(c.application, 'PENDING'); assert.ok(!set.journal.some(e => e.action === 'WRITE_STARTED')); }
    else {
        assert.equal(c.review, 'APPROVED'); assert.equal(c.approvedHash, approvalHash(set, c)); assert.equal(c.application, 'VERIFIED'); assert.equal(c.verified, c.after);
        const checkpoint = set.checkpoint?.objects.find(o => o.id === c.id);
        assert.equal(checkpoint?.snapshot, c.before); assert.equal(checkpoint?.token, c.baselineToken);
        assert.ok(c.verifiedToken); assert.notEqual(c.verifiedToken, c.baselineToken);
    }
    if (original) {
        const source = original.objects.find(o => o.adapter === c.adapter && canonical(o.key) === canonical(c.key))!;
        assert.ok(source); assert.equal(c.after, source.before); assert.equal(c.before, source.after); assert.notEqual(c.approvedHash, source.approvedHash);
        const dependencies = original.objects.filter(o => o.dependencies.includes(source.id)).map(o => set.objects.find(i => i.adapter === o.adapter && canonical(i.key) === canonical(o.key))!.id);
        assert.deepEqual([...c.dependencies].sort(), dependencies.sort());
    }
    const timeline = await read('psft_get_object_timeline', { changeSetId: id, objectId: c.id, checkLive: true });
    assert.equal(timeline.live.status, 'MATCHES_RECORDED');
    const matched = timeline.live.matched === 'baseline' ? timeline.baseline : timeline.revisions.find((r: { id: string }) => r.id === timeline.live.matched);
    assert.ok(matched); assert.equal(matched.snapshot, phase === 'staged' ? c.before : c.after); assert.equal(matched.token, phase === 'staged' ? c.baselineToken : c.verifiedToken);
    const doc = await read('psft_ib_get', { connection: 'HRDMO', kind, key: [c.key] });
    const image = phase === 'staged' ? d.before : d.after, table = kind === 'service' ? 'PSSERVICE' : 'PSOPERATION';
    assert.equal(doc.properties.DESCR, image.tables[table][0].DESCR); assert.equal(doc.properties.DESCRLONG, image.tables[table][0].DESCRLONG);
    assert.equal(doc.validation.filter((x: { severity: string }) => x.severity === 'error').length, 0);
    checks.push({ adapter: c.adapter, key: c.key, snapshot: matched.snapshot, token: matched.token, checkedAt: timeline.live.checkedAt });
}
const service = set.objects.find(c => c.adapter === 'ib-service')!, operation = set.objects.find(c => c.adapter === 'ib-operation')!;
assert.deepEqual((original ? service : operation).dependencies, [(original ? operation : service).id]);
const report = { phase, changeSetId: id, revision: set.revision, status: set.status, objects: checks, mode: 'Read-only installed MCP checkpoint, live snapshot/token, header, validation and dependency checks' };
writeFileSync('/tmp/psft-ib-native-acceptance-' + phase + '.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
