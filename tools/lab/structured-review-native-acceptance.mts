/** Read-only acceptance; never grants approval or calls a native writer. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { approvalHash, canonical, hash, type Change, type ChangeSet } from '../../src/changeReview/model.js';
import { nativePageSnapshot } from '../../src/providers/pageSnapshot.js';
import { structuredSnapshot } from '../../src/providers/structuredSnapshot.js';

const headers = process.argv.includes('--headers');
const args = process.argv.slice(2).filter(a => a !== '--headers');
const [phase, supplied] = args;
assert.ok(['applied', 'reverted', 'paused', 'remaining', 'restored'].includes(phase), 'Pass applied | reverted <id> | paused | remaining <id> | restored <id>.');
if (!['paused', 'applied'].includes(phase)) assert.match(supplied ?? '', /^[0-9a-f-]{36}$/i, 'Pass the developer-applied Change Set ID.');
const reportPath = headers ? 'tools/lab/results/header-pause-native-validation.json' : 'tools/lab/results/structured-review-native-validation.json';
const expectedObjects = headers ? [['record', 'ZZ_RPT_LINE'], ['ae', 'ZZ_AE_LAB01']] : [['page', 'ZZ_PCODE_LAB_PG'], ['record', 'ZZ_RPT_LINE'], ['ae', 'ZZ_AE_LAB01']];
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
let request = 0;
async function read(name: string, args: object) {
    assert.ok(['psft_get_change_set', 'psft_get_object_diff', 'psft_get_object_timeline', 'psft_get_page_layout'].includes(name), 'Read-only acceptance allowlist.');
    const response = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++request, method: 'tools/call', params: { name, arguments: args } }) });
    assert.ok(response.ok, `MCP HTTP ${response.status}`);
    const body = await response.text(), rpc = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(s => s.startsWith('data:'))!.slice(5));
    assert.ok(!rpc.error, JSON.stringify(rpc.error)); assert.ok(!rpc.result.isError, rpc.result.content?.[0]?.text);
    return JSON.parse(rpc.result.content.find((c: { type: string }) => c.type === 'text').text);
}
const original: ChangeSet = await read('psft_get_change_set', { changeSetId: report.changeSetId });
assert.equal(original.environment.connection, 'oracle:HRDMO');
if (phase === 'applied' || phase === 'reverted') {
    assert.equal(original.status, phase === 'applied' ? 'APPLIED' : 'REVERTED');
    assert.deepEqual(original.objects.map(c => [c.adapter, c.key]), expectedObjects);
    assert.deepEqual(original.journal.filter(e => e.action === 'WRITE_STARTED').map(e => e.object), original.objects.map(c => c.id));
    for (const c of original.objects) {
        approved(original, c, true);
        const staged = report.objects.find((o: { id: string }) => o.id === c.id);
        assert.ok(staged); assert.equal(c.before, staged.before); assert.equal(c.after, staged.after);
        const d = await diff(original, c); assert.equal(canonical(d.differences), canonical(staged.differences));
    }
    let set = original;
    if (phase === 'reverted') {
        set = await read('psft_get_change_set', { changeSetId: supplied });
        assert.equal(set.status, 'APPLIED'); assert.equal(set.reverses, original.id);
        assert.deepEqual(set.environment, original.environment); assert.equal(set.objects.length, original.objects.length);
        assert.ok(original.journal.some(e => e.action === 'REVERSED_BY_VERIFIED_CHANGE_SET' && e.detail === set.id));
        for (const c of set.objects) {
            const source = original.objects.find(o => o.adapter === c.adapter && canonical(o.key) === canonical(c.key));
            assert.ok(source); approved(set, c, true);
            assert.equal(c.before, source.after); assert.equal(c.after, source.before);
            assert.notEqual(c.approvedHash, source.approvedHash); assert.notEqual(c.verifiedToken, source.baselineToken);
            const expectedDependencies = original.objects.filter(o => o.dependencies.includes(source.id)).map(o => {
                const inverse = set.objects.find(i => i.adapter === o.adapter && canonical(i.key) === canonical(o.key));
                assert.ok(inverse); return inverse.id;
            });
            assert.deepEqual([...c.dependencies].sort(), expectedDependencies.sort());
            await diff(set, c);
        }
    }
    const checks = [];
    for (const c of set.objects) checks.push(await live(set, c, c.verified!, c.verifiedToken!));
    const pageVersion = await checkPage(phase === 'reverted');
    report[phase] = { changeSetId: set.id, status: set.status, checkedAt: new Date().toISOString(), objects: checks,
        nativePageVersion: pageVersion, mode: 'Read-only full application/checkpoint inverse acceptance; controlled pause not exercised.' };
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report[phase], null, 2));
    process.exit(0);
}
assert.equal(original.status, 'PARTIALLY_APPLIED');
assert.equal(original.objects.length, expectedObjects.length);
assert.deepEqual(original.objects.map(c => [c.adapter, c.key]), expectedObjects);
assert.ok(original.journal.some(e => e.action === 'PAUSED_BETWEEN_WRITERS'));
assert.deepEqual(original.journal.filter(e => e.action === 'WRITE_STARTED').map(e => e.object), [original.objects[0].id]);
assert.deepEqual(original.objects.map(c => c.application), original.objects.map((_, i) => i === 0 ? 'VERIFIED' : 'PENDING'));
for (let i = 1; i < original.objects.length; i++) assert.deepEqual(original.objects[i].dependencies, [original.objects[i - 1].id]);

function approved(set: ChangeSet, c: Change, verified: boolean) {
    assert.equal(c.review, 'APPROVED'); assert.equal(c.approvedHash, approvalHash(set, c));
    const cp = set.checkpoint?.objects.find(o => o.id === c.id);
    assert.equal(cp?.snapshot, c.before); assert.equal(cp?.token, c.baselineToken);
    assert.equal(c.application, verified ? 'VERIFIED' : 'PENDING');
    if (verified) { assert.equal(c.verified, c.after); assert.ok(c.verifiedToken); }
}
async function diff(set: ChangeSet, c: Change) {
    const d = await read('psft_get_object_diff', { changeSetId: set.id, objectId: c.id });
    const normalize = c.adapter === 'page' ? nativePageSnapshot : (v: unknown) => structuredSnapshot(v, c.adapter as 'record' | 'ae');
    assert.equal(hash(normalize(d.before)), c.before); assert.equal(hash(normalize(d.after)), c.after);
    return d;
}
async function live(set: ChangeSet, c: Change, snapshot: string, token: string) {
    const timeline = await read('psft_get_object_timeline', { changeSetId: set.id, objectId: c.id, checkLive: true });
    assert.equal(timeline.live.status, 'MATCHES_RECORDED');
    const revision = timeline.live.matched === 'baseline' ? timeline.baseline : timeline.revisions.find((r: { id: string }) => r.id === timeline.live.matched);
    assert.ok(revision); assert.equal(revision.snapshot, snapshot); assert.equal(revision.token, token);
    return { adapter: c.adapter, key: c.key, snapshot, token, checkedAt: timeline.live.checkedAt };
}
const checks = [];
for (const [i, c] of original.objects.entries()) {
    approved(original, c, i === 0);
    const initial = report.objects.find((o: { id: string }) => o.id === c.id);
    assert.ok(initial); assert.equal(c.before, initial.before); assert.equal(c.after, initial.after);
    const d = await diff(original, c);
    if (c.adapter === 'page') {
        const paths = d.differences.map((v: { path: string }) => v.path).sort();
        assert.deepEqual(paths, [
            ...['FIELDLEFT', 'FIELDTOP', 'FIELDRIGHT', 'FIELDBOTTOM', 'FIELDSIZETYPE', 'LBLTEXT'].map(k => '$.tables.PSPNLFIELD[21].' + k),
            ...['FIELDUSE', 'SECUREINVISIBLE'].map(k => '$.tables.PSPNLFIELD[2].' + k)
        ].sort(), 'Geometry/label on Static Text, use flags only on Edit Box.');
    } else assert.deepEqual(d.differences.map((v: { path: string }) => v.path), [c.adapter === 'record' ? '$.tables.PSRECDEFN.RECDESCR' : '$.tables.PSAEAPPLDEFN.DESCR']);
}
let selected = original;
if (phase === 'paused') {
    for (const [i, c] of original.objects.entries()) checks.push(await live(original, c, i === 0 ? c.verified! : c.before, i === 0 ? c.verifiedToken! : c.baselineToken));
} else {
    const remainingId = phase === 'remaining' ? supplied : report.remaining?.changeSetId;
    assert.ok(remainingId, 'Verify the applied continuation before restoration.');
    const remaining: ChangeSet = await read('psft_get_change_set', { changeSetId: remainingId });
    assert.equal(remaining.status, 'APPLIED'); assert.equal(remaining.schema, 2);
    assert.deepEqual(remaining.environment, original.environment);
    assert.equal(remaining.continuation?.changeSetId, original.id);
    assert.equal(remaining.continuation?.sourceRevision, original.revision);
    assert.equal(remaining.objects.length, original.objects.length - 1);
    const prerequisite = original.objects[0];
    assert.deepEqual(remaining.continuation?.prerequisites, [{ changeSetId: original.id, objectId: prerequisite.id, adapter: prerequisite.adapter, key: prerequisite.key, snapshot: prerequisite.verified, token: prerequisite.verifiedToken }]);
    for (const [i, c] of remaining.objects.entries()) {
        const source = original.objects[i + 1]; approved(remaining, c, true);
        assert.equal(c.adapter, source.adapter); assert.equal(canonical(c.key), canonical(source.key));
        assert.notEqual(c.id, source.id); assert.notEqual(c.approvedHash, source.approvedHash);
        assert.equal(c.before, source.before); assert.equal(c.after, source.after);
        assert.ok(remaining.continuation!.objects.some(m => m.sourceObjectId === source.id && m.objectId === c.id));
        await diff(remaining, c);
    }
    assert.deepEqual(remaining.objects[0].dependencies, []);
    for (let i = 1; i < remaining.objects.length; i++) assert.deepEqual(remaining.objects[i].dependencies, [remaining.objects[i - 1].id]);
    selected = remaining;
    if (phase === 'remaining') {
        checks.push(await live(original, prerequisite, prerequisite.verified!, prerequisite.verifiedToken!));
        for (const c of remaining.objects) checks.push(await live(remaining, c, c.verified!, c.verifiedToken!));
    } else {
        const restoration: ChangeSet = await read('psft_get_change_set', { changeSetId: supplied });
        assert.equal(restoration.status, 'APPLIED'); assert.equal(restoration.objects.length, original.objects.length);
        assert.deepEqual(restoration.environment, original.environment);
        assert.ok(!restoration.continuation && !restoration.reverses, 'Combined continuation reversal is not claimed by baseline restoration.');
        for (const c of restoration.objects) {
            const source = original.objects.find(o => o.adapter === c.adapter && canonical(o.key) === canonical(c.key));
            assert.ok(source); approved(restoration, c, true);
            assert.equal(c.after, source.before, 'Complete original scope must be restored.');
            assert.notEqual(c.verifiedToken, source.baselineToken, 'Restoration has a fresh native revision.');
            await diff(restoration, c); checks.push(await live(restoration, c, c.verified!, c.verifiedToken!));
        }
        selected = restoration;
    }
}
const pageVersion = await checkPage(phase === 'restored');
report[phase] = { changeSetId: selected.id, status: selected.status, checkedAt: new Date().toISOString(), objects: checks,
    nativePageVersion: pageVersion, mode: 'Read-only native snapshot/token/checkpoint/approval/journal acceptance; no approval or writer calls.' };
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report[phase], null, 2));

async function checkPage(restored: boolean): Promise<number | undefined> {
    if (headers) return undefined;
    const layout = await read('psft_get_page_layout', { connection: original.environment.connection, page: 'ZZ_PCODE_LAB_PG' });
    const text = layout.controls.find((c: { id: number }) => c.id === 21), field = layout.controls.find((c: { id: number }) => c.id === 2);
    assert.equal(text.fieldType, 0); assert.equal(field.fieldType, 4);
    assert.equal(text.displayOnly, false); assert.equal(text.invisible, false);
    assert.deepEqual([text.left, text.top, text.right, text.bottom, text.label], restored
        ? [80, 520, 208, 540, 'Added by MCP'] : [88, 528, 248, 552, 'Review control validation']);
    assert.equal(field.displayOnly, !restored); assert.equal(field.invisible, !restored);
    return layout.version;
}
