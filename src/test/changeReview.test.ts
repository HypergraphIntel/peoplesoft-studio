import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReviewStore } from '../changeReview/store.js';
import { ReviewService, type ReviewAdapter } from '../changeReview/service.js';
import { buildObjectTimeline } from '../changeReview/timeline.js';
import { approvalHash, canonical, differences, hash, privacy, type Environment, type Json } from '../changeReview/model.js';
async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'psft-review-')), store = new ReviewStore(root);
    let target: Environment = { connection: 'oracle:LAB', identity: 'database-schema-1', label: 'LAB' }, writable = true, fail = '', commitThenFail = false;
    const live = new Map<string, {
        value: Json;
        token: string;
    }>();
    const writes: string[] = [];
    const adapter: ReviewAdapter = { id: 'fixture', canDelete: true,
        read: async (_e, key) => structuredClone(live.get(String(key)) ?? { value: null, token: 'absent' }),
        validate: async (_e, _key, _before, after) => after && typeof after === 'object' && !Array.isArray(after) && after.invalid === true ? ['invalid definition'] : [],
        authorize: async () => {
            if (!writable)
                throw new Error('read-only or policy block');
        },
        write: async (_e, key, after, before) => {
            const k = String(key);
            assert.equal((live.get(k)?.token ?? 'absent'), before.token);
            writes.push(k);
            if (fail === k && !commitThenFail)
                throw new Error('writer refused');
            live.set(k, { value: after, token: String(Number(live.get(k)?.token ?? 0) + 1) });
            if (fail === k)
                throw new Error('after commit failure');
        }
    };
    const service = new ReviewService(store, { environment: async () => target, changed() { } }, [adapter]);
    return { root, store, service, live, writes, adapter, close: () => fs.rm(root, { recursive: true, force: true }), setTarget: (e: Environment) => { target = e; }, readonly: () => { writable = false; }, fail: (key: string, afterCommit = false) => { fail = key; commitThenFail = afterCommit; } };
}
async function ready(f: Awaited<ReturnType<typeof fixture>>, keys = ['A']) {
    let set = await f.service.create('Test change', 'oracle:LAB');
    for (const key of keys)
        set = await f.service.stage(set.id, 'fixture', key, { text: 'new ' + key });
    set = await f.service.validate(set.id);
    assert.equal(set.status, 'READY_FOR_REVIEW');
    return f.service.review(set.id, set.objects.map(c => c.id), 'APPROVED', set.revision);
}
async function partialChain(f: Awaited<ReturnType<typeof fixture>>) {
    let set = await ready(f, ['A', 'B', 'C', 'D']);
    for (let i = 1; i < set.objects.length; i++)
        set = await f.service.stage(set.id, 'fixture', String.fromCharCode(65 + i), { text: 'new ' + String.fromCharCode(65 + i) }, [set.objects[i - 1].id]);
    set = await f.service.validate(set.id);
    set = await f.service.review(set.id, set.objects.map(c => c.id), 'APPROVED', set.revision);
    f.fail('B', true);
    assert.equal((await f.service.apply(set.id)).status, 'PARTIALLY_APPLIED');
    return set;
}
test('trusted one-object application pauses only at a verified writer boundary and requires fresh remaining approval', async () => {
    const f = await fixture();
    try {
        const set = await ready(f, ['A', 'B']);
        const paused = await f.service.apply(set.id, true);
        assert.equal(paused.status, 'PARTIALLY_APPLIED');
        assert.deepEqual(paused.objects.map(c => c.application), ['VERIFIED', 'PENDING']);
        assert.deepEqual(f.writes, ['A']);
        assert.ok(paused.journal.some(e => e.action === 'PAUSED_BETWEEN_WRITERS'));
        assert.ok(!paused.journal.some(e => e.action === 'APPLICATION_STOPPED'));
        await assert.rejects(f.service.apply(set.id), /approved Change Set/);
        let remaining = await f.service.prepareRemaining(set.id);
        assert.deepEqual(remaining.objects.map(c => c.key), ['B']);
        assert.equal(remaining.continuation?.prerequisites.length, 1);
        await assert.rejects(f.service.apply(remaining.id), /approved/);
        remaining = await f.service.validate(remaining.id);
        remaining = await f.service.review(remaining.id, remaining.objects.map(c => c.id), 'APPROVED', remaining.revision);
        assert.equal((await f.service.apply(remaining.id)).status, 'APPLIED');
        assert.deepEqual(f.writes, ['A', 'B']);
    } finally { await f.close(); }
});
test('one-object application does not partially reverse checkpoints and still checks every baseline before writing', async () => {
    const f = await fixture();
    try {
        f.live.set('A', { value: { text: 'old' }, token: '1' });
        let set = await ready(f, ['A']);
        assert.equal((await f.service.apply(set.id, true)).status, 'APPLIED');
        let inverse = await f.service.reverse(set.id);
        inverse = await f.service.validate(inverse.id);
        inverse = await f.service.review(inverse.id, inverse.objects.map(c => c.id), 'APPROVED', inverse.revision);
        await assert.rejects(f.service.apply(inverse.id, true), /Partial reversal/);
        set = await ready(f, ['B', 'C']);
        f.live.set('C', { value: { text: 'outside' }, token: '2' });
        assert.equal((await f.service.apply(set.id, true)).status, 'CONFLICTED');
        assert.deepEqual(f.writes, ['A']);
    } finally { await f.close(); }
});
test('remaining work is a durable fresh proposal after reconciliation; confirmed writes are never replayed', async () => {
    const f = await fixture();
    try {
        const set = await partialChain(f);
        await assert.rejects(f.service.prepareRemaining(set.id), /Reconcile uncertain/);
        await f.service.recover(set.id);
        const before = canonical(await f.store.get(set.id));
        let proposal = await f.service.prepareRemaining(set.id);
        assert.equal(proposal.schema, 2);
        assert.equal(proposal.status, 'DRAFT');
        assert.deepEqual(proposal.objects.map(c => c.key), ['C', 'D']);
        assert.deepEqual(proposal.objects[1].dependencies, [proposal.objects[0].id]);
        assert.deepEqual(proposal.continuation?.prerequisites.map(p => p.key), ['A', 'B']);
        assert.ok(proposal.objects.every(c => c.review === 'PENDING' && c.application === 'PENDING' && !c.approvedHash && !c.authorizationStamp));
        assert.equal(canonical(await f.store.get(set.id)), before);
        assert.equal((await new ReviewStore(f.root).get(proposal.id)).continuation?.changeSetId, set.id);
        assert.equal((await f.service.prepareRemaining(set.id)).id, proposal.id);
        await assert.rejects(f.service.apply(proposal.id), /approved/);
        await assert.rejects(f.service.stage(proposal.id, 'fixture', 'A', { text: 'do not replay' }), /prerequisite cannot also/);
        assert.deepEqual(f.writes, ['A', 'B']);
        f.fail('');
        proposal = await f.service.validate(proposal.id);
        proposal = await f.service.review(proposal.id, proposal.objects.map(c => c.id), 'APPROVED', proposal.revision);
        assert.equal((await f.service.apply(proposal.id)).status, 'APPLIED');
        assert.deepEqual(f.writes, ['A', 'B', 'C', 'D']);
        assert.equal((await f.store.get(set.id)).status, 'PARTIALLY_APPLIED', 'original outcome remains an honest historical record');
        assert.equal((await f.service.prepareRemaining(set.id)).id, proposal.id, 'duplicate preparation never replays an applied follow-up');
        await assert.rejects(f.service.reverse(proposal.id), /combined recovery plan/);
    } finally { await f.close(); }
});

