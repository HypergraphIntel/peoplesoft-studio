import { DefinitionType, isPeopleCode, type DefinitionKey } from '../model/definitions.js';
import { approvalHash, canonical, type ChangeSet, type Json, type Status } from './model.js';

/** Keep unresolved/partial applications in the developer's working queue. */
export function pendingReview(status: Status): boolean {
    return !['APPLIED', 'CANCELLED', 'REJECTED', 'REVERTED'].includes(status);
}

export type ReviewList = 'all' | 'pending' | 'history';
/** Historical completion only: never changes the original partial record or authorizes a write. */
export function completedFollowUp(set: ChangeSet, sets: readonly ChangeSet[]): ChangeSet | undefined {
    if (set.status !== 'PARTIALLY_APPLIED' || set.origin === 'manual' || set.reverses ||
        set.objects.some(c => c.resultKnown === false || !['PENDING', 'VERIFIED'].includes(c.application))) return undefined;
    const verified = set.objects.filter(c => c.application === 'VERIFIED');
    const remaining = set.objects.filter(c => c.application === 'PENDING' && c.review === 'APPROVED');
    if (!remaining.length || set.objects.some(c => c.application === 'PENDING' && c.review === 'PENDING') ||
        [...verified, ...remaining].some(c => c.review !== 'APPROVED' || c.approvedHash !== approvalHash(set, c)) ||
        verified.some(c => c.verified !== c.after || !c.verifiedToken)) return undefined;
    const prerequisites = [...(set.continuation?.prerequisites ?? []), ...verified.map(c => ({
        changeSetId: set.id, objectId: c.id, adapter: c.adapter, key: c.key, snapshot: c.verified!, token: c.verifiedToken!
    }))];
    return sets.find(next => {
        const continuation = next.continuation;
        if (next.status !== 'APPLIED' || next.schema !== 2 || !continuation || continuation.changeSetId !== set.id ||
            continuation.sourceRevision !== set.revision || canonical(next.environment) !== canonical(set.environment) ||
            canonical(continuation.prerequisites) !== canonical(prerequisites) || next.objects.length !== remaining.length ||
            continuation.objects.length !== remaining.length || new Set(continuation.objects.map(m => m.objectId)).size !== remaining.length) return false;
        return remaining.every(source => {
            const matches = continuation.objects.filter(m => m.sourceObjectId === source.id);
            const c = matches.length === 1 ? next.objects.find(o => o.id === matches[0].objectId) : undefined;
            return !!c && c.application === 'VERIFIED' && c.review === 'APPROVED' && c.resultKnown !== false &&
                c.verified === c.after && !!c.verifiedToken && c.approvedHash === approvalHash(next, c) &&
                c.adapter === source.adapter && canonical(c.key) === canonical(source.key) && c.operation === source.operation &&
                c.before === source.before && c.after === source.after && c.baselineToken === source.baselineToken;
        });
    });
}
export function reviewList(sets: ChangeSet[], mode: ReviewList): ChangeSet[] {
    return sets.filter(s => mode === 'all' || (pendingReview(s.status) && !completedFollowUp(s, sets)) === (mode === 'pending'));
}

/** Adapter keys must match the stored keys exactly; never search by name alone. */
export function definitionReviewTarget(key: DefinitionKey): { adapter: string; key: Json } | undefined {
    if (isPeopleCode(key.type) && key.type !== DefinitionType.FileLayoutPeopleCode) return { adapter: 'peoplecode', key: { type: key.type, parts: [...key.parts] } };
    if (key.type === DefinitionType.Query) return { adapter: 'query', key: [key.parts[0], key.parts[1] ?? ''] };
    if (key.type === DefinitionType.ProcessDefinition) return { adapter: 'process', key: [...key.parts] };
    const adapter = ({
        [DefinitionType.Record]: 'record', [DefinitionType.Page]: 'page', [DefinitionType.AppEngineProgram]: 'ae',
        [DefinitionType.SqlDefinition]: 'sql', [DefinitionType.HtmlDefinition]: 'html', [DefinitionType.StyleSheet]: 'stylesheet'
    } as Partial<Record<DefinitionType, string>>)[key.type];
    return adapter ? { adapter, key: key.parts[0] } : undefined;
}
