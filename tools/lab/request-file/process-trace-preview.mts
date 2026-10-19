/** Native rollback-only regression for canonical Process Change Review input. Never commits. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import oracledb from 'oracledb';
import { DatabaseProvider } from '../../../src/providers/database.js';
import { setWriteNamePrefix } from '../../../src/providers/writeScope.js';
import { processEdit, processToken } from '../../../src/model/processEdit.js';
import { DefinitionType, makeKey } from '../../../src/model/definitions.js';
import { canonical } from '../../../src/changeReview/model.js';
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
assert.match(connectString, /hrdmo/i);
setWriteNamePrefix('ZZ_RF_EXPORT');
const config = { name: 'LAB', platform: 'oracle' as const, connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
const p = new DatabaseProvider(config), raw = await oracledb.getConnection(config);
const counters = async () => (await raw.execute("SELECT 'V' KIND,OBJECTTYPENAME,VERSION FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('PPC','SYS') UNION ALL SELECT 'L',OBJECTTYPENAME,VERSION FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME='PPC' ORDER BY 1,2", {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;
try {
    await p.connect();
    const key = makeKey(DefinitionType.ProcessDefinition, 'Application Engine', 'ZZ_RF_EXPORT');
    const before = await p.readProcessDocument(key), token = processToken(before), beforeCounters = await counters();
    const response = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'psft_get_object_diff', arguments: { changeSetId: 'c811c902-977e-476f-8c92-bf350e61499d', objectId: '2afd2447-7120-4640-bba5-2b858e48011f' } } }) });
    const wire = await response.text(), body = JSON.parse(wire.startsWith('{') ? wire : wire.split('\n').find(line => line.startsWith('data:'))!.slice(5));
    assert.ok(!body.error && !body.result.isError, body.error?.message ?? body.result?.content?.[0]?.text);
    const diff = JSON.parse(body.result.content[0].text);
    assert.equal(diff.object.adapter, 'process');
    assert.deepEqual(diff.object.key, ['Application Engine', 'ZZ_RF_EXPORT']);
    const proposal = { baselineToken: diff.object.baselineToken, before: diff.before, after: diff.after };
    assert.equal(token, proposal.baselineToken);
    assert.deepEqual(processEdit(before), proposal.before);
    const edit = JSON.parse(canonical(proposal.after));
    const preview = await p.saveProcessDocument({ key: [...key.parts], token, edit, operatorId: 'JARED', dryRun: true });
    assert.deepEqual(processEdit(preview), edit);
    const after = await p.readProcessDocument(key);
    assert.equal(processToken(after), token);
    assert.deepEqual(await counters(), beforeCounters);
    const report = { dryRun: true, persisted: false, baselineToken: token, inputVerified: true, countersUnchanged: true };
    await writeFile('/tmp/psft-process-canonical-native-preview.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
} finally { await p.dispose(); await raw.close(); }
