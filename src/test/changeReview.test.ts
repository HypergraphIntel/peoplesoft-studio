import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReviewStore } from '../changeReview/store.js';
import { ReviewService, type ReviewAdapter } from '../changeReview/service.js';
import { buildObjectTimeline } from '../changeReview/timeline.js';
import { completedFollowUp, reviewList } from '../changeReview/navigation.js';
import { approvalHash, canonical, differences, hash, privacy, reviewStateToken, reviewEligibleIds, type Environment, type Json } from '../changeReview/model.js';
import { isHeaderOnlyRequest } from '../changeReview/structuredHeaders.js';
import { isStageablePageRequest } from '../model/pageOperations.js';
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

test('combined approval/application keeps exact hashes, checkpoints and dependency order under one lock', async () => {
    const f = await fixture();
    try {
        let set = await f.service.create('Combined', 'oracle:LAB');
        set = await f.service.stage(set.id, 'fixture', 'A', { text: 'A' });
        set = await f.service.stage(set.id, 'fixture', 'B', { text: 'B' }, [set.objects[0].id]);
        set = await f.service.validate(set.id);
        const rendered = reviewStateToken(set), exclusive = f.store.exclusive.bind(f.store);
        let locks = 0;
        f.store.exclusive = async fn => { locks++; return exclusive(fn); };
        const result = await f.service.approveAndApply(set.id, reviewEligibleIds(set), set.revision, rendered);
        assert.equal(locks, 1);
        assert.equal(result.status, 'APPLIED');
        assert.deepEqual(f.writes, ['A', 'B']);
        assert.equal(result.checkpoint?.objects.length, 2);
        assert.ok(result.objects.every(c => c.approvedHash === approvalHash(result, c) && c.application === 'VERIFIED' && c.verified === c.after));
        assert.ok(result.journal.some(e => e.action === 'APPROVE_AND_APPLY_REQUESTED' && e.detail === rendered));
        assert.equal(result.journal.filter(e => e.action === 'APPROVED').length, 1);
        await assert.rejects(f.service.approveAndApply(set.id, reviewEligibleIds(set), set.revision, rendered), /stale/);
        assert.deepEqual(f.writes, ['A', 'B']);
    } finally { await f.close(); }
});

test('combined action refuses changed revision, same-revision review state and forged object selections', async () => {
    const f = await fixture();
    try {
        let set = await f.service.create('Exact selection', 'oracle:LAB');
        for (const key of ['A', 'B']) set = await f.service.stage(set.id, 'fixture', key, { text: key });
        set = await f.service.validate(set.id);
        const rendered = reviewStateToken(set), ids = reviewEligibleIds(set);
        for (const selection of [[], [ids[0]], [...ids, ids[0]], [ids[1], ids[0]], [...ids, 'foreign']]) {
            await assert.rejects(f.service.approveAndApply(set.id, selection, set.revision, rendered), /exactly the displayed/);
        }
        await assert.rejects(f.service.approveAndApply(set.id, ids, set.revision - 1, rendered), /stale/);
        await assert.rejects(f.service.approveAndApply(set.id, ids, set.revision, ''), /current rendered/);
        const rejected = await f.service.review(set.id, [ids[0]], 'REJECTED', set.revision);
        assert.equal(rejected.revision, set.revision);
        await assert.rejects(f.service.approveAndApply(set.id, ids, set.revision, rendered), /stale/);
        const result = await f.service.approveAndApply(rejected.id, reviewEligibleIds(rejected), rejected.revision, reviewStateToken(rejected));
        assert.deepEqual(f.writes, ['B']);
        assert.equal(result.objects[0].review, 'REJECTED');
        assert.equal(result.objects[0].application, 'PENDING');
    } finally { await f.close(); }
});

test('rejected prerequisites and their pending transitive dependents stay excluded from the combined action', async () => {
    const f = await fixture();
    try {
        let set = await f.service.create('Exclusions', 'oracle:LAB');
        set = await f.service.stage(set.id, 'fixture', 'A', { text: 'A' });
        set = await f.service.stage(set.id, 'fixture', 'B', { text: 'B' }, [set.objects[0].id]);
        set = await f.service.stage(set.id, 'fixture', 'C', { text: 'C' }, [set.objects[1].id]);
        set = await f.service.stage(set.id, 'fixture', 'D', { text: 'D' });
        set = await f.service.validate(set.id);
        set = await f.service.review(set.id, [set.objects[0].id], 'REJECTED', set.revision);
        assert.deepEqual(reviewEligibleIds(set), [set.objects[3].id]);
        const result = await f.service.approveAndApply(set.id, reviewEligibleIds(set), set.revision, reviewStateToken(set));
        assert.equal(result.status, 'APPLIED'); assert.deepEqual(f.writes, ['D']);
        assert.ok(result.objects.slice(0, 3).every(c => c.application === 'PENDING' && c.review !== 'APPROVED'));
    } finally { await f.close(); }
});

