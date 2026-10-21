import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbConnection } from '../db/connection.js';
import { createSubpackage } from '../providers/packageWriter.js';

function fixture(options: { stale?: boolean; occupied?: boolean; parentMissing?: boolean; badReadback?: boolean; failUpdate?: boolean } = {}) {
  const statements: string[] = [], writes: { sql: string; binds: any }[] = [];
  let committed = false, rolledBack = false, inserted = false;
  const c = {
    execute: async (sql: string, binds: any) => {
      statements.push(sql);
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) {
        writes.push({ sql, binds }); if (sql.startsWith('INSERT')) inserted = true;
        return { rowsAffected: sql.startsWith('UPDATE PSPACKAGEDEFN') ? options.failUpdate ? 0 : 3 : 1 };
      }
      if (sql.includes("QUALIFYPATH = '.' FOR UPDATE")) return { rows: [{ V: options.stale ? 9 : 7 }] };
      if (sql.includes('FROM PSOPRDEFN')) return { rows: [{ N: 1 }] };
      if (sql.includes('AS L FROM PSPACKAGEDEFN')) return { rows: !inserted && options.parentMissing ? [] : [{ L: inserted ? 2 : 1 }] };
      if (sql.includes('UPPER(PACKAGEID)')) return { rows: [{ N: options.occupied ? 1 : 0 }] };
      if (sql.includes('FROM PSVERSION')) return { rows: [{ T: 'APM', V: 20 }, { T: 'SYS', V: 30 }] };
      if (sql.includes('FROM PSLOCK')) return { rows: [{ V: 10 }] };
      if (sql.includes('SYSTIMESTAMP')) return { rows: [{ TS: '2026-10-20T12:00:00.000000' }] };
      if (sql.includes('COUNT(*)')) return { rows: [{ N: inserted ? options.badReadback ? 0 : 3 : 2 }] };
      throw new Error(sql);
    }, commit: async () => { committed = true; }, rollback: async () => { rolledBack = true; }
  } as unknown as DbConnection;
  return { c, statements, writes, committed: () => committed, rolledBack: () => rolledBack };
}
const request = { root: 'ZZ_PKG', path: ['SUB', 'Nested'], openedVersion: 7, operatorId: 'JARED' };

test('subpackage save locks the reviewed root, preserves class rows, updates only APM/SYS and reads back before commit', async () => {
  const f = fixture(); const result = await createSubpackage(f.c, request);
  assert.equal(result.version, 21); assert.ok(f.committed()); assert.ok(!f.rolledBack());
  assert.ok(f.statements[0].includes('FOR UPDATE'));
  assert.ok(f.writes.every(w => !/PSPCMPROG|PSAPPCLASSDEFN|PCM/.test(w.sql)));
  const insert = f.writes[0].binds;
  assert.deepEqual([insert.p, insert.q, insert.l, insert.r], ['Nested', 'SUB', 2, 'ZZ_PKG']);
  assert.equal(f.writes.find(w => w.sql.startsWith('UPDATE PSPACKAGEDEFN'))!.binds.v, 21);
});

test('stale root, duplicate sibling and missing parent refuse without mutations', async () => {
  for (const options of [{ stale: true }, { occupied: true }, { parentMissing: true }]) {
    const f = fixture(options);
    await assert.rejects(createSubpackage(f.c, request), /changed|already exists|parent subpackage/);
    assert.equal(f.writes.length, 0); assert.ok(f.rolledBack()); assert.ok(!f.committed());
  }
});

test('failed readback and partial update roll back the whole save', async () => {
  for (const options of [{ badReadback: true }, { failUpdate: true }]) {
    const f = fixture(options); await assert.rejects(createSubpackage(f.c, request), /readback|affected/);
    assert.ok(f.rolledBack()); assert.ok(!f.committed());
  }
});

test('dry run performs the guarded transaction then rolls back; malformed paths never reach a lock', async () => {
  const f = fixture(); await createSubpackage(f.c, { ...request, dryRun: true });
  assert.ok(f.rolledBack()); assert.ok(!f.committed());
  for (const path of [[], ['A', 'B', 'C'], ['bad:name']]) {
    const invalid = fixture(); await assert.rejects(createSubpackage(invalid.c, { ...request, path }), /valid package path/);
    assert.equal(invalid.statements.length, 0);
  }
});
