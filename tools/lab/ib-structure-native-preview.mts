/**
 * Native rollback validation of bounded IB structural review (src/changeReview/ibStructure.ts).
 * Never approves/applies a Change Set or commits IB writes: every save is a rollback preview,
 * and the scoped token, content hash and SRVM/OPRM/OPRVM/OPRHM/SYS counters must be unchanged after.
 *
 *   bash -lic 'npx tsx tools/lab/ib-structure-native-preview.mts'
 */
import assert from 'node:assert/strict';
import { DatabaseProvider } from '../../src/providers/database.js';
import { inputForIb, type IbWriteInput } from '../../src/model/ibOperations.js';
import { ibStructuralChange, ibStructuralInput, ibStructuralReversalRefusal } from '../../src/changeReview/ibStructure.js';
import { hash, type Json } from '../../src/changeReview/model.js';
import type { IbReviewKind } from '../../src/providers/ibSnapshot.js';

const p = new DatabaseProvider({ name: 'HRDMO IB structure rollback lab', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
const operator = process.env.PSLAB_OPERATOR ?? 'JARED';
const COUNTERS = "SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('SRVM','OPRM','OPRVM','OPRHM','SYS') ORDER BY OBJECTTYPENAME";
const cases: Array<{ kind: IbReviewKind; name: string; label: string; edit: (i: IbWriteInput) => void; outside?: RegExp }> = [
    { kind: 'service', name: 'ZZ_IB_STD', label: 'service owner + namespace', edit: i => { i.properties.OBJECTOWNERID = 'PPT'; i.properties.IB_NAMESPACE = 'http://xmlns.oracle.com/Enterprise/Tools/services/zz_reviewed'; } },
    { kind: 'operation', name: 'ZZ_IB_STDOP', label: 'operation owner, version and existing handler', edit: i => {
        i.properties.OBJECTOWNERID = 'PPT';
        i.sections.versions![0].DESCR = 'Reviewed version';
        const h = i.sections.handlers!.find(r => r.HANDLERNAME === 'REQUESTHDLR')!; h.ACTIVE_FLAG = h.ACTIVE_FLAG === 'A' ? 'I' : 'A'; h.DESCR = 'Reviewed handler';
    } },
    { kind: 'operation', name: 'ZZ_IB_API_5736828_G', label: 'REST provider: add calibrated OnRequest handler', edit: i => {
        (i.sections.handlers ??= []).push({ HANDLERNAME: 'REQUESTHDLR', HANDLERID: 'RQST', HANDLERTYPE: 'ApplicationClass', ACTIVE_FLAG: 'A' });
        (i.sections.applicationClassHandlers ??= []).push({ HANDLERNAME: 'REQUESTHDLR', PACKAGEID: ' ', PACKAGEROOT: 'PT_SES', QUALIFYPATH: ':', APPCLASSID: 'Init', APPCLASSMETHOD: 'OnRequest' });
    } },
    { kind: 'operation', name: 'ZZ_IB_STDOP', label: 'alias stays outside the contract', edit: i => { i.properties.IB_ALIASNAME = 'ZZ_IB_STDOP_ALIAS'; }, outside: /IB_ALIASNAME is outside/ }
];
try {
    await p.connect();
    for (const c of cases) {
        const before = await p.readIbForReview(c.kind, c.name), live = (await p.readIntegrationBroker(c.kind, [c.name]))!;
        assert.ok(live, c.name + ' not found');
        const counters = await p.runReadOnlyQuery(COUNTERS, 10), input = inputForIb(live); c.edit(input);
        const save = (request: IbWriteInput, expectedAfterHash?: string) => p.saveIntegrationBroker({ input: request, expectedToken: live.token, operatorId: operator, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token, ...(expectedAfterHash ? { expectedAfterHash } : {}) });
        const first = await save(input);
        assert.equal(first.written, false); assert.equal(first.snapshots!.before.hash, before.hash);
        const after = first.snapshots!.after.value as unknown as Json;
        let report: Record<string, unknown>;
        if (c.outside) {
            assert.throws(() => ibStructuralChange(before.value, after, c.kind, c.name), c.outside);
            report = { outsideContract: true };
        } else {
            const change = ibStructuralChange(before.value, after, c.kind, c.name);
            const again = await save(ibStructuralInput(before.value, after, c.kind, c.name, live), hash(after));
            assert.equal(again.snapshots!.after.hash, hash(after), 're-derived input reproduces the native after-image');
            report = { changes: change.changes, added: change.added, rederivedExact: true, reversal: ibStructuralReversalRefusal(before.value, after, c.kind, c.name) ?? 'typed inverse',
                validation: again.validation.filter(d => d.severity === 'error') };
        }
        const unchanged = await p.readIbForReview(c.kind, c.name);
        assert.equal(unchanged.token, before.token); assert.equal(unchanged.hash, before.hash);
        assert.deepEqual((await p.runReadOnlyQuery(COUNTERS, 10)).rows, counters.rows);
        console.log(JSON.stringify({ case: c.label, kind: c.kind, name: c.name, serviceKind: live.serviceKind, restRole: live.restRole, ...report, rolledBack: true, unchangedToken: before.token }));
    }
} finally { await p.dispose(); }
