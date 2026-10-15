import type { DbBinds, DbConnection } from '../../db/connection.js';
import { PAGE_SNAPSHOT_TABLES, type PageSnapshotTable } from '../../providers/pageSnapshot.js';

/** Transactional fixture for the existing Page writer; not a native database. */
export function pageTransaction(rows: Partial<Record<PageSnapshotTable, Record<string, unknown>[]>> = {}) {
    const initial = { page: { PNLNAME: 'ZZ_PREVIEW_PAGE', VERSION: 7, MAXPNLFLDID: Math.max(0, ...(rows.PSPNLFIELD ?? []).map(r => Number(r.PNLFLDID))), FIELDCOUNT: rows.PSPNLFIELD?.length ?? 0, DESCR: 'Original page', DESCRLONG: null as string | null,
        LASTUPDDTTM: '2026-10-15T10:00:00.123456789', LASTUPDOPRID: 'JARED',
        PNLTYPE: 0, PNLUSE: 35, PANELLEFT: 0, PANELTOP: 0, PANELRIGHT: 570, PANELBOTTOM: 330 }, pdm: 10, sys: 20, lock: 10,
        tables: Object.fromEntries(PAGE_SNAPSHOT_TABLES.filter(t => t !== 'PSPNLDEFN').map(t => [t, structuredClone(rows[t] ?? [])])) as Record<string, Record<string, unknown>[]> };
    let state = structuredClone(initial), durable = structuredClone(initial), committed = 0, rolledBack = 0, updates = 0, badReadback = false;
    const connection: DbConnection = {
        catalog: { columns: async (_c, table) => {
            if (!PAGE_SNAPSHOT_TABLES.includes(table as PageSnapshotTable)) throw new Error('Unexpected catalog request.');
            const records = table === 'PSPNLDEFN' ? [initial.page] : initial.tables[table];
            return [...new Set(['PNLNAME', ...records.flatMap(r => Object.keys(r))])].map(name => ({ name, dataType: /DESCRLONG|FFSTYLELONG|HTMLAREA/.test(name) ? 'CLOB' : name === 'LASTUPDDTTM' ? 'TIMESTAMP(9)' : 'VARCHAR2' }));
        }, tableExists: async () => true },
        async execute<T>(sql: string, binds: DbBinds = {}) {
            const b = binds as Record<string, unknown>, text = sql.replace(/\s+/g, ' ').trim();
            let rows: unknown[] = [], rowsAffected: number | undefined;
            if (text === 'SET TRANSACTION READ ONLY') rows = [];
            else if (text.includes('FROM PSOPRDEFN')) rows = [{ N: 1 }];
            else if (text.startsWith('SELECT') && text.includes('FROM PSPNLDEFN')) rows = [{ ...state.page, ...(badReadback && text.startsWith('SELECT VERSION, FIELDCOUNT') ? { VERSION: -1 } : {}) }];
            else if (text.includes('COUNT(*) AS N FROM PSPNLFIELD')) rows = [{ N: state.tables.PSPNLFIELD.length }];
            else if (text.startsWith('SELECT') && /FROM (PSPNL[A-Z0-9_]+|PSPTPNLRTEDITOR)\b/.test(text)) {
                const table = text.match(/FROM (PSPNL[A-Z0-9_]+|PSPTPNLRTEDITOR)\b/)![1];
                if (!(table in state.tables)) throw new Error('Unknown Page table: ' + table);
                rows = structuredClone(state.tables[table]);
            }
            else if (text.includes('FROM PSVERSION')) rows = [{ T: 'PDM', V: state.pdm }, { T: 'SYS', V: state.sys }];
            else if (text.includes('FROM PSLOCK')) rows = [{ V: state.lock }];
            else if (text.includes('FROM DUAL')) rows = [{ TS: '2026-10-15T10:00:00.000000' }];
            else if (/^UPDATE PSPNLFIELD(?:EXT)? SET /.test(text)) {
                const table = text.split(' ')[1], row = state.tables[table].find(r => r.PNLFLDID === b.id);
                if (!row) rowsAffected = 0;
                else {
                    for (const match of text.slice(text.indexOf(' SET ') + 5, text.indexOf(' WHERE ')).matchAll(/([A-Z0-9_]+)\s*=\s*(?::([a-z0-9_]+)|'((?:''|[^'])*)')/g)) {
                        const value = match[2] ? b[match[2]] : match[3].replace(/''/g, "'");
                        // Oracle character SECUREINVISIBLE retains its native type
                        // when the existing writer binds its numeric editor flag.
                        row[match[1]] = match[1] === 'SECUREINVISIBLE' && typeof row[match[1]] === 'string' ? String(value) : value;
                    }
                    rowsAffected = 1; updates++;
                }
            } else if (text.startsWith('UPDATE PSPNLDEFN')) {
                updates++;
                state.page.VERSION = Number(b.v); state.page.FIELDCOUNT = Number(b.fc); state.page.MAXPNLFLDID = Number(b.mx);
                for (const [key, value] of Object.entries(b)) if (key.startsWith('p_')) (state.page as Record<string, unknown>)[key.slice(2)] = value;
                rowsAffected = 1;
            } else if (text.startsWith('UPDATE PSVERSION')) {
                if (text.includes("'PDM'")) state.pdm = Number(b.v); else if (text.includes("'SYS'")) state.sys = Number(b.v); else throw new Error(text);
                rowsAffected = 1;
            } else if (text.startsWith('UPDATE PSLOCK')) { state.lock = Number(b.v); rowsAffected = 1; }
            else throw new Error('Unexpected Page writer SQL: ' + text);
            return { rows: rows as T[], ...(rowsAffected === undefined ? {} : { rowsAffected }) };
        },
        async commit() { committed++; durable = structuredClone(state); },
        async rollback() { rolledBack++; state = structuredClone(durable); },
        async close() {}
    };
    return { connection, initial, state: () => structuredClone(state), counts: () => ({ committed, rolledBack, updates }), failReadback: () => { badReadback = true; },
        editCommitted: (edit: (value: typeof initial) => void) => { edit(durable); state = structuredClone(durable); } };
}
