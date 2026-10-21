/** Owned HRDMO REST fixtures for native PIA REST service/operation deletion calibration. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseProvider } from '../../src/providers/database.js';
import { newIbInput } from '../../src/model/ibNew.js';
import { inputForIb } from '../../src/model/ibOperations.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';

const names = { provider: 'ZZ_PCODE_LAB_IBRP', providerOp: 'ZZ_PCODE_LAB_IBRPG', consumer: 'ZZ_PCODE_LAB_IBRC', consumerOp: 'ZZ_PCODE_LAB_IBRCG', empty: 'ZZ_PCODE_LAB_IBRE' };
const manifest = '/tmp/psft-ib-rest-lifecycle-fixture.json';
const config = { name: 'HRDMO owned IB REST lifecycle calibration', platform: 'oracle' as const,
    connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const p = new DatabaseProvider(config), operatorId = process.env.PSLAB_OPERATOR ?? 'JARED', mode = process.argv[2];
const services = [[names.provider, 'provider'], [names.consumer, 'consumer'], [names.empty, 'provider']] as const;
const operations = [[names.providerOp, names.provider], [names.consumerOp, names.consumer]] as const;
setWriteNamePrefix('ZZ_PCODE_LAB_IBR');
try {
    await p.connect(); assert.equal((await p.readEnvironment()).toolsRelease, '8.62');
    assert.equal((await p.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL", 1)).rows[0].DB, 'HRDMO');
    if (mode === 'dry' || mode === 'seed') {
        // A service already created through MCP for this calibration (same description and role) is kept, never reused otherwise.
        const made = new Set<string>();
        for (const [name, restRole] of services) {
            const doc = await p.readIntegrationBroker('service', [name]);
            if (doc) { assert.ok(doc.properties.DESCR === 'IB REST lifecycle calibration' && Number(doc.properties.IB_REST_SERVICE) === (restRole === 'consumer' ? 1 : 2), name + ' already exists; never reuse a fixture identity.'); made.add(name); }
        }
        for (const [name] of operations) assert.equal(await p.readIntegrationBroker('operation', [name]), undefined, name + ' already exists; never reuse a fixture identity.');
        if (mode === 'seed') await writeFile(manifest, JSON.stringify({ database: 'HRDMO', names, operatorId }) + '\n', { flag: 'wx', mode: 0o600 });
        for (const [name, restRole] of services) {
            if (made.has(name)) { console.log(JSON.stringify({ name, restRole, existing: true })); continue; }
            const input = newIbInput('service', [name], { serviceKind: 'rest', restRole }, {}, 'ENG');
            input.properties.DESCR = 'IB REST lifecycle calibration'; input.properties.IB_NAMESPACE = 'urn:psft:ib-rest-lifecycle';
            const r = await p.saveIntegrationBroker({ input, expectedToken: 'absent', operatorId, dryRun: mode === 'dry' });
            console.log(JSON.stringify({ name, restRole, dryRun: mode === 'dry', written: r.written, errors: r.validation.filter(d => d.severity === 'error') }));
        }
    }
    if (mode === 'seed' || mode === 'seed-operations' || mode === 'dry-operations') {
        assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), { database: 'HRDMO', names, operatorId });
        for (const [name, service] of operations) {
            assert.equal(await p.readIntegrationBroker('operation', [name]), undefined);
            const svc = (await p.readIntegrationBroker('service', [service]))!;
            assert.equal(svc.properties.DESCR, 'IB REST lifecycle calibration');
            const input = newIbInput('operation', [name], { service, method: 'GET' }, {}, 'ENG', svc.properties);
            input.properties.DESCR = 'IB REST lifecycle calibration'; input.sections.versions[0].ACTIVE_FLAG = 'I';
            // GET needs a response message (the existing lab REST message) and one URI template; consumers an external base URL.
            for (const row of input.sections.parameters) if (row.PARAMETERNAME === 'RESPONSE') { row.MSGNAME = 'ZZ_IB_API_5736828_M'; row.IB_MSGVERSION = 'V1'; }
            input.sections.uriTemplates = [{ IB_URI_SEQ: 1, IBTRANSACTIONID: ' ', IB_RESERVED: 0, PTIBURLPARAMNAME: ' ', IB_URI_TEMPLATE: 'item' }];
            if (service === names.consumer) input.properties.IB_RESTBASE_URL = 'http://example.invalid/rest';
            if (mode === 'dry-operations') { const r = await p.saveIntegrationBroker({ input, expectedToken: 'absent', operatorId, dryRun: true }); console.log(JSON.stringify({ name, dryRun: true, written: r.written, errors: r.validation.filter(d => d.severity === 'error') })); continue; }
            await p.saveIntegrationBroker({ input, expectedToken: 'absent', operatorId });
        }
        // Provider operation carries the calibrated inactive OnRequest handler, as REST providers usually do.
        if (mode !== 'dry-operations') {
        const live = (await p.readIntegrationBroker('operation', [names.providerOp]))!, handler = inputForIb(live);
        handler.sections.handlers.push({ HANDLERNAME: 'REQUESTHDLR', HANDLERID: 'RQST', HANDLERTYPE: 'ApplicationClass', ACTIVE_FLAG: 'I' });
        handler.sections.applicationClassHandlers.push({ HANDLERNAME: 'REQUESTHDLR', PACKAGEID: ' ', PACKAGEROOT: 'PT_SES', QUALIFYPATH: ':', APPCLASSID: 'Init', APPCLASSMETHOD: 'OnRequest' });
        await p.saveIntegrationBroker({ input: handler, expectedToken: live.token, operatorId });
        console.log(JSON.stringify({ seeded: names, inactive: true }));
        }
    } else if (!['state', 'dry'].includes(mode)) throw new Error('Use dry, seed, dry-operations, seed-operations or state. Native REST deletion is performed in PIA, never guessed here.');
    if (mode !== 'dry') for (const [name] of services) console.log(JSON.stringify({ kind: 'service', name, definition: (await p.readIntegrationBroker('service', [name])) ?? null }));
    if (mode !== 'dry') for (const [name] of operations) console.log(JSON.stringify({ kind: 'operation', name, definition: (await p.readIntegrationBroker('operation', [name])) ?? null }));
} finally { await p.dispose(); }