test('remaining preparation refuses unknown outcomes, native drift and environment changes without creating a set', async () => {
    for (const mode of ['uncertain', 'confirmed-token', 'pending-content', 'environment']) {
        const f = await fixture();
        try {
            const set = await partialChain(f);
            if (mode === 'uncertain') f.live.delete('B');
            await f.service.recover(set.id);
            if (mode === 'confirmed-token') f.live.get('A')!.token = 'external-resave';
            if (mode === 'pending-content') f.live.set('C', { value: { text: 'outside' }, token: 'external' });
            if (mode === 'environment') f.setTarget({ ...set.environment, identity: 'another-schema' });
            await assert.rejects(f.service.prepareRemaining(set.id), /uncertain|changed|Restage/);
            assert.equal((await f.store.list()).length, 1);
            assert.deepEqual(f.writes, ['A', 'B']);
        } finally { await f.close(); }
    }
});

test('continuation prerequisites are enforced during validation and again after approval', async () => {
    for (const phase of ['validate', 'apply']) {
        const f = await fixture();
        try {
            const source = await partialChain(f);
            await f.service.recover(source.id);
            let proposal = await f.service.prepareRemaining(source.id);
            if (phase === 'apply') {
                proposal = await f.service.validate(proposal.id);
                proposal = await f.service.review(proposal.id, proposal.objects.map(c => c.id), 'APPROVED', proposal.revision);
            }
            f.live.get('A')!.token = 'external-resave';
            const stopped = phase === 'apply' ? await f.service.apply(proposal.id) : await f.service.validate(proposal.id);
            assert.equal(stopped.status, 'CONFLICTED');
            assert.deepEqual(f.writes, ['A', 'B']);
        } finally { await f.close(); }
    }
});

