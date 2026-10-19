import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES } from '../db/connection.js';
import { inputForIb } from '../model/ibOperations.js';
import { readIb } from '../providers/ibReader.js';
import { saveIb } from '../providers/ibWriter.js';
import { readIbSnapshot } from '../providers/ibSnapshot.js';
import { ibHeaderChange, ibHeaderInput, ibHeaderProposal, ibHeaderDiff, isIbHeaderInput } from '../changeReview/ibHeaders.js';
import { hash, type Json } from '../changeReview/model.js';
import { ibTransaction as fixture } from './fixtures/ibTransaction.js';


for (const kind of ['service', 'operation'] as const) {
    async function change(f: ReturnType<typeof fixture>, commit = false, reverse?: Json) {
        const before = await readIbSnapshot(f.connection, ADAPTER_TYPES, kind, f.name), live = (await readIb(f.connection, ADAPTER_TYPES, kind, [f.name]))!;
        const after = reverse ?? ibHeaderProposal(before.value as unknown as Json, kind, { DESCR: 'Reviewed IB', DESCRLONG: 'Reviewed comments' });
        const result = await saveIb(f.connection, ADAPTER_TYPES, { input: ibHeaderInput(before.value, after, kind, f.name, live), expectedToken: live.token, operatorId: 'JARED', expectedSnapshotToken: before.token, expectedAfterHash: hash(after), ...(!commit ? { dryRun: true, captureSnapshots: true } : {}) });
        return { result, before, after };
    }
    test(kind + ' IB real writer rollback preview, commit and typed inverse preserve metadata/credentials', async () => {
        const f = fixture(kind), preview = await change(f);
        assert.equal(preview.result.written, false); assert.equal(preview.result.snapshots?.after.hash, hash(preview.after));
        assert.deepEqual(f.state(), f.initial); assert.ok(f.counts().updates > 0); assert.equal(f.counts().commits, 0);
        assert.equal(ibHeaderDiff(kind).compare(preview.before.value as unknown as Json, preview.after).length, 2);
        assert.ok(!JSON.stringify(preview.result.snapshots).includes('fixture-private'));
        await change(f, true); assert.equal(f.counts().commits, 1);
        assert.equal((await readIbSnapshot(f.connection, ADAPTER_TYPES, kind, f.name)).hash, hash(preview.after));
        assert.equal(f.state().PSSERVICE[0].IBEXTERNALPWD, 'fixture-private');
        await change(f, true, preview.before.value as unknown as Json);
        assert.equal((await readIbSnapshot(f.connection, ADAPTER_TYPES, kind, f.name)).hash, preview.before.hash);
    });
    test(kind + ' IB snapshot drift and after-image failures fail closed', async () => {
        const f = fixture(kind), before = await readIbSnapshot(f.connection, ADAPTER_TYPES, kind, f.name), live = (await readIb(f.connection, ADAPTER_TYPES, kind, [f.name]))!;
        f.drift(); const fresh = (await readIb(f.connection, ADAPTER_TYPES, kind, [f.name]))!;
        const after = ibHeaderProposal(before.value as unknown as Json, kind, { DESCR: 'Reviewed' });
        await assert.rejects(saveIb(f.connection, ADAPTER_TYPES, { input: ibHeaderInput(before.value, after, kind, f.name, live), expectedToken: fresh.token, operatorId: 'JARED', expectedSnapshotToken: before.token }), /snapshot changed/);
        assert.equal(f.counts().updates, 0);
        for (const failure of ['failAfter', 'tamper'] as const) {
            const g = fixture(kind); g[failure]();
            await assert.rejects(change(g, true), /after snapshot unavailable|after-image differs/);
            assert.equal(g.counts().commits, 0); assert.deepEqual(g.state(), g.initial);
        }
    });
    test(kind + ' IB structural input/checkpoint and incomplete scopes are refused', async () => {
        const f = fixture(kind), before = await readIbSnapshot(f.connection, ADAPTER_TYPES, kind, f.name), live = (await readIb(f.connection, ADAPTER_TYPES, kind, [f.name]))!;
        const input = inputForIb(live); input.properties.DESCR = 'Header';
        assert.equal(isIbHeaderInput(live, input), true);
        input.properties.OBJECTOWNERID = 'OTHER'; assert.equal(isIbHeaderInput(live, input), false);
        const bad = structuredClone(before.value); bad.tables[kind === 'service' ? 'PSSERVICE' : 'PSOPERATION'][0].FUTURE_COLUMN = 'OTHER';
        assert.throws(() => ibHeaderChange(before.value, bad, kind, f.name), /Only existing IB/);
        delete bad.tables.PSSERVICEOPR; assert.throws(() => ibHeaderChange(before.value, bad, kind, f.name), /Incomplete/);
    });
}
