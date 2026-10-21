import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES, type DbConnection } from '../db/connection.js';
import { readSqlMigration, readSqlLobValue } from '../providers/sqlSnapshot.js';
import { saveSqlDefinition } from '../providers/sqlWriter.js';

function fixture() {
  const head = { SQLID: 'ZZ_SQL', SQLTYPE: '0', VERSION: 12, LASTUPDOPRID: 'JARED', STAMP: '2026-10-20T12:00:00.000000', ENABLEEFFDT: 'N', OBJECTOWNERID: 'PPT' };
  const key = { SQLID: 'ZZ_SQL', SQLTYPE: '0', MARKET: 'GBL', DBTYPE: ' ', EFFDT: '1900-01-01' };
  const rows: Record<string, Record<string, unknown>[]> = {
    PSSQLDEFN: [head], PSSQLDESCR: [{ ...key, DESCR: 'SQL description', DESCRLONG: 'Full comments' }],
    PSSQLTEXTDEFN: [{ ...key, SEQNUM: 0, SQLTEXT: 'SELECT 1\r\nFROM PS_INSTALLATION' }],
    PSSQLHASH: [{ ...key, HASH_SIGNATURE: 'native-hash' }], PSSQLLANG: []
  };
  const statements: string[] = [];
  let rollback = false;
  const c = {
    execute: async (sql: string) => {
      statements.push(sql);
      const table = /FROM (PSSQL[A-Z]+)/.exec(sql)?.[1];
      assert.ok(table, sql);
      return { rows: sql.includes('COUNT(*)') ? [{ N: rows[table].length }] : structuredClone(rows[table]) };
    }, rollback: async () => { rollback = true; }
  } as unknown as DbConnection;
  return { rows, c, statements, rolledBack: () => rollback };
}

test('SQL snapshot reads full text/comments and fingerprints every row, including unchanged-version edits', async () => {
  const f = fixture();
  f.rows.PSSQLTEXTDEFN[0].SQLTEXT = 'SELECT /* ' + 'x'.repeat(8000) + ' */ 1 FROM PS_INSTALLATION';
  f.rows.PSSQLDESCR[0].DESCRLONG = 'é'.repeat(9000);
  const before = (await readSqlMigration(f.c, ADAPTER_TYPES, 'ZZ_SQL'))!;
  assert.ok(before.data.text.length > 8000);
  assert.equal(before.data.definition.length, 9000);
  f.rows.PSSQLDESCR[0].DESCRLONG += ' changed';
  const after = (await readSqlMigration(f.c, ADAPTER_TYPES, 'ZZ_SQL'))!;
  assert.equal(before.version, after.version);
  assert.notEqual(before.token, after.token);
  assert.ok(f.statements.every(s => !s.includes('DBMS_LOB.SUBSTR')));
});

test('SQL snapshot reads full CLOB locators and closes them on success or failed read', async () => {
  const f = fixture(), execute = f.c.execute.bind(f.c);
  const expected = 'Installed complete comments é😀 '.repeat(600);
  let closed = 0;
  f.c.execute = (async (sql: string, binds: unknown, options: Record<string, unknown>) => {
    assert.equal(options?.fetchInfo, undefined, 'Do not use the corrupting inline CLOB conversion.');
    const r = await execute(sql, binds as never, options);
    if (sql.includes('DESCRLONG') && !sql.includes('COUNT(*)')) (r.rows![0] as Record<string, unknown>).DESCRLONG = {
      getData: async () => expected, close: async () => { closed++; }
    };
    return r;
  }) as DbConnection['execute'];
  const actual = await readSqlMigration(f.c, ADAPTER_TYPES, 'ZZ_SQL');
  assert.equal(actual?.data.definition, expected);
  assert.equal(closed, 1);
  await assert.rejects(readSqlLobValue({ getData: async () => { throw Error('lost connection'); }, close: async () => { closed++; } }), /lost connection/);
  assert.equal(closed, 2);
});

test('SQL snapshot refuses variants, translations, effective dating, split text and orphan scopes', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.rows.PSSQLTEXTDEFN.push({ ...f.rows.PSSQLTEXTDEFN[0], DBTYPE: '2' }); },
    (f: ReturnType<typeof fixture>) => { f.rows.PSSQLLANG.push({}); },
    (f: ReturnType<typeof fixture>) => { f.rows.PSSQLDEFN[0].ENABLEEFFDT = 'Y'; },
    (f: ReturnType<typeof fixture>) => { f.rows.PSSQLTEXTDEFN[0].SEQNUM = 1; },
    (f: ReturnType<typeof fixture>) => { f.rows.PSSQLDEFN = []; },
    (f: ReturnType<typeof fixture>) => { f.rows.PSSQLHASH = []; }
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(readSqlMigration(f.c, ADAPTER_TYPES, 'ZZ_SQL'), /migration supports|translations|orphan/);
  }
  const empty = fixture(); Object.keys(empty.rows).forEach(t => { empty.rows[t] = []; });
  assert.equal(await readSqlMigration(empty.c, ADAPTER_TYPES, 'ZZ_SQL'), undefined);
});

test('SQL writer locks the native scope and rejects a stale metadata token before mutation', async () => {
  const f = fixture();
  const opened = (await readSqlMigration(f.c, ADAPTER_TYPES, 'ZZ_SQL'))!;
  f.rows.PSSQLDESCR[0].DESCR = 'Concurrent change';
  await assert.rejects(saveSqlDefinition(f.c, {
    sqlId: 'ZZ_SQL', text: 'SELECT 2 FROM PS_INSTALLATION', openedVersion: opened.version,
    expectedSnapshotToken: opened.token, operatorId: 'JARED'
  }, ADAPTER_TYPES), /changed after migration preview/);
  assert.ok(f.rolledBack());
  assert.ok(f.statements.some(s => /PSSQLDEFN.*FOR UPDATE/.test(s)));
  assert.ok(f.statements.every(s => s.startsWith('SELECT')));
});