test('continuation approval binds prerequisites and schema 1 cannot silently discard the new contract', async () => {
    const f = await fixture();
    try {
        const source = await partialChain(f);
        await f.service.recover(source.id);
        let proposal = await f.service.prepareRemaining(source.id);
        proposal = await f.service.validate(proposal.id);
        proposal = await f.service.review(proposal.id, proposal.objects.map(c => c.id), 'APPROVED', proposal.revision);
        const altered = structuredClone(proposal);
        altered.continuation!.prerequisites = [];
        assert.notEqual(approvalHash(proposal, proposal.objects[0]), approvalHash(altered, altered.objects[0]));
        await f.store.exclusive(() => f.store.put(altered));
        assert.equal((await f.service.apply(proposal.id)).status, 'CONFLICTED');
        const downgraded = structuredClone(proposal);
        downgraded.schema = 1;
        await f.store.exclusive(() => f.store.put(downgraded));
        await assert.rejects(f.store.get(proposal.id), /schema 2/);
        assert.deepEqual(f.writes, ['A', 'B']);
    } finally { await f.close(); }
});

test('remaining work respects plan review and excludes rejected objects', async () => {
    const f = await fixture();
    try {
        let set = await f.service.create('Planned partial', 'oracle:LAB', undefined, undefined, 'Review this approach');
        set = await f.service.reviewPlan(set.id, 'APPROVED', set.revision);
        for (const key of ['A', 'B', 'C', 'REJECTED']) set = await f.service.stage(set.id, 'fixture', key, { text: key });
        set = await f.service.validate(set.id);
        set = await f.service.review(set.id, set.objects.map(c => c.id), 'APPROVED', set.revision);
        set = await f.service.review(set.id, [set.objects[3].id], 'REJECTED', set.revision);
        f.fail('B', true);
        await f.service.apply(set.id);
        await f.service.recover(set.id);
        let proposal = await f.service.prepareRemaining(set.id);
        assert.deepEqual(proposal.objects.map(c => c.key), ['C']);
        assert.equal(proposal.plan?.review, 'PENDING');
        assert.equal(proposal.plan?.approvedHash, undefined);
        await assert.rejects(f.service.validate(proposal.id), /separate developer plan approval/);
        proposal = await f.service.reviewPlan(proposal.id, 'APPROVED', proposal.revision);
        assert.equal((await f.service.validate(proposal.id)).status, 'READY_FOR_REVIEW');
        await f.service.cancel(proposal.id);
        assert.notEqual((await f.service.prepareRemaining(set.id)).id, proposal.id, 'cancelled proposal may be replaced with a fresh one');
        assert.deepEqual(f.writes, ['A', 'B']);
    } finally { await f.close(); }
});

