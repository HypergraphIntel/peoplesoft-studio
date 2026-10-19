import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES } from '../db/connection.js';
import { inputForIb, type IbWriteInput } from '../model/ibOperations.js';
import { readIb } from '../providers/ibReader.js';
import { saveIb } from '../providers/ibWriter.js';
import { readIbSnapshot, type IbReviewKind } from '../providers/ibSnapshot.js';
import { ibStructuralChange, ibStructuralInput, ibStructuralReversalRefusal } from '../changeReview/ibStructure.js';
import { ibHeaderDiff } from '../changeReview/ibHeaders.js';
import { hash, type Json } from '../changeReview/model.js';
import { ibTransaction as fixture } from './fixtures/ibTransaction.js';

/*
 * Structural IB review over the real writer's statements in a transactional
 * fixture: the after-image is the writer's own rollback preview, re-derived from
 * the two checkpoints and reproduced exactly, then committed under the after-image
 * guard and reversed by a typed inverse. Fixture commits are not native acceptance.
 */

type F = ReturnType<typeof fixture>;
const T = ADAPTER_TYPES;
const snapshot = (f: F, kind: IbReviewKind) => readIbSnapshot(f.connection, T, kind, f.name);
const live = async (f: F, kind: IbReviewKind) => (await readIb(f.connection, T, kind, [f.name]))!;

/** What MCP staging does: preview the caller's input, check the contract, re-derive, reproduce. */
async function stage(f: F, kind: IbReviewKind, edit: (input: IbWriteInput) => void) {
    const before = await snapshot(f, kind), doc = await live(f, kind), input = inputForIb(doc); edit(input);
    const first = await saveIb(f.connection, T, { input, expectedToken: doc.token, operatorId: 'JARED', dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token });
    const after = first.snapshots!.after.value as unknown as Json;
    const change = ibStructuralChange(before.value, after, kind, f.name);
    const again = await saveIb(f.connection, T, { input: ibStructuralInput(before.value, after, kind, f.name, doc), expectedToken: doc.token, operatorId: 'JARED', dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token, expectedAfterHash: hash(after) });
    assert.equal(again.snapshots!.after.hash, hash(after), 're-derived input reproduces the after-image');
    return { before, after, change };
}
/** What review application does: re-derive from (baseline, after) and commit under the guard. */
async function apply(f: F, kind: IbReviewKind, baseline: Json, after: Json) {
    const before = await snapshot(f, kind), doc = await live(f, kind);
    assert.equal(before.hash, hash(baseline), 'baseline unchanged before apply');
    return saveIb(f.connection, T, { input: ibStructuralInput(baseline, after, kind, f.name, doc), expectedToken: doc.token, operatorId: 'JARED', expectedSnapshotToken: before.token, expectedAfterHash: hash(after) });
}

test('IB operation structure: header, version and handler edits stage, apply exactly and reverse by typed inverse', async () => {
    const f = fixture('operation', true), initial = f.state();
    const { before, after, change } = await stage(f, 'operation', input => {
        input.properties.OBJECTOWNERID = 'ZZ';
        input.sections.versions![0].ACTIVE_FLAG = 'I';
        input.sections.handlers![0].ACTIVE_FLAG = 'I';
        input.sections.applicationClassHandlers![0].APPCLASSID = 'Handler';
    });
    assert.deepEqual(f.state(), initial, 'staging persisted nothing'); assert.equal(f.counts().commits, 0);
    assert.deepEqual(change.added, []);
    assert.deepEqual(change.changes.sort(), ['PSOPERATION.OBJECTOWNERID', 'PSOPRHDLR ["ZZ_IB_REVIEW","NOTIFYHDLR"].ACTIVE_FLAG', 'PSOPRVERDFN ["ZZ_IB_REVIEW","v1"].ACTIVE_FLAG']);
    assert.equal(ibHeaderDiff('operation').compare(before.value as unknown as Json, after).length, 3);
    assert.equal(ibStructuralReversalRefusal(before.value, after, 'operation', f.name), undefined);
    const applied = await apply(f, 'operation', before.value as unknown as Json, after);
    assert.equal(applied.written, true); assert.equal(f.counts().commits, 1);
    assert.equal((await snapshot(f, 'operation')).hash, hash(after));
    // Typed inverse: the original checkpoint as the new after-image, validated the same way.
    await apply(f, 'operation', after, before.value as unknown as Json);
    assert.equal((await snapshot(f, 'operation')).hash, before.hash);
});