test('combined action cannot approve an approach, skip validation or omit destructive approval', async () => {
    const f = await fixture();
    try {
        let planned = await f.service.create('Plan', 'oracle:LAB', undefined, undefined, 'Review approach first.');
        await assert.rejects(f.service.approveAndApply(planned.id, [], planned.revision, reviewStateToken(planned)), /separate developer plan approval/);
        planned = await f.service.reviewPlan(planned.id, 'APPROVED', planned.revision);
        planned = await f.service.stage(planned.id, 'fixture', 'A', { text: 'A' });
        await assert.rejects(f.service.approveAndApply(planned.id, reviewEligibleIds(planned), planned.revision, reviewStateToken(planned)), /Validate before review/);
        planned = await f.service.validate(planned.id);
        assert.equal((await f.service.approveAndApply(planned.id, reviewEligibleIds(planned), planned.revision, reviewStateToken(planned))).status, 'APPLIED');
        let deletion = await f.service.create('Delete', 'oracle:LAB');
        deletion = await f.service.stage(deletion.id, 'fixture', 'A', null);
        deletion = await f.service.validate(deletion.id);
        await assert.rejects(f.service.approveAndApply(deletion.id, reviewEligibleIds(deletion), deletion.revision, reviewStateToken(deletion)), /destructive/);
        assert.equal((await f.store.get(deletion.id)).objects[0].review, 'PENDING');
        assert.equal((await f.service.approveAndApply(deletion.id, reviewEligibleIds(deletion), deletion.revision, reviewStateToken(deletion), true)).status, 'APPLIED');
    } finally { await f.close(); }
});

test('combined action repeats drift, validation, policy, identity and exact writer preflight gates', async () => {
    for (const gate of ['drift', 'validation', 'policy', 'identity', 'authorization']) {
        const f = await fixture();
        try {
            let stamp = 'initial'; f.adapter.authorizationState = async () => stamp;
            let set = await f.service.create('Gates', 'oracle:LAB');
            set = await f.service.stage(set.id, 'fixture', 'A', { text: 'A' });
            set = await f.service.validate(set.id);
            if (gate === 'drift') f.live.set('A', { value: { text: 'someone else' }, token: 'changed' });
            if (gate === 'validation') f.adapter.validate = async () => ['new validation finding'];
            if (gate === 'policy') f.readonly();
            if (gate === 'identity') f.setTarget({ ...set.environment, identity: 'other database' });
            if (gate === 'authorization') stamp = 'changed';
            const result = await f.service.approveAndApply(set.id, reviewEligibleIds(set), set.revision, reviewStateToken(set));
            assert.equal(result.status, 'CONFLICTED', gate); assert.deepEqual(f.writes, []);
            assert.ok(result.journal.some(e => e.action === 'APPLICATION_STOPPED'));
        } finally { await f.close(); }
    }
});

test('combined action preserves partial/uncertain results and never replays a writer after failure', async () => {
    const f = await fixture();
    try {
        let set = await f.service.create('Partial', 'oracle:LAB');
        for (const key of ['A', 'B', 'C']) set = await f.service.stage(set.id, 'fixture', key, { text: key });
        set = await f.service.validate(set.id); f.fail('B', true);
        const result = await f.service.approveAndApply(set.id, reviewEligibleIds(set), set.revision, reviewStateToken(set));
        assert.equal(result.status, 'PARTIALLY_APPLIED');
        assert.deepEqual(result.objects.map(c => c.application), ['VERIFIED', 'UNCERTAIN', 'PENDING']);
        await assert.rejects(f.service.approveAndApply(result.id, reviewEligibleIds(result), result.revision, reviewStateToken(result)), /Validate before review/);
        assert.deepEqual(f.writes, ['A', 'B']);
    } finally { await f.close(); }
});

test('apply checks the page revision/state again inside its store lock', async () => {
    const f = await fixture();
    try {
        const approved = await ready(f), token = reviewStateToken(approved);
        const set = await f.service.stage(approved.id, 'fixture', 'A', { text: 'new revision' }, [], approved.objects[0].id);
        await assert.rejects(f.service.apply(set.id, false, approved.revision, token), /stale/);
        await f.service.validate(set.id);
        await assert.rejects(f.service.review(set.id, [set.objects[0].id], 'APPROVED', set.revision, false, token), /stale/);
        assert.deepEqual(f.writes, []);
    } finally { await f.close(); }
});

