import type { DbConnection, DbTypes } from '../db/connection.js';
import { canonical, hash, privacy, type Json } from '../changeReview/model.js';
import { ibSecretColumn, IB_SECTIONS } from '../model/ibOperations.js';

export type IbReviewKind = 'service' | 'operation';
export const ibReviewTables = (kind: IbReviewKind): string[] => kind === 'service'
    ? ['PSSERVICE', 'PSSERVICEOPR']
    : ['PSOPERATION', ...Object.values(IB_SECTIONS.operation).map(t => t.table), 'PSIBOPRROOT', 'PSOPRGENRTGPARM', 'PSSERVICEOPR', 'PSIBRTNGDEFN'];
export interface IbSnapshot { scope: 'ib-service-header/1' | 'ib-operation-header/1'; tables: Record<string, Record<string, Json>[]> }
export interface IbSnapshotRead { value: IbSnapshot; token: string; hash: string }
export interface IbSnapshotPreview { before: IbSnapshotRead; after: IbSnapshotRead }
const stamps = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
export function ibSnapshot(value: unknown, kind: IbReviewKind): IbSnapshot {
    const s = value as IbSnapshot | null, tables = ibReviewTables(kind);
    if (!s || s.scope !== `ib-${kind}-header/1` || !s.tables || Object.keys(s).sort().join() !== 'scope,tables' ||
        Object.keys(s.tables).sort().join() !== tables.sort().join() || tables.some(t => !Array.isArray(s.tables[t]) || s.tables[t].some(r => !r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => ibSecretColumn(k) || stamps.has(k)))))
        throw new Error('Incomplete or unsupported IB header checkpoint.');
    canonical(s); privacy(s as unknown as Json); return s;
}
/** Fixed noncredential preservation scope. Credentials are neither selected nor restored. */
export async function readIbSnapshot(c: DbConnection, types: DbTypes, kind: IbReviewKind, name: string): Promise<IbSnapshotRead> {
    if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(name)) throw new Error('Invalid IB review name.');
    const raw: IbSnapshot['tables'] = {}, tables: IbSnapshot['tables'] = {}, key = kind === 'service' ? 'IB_SERVICENAME' : 'IB_OPERATIONNAME';
    const sort = (a: Record<string, Json>, b: Record<string, Json>) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0;
    for (const table of ibReviewTables(kind)) {
        const columns = await c.catalog.columns(c, table);
        if (!columns.length || columns.some(col => !/^[A-Z][A-Z0-9_]*$/.test(col.name) || /TIME ZONE/.test(col.dataType)) || !columns.some(col => col.name === key)) throw new Error('Missing or unsupported IB snapshot schema: ' + table);
        const selected = columns.filter(col => !ibSecretColumn(col.name));
        const projection = selected.map(col => /^(DATE|TIMESTAMP)/.test(col.dataType) ? `TO_CHAR(CAST(${col.name} AS TIMESTAMP(9)), 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${col.name}` : col.name).join(', ');
        const fetchInfo = Object.fromEntries(selected.filter(col => /CLOB/.test(col.dataType)).map(col => [col.name, { type: types.STRING }]));
        const rows = (await c.execute<Record<string, unknown>>(`SELECT ${projection} FROM ${table} WHERE ${key} = :n`, { n: name }, { outFormat: types.OUT_FORMAT_OBJECT, fetchInfo })).rows ?? [];
        raw[table] = rows.map(row => {
            if (typeof row[key] !== 'string' || row[key].trim() !== name) throw new Error('IB checkpoint contains another definition.');
            return Object.fromEntries(selected.map(col => {
                const v = row[col.name];
                if (!(col.name in row) || !(v === null || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)))) throw new Error('Unsupported or omitted IB snapshot cell: ' + table + '.' + col.name);
                return [col.name, v as Json];
            }));
        }).sort(sort);
        tables[table] = raw[table].map(row => Object.fromEntries(Object.entries(row).filter(([k]) => !stamps.has(k)))).sort(sort);
    }
    const head = raw[kind === 'service' ? 'PSSERVICE' : 'PSOPERATION'];
    if (head.length !== 1 || typeof head[0].VERSION !== 'number' || head[0].VERSION < 0) throw new Error('IB review requires one versioned existing definition.');
    // A native handler deletion writes PSOPRHDLRDEL (ib01, PIA 8.62.09).
    // Tombstones are cache history, not logical definition content. Bind them to
    // concurrency without changing old checkpoint hashes or empty-marker tokens.
    if (kind === 'operation') {
        const columns = await c.catalog.columns(c, 'PSOPRHDLRDEL');
        if (columns.length) {
            if (columns.map(c => c.name).sort().join() !== 'HANDLERNAME,IB_OPERATIONNAME,VERSION') throw new Error('Unsupported IB handler deletion marker schema.');
            const markers = (await c.execute<Record<string, Json>>('SELECT IB_OPERATIONNAME,HANDLERNAME,VERSION FROM PSOPRHDLRDEL WHERE IB_OPERATIONNAME = :n', { n: name }, { outFormat: types.OUT_FORMAT_OBJECT })).rows ?? [];
            for (const row of markers) if (typeof row.IB_OPERATIONNAME !== 'string' || row.IB_OPERATIONNAME.trim() !== name || typeof row.HANDLERNAME !== 'string' || !row.HANDLERNAME.trim() || typeof row.VERSION !== 'number' || !Number.isSafeInteger(row.VERSION) || row.VERSION < 0) throw new Error('Invalid IB handler deletion marker.');
            if (markers.length) raw.PSOPRHDLRDEL = markers.sort(sort);
        }
    }
    const value: IbSnapshot = { scope: `ib-${kind}-header/1`, tables };
    ibSnapshot(value, kind);
    if (Buffer.byteLength(canonical(value)) > 8 * 1024 * 1024) throw new Error('IB checkpoint exceeds 8 MiB.');
    return { value, hash: hash(value), token: hash(raw) };
}
