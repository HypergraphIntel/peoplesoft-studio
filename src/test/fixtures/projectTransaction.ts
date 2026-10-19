import type { DbBinds, DbConnection } from '../../db/connection.js';
import { NEW_PROJECT_VALUES } from '../../providers/projectWriter.js';
import { PROJECT_ITEM_DEFAULTS } from '../../model/projectItems.js';

/** Transactional SQL fixture, not a native runtime. Unknown statements fail. */
export function projectTransaction() {
    type Row = Record<string, unknown>;
    const initial: Record<string, Row[]> = { PSPROJECTDEFN: [], PSPROJECTITEM: [], PSVERSION: [{ OBJECTTYPENAME: 'PJM', VERSION: 20 }, { OBJECTTYPENAME: 'SYS', VERSION: 30 }], PSLOCK: [{ OBJECTTYPENAME: 'PJM', VERSION: 40 }] };
    const columns: Record<string, string[]> = {
        PSPROJECTDEFN: ['PROJECTNAME', 'VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID', ...Object.keys(NEW_PROJECT_VALUES)],
        PSPROJECTITEM: ['PROJECTNAME', 'OBJECTTYPE', ...[1, 2, 3, 4].flatMap(n => ['OBJECTID' + n, 'OBJECTVALUE' + n]), ...Object.keys(PROJECT_ITEM_DEFAULTS)]
    };
    let state = structuredClone(initial), durable = structuredClone(initial), commits = 0, rollbacks = 0, definitionsExist = false;
    const queries: string[] = [];
    const connection: DbConnection = { catalog: { tableExists: async () => true, columns: async (_c, table) => {
        if (!columns[table]) throw new Error('Unexpected project fixture schema: ' + table);
        return columns[table].map(name => ({ name, dataType: name.endsWith('DTTM') ? 'TIMESTAMP(9)' : name === 'DESCRLONG' ? 'CLOB' : 'VARCHAR2' }));
    } }, async execute<T>(sql: string, binds: DbBinds = {}) {
        const text = sql.replace(/\s+/g, ' ').trim(), b = binds as Row;
        queries.push(text);
        let rows: Row[] = [], rowsAffected: number | undefined;
        if (text === 'SET TRANSACTION READ ONLY') rows = [];
        else if (text.includes('FROM PSOPRDEFN')) rows = [{ N: 1 }];
        else if (text.includes('FROM DUAL')) rows = text.includes('COUNT(*)') ? [{ N: state.PSPROJECTDEFN.length + state.PSPROJECTITEM.length }] : [{ TS: '2026-10-18T12:00:00.123456' }];
        else if (text.startsWith('SELECT ')) {
            const table = text.match(/FROM (\w+)/)?.[1];
            if (table === 'PSRECDEFN' || table === 'PSSQLDEFN' || table?.startsWith('PSAE') || table === 'PSPCMPROG') rows = [{ N: definitionsExist ? 1 : 0 }];
            else if (table === 'PSVERSION') rows = state.PSVERSION.map(r => ({ T: r.OBJECTTYPENAME, V: r.VERSION }));
            else if (table === 'PSLOCK') rows = state.PSLOCK.map(r => ({ V: r.VERSION }));
            else if (table === 'PSPROJECTDEFN' || table === 'PSPROJECTITEM') {
                rows = structuredClone(state[table]).filter(r => r.PROJECTNAME === b.p);
                if (table === 'PSPROJECTDEFN' && text.includes(' AS TS')) rows = rows.map(r => ({ ...r, TS: r.LASTUPDDTTM, OPRID: r.LASTUPDOPRID }));
                if (table === 'PSPROJECTITEM' && 't' in b) rows = rows.filter(r => r.OBJECTTYPE === b.t && [1, 2, 3, 4].every(n => r['OBJECTVALUE' + n] === b['v' + n]));
                if (text.includes('COUNT(*)')) rows = [{ N: rows.length }];
            } else throw new Error('Unexpected project fixture SELECT: ' + text);
        } else if (text.startsWith('INSERT INTO ')) {
            const match = text.match(/^INSERT INTO (\w+) \(([^)]+)\)/)!;
            const cols = match[2].split(',').map(v => v.trim());
            state[match[1]].push(Object.fromEntries(cols.map((col, i) => [col, col === 'LASTUPDDTTM' ? b.ts : b[col] ?? b['b' + i] ?? null])));
            rowsAffected = 1;
        } else if (text.startsWith('UPDATE ')) {
            const table = text.split(' ')[1];
            const target = table === 'PSPROJECTDEFN' ? state[table].filter(r => r.PROJECTNAME === b.p) : state[table].filter(r => r.OBJECTTYPENAME === text.match(/OBJECTTYPENAME = '([^']+)'/)?.[1]);
            for (const r of target) { r.VERSION = b.v; if (table === 'PSPROJECTDEFN') { r.LASTUPDDTTM = b.ts; r.LASTUPDOPRID = b.op; } }
            rowsAffected = target.length;
        } else throw new Error('Unexpected project fixture SQL: ' + text);
        return { rows: rows as T[], ...(rowsAffected === undefined ? {} : { rowsAffected }) };
    }, async commit() { commits++; durable = structuredClone(state); }, async rollback() { rollbacks++; state = structuredClone(durable); }, async close() {} };
    return { connection, initial, state: () => structuredClone(state), counts: () => ({ commits, rollbacks }), queries,
        definitionsExist: (exists: boolean) => { definitionsExist = exists; },
        editCommitted: (fn: (tables: typeof initial) => void) => { fn(durable); state = structuredClone(durable); } };
}
