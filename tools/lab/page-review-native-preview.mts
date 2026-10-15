/** Controlled lab preview only. Capability checks precede every Page writer call. No approvals or apply. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const page = process.argv.find(a => a.startsWith('--page='))?.slice(7) ?? 'ZZ_PCODE_LAB_PG';
assert.match(page, /^ZZ_[A-Z0-9_]{1,15}$/, 'Only a controlled ZZ_ lab Page of at most 18 characters is accepted.');
let id = 0;
async function rpc(method: string, params: object) {
    const response = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    assert.ok(response.ok, `MCP HTTP ${response.status}`);
    const body = await response.text(), result = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(s => s.startsWith('data:'))!.slice(5));
    assert.ok(!result.error, JSON.stringify(result.error));
    return result.result;
}
async function tool(name: string, args: object) {
    assert.ok(['psft_list_change_sets', 'psft_get_page_layout', 'psft_edit_page'].includes(name));
    if (name === 'psft_edit_page') assert.equal((args as { dryRun?: boolean }).dryRun, true, 'This harness cannot save or stage a Page.');
    const result = await rpc('tools/call', { name, arguments: args });
    assert.ok(!result.isError, result.content?.[0]?.text);
    return JSON.parse(result.content.find((c: { type: string }) => c.type === 'text').text);
}
// Older MCP schemas may strip unknown dryRun arguments: never call the writer until its advertised schema is checked.
const advertised = (await rpc('tools/list', {})).tools;
const edit = advertised.find((t: { name: string }) => t.name === 'psft_edit_page');
assert.equal(edit?.inputSchema?.properties?.dryRun?.type, 'boolean', 'Reload the new build before native preview: dryRun is not advertised.');
assert.equal(edit?.inputSchema?.properties?.includeSnapshots?.type, 'boolean', 'Reload the new build before native preview: native snapshots are not advertised.');
assert.equal(edit?.inputSchema?.properties?.expectedVersion?.type, 'integer', 'Native Page version checking is not advertised.');
assert.ok((await tool('psft_list_change_sets', {})).adapters.includes('page'), 'The bounded Page review adapter is not active.');
if (process.argv.includes('--check-capabilities')) {
    console.log(JSON.stringify({ mode: 'capability checks only; no Page writer called', pageAdapter: true }));
} else {
    const connection = 'HRDMO', layout = await tool('psft_get_page_layout', { connection, page });
    const preview = async (description: string) => {
        const result = await tool('psft_edit_page', { connection, page, dryRun: true, includeSnapshots: true, expectedVersion: layout.version,
            operations: [{ op: 'set_properties', description }] });
        assert.equal(result.saved, false); assert.equal(result.preview, true); assert.equal(result.snapshots?.schema, 'page-preview/1');
        return result;
    };
    const first = await preview(layout.properties.description);
    const proposed = await preview('Native Page review preview');
    const final = await preview(layout.properties.description);
    assert.equal(proposed.snapshots.before.token, first.snapshots.before.token, 'Page changed before the candidate preview.');
    assert.equal(final.snapshots.before.token, first.snapshots.before.token, 'Native Page rows/version changed after rollback preview.');
    assert.equal(final.snapshots.before.hash, first.snapshots.before.hash);
    assert.equal((await tool('psft_get_page_layout', { connection, page })).version, layout.version);
    const report = { checkedAt: new Date().toISOString(), connection, page,
        mode: 'installed native Page rollback previews only; no stage/approval/apply',
        baselineVersion: layout.version, baselineToken: first.snapshots.before.token, baselineHash: first.snapshots.before.hash,
        candidateHash: proposed.snapshots.after.hash, hypotheticalVersion: proposed.hypotheticalVersion,
        scopedTables: Object.keys(first.snapshots.before.value.tables), nativeScopedContentAndTokenUnchanged: true,
        notVerified: ['global native counter readback', 'developer-reviewed Page apply/inverse', 'native visual reopen'] };
    writeFileSync('tools/lab/results/page-review-native-preview.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}
