import type { DbConnection, DbTypes } from '../db/connection.js';
import { canonical, differences, hash, privacy, type Difference, type Json } from '../changeReview/model.js';
import type { ObjectDiffProvider } from '../changeReview/semanticDiff.js';
import { FIELD_USE_RELATED, RESTORABLE_CONTROL_TABLES, reviewedControlFields, type EditedControl, type PageSaveRequest, type RestoredControlRows } from './pageWriter.js';
import type { ColumnValues } from './pageControlTemplates.js';

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

/**
 * The typed editor request that reproduces a reviewed Page change: surviving controls' editor fields, deletions by
 * omission, inserted controls restored from their own reviewed rows under their native ids, the complete tab order and
 * the high-water mark. Never SQL row replay of arbitrary input: native preview must prove exact after-state equivalence.
 */
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
    const ext = (s: NativePageSnapshot, id: number) => s.tables.PSPNLFIELDEXT.find(r => r.PNLFLDID === id) as ColumnValues | undefined;
    const mapping = { fieldLeft: 'FIELDLEFT', fieldTop: 'FIELDTOP', fieldRight: 'FIELDRIGHT', fieldBottom: 'FIELDBOTTOM',
        editLblLeft: 'EDITLBLLEFT', editLblTop: 'EDITLBLTOP', editLblRight: 'EDITLBLRIGHT', editLblBottom: 'EDITLBLBOTTOM',
        fieldSizeType: 'FIELDSIZETYPE', lblType: 'LBLTYPE', fieldUse: 'FIELDUSE', secureInvisible: 'SECUREINVISIBLE' } as const;
    const inOrder = [...next.values()].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM));
    if (inOrder.some((r, i) => r.FIELDNUM !== i + 1)) throw new Error('Page proposal tab order is not a contiguous native FIELDNUM sequence.');
    const controls = inOrder.map(target => {
        const id = target.PNLFLDID as number;
        if (target.LBLTEXT !== null && typeof target.LBLTEXT !== 'string') throw new Error('Page control label requires native text.');
        const c = { pnlFldId: id, lblText: target.LBLTEXT ?? '' } as unknown as EditedControl;
        for (const [key, column] of Object.entries(mapping)) {
            // Oracle 8.62 HRDMO stores SECUREINVISIBLE as a character flag.
            // Match the existing reader/writer's numeric editor model without
            // changing the raw snapshot or coercing other native columns.
            const raw = target[column];
            const value = column === 'SECUREINVISIBLE' && (raw === '0' || raw === '1') ? Number(raw) : raw;
            if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Page geometry/use requires native integer values: ' + column);
            (c as unknown as Record<string, unknown>)[key] = value;
        }
        const was = old.get(id);
        if (!was) {
            // An inserted (or restored) control: its own reviewed rows, under the id native application assigns it.
            const restore: RestoredControlRows = {};
            for (const table of RESTORABLE_CONTROL_TABLES) {
                const rows = after.tables[table].filter(r => r.PNLFLDID === id);
                if (rows.length) restore[table] = rows as ColumnValues[];
            }
            return { ...c, restore };
        }
        const fields = reviewedControlFields({ field: was as ColumnValues, ext: ext(before, id) }, { field: target as ColumnValues, ext: ext(after, id) });
        const html = (s: NativePageSnapshot) => s.tables.PSPNLHTMLAREA.find(r => r.PNLFLDID === id)?.HTMLAREA ?? null;
        if (html(before) !== html(after)) fields.htmlConstant = html(after) as string | null;
        // A Related Field names its Related Control Field by identity: the writer numbers it in the final tab order.
        if (Number(target.FIELDUSE) & FIELD_USE_RELATED) {
            const control = inOrder[Number(target.ASSOCFIELDNUM ?? 0)];
            if (control) { fields.assocTarget = control.PNLFLDID as number; delete fields.assocFieldNum; }
        }
        // A scroll's own Occurs Level, and a Set to Level rule's: every other control's level is derived from the tab order.
        if ([10, 19, 27, 32].includes(Number(target.FIELDTYPE)) || (Number(target.FIELDTYPE) === 23 && Number(target.FIELDUSE) & 0x2)) {
            if (target.OCCURSLEVEL !== was.OCCURSLEVEL) fields.occursLevel = Number(target.OCCURSLEVEL);
        }
        return { ...c, ...fields };
    });
    const head = after.tables.PSPNLDEFN[0];
    if (typeof head.DESCR !== 'string' || head.DESCRLONG !== null && typeof head.DESCRLONG !== 'string') throw new Error('Page description/comments must be native text.');
    if (typeof head.MAXPNLFLDID !== 'number' || !Number.isSafeInteger(head.MAXPNLFLDID)) throw new Error('Page high-water mark requires a native integer.');
    return { pnlName: name, openedVersion: version, operatorId, controls, order: inOrder.map(r => r.PNLFLDID as number), maxPnlFldId: head.MAXPNLFLDID,
        properties: { description: head.DESCR, comments: head.DESCRLONG ?? '' } };
}

/** Why an applied Page change has no exact typed inverse: a deleted Tree's levels are keyed by its tab place and cannot be restored. */
export function pageReversalRefusal(beforeValue: unknown, afterValue: unknown): string | undefined {
    const before = nativePageSnapshot(beforeValue), after = nativePageSnapshot(afterValue);
    const kept = new Set(after.tables.PSPNLFIELD.map(r => r.PNLFLDID));
    if (before.tables.PSPNLFIELD.some(r => !kept.has(r.PNLFLDID) && r.FIELDTYPE === 20)) return 'Undoing a deleted Tree is not supported: its levels are keyed by its tab place.';
    return undefined;
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
