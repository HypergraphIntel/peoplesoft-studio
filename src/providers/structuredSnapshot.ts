import type { DbConnection, DbTypes } from '../db/connection.js';
import { canonical, hash, privacy, type Json } from '../changeReview/model.js';

export type StructuredFamily = 'record' | 'ae';
export type NativeRow = Record<string, Json>;
export interface StructuredSnapshot { scope: 'record-header/1' | 'ae-header/1'; tables: Record<string, NativeRow[]> }
export interface StructuredRead { value: StructuredSnapshot; token: string; hash: string; version: number }
export interface StructuredPreview { schema: 'structured-preview/1'; before: StructuredRead; after: StructuredRead }
export const RECORD_REVIEW_TABLES = ['PSRECDEFN', 'PSRECFIELD', 'PSRECFIELDDB', 'PSINDEXDEFN', 'PSKEYDEFN', 'PSRECTBLSPC'] as const;
export const AE_REVIEW_TABLES = ['PSAEAPPLDEFN', 'PSAEAPPLSTATE', 'PSAEAPPLTEMPTBL', 'PSAEAPPLLANG', 'PSAESECTDEFN', 'PSAESECTDTLDEFN',
    'PSAESTEPDEFN', 'PSAESTMTDEFN', 'PSAESTEPMSGDEFN', 'PSSQLDEFN', 'PSSQLDESCR', 'PSSQLTEXTDEFN', 'PSSQLHASH',
    'PSPCMPROG', 'PSPCMTXT', 'PSPCMNAME', 'PSAEAPPLDEL', 'PSAESECTDEL', 'PSSQLDEL', 'PSPCMPROGDEL'] as const;
const stamps = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
function nativeCell(value: unknown): Json {
    if (Buffer.isBuffer(value)) return { nativeBinaryHex: value.toString('hex') };
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
    throw new Error('Unsupported native structured snapshot value; no incomplete checkpoint retained.');
}
export function structuredSnapshot(value: unknown, family: StructuredFamily): StructuredSnapshot {
    const s = value as StructuredSnapshot | null, tables = family === 'record' ? RECORD_REVIEW_TABLES : AE_REVIEW_TABLES;
    if (!s || s.scope !== family + '-header/1' || !s.tables || Object.keys(s).sort().join(',') !== 'scope,tables' ||
        Object.keys(s.tables).sort().join(',') !== [...tables].sort().join(',') || tables.some(t => !Array.isArray(s.tables[t]) || s.tables[t].some(r => !r || typeof r !== 'object' || Array.isArray(r))))
        throw new Error('Incomplete ' + family + ' header checkpoint.');
    canonical(s); return s;
}

/** Fixed metadata scope for bounded existing-definition header edits. No row replay. */
export async function readStructuredSnapshot(c: DbConnection, types: DbTypes, family: StructuredFamily, name: string): Promise<StructuredRead> {
    if (!(family === 'record' ? /^[A-Z][A-Z0-9_]{0,14}$/ : /^[A-Z][A-Z0-9_]{0,11}$/).test(name)) throw new Error('Invalid structured definition name.');
    const tableNames = family === 'record' ? RECORD_REVIEW_TABLES : AE_REVIEW_TABLES, tables: Record<string, NativeRow[]> = {}, raw: Record<string, NativeRow[]> = {};
    let version: number | undefined;
    for (const table of tableNames) {
        const columns = await c.catalog.columns(c, table);
        if (!columns.length || columns.some(col => !/^[A-Z][A-Z0-9_]*$/.test(col.name) || /TIME ZONE/.test(col.dataType))) throw new Error('Missing or unsupported native snapshot schema: ' + table);
        const key = family === 'record' ? 'RECNAME' : table.startsWith('PSSQL') ? 'SQLID' : table.startsWith('PSPCM') ? 'OBJECTVALUE1' : 'AE_APPLID';
        if (!columns.some(col => col.name === key)) throw new Error('Missing native snapshot key: ' + table);
        const where = family === 'record' ? 'RECNAME = :n' : table.startsWith('PSSQL') ? "SUBSTR(SQLID, 1, 12) = RPAD(:n, 12) AND SQLTYPE IN ('1', '6')"
            : table.startsWith('PSPCM') ? 'OBJECTID1 = 66 AND OBJECTVALUE1 = :n' : 'AE_APPLID = :n';
        const projection = columns.map(col => /^(DATE|TIMESTAMP)/.test(col.dataType) ? `TO_CHAR(CAST(${col.name} AS TIMESTAMP(9)), 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${col.name}` : col.name).join(', ');
        const fetchInfo = Object.fromEntries(columns.filter(col => /CLOB/.test(col.dataType)).map(col => [col.name, { type: types.STRING }]));
        const rows = (await c.execute<Record<string, unknown>>(`SELECT ${projection} FROM ${table} WHERE ${where}`, { n: name }, { outFormat: types.OUT_FORMAT_OBJECT, fetchInfo })).rows ?? [];
        raw[table] = rows.map(row => {
            if (typeof row[key] !== 'string' || (key === 'SQLID' ? row[key].slice(0, 12).trim() : row[key].trim()) !== name) throw new Error('Snapshot contains another definition: ' + table);
            return Object.fromEntries(columns.map(col => {
                if (!(col.name in row)) throw new Error('Snapshot omitted column: ' + table + '.' + col.name);
                return [col.name, nativeCell(row[col.name])];
            }));
        }).sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
        tables[table] = raw[table].map(row => Object.fromEntries(Object.entries(row).filter(([k]) => !stamps.has(k))))
            .sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
        if (table === tableNames[0]) {
            if (rows.length !== 1 || typeof rows[0].VERSION !== 'number' || !Number.isSafeInteger(rows[0].VERSION) || rows[0].VERSION < 0) throw new Error('Snapshot requires one versioned existing definition.');
            version = rows[0].VERSION;
        }
    }
    const value: StructuredSnapshot = { scope: family === 'record' ? 'record-header/1' : 'ae-header/1', tables };
    privacy(value as unknown as Json);
    if (Buffer.byteLength(canonical(value)) > 8 * 1024 * 1024) throw new Error('Structured checkpoint exceeds 8 MiB.');
    return { value, version: version!, hash: hash(value), token: hash(raw) };
}