test('IB operation structure: the calibrated OnRequest handler can be added but not reversed', async () => {
    const f = fixture('operation', true);
    const { before, after, change } = await stage(f, 'operation', input => {
        input.sections.handlers!.push({ HANDLERNAME: 'REQUESTHDLR', HANDLERID: 'RQST', HANDLERTYPE: 'ApplicationClass', ACTIVE_FLAG: 'A' });
        input.sections.applicationClassHandlers!.push({ HANDLERNAME: 'REQUESTHDLR', PACKAGEID: ' ', PACKAGEROOT: 'ZZ_PKG', QUALIFYPATH: ':', APPCLASSID: 'Handler', APPCLASSMETHOD: 'OnRequest' });
    });
    assert.equal(change.added.length, 2);
    assert.match(ibStructuralReversalRefusal(before.value, after, 'operation', f.name)!, /child deletion is not calibrated.*Deactivate/);
    await apply(f, 'operation', before.value as unknown as Json, after);
    assert.equal((await snapshot(f, 'operation')).hash, hash(after));
    const stored = f.state().PSOPRHDLR.find(r => r.HANDLERNAME === 'REQUESTHDLR')!;
    assert.equal(stored.DESCR, 'Before', 'a new handler takes the operation description, as PIA saves it');
    // Inverse needs deletion: the contract refuses it before the writer is reached.
    await assert.rejects(apply(f, 'operation', after, before.value as unknown as Json), /removing .*REQUESTHDLR.* needs child deletion, which is not calibrated/);
    assert.equal(f.counts().commits, 1);
});

test('IB service structure: owner and namespace apply exactly; alias stays outside the contract', async () => {
    const f = fixture('service', true);
    const { before, after } = await stage(f, 'service', input => { input.properties.OBJECTOWNERID = 'ZZ'; input.properties.IB_NAMESPACE = 'urn:reviewed'; });
    await apply(f, 'service', before.value as unknown as Json, after);
    assert.equal((await snapshot(f, 'service')).hash, hash(after));
    assert.equal(f.state().PSSERVICE[0].IBEXTERNALPWD, 'fixture-private', 'credentials preserved');
    await apply(f, 'service', after, before.value as unknown as Json);
    assert.equal((await snapshot(f, 'service')).hash, before.hash);
    await assert.rejects(stage(fixture('service', true), 'service', input => { input.properties.IB_ALIASNAME = 'ZZ_ALIAS'; }), /IB_ALIASNAME is outside reviewed IB structure/);
});

test('IB operation structure: routing-reaching, type, removal and out-of-scope changes are refused', async () => {
    for (const [edit, refusal] of [
        [(i: IbWriteInput) => { i.properties.IB_ALIASNAME = 'ZZ_ALIAS'; }, /IB_ALIASNAME is outside/],
        [(i: IbWriteInput) => { i.sections.parameters![0].IB_MSGVERSION = 'v2'; }, /IB_MSGVERSION cannot change.*message binding/],
        [(i: IbWriteInput) => { i.sections.handlers![0].HANDLERID = 'RQST'; }, /handler event or implementation type requires PIA/],
        [(i: IbWriteInput) => { i.sections.handlers = []; i.sections.applicationClassHandlers = []; }, /deleting stored child definitions is not calibrated/]
    ] as const) {
        const f = fixture('operation', true);
        await assert.rejects(stage(f, 'operation', edit), refusal);
        assert.equal(f.counts().commits, 0);
    }
    const f = fixture('operation', true), before = await snapshot(f, 'operation');
    const routed = structuredClone(before.value) as unknown as { tables: Record<string, Record<string, Json>[]> };
    routed.tables.PSIBRTNGDEFN.push({ IB_OPERATIONNAME: f.name, ROUTINGDEFNNAME: 'ZZ_ROUTE' });
    assert.throws(() => ibStructuralChange(before.value, routed, 'operation', f.name), /PSIBRTNGDEFN must not change/);
    const versioned = structuredClone(before.value) as unknown as { tables: Record<string, Record<string, Json>[]> };
    versioned.tables.PSOPRVERDFN.push({ ...versioned.tables.PSOPRVERDFN[0], VERSIONNAME: 'v2' });
    assert.throws(() => ibStructuralChange(before.value, versioned, 'operation', f.name), /Adding operation versions/);
    const other = structuredClone(before.value) as unknown as { tables: Record<string, Record<string, Json>[]> };
    other.tables.PSOPRHDLR.push({ ...other.tables.PSOPRHDLR[0], HANDLERNAME: 'OTHERHDLR' });
    assert.throws(() => ibStructuralChange(before.value, other, 'operation', f.name), /Only the calibrated ApplicationClass REQUESTHDLR/);
    assert.throws(() => ibStructuralChange(before.value, before.value, 'operation', f.name), /no changes/);
});
