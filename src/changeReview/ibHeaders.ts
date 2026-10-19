import { canonical, differences, type Json } from './model.js';
import { ibSnapshot, type IbReviewKind } from '../providers/ibSnapshot.js';
import { inputForIb, type IbWriteInput } from '../model/ibOperations.js';
import type { IbDocument } from '../model/ibDocument.js';
import type { ObjectDiffProvider } from './semanticDiff.js';

export function ibHeaderChange(beforeValue: unknown, afterValue: unknown, kind: IbReviewKind, name: string) {
    const before = ibSnapshot(beforeValue, kind), after = ibSnapshot(afterValue, kind), table = kind === 'service' ? 'PSSERVICE' : 'PSOPERATION', key = kind === 'service' ? 'IB_SERVICENAME' : 'IB_OPERATIONNAME';
    for (const s of [before, after]) if (s.tables[table].length !== 1 || String(s.tables[table][0][key]).trim() !== name) throw new Error('IB checkpoint identifies another definition.');
    const strip = (s: typeof before) => ({ ...s, tables: { ...s.tables, [table]: [Object.fromEntries(Object.entries(s.tables[table][0]).filter(([k]) => !['DESCR', 'DESCRLONG'].includes(k)))] } });
    if (canonical(strip(before)) !== canonical(strip(after))) throw new Error('Only existing IB description/comments edits are supported in Change Review.');
    const head = after.tables[table][0];
    if (typeof head.DESCR !== 'string' || head.DESCR.length > 30 || !(head.DESCRLONG === null || typeof head.DESCRLONG === 'string')) throw new Error('IB description/comments have invalid values.');
    return { DESCR: head.DESCR, DESCRLONG: head.DESCRLONG };
}
export function ibHeaderInput(before: unknown, after: unknown, kind: IbReviewKind, name: string, live: IbDocument): IbWriteInput {
    if (live.kind !== kind || live.key.length !== 1 || live.key[0] !== name) throw new Error('IB live definition does not match the checkpoint.');
    const changes = ibHeaderChange(before, after, kind, name), input = inputForIb(live);
    return { ...input, properties: { ...input.properties, ...changes }, sections: {} };
}
/** A full psft_ib_get input qualifies only if its sole changes are these two columns. */
export function isIbHeaderInput(live: IbDocument, input: IbWriteInput): boolean {
    if (!['service', 'operation'].includes(live.kind)) return false;
    const before = inputForIb(live);
    const withoutHeader = (i: IbWriteInput) => ({ ...Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)), properties: Object.fromEntries(Object.entries(i.properties).filter(([k]) => !['DESCR', 'DESCRLONG'].includes(k))), sections: {} });
    return canonical(withoutHeader(before)) === canonical(withoutHeader(input)) && Object.entries(input.sections).every(([name, rows]) => canonical(rows) === canonical(before.sections[name] ?? null));
}
export function ibHeaderProposal(value: Json, kind: IbReviewKind, properties: IbWriteInput['properties']): Json {
    const s = structuredClone(ibSnapshot(value, kind)), table = kind === 'service' ? 'PSSERVICE' : 'PSOPERATION';
    if (s.tables[table].length !== 1) throw new Error('IB header requires an existing definition.');
    for (const k of ['DESCR', 'DESCRLONG']) if (k in properties) s.tables[table][0][k] = k === 'DESCRLONG' && properties[k] === '' ? null : properties[k];
    return s as unknown as Json;
}
export function ibHeaderDiff(kind: IbReviewKind): ObjectDiffProvider {
    return { id: `ib-${kind}-header`, compare(before, after) {
        const a = ibSnapshot(before, kind), b = ibSnapshot(after, kind), head = kind === 'service' ? 'PSSERVICE' : 'PSOPERATION';
        return Object.keys(a.tables).flatMap(t => differences(t === head ? a.tables[t][0] : a.tables[t], t === head ? b.tables[t][0] : b.tables[t], '$.tables.' + t));
    } };
}
