/** Independent installed-MCP readback. No staging, approval, application or runtime endpoint. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { approvalHash, hash, type ChangeSet, type Json } from '../../../src/changeReview/model.js';
import { creationAeDocument, creationRecordEdit } from '../../../src/changeReview/structuredCreation.js';
import { projectCreationItems } from '../../../src/providers/projectSnapshot.js';
import { projectItemIdentity } from '../../../src/model/projectItems.js';
import { prepareSqlText } from '../../../src/providers/sqlWriter.js';
import { diffSpec, documentFromSpec } from '../../../src/model/aeSpec.js';
import { prepareSourceForSave } from '../../../src/peoplecode/writeback/savePlan.js';
import { sample } from './sample.mts';
const id = process.argv[2];
assert.match(id ?? '', /^[0-9a-f-]{36}$/i, 'Pass the applied Change Set ID.');
const correctionFlag = process.argv.indexOf('--correction');
const correctionId = correctionFlag < 0 ? undefined : process.argv[correctionFlag + 1];
if (correctionFlag >= 0) assert.match(correctionId ?? '', /^[0-9a-f-]{36}$/i);
let sequence = 0;
async function read(name: string, args: object): Promise<any> {
    assert.ok(['psft_get_change_set', 'psft_get_object_diff', 'psft_get_object_timeline', 'psft_ae_get', 'psft_project_related', 'psft_build_request_get'].includes(name));
    const result = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name, arguments: args } }) });
    const text = await result.text(), body = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data:'))!.slice(5));
    assert.ok(!body.error && !body.result.isError, body.error?.message ?? body.result?.content?.[0]?.text);
    return JSON.parse(body.result.content[0].text);
}
const set: ChangeSet = await read('psft_get_change_set', { changeSetId: id });
assert.equal(set.status, 'APPLIED'); assert.equal(set.revision, 5); assert.equal(set.environment.connection, 'oracle:HRDMO');
assert.deepEqual(set.objects.map(c => [c.adapter, c.key]), [['record-create', 'ZZ_RF_AET'], ['sql', 'ZZ_RF_ROWS'], ['ae-create', 'ZZ_RF_EXPORT'], ['project-create', 'ZZ_RF_PRJ']]);
const request = await read('psft_build_request_get', { id: 'br-60e7196e2b0a' });
assert.equal(request.buildAuthorized, true); assert.equal(request.spec.revision, 1);
const fixture = await sample(), checked = [];
// Preserve the original approved attachment/creation history even when a later
// explicitly reviewed PeopleCode fix supersedes its live source.
const originalSource = request.attachments.find((a: any) => a.name === 'export.peoplecode')?.text;
assert.equal(typeof originalSource, 'string');
const originalAe = structuredClone(fixture.ae);
originalAe.sections[0].steps[0].actions[0].peopleCode = originalSource;
for (const c of set.objects) {
    assert.equal(c.operation, 'CREATE'); assert.equal(c.review, 'APPROVED'); assert.equal(c.application, 'VERIFIED');
    assert.equal(c.approvedHash, approvalHash(set, c)); assert.equal(c.before, hash(null)); assert.equal(c.verified, c.after); assert.deepEqual(c.validation, []);
    const checkpoint = set.checkpoint?.objects.find(p => p.id === c.id);
    assert.equal(checkpoint?.snapshot, c.before); assert.equal(checkpoint?.token, c.baselineToken);
    const diff = await read('psft_get_object_diff', { changeSetId: id, objectId: c.id });
    assert.equal(diff.before, null); assert.equal(hash(diff.after), c.after);
    if (c.adapter === 'record-create') {
        const edit = creationRecordEdit(diff.after as Json, 'ZZ_RF_AET');
        assert.deepEqual(edit.fields.map(f => f.name), ['PROCESS_INSTANCE', 'DESCR']); assert.equal(edit.recordType, 2);
    } else if (c.adapter === 'sql') assert.equal(diff.after.text, prepareSqlText(fixture.sql));
    else if (c.adapter === 'ae-create') assert.deepEqual(diffSpec(creationAeDocument(diff.after, 'ZZ_RF_EXPORT'), originalAe), []);
    else {
        const expected = [{ type: 0, parts: ['ZZ_RF_AET'] }, { type: 30, parts: ['ZZ_RF_ROWS', '0'] }, { type: 33, parts: ['ZZ_RF_EXPORT'] }, { type: 34, parts: ['ZZ_RF_EXPORT', 'MAIN'] },
            { type: 43, parts: ['ZZ_RF_EXPORT', 'MAIN', 'GBL', 'default', '1900-01-01', 'Export', 'OnExecute'] }];
        assert.deepEqual(projectCreationItems(diff.after, 'ZZ_RF_PRJ').map(projectItemIdentity).sort(), expected.map(projectItemIdentity).sort());
    }
    if (c.adapter === 'ae-create' && correctionId) {
        checked.push({ adapter: c.adapter, key: c.key, hash: c.after, token: c.verifiedToken, supersededBy: correctionId });
        continue;
    }
    const timeline = await read('psft_get_object_timeline', { changeSetId: id, objectId: c.id, checkLive: true });
    assert.equal(timeline.live.status, 'MATCHES_RECORDED');
    const match = timeline.revisions.find((r: any) => r.id === timeline.live.matched);
    assert.ok(match); assert.equal(match.snapshot, c.after); assert.equal(match.token, c.verifiedToken);
    checked.push({ adapter: c.adapter, key: c.key, hash: c.after, token: c.verifiedToken, checkedAt: timeline.live.checkedAt });
}
assert.deepEqual(set.objects[2].dependencies, set.objects.slice(0, 2).map(c => c.id));
assert.deepEqual(set.objects[3].dependencies, [set.objects[2].id]);
const ae = await read('psft_ae_get', { connection: 'HRDMO', program: 'ZZ_RF_EXPORT' });
assert.deepEqual(ae.validation.errors, []); assert.deepEqual(ae.validation.warnings, []);
let correction;
if (correctionId) {
    const fix: ChangeSet = await read('psft_get_change_set', { changeSetId: correctionId });
    assert.equal(fix.status, 'APPLIED'); assert.deepEqual(fix.environment, set.environment);
    assert.equal(fix.requestKey, request.id); assert.equal(fix.objects.length, 1);
    const c = fix.objects[0];
    assert.equal(c.adapter, 'peoplecode'); assert.equal(c.operation, 'UPDATE');
    assert.deepEqual(c.key, { type: 43, parts: ['ZZ_RF_EXPORT', 'MAIN', 'GBL', 'default', '1900-01-01', 'Export', 'OnExecute'] });
    assert.equal(c.review, 'APPROVED'); assert.equal(c.application, 'VERIFIED');
    assert.equal(c.approvedHash, approvalHash(fix, c)); assert.equal(c.verified, c.after);
    const diff = await read('psft_get_object_diff', { changeSetId: correctionId, objectId: c.id });
    assert.equal(hash(diff.before), c.before); assert.equal(hash(diff.after), c.after);
    assert.equal(diff.before.text, prepareSourceForSave(originalSource));
    assert.equal(diff.after.text, prepareSourceForSave(fixture.peopleCode));
    const timeline = await read('psft_get_object_timeline', { changeSetId: correctionId, objectId: c.id, checkLive: true });
    assert.equal(timeline.live.status, 'MATCHES_RECORDED');
    const match = timeline.revisions.find((r: any) => r.id === timeline.live.matched);
    assert.equal(match?.snapshot, c.after); assert.equal(match?.token, c.verifiedToken);
    assert.deepEqual(diffSpec(documentFromSpec(ae.spec), fixture.ae), []);
    correction = { id: correctionId, revision: fix.revision, hash: c.after, token: c.verifiedToken, checkedAt: timeline.live.checkedAt };
}
const closure = await read('psft_project_related', { connection: 'HRDMO', project: 'ZZ_RF_PRJ' });
if (process.argv.includes('--require-closure')) assert.equal(closure.missing, 0, JSON.stringify(closure));
const report = { changeSetId: id, revision: set.revision, status: set.status, approvedSpec: request.spec.revision, objects: checked, correction, closure, runtimeVerified: false };
await writeFile('/tmp/psft-ae-file-native-metadata.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
