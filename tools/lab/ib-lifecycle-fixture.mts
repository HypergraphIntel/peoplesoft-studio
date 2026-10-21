/** Owned HRDMO fixtures for native PIA handler/definition deletion calibration. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseProvider } from '../../src/providers/database.js';
import { newIbInput } from '../../src/model/ibNew.js';
import { inputForIb } from '../../src/model/ibOperations.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { ibReviewTables } from '../../src/providers/ibSnapshot.js';
import { ibStructuralInput } from '../../src/changeReview/ibStructure.js';
import { hash, type Json } from '../../src/changeReview/model.js';
import { readIbLifecycle, type IbLifecycleKey } from '../../src/providers/ibLifecycle.js';
import { ADAPTER_TYPES } from '../../src/db/connection.js';
import { ibTransaction } from '../../src/test/fixtures/ibTransaction.js';

const names = { service: 'ZZ_PCODE_LAB_IBS', operation: 'ZZ_PCODE_LAB_IBO', empty: 'ZZ_PCODE_LAB_IBE' };
const config = { name: 'HRDMO owned IB lifecycle calibration', platform: 'oracle' as const,
    connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const p = new DatabaseProvider(config), operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_PCODE_LAB_IB');
try {
    await p.connect(); assert.equal((await p.readEnvironment()).toolsRelease, '8.62');
    assert.equal((await p.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL", 1)).rows[0].DB, 'HRDMO');
    if (process.argv[2] === 'classes') {
        console.log(JSON.stringify((await p.runReadOnlyQuery("SELECT DISTINCT PACKAGEROOT,QUALIFYPATH,APPCLASSID,APPCLASSMETHOD FROM PSOPERATIONAC WHERE APPCLASSMETHOD='OnRequest' AND PACKAGEROOT LIKE 'PT%' FETCH FIRST 15 ROWS ONLY", 15)).rows));
        process.exitCode = 0;
    } else if (process.argv[2] === 'seed') {
        for (const [kind, name] of [['service', names.service], ['service', names.empty], ['operation', names.operation]] as const)
            assert.equal(await p.readIntegrationBroker(kind, [name]), undefined, name + ' already exists; never reuse a fixture identity.');
        await writeFile('/tmp/psft-ib-lifecycle-fixture.json', JSON.stringify({ database: 'HRDMO', names, operatorId }) + '\n', { flag: 'wx', mode: 0o600 });
        for (const name of [names.service, names.empty]) {
            const input = newIbInput('service', [name], { serviceKind: 'standard' }, {}, 'ENG');
            input.properties.DESCR = 'IB lifecycle calibration'; input.properties.IB_NAMESPACE = 'urn:psft:ib-lifecycle';
            await p.saveIntegrationBroker({ input, expectedToken: 'absent', operatorId });
        }
    }
    if (['seed', 'seed-operation'].includes(process.argv[2])) {
        assert.deepEqual(JSON.parse(await readFile('/tmp/psft-ib-lifecycle-fixture.json', 'utf8')), { database: 'HRDMO', names, operatorId });
        assert.equal(await p.readIntegrationBroker('operation', [names.operation]), undefined);
        const service = (await p.readIntegrationBroker('service', [names.service]))!;
        assert.equal(service.properties.DESCR, 'IB lifecycle calibration');
        const input = newIbInput('operation', [names.operation], { operationType: 'S' }, {}, 'ENG', service.properties);
        input.properties.DESCR = 'IB lifecycle calibration'; input.sections.versions[0].ACTIVE_FLAG = 'I';
        for (const row of input.sections.parameters) { row.MSGNAME = 'ZZ_IB_PAYLOAD'; row.IB_MSGVERSION = 'V1'; }
        await p.saveIntegrationBroker({ input, expectedToken: 'absent', operatorId });
        const live = (await p.readIntegrationBroker('operation', [names.operation]))!, handler = inputForIb(live);
        handler.sections.handlers.push({ HANDLERNAME: 'REQUESTHDLR', HANDLERID: 'RQST', HANDLERTYPE: 'ApplicationClass', ACTIVE_FLAG: 'I' });
        handler.sections.applicationClassHandlers.push({ HANDLERNAME: 'REQUESTHDLR', PACKAGEID: ' ', PACKAGEROOT: 'PT_SES', QUALIFYPATH: ':', APPCLASSID: 'Init', APPCLASSMETHOD: 'OnRequest' });
        await p.saveIntegrationBroker({ input: handler, expectedToken: live.token, operatorId });
        console.log(JSON.stringify({ seeded: names, inactive: true }));
    } else if (process.argv[2] === 'restore-operation-without-handler') {
        const captures=JSON.parse(await readFile('src/test/fixtures/ib-native-8.62.09/definition-lifecycle.json','utf8'));
        const capture=captures.find((c:{case:string})=>c.case==='ib06-native-operation-recreate');
        const k:IbLifecycleKey={kind:'operation',name:names.operation,service:names.service};
        const f=ibTransaction('operation',true,{name:names.operation,schema:capture.schema,nativeRows:capture.after});
        const target=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true),before=await p.readIbDefinitionForReview(k,true);
        assert.equal(before.value,null,'Restoration requires the approved deleted fixture.');
        await p.writeIbDefinitionForReview({...k,after:target.value,expectedSnapshotToken:before.token,expectedAfterHash:target.hash,operatorId,allowDeletedBaseline:true,dryRun:true});
        await p.writeIbDefinitionForReview({...k,after:target.value,expectedSnapshotToken:before.token,expectedAfterHash:target.hash,operatorId,allowDeletedBaseline:true});
        assert.equal((await p.readIbDefinitionForReview(k,true)).hash,target.hash);
        console.log('Restored the native zero-handler operation checkpoint with the golden-tested typed lifecycle writer.');
    } else if (process.argv[2] === 'restore-handler') {
        const capture = JSON.parse(await readFile('tools/corpus/save-protocol/results/ib05-native-operation-delete/before.json', 'utf8'));
        assert.equal(capture.database, 'HRDMO'); assert.equal(capture.peopleToolsRelease, '8.62.09');
        const tables = Object.fromEntries(ibReviewTables('operation').map(table => {
            const t = capture.watch[table]; assert.ok(t, table);
            return [table, t.rows.map((row: unknown[]) => Object.fromEntries(t.columns.map((col: { name: string; type: string }, i: number) => [col.name, row[i] === null ? null : col.type === 'NUMBER' ? Number(row[i]) : row[i]]).filter(([key]: [string, unknown]) => !['VERSION','LASTUPDDTTM','LASTUPDOPRID'].includes(key))))];
        }));
        const original = { scope: 'ib-operation-header/1', tables } as unknown as Json;
        assert.equal((tables.PSOPERATION[0] as Record<string, unknown>).IB_OPERATIONNAME, names.operation);
        const before = await p.readIbForReview('operation', names.operation), live = (await p.readIntegrationBroker('operation', [names.operation]))!;
        const input = ibStructuralInput(before.value, original, 'operation', names.operation, live);
        await p.saveIntegrationBroker({ input, expectedToken: live.token, expectedSnapshotToken: before.token, expectedAfterHash: hash(original), operatorId });
        assert.equal((await p.readIbForReview('operation', names.operation)).hash, hash(original));
        console.log('Restored the complete captured native operation checkpoint with the typed structural writer.');
    } else if (!['state','classes'].includes(process.argv[2])) throw new Error('Use seed, seed-operation, restore-handler, classes or state. Native definition deletion is performed in PIA, never guessed here.');
    if (process.argv[2] !== 'classes') for (const [kind, name] of [['service', names.service], ['service', names.empty], ['operation', names.operation]] as const) {
        const doc = await p.readIntegrationBroker(kind, [name]); console.log(JSON.stringify({ kind, name, definition: doc ?? null }));
    }
} finally { await p.dispose(); }
