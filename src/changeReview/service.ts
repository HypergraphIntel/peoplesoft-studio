import type { ObjectDiffProvider } from './semanticDiff.js';
import { randomUUID } from 'node:crypto';
import { ReviewStore } from './store.js';
import { buildObjectTimeline, type ObjectTimeline } from './timeline.js';
import { approvalHash, planHash, canonical, createSet, differences, hash, now, ordered, transition, type Change, type ChangeSet, type Environment, type Json, type Snapshot } from './model.js';
export interface ProposedDependency { id: string; adapter: string; key: Json; after: Json }
export interface ReviewValidationContext { dependencies: readonly ProposedDependency[]; phase: 'proposal' | 'live' }
export interface ReviewAdapter {
    id: string;
    read(environment: Environment, key: Json): Promise<Snapshot>;
    validate(environment: Environment, key: Json, before: Json, after: Json, context?: ReviewValidationContext): Promise<string[]>;
    authorize(environment: Environment, key: Json, operation: Change['operation']): Promise<void>;
    write(environment: Environment, key: Json, after: Json, baseline: Snapshot): Promise<void>;
    /** True only for calibrated DELETE; reverse CREATE otherwise stays unsupported. */
    canDelete?: boolean | ((key: Json) => boolean);
    /** Why an applied before -> after cannot be reversed by a typed inverse (e.g. it added rows whose deletion is uncalibrated). */
    reversalRefusal?(key: Json, before: Json, after: Json): string | undefined;
    diff?: ObjectDiffProvider;
    normalize?(value: Json): Json;
    warnings?(environment: Environment, key: Json): Promise<string[]>;
    authorizationState?(environment: Environment, key: Json): Promise<string>;
}
export interface ReviewHost {
    environment(connection: string): Promise<Environment>;
    changed(): void;
}
export class ReviewService {
    private readonly adapters = new Map<string, ReviewAdapter>();
    private readonly running = new Map<string, AbortController>();
    constructor(readonly store: ReviewStore, private readonly host: ReviewHost, adapters: ReviewAdapter[]) {
        for (const a of adapters) {
            if (this.adapters.has(a.id))
                throw new Error('Duplicate review adapter.');
            this.adapters.set(a.id, a);
        }
    }
    private async reversalRefusal(c: Change): Promise<string | undefined> {
        const refuse = this.adapter(c.adapter).reversalRefusal, before = await this.store.readBlob(c.before), after = await this.store.readBlob(c.after);
        return refuse && before !== null && after !== null ? refuse(c.key, before, after) : undefined;
    }
    private canDelete(adapter: string, key: Json): boolean { const value = this.adapter(adapter).canDelete; return typeof value === 'function' ? value(key) : value === true; }
    capabilities(): string[] { return [...this.adapters.keys()]; }
    private adapter(id: string): ReviewAdapter {
        const a = this.adapters.get(id);
        if (!a)
            throw new Error('Unsupported Change Review adapter: ' + id);
        return a;
    }
    private async environment(set: ChangeSet): Promise<void> {
        const live = await this.host.environment(set.environment.connection);
        if (canonical(live) !== canonical(set.environment))
            throw new Error('Target environment changed. Restage against the verified target.');
    }
    private async checkPrerequisites(set: ChangeSet): Promise<void> {
        const continuation = set.continuation;
        if (!continuation) return;
        const source = await this.store.get(continuation.changeSetId);
        const parents = new Map([[source.id, source]]);
        if (source.status !== 'PARTIALLY_APPLIED' || source.revision !== continuation.sourceRevision || canonical(source.environment) !== canonical(set.environment))
            throw new Error('Continuation source changed; remaining work must be reviewed against its original environment and revision.');
        const expected = [...(source.continuation?.prerequisites ?? []), ...source.objects.filter(c => c.application === 'VERIFIED').map(c => ({
            changeSetId: source.id, objectId: c.id, adapter: c.adapter, key: c.key, snapshot: c.verified ?? '', token: c.verifiedToken ?? ''
        }))];
        if (canonical(expected) !== canonical(continuation.prerequisites))
            throw new Error('The verified prerequisite set changed; no prerequisite may be dropped.');
        const sourceIds = source.objects.filter(c => c.review === 'APPROVED' && c.application === 'PENDING').map(c => c.id).sort();
        if (canonical(sourceIds) !== canonical(continuation.objects.map(m => m.sourceObjectId).sort()))
            throw new Error('Remaining-work source mapping is incomplete.');
        for (const mapping of continuation.objects) {
            const before = source.objects.find(c => c.id === mapping.sourceObjectId), after = set.objects.find(c => c.id === mapping.objectId);
            if (!before || !after || before.application !== 'PENDING' || before.review !== 'APPROVED' || before.adapter !== after.adapter || canonical(before.key) !== canonical(after.key))
                throw new Error('Remaining-work source object changed.');
        }
        for (const p of continuation.prerequisites) {
            if (set.objects.some(c => c.adapter === p.adapter && canonical(c.key) === canonical(p.key)))
                throw new Error('A verified prerequisite cannot also be written by the continuation.');
            let parent = parents.get(p.changeSetId);
            if (!parent) { parent = await this.store.get(p.changeSetId); parents.set(parent.id, parent); }
            const c = parent.objects.find(c => c.id === p.objectId);
            if (canonical(parent.environment) !== canonical(set.environment) || !['PARTIALLY_APPLIED', 'APPLIED'].includes(parent.status) || !c || c.application !== 'VERIFIED' || c.verified !== p.snapshot || c.verifiedToken !== p.token || c.adapter !== p.adapter || canonical(c.key) !== canonical(p.key))
                throw new Error('Verified prerequisite history changed.');
            const live = await this.adapter(p.adapter).read(set.environment, p.key);
            if (hash(live.value) !== p.snapshot || live.token !== p.token)
                throw new Error('Verified prerequisite changed in the database; continuation blocked.');
        }
    }
    private async save(set: ChangeSet): Promise<ChangeSet> { set.updated = now(); await this.store.put(set); this.host.changed(); return set; }
    async create(title: string, connection: string, session?: string, requestKey?: string, plan?: string): Promise<ChangeSet> {
        const environment = await this.host.environment(connection);
        return this.store.exclusive(async () => {
            const requestHash = hash({ title: title.trim(), connection: environment.connection, session: session ?? null, plan: plan ?? null });
            if (requestKey) {
                const prior = (await this.store.list()).find(s => s.requestKey === requestKey && s.environment.identity === environment.identity && s.environment.connection === environment.connection);
                if (prior) {
                    if (prior.requestHash !== requestHash)
                        throw new Error('Idempotency key was reused for another request.');
                    return prior;
                }
            }
            const set = createSet(title, environment, 'agent', session);
            if (requestKey) {
                set.requestKey = requestKey;
                set.requestHash = requestHash;
            }
            if (plan)
                set.plan = { text: plan, revision: 1, review: 'PENDING' };
            return this.save(set);
        });
    }
    async revisePlan(id: string, text: string): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const set = await this.store.get(id);
            this.editable(set);
            if (!text.trim())
                throw new Error('Plan text is required.');
            this.invalidate(set);
            set.plan = { text, revision: (set.plan?.revision ?? 0) + 1, review: 'PENDING' };
            return this.save(set);
        });
    }
    async reviewPlan(id: string, decision: 'APPROVED' | 'REJECTED', expectedRevision: number): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const set = await this.store.get(id);
            this.editable(set);
            if (set.revision !== expectedRevision || !set.plan)
                throw new Error('Plan review is stale or unavailable.');
            set.plan.review = decision;
            if (decision === 'APPROVED')
                set.plan.approvedHash = planHash(set);
            else {
                delete set.plan.approvedHash;
                this.invalidate(set);
            }
            set.journal.push({ at: now(), action: 'PLAN_' + decision });
            return this.save(set);
        });
    }
    private checkPlan(set: ChangeSet): void {
        if (set.plan && (set.plan.review !== 'APPROVED' || set.plan.approvedHash !== planHash(set)))
            throw new Error('The implementation approach requires separate developer plan approval.');
    }
    private editable(set: ChangeSet): void {
        if (!['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'CONFLICTED', 'FAILED'].includes(set.status) || set.objects.some(c => c.application !== 'PENDING'))
            throw new Error('This Change Set cannot be revised; reconcile any application first.');
    }
    private invalidate(set: ChangeSet): void {
        set.status = 'DRAFT';
        set.revision++;
        for (const c of set.objects) {
            c.review = 'PENDING';
            delete c.approvedHash;
            c.validation = [];
            delete c.authorizationStamp;
        }
        set.journal.push({ at: now(), action: 'REVISED_APPROVALS_INVALIDATED' });
    }
    async stage(id: string, adapterId: string, key: Json, after: Json, dependencies: string[] = [], objectId?: string, expectedBaselineToken?: string): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const set = await this.store.get(id);
            this.editable(set);
            this.checkPlan(set);
            await this.environment(set);
            await this.checkPrerequisites(set);
            const adapter = this.adapter(adapterId);
            if (set.continuation?.prerequisites.some(p => p.adapter === adapterId && canonical(p.key) === canonical(key)))
                throw new Error('A verified prerequisite cannot also be written by the continuation.');
            if (adapter.normalize)
                after = adapter.normalize(after);
            if (dependencies.some(d => !set.objects.some(c => c.id === d)))
                throw new Error('Dependencies must name existing staged objects.');
            const existing = objectId ? set.objects.find(c => c.id === objectId) : set.objects.find(c => c.adapter === adapterId && hash(c.key) === hash(key));
            if (objectId && !existing)
                throw new Error('Object not found.');
            if (existing && (existing.adapter !== adapterId || hash(existing.key) !== hash(key)))
                throw new Error('An object revision cannot change identity.');
            const live = await adapter.read(set.environment, key);
            if (expectedBaselineToken !== undefined && live.token !== expectedBaselineToken)
                throw new Error('Stale supplied baseline token.');
            if (existing && (hash(live.value) !== existing.before || live.token !== existing.baselineToken))
                throw new Error('Baseline drift: create a new proposal against current live state.');
            if (after === null && !(typeof adapter.canDelete === 'function' ? adapter.canDelete(key) : adapter.canDelete))
                throw new Error('Deletion/reversal of creation is not supported by this adapter.');
            if (live.value === null && after === null)
                throw new Error('Cannot delete an absent object.');
            const before = await this.store.blob(live.value), proposed = await this.store.blob(after);
            if (before === proposed)
                throw new Error('Proposal has no changes.');
            if (existing && existing.after === proposed && canonical([...existing.dependencies].sort()) === canonical([...new Set(dependencies)].sort()))
                return set;
            this.invalidate(set);
            const c: Change = { id: existing?.id ?? randomUUID(), adapter: adapterId, key, operation: live.value === null ? 'CREATE' : after === null ? 'DELETE' : 'UPDATE',
                before, after: proposed, baselineToken: live.token, dependencies: [...new Set(dependencies)], revision: (existing?.revision ?? 0) + 1,
                review: 'PENDING', validation: [], warnings: [], application: 'PENDING' };
            if (existing)
                set.objects[set.objects.indexOf(existing)] = c;
            else
                set.objects.push(c);
            ordered(set, false);
            return this.save(set);
        });
    }
    /** Only declared, transitive dependencies from this exact stored revision. No database writes. */
    private async dependencyContext(set: ChangeSet, ids: string[]): Promise<ReviewValidationContext> {
        const seen = new Set<string>();
        const visit = (id: string) => {
            if (seen.has(id)) return;
            const c = set.objects.find(c => c.id === id);
            if (!c) throw new Error('Dependency is not part of this Change Set.');
            seen.add(id);
            c.dependencies.forEach(visit);
        };
        ids.forEach(visit);
        return { phase: 'proposal', dependencies: await Promise.all(ordered(set, false).filter(c => seen.has(c.id)).map(async c => ({
            id: c.id, adapter: c.adapter, key: c.key, after: await this.store.readBlob(c.after)
        }))) };
    }
    async proposedDependencies(id: string, ids: string[]): Promise<ReviewValidationContext> {
        const set = await this.store.get(id);
        this.editable(set);
        this.checkPlan(set);
        await this.environment(set);
        await this.checkPrerequisites(set);
        return this.dependencyContext(set, ids);
    }
    private async verifyAppliedDependencies(set: ChangeSet, c: Change): Promise<void> {
        for (const d of (await this.dependencyContext(set, c.dependencies)).dependencies) {
            const saved = set.objects.find(x => x.id === d.id)!;
            if (saved.application !== 'VERIFIED' || !saved.verified || !saved.verifiedToken) throw new Error('Prerequisite has not been verified: ' + d.id);
            const live = await this.adapter(saved.adapter).read(set.environment, saved.key);
            if (hash(live.value) !== saved.verified || live.token !== saved.verifiedToken) throw new Error('Verified dependency changed before dependent writer: ' + d.id);
        }
    }
    async validate(id: string): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const set = await this.store.get(id);
            if (set.status === 'VALIDATING') {
                set.status = 'DRAFT';
                set.journal.push({ at: now(), action: 'VALIDATION_RESTARTED_AFTER_INTERRUPTION' });
            }
            this.editable(set);
            this.checkPlan(set);
            // Nothing staged is not a conflict: refuse without changing state.
            if (!set.objects.length)
                throw new Error('Nothing is staged in this Change Set yet; stage an object before validating.');
            transition(set, 'VALIDATING');
            await this.save(set);
            try {
                await this.environment(set);
                await this.checkPrerequisites(set);
                ordered(set, false);
                for (const c of set.objects) {
                    const a = this.adapter(c.adapter), live = await a.read(set.environment, c.key);
                    c.validation = [];
                    c.review = 'PENDING';
                    delete c.approvedHash;
                    if (live.token !== c.baselineToken || hash(live.value) !== c.before)
                        throw new Error('Live object changed after staging: ' + c.id);
                    c.authorizationStamp = a.authorizationState ? await a.authorizationState(set.environment, c.key) : undefined;
                    c.warnings = a.warnings ? await a.warnings(set.environment, c.key) : [];
                    c.validation = await a.validate(set.environment, c.key, live.value, await this.store.readBlob(c.after), await this.dependencyContext(set, c.dependencies));
                }
                if (set.objects.some(c => c.validation.length))
                    throw new Error('Validation findings must be resolved before approval.');
                transition(set, 'READY_FOR_REVIEW');
            }
            catch (error) {
                transition(set, 'CONFLICTED');
                set.journal.push({ at: now(), action: 'VALIDATION_FAILED', detail: error instanceof Error ? error.message : String(error) });
            }
            return this.save(set);
        });
    }
    /** Trusted UI only. No MCP tool exposes this method. */
    async review(id: string, objectIds: string[], decision: 'APPROVED' | 'REJECTED', expectedRevision: number, destructive = false): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const set = await this.store.get(id);
            if (set.revision !== expectedRevision)
                throw new Error('Review page is stale; reopen the current revision.');
            if (!['READY_FOR_REVIEW', 'APPROVED'].includes(set.status))
                throw new Error('Validate before review.');
            if (!objectIds.length || objectIds.some(o => !set.objects.some(c => c.id === o)))
                throw new Error('Invalid review selection.');
            for (const c of set.objects.filter(c => objectIds.includes(c.id))) {
                if (decision === 'APPROVED' && c.operation === 'DELETE' && !destructive)
                    throw new Error('Distinct destructive-operation approval is required.');
                c.review = decision;
                if (decision === 'APPROVED')
                    c.approvedHash = approvalHash(set, c);
                else
                    delete c.approvedHash;
            }
            // Rejected dependencies revoke dependent approvals transitively.
            let changed = true;
            while (changed) {
                changed = false;
                for (const c of set.objects)
                    if (c.review === 'APPROVED' && c.dependencies.some(d => set.objects.find(x => x.id === d)?.review === 'REJECTED')) {
                        c.review = 'REJECTED';
                        delete c.approvedHash;
                        changed = true;
                    }
            }
            ordered(set);
            set.status = set.objects.some(c => c.review === 'APPROVED') ? 'APPROVED' : 'READY_FOR_REVIEW';
            set.journal.push({ at: now(), action: decision, detail: objectIds.join(',') });
            return this.save(set);
        });
    }
    async cancel(id: string): Promise<void> {
        const active = this.running.get(id);
        if (active) {
            active.abort();
            return;
        }
        await this.store.exclusive(async () => {
            const set = await this.store.get(id);
            // A conflict after any write is recovery work, not something to discard.
            if (set.status === 'CONFLICTED' && set.objects.some(c => c.application !== 'PENDING'))
                throw new Error('Objects in this Change Set were written; it needs recovery, not cancellation.');
            transition(set, 'CANCELLED');
            await this.save(set);
        });
    }
    /** Trusted UI apply; all preflight checks repeat under the store lock. */
    async apply(id: string, stopAfterFirst = false): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const set = await this.store.get(id);
            if (set.status !== 'APPROVED')
                throw new Error('An approved Change Set is required.');
            const selected = ordered(set);
            if (!selected.length)
                throw new Error('Nothing approved.');
            if (stopAfterFirst && set.reverses) throw new Error('Partial reversal application requires a combined recovery plan.');
            const abort = new AbortController();
            this.running.set(id, abort);
            let writing = false;
            try {
                this.checkPlan(set);
                await this.environment(set);
                await this.checkPrerequisites(set);
                const checkpoint: NonNullable<ChangeSet['checkpoint']> = { at: now(), objects: [] };
                for (const c of selected) {
                    if (c.approvedHash !== approvalHash(set, c))
                        throw new Error('Approval revision mismatch.');
                    const a = this.adapter(c.adapter), live = await a.read(set.environment, c.key);
                    if (hash(live.value) !== c.before || live.token !== c.baselineToken)
                        throw new Error('Live drift before application: ' + c.id);
                    const errors = await a.validate(set.environment, c.key, live.value, await this.store.readBlob(c.after), await this.dependencyContext(set, c.dependencies));
                    if (errors.length)
                        throw new Error(errors.join('\n'));
                    if (a.authorizationState && await a.authorizationState(set.environment, c.key) !== c.authorizationStamp)
                        throw new Error('Ownership, operator or policy changed after review. Revalidate and review again.');
                    await a.authorize(set.environment, c.key, c.operation);
                    checkpoint.objects.push({ id: c.id, snapshot: await this.store.blob(live.value), token: live.token });
                }
                set.checkpoint = checkpoint;
                transition(set, 'APPLYING');
                writing = true;
                await this.save(set);
                for (const c of selected) {
                    abort.signal.throwIfAborted();
                    await this.environment(set);
                    await this.checkPrerequisites(set);
                    const a = this.adapter(c.adapter), live = await a.read(set.environment, c.key);
                    if (hash(live.value) !== c.before || live.token !== c.baselineToken)
                        throw new Error('Concurrent change before writer: ' + c.id);
                    await this.verifyAppliedDependencies(set, c);
                    const errors = await a.validate(set.environment, c.key, live.value, await this.store.readBlob(c.after), { phase: 'live', dependencies: [] });
                    if (errors.length) throw new Error(errors.join('\n'));
                    await this.verifyAppliedDependencies(set, c);
                    await a.authorize(set.environment, c.key, c.operation);
                    c.application = 'APPLYING';
                    set.journal.push({ at: now(), action: 'WRITE_STARTED', object: c.id });
                    await this.save(set);
                    if (a.authorizationState && await a.authorizationState(set.environment, c.key) !== c.authorizationStamp)
                        throw new Error('Authorization context changed before the writer.');
                    await a.write(set.environment, c.key, await this.store.readBlob(c.after), { ...live, ...(c.authorizationStamp ? { authorization: c.authorizationStamp } : {}) });
                    const persisted = await a.read(set.environment, c.key);
                    if (hash(persisted.value) !== c.after)
                        throw new Error('Post-write verification differs from reviewed revision: ' + c.id);
                    c.application = 'VERIFIED';
                    c.verified = await this.store.blob(persisted.value);
                    c.verifiedToken = persisted.token;
                    set.journal.push({ at: now(), action: 'WRITE_VERIFIED', object: c.id });
                    await this.save(set);
                    if (stopAfterFirst && selected.length > 1) {
                        await this.checkPrerequisites(set);
                        transition(set, 'PARTIALLY_APPLIED');
                        set.journal.push({ at: now(), action: 'PAUSED_BETWEEN_WRITERS', detail: 'Developer requested one verified object; untouched approved work needs a fresh remaining-work proposal.' });
                        return await this.save(set);
                    }
                }
                await this.checkPrerequisites(set);
                for (const c of selected) await this.verifyAppliedDependencies(set, c);
                transition(set, 'APPLIED');
                await this.save(set);
                await this.markReversed(set);
                return set;
            }
            catch (error) {
                for (const c of set.objects)
                    if (c.application === 'APPLYING')
                        c.application = 'UNCERTAIN';
                set.status = set.objects.some(c => c.application === 'VERIFIED' || c.application === 'UNCERTAIN') ? 'PARTIALLY_APPLIED' : writing ? 'FAILED' : 'CONFLICTED';
                set.journal.push({ at: now(), action: 'APPLICATION_STOPPED', detail: error instanceof Error ? error.message : String(error) });
                return await this.save(set);
            }
            finally {
                this.running.delete(id);
            }
        });
    }
    /** Manual Save is already a trusted developer action; observe, do not fabricate MCP approval. */
    /**
     * A developer's own save recorded as history around the write. History is a record of the save, never a gate on it:
     * when it cannot be started the save goes ahead unrecorded; when the readback after a successful save fails the save's
     * result is still returned and the record stays UNCERTAIN. Only the write's own failure is the caller's error. The
     * write runs at most once.
     */
    async captureManual<T>(connection: string, adapterId: string, key: Json, write: () => Promise<T>): Promise<T> {
        let started = false, done = false, result: T | undefined;
        const run = async (): Promise<T> => { started = true; result = await write(); done = true; return result; };
        try {
            return await this.store.exclusive(async () => {
                let set: ReturnType<typeof createSet>, c: Change, environment: Environment, adapter: ReviewAdapter;
                try {
                    environment = await this.host.environment(connection);
                    adapter = this.adapter(adapterId);
                    const before = await adapter.read(environment, key);
                    set = createSet('Manual save · ' + adapterId, environment, 'manual');
                    c = { id: randomUUID(), adapter: adapterId, key, operation: before.value === null ? 'CREATE' : 'UPDATE', before: await this.store.blob(before.value), after: await this.store.blob(null),
                        baselineToken: before.token, dependencies: [], revision: 1, review: 'PENDING', validation: [], warnings: ['Manual save result is not known until verified readback.'], application: 'APPLYING', resultKnown: false };
                    set.objects = [c];
                    set.status = 'APPLYING';
                    set.checkpoint = { at: now(), objects: [{ id: c.id, snapshot: c.before, token: before.token }] };
                    set.journal.push({ at: now(), action: 'MANUAL_SAVE_STARTED', object: c.id });
                    await this.save(set);
                }
                catch (error) {
                    console.warn(`Change Review: history not recorded for a manual ${adapterId} save: ${error instanceof Error ? error.message : String(error)}`);
                    return run();
                }
                try {
                    await run();
                }
                catch (error) {
                    c.application = 'UNCERTAIN';
                    set.status = 'PARTIALLY_APPLIED';
                    set.journal.push({ at: now(), action: 'MANUAL_SAVE_UNCERTAIN', detail: error instanceof Error ? error.message : String(error) });
                    await this.save(set).catch(() => undefined);
                    throw error;
                }
                try {
                    const after = await adapter.read(environment, key);
                    c.after = await this.store.blob(after.value);
                    c.verified = c.after;
                    c.verifiedToken = after.token;
                    c.resultKnown = true;
                    c.application = 'VERIFIED';
                    c.warnings = [];
                    set.status = 'APPLIED';
                    set.journal.push({ at: now(), action: 'MANUAL_SAVE_READBACK_VERIFIED', object: c.id });
                    await this.save(set);
                }
                catch (error) {
                    // Saved, but not read back for history: the record says so; the save stands.
                    c.application = 'UNCERTAIN';
                    c.warnings = ['The save completed; its readback for history failed, so the recorded after-state is unknown.'];
                    set.status = 'PARTIALLY_APPLIED';
                    set.journal.push({ at: now(), action: 'MANUAL_SAVE_READBACK_FAILED', object: c.id, detail: error instanceof Error ? error.message : String(error) });
                    await this.save(set).catch(() => undefined);
                }
                return result as T;
            });
        }
        catch (error) {
            if (done) return result as T;
            if (started) throw error;
            // The history store could not be entered (its lock): the save goes ahead unrecorded.
            console.warn(`Change Review: history unavailable for a manual ${adapterId} save: ${error instanceof Error ? error.message : String(error)}`);
            return run();
        }
    }
    async objectTimeline(id: string, objectId: string, checkLive = false): Promise<ObjectTimeline> {
        const set = await this.store.get(id), c = set.objects.find(o => o.id === objectId);
        if (!c) throw new Error('Object not found.');
        const timeline = buildObjectTimeline(await this.store.list(), set.environment, c.adapter, c.key);
        if (checkLive) {
            const checkedAt = now();
            try {
                await this.environment(set);
                const live = await this.adapter(c.adapter).read(set.environment, c.key);
                const snapshot = hash(live.value);
                const candidates = [...timeline.revisions].reverse().map(r => ({ id: r.id, snapshot: r.snapshot, token: r.token }));
                candidates.push({ id: 'baseline', snapshot: timeline.baseline.snapshot, token: timeline.baseline.token });
                const exact = candidates.find(r => r.snapshot === snapshot && r.token === live.token);
                const content = candidates.find(r => r.snapshot === snapshot);
                timeline.live = exact ? { status: 'MATCHES_RECORDED', checkedAt, matched: exact.id }
                    : content ? { status: 'TOKEN_CHANGED', checkedAt, matched: content.id, reason: 'Content matches a retained snapshot, but its native token changed. This does not establish the same revision.' }
                    : { status: 'DIVERGED', checkedAt, reason: 'Live content differs from all retained snapshots; external changes may be unrecorded.' };
            } catch (error) {
                timeline.live = { status: 'UNAVAILABLE', checkedAt, reason: error instanceof Error ? error.message : String(error) };
            }
        }
        return timeline;
    }
    async diff(id: string, objectId: string) {
        const set = await this.store.get(id), c = set.objects.find(o => o.id === objectId);
        if (!c)
            throw new Error('Object not found.');
        const before = await this.store.readBlob(c.before), after = await this.store.readBlob(c.after);
        return { object: c, before, after, differences: this.adapter(c.adapter).diff?.compare(before, after) ?? differences(before, after) };
    }
    private async markReversed(set: ChangeSet): Promise<void> {
        if (!set.reverses || set.status !== 'APPLIED')
            return;
        const original = await this.store.get(set.reverses);
        if (original.status === 'APPLIED') {
            transition(original, 'REVERTED');
            original.journal.push({ at: now(), action: 'REVERSED_BY_VERIFIED_CHANGE_SET', detail: set.id });
            await this.save(original);
        }
    }
    async redo(id: string): Promise<ChangeSet> {
        const set = await this.store.get(id);
        if (set.reverses && set.status === 'APPLIED')
            return this.reverse(set.id, true);
        if (set.status === 'REVERTED') {
            const inverse = (await this.store.list()).find(s => s.reverses === id && s.status === 'APPLIED');
            if (inverse)
                return this.reverse(inverse.id, true);
        }
        throw new Error('No verified applied reversal is available for redo.');
    }
    async recover(id: string): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const set = await this.store.get(id);
            if (!['APPLYING', 'PARTIALLY_APPLIED'].includes(set.status))
                throw new Error('No interrupted application to reconcile.');
            await this.environment(set);
            await this.checkPrerequisites(set);
            for (const c of set.objects.filter(c => ['APPLYING', 'UNCERTAIN', 'VERIFIED'].includes(c.application))) {
                if (c.resultKnown === false) {
                    c.application = 'UNCERTAIN';
                    c.warnings = ['Interrupted manual save has no authoritative expected after-state. Inspect live state manually; no automatic reconciliation.'];
                    continue;
                }
                const live = await this.adapter(c.adapter).read(set.environment, c.key);
                if (hash(live.value) === c.after) {
                    c.application = 'VERIFIED';
                    c.verified = await this.store.blob(live.value);
                    c.verifiedToken = live.token;
                }
                else if (c.application !== 'VERIFIED' && c.operation === 'UPDATE' && c.before !== hash(null) && c.baselineToken !== 'absent' && hash(live.value) === c.before && live.token === c.baselineToken) {
                    // A writer may have rolled back after entering its write phase.
                    // Both the complete before-image and original token must match;
                    // this only enables a fresh reviewed continuation, never replay.
                    c.application = 'PENDING';
                    delete c.verified;
                    delete c.verifiedToken;
                    c.warnings = ['Live snapshot and token match the original baseline. No reviewed update is persisted; a freshly approved continuation is required.'];
                    set.journal.push({ at: now(), action: 'BASELINE_CONFIRMED', object: c.id });
                }
                else {
                    c.application = 'UNCERTAIN';
                    c.warnings = ['Live state does not match the reviewed result; no replay or restoration attempted.'];
                }
            }
            const selected = set.objects.filter(c => c.review === 'APPROVED');
            set.status = selected.length && selected.every(c => c.application === 'VERIFIED') ? 'APPLIED' : 'PARTIALLY_APPLIED';
            set.journal.push({ at: now(), action: 'RECONCILED_WITH_LIVE_STATE' });
            await this.save(set);
            await this.markReversed(set);
            return set;
        });
    }
    async reversalSupport(set: ChangeSet): Promise<{
        supported: boolean;
        reason: string;
    }> {
        if (set.status !== 'APPLIED')
            return { supported: false, reason: 'Only verified applied revisions can be reversed.' };
        if (set.continuation)
            return { supported: false, reason: 'Reversing continued work needs a combined recovery plan; it is not supported yet.' };
        for (const c of set.objects.filter(c => c.application === 'VERIFIED'))
            if (await this.store.readBlob(c.before) === null && !this.canDelete(c.adapter, c.key))
                return { supported: false, reason: 'Reversing creation requires a calibrated deletion adapter (' + c.adapter + ').' };
        for (const c of set.objects.filter(c => c.application === 'VERIFIED')) {
            const refusal = await this.reversalRefusal(c);
            if (refusal) return { supported: false, reason: refusal };
        }
        return { supported: true, reason: 'Live revision and dependency checks still run before a reversal is staged.' };
    }
    async reverse(id: string, redo = false): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const original = await this.store.get(id);
            if (original.status !== 'APPLIED')
                throw new Error('Only a verified applied Change Set can be reversed.');
            if (original.continuation)
                throw new Error('Reversing continued work needs a combined recovery plan; it is not supported yet.');
            await this.environment(original);
            const proposal = createSet(redo ? 'Redo ' + original.title.replace(/^Revert /, '') : 'Revert ' + original.title, original.environment, 'reversal');
            proposal.reverses = id;
            const applied = original.objects.filter(c => c.application === 'VERIFIED');
            const ids = new Map(applied.map(c => [c.id, randomUUID()]));
            for (const c of applied) {
                const a = this.adapter(c.adapter), live = await a.read(original.environment, c.key);
                if (hash(live.value) !== c.verified || live.token !== c.verifiedToken)
                    throw new Error('Live state changed since application; reversal blocked.');
                const value = await this.store.readBlob(c.before);
                if (value === null && !this.canDelete(c.adapter, c.key))
                    throw new Error('Reversal needs an unsupported deletion. No partial reverse proposal created.');
                const refusal = await this.reversalRefusal(c);
                if (refusal) throw new Error(refusal + ' No partial reverse proposal created.');
                const dependencies = applied.filter(x => x.dependencies.includes(c.id)).map(x => ids.get(x.id)!);
                proposal.objects.push({ id: ids.get(c.id)!, adapter: c.adapter, key: c.key, operation: value === null ? 'DELETE' : live.value === null ? 'CREATE' : 'UPDATE', before: await this.store.blob(live.value), after: await this.store.blob(value), baselineToken: live.token, dependencies,
                    revision: 1, review: 'PENDING', validation: [], warnings: [], application: 'PENDING' });
            }
            ordered(proposal, false);
            proposal.journal.push({ at: now(), action: redo ? 'REDO_PROPOSED' : 'REVERSAL_PROPOSED', detail: id });
            return this.save(proposal);
        });
    }
    remainingSupport(set: ChangeSet): { supported: boolean; reason: string } {
        if (set.status !== 'PARTIALLY_APPLIED')
            return { supported: false, reason: 'Only a reconciled partial application can prepare remaining work.' };
        if (set.origin === 'manual' || set.reverses)
            return { supported: false, reason: 'Manual saves and partial reversals require a separate recovery plan.' };
        if (set.objects.some(c => ['APPLYING', 'UNCERTAIN'].includes(c.application) || c.resultKnown === false))
            return { supported: false, reason: 'Reconcile uncertain outcomes first. No writer will be retried based on an unknown result.' };
        if (!set.objects.some(c => c.review === 'APPROVED' && c.application === 'PENDING'))
            return { supported: false, reason: 'No previously approved, untouched objects remain.' };
        return { supported: true, reason: 'Prepare untouched approved objects as a new proposal. Confirmed writes become checked prerequisites; fresh approval is required.' };
    }
    /** Preparation only. Never replays an uncertain write or inherits a prior approval. */
    async prepareRemaining(id: string): Promise<ChangeSet> {
        return this.store.exclusive(async () => {
            const original = await this.store.get(id);
            const support = this.remainingSupport(original);
            if (!support.supported) throw new Error(support.reason);
            const existing = (await this.store.list()).find(s => s.continuation?.changeSetId === id && !['CANCELLED', 'REJECTED'].includes(s.status));
            if (existing) return existing;
            await this.environment(original);
            await this.checkPrerequisites(original);
            const selected = ordered(original);
            const remaining = selected.filter(c => c.application === 'PENDING');
            const verified = original.objects.filter(c => c.application === 'VERIFIED');
            const ids = new Map(remaining.map(c => [c.id, randomUUID()]));
            const proposal = createSet('Remaining work · ' + original.title, original.environment, 'agent', original.session);
            proposal.schema = 2;
            proposal.continuation = {
                changeSetId: original.id, sourceRevision: original.revision,
                objects: remaining.map(c => ({ sourceObjectId: c.id, objectId: ids.get(c.id)! })),
                prerequisites: structuredClone(original.continuation?.prerequisites ?? [])
            };
            if (original.plan) proposal.plan = { text: original.plan.text, revision: 1, review: 'PENDING' };
            for (const c of verified) {
                if (!c.verified || c.verifiedToken === undefined) throw new Error('Verified prerequisite lacks an authoritative snapshot/token.');
                const live = await this.adapter(c.adapter).read(original.environment, c.key);
                if (hash(live.value) !== c.verified || live.token !== c.verifiedToken)
                    throw new Error('A confirmed object changed since reconciliation; remaining work blocked.');
                proposal.continuation.prerequisites.push({ changeSetId: original.id, objectId: c.id, adapter: c.adapter, key: c.key, snapshot: c.verified, token: c.verifiedToken });
            }
            for (const c of remaining) {
                if (c.approvedHash !== approvalHash(original, c)) throw new Error('Original approval revision is invalid.');
                const a = this.adapter(c.adapter), live = await a.read(original.environment, c.key);
                if (hash(live.value) !== c.before || live.token !== c.baselineToken)
                    throw new Error('An untouched object changed since staging; restage it explicitly against live state.');
                const after = await this.store.readBlob(c.after);
                if (after === null && !this.canDelete(c.adapter, c.key)) throw new Error('Remaining deletion is not supported.');
                for (const dep of c.dependencies)
                    if (!ids.has(dep) && !verified.some(v => v.id === dep)) throw new Error('Remaining work has an unresolved dependency.');
                proposal.objects.push({ id: ids.get(c.id)!, adapter: c.adapter, key: c.key, operation: c.operation,
                    before: await this.store.blob(live.value), after: c.after, baselineToken: live.token,
                    dependencies: c.dependencies.filter(d => ids.has(d)).map(d => ids.get(d)!), revision: 1,
                    review: 'PENDING', validation: [], warnings: ['Continues a partial application; previously verified objects are read-only prerequisites.'], application: 'PENDING' });
            }
            ordered(proposal, false);
            proposal.journal.push({ at: now(), action: 'REMAINING_WORK_PROPOSED', detail: original.id });
            await this.checkPrerequisites(proposal);
            return this.save(proposal);
        });
    }
}
