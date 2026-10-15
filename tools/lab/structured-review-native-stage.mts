/** Controlled lab staging only. Capability checks precede any edit tool; no approval/apply. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
let id = 0;
async function rpc(method: string, params: object) {
    const response = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    assert.ok(response.ok, `MCP HTTP ${response.status}`);
    const body = await response.text(), r = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(s => s.startsWith('data:'))!.slice(5));
    assert.ok(!r.error, JSON.stringify(r.error)); return r.result;
}
async function tool(name: string, args: object = {}) {
    assert.ok(['psft_list_change_sets', 'psft_get_page_layout', 'psft_get_definition', 'psft_ae_get', 'psft_object_classify', 'psft_create_change_set',
        'psft_edit_page', 'psft_edit_record', 'psft_ae_edit', 'psft_get_change_set', 'psft_validate_change_set', 'psft_get_object_diff', 'psft_get_object_timeline', 'psft_request_change_review'].includes(name), 'No approval/application tools.');
    const r = await rpc('tools/call', { name, arguments: args });
    assert.ok(!r.isError, r.content?.[0]?.text);
    return JSON.parse(r.content.find((c: { type: string }) => c.type === 'text').text);
}
// Older schemas strip unknown grouping arguments and could invoke a legacy immediate writer.
const advertised = (await rpc('tools/list', {})).tools;
for (const name of ['psft_edit_page', 'psft_edit_record', 'psft_ae_edit'])
    assert.ok(advertised.find((t: { name: string }) => t.name === name)?.inputSchema?.properties?.changeSetId, 'Reload staged adapter build before editing: ' + name);
const caps = await tool('psft_list_change_sets');
for (const adapter of ['page', 'record', 'ae']) assert.ok(caps.adapters.includes(adapter), 'Reload missing adapter: ' + adapter);
if (process.argv.includes('--check-capabilities')) {
    console.log(JSON.stringify({ mode: 'capability checks only; no edit tool called', adapters: caps.adapters }));
} else if (process.argv.includes('--pause-headers')) {
    const first = JSON.parse(readFileSync('tools/lab/results/structured-review-native-validation.json', 'utf8'));
    assert.equal(first.reverted?.status, 'APPLIED', 'Verify the original three-object checkpoint inverse before a second trial.');
    const connection = 'HRDMO', record = 'ZZ_RPT_LINE', program = 'ZZ_AE_LAB01';
    for (const [type, name] of [[0, record], [33, program]] as const) {
        const classification = await tool('psft_object_classify', { connection, type, parts: [name] });
        assert.equal(classification.ownership, 'CUSTOM');
    }
    const recordRead = await tool('psft_get_definition', { connection, type: 0, parts: [record] });
    assert.equal(recordRead.definition.record.recordType, 2);
    const ae = await tool('psft_ae_get', { connection, program, includeText: false });
    assert.equal(ae.validation.errors.length, 0);
    let set = await tool('psft_create_change_set', { connection, title: 'Native header pause validation',
        requestKey: 'native-header-pause-0.9.1:' + first.changeSetId });
    assert.ok(['DRAFT', 'READY_FOR_REVIEW', 'CONFLICTED'].includes(set.status), 'Never replay applied or interrupted work.');
    const stagedRecord = await tool('psft_edit_record', { connection, record, changeSetId: set.id,
        expectedVersion: recordRead.definition.record.version, operations: [{ op: 'set_properties', description: 'Pause review validation' }] });
    assert.equal(stagedRecord.persisted, false);
    set = await tool('psft_get_change_set', { changeSetId: set.id });
    const recordObject = set.objects.find((c: { adapter: string }) => c.adapter === 'record');
    const stagedAe = await tool('psft_ae_edit', { connection, program, changeSetId: set.id, expectedToken: ae.token,
        dependsOn: [recordObject.id], operations: [{ op: 'set_program', description: 'Pause AE validation' }] });
    assert.equal(stagedAe.persisted, false);
    set = await tool('psft_validate_change_set', { changeSetId: set.id });
    assert.equal(set.status, 'READY_FOR_REVIEW', JSON.stringify(set.objects.map((c: { validation: string[] }) => c.validation)));
    const objects = [];
    for (const c of set.objects) {
        const source = first.objects.find((o: { adapter: string }) => o.adapter === c.adapter);
        assert.equal(c.before, source.before, 'The first trial must already be restored to its full original native scope.');
        const diff = await tool('psft_get_object_diff', { changeSetId: set.id, objectId: c.id });
        const timeline = await tool('psft_get_object_timeline', { changeSetId: set.id, objectId: c.id, checkLive: true });
        assert.equal(timeline.live.status, 'MATCHES_RECORDED');
        const live = timeline.live.matched === 'baseline' ? timeline.baseline : timeline.revisions.find((r: { id: string }) => r.id === timeline.live.matched);
        assert.equal(live.snapshot, c.before); assert.equal(live.token, c.baselineToken);
        assert.equal(diff.differences.length, 1);
        objects.push({ id: c.id, adapter: c.adapter, key: c.key, before: c.before, after: c.after, baselineToken: c.baselineToken, differences: diff.differences });
    }
    await tool('psft_request_change_review', { changeSetId: set.id });
    const report = { checkedAt: new Date().toISOString(), mode: 'Native rollback validation/staging only; no approval/apply',
        changeSetId: set.id, revision: set.revision, status: set.status, environment: set.environment, objects,
        scopedLiveBaselinesUnchanged: true, next: 'Developer approves both objects, then More actions > Apply one object, then pause.' };
    writeFileSync('tools/lab/results/header-pause-native-validation.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
} else {
    const connection = 'HRDMO', page = 'ZZ_PCODE_LAB_PG', record = 'ZZ_RPT_LINE', program = 'ZZ_AE_LAB01';
    for (const [type, name] of [[5, page], [0, record], [33, program]] as const) {
        const classification = await tool('psft_object_classify', { connection, type, parts: [name] });
        assert.equal(classification.ownership, 'CUSTOM', 'This controlled lab harness only stages confirmed custom definitions.');
    }
    const layout = await tool('psft_get_page_layout', { connection, page });
    const field = layout.controls.find((c: { id: number }) => c.id === 2), text = layout.controls.find((c: { id: number }) => c.id === 21);
    assert.equal(field.fieldType, 4, 'Use flags belong to the existing Edit Box, not Static Text.');
    assert.equal(field.displayOnly, false); assert.equal(field.invisible, false);
    assert.equal(text.fieldType, 0); assert.equal(text.displayOnly, false); assert.equal(text.invisible, false);
    assert.deepEqual([text.left, text.top, text.right, text.bottom, text.label], [80, 520, 208, 540, 'Added by MCP']);
    const recordRead = await tool('psft_get_definition', { connection, type: 0, parts: [record] });
    assert.equal(recordRead.definition.record.recordType, 2);
    const ae = await tool('psft_ae_get', { connection, program, includeText: false });
    assert.equal(ae.validation.errors.length, 0);
    let set = await tool('psft_create_change_set', { connection, title: 'Native structured review — controlled pause', requestKey: 'native-structured-pause-2026-10-15', session: 'native-structured-review-validation' });
    assert.ok(['DRAFT', 'READY_FOR_REVIEW', 'CONFLICTED'].includes(set.status), 'Do not replay an applied or interrupted lab Change Set.');
    const stagedPage = await tool('psft_edit_page', { connection, page, changeSetId: set.id, expectedVersion: layout.version, operations: [
        { op: 'move', id: 21, left: 88, top: 528 }, { op: 'resize', id: 21, width: 160, height: 24 },
        { op: 'set_label', id: 21, text: 'Review control validation', labelType: 1 },
        { op: 'set_use', id: 2, displayOnly: true, invisible: true }
    ] });
    assert.equal(stagedPage.persisted, false);
    set = await tool('psft_get_change_set', { changeSetId: set.id });
    const pageObject = set.objects.find((c: { adapter: string }) => c.adapter === 'page');
    const stagedRecord = await tool('psft_edit_record', { connection, record, changeSetId: set.id, expectedVersion: recordRead.definition.record.version,
        dependsOn: [pageObject.id], operations: [{ op: 'set_properties', description: 'Record review validation' }] });
    assert.equal(stagedRecord.persisted, false);
    set = await tool('psft_get_change_set', { changeSetId: set.id });
    const recordObject = set.objects.find((c: { adapter: string }) => c.adapter === 'record');
    const stagedAe = await tool('psft_ae_edit', { connection, program, changeSetId: set.id, expectedToken: ae.token,
        dependsOn: [recordObject.id], operations: [{ op: 'set_program', description: 'Change Review AE validation' }] });
    assert.equal(stagedAe.persisted, false);
    set = await tool('psft_validate_change_set', { changeSetId: set.id });
    assert.equal(set.status, 'READY_FOR_REVIEW', JSON.stringify(set.objects.map((c: { validation: string[] }) => c.validation)));
    const objects = [];
    for (const c of set.objects) {
        const diff = await tool('psft_get_object_diff', { changeSetId: set.id, objectId: c.id });
        const timeline = await tool('psft_get_object_timeline', { changeSetId: set.id, objectId: c.id, checkLive: true });
        assert.equal(timeline.live.status, 'MATCHES_RECORDED');
        const live = timeline.live.matched === 'baseline' ? timeline.baseline : timeline.revisions.find((r: { id: string }) => r.id === timeline.live.matched);
        assert.equal(live.snapshot, c.before); assert.equal(live.token, c.baselineToken);
        objects.push({ id: c.id, adapter: c.adapter, key: c.key, before: c.before, after: c.after, baselineToken: c.baselineToken, differences: diff.differences });
    }
    await tool('psft_request_change_review', { changeSetId: set.id });
    const report = { checkedAt: new Date().toISOString(), mode: 'installed native rollback validation and durable staging only; no approval/apply',
        changeSetId: set.id, revision: set.revision, status: set.status, environment: set.environment, objects, scopedLiveBaselinesUnchanged: true,
        next: 'Developer review, approve all, Apply one object then pause; independently verify before preparing fresh remaining work.' };
    writeFileSync('tools/lab/results/structured-review-native-validation.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}
