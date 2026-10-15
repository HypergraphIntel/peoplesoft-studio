import type { DbConnection, DbTypes } from '../db/connection.js';
import { canonical, differences, hash, privacy, type Difference, type Json } from '../changeReview/model.js';
import type { ObjectDiffProvider } from '../changeReview/semanticDiff.js';
import type { EditedControl, PageSaveRequest } from './pageWriter.js';

/** Exactly the native tables changed by the current Page writer; not a universal dependency closure. */
export const PAGE_SNAPSHOT_TABLES = ['PSPNLDEFN', 'PSPNLFIELD', 'PSPNLFIELDEXT', 'PSPNLHTMLAREA', 'PSPNLHTMLLANG',
    'PSPTPNLRTEDITOR', 'PSPNLCNTRLDATA', 'PSPNLBTNDATA', 'PSPNLACEGRDDATA', 'PSPNLACEGRDAXIS', 'PSPNLTREECTRL'] as const;
export type PageSnapshotTable = typeof PAGE_SNAPSHOT_TABLES[number];
export type PageRow = { [key: string]: Json };
export interface NativePageSnapshot {
    scope: 'page-writer-tables/1';
    tables: Record<PageSnapshotTable, PageRow[]>;
}
export interface PageSnapshotRead {
    value: NativePageSnapshot;
    version: number;
    token: string;
    hash: string;
}
export interface PagePreviewSnapshots {
    schema: 'page-preview/1';
    before: PageSnapshotRead;
    after: PageSnapshotRead;
}

function cell(value: unknown): Json {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
    // DATE/TIMESTAMP columns are selected as native full-precision text, never JS Date.
    throw new Error('Page snapshot contains an unsupported native value; no partial snapshot is retained.');
}

