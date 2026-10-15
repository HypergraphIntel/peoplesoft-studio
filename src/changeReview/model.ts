import { createHash, randomUUID } from 'node:crypto';
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export type Status = 'DRAFT' | 'VALIDATING' | 'READY_FOR_REVIEW' | 'APPROVED' | 'APPLYING' | 'APPLIED' | 'REJECTED' | 'CANCELLED' | 'CONFLICTED' | 'FAILED' | 'PARTIALLY_APPLIED' | 'REVERTED';
export interface Environment {
    connection: string;
    identity: string;
    label: string;
}
export interface Snapshot {
    value: Json;
    token: string;
    authorization?: string;
}
export interface Change {
    id: string;
    adapter: string;
    key: Json;
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
    before: string;
    after: string;
    baselineToken: string;
    dependencies: string[];
    revision: number;
    review: 'PENDING' | 'APPROVED' | 'REJECTED';
    approvedHash?: string;
    authorizationStamp?: string;
    validation: string[];
    warnings: string[];
    application: 'PENDING' | 'APPLYING' | 'VERIFIED' | 'UNCERTAIN';
    verified?: string;
    verifiedToken?: string;
    resultKnown?: boolean;
}
export interface Entry {
    at: string;
    action: string;
    object?: string;
    detail?: string;
}
export interface ChangeSet {
    schema: 1;
    id: string;
    title: string;
    description: string;
    created: string;
    updated: string;
    origin: 'agent' | 'manual' | 'reversal';
    session?: string;
    environment: Environment;
    status: Status;
    revision: number;
    objects: Change[];
    journal: Entry[];
    checkpoint?: {
        at: string;
        objects: {
            id: string;
            snapshot: string;
            token: string;
        }[];
    };
    reverses?: string;
    requestKey?: string;
    requestHash?: string;
    plan?: {
        text: string;
        revision: number;
        review: 'PENDING' | 'APPROVED' | 'REJECTED';
        approvedHash?: string;
    };
}
export function canonical(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
        return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
    throw new Error('Snapshots require plain JSON without undefined, special objects or nonfinite numbers.');
}
export const hash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export const now = (): string => new Date().toISOString();
export function privacy(value: Json): void {
    const visit = (v: Json): void => {
        if (v && !Array.isArray(v) && typeof v === 'object')
            for (const [k, x] of Object.entries(v)) {
                if (/(?:password|passwd|client.?secret|access.?token|refresh.?token|private.?key|credential)/i.test(k) && x !== null && x !== '')
                    throw new Error('Snapshot contains a credential-related field; this adapter cannot retain it.');
                visit(x);
            }
        else if (Array.isArray(v))
            v.forEach(visit);
        else if (typeof v === 'string' && /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|https?:\/\/[^\s/]+:[^\s/]+@|\b(?:password|passwd|client_secret)\s*[:=]\s*["'][^"']+["']|\bBearer\s+[A-Za-z0-9_.-]{16,}|\bgh[pousr]_[A-Za-z0-9]{25,}/i.test(v))
            throw new Error('Potential secret in snapshot; staging refused.');
    };
    canonical(value);
    visit(value);
}
export function createSet(title: string, environment: Environment, origin: ChangeSet['origin'] = 'agent', session?: string): ChangeSet {
    if (!title.trim() || !environment.identity || !environment.connection)
        throw new Error('Title and verified environment are required.');
    return { schema: 1, id: randomUUID(), title: title.trim(), description: '', created: now(), updated: now(), origin, ...(session ? { session } : {}), environment, status: 'DRAFT', revision: 1, objects: [], journal: [] };
}
const transitions: Record<Status, Status[]> = {
    DRAFT: ['VALIDATING', 'CANCELLED', 'REJECTED'], VALIDATING: ['READY_FOR_REVIEW', 'CONFLICTED', 'FAILED'],
    READY_FOR_REVIEW: ['DRAFT', 'VALIDATING', 'APPROVED', 'REJECTED', 'CANCELLED'], APPROVED: ['DRAFT', 'VALIDATING', 'APPLYING', 'CANCELLED', 'REJECTED'],
    APPLYING: ['APPLIED', 'FAILED', 'PARTIALLY_APPLIED', 'CONFLICTED'], APPLIED: ['REVERTED'],
    REJECTED: [], CANCELLED: [], CONFLICTED: ['DRAFT', 'VALIDATING'], FAILED: ['DRAFT', 'VALIDATING'], PARTIALLY_APPLIED: [], REVERTED: []
};
export function transition(set: ChangeSet, next: Status): void {
    if (!transitions[set.status]?.includes(next))
        throw new Error(`Invalid Change Set transition ${set.status} -> ${next}.`);
    set.status = next;
    set.updated = now();
    set.journal.push({ at: now(), action: next });
}
export function planHash(set: ChangeSet): string { return hash({ environment: set.environment, plan: set.plan ? { text: set.plan.text, revision: set.plan.revision } : null }); }
export function approvalHash(set: ChangeSet, change: Change): string {
    return hash({ environment: set.environment, revision: set.revision, object: change.id, adapter: change.adapter, key: change.key,
        before: change.before, after: change.after, token: change.baselineToken, dependencies: change.dependencies, operation: change.operation, objectRevision: change.revision, authorization: change.authorizationStamp ?? null });
}
export function ordered(set: ChangeSet, approvedOnly = true): Change[] {
    const selected = set.objects.filter(c => !approvedOnly || c.review === 'APPROVED');
    const found = new Set<string>(), active = new Set<string>(), result: Change[] = [];
    const visit = (c: Change) => {
        if (found.has(c.id))
            return;
        if (active.has(c.id))
            throw new Error('Cyclic Change Set dependencies.');
        active.add(c.id);
        for (const dep of c.dependencies) {
            const d = selected.find(x => x.id === dep);
            if (!d)
                throw new Error('Missing or unapproved dependency: ' + dep);
            visit(d);
        }
        active.delete(c.id);
        found.add(c.id);
        result.push(c);
    };
    selected.forEach(visit);
    return result;
}
export interface Difference {
    path: string;
    kind: 'ADD' | 'REMOVE' | 'MODIFY' | 'MOVE' | 'AMBIGUOUS';
    before?: Json;
    after?: Json;
}
export function differences(before: Json, after: Json, path = '$'): Difference[] {
    if (canonical(before) === canonical(after))
        return [];
    if (before === null)
        return [{ path, kind: 'ADD', after }];
    if (after === null)
        return [{ path, kind: 'REMOVE', before }];
    if (Array.isArray(before) && Array.isArray(after)) {
        // Only scalar arrays have established identity here. Structured arrays are
        // compared by position, explicitly ambiguous until an object adapter matches them.
        if ([...before, ...after].every(v => typeof v === 'string')) {
            if (new Set(before).size !== before.length || new Set(after).size !== after.length)
                return [{ path, kind: 'AMBIGUOUS', before, after }];
            const result: Difference[] = [];
            before.forEach((v, i) => {
                const j = after.indexOf(v);
                if (j < 0)
                    result.push({ path: `${path}[${i}]`, kind: 'REMOVE', before: v });
                else if (i !== j)
                    result.push({ path: `${path}[${i}]`, kind: 'MOVE', before: i, after: j });
            });
            after.forEach((v, i) => {
                if (!before.includes(v))
                    result.push({ path: `${path}[${i}]`, kind: 'ADD', after: v });
            });
            return result;
        }
        return [{ path, kind: 'AMBIGUOUS', before, after }];
    }
    if (!Array.isArray(before) && !Array.isArray(after) && typeof before === 'object' && typeof after === 'object') {
        return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(k => !(k in before) ? [{ path: path + '.' + k, kind: 'ADD' as const, after: after[k] }] : !(k in after) ? [{ path: path + '.' + k, kind: 'REMOVE' as const, before: before[k] }] : differences(before[k], after[k], path + '.' + k));
    }
    return [{ path, kind: 'MODIFY', before, after }];
}
