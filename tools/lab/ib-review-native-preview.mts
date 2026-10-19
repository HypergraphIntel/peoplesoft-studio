/** Native rollback validation only. Never approves/applies a Change Set or commits IB writes. */
import assert from 'node:assert/strict';
import { DatabaseProvider } from '../../src/providers/database.js';
import { ibHeaderInput, ibHeaderProposal } from '../../src/changeReview/ibHeaders.js';
import { hash, type Json } from '../../src/changeReview/model.js';
import type { IbReviewKind } from '../../src/providers/ibSnapshot.js';

const p = new DatabaseProvider({ name: 'HRDMO IB rollback lab', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
const targets: Array<[IbReviewKind, string]> = [['service', 'ZZ_IB_STD'], ['operation', 'ZZ_IB_STDOP'], ['service', 'ZZ_IB_RESTP'], ['service', 'ZZ_IB_RESTC'], ['operation', 'ZZ_IB_API_5736828_G'], ['operation', 'ZZ_IB_API_5736828_E']];
try {
    await p.connect();
    for (const [kind, name] of targets) {
        const before = await p.readIbForReview(kind, name), live = await p.readIntegrationBroker(kind, [name]);
        assert.ok(live, name + ' not found');
        const after = ibHeaderProposal(before.value as unknown as Json, kind, { DESCR: 'IB review rollback preview', DESCRLONG: 'IB header review rollback preview\nComments preservation check.' });
        const counters = await p.runReadOnlyQuery("SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('SRVM','OPRM','OPRVM','OPRHM','SYS') ORDER BY OBJECTTYPENAME", 10);
        const result = await p.saveIntegrationBroker({ input: ibHeaderInput(before.value, after, kind, name, live), expectedToken: live.token, operatorId: process.env.PSLAB_OPERATOR ?? 'JARED', dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token, expectedAfterHash: hash(after) });
        assert.equal(result.written, false); assert.ok(result.snapshots);
        assert.equal(result.snapshots.before.hash, before.hash); assert.equal(result.snapshots.after.hash, hash(after));
        const unchanged = await p.readIbForReview(kind, name);
        assert.equal(unchanged.token, before.token); assert.equal(unchanged.hash, before.hash);
        const laterCounters = await p.runReadOnlyQuery("SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('SRVM','OPRM','OPRVM','OPRHM','SYS') ORDER BY OBJECTTYPENAME", 10);
        assert.deepEqual(laterCounters.rows, counters.rows);
        console.log(JSON.stringify({ kind, name, serviceKind: live.serviceKind, restRole: live.restRole, scopeTables: Object.keys(before.value.tables).length, rollbackExact: true, unchangedToken: before.token, validation: result.validation }));
    }
} finally { await p.dispose(); }
