import { ADAPTER_TYPES, type DbBinds, type DbConnection } from '../../db/connection.js';
import { AE_REVIEW_TABLES, RECORD_REVIEW_TABLES, type StructuredFamily } from '../../providers/structuredSnapshot.js';
import { serialize, deserialize } from 'node:v8';
import { planAppEngineSave } from '../../providers/appEngineWriter.js';
import type { AeDocument } from '../../model/aeDocument.js';
const clone = <T>(value: T): T => deserialize(serialize(value));
import { NEW_RECDEFN_VALUES } from '../../providers/recordWriter.js';
import { NEW_RECFIELD_VALUES } from '../../model/recordEdit.js';
import { newProgram, rowsFromDocument } from '../../model/aeDocument.js';

/** Narrow transactional fixture for existing-definition header saves, not a native database. */
export function structuredTransaction(family: StructuredFamily, creation = false, creationDoc?: AeDocument, requestedName?: string) {
    const name = requestedName ?? (family === 'record' ? 'ZZ_RECORD' : 'ZZ_AE_REVIEW');
    const names = family === 'record' ? RECORD_REVIEW_TABLES : AE_REVIEW_TABLES;
    const initial: Record<string, Record<string, unknown>[]> = Object.fromEntries(names.map(t => [t, []]));
    if (family === 'record') {
        initial.PSRECDEFN = [{ RECNAME: name, RECTYPE: 2, VERSION: 7, FIELDCOUNT: 1, INDEXCOUNT: 0, RECDESCR: 'Before', DESCRLONG: null,
            LASTUPDDTTM: '2026-10-15T10:00:00.123456789', LASTUPDOPRID: 'JARED', AUXFLAGMASK: 0, FUTURE_COLUMN: 'preserved' }];
        initial.PSRECFIELD = [{ RECNAME: name, FIELDNAME: 'DESCR', FIELDNUM: 1, USEEDIT: 0, USEEDIT2: 0, SUBRECORD: 'N', CURCTLFIELDNAME: ' ',
            LASTUPDDTTM: '2026-10-15T10:00:00.123456789', LASTUPDOPRID: 'JARED' }];
        initial.PSRECFIELDDB = [{ ...initial.PSRECFIELD[0], RECNAME_PARENT: name }];
    } else {
        const rows = rowsFromDocument(newProgram(name));
        const mapping = { program: 'PSAEAPPLDEFN', states: 'PSAEAPPLSTATE', tempTables: 'PSAEAPPLTEMPTBL', languages: 'PSAEAPPLLANG', sections: 'PSAESECTDEFN',
            variants: 'PSAESECTDTLDEFN', steps: 'PSAESTEPDEFN', actions: 'PSAESTMTDEFN', messages: 'PSAESTEPMSGDEFN' } as const;
        for (const [key, table] of Object.entries(mapping)) initial[table] = clone(key === 'program' ? [rows.program] : rows[key as Exclude<keyof typeof mapping, 'program'>]);
        Object.assign(initial.PSAEAPPLDEFN[0], { ASOF_DT: '1900-01-01', VERSION: 7, LASTUPDDTTM: '2026-10-15T10:00:00.123456789', LASTUPDOPRID: 'JARED', FUTURE_COLUMN: 'preserved' });
        initial.PSAESECTDEFN.forEach(r => Object.assign(r, { VERSION: 8 }));
    }
    if (creation) {
        if (family === 'record') {
            initial.PSRECDEFN[0] = { ...NEW_RECDEFN_VALUES, ...initial.PSRECDEFN[0] };
            delete initial.PSRECDEFN[0].FUTURE_COLUMN;
            initial.PSRECFIELD[0] = { ...NEW_RECFIELD_VALUES, ...initial.PSRECFIELD[0] };
            initial.PSRECFIELDDB[0] = { ...initial.PSRECFIELD[0], RECNAME_PARENT: name };
        } else delete initial.PSAEAPPLDEFN[0].FUTURE_COLUMN;
    }
    initial.PSRECDEL = [];
    for (const table of ['PSVERSION', 'PSLOCK']) initial[table] = ['RDM', 'PGM', 'AEM', 'AES', 'SRM', 'PCM', 'PJM', 'SYS'].map((OBJECTTYPENAME, i) => ({ OBJECTTYPENAME, VERSION: 100 + i }));
    const schema: Record<string, string[]> = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table,
        [...new Set([family === 'record' ? 'RECNAME' : table.startsWith('PSSQL') ? 'SQLID' : table.startsWith('PSPCM') ? 'OBJECTVALUE1' : 'AE_APPLID', ...rows.flatMap(r => Object.keys(r))])]]));
    if (creationDoc) {
        const plan = planAppEngineSave(undefined, creationDoc, { operatorId: 'JARED', toolsRelease: '8.62', lastupddttm: '2026-10-15T11:00:00.123456',
            counters: { AEM: 102, AES: 103, SRM: 104, PCM: 105, PJM: 106, SYS: 107 }, oracledb: ADAPTER_TYPES });
        for (const st of plan.statements) {
            const match = /^INSERT INTO (\w+) \(([^)]+)\)/.exec(st.sql);
            if (match && match[1] in schema) schema[match[1]] = [...new Set([...schema[match[1]], ...match[2].split(',').map(c => c.trim())])];
        }
    }
    if (creation) for (const name of names) initial[name] = [];
    let state = clone(initial), durable = clone(initial), commits = 0, rollbacks = 0, updates = 0, failAfter = false, related = false;
    const connection: DbConnection = { catalog: { tableExists: async () => true, columns: async (_c, table) => {
        if (!(table in schema)) throw new Error('Unknown fixture table ' + table);
        return schema[table].map(name => ({ name, dataType: /DESCRLONG|SQLTEXT|PCTEXT/.test(name) ? 'CLOB' : name === 'LASTUPDDTTM' ? 'TIMESTAMP(9)' : 'VARCHAR2' }));
    } }, async execute<T>(sql: string, binds: DbBinds = {}) {
        const text = sql.replace(/\s+/g, ' ').trim(), b = binds as Record<string, unknown>;
        let rows: Record<string, unknown>[] = [], rowsAffected: number | undefined;
        if (text === 'SET TRANSACTION READ ONLY') rows = [];
        else if (text.includes('FROM PSOPRDEFN')) rows = [{ N: 1 }];
        else if (text.includes('FROM PSDBFIELD')) rows = [{ N: 1 }];
        else if (text.includes('FROM PSSTATUS')) rows = [{ R: '8.62' }];
        else if (text.includes('FROM DUAL')) rows = text.includes('COUNT(*)')
            ? [{ N: [...text.matchAll(/FROM ([A-Z0-9_]+) WHERE/g)].reduce((n, m) => n + (state[m[1]]?.length ?? 0), 0) }]
            : [{ TS: '2026-10-15T11:00:00.123456' }];
        else if (/^SELECT/.test(text)) {
            const table = text.match(/FROM ([A-Z0-9_]+)/)?.[1];
            // Uses of a removed field elsewhere (its PeopleCode, pages, queries, other records' defaults): none in this fixture.
            if (text.startsWith('SELECT COUNT(*) AS N FROM') && /(FIELDNAME|OBJECTVALUE2) = :f/.test(text) && (['PSPCMPROG', 'PSPNLFIELD', 'PSQRYFIELD'].includes(table ?? '') || text.includes('DEFRECNAME = :r'))) rows = [{ N: 0 }];
            else if (!table || !(table in state)) throw new Error('Unexpected fixture SELECT: ' + text);
            else if (table === 'PSRECDEFN' && text.includes('RECNAME <>')) rows = related && text.includes('RELLANGRECNAME') ? [{ RECNAME: 'RELATED' }] : [];
            else if (table === 'PSRECFIELD' && text.includes("SUBRECORD = 'Y'")) rows = [{ N: 0 }];
            else if (table === 'PSVERSION' || table === 'PSLOCK') rows = state[table].map(r => ({ T: r.OBJECTTYPENAME, V: r.VERSION }));
            else {
                if (failAfter && updates && text.includes('FUTURE_COLUMN')) throw new Error('after snapshot unavailable');
                rows = clone(state[table]);
                if (text.includes(' AS TS')) rows = rows.map(r => ({ ...r, TS: r.LASTUPDDTTM, OPRID: r.LASTUPDOPRID }));
                if (text.includes('COUNT(*)')) rows = [{ N: rows.length }];
                if (text.includes('ORDER BY FIELDNUM')) rows.sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM));
            }
        } else if (text.startsWith('DELETE FROM ')) {
            const table = text.split(' ')[2];
            if (!['PSRECFIELD', 'PSRECFIELDDB', 'PSINDEXDEFN', 'PSKEYDEFN'].includes(table)) throw new Error('Unexpected fixture delete.');
            rowsAffected = state[table].length; state[table] = []; updates++;
        } else if (text.startsWith('INSERT INTO ')) {
            const match = text.match(/^INSERT INTO ([A-Z0-9_]+) \(([^)]+)\)/)!;
            const cols = match[2].split(',').map(c => c.trim());
            const exprs = text.slice(text.indexOf(' VALUES (') + 9, -1).split(/,\s*(?![^()]*\))/);
            state[match[1]].push(Object.fromEntries(cols.map((col, i) => {
                const bind = /:(\w+)/.exec(exprs[i])?.[1], v = bind ? b[bind] : null;
                return [col, v && typeof v === 'object' && 'val' in v ? v.val : v];
            }))); rowsAffected = 1; updates++;
        } else if (text.startsWith('UPDATE ')) {
            const table = text.split(' ')[1];
            const target = table === 'PSVERSION' || table === 'PSLOCK' ? state[table].filter(r => r.OBJECTTYPENAME === text.match(/OBJECTTYPENAME = '([^']+)'/)?.[1]) : state[table];
            const set = text.slice(text.indexOf(' SET ') + 5, text.indexOf(' WHERE '));
            for (const row of target) for (const m of set.matchAll(/([A-Z0-9_]+)\s*=\s*(?:TO_(?:TIMESTAMP|DATE)\()?:(\w+)/g)) row[m[1]] = b[m[2]];
            const delta = /VERSION = VERSION \+ :(\w+)/.exec(set);
            if (delta) for (const row of target) row.VERSION = Number(row.VERSION) + Number(b[delta[1]]);
            rowsAffected = target.length; updates++;
        } else throw new Error('Unexpected structured fixture SQL: ' + text);
        return { rows: rows as T[], ...(rowsAffected === undefined ? {} : { rowsAffected }) };
    }, async commit() { commits++; durable = clone(state); }, async rollback() { rollbacks++; state = clone(durable); }, async close() {} };
    return { name, connection, initial, state: () => clone(state), counts: () => ({ commits, rollbacks, updates }),
        editCommitted: (edit: (tables: typeof initial) => void) => { edit(durable); state = clone(durable); },
        failAfter: () => { failAfter = true; }, related: () => { related = true; } };
}