test('combined application holds the lock against revisions/duplicate clicks and still accepts cancellation', async () => {
    const f = await fixture();
    let release!: () => void;
    try {
        let entered!: () => void;
        const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
        const write = f.adapter.write;
        f.adapter.write = async (...args) => { entered(); await gate; return write(...args); };
        let set = await f.service.create('Concurrent actions', 'oracle:LAB');
        for (const key of ['A', 'B']) set = await f.service.stage(set.id, 'fixture', key, { text: key });
        set = await f.service.validate(set.id);
        const pending = f.service.approveAndApply(set.id, reviewEligibleIds(set), set.revision, reviewStateToken(set));
        await started;
        await assert.rejects(f.service.approveAndApply(set.id, reviewEligibleIds(set), set.revision, reviewStateToken(set)), /locked/);
        await assert.rejects(f.service.stage(set.id, 'fixture', 'C', { text: 'unreviewed' }), /locked/);
        await f.service.cancel(set.id); release();
        const result = await pending;
        assert.equal(result.status, 'PARTIALLY_APPLIED');
        assert.deepEqual(f.writes, ['A']);
        assert.deepEqual(result.objects.map(c => c.application), ['VERIFIED', 'PENDING']);
    } finally { release?.(); await f.close(); }
});
test('proposal validation sees only declared transitive dependencies; apply validates live verified prerequisites', async () => {
    const f = await fixture();
    try {
        const phases: string[] = [];
        f.adapter.validate = async (_e, key, _before, _after, context) => {
            if (key === 'C') {
                assert.ok(context);
                phases.push(context.phase);
                if (context.phase === 'proposal') assert.deepEqual(context.dependencies.map(d => d.key), ['A', 'B']);
                else {
                    assert.deepEqual(context.dependencies, []);
                    assert.ok(f.live.has('A') && f.live.has('B'));
                }
            }
            return [];
        };
        let set = await f.service.create('Proposed prerequisite chain', 'oracle:LAB');
        set = await f.service.stage(set.id, 'fixture', 'A', { text: 'state' });
        set = await f.service.stage(set.id, 'fixture', 'UNRELATED', { text: 'excluded' });
        set = await f.service.stage(set.id, 'fixture', 'B', { text: 'sql' }, [set.objects[0].id]);
        set = await f.service.stage(set.id, 'fixture', 'C', { text: 'program' }, [set.objects[2].id]);
        await assert.rejects(f.service.proposedDependencies(set.id, ['foreign-object']), /not part/);
        assert.deepEqual(f.writes, []);
        set = await f.service.validate(set.id);
        assert.equal(set.status, 'READY_FOR_REVIEW');
        assert.deepEqual(f.writes, []);
        set = await f.service.review(set.id, set.objects.map(c => c.id), 'APPROVED', set.revision);
        assert.equal((await f.service.apply(set.id)).status, 'APPLIED');
        assert.deepEqual(phases, ['proposal', 'proposal', 'live']);
    } finally { await f.close(); }
});
test('unversioned drift in a verified prerequisite stops its dependent before writer entry', async () => {
    const f = await fixture();
    try {
        let set = await f.service.create('Dependency drift', 'oracle:LAB');
        set = await f.service.stage(set.id, 'fixture', 'A', { text: 'state' });
        set = await f.service.stage(set.id, 'fixture', 'B', { text: 'intermediate' }, [set.objects[0].id]);
        set = await f.service.stage(set.id, 'fixture', 'C', { text: 'dependent' }, [set.objects[1].id]);
        set = await f.service.validate(set.id);
        set = await f.service.review(set.id, set.objects.map(c => c.id), 'APPROVED', set.revision);
        const write = f.adapter.write;
        f.adapter.write = async (...args) => {
            await write(...args);
            if (args[1] === 'B') f.live.get('A')!.value = { text: 'outside edit without version change' };
        };
        const stopped = await f.service.apply(set.id);
        assert.equal(stopped.status, 'PARTIALLY_APPLIED');
        assert.deepEqual(stopped.objects.map(c => c.application), ['VERIFIED', 'VERIFIED', 'PENDING']);
        assert.deepEqual(f.writes, ['A', 'B']);
        assert.match(stopped.journal.at(-1)!.detail!, /Verified dependency changed/);
    } finally { await f.close(); }
});
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
test('one-object reversal can pause at a verified boundary and still checks every baseline before writing', async () => {
    const f = await fixture();
    try {
        f.live.set('A', { value: { text: 'old' }, token: '1' });
        let set = await ready(f, ['A']);
        assert.equal((await f.service.apply(set.id, true)).status, 'APPLIED');
        let inverse = await f.service.reverse(set.id);
        inverse = await f.service.validate(inverse.id);
        inverse = await f.service.review(inverse.id, inverse.objects.map(c => c.id), 'APPROVED', inverse.revision);
        assert.equal((await f.service.apply(inverse.id, true)).status, 'APPLIED');
        set = await ready(f, ['B', 'C']);
        f.live.set('C', { value: { text: 'outside' }, token: '2' });
        assert.equal((await f.service.apply(set.id, true)).status, 'CONFLICTED');
        assert.deepEqual(f.writes, ['A', 'A']);
    } finally { await f.close(); }
});
test('an adapter reversal refusal blocks the inverse up front with its reason and proposes nothing', async () => {
    const f = await fixture();
    try {
        f.live.set('A', { value: { text: 'old' }, token: '1' });
        f.adapter.reversalRefusal = (key, before, after) => key === 'A' && JSON.stringify(after).includes('new') && JSON.stringify(before).includes('old') ? 'Reversal would delete an added row.' : undefined;
        const set = await ready(f, ['A']);
        const applied = await f.service.apply(set.id);
        assert.equal(applied.status, 'APPLIED');
        assert.deepEqual(await f.service.reversalSupport(applied), { supported: false, reason: 'Reversal would delete an added row.' });
        const before = (await f.store.list()).length;
        await assert.rejects(f.service.reverse(set.id), /Reversal would delete an added row\. No partial reverse proposal created\./);
        assert.equal((await f.store.list()).length, before);
        f.adapter.reversalRefusal = () => undefined;
        assert.equal((await f.service.reversalSupport(applied)).supported, true);
    } finally { await f.close(); }
});
test('an unknown Change Set ID is reported without the storage path', async () => {
    const f = await fixture();
    try {
        await assert.rejects(f.service.store.get('00000000-0000-0000-0000-000000000000'), (e: Error) => e.message === 'Change Set not found: 00000000-0000-0000-0000-000000000000' && !e.message.includes(f.root));
    } finally { await f.close(); }
});
test('validating an empty Change Set is refused without marking it conflicted', async () => {
    const f = await fixture();
    try {
        const set = await f.service.create('Empty', 'oracle:LAB');
        await assert.rejects(f.service.validate(set.id), /Nothing is staged/);
        const saved = await f.service.store.get(set.id);
        assert.equal(saved.status, 'DRAFT'); assert.equal(saved.revision, set.revision);
        assert.deepEqual(saved.journal, set.journal);
        const staged = await f.service.stage(set.id, 'fixture', 'A', { text: 'new A' });
        assert.equal((await f.service.validate(staged.id)).status, 'READY_FOR_REVIEW');
    } finally { await f.close(); }
});
test('a Change Set that conflicted before any write can be cancelled', async () => {
    const f = await fixture();
    try {
        let set = await f.service.create('Conflicted', 'oracle:LAB');
        set = await f.service.stage(set.id, 'fixture', 'B', { text: 'new' });
        f.live.set('B', { value: { text: 'outside' }, token: '9' });
        assert.equal((await f.service.validate(set.id)).status, 'CONFLICTED');
        await f.service.cancel(set.id);
        assert.equal((await f.service.store.get(set.id)).status, 'CANCELLED');
        assert.deepEqual(f.writes, []);
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
        assert.equal((await f.service.reverse(proposal.id)).schema, 3);
    } finally { await f.close(); }
});

