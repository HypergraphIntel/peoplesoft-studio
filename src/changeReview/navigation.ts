import { pcmProgKeyParts } from '../model/peopleCodeKeys.js';
import { DefinitionType, isPeopleCode, type DefinitionKey } from '../model/definitions.js';
import { approvalHash, canonical, type ChangeSet, type Json, type Status } from './model.js';

/** Keep unresolved/partial applications in the developer's working queue. */
export function pendingReview(status: Status): boolean {
    return !['APPLIED', 'CANCELLED', 'REJECTED', 'REVERTED'].includes(status);
}

export type ReviewList = 'all' | 'pending' | 'history';
/** Historical completion only: never changes the original partial record or authorizes a write. */
export function completedFollowUp(set: ChangeSet, sets: readonly ChangeSet[]): ChangeSet | undefined {
    return completedContinuation(set, sets, new Set());
}
function completedContinuation(set: ChangeSet, sets: readonly ChangeSet[], visited: Set<string>): ChangeSet | undefined {
    if (visited.has(set.id)) return undefined;
    visited = new Set([...visited, set.id]);
    if (set.status !== 'PARTIALLY_APPLIED' || set.origin === 'manual' ||
        set.objects.some(c => c.resultKnown === false || !['PENDING', 'VERIFIED'].includes(c.application))) return undefined;
    const verified = set.objects.filter(c => c.application === 'VERIFIED');
    const remaining = set.objects.filter(c => c.application === 'PENDING' && c.review === 'APPROVED');
    if (!remaining.length || set.objects.some(c => c.application === 'PENDING' && c.review === 'PENDING') ||
        [...verified, ...remaining].some(c => c.review !== 'APPROVED' || c.approvedHash !== approvalHash(set, c)) ||
        verified.some(c => c.verified !== c.after || !c.verifiedToken)) return undefined;
    const prerequisites = [...(set.continuation?.prerequisites ?? []), ...verified.map(c => ({
        changeSetId: set.id, objectId: c.id, adapter: c.adapter, key: c.key, snapshot: c.verified!, token: c.verifiedToken!
    }))];
    for (const next of sets) {
        const continuation = next.continuation;
        if (!['APPLIED','PARTIALLY_APPLIED'].includes(next.status) || next.schema !== (set.reverses ? 4 : 2) || next.reverses !== set.reverses || !continuation || continuation.changeSetId !== set.id ||
            continuation.sourceRevision !== set.revision || canonical(next.environment) !== canonical(set.environment) ||
            canonical(continuation.prerequisites) !== canonical(prerequisites) || next.objects.length !== remaining.length ||
            continuation.objects.length !== remaining.length || new Set(continuation.objects.map(m => m.objectId)).size !== remaining.length) continue;
        const completed = next.status === 'APPLIED' ? next : completedContinuation(next, sets, visited);
        if (!completed) continue;
        if (set.reverses && (!next.reversalSources || set.reversalSources && canonical(next.reversalSources) !== canonical(set.reversalSources) ||
            !next.reversalSources.every(source => sets.some(parent => parent.id === source.changeSetId && parent.revision === source.revision &&
                canonical(parent.environment) === canonical(set.environment) && parent.status === 'REVERTED' && parent.journal.some(e => e.action === 'REVERSED_BY_VERIFIED_CHANGE_SET' && e.detail === completed.id))))) continue;
        if (remaining.every(source => {
            const matches = continuation.objects.filter(m => m.sourceObjectId === source.id);
            const c = matches.length === 1 ? next.objects.find(o => o.id === matches[0].objectId) : undefined;
            return !!c && (c.application === 'VERIFIED' && c.verified === c.after && !!c.verifiedToken || next.status === 'PARTIALLY_APPLIED' && c.application === 'PENDING') && c.review === 'APPROVED' && c.resultKnown !== false &&
                c.approvedHash === approvalHash(next, c) &&
                c.adapter === source.adapter && canonical(c.key) === canonical(source.key) && c.operation === source.operation &&
                c.before === source.before && c.after === source.after && c.baselineToken === source.baselineToken;
        })) return completed;
    }
    return undefined;
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
        [DefinitionType.IbService]: 'ib-service', [DefinitionType.IbServiceOperation]: 'ib-operation',
        [DefinitionType.SqlDefinition]: 'sql', [DefinitionType.Query]:'query', [DefinitionType.HtmlDefinition]: 'html', [DefinitionType.StyleSheet]: 'stylesheet'
    } as Partial<Record<DefinitionType, string>>)[key.type];
    return adapter ? { adapter, key: key.parts[0] } : undefined;
}

/** Distinct preservation scopes retain separate timelines, while native navigation can find each retained adapter. */
export function definitionReviewTargets(key: DefinitionKey): { adapter: string; key: Json }[] {
    const primary = definitionReviewTarget(key), result = primary ? [primary] : [];
    const kind = ({ [DefinitionType.Record]: 'record', [DefinitionType.Field]: 'field', [DefinitionType.SqlDefinition]: 'sql',
        [DefinitionType.Query]:'query', [DefinitionType.Menu]:'menu', [DefinitionType.HtmlDefinition]: 'html', [DefinitionType.StyleSheet]: 'stylesheet', [DefinitionType.AppEngineProgram]: 'ae' } as Partial<Record<DefinitionType,string>>)[key.type]
        ?? (isPeopleCode(key.type) && ![DefinitionType.AppEnginePeopleCode, DefinitionType.FileLayoutPeopleCode].includes(key.type) ? 'peoplecode' : undefined);
    if (kind) {
        const parts = kind === 'peoplecode' ? [...pcmProgKeyParts(key)] : [...key.parts];
        if (kind === 'peoplecode' && key.type === DefinitionType.ApplicationClassPeopleCode) parts.pop();
        if (kind === 'html') { parts.length=1; parts.push('4'); }
        if (kind === 'sql') { parts.length=1; parts.push('0'); }
        result.push({ adapter:'migration-'+kind,key:{type:key.type,parts} });
    }
    if (kind && ['sql','html','stylesheet'].includes(kind)) result.push({adapter:kind+'-definition',key:key.parts[0]});
    if (key.type === DefinitionType.Project) result.push({ adapter:'migration-project',key:key.parts[0] });
    if ([DefinitionType.Record,DefinitionType.AppEngineProgram,DefinitionType.Project].includes(key.type)) result.push({ adapter: key.type === DefinitionType.Record ? 'record-create' : key.type === DefinitionType.AppEngineProgram ? 'ae-create' : 'project-create', key:key.parts[0] });
    return result;
}
