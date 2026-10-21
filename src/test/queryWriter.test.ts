import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveQuery } from '../providers/queryWriter.js';
import { applyQueryOp, newQueryDocument } from '../model/queryDocument.js';
import { QUERY_TABLES } from '../model/querySavePlan.js';
import type { DbConnection, ColumnInfo } from '../db/connection.js';
import { ADAPTER_TYPES } from '../db/connection.js';
import type { Row } from '../model/queryDefinition.js';

// Transactional adapter drives the real writer, including SQL generation,
// native row replacement, readback and rollback of both rows and counters.
const DESCR = { type: 0, length: 30, decimalPositions: 0, format: 6, shortName: 'Descr', longName: 'Description', editTable: '', useEdit: 0 };
function adapter(release: [string, number] = ['8.62', 9]) {
  let committed = 0, rolledBack = 0;
  const view = applyQueryOp(newQueryDocument('ZZ_MCP_QUERY', 'JARED', 'AAP_TBL'), { kind: 'select', field: 'DESCR', selected: true }, { DESCR });
  const tables: Record<string, Row[]> = Object.fromEntries(Object.keys(QUERY_TABLES).map(table => [table, []]));
  // Column lists come from a view that has a criterion, an expression and a prompt.
  const full = applyQueryOp(view, { kind: 'criteria', criteria: [{ field: 'DESCR', operator: 'like', value: { prompt: 'new' } }] }, { DESCR });
  const columns = Object.fromEntries(Object.entries(QUERY_TABLES).map(([table, property]) => {
    const sample = property === 'query' ? full.query : full[property][0];
    return [table, Object.keys(sample ?? { QRYNAME: '', OPRID: '' }).map(name => ({ name, dataType: /DTTM$/.test(name) ? 'TIMESTAMP' : 'VARCHAR2' } as ColumnInfo))];
  }));
  let counters = { qdm: 3, sys: 20 };
  const statements: string[] = [];
  const c: DbConnection = {
    catalog: { columns: async (_c, table) => columns[table] ?? [], tableExists: async () => true },
    async execute<T>(sql: string, binds: Record<string, unknown> = {}) {
      statements.push(sql);
      let rows: unknown[] = [], rowsAffected = 0;
      if (sql.includes('FROM PSSTATUS')) rows = [{ TOOLSREL: release[0], PTPATCHREL: release[1] }];
      else if (sql.includes('FROM PSOPRDEFN')) rows = [{ N: 1 }];
      else if (sql.includes('FROM PSROLEUSER')) rows = [{ ACCESSIBLE: 'Y' }];
      else if (sql.includes('FROM PSRECDEFN')) rows = [{ RECNAME: 'AAP_TBL', QRYSECRECNAME: ' ', SQLTABLENAME: ' ', RECTYPE: 0 }];
      else if (sql.includes('FROM PSRECFIELD')) rows = [{ FIELDNAME: 'DESCR', FIELDTYPE: 0 }];
      else if (sql.startsWith('SELECT FIELDTYPE FROM PSDBFIELD')) rows = [{ FIELDTYPE: 0 }];
      else if (sql.includes('FROM PSDBFIELD')) rows = sql.includes('FIELDTYPE=0') ? [] : [{ LENGTH: 30 }];
      else if (sql.includes('FROM PSVERSION')) rows = [{ OBJECTTYPENAME: 'QDM', VERSION: counters.qdm }, { OBJECTTYPENAME: 'SYS', VERSION: counters.sys }];
      else if (sql.includes('FROM PSLOCK')) rows = [{ VERSION: counters.qdm }];
      else if (sql.includes('FROM DUAL')) rows = [{ UPDATED_AT: '2026-10-14T12:00:00.000000000', CREATED_AT: '2026-10-14T12:00:00.000000000' }];
      else if (sql.startsWith('DELETE FROM ')) { const table = sql.split(' ')[2]; rowsAffected = tables[table].length; tables[table] = []; }
      else if (sql.startsWith('INSERT INTO ')) {
        const table = sql.split(' ')[2], row: Row = {};
        columns[table].forEach((column, i) => row[column.name] = binds[`v${i}`]);
        tables[table].push(row); rowsAffected = 1;
      } else if (sql.startsWith('UPDATE PSVERSION')) { counters.qdm++; counters.sys++; rowsAffected = 2; }
      else if (sql.startsWith('UPDATE PSLOCK')) rowsAffected = 1;
      else if (!sql.includes('ALL_TABLES')) {
        const table = /FROM (PSQRY\w+)/.exec(sql)?.[1];
        if (table && table in tables) rows = structuredClone(tables[table]);
        else throw new Error('Unexpected SQL: ' + sql);
      }
      return { rows: rows as T[], rowsAffected };
    },
    async commit() { committed++; },
    async rollback() { rolledBack++; for (const table of Object.keys(tables)) tables[table] = []; counters = { qdm: 3, sys: 20 }; },
    async close() {}
  };
  return { c, view, tables, statements, state: () => ({ committed, rolledBack, ...counters }) };
}