test('remaining preparation refuses unknown outcomes, native drift and environment changes without creating a set', async () => {
    for (const mode of ['uncertain', 'confirmed-token', 'pending-content', 'environment']) {
        const f = await fixture();
        try {
            const set = await partialChain(f);
            if (mode === 'uncertain') f.live.set('B', { value: { text: 'outside' }, token: 'unknown' });
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
test('a rolled-back update reconciles its exact original snapshot and token without replay', async () => {
    const f = await fixture();
    try {
        f.live.set('A', { value: { text: 'original' }, token: '7' });
        const set = await ready(f);
        f.fail('A');
        assert.equal((await f.service.apply(set.id)).objects[0].application, 'UNCERTAIN');
        await assert.rejects(f.service.prepareRemaining(set.id), /Reconcile uncertain/);
        const reconciled = await f.service.recover(set.id);
        assert.equal(reconciled.status, 'PARTIALLY_APPLIED');
        assert.equal(reconciled.objects[0].application, 'PENDING');
        assert.ok(reconciled.journal.some(e => e.action === 'BASELINE_CONFIRMED' && e.object === set.objects[0].id));
        assert.deepEqual(f.live.get('A'), { value: { text: 'original' }, token: '7' });
        assert.deepEqual(f.writes, ['A']);
        await assert.rejects(f.service.apply(set.id), /approved/);
        let followup = await f.service.prepareRemaining(set.id);
        assert.equal(followup.objects[0].review, 'PENDING');
        assert.equal(followup.objects[0].approvedHash, undefined);
        await assert.rejects(f.service.apply(followup.id), /approved/);
        f.fail('');
        followup = await f.service.validate(followup.id);
        followup = await f.service.review(followup.id, followup.objects.map(c => c.id), 'APPROVED', followup.revision);
        assert.equal((await f.service.apply(followup.id)).status, 'APPLIED');
        assert.deepEqual(f.writes, ['A', 'A']);
    } finally { await f.close(); }
});
test('baseline recovery refuses content drift, token drift, changed absent scopes and unknown manual results', async () => {
    for (const mode of ['content', 'token', 'create', 'manual']) {
        const f = await fixture();
        try {
            if (mode !== 'create') f.live.set('A', { value: { text: 'original' }, token: '7' });
            const set = await ready(f);
            f.fail('A');
            const failed = await f.service.apply(set.id);
            if (mode === 'content') f.live.set('A', { value: { text: 'outside' }, token: '7' });
            if (mode === 'token') f.live.get('A')!.token = '8';
            if (mode === 'create') f.live.set('A', { value: null, token: 'different-vacancy' });
            if (mode === 'manual') {
                failed.objects[0].resultKnown = false;
                await f.store.exclusive(() => f.store.put(failed));
            }
            const reconciled = await f.service.recover(set.id);
            assert.equal(reconciled.objects[0].application, 'UNCERTAIN');
            assert.ok(!reconciled.journal.some(e => e.action === 'BASELINE_CONFIRMED'));
            await assert.rejects(f.service.prepareRemaining(set.id), /Reconcile uncertain/);
            assert.deepEqual(f.writes, ['A']);
        } finally { await f.close(); }
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
        assert.equal(reverse.title, 'Revert Test change');
        assert.equal(redo.title, 'Redo Test change');
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

test('only bounded header edits stage; a structural Record or App Engine edit takes the legacy write path', () => {
    // The routing question, isolated: staging is for operations this adapter
    // can carry an exact after-state for. Anything else must fall through to
    // the legacy per-write confirmation -- refusing it would leave a
    // structural edit with no route at all, since creation already writes
    // that way and staging cannot represent it.
    assert.equal(isHeaderOnlyRequest('ae', [{ op: 'set_program', comments: 'why this program exists' }]), true);
    assert.equal(isHeaderOnlyRequest('ae', [{ op: 'set_program', description: 'Vendor interface' }]), true);
    assert.equal(isHeaderOnlyRequest('record', [{ op: 'set_properties', description: 'Staging', definition: 'notes' }]), true);

    // Structural: a different op, or the right op carrying more than the header.
    assert.equal(isHeaderOnlyRequest('ae', [{ op: 'set_action', section: 'B_CONTRB', step: 'RESPAY', type: 'PeopleCode', onReturn: 'Break' }]), false);
    assert.equal(isHeaderOnlyRequest('record', [{ op: 'insert_field', field: 'EMPLID' }]), false);
    assert.equal(isHeaderOnlyRequest('ae', [{ op: 'set_program', comments: 'ok', messageSet: 25500 }]), false);

    // A header edit mixed with a structural one is not stageable either.
    assert.equal(isHeaderOnlyRequest('ae', [{ op: 'set_program', comments: 'ok' }, { op: 'rename_step', section: 'INIT', step: 'SETUP', to: 'PREP' }]), false);

    // Nothing to stage is not a header edit.
    assert.equal(isHeaderOnlyRequest('ae', []), false);
    assert.equal(isHeaderOnlyRequest('ae', undefined), false);
    assert.equal(isHeaderOnlyRequest('ae', [null]), false);
});

test('bounded Page edits stage, structural ones included; other properties, a Tree insert and saveInvalid take the legacy write path', () => {
    assert.equal(isStageablePageRequest([{ op: 'move', id: 3, left: 10, top: 20 }], undefined), true);
    assert.equal(isStageablePageRequest([{ op: 'set_use', id: 3, displayOnly: true }], undefined), true);
    assert.equal(isStageablePageRequest([{ op: 'set_properties', description: 'Setup', comments: 'why' }], undefined), true);
    // Inserted (a grid column too) and deleted controls, the tab order and an Edit Box rebind stage exact native proposals.
    assert.equal(isStageablePageRequest([{ op: 'add', kind: 'editBox', left: 0, top: 0, intoGrid: 5 }], undefined), true);
    assert.equal(isStageablePageRequest([{ op: 'delete', id: 1 }], undefined), true);
    assert.equal(isStageablePageRequest([{ op: 'set_order', order: [2, 1] }, { op: 'set_binding', id: 1, record: 'R', field: 'F' }], undefined), true);
    // A Tree's restoration is not supported, so its insert is not stageable.
    assert.equal(isStageablePageRequest([{ op: 'add', kind: 'tree', left: 0, top: 0 }], undefined), false);
    // set_properties carrying more than description/comments, and saveInvalid, are not stageable.
    assert.equal(isStageablePageRequest([{ op: 'set_properties', fluidPage: true }], undefined), false);
    assert.equal(isStageablePageRequest([{ op: 'move', id: 3, left: 0, top: 0 }], true), false);
    assert.equal(isStageablePageRequest([], undefined), false);
    assert.equal(isStageablePageRequest(undefined, undefined), false);
});

test('completed continuation reverses all confirmed checkpoints in dependency order and redo uses fresh approval', async () => {
    const f = await fixture();
    try {
        const source = await partialChain(f);
        await f.service.recover(source.id);
        let continuation = await f.service.prepareRemaining(source.id);
        continuation = await f.service.validate(continuation.id);
        continuation = await f.service.review(continuation.id, continuation.objects.map(c => c.id), 'APPROVED', continuation.revision);
        f.fail(''); continuation = await f.service.apply(continuation.id);
        assert.equal(continuation.status, 'APPLIED');
        assert.equal((await f.service.reversalSupport(continuation)).supported, true);
        let inverse = await f.service.reverse(continuation.id);
        assert.equal(inverse.schema, 3);
        assert.deepEqual(new Set(inverse.reversalSources?.map(s => s.changeSetId)), new Set([source.id, continuation.id]));
        assert.deepEqual(new Set(inverse.objects.map(c => c.key)), new Set(['A','B','C','D']));
        assert.ok(inverse.objects.every(c => c.review === 'PENDING' && !c.approvedHash));
        assert.equal((await new ReviewStore(f.root).get(inverse.id)).schema, 3);
        await assert.rejects(f.service.apply(inverse.id), /approved/);
        inverse = await f.service.validate(inverse.id);
        inverse = await f.service.review(inverse.id, inverse.objects.map(c => c.id), 'APPROVED', inverse.revision, true);
        inverse = await f.service.apply(inverse.id);
        assert.equal(inverse.status, 'APPLIED');
        assert.deepEqual(f.writes, ['A','B','C','D','D','C','B','A']);
        assert.equal((await f.store.get(source.id)).status, 'REVERTED');
        assert.equal((await f.store.get(continuation.id)).status, 'REVERTED');
        assert.ok([...f.live.values()].every(v => v.value === null));
        let redo = await f.service.redo(continuation.id);
        assert.ok(redo.objects.every(c => c.review === 'PENDING' && !c.approvedHash));
        redo = await f.service.validate(redo.id);
        redo = await f.service.review(redo.id, redo.objects.map(c => c.id), 'APPROVED', redo.revision);
        redo = await f.service.apply(redo.id);
        assert.equal(redo.status, 'APPLIED');
        assert.deepEqual(f.writes.slice(-4), ['A','B','C','D']);
        assert.ok([...f.live.values()].every(v => v.value !== null));
    } finally { await f.close(); }
});

test('combined continuation inverse refuses drift, missing deletion support and forged source lineage before writing', async () => {
    const f = await fixture();
    try {
        const source = await ready(f, ['A','B']);
        await f.service.apply(source.id, true);
        let continuation = await f.service.prepareRemaining(source.id);
        continuation = await f.service.validate(continuation.id);
        continuation = await f.service.review(continuation.id, continuation.objects.map(c => c.id), 'APPROVED', continuation.revision);
        continuation = await f.service.apply(continuation.id);
        f.adapter.canDelete = false;
        assert.equal((await f.service.reversalSupport(continuation)).supported, false);
        const count = (await f.store.list()).length;
        await assert.rejects(f.service.reverse(continuation.id), /unsupported deletion/);
        assert.equal((await f.store.list()).length, count);
        f.adapter.canDelete = true;
        const token = f.live.get('A')!.token;
        f.live.get('A')!.token = 'changed';
        await assert.rejects(f.service.reverse(continuation.id), /prerequisite changed/);
        f.live.get('A')!.token = token;
        let inverse = await f.service.reverse(continuation.id);
        const stamped = await f.store.get(inverse.id);
        stamped.reversalSources![0].objects[0].token = 'forged';
        await f.store.put(stamped);
        const conflicted = await f.service.validate(inverse.id);
        assert.equal(conflicted.status, 'CONFLICTED');
        assert.match(conflicted.journal.at(-1)!.detail ?? '', /checkpoint changed/);
        assert.deepEqual(f.writes, ['A','B']);
        inverse.schema = 1;
        await f.store.put(inverse);
        await assert.rejects(f.store.get(inverse.id), /schema 3/);
    } finally { await f.close(); }
});

test('combined reversal reconciliation completes interrupted lineage publication idempotently without replay', async () => {
    const f = await fixture();
    try {
        const source = await ready(f, ['A','B']); await f.service.apply(source.id,true);
        let leaf = await f.service.prepareRemaining(source.id);
        leaf = await f.service.validate(leaf.id); leaf = await f.service.review(leaf.id,leaf.objects.map(o=>o.id),'APPROVED',leaf.revision); leaf = await f.service.apply(leaf.id);
        let inverse = await f.service.reverse(leaf.id); inverse = await f.service.validate(inverse.id);
        inverse = await f.service.review(inverse.id,inverse.objects.map(o=>o.id),'APPROVED',inverse.revision,true);
        const put = f.store.put.bind(f.store); let lose = true;
        f.store.put = async set => { await put(set); if (lose && set.id === source.id && set.status === 'REVERTED') { lose=false; throw new Error('lost history response'); } };
        await f.service.apply(inverse.id);
        const count = f.writes.length, saved = await f.store.get(inverse.id);
        assert.ok(['APPLIED','PARTIALLY_APPLIED'].includes(saved.status));
        // A crash after APPLIED must still let an explicit recovery finish history publication.
        if (saved.status === 'APPLIED') { saved.status='APPLYING'; await put(saved); }
        const recovered = await f.service.recover(inverse.id);
        assert.equal(recovered.status,'APPLIED'); assert.equal(f.writes.length,count);
        assert.equal((await f.store.get(source.id)).status,'REVERTED'); assert.equal((await f.store.get(leaf.id)).status,'REVERTED');
    } finally { await f.close(); }
});

test('creation before commit recovers only an exact absent baseline and needs fresh continuation approval', async () => {
    const f = await fixture();
    try {
        const original = await ready(f); f.fail('A'); await f.service.apply(original.id);
        const recovered = await f.service.recover(original.id);
        assert.equal(recovered.objects[0].application, 'PENDING'); assert.deepEqual(f.writes,['A']);
        let next = await f.service.prepareRemaining(original.id);
        assert.equal(next.objects[0].operation,'CREATE'); assert.equal(next.objects[0].review,'PENDING');
        await assert.rejects(f.service.apply(next.id),/approved/);
        next = await f.service.validate(next.id); next = await f.service.review(next.id,next.objects.map(c=>c.id),'APPROVED',next.revision);
        f.fail(''); assert.equal((await f.service.apply(next.id)).status,'APPLIED'); assert.deepEqual(f.writes,['A','A']);
    } finally { await f.close(); }
});

test('approving only part of an inverse cannot write or mark the original fully reverted', async()=>{
    const f=await fixture();try{
        f.live.set('A',{value:{text:'old A'},token:'1'});f.live.set('B',{value:{text:'old B'},token:'1'});
        const original=await ready(f,['A','B']);await f.service.apply(original.id);
        let inverse=await f.service.reverse(original.id);inverse=await f.service.validate(inverse.id);
        await f.service.review(inverse.id,[inverse.objects[0].id],'APPROVED',inverse.revision);
        await assert.rejects(f.service.apply(inverse.id),/Approve every object/);
        assert.equal((await f.store.get(original.id)).status,'APPLIED');assert.deepEqual(f.writes,['A','B']);
    }finally{await f.close();}
});

test('interrupted combined undo resumes only untouched inverses across repeated failures, then redo restores the whole chain', async () => {
    const f = await fixture();
    try {
        const source = await partialChain(f); await f.service.recover(source.id); f.fail('');
        let forward = await f.service.prepareRemaining(source.id);
        const approve = async (id: string, destructive = false) => {
            const s = await f.service.validate(id); assert.equal(s.status, 'READY_FOR_REVIEW', JSON.stringify(s.journal.at(-1)));
            return f.service.review(id, s.objects.map(c => c.id), 'APPROVED', s.revision, destructive);
        };
        forward = await approve(forward.id); forward = await f.service.apply(forward.id);
        let inverse = await f.service.reverse(forward.id); inverse = await approve(inverse.id, true);
        f.fail('C', true); inverse = await f.service.apply(inverse.id);
        assert.deepEqual(inverse.objects.filter(c => c.application === 'VERIFIED').map(c => c.key), ['D']);
        assert.equal(f.service.remainingSupport(inverse).supported, false);
        const count = f.writes.length;
        inverse = await f.service.recover(inverse.id); assert.equal(f.writes.length, count);
        assert.deepEqual(new Set(inverse.objects.filter(c => c.application === 'VERIFIED').map(c => c.key)), new Set(['C','D']));
        let remaining = await f.service.prepareRemaining(inverse.id);
        assert.equal(remaining.schema, 4); assert.equal((await new ReviewStore(f.root).get(remaining.id)).schema, 4);
        assert.equal(remaining.reverses, forward.id); assert.deepEqual(remaining.reversalSources, inverse.reversalSources);
        assert.deepEqual(new Set(remaining.objects.map(c => c.key)), new Set(['A','B']));
        assert.ok(remaining.objects.every(c => c.review === 'PENDING' && !c.approvedHash));
        await assert.rejects(f.service.apply(remaining.id), /approved/);
        assert.equal((await f.store.get(forward.id)).status, 'APPLIED'); assert.equal((await f.store.get(source.id)).status, 'PARTIALLY_APPLIED');
        remaining = await approve(remaining.id, true); f.fail('A'); remaining = await f.service.apply(remaining.id);
        remaining = await f.service.recover(remaining.id);
        let last = await f.service.prepareRemaining(remaining.id);
        assert.deepEqual(last.objects.map(c => c.key), ['A']); assert.equal(last.continuation?.prerequisites.length, 3);
        last = await approve(last.id, true); f.fail(''); last = await f.service.apply(last.id);
        assert.equal(last.status, 'APPLIED'); assert.equal((await f.store.get(forward.id)).status, 'REVERTED');
        assert.equal((await f.store.get(source.id)).status, 'REVERTED');
        const histories = await f.store.list();
        assert.equal(completedFollowUp(await f.store.get(inverse.id), histories)?.id, last.id);
        assert.equal(completedFollowUp(await f.store.get(remaining.id), histories)?.id, last.id);
        assert.ok(!reviewList(histories, 'pending').some(s => [inverse.id, remaining.id].includes(s.id)));
        assert.deepEqual(f.writes.slice(count), ['B','A','A']); // confirmed C/D are never replayed
        assert.ok([...f.live.values()].every(v => v.value === null));
        let redo = await f.service.redo(source.id);
        assert.equal(redo.objects.length, 4); assert.ok(redo.objects.every(c => c.review === 'PENDING' && !c.approvedHash));
        redo = await approve(redo.id); redo = await f.service.apply(redo.id);
        assert.equal(redo.status, 'APPLIED'); assert.deepEqual(f.writes.slice(-4), ['A','B','C','D']);
        assert.ok([...f.live.values()].every(v => v.value !== null));
    } finally { await f.close(); }
});

test('a paused legacy inverse gains complete forward bindings and cannot drop coverage, alter its target or downgrade its schema', async () => {
    const f = await fixture();
    try {
        const source = await ready(f, ['A','B','C']); await f.service.apply(source.id);
        let inverse = await f.service.reverse(source.id); assert.equal(inverse.schema, 1);
        inverse = await f.service.validate(inverse.id); inverse = await f.service.review(inverse.id, inverse.objects.map(c=>c.id), 'APPROVED', inverse.revision, true);
        inverse = await f.service.apply(inverse.id, true); assert.equal(inverse.status, 'PARTIALLY_APPLIED');
        const remaining = await f.service.prepareRemaining(inverse.id);
        assert.equal(remaining.schema, 4); assert.equal(remaining.reversalSources?.[0].objects.length, 3);
        const persisted = structuredClone(remaining), count = f.writes.length;
        for (const schema of [1,2,3] as const) {
            const changed = structuredClone(persisted); changed.schema = schema; await f.store.put(changed);
            await assert.rejects(f.store.get(changed.id), /schema/);
        }
        for (const change of [
            (s: typeof remaining) => { s.reversalSources![0].objects.pop(); },
            (s: typeof remaining) => { s.reverses = inverse.id; },
            (s: typeof remaining) => { s.continuation!.prerequisites = []; },
            (s: typeof remaining) => { s.objects[0].after = s.objects[0].before; }
        ]) {
            const changed = structuredClone(persisted); change(changed); await f.store.put(changed);
            assert.equal((await f.service.validate(changed.id)).status, 'CONFLICTED'); assert.equal(f.writes.length, count);
        }
        await f.store.put(persisted);
        let next = await f.service.validate(remaining.id); assert.equal(next.status, 'READY_FOR_REVIEW');
        next = await f.service.review(next.id, next.objects.map(c=>c.id), 'APPROVED', next.revision, true);
        f.live.get('A')!.token = 'external-change';
        assert.equal((await f.service.apply(next.id)).status, 'CONFLICTED'); assert.equal(f.writes.length, count);
        assert.equal((await f.store.get(source.id)).status, 'APPLIED');
    } finally { await f.close(); }
});

test('resumed inverse reconciliation completes lost history publication without replaying any inverse', async () => {
    const f = await fixture();
    try {
        const source = await ready(f, ['A','B']); await f.service.apply(source.id);
        let inverse = await f.service.reverse(source.id); inverse = await f.service.validate(inverse.id);
        inverse = await f.service.review(inverse.id, inverse.objects.map(c=>c.id), 'APPROVED', inverse.revision, true);
        await f.service.apply(inverse.id, true);
        let next = await f.service.prepareRemaining(inverse.id); next = await f.service.validate(next.id);
        next = await f.service.review(next.id, next.objects.map(c=>c.id), 'APPROVED', next.revision, true);
        const put = f.store.put.bind(f.store); let fail = true;
        f.store.put = async s => { await put(s); if (s.id === source.id && s.status === 'REVERTED' && fail) { fail = false; throw Error('lost history response'); } };
        await f.service.apply(next.id); const count = f.writes.length;
        const recovered = await f.service.recover(next.id);
        assert.equal(recovered.status, 'APPLIED'); assert.equal(f.writes.length, count);
        assert.equal((await f.store.get(source.id)).status, 'REVERTED');
    } finally { await f.close(); }
});

test('aliased history scopes cannot stage the same native definition twice or rewrite a confirmed prerequisite',async()=>{
 const f=await fixture();try{
  f.adapter.scope=key=>'native:'+String(key);
  const service=new ReviewService(f.store,{environment:async()=>({connection:'oracle:LAB',identity:'database-schema-1',label:'LAB'}),changed(){}},[f.adapter,{...f.adapter,id:'alias'}]);
  let s=await service.create('Aliased scopes','oracle:LAB');s=await service.stage(s.id,'fixture','A',{text:'A'});
  await assert.rejects(service.stage(s.id,'alias','A',{text:'A2'}),/already reviewed/);
  s=await service.stage(s.id,'alias','B',{text:'B'},[s.objects[0].id]);s=await service.validate(s.id);s=await service.review(s.id,s.objects.map(c=>c.id),'APPROVED',s.revision);s=await service.apply(s.id,true);
  const next=await service.prepareRemaining(s.id);
  await assert.rejects(service.stage(next.id,'alias','A',{text:'rewrite verified'}),/already reviewed/);
  assert.deepEqual(f.writes,['A']);
 }finally{await f.close();}
});

test('composite lifecycle scope reserves the owning service against another definition or aliased edit',async()=>{
    const f=await fixture();try{
        const composite={...f.adapter,id:'composite',scopes:(key:Json)=>['operation:'+String(key),'service:OWNER']};
        const parent={...f.adapter,id:'parent',scope:()=> 'service:OWNER'};
        const service=new ReviewService(f.store,{environment:async()=>({connection:'oracle:LAB',identity:'database-schema-1',label:'LAB'}),changed(){}},[composite,parent]);
        const s=await service.create('Composite native scope','oracle:LAB');await service.stage(s.id,'composite','A',{text:'A'});
        await assert.rejects(service.stage(s.id,'composite','B',{text:'B'}),/already reviewed/);
        await assert.rejects(service.stage(s.id,'parent','OWNER',{text:'changed'}),/already reviewed/);
        assert.deepEqual(f.writes,[]);
    }finally{await f.close();}
});

test('secondary reviewed authorization binds the exact parent policy and ends with the native write',async()=>{
    const {withReviewedWrite,isReviewedWrite}=await import('../changeReview/authorization.js');
    const operation={type:80,parts:['ZZ_OP']},parent={type:79,parts:['ZZ_PARENT']};
    await withReviewedWrite('db',operation,async()=>{
        assert.equal(isReviewedWrite('db',operation,'operation-policy'),true);
        assert.equal(isReviewedWrite('db',parent,'parent-policy'),true);
        assert.equal(isReviewedWrite('db',parent,'operation-policy'),false);
        assert.equal(isReviewedWrite('other-db',parent,'parent-policy'),false);
        assert.equal(isReviewedWrite('db',{...parent,parts:['OTHER']},'parent-policy'),false);
    },'operation-policy',[{key:parent,policyIdentity:'parent-policy'}]);
    assert.equal(isReviewedWrite('db',parent),false);
});

test('a creation judged by an owner created earlier in the same run refreshes its stamp; any other stamp change stops the writer', async () => {
    for (const scenario of ['owner-created-here', 'unrelated-change']) {
        const f = await fixture();
        try {
            // B's ownership evidence follows A's existence, as Record PeopleCode follows its record (classifyDefinition judgedBy).
            f.adapter.authorizationState = async (_e, key) => String(key) === 'B' ? (f.live.has('A') ? 'owner-exists' : 'not-stored') : 'stable';
            let set = await f.service.create('Owner and dependent', 'oracle:LAB');
            set = await f.service.stage(set.id, 'fixture', 'A', { text: 'A' });
            set = await f.service.stage(set.id, 'fixture', 'B', { text: 'B' }, scenario === 'owner-created-here' ? [set.objects[0].id] : []);
            set = await f.service.validate(set.id);
            set = await f.service.review(set.id, set.objects.map(c => c.id), 'APPROVED', set.revision);
            const result = await f.service.apply(set.id);
            if (scenario === 'owner-created-here') {
                assert.equal(result.status, 'APPLIED', JSON.stringify(result.journal.at(-1)));
                assert.deepEqual(f.writes, ['A', 'B']);
                assert.ok(result.journal.some(e => e.action === 'AUTHORIZATION_REFRESHED' && e.object === result.objects[1].id));
            } else {
                assert.equal(result.status, 'PARTIALLY_APPLIED');
                assert.deepEqual(f.writes, ['A']);
                assert.match(JSON.stringify(result.journal), /Authorization context changed before the writer/);
            }
        } finally { await f.close(); }
    }
});

test('a reviewed write covers later steps on a definition it created itself, and nothing else', async () => {
    const { withReviewedWrite, noteReviewedCreation, createdInReviewedWrite } = await import('../changeReview/authorization.js');
    const field = { type: 2, parts: ['ZZ_NEW'] }, other = { type: 2, parts: ['ZZ_OTHER'] };
    noteReviewedCreation('db', field);
    assert.equal(createdInReviewedWrite('db', field), false, 'no reviewed write: nothing is recorded');
    await withReviewedWrite('db', field, async () => {
        assert.equal(createdInReviewedWrite('db', field), false);
        noteReviewedCreation('db', field); noteReviewedCreation('other-db', other);
        assert.equal(createdInReviewedWrite('db', field), true);
        assert.equal(createdInReviewedWrite('db', other), false, 'only the reviewed key is covered');
        assert.equal(createdInReviewedWrite('other-db', field), false);
    });
    assert.equal(createdInReviewedWrite('db', field), false, 'coverage ends with the write');
});
