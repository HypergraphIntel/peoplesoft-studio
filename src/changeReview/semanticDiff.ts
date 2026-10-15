import { canonical, differences, type Difference, type Json } from './model.js';
export interface ObjectDiffProvider {
    id: string;
    compare(before: Json, after: Json): Difference[];
}
type Obj = {
    [key: string]: Json;
};
function sequence(before: Json[], after: Json[], identity: (v: Json) => string | undefined, path: string): Difference[] {
    const a = before.map(identity), b = after.map(identity);
    if (a.some(x => !x) || b.some(x => !x) || new Set(a).size !== a.length || new Set(b).size !== b.length)
        return [{ path, kind: 'AMBIGUOUS', before, after }];
    const result: Difference[] = [];
    before.forEach((v, i) => {
        const j = b.indexOf(a[i]);
        if (j < 0)
            result.push({ path: `${path}[${a[i]}]`, kind: 'REMOVE', before: v });
        else {
            if (i !== j)
                result.push({ path: `${path}[${a[i]}]`, kind: 'MOVE', before: i, after: j });
            result.push(...differences(v, after[j], `${path}[${a[i]}]`));
        }
    });
    after.forEach((v, i) => {
        if (!a.includes(b[i]))
            result.push({ path: `${path}[${b[i]}]`, kind: 'ADD', after: v });
    });
    return result;
}
const obj = (v: Json): Obj | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
const named = (v: Json): string | undefined => { const o = obj(v); return typeof o?.name === 'string' ? o.name : undefined; };
/** Same-page persisted PNLFLDID is the identity, not FIELDNUM/storage ordering. */
export const pageDiff: ObjectDiffProvider = { id: 'page', compare(before, after) {
        const a = obj(before), b = obj(after);
        if (!a || !b || !Array.isArray(a.controls) || !Array.isArray(b.controls))
            return differences(before, after);
        const strip = (v: Json): Json => { const o = obj(v); return o ? Object.fromEntries(Object.entries(o).filter(([k]) => !['fieldNum', 'version', 'lastUpdate', 'lastOperator'].includes(k))) : v; };
        const identity = (v: Json) => { const id = obj(v)?.pnlFldId; return typeof id === 'number' && id > 0 ? String(id) : undefined; };
        const { controls: _ac, ...ap } = a, { controls: _bc, ...bp } = b;
        return [...differences(ap, bp), ...sequence(a.controls.map(strip), b.controls.map(strip), identity, '$.controls')];
    } };
/** AE spec identities are section+variant, step name within variant and action type within step. */
export const aeDiff: ObjectDiffProvider = { id: 'ae', compare(before, after) {
        const a = obj(before), b = obj(after);
        if (!a || !b || !Array.isArray(a.sections) || !Array.isArray(b.sections))
            return differences(before, after);
        const section = (v: Json) => { const o = obj(v); return o && typeof o.name === 'string' ? canonical([o.name, o.market ?? 'GBL', o.platform ?? 'default', o.effectiveDate ?? '1900-01-01']) : undefined; };
        const { sections: _a, ...ap } = a, { sections: _b, ...bp } = b;
        const result = differences(ap, bp);
        const shallow = sequence(a.sections, b.sections, section, '$.sections');
        // Replace generic array ambiguity only where the native hierarchy establishes unique identities.
        result.push(...shallow.filter(d => !d.path.endsWith('.steps')));
        for (const oldSection of a.sections) {
            const key = section(oldSection), match = b.sections.find(s => section(s) === key), x = obj(oldSection), y = match ? obj(match) : undefined;
            if (!x || !y || !Array.isArray(x.steps) || !Array.isArray(y.steps))
                continue;
            const path = '$.sections[' + key + '].steps';
            result.push(...sequence(x.steps, y.steps, named, path).filter(d => !d.path.endsWith('.actions')));
            for (const oldStep of x.steps) {
                const n = named(oldStep), matchStep = y.steps.find(s => named(s) === n), u = obj(oldStep), v = matchStep ? obj(matchStep) : undefined;
                if (u && v && Array.isArray(u.actions) && Array.isArray(v.actions))
                    result.push(...sequence(u.actions, v.actions, z => typeof obj(z)?.type === 'string' ? String(obj(z)!.type) : undefined, path + '[' + n + '].actions'));
            }
        }
        return result;
    } };
export const recordDiff: ObjectDiffProvider = { id: 'record', compare(before, after) {
        const a = obj(before), b = obj(after);
        if (!a || !b || !Array.isArray(a.fields) || !Array.isArray(b.fields))
            return differences(before, after);
        const { fields: _a, ...ap } = a, { fields: _b, ...bp } = b;
        return [...differences(ap, bp), ...sequence(a.fields, b.fields, named, '$.fields')];
    } };
export const queryDiff: ObjectDiffProvider = { id: 'query', compare(before, after) {
        const a = obj(before), b = obj(after);
        if (!a || !b)
            return differences(before, after);
        const keys: Record<string, string[]> = { selects: ['SELNUM'], records: ['SELNUM', 'RCDNUM'], fields: ['SELNUM', 'FLDNUM'], criteria: ['SELNUM', 'CRTNUM'], expressions: ['EXPNUM'], binds: ['BNDNUM'] };
        const result: Difference[] = [];
        for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
            const x = a[name] ?? null, y = b[name] ?? null, cols = keys[name];
            if (cols && Array.isArray(x) && Array.isArray(y))
                result.push(...sequence(x, y, v => { const o = obj(v); return o && cols.every(c => o[c] !== undefined) ? canonical(cols.map(c => o[c])) : undefined; }, '$.' + name).filter(d => d.kind !== 'MOVE'));
            else
                result.push(...differences(x, y, '$.' + name));
        }
        return result;
    } };
