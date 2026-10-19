import type { DbConnection, DbBinds } from '../../db/connection.js';
import { IB_PARENTS, IB_SECTIONS } from '../../model/ibOperations.js';
import { ibReviewTables, type IbReviewKind } from '../../providers/ibSnapshot.js';

/** Executes real IB writer statements against a transactional fixture; not native acceptance. */
/**
 * `structure` adds an existing OnRequest handler, its class implementation and the
 * class itself, and makes UPDATE honor its WHERE keys and INSERT add rows, for
 * structural review tests. Without it the fixture is exactly the header fixture.
 */
export function ibTransaction(kind: IbReviewKind, structure = false) {
    const name = 'ZZ_IB_REVIEW', key = kind === 'service' ? 'IB_SERVICENAME' : 'IB_OPERATIONNAME';
    const service = { ...IB_PARENTS.service.defaults, IB_SERVICENAME: kind === 'service' ? name : 'ZZ_OWNER', IB_NAMESPACE: 'urn:fixture', DESCR: 'Before', VERSION: 7, LASTUPDDTTM: '2026-10-19T01:00:00.123456789', LASTUPDOPRID: 'JARED', FUTURE_COLUMN: 'preserve', IBEXTERNALPWD: 'fixture-private' };
    const operation = { ...IB_PARENTS.operation.defaults, IB_OPERATIONNAME: name, IB_SERVICENAME: 'ZZ_OWNER', DESCR: 'Before', DEFAULTVER: 'v1', VERSION: 8, LASTUPDDTTM: service.LASTUPDDTTM, LASTUPDOPRID: 'JARED', FUTURE_COLUMN: 'preserve' };
    const initial: Record<string, Record<string, unknown>[]> = Object.fromEntries([...ibReviewTables('service'), ...ibReviewTables('operation')].map(t => [t, []]));
    initial.PSSERVICE = [service]; initial.PSOPERATION = kind === 'operation' ? [operation] : [];
    initial.PSSERVICEOPR = [{ IB_SERVICENAME: kind === 'service' ? name : 'ZZ_OWNER', IB_OPERATIONNAME: kind === 'service' ? 'ZZ_CHILD' : name }];
    if (kind === 'operation') {
        initial.PSOPRVERDFN = [{ ...IB_SECTIONS.operation.versions.defaults, IB_OPERATIONNAME: name, VERSIONNAME: 'v1', DESCR: 'Version', VERSION: 10, LASTUPDDTTM: service.LASTUPDDTTM, LASTUPDOPRID: 'JARED' }];
        initial.PSSERVICEOPR = [{ IB_SERVICENAME: 'ZZ_OWNER', IB_OPERATIONNAME: name }];
        initial.PSOPRVERDFNPARM = ['REQUEST', 'RESPONSE'].map(PARAMETERNAME => ({ ...IB_SECTIONS.operation.parameters.defaults, IB_OPERATIONNAME: name, VERSIONNAME: 'v1', PARAMETERNAME, MSGNAME: 'ZZ_MSG', IB_MSGVERSION: 'v1' }));
        if (structure) {
            initial.PSOPRHDLR = [{ ...IB_SECTIONS.operation.handlers.defaults, IB_OPERATIONNAME: name, HANDLERNAME: 'NOTIFYHDLR', HANDLERID: 'NTFY', DESCR: 'Notify', VERSION: 11, LASTUPDDTTM: service.LASTUPDDTTM, LASTUPDOPRID: 'JARED' }];
            initial.PSOPERATIONAC = [{ ...IB_SECTIONS.operation.applicationClassHandlers.defaults, IB_OPERATIONNAME: name, HANDLERNAME: 'NOTIFYHDLR', PACKAGEROOT: 'ZZ_PKG', QUALIFYPATH: ' ', APPCLASSID: 'Handler', APPCLASSMETHOD: 'OnNotify' }];
            initial.PSAPPCLASSDEFN = [{ PACKAGEROOT: 'ZZ_PKG', QUALIFYPATH: ':', APPCLASSID: 'Handler' }];
        }
    }
    for (const table of ['PSVERSION', 'PSLOCK']) initial[table] = ['SRVM', 'OPRM', 'OPRVM', 'OPRHM', 'SYS'].map(OBJECTTYPENAME => ({ OBJECTTYPENAME, VERSION: 100 }));
    const schema = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, [...new Set([key, ...rows.flatMap(r => Object.keys(r))])]]));
    let durable = structuredClone(initial), state = structuredClone(initial), updates = 0, commits = 0, rollbacks = 0, fail = false, tamper = false;
    const connection: DbConnection = { catalog: { tableExists: async () => true, columns: async (_c, t) => (schema[t] ?? []).map(name => ({ name, dataType: /DESCRLONG/.test(name) ? 'CLOB' : name === 'LASTUPDDTTM' ? 'TIMESTAMP(9)' : typeof (initial[t]?.[0] ?? {})[name] === 'number' ? 'NUMBER' : 'VARCHAR2' })) },
        async execute<T>(sql: string, binds: DbBinds = {}) {
            const text = sql.replace(/\s+/g, ' ').trim(), b = binds as Record<string, unknown>;
            let rows: Record<string, unknown>[] = [], rowsAffected: number | undefined;
            if (text.includes('FROM PSSTATUS')) rows = [{ TOOLSREL: '8.62', PTPATCHREL: 9 }];
            else if (text.includes('FROM PSOPRDEFN')) rows = [{ N: 1 }];
            else if (text.includes('FROM PSDBFIELD')) rows = [];
            else if (text.includes('FROM PSMSGVER')) rows = [{ N: 1 }];
            else if (text.includes('FROM DUAL')) rows = [{ TS: '2026-10-19T02:00:00.123456' }];
            else if (text.startsWith('SELECT')) {
                const table = text.match(/FROM ([A-Z0-9_]+)/)?.[1];
                if (!table || !(table in state)) throw new Error('Unexpected IB fixture SELECT: ' + text);
                if (text.includes('IB_SERVICENAME<>')) rows = [];
                else {
                    if (fail && updates && text.includes('FUTURE_COLUMN')) throw new Error('after snapshot unavailable');
                    rows = structuredClone(state[table]);
                    const filter = text.match(/WHERE (IB_SERVICENAME|IB_OPERATIONNAME)\s*=\s*:(\w+)/);
                    if (filter) rows = rows.filter(r => r[filter[1]] === b[filter[2]]);
                    // Honor secret exclusion rather than accidentally making the fixture safer than the reader.
                    if (!text.split(' FROM ')[0].includes('IBEXTERNALPWD')) rows.forEach(r => delete r.IBEXTERNALPWD);
                }
            } else if (text.startsWith('UPDATE')) {
                const table = text.split(' ')[1], where = [...text.slice(text.indexOf(' WHERE ')).matchAll(/([A-Z0-9_]+)\s*=\s*(?:TO_DATE\()?:(k\d+)/g)];
                const target = ['PSVERSION', 'PSLOCK'].includes(table) ? state[table].filter(r => r.OBJECTTYPENAME === b.n)
                    : structure ? state[table].filter(r => where.every(([, column, bind]) => String(r[column] ?? '').trim() === String(b[bind] ?? '').trim())) : state[table];
                const set = text.slice(text.indexOf(' SET ') + 5, text.indexOf(' WHERE '));
                for (const row of target) for (const m of set.matchAll(/([A-Z0-9_]+)\s*=\s*(?:TO_(?:TIMESTAMP|DATE)\()?:(\w+)/g)) {
                    const value = b[m[2]]; row[m[1]] = value && typeof value === 'object' && 'val' in value ? value.val : value;
                }
                updates++; rowsAffected = target.length;
                // Simulate a side effect outside parent-property readback. Only the full
                // after-image guard can detect it before COMMIT.
                if (tamper && table === (kind === 'service' ? 'PSSERVICE' : 'PSOPERATION')) state.PSSERVICEOPR[0][kind === 'service' ? 'IB_OPERATIONNAME' : 'IB_SERVICENAME'] = 'UNEXPECTED';
            } else if (structure && text.startsWith('INSERT INTO')) {
                const [, table, columns, values] = text.match(/^INSERT INTO ([A-Z0-9_]+) \(([^)]*)\) VALUES \((.*)\)$/)!;
                // Only :vN are binds; the timestamp format literal contains ':MI' and ':SS'.
                const binds = [...values.matchAll(/:(v\d+)/g)].map(m => b[m[1]]);
                (state[table] ??= []).push(Object.fromEntries(columns.split(',').map((c, i) => { const v = binds[i]; return [c, v && typeof v === 'object' && 'val' in v ? v.val : v]; })));
                updates++; rowsAffected = 1;
            } else throw new Error('Unexpected IB fixture DML: ' + text);
            return { rows: rows as T[], ...(rowsAffected === undefined ? {} : { rowsAffected }) };
        }, async commit() { durable = structuredClone(state); commits++; }, async rollback() { state = structuredClone(durable); rollbacks++; }, async close() {} };
    return { name, connection, initial, state: () => structuredClone(state), counts: () => ({ updates, commits, rollbacks }), failAfter: () => { fail = true; }, tamper: () => { tamper = true; }, drift: () => { durable[kind === 'service' ? 'PSSERVICE' : 'PSOPERATION'][0].FUTURE_COLUMN = 'external'; state = structuredClone(durable); } };
}