/** Called in the writer's locked transaction or an explicitly consistent read transaction. */
export async function readPageSnapshot(c: DbConnection, types: DbTypes, name: string): Promise<PageSnapshotRead> {
    if (!/^[A-Z][A-Z0-9_#@$]{0,17}$/.test(name)) throw new Error('Invalid Page snapshot key.');
    const tables = {} as NativePageSnapshot['tables'];
    let version: number | undefined;
    for (const table of PAGE_SNAPSHOT_TABLES) {
        const columns = await c.catalog.columns(c, table);
        if (!columns.length || !columns.some(col => col.name === 'PNLNAME')) throw new Error('Page snapshot table is missing or incompatible: ' + table);
        if (columns.some(col => !/^[A-Z][A-Z0-9_]*$/.test(col.name))) throw new Error('Unsupported Page snapshot column name.');
        if (columns.some(col => /TIME ZONE/.test(col.dataType))) throw new Error('Time-zone Page columns need a lossless snapshot adapter.');
        const projection = columns.map(col => /^(DATE|TIMESTAMP)/.test(col.dataType)
            ? `TO_CHAR(CAST(${col.name} AS TIMESTAMP(9)), 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${col.name}` : col.name).join(', ');
        const fetchInfo = Object.fromEntries(columns.filter(col => /CLOB/.test(col.dataType)).map(col => [col.name, { type: types.STRING }]));
        const rows = (await c.execute<Record<string, unknown>>(`SELECT ${projection} FROM ${table} WHERE PNLNAME = :n`, { n: name }, { outFormat: types.OUT_FORMAT_OBJECT, fetchInfo })).rows ?? [];
        if (table === 'PSPNLDEFN') {
            if (rows.length !== 1 || typeof rows[0].VERSION !== 'number' || !Number.isSafeInteger(rows[0].VERSION) || rows[0].VERSION < 0) throw new Error('Page snapshot requires one versioned native definition.');
            version = rows[0].VERSION;
        }
        tables[table] = rows.map(raw => {
            if (typeof raw.PNLNAME !== 'string' || raw.PNLNAME.trim() !== name) throw new Error('Page snapshot contains another object.');
            const row: PageRow = {};
            for (const col of columns) {
                if (table === 'PSPNLDEFN' && ['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID'].includes(col.name)) continue;
                if (!(col.name in raw)) throw new Error('Page snapshot omitted native column: ' + col.name);
                row[col.name] = cell(raw[col.name]);
            }
            return row;
        }).sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
    }
    const value: NativePageSnapshot = { scope: 'page-writer-tables/1', tables };
    privacy(value as unknown as Json);
    if (Buffer.byteLength(canonical(value)) > 8 * 1024 * 1024) throw new Error('Page snapshot exceeds the 8 MiB limit.');
    return { value, version: version!, hash: hash(value), token: hash({ version: version!, value }) };
}

export function nativePageSnapshot(value: unknown): NativePageSnapshot {
    const v = value as NativePageSnapshot | null;
    if (!v || v.scope !== 'page-writer-tables/1' || !v.tables || Object.keys(v).sort().join(',') !== 'scope,tables'
        || Object.keys(v.tables).sort().join(',') !== [...PAGE_SNAPSHOT_TABLES].sort().join(',')
        || PAGE_SNAPSHOT_TABLES.some(t => !Array.isArray(v.tables[t]) || v.tables[t].some(r => !r || typeof r !== 'object' || Array.isArray(r))))
        throw new Error('Incomplete native Page snapshot.');
    canonical(v);
    return v;
}

/** Typed editor request only, never SQL row replay. Native preview must prove exact after-state equivalence. */
export function requestForPageSnapshot(name: string, beforeValue: unknown, afterValue: unknown, version: number, operatorId: string): PageSaveRequest {
    const before = nativePageSnapshot(beforeValue), after = nativePageSnapshot(afterValue);
    for (const snapshot of [before, after]) {
        if (snapshot.tables.PSPNLDEFN.length !== 1 || PAGE_SNAPSHOT_TABLES.some(t => snapshot.tables[t].some(r => typeof r.PNLNAME !== 'string' || r.PNLNAME.trim() !== name)))
            throw new Error('Page snapshot must identify one existing Page.');
    }
    const byId = (rows: PageRow[]) => {
        const map = new Map<number, PageRow>();
        for (const r of rows) {
            if (typeof r.PNLFLDID !== 'number' || !Number.isSafeInteger(r.PNLFLDID) || r.PNLFLDID <= 0 || map.has(r.PNLFLDID)) throw new Error('Ambiguous native Page control identity.');
            map.set(r.PNLFLDID, r);
        }
        return map;
    };
    const old = byId(before.tables.PSPNLFIELD), next = byId(after.tables.PSPNLFIELD);
    if (old.size !== next.size || [...old.keys()].some(id => !next.has(id))) throw new Error('Page review does not support inserting or deleting controls.');
    const mapping = { fieldLeft: 'FIELDLEFT', fieldTop: 'FIELDTOP', fieldRight: 'FIELDRIGHT', fieldBottom: 'FIELDBOTTOM',
        editLblLeft: 'EDITLBLLEFT', editLblTop: 'EDITLBLTOP', editLblRight: 'EDITLBLRIGHT', editLblBottom: 'EDITLBLBOTTOM',
        fieldSizeType: 'FIELDSIZETYPE', lblType: 'LBLTYPE', fieldUse: 'FIELDUSE', secureInvisible: 'SECUREINVISIBLE' } as const;
    const controls = [...old.values()].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM)).map(r => {
        const target = next.get(r.PNLFLDID as number)!;
        if (target.LBLTEXT !== null && typeof target.LBLTEXT !== 'string') throw new Error('Page control label requires native text.');
        const c = { pnlFldId: r.PNLFLDID, lblText: target.LBLTEXT ?? '' } as unknown as EditedControl;
        for (const [key, column] of Object.entries(mapping)) {
            // Oracle 8.62 HRDMO stores SECUREINVISIBLE as a character flag.
            // Match the existing reader/writer's numeric editor model without
            // changing the raw snapshot or coercing other native columns.
            const raw = target[column];
            const value = column === 'SECUREINVISIBLE' && (raw === '0' || raw === '1') ? Number(raw) : raw;
            if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Page geometry/use requires native integer values: ' + column);
            (c as unknown as Record<string, unknown>)[key] = value;
        }
        return c;
    });
    const head = after.tables.PSPNLDEFN[0];
    if (typeof head.DESCR !== 'string' || head.DESCRLONG !== null && typeof head.DESCRLONG !== 'string') throw new Error('Page description/comments must be native text.');
    return { pnlName: name, openedVersion: version, operatorId, controls, properties: { description: head.DESCR, comments: head.DESCRLONG ?? '' } };
}

export const nativePageDiff: ObjectDiffProvider = { id: 'page-native', compare(before, after) {
    const a = nativePageSnapshot(before), b = nativePageSnapshot(after), out: Difference[] = [];
    for (const table of PAGE_SNAPSHOT_TABLES) {
        const x = a.tables[table], y = b.tables[table], path = '$.tables.' + table;
        if (table === 'PSPNLDEFN') { out.push(...differences(x[0] ?? null, y[0] ?? null, path)); continue; }
        if (!['PSPNLFIELD', 'PSPNLFIELDEXT', 'PSPNLHTMLAREA', 'PSPTPNLRTEDITOR'].includes(table)) { out.push(...differences(x, y, path)); continue; }
        const valid = (rs: PageRow[]) => rs.every(r => typeof r.PNLFLDID === 'number' && r.PNLFLDID > 0) && new Set(rs.map(r => r.PNLFLDID)).size === rs.length;
        if (!valid(x) || !valid(y)) { out.push({ path, kind: 'AMBIGUOUS', before: x, after: y }); continue; }
        const ids = new Set([...x, ...y].map(r => r.PNLFLDID));
        for (const id of ids) out.push(...differences(x.find(r => r.PNLFLDID === id) ?? null, y.find(r => r.PNLFLDID === id) ?? null, path + '[' + String(id) + ']'));
    }
    return out;
} };
