import { canonical, hash, type Change, type ChangeSet, type Environment, type Json } from './model.js';

export interface TimelineRevision {
    id: string;
    changeSetId: string;
    objectId: string;
    title: string;
    at: string;
    origin: ChangeSet['origin'];
    status: ChangeSet['status'];
    operation: Change['operation'];
    snapshot: string;
    token: string;
    before: string;
    baselineToken: string;
    continuity: 'MATCHES_PREVIOUS' | 'GAP';
    reverses?: string;
}

export interface ObjectTimeline {
    environment: Environment;
    adapter: string;
    key: Json;
    historyHash: string;
    baseline: { snapshot: string; token: string; at: string; changeSetId: string; objectId: string };
    revisions: TimelineRevision[];
    proposals: { changeSetId: string; objectId: string; title: string; status: ChangeSet['status']; application: Change['application']; review: Change['review']; resultKnown: boolean; revision: number; changeSetRevision: number; updatedAt: string }[];
    live: {
        status: 'NOT_CHECKED' | 'MATCHES_RECORDED' | 'TOKEN_CHANGED' | 'DIVERGED' | 'UNAVAILABLE';
        checkedAt?: string;
        matched?: string;
        reason?: string;
    };
}

/** A local observation history, not an invented continuous PeopleSoft revision sequence. */
export function buildObjectTimeline(sets: ChangeSet[], environment: Environment, adapter: string, key: Json): ObjectTimeline {
    const observations = sets.filter(s => s.environment.connection === environment.connection && s.environment.identity === environment.identity)
        .flatMap(s => s.objects.filter(c => c.adapter === adapter && canonical(c.key) === canonical(key)).map(c => ({ s, c })))
        .sort((a, b) => a.s.created.localeCompare(b.s.created) || a.s.id.localeCompare(b.s.id));
    if (!observations.length) throw new Error('No retained history for this object.');
    const first = observations[0];
    const baseline = { snapshot: first.c.before, token: first.c.baselineToken, at: first.s.created, changeSetId: first.s.id, objectId: first.c.id };
    const revisions: TimelineRevision[] = observations.filter(({ c }) => c.application === 'VERIFIED' && c.resultKnown !== false && !!c.verified && c.verifiedToken !== undefined)
        .map(({ s, c }) => ({
            id: s.id + ':' + c.id, changeSetId: s.id, objectId: c.id, title: s.title, origin: s.origin, status: s.status,
            operation: c.operation, snapshot: c.verified!, token: c.verifiedToken!, before: c.before, baselineToken: c.baselineToken,
            at: [...s.journal].reverse().find(e => (e.object === c.id && ['WRITE_VERIFIED', 'MANUAL_SAVE_READBACK_VERIFIED'].includes(e.action)) || e.action === 'RECONCILED_WITH_LIVE_STATE')?.at ?? s.updated,
            continuity: 'GAP' as const, ...(s.reverses ? { reverses: s.reverses } : {})
        })).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    let previous = baseline;
    for (const revision of revisions) {
        revision.continuity = revision.before === previous.snapshot && revision.baselineToken === previous.token ? 'MATCHES_PREVIOUS' : 'GAP';
        previous = { ...baseline, snapshot: revision.snapshot, token: revision.token };
    }
    const proposals = observations.filter(({ c }) => c.application !== 'VERIFIED' || c.resultKnown === false || !c.verified || c.verifiedToken === undefined)
        .map(({ s, c }) => ({ changeSetId: s.id, objectId: c.id, title: s.title, status: s.status, application: c.application, review: c.review, resultKnown: c.resultKnown !== false, revision: c.revision, changeSetRevision: s.revision, updatedAt: s.updated }));
    return { environment, adapter, key, historyHash: hash({ baseline, revisions, proposals }), baseline, revisions, proposals, live: { status: 'NOT_CHECKED' } };
}
