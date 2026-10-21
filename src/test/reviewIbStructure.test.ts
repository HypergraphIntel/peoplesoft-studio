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

test('IB operation structure: OnRequest addition, typed deletion inverse and redo reproduce native marker/counter rules', async () => {
    const f = fixture('operation', true);
    const { before, after, change } = await stage(f, 'operation', input => {
        input.sections.handlers!.push({ HANDLERNAME: 'REQUESTHDLR', HANDLERID: 'RQST', HANDLERTYPE: 'ApplicationClass', ACTIVE_FLAG: 'A' });
        input.sections.applicationClassHandlers!.push({ HANDLERNAME: 'REQUESTHDLR', PACKAGEID: ' ', PACKAGEROOT: 'ZZ_PKG', QUALIFYPATH: ':', APPCLASSID: 'Handler', APPCLASSMETHOD: 'OnRequest' });
    });
    assert.equal(change.added.length, 2);
    assert.equal(ibStructuralReversalRefusal(before.value, after, 'operation', f.name), undefined);
    await apply(f, 'operation', before.value as unknown as Json, after);
    assert.equal((await snapshot(f, 'operation')).hash, hash(after));
    const stored = f.state().PSOPRHDLR.find(r => r.HANDLERNAME === 'REQUESTHDLR')!;
    assert.equal(stored.DESCR, 'Before', 'a new handler takes the operation description, as PIA saves it');
    const notify = f.state().PSOPRHDLR.find(r => r.HANDLERNAME === 'NOTIFYHDLR');
    const removed = await apply(f, 'operation', after, before.value as unknown as Json);
    assert.deepEqual(removed.plan.increments, { OPRM: 2, SYS: 3, OPRHM: 1, OPRVM: 1 });
    assert.equal((await snapshot(f, 'operation')).hash, before.hash);
    assert.deepEqual(f.state().PSOPRHDLR.find(r => r.HANDLERNAME === 'NOTIFYHDLR'), notify, 'unmodified handlers keep their native counter/stamps');
    assert.equal(f.state().PSOPRHDLRDEL.length, 1);
    assert.equal(f.state().PSOPRHDLRDEL[0].VERSION, f.state().PSVERSION.find(r => r.OBJECTTYPENAME === 'OPRHM')!.VERSION);
    await apply(f, 'operation', before.value as unknown as Json, after);
    assert.equal((await snapshot(f, 'operation')).hash, hash(after));
    assert.equal(f.state().PSOPRHDLRDEL.length, 0, 'typed redo clears the bound native handler marker');
    assert.equal(f.counts().commits, 3);
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

for (const release of ['8.61.15', '8.62.09'] as const) for (const restRole of ['consumer', 'provider'] as const) {
    test(`IB ${release} REST ${restRole}: existing URI template stages, applies and reverses with mappings/routing preserved`, async () => {
        const f = fixture('operation', true, { release, restRole }), initial = f.state();
        const doc = await live(f, 'operation');
        assert.equal(doc.serviceKind, 'rest'); assert.equal(doc.restRole, restRole);
        assert.equal('URL_ID' in doc.properties, release === '8.62.09');
        const { before, after, change } = await stage(f, 'operation', i => { i.sections.uriTemplates[0].IB_URI_TEMPLATE = 'v2/items/{item}'; });
        assert.deepEqual(f.state(), initial, 'two rollback previews persisted no rows or counters');
        assert.deepEqual(change.changes, ['PSOPERATIONURI ["ZZ_IB_REVIEW",1].IB_URI_TEMPLATE']);
        assert.deepEqual(change.added, []);
        assert.equal(ibStructuralReversalRefusal(before.value, after, 'operation', f.name), undefined);
        await apply(f, 'operation', before.value as unknown as Json, after);
        for (const t of ['PSSERVICE', 'PSOPRHDLR', 'PSOPERATIONAC', 'PSOPRURIDATA', 'PSIBOPRROOT', 'PSIBRTNGDEFN', 'PSOPRGENRTGPARM', 'PSSERVICEOPR']) assert.deepEqual(f.state()[t], initial[t], t);
        assert.equal(f.state().PSOPERATIONURI[0].IB_URI_TEMPLATE, 'v2/items/{item}');
        await apply(f, 'operation', after, before.value as unknown as Json);
        assert.equal((await snapshot(f, 'operation')).hash, before.hash);
        // Redo runs the typed writer again under fresh tokens.
        await apply(f, 'operation', before.value as unknown as Json, after);
        assert.equal((await snapshot(f, 'operation')).hash, hash(after));
    });
}

test('IB REST URI review refuses new dependencies, malformed templates, identity edits and out-of-scope mappings without persistence', async () => {
    for (const [edit, refusal] of [
        [(i: IbWriteInput) => { i.sections.uriTemplates[0].IB_URI_TEMPLATE = 'items/{other}'; }, /URI variable dependencies/],
        [(i: IbWriteInput) => { i.sections.uriTemplates[0].IB_URI_TEMPLATE = 'items/{item}/{item}'; }, /URI variable dependencies/],
        [(i: IbWriteInput) => { i.sections.uriTemplates[0].IB_URI_TEMPLATE = 'items/{item'; }, /malformed URI variables/],
        [(i: IbWriteInput) => { i.sections.uriTemplates[0].IBTRANSACTIONID = 'OTHER'; }, /transaction and root mappings/],
        [(i: IbWriteInput) => { i.sections.uriTemplates.push({ ...i.sections.uriTemplates[0], IB_URI_SEQ: 2 }); }, /Adding REST URI templates/],
        [(i: IbWriteInput) => { i.sections.uriTemplates = []; }, /deleting stored child definitions/],
        [(i: IbWriteInput) => { i.sections.uriMessages[0].MSGNAME = 'OTHER'; }, /PSOPRURIDATA must not change/]
    ] as const) {
        const f = fixture('operation', true, { restRole: 'consumer' }), initial = f.state();
        await assert.rejects(stage(f, 'operation', edit), refusal);
        assert.deepEqual(f.state(), initial); assert.equal(f.counts().commits, 0);
    }
});

test('IB native handler tombstones participate in freshness without changing logical checkpoint content', async () => {
    const f = fixture('operation', true), before = await snapshot(f, 'operation'), doc = await live(f, 'operation');
    f.markerDrift();
    const now = await snapshot(f, 'operation');
    assert.equal(now.hash, before.hash, 'native deletion history is not logical definition content');
    assert.notEqual(now.token, before.token, 'unversioned deletion-marker drift invalidates a reviewed baseline');
    const input = inputForIb(doc); input.properties.DESCR = 'Must refuse stale marker';
    await assert.rejects(saveIb(f.connection, T, { input, expectedToken: doc.token, operatorId: 'JARED', expectedSnapshotToken: before.token, expectedAfterHash: before.hash }), /preservation snapshot changed before writer/);
    assert.equal(f.counts().commits, 0);
    assert.equal((await snapshot(f, 'operation')).token, now.token);
});

test('IB handler deletion on 8.61 and unpaired implementation removal refuse before persistence', async () => {
    for (const release of ['8.61.15', '8.62.09'] as const) {
        const f = fixture('operation', true, { release });
        const { before, after } = await stage(f, 'operation', i => {
            i.sections.handlers.push({ HANDLERNAME: 'REQUESTHDLR', HANDLERID: 'RQST', HANDLERTYPE: 'ApplicationClass', ACTIVE_FLAG: 'I' });
            i.sections.applicationClassHandlers.push({ HANDLERNAME: 'REQUESTHDLR', PACKAGEROOT: 'ZZ_PKG', QUALIFYPATH: ':', APPCLASSID: 'Handler', APPCLASSMETHOD: 'OnRequest' });
        });
        await apply(f, 'operation', before.value as unknown as Json, after);
        const initial = f.state(), doc = await live(f, 'operation'), input = inputForIb(doc);
        input.sections.applicationClassHandlers = input.sections.applicationClassHandlers.filter(r => r.HANDLERNAME !== 'REQUESTHDLR');
        await assert.rejects(saveIb(f.connection, T, { input, expectedToken: doc.token, operatorId: 'JARED', dryRun: true }), /handler and application class implementation together/);
        assert.deepEqual(f.state(), initial);
        if (release === '8.61.15') {
            await assert.rejects(apply(f, 'operation', after, before.value as unknown as Json), /calibrated only on PeopleTools 8.62.09/);
            assert.deepEqual(f.state(), initial);
        }
    }
});