test('Query preview verifies native row replacements then rolls back rows and counters', async () => {
  const db = adapter();
  const result = await saveQuery(db.c, ADAPTER_TYPES, { view: db.view, openedToken: 'absent', operatorId: 'JARED', dryRun: true });
  assert.equal(result.written, false);
  assert.equal(result.view.query.LASTUPDOPRID, 'JARED');
  assert.ok(db.statements.some(sql => sql.startsWith('INSERT INTO PSQRYDEFN')));
  assert.ok(db.statements.some(sql => sql.startsWith('UPDATE PSVERSION')));
  assert.equal(Object.values(db.tables).flat().length, 0);
  assert.deepEqual(db.state(), { committed: 0, rolledBack: 1, qdm: 3, sys: 20 });
});

test('Query save commits the verified plan while a stale token rolls back before replacing rows', async () => {
  const db = adapter();
  const result = await saveQuery(db.c, ADAPTER_TYPES, { view: db.view, openedToken: 'absent', operatorId: 'JARED' });
  assert.equal(result.written, true);
  assert.equal(db.tables.PSQRYDEFN.length, 1);
  assert.deepEqual(db.state(), { committed: 1, rolledBack: 0, qdm: 4, sys: 21 });
  const stale = adapter();
  await assert.rejects(saveQuery(stale.c, ADAPTER_TYPES, { view: stale.view, openedToken: 'stale', operatorId: 'JARED', dryRun: true }), /changed since/);
  assert.ok(!stale.statements.some(sql => sql.startsWith('DELETE FROM')));
});

test('typed criteria save on 8.62.09 and are refused on 8.61.15, where one equal-to criterion stays calibrated', async () => {
  const criteria = { kind: 'criteria' as const, criteria: [{ field: 'DESCR', operator: 'like' as const, value: { constant: 'A%' } }, { field: 'DESCR', operator: 'isNotNull' as const, logical: 'OR' as const }] };
  const newer = adapter();
  assert.equal((await saveQuery(newer.c, ADAPTER_TYPES, { view: applyQueryOp(newer.view, criteria, { DESCR }), openedToken: 'absent', operatorId: 'JARED' })).written, true);
  assert.equal(newer.tables.PSQRYCRITERIA.length, 2);
  const older = adapter(['8.61', 15]);
  await assert.rejects(saveQuery(older.c, ADAPTER_TYPES, { view: applyQueryOp(older.view, criteria, { DESCR }), openedToken: 'absent', operatorId: 'JARED', dryRun: true }), /calibrated on PeopleTools 8.62.09; this database is 8.61.15/);
  assert.ok(!older.statements.some(sql => sql.startsWith('INSERT INTO')));
  const single = adapter(['8.61', 15]);
  const equal = applyQueryOp(single.view, { kind: 'constant', field: 'DESCR', value: 'A' }, { DESCR });
  assert.equal((await saveQuery(single.c, ADAPTER_TYPES, { view: equal, openedToken: 'absent', operatorId: 'JARED', dryRun: true })).written, false);
});
