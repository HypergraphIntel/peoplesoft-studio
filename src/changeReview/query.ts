import type { QueryView, Row } from '../model/queryDefinition.js';
import { canonical, type Json } from './model.js';
const stamps = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID', 'CREATEOPRID', 'CREATEDTTM', 'CAPTURE_ROWID', 'LASTUPD']);
/** Query rows retain semantic/native values; only writer-controlled stamps are omitted. */
export function querySnapshot(view: QueryView): Json {
    const row = (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([k]) => !stamps.has(k)));
    const rows = (rs: Row[]) => rs.map(row).sort((a, b) => canonical(a).localeCompare(canonical(b)));
    return { query: row(view.query), selects: rows(view.selects), records: rows(view.records), fields: rows(view.fields), criteria: rows(view.criteria), expressions: rows(view.expressions), binds: rows(view.binds) } as Json;
}
export function queryView(value: Json): QueryView {
    if (!value || Array.isArray(value) || typeof value !== 'object')
        throw new Error('Invalid Query snapshot.');
    const v = value as unknown as QueryView;
    if (!v.query || typeof v.query !== 'object' || ['selects', 'records', 'fields', 'criteria', 'expressions', 'binds'].some(k => !Array.isArray((value as Record<string, Json>)[k])))
        throw new Error('Incomplete Query snapshot.');
    return structuredClone(v);
}
