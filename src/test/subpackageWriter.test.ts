import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbConnection } from '../db/connection.js';
import { createSubpackage, createSubpackages, deleteSubpackages } from '../providers/packageWriter.js';
import { subpackageChange } from '../providers/classLifecycle.js';

function fixture(options: { stale?: boolean; occupied?: boolean; parentMissing?: boolean; badReadback?: boolean; failUpdate?: boolean; storedOwner?: string; after?: number } = {}) {
  const statements: string[] = [], writes: { sql: string; binds: any }[] = [];
  let committed = false, rolledBack = false, inserted = false, owner = ' ';
  const c = {
    execute: async (sql: string, binds: any) => {
      statements.push(sql);
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) {
        writes.push({ sql, binds }); if (sql.startsWith('INSERT')) { inserted = true; owner = options.storedOwner ?? binds.o; }
        return { rowsAffected: sql.startsWith('UPDATE PSPACKAGEDEFN') ? options.failUpdate ? 0 : options.after ?? 3 : 1 };
      }
      if (sql.includes("QUALIFYPATH = '.' FOR UPDATE")) return { rows: [{ V: options.stale ? 9 : 7 }] };
      if (sql.includes('FROM PSOPRDEFN')) return { rows: [{ N: 1 }] };
      if (sql.includes('AS O FROM PSPACKAGEDEFN')) return { rows: [{ L: binds.q === ':' ? 1 : 2, O: owner }] };
      if (sql.includes('AS L FROM PSPACKAGEDEFN')) return { rows: !inserted && options.parentMissing ? [] : [{ L: inserted ? 2 : 1 }] };
      if (sql.includes('UPPER(PACKAGEID)')) return { rows: [{ N: options.occupied ? 1 : 0 }] };
      if (sql.includes('FROM PSVERSION')) return { rows: [{ T: 'APM', V: 20 }, { T: 'SYS', V: 30 }] };
      if (sql.includes('FROM PSLOCK')) return { rows: [{ V: 10 }] };
      if (sql.includes('SYSTIMESTAMP')) return { rows: [{ TS: '2026-10-20T12:00:00.000000' }] };
      if (sql.includes('COUNT(*)')) return { rows: [{ N: inserted ? options.badReadback ? 0 : options.after ?? 3 : 2 }] };
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
  assert.deepEqual([insert.p, insert.q, insert.l, insert.r, insert.o], ['Nested', 'SUB', 2, 'ZZ_PKG', ' ']);
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

test('a subpackage carries its own owner ID as a project copy writes it; a bad or unread owner refuses', async () => {
  const f = fixture(); await createSubpackage(f.c, { ...request, ownerId: 'PPT' });
  assert.equal(f.writes[0].binds.o, 'PPT'); assert.ok(f.committed());
  const invalid = fixture(); await assert.rejects(createSubpackage(invalid.c, { ...request, ownerId: 'TOOLONG' }), /owner ID/);
  assert.equal(invalid.statements.length, 0);
  const lost = fixture({ storedOwner: ' ' }); await assert.rejects(createSubpackage(lost.c, { ...request, ownerId: 'PPT' }), /readback/);
  assert.ok(lost.rolledBack()); assert.ok(!lost.committed());
});

test('several subpackages in one save move APM, SYS and the APM lock once (2026-11-11 capture), a new parent first', async () => {
  const f = fixture({ after: 5 });
  await createSubpackages(f.c, { root: 'ZZ_PKG', paths: [['Keep', 'Deep'], ['Keep'], ['Gone']], openedVersion: 7, operatorId: 'JARED' });
  assert.ok(f.committed());
  const inserts = f.writes.filter(w => w.sql.startsWith('INSERT')).map(w => [w.binds.p, w.binds.q, w.binds.l]);
  assert.deepEqual(inserts, [['Keep', ':', 1], ['Gone', ':', 1], ['Deep', 'Keep', 2]], 'parents before children; the new parent is not looked up');
  assert.equal(f.writes.filter(w => /UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'/.test(w.sql)).length, 1);
});

function deleteFixture(options: { classes?: number } = {}) {
  const writes: { sql: string; binds: any }[] = [];
  let committed = false;
  const rows = [{ P: 'ZZ_PKG', Q: '.', L: 0 }, { P: 'Keep', Q: ':', L: 1 }, { P: 'Kid', Q: 'Keep', L: 2 }, { P: 'Other', Q: ':', L: 1 }, { P: 'Stay', Q: ':', L: 1 }];
  const c = {
    execute: async (sql: string, binds: any) => {
      if (/^(DELETE|UPDATE|INSERT)/.test(sql)) { writes.push({ sql, binds }); return { rowsAffected: sql.startsWith('UPDATE PSPACKAGEDEFN') ? 2 : 1 }; }
      if (sql.includes("QUALIFYPATH = '.' FOR UPDATE")) return { rows: [{ V: 7 }] };
      if (sql.includes('FROM PSOPRDEFN')) return { rows: [{ N: 1 }] };
      if (sql.includes('AS L FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r FOR UPDATE')) return { rows };
      if (sql.includes('FROM PSAPPCLASSDEFN')) return { rows: [{ N: options.classes ?? 0 }] };
      if (sql.includes('FROM PSVERSION')) return { rows: [{ T: 'APM', V: 20 }, { T: 'PBM', V: 60 }, { T: 'SYS', V: 30 }] };
      if (sql.includes('FROM PSLOCK')) return { rows: [{ T: 'APM', V: 10 }, { T: 'PBM', V: 50 }] };
      if (sql.includes('SYSTIMESTAMP')) return { rows: [{ TS: '2026-11-11T12:00:00.000000' }] };
      throw new Error(sql);
    }, commit: async () => { committed = true; }, rollback: async () => {}
  } as unknown as DbConnection;
  return { c, writes, committed: () => committed };
}

test('deleting subpackages: PBM and SYS per Delete (a parent takes its child), then one package save; no marker (2026-11-11 capture)', async () => {
  const f = deleteFixture();
  const r = await deleteSubpackages(f.c, { root: 'ZZ_PKG', paths: [['Keep'], ['Keep', 'Kid'], ['Other']], openedVersion: 7, operatorId: 'JARED' });
  assert.deepEqual(r.deleted, [['Keep'], ['Keep', 'Kid'], ['Other']]);
  const v = (type: string, table = 'PSVERSION') => f.writes.find(w => w.sql.includes(`UPDATE ${table}`) && w.sql.includes(`'${type}'`))!.binds.v;
  assert.equal(v('PBM'), 62, 'two Deletes: Keep (with Kid) and Other');
  assert.equal(v('PBM', 'PSLOCK'), 52);
  assert.equal(v('APM'), 21); assert.equal(v('APM', 'PSLOCK'), 11);
  assert.equal(v('SYS'), 33, 'SYS once per Delete and once for the save');
  assert.equal(f.writes.filter(w => w.sql.startsWith('DELETE FROM PSPACKAGEDEFN')).length, 3);
  assert.ok(!f.writes.some(w => /PSPACKAGEDEL/.test(w.sql)));
  assert.ok(f.committed());
  const held = deleteFixture({ classes: 1 });
  await assert.rejects(deleteSubpackages(held.c, { root: 'ZZ_PKG', paths: [['Other']], openedVersion: 7, operatorId: 'JARED' }), /holds classes/);
  assert.equal(held.writes.length, 0);
});

test('a package change is subpackages added or removed only', () => {
  const row = (id: string, q: string, l: number, extra: Record<string, unknown> = {}) => ({ PACKAGEID: id, PACKAGEROOT: 'ZZ_PKG', QUALIFYPATH: q, PACKAGELEVEL: l, PACKAGEREF: ' ', DESCR: ' ', OBJECTOWNERID: ' ', DESCRLONG: null, VERSION: 1, ...extra });
  const scope = (...rows: Record<string, unknown>[]) => ({ scope: 'app-package/1' as const, tables: { PSPACKAGEDEFN: rows as any, PSAPPCLASSDEFN: [] } });
  const live = scope(row('ZZ_PKG', '.', 0), row('Keep', ':', 1));
  assert.deepEqual(subpackageChange('ZZ_PKG', live, scope(row('ZZ_PKG', '.', 0, { VERSION: 2 }), row('Keep', ':', 1), row('Deep', 'Keep', 2))).added, [{ path: ['Keep', 'Deep'], ownerId: '' }]);
  assert.deepEqual(subpackageChange('ZZ_PKG', live, scope(row('ZZ_PKG', '.', 0))).removed, [['Keep']]);
  assert.throws(() => subpackageChange('ZZ_PKG', live, scope(row('ZZ_PKG', '.', 0, { DESCR: 'x' }), row('Keep', ':', 1))), /properties are not reviewed/);
  assert.throws(() => subpackageChange('ZZ_PKG', live, scope(row('ZZ_PKG', '.', 0), row('New', ':', 1, { DESCR: 'd' }), row('Keep', ':', 1))), /descriptions/);
  assert.throws(() => subpackageChange('ZZ_PKG', live, scope(row('ZZ_PKG', '.', 0), row('Other', ':', 1))), /separate changes/);
});