test('prerequisites are inherited when a continuation is itself interrupted', async () => {
    const f = await fixture();
    try {
        const set = await partialChain(f);
        await f.service.recover(set.id);
        let proposal = await f.service.prepareRemaining(set.id);
        proposal = await f.service.validate(proposal.id);
        proposal = await f.service.review(proposal.id, proposal.objects.map(c => c.id), 'APPROVED', proposal.revision);
        f.fail('');
        const write = f.adapter.write;
        f.adapter.write = async (e, key, after, baseline) => {
            await write(e, key, after, baseline);
            if (key === 'C') await f.service.cancel(proposal.id);
        };
        assert.equal((await f.service.apply(proposal.id)).status, 'PARTIALLY_APPLIED');
        assert.deepEqual(f.writes, ['A', 'B', 'C']);
        const next = await f.service.prepareRemaining(proposal.id);
        assert.deepEqual(next.objects.map(c => c.key), ['D']);
        assert.deepEqual(next.continuation?.prerequisites.map(p => p.key), ['A', 'B', 'C']);
        f.live.get('A')!.token = 'external-resave';
        assert.equal((await f.service.validate(next.id)).status, 'CONFLICTED');
        assert.deepEqual(f.writes, ['A', 'B', 'C']);
    } finally { await f.close(); }
});
test('prerequisite drift during a writer stops later writes or final completion', async () => {
    for (const changedDuring of ['C', 'D']) {
        const f = await fixture();
        try {
            const set = await partialChain(f);
            await f.service.recover(set.id);
            let proposal = await f.service.prepareRemaining(set.id);
            proposal = await f.service.validate(proposal.id);
            proposal = await f.service.review(proposal.id, proposal.objects.map(c => c.id), 'APPROVED', proposal.revision);
            f.fail('');
            const write = f.adapter.write;
            f.adapter.write = async (e, key, after, baseline) => {
                await write(e, key, after, baseline);
                if (key === changedDuring) f.live.get('A')!.token = 'concurrent-change';
            };
            const stopped = await f.service.apply(proposal.id);
            assert.equal(stopped.status, 'PARTIALLY_APPLIED');
            assert.deepEqual(f.writes, changedDuring === 'C' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D']);
            await assert.rejects(f.service.recover(proposal.id), /prerequisite changed/);
        } finally { await f.close(); }
    }
});
test('object timeline distinguishes proposals, verified readback, token drift and unavailable environments without writes', async () => {
    const f = await fixture();
    try {
        const staged = await ready(f), objectId = staged.objects[0].id;
        let timeline = await f.service.objectTimeline(staged.id, objectId);
        assert.equal(timeline.live.status, 'NOT_CHECKED');
        assert.equal(timeline.baseline.snapshot, hash(null));
        assert.equal(timeline.revisions.length, 0);
        assert.equal(timeline.proposals.length, 1);
        assert.equal((await f.service.objectTimeline(staged.id, objectId, true)).live.matched, 'baseline');
        assert.deepEqual(f.writes, []);
        const applied = await f.service.apply(staged.id);
        const recorded = canonical(await f.store.get(staged.id));
        timeline = await f.service.objectTimeline(staged.id, objectId, true);
        assert.equal(timeline.revisions.length, 1);
        assert.equal(timeline.proposals.length, 0);
        assert.equal(timeline.revisions[0].continuity, 'MATCHES_PREVIOUS');
        assert.equal(timeline.live.status, 'MATCHES_RECORDED');
        assert.equal(timeline.live.matched, timeline.revisions[0].id);
        assert.equal(canonical(await f.store.get(staged.id)), recorded, 'live history checks must not alter review or application state');
        f.live.get('A')!.token = 'external-resave';
        assert.equal((await f.service.objectTimeline(staged.id, objectId, true)).live.status, 'TOKEN_CHANGED');
        f.live.set('A', { value: { text: 'external edit' }, token: 'external-edit' });
        assert.equal((await f.service.objectTimeline(staged.id, objectId, true)).live.status, 'DIVERGED');
        f.setTarget({ ...applied.environment, identity: 'different-schema' });
        let reads = 0;
        f.adapter.read = async () => { reads++; throw new Error('must not read another environment'); };
        assert.equal((await f.service.objectTimeline(staged.id, objectId)).live.status, 'NOT_CHECKED');
        assert.equal((await f.service.objectTimeline(staged.id, objectId, true)).live.status, 'UNAVAILABLE');
        assert.equal(reads, 0);
        assert.deepEqual(f.writes, ['A']);
    } finally { await f.close(); }
});

test('timeline retains reversal/manual history and marks unrecorded gaps instead of inventing continuity', async () => {
    const f = await fixture();
    try {
        const applied = await f.service.apply((await ready(f)).id);
        let inverse = await f.service.reverse(applied.id);
        inverse = await f.service.validate(inverse.id);
        inverse = await f.service.review(inverse.id, inverse.objects.map(c => c.id), 'APPROVED', inverse.revision, true);
        await f.service.apply(inverse.id);
        let timeline = await f.service.objectTimeline(applied.id, applied.objects[0].id, true);
        assert.equal(timeline.revisions.length, 2);
        assert.equal(timeline.revisions.find(r => r.changeSetId === applied.id)?.status, 'REVERTED');
        assert.equal(timeline.revisions.find(r => r.changeSetId === inverse.id)?.reverses, applied.id);
        assert.equal(timeline.live.matched, timeline.revisions.find(r => r.changeSetId === inverse.id)?.id);
        f.live.set('A', { value: { text: 'external edit before manual save' }, token: 'outside' });
        await f.service.captureManual('oracle:LAB', 'fixture', 'A', async () => f.live.set('A', { value: { text: 'manual' }, token: 'manual-token' }));
        timeline = await f.service.objectTimeline(applied.id, applied.objects[0].id, true);
        const manual = timeline.revisions.find(r => r.origin === 'manual');
        assert.ok(manual);
        assert.equal(manual.continuity, 'GAP');
        assert.equal(timeline.live.matched, manual.id);
        assert.equal((await new ReviewService(new ReviewStore(f.root), { environment: async () => applied.environment, changed() {} }, [f.adapter]).objectTimeline(applied.id, applied.objects[0].id)).revisions.length, 3);
    } finally { await f.close(); }
});

test('timeline scopes canonical keys to one environment and includes only verified objects from partial applications', async () => {
    const f = await fixture();
    try {
        const set = await ready(f, ['A', 'B', 'C']);
        f.fail('B', true);
        const partial = await f.service.apply(set.id);
        const all = await f.store.list();
        assert.equal(partial.status, 'PARTIALLY_APPLIED');
        assert.equal((await f.service.objectTimeline(set.id, set.objects[0].id)).revisions.length, 1);
        const uncertain = await f.service.objectTimeline(set.id, set.objects[1].id);
        assert.equal(uncertain.revisions.length, 0);
        assert.equal(uncertain.proposals[0].application, 'UNCERTAIN');
        const canonicalSet = structuredClone(all[0]);
        canonicalSet.objects[0].key = { type: 8, parts: ['A', 'B', 'C'] };
        const otherEnvironment = structuredClone(canonicalSet);
        otherEnvironment.environment.identity = 'other-database';
        const otherConnection = structuredClone(canonicalSet);
        otherConnection.environment.connection = 'oracle:OTHER';
        const timeline = buildObjectTimeline([canonicalSet, otherEnvironment, otherConnection], set.environment, 'fixture', { parts: ['A', 'B', 'C'], type: 8 });
        assert.equal(timeline.revisions.length, 1);
        assert.equal(timeline.proposals.length, 0);
        assert.throws(() => buildObjectTimeline(all, set.environment, 'another-adapter', 'A'), /No retained history/);
    } finally { await f.close(); }
});
test('staging/restart/review has no persistence; new and deleted objects have real null sides', async () => {
    const f = await fixture();
    try {
        const s = await ready(f);
        assert.deepEqual(f.writes, []);
        const reopened = await new ReviewStore(f.root).get(s.id);
        assert.equal(reopened.status, 'APPROVED');
        const diff = await f.service.diff(s.id, s.objects[0].id);
        assert.equal(diff.before, null);
        assert.equal(diff.object.operation, 'CREATE');
        const result = await f.service.apply(s.id);
        assert.equal(result.status, 'APPLIED');
        assert.deepEqual(f.writes, ['A']);
        assert.ok(result.checkpoint);
        let deletion = await f.service.create('Delete', 'oracle:LAB');
        deletion = await f.service.stage(deletion.id, 'fixture', 'A', null);
        deletion = await f.service.validate(deletion.id);
        await assert.rejects(f.service.review(deletion.id, [deletion.objects[0].id], 'APPROVED', deletion.revision), /destructive/);
        deletion = await f.service.review(deletion.id, [deletion.objects[0].id], 'APPROVED', deletion.revision, true);
        assert.equal((await f.service.apply(deletion.id)).status, 'APPLIED');
        assert.equal(f.live.get('A')?.value, null);
    }
    finally {
        await f.close();
    }
});
test('revising an approved object invalidates every approval and stale review UI cannot approve it', async () => {
    const f = await fixture();
    try {
        const s = await ready(f);
        const revised = await f.service.stage(s.id, 'fixture', 'A', { text: 'changed' }, [], s.objects[0].id);
        assert.equal(revised.status, 'DRAFT');
        assert.equal(revised.objects[0].review, 'PENDING');
        assert.equal(revised.objects[0].approvedHash, undefined);
        await assert.rejects(f.service.apply(s.id), /approved/);
        await f.service.validate(s.id);
        await assert.rejects(f.service.review(s.id, [s.objects[0].id], 'APPROVED', s.revision), /stale/);
    }
    finally {
        await f.close();
    }
});
test('five-object dependency order and rejected dependency eligibility', async () => {
    const f = await fixture();
    try {
        let set = await f.service.create('five', 'oracle:LAB');
        let dep: string | undefined;
        for (const key of ['A', 'B', 'C', 'D', 'E']) {
            set = await f.service.stage(set.id, 'fixture', key, { value: key }, dep ? [dep] : []);
            dep = set.objects.at(-1)!.id;
        }
        set = await f.service.validate(set.id);
        set = await f.service.review(set.id, set.objects.map(c => c.id), 'APPROVED', set.revision);
        const rejected = await f.service.review(set.id, [set.objects[0].id], 'REJECTED', set.revision);
        assert.ok(rejected.objects.every(c => c.review === 'REJECTED'));
        assert.deepEqual(f.writes, []);
        let retry = await ready(f, ['1', '2', '3', '4', '5']);
        for (let i = 1; i < retry.objects.length; i++)
            retry = await f.service.stage(retry.id, 'fixture', String(i + 1), { text: 'new ' + (i + 1) }, [retry.objects[i - 1].id]);
        retry = await f.service.validate(retry.id);
        retry = await f.service.review(retry.id, retry.objects.map(c => c.id), 'APPROVED', retry.revision);
        assert.equal((await f.service.apply(retry.id)).status, 'APPLIED');
        assert.deepEqual(f.writes, ['1', '2', '3', '4', '5']);
    }
    finally {
        await f.close();
    }
});
test('live drift, environment change, readonly/policy blocks and invalid proposals prevent writes', async () => {
    for (const mode of ['drift', 'environment', 'policy', 'invalid']) {
        const f = await fixture();
        try {
            const s = await ready(f);
            if (mode === 'drift')
                f.live.set('A', { value: { text: 'external' }, token: '99' });
            if (mode === 'environment')
                f.setTarget({ connection: 'oracle:LAB', identity: 'other', label: 'LAB' });
            if (mode === 'policy')
                f.readonly();
            if (mode === 'invalid') {
                await f.service.stage(s.id, 'fixture', 'A', { invalid: true });
                assert.equal((await f.service.validate(s.id)).status, 'CONFLICTED');
            }
            else
                assert.equal((await f.service.apply(s.id)).status, 'CONFLICTED');
            assert.deepEqual(f.writes, []);
        }
        finally {
            await f.close();
        }
    }
});
test('midway failure stops dependent writes, journals uncertainty and reconciles a committed result', async () => {
    const f = await fixture();
    try {
        const s = await ready(f, ['A', 'B', 'C']);
        f.fail('B', true);
        const result = await f.service.apply(s.id);
        assert.equal(result.status, 'PARTIALLY_APPLIED');
        assert.deepEqual(f.writes, ['A', 'B']);
        assert.equal(result.objects[1].application, 'UNCERTAIN');
        await assert.rejects(f.service.apply(s.id), /approved/);
        const recovered = await f.service.recover(s.id);
        assert.equal(recovered.objects[1].application, 'VERIFIED');
        assert.equal(recovered.status, 'PARTIALLY_APPLIED');
        assert.equal(recovered.objects[2].application, 'PENDING');
    }
    finally {
        await f.close();
    }
});
test('interrupted apply reconciles live results without replay; duplicate apply never writes twice', async () => {
    const f = await fixture();
    try {
        const s = await ready(f);
        const applied = await f.service.apply(s.id);
        await assert.rejects(f.service.apply(s.id));
        assert.deepEqual(f.writes, ['A']);
        applied.status = 'APPLYING';
        applied.objects[0].application = 'APPLYING';
        await f.store.exclusive(() => f.store.put(applied));
        assert.equal((await f.service.recover(s.id)).status, 'APPLIED');
        assert.deepEqual(f.writes, ['A']);
    }
    finally {
        await f.close();
    }
});
test('checkpoint reversal, redo, and external modification conflicts', async () => {
    const f = await fixture();
    try {
        f.live.set('A', { value: { text: 'baseline' }, token: '1' });
        const s = await ready(f);
        await f.service.apply(s.id);
        let reverse = await f.service.reverse(s.id);
        assert.equal(reverse.origin, 'reversal');
        assert.equal(reverse.status, 'DRAFT');
        assert.deepEqual(f.writes, ['A']);
        reverse = await f.service.validate(reverse.id);
        reverse = await f.service.review(reverse.id, reverse.objects.map(c => c.id), 'APPROVED', reverse.revision);
        assert.equal((await f.service.apply(reverse.id)).status, 'APPLIED');
        assert.deepEqual(f.live.get('A')?.value, { text: 'baseline' });
        let redo = await f.service.reverse(reverse.id, true);
        redo = await f.service.validate(redo.id);
        redo = await f.service.review(redo.id, redo.objects.map(c => c.id), 'APPROVED', redo.revision);
        await f.service.apply(redo.id);
        assert.deepEqual(f.live.get('A')?.value, { text: 'new A' });
        f.live.set('A', { value: { text: 'another developer' }, token: '99' });
        await assert.rejects(f.service.reverse(redo.id), /changed/);
    }
    finally {
        await f.close();
    }
});
test('snapshot corruption, metadata corruption, secrets and concurrent store writers fail closed', async () => {
    const f = await fixture();
    try {
        const s = await ready(f);
        const blob = s.objects[0].after;
        await fs.writeFile(path.join(f.root, 'blobs', blob + '.json'), 'null');
        await assert.rejects(f.store.get(s.id), /integrity/);
        await assert.rejects(f.store.exclusive(() => f.store.exclusive(async () => { })), /locked/);
        assert.throws(() => privacy({ password: 'do not persist' }));
        assert.throws(() => privacy({ text: 'https://user:password@example.com' }));
        assert.throws(() => canonical({ bad: undefined }));
        assert.deepEqual(differences(['a', 'b'], ['b', 'a']).map(d => d.kind), ['MOVE', 'MOVE']);
        assert.equal(differences([{ id: 1 }], [{ id: 2 }])[0].kind, 'AMBIGUOUS');
        assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
    }
    finally {
        await f.close();
    }
});
test('manual editor saves capture durable before/after history, and interrupted results remain unknown', async () => {
    const f = await fixture();
    try {
        f.live.set('A', { value: { text: 'before manual save' }, token: '1' });
        const result = await f.service.captureManual('oracle:LAB', 'fixture', 'A', async () => { f.live.set('A', { value: { text: 'manual save' }, token: '2' }); return 'saved'; });
        assert.equal(result, 'saved');
        const [record] = await f.store.list();
        assert.equal(record.origin, 'manual');
        assert.equal(record.status, 'APPLIED');
        assert.equal(record.objects[0].resultKnown, true);
        assert.deepEqual(await f.store.readBlob(record.objects[0].before), { text: 'before manual save' });
        await assert.rejects(f.service.captureManual('oracle:LAB', 'fixture', 'B', async () => { throw new Error('connection lost after possible commit'); }));
        const uncertain = (await f.store.list()).find(s => s.status === 'PARTIALLY_APPLIED')!;
        assert.equal(uncertain.objects[0].resultKnown, false);
        assert.equal((await f.service.recover(uncertain.id)).status, 'PARTIALLY_APPLIED');
    }
    finally {
        await f.close();
    }
});
test('history never gates a manual save: unrecordable saves still run once, a failed readback still returns the result', async () => {
    const f = await fixture();
    const read = f.adapter.read;
    const warn = console.warn;
    console.warn = () => undefined;
    try {
        // History cannot start (the before-read fails): the save runs once, unrecorded.
        let calls = 0;
        f.adapter.read = async () => { throw new Error('history read failed'); };
        assert.equal(await f.service.captureManual('oracle:LAB', 'fixture', 'C', async () => { calls++; return 'saved'; }), 'saved');
        assert.equal(calls, 1);
        assert.equal((await f.store.list()).length, 0);
        // The save succeeds but its readback fails: the result stands; the record stays uncertain.
        let reads = 0;
        f.adapter.read = async (e, key) => { if (++reads > 1) throw new Error('readback failed'); return read(e, key); };
        assert.equal(await f.service.captureManual('oracle:LAB', 'fixture', 'D', async () => { calls++; return 'saved again'; }), 'saved again');
        assert.equal(calls, 2);
        const [record] = await f.store.list();
        assert.equal(record.status, 'PARTIALLY_APPLIED');
        assert.equal(record.objects[0].resultKnown, false);
        assert.ok(record.journal.some((j) => j.action === 'MANUAL_SAVE_READBACK_FAILED'));
    }
    finally {
        f.adapter.read = read;
        console.warn = warn;
        await f.close();
    }
});
test('abandoned lock can be reclaimed without replay; unknown lock owners and stale supplied tokens are refused', async () => {
    const f = await fixture();
    try {
        await f.store.init();
        await fs.writeFile(path.join(f.root, 'writer.lock'), '2147483646');
        const set = await f.service.create('After restart', 'oracle:LAB');
        assert.equal(set.status, 'DRAFT');
        await assert.rejects(f.service.stage(set.id, 'fixture', 'A', { text: 'new' }, [], undefined, 'outdated'), /Stale/);
        await fs.writeFile(path.join(f.root, 'writer.lock'), 'unknown owner');
        await assert.rejects(f.service.create('blocked', 'oracle:LAB'), /Unknown lock/);
    }
    finally {
        await f.close();
    }
});
test('MCP request retries and identical staged retries preserve identity and exact approvals', async () => {
    const f = await fixture();
    try {
        const a = await f.service.create('retry', 'oracle:LAB', 'agent-session', 'request-1');
        const b = await f.service.create('retry', 'oracle:LAB', 'agent-session', 'request-1');
        assert.equal(a.id, b.id);
        await assert.rejects(f.service.create('different', 'oracle:LAB', 'agent-session', 'request-1'), /Idempotency/);
        let s = await f.service.stage(a.id, 'fixture', 'A', { text: 'hello' });
        s = await f.service.validate(s.id);
        s = await f.service.review(s.id, [s.objects[0].id], 'APPROVED', s.revision);
        const retried = await f.service.stage(s.id, 'fixture', 'A', { text: 'hello' });
        assert.equal(retried.revision, s.revision);
        assert.equal(retried.objects[0].approvedHash, s.objects[0].approvedHash);
    }
    finally {
        await f.close();
    }
});
test('plan approval is separate from concrete approval and a revised plan requires re-review', async () => {
    const f = await fixture();
    try {
        let s = await f.service.create('planned', 'oracle:LAB', 'session', 'plan-request', 'Prefer custom SQL definitions.');
        await assert.rejects(f.service.stage(s.id, 'fixture', 'A', { text: 'new' }), /separate/);
        s = await f.service.reviewPlan(s.id, 'APPROVED', s.revision);
        s = await f.service.stage(s.id, 'fixture', 'A', { text: 'new' });
        assert.equal(s.plan?.review, 'APPROVED');
        assert.equal(s.objects[0].review, 'PENDING');
        s = await f.service.validate(s.id);
        s = await f.service.review(s.id, [s.objects[0].id], 'APPROVED', s.revision);
        s = await f.service.revisePlan(s.id, 'A different implementation approach.');
        assert.equal(s.objects[0].review, 'PENDING');
        assert.equal(s.plan?.review, 'PENDING');
        await assert.rejects(f.service.validate(s.id), /separate/);
        const retry = await f.service.create('planned', 'oracle:LAB', 'session', 'plan-request', 'Prefer custom SQL definitions.');
        assert.equal(retry.id, s.id);
    }
    finally {
        await f.close();
    }
});
test('cancellation stops after the current writer and never executes the remaining objects', async () => {
    const f = await fixture();
    try {
        const originalWrite = f.adapter.write;
        f.adapter.write = async (...args) => { await originalWrite(...args); await f.service.cancel(currentId); };
        const set = await ready(f, ['A', 'B']);
        const currentId = set.id;
        const result = await f.service.apply(set.id);
        assert.equal(result.status, 'PARTIALLY_APPLIED');
        assert.deepEqual(f.writes, ['A']);
        assert.equal(result.objects[1].application, 'PENDING');
    }
    finally {
        await f.close();
    }
});
test('validation interrupted by restart can be explicitly rerun without replaying a write', async () => {
    const f = await fixture();
    try {
        const set = await f.service.create('interrupted validation', 'oracle:LAB');
        await f.service.stage(set.id, 'fixture', 'A', { text: 'value' });
        const interrupted = await f.store.get(set.id);
        interrupted.status = 'VALIDATING';
        await f.store.exclusive(() => f.store.put(interrupted));
        assert.equal((await f.service.validate(set.id)).status, 'READY_FOR_REVIEW');
        assert.deepEqual(f.writes, []);
    }
    finally {
        await f.close();
    }
});
test('changed policy/operator authorization stamp invalidates exact revision approval', async () => {
    const f = await fixture();
    try {
        let authorization = 'original operator/policy';
        f.adapter.authorizationState = async () => authorization;
        const set = await ready(f);
        authorization = 'changed operator/policy';
        assert.equal((await f.service.apply(set.id)).status, 'CONFLICTED');
        assert.deepEqual(f.writes, []);
    }
    finally {
        await f.close();
    }
});
