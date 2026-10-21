/**
 * Native standalone SQL migration acceptance on disposable HRDMO definitions.
 * PSLAB_ACCESSID / PSLAB_ACCESSPSWD; optional PSLAB_ORACLE / PSLAB_OPERATOR.
 * Uses real provider export/preview/apply/writers and independent full-CLOB reads.
 * Source export and vacant-target import use the same lab database; this is not
 * cross-database or Application Designer certification. Cleanup deletes only the
 * unique, initially absent lab names. Native version counters remain monotonic.
 *   npx tsx tools/lab/project-migration-native.mts
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseProvider } from '../../src/providers/database.js';
import { openDatabase } from '../../src/db/open.js';
import { DefinitionType, makeKey } from '../../src/model/definitions.js';
import { databaseMigrationTarget } from '../../src/providers/migrationTarget.js';
import { exportMigrationPackage, parseMigrationPackage, previewMigrationImport, applyMigrationImport } from '../../src/migrationPackage.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard } from '../../src/providers/writeGuard.js';
import { predictSourceSignature } from '../../src/peoplecode/sourceSignature.js';
import { projectKeyIdentity } from '../../src/projectCompare.js';

assert.ok(process.env.PSLAB_ACCESSID && process.env.PSLAB_ACCESSPSWD, 'Lab credentials must be supplied through the environment.');
const config = { name: 'HRDMO SQL migration acceptance', platform: 'oracle' as const,
  connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo',
  user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
assert.match(config.connectString, /hrdmo/i, 'This writer acceptance script is restricted to the HRDMO lab.');
const prefix = 'ZZ_MIG_' + randomBytes(4).toString('hex').toUpperCase();
const project = prefix + '_P', sql = prefix + '_S', keep = prefix + '_K';
const key = makeKey(DefinitionType.SqlDefinition, sql, '0');
const keepKey = makeKey(DefinitionType.SqlDefinition, keep, '0');
const p = new DatabaseProvider(config), pool = await openDatabase(config.platform, config), c = await pool.getConnection();
setWriteNamePrefix(prefix);
setWriteGuard(async write => { assert.ok([sql, keep, project].includes(write.key.parts[0]), 'Lab guard refuses other definitions.'); });
const checks: { name: string; passed: boolean }[] = [];
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), scope: 'Native Oracle HRDMO provider pipeline; same database source/vacant-target import, no App Designer claim', project, sql, checks };
const reportPath = 'tools/lab/results/project-migration-native-2026-10-20.json';
let owned = false;
const check = async (name: string, fn: () => Promise<void>) => { await fn(); checks.push({ name, passed: true }); console.log('ok ' + checks.length + ' - ' + name); };
const counters = async () => (await c.execute("SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('SRM','PJM','SYS') ORDER BY OBJECTTYPENAME")).rows;
const metadata = { description: 'Migration SQL é', definition: 'Full SQL comments — ' + 'é'.repeat(24000), ownerId: 'PPT' };
const text = "SELECT /* " + 'x'.repeat(7000) + " */ 'migration-ok' AS RESULT FROM PS_INSTALLATION";
async function cleanup() {
  if (!owned) return;
  await c.rollback();
  for (const table of ['PSSQLLANG', 'PSSQLTEXTDEFN', 'PSSQLDESCR', 'PSSQLHASH', 'PSSQLDEFN']) {
    await c.execute(`DELETE FROM ${table} WHERE SQLID IN (:s, :k) AND SQLTYPE = '0'`, { s: sql, k: keep });
  }
  await c.execute('DELETE FROM PSPROJECTITEM WHERE PROJECTNAME = :p', { p: project });
  await c.execute('DELETE FROM PSPROJECTDEFN WHERE PROJECTNAME = :p', { p: project });
  await c.commit();
}
async function independentRead() {
  const [h] = (await c.execute<{ VERSION: number; OBJECTOWNERID: string }>("SELECT VERSION, OBJECTOWNERID FROM PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = '0'", { id: sql })).rows ?? [];
  const [t] = (await c.execute<{ SQLTEXT: string }>("SELECT SQLTEXT FROM PSSQLTEXTDEFN WHERE SQLID = :id AND SQLTYPE = '0'", { id: sql }, { fetchInfo: { SQLTEXT: { type: pool.types.STRING } } })).rows ?? [];
  const [d] = (await c.execute<{ DESCR: string; DESCRLONG: string }>("SELECT DESCR, DESCRLONG FROM PSSQLDESCR WHERE SQLID = :id AND SQLTYPE = '0'", { id: sql }, { fetchInfo: { DESCRLONG: { type: pool.types.STRING } } })).rows ?? [];
  const [hash] = (await c.execute<{ HASH_SIGNATURE: string }>("SELECT HASH_SIGNATURE FROM PSSQLHASH WHERE SQLID = :id AND SQLTYPE = '0'", { id: sql })).rows ?? [];
  assert.ok(h && t && d && hash);
  assert.equal(t.SQLTEXT, text); assert.equal(d.DESCR, metadata.description); assert.equal(d.DESCRLONG, metadata.definition);
  assert.equal(h.OBJECTOWNERID, metadata.ownerId); assert.equal(hash.HASH_SIGNATURE, predictSourceSignature(text));
  return { version: h.VERSION, textCharacters: t.SQLTEXT.length, commentCharacters: d.DESCRLONG.length, hashMatches: true };
}
try {
  await p.connect();
  report.environment = await p.readEnvironment(); report.countersBefore = await counters();
  for (const table of ['PSSQLDEFN', 'PSSQLDESCR', 'PSSQLTEXTDEFN', 'PSSQLHASH', 'PSSQLLANG']) {
    const [r] = (await c.execute<{ N: number }>(`SELECT COUNT(*) AS N FROM ${table} WHERE SQLID IN (:s, :k)`, { s: sql, k: keep })).rows ?? [];
    assert.equal(r.N, 0, 'Unique lab SQL names must be vacant.');
  }
  for (const table of ['PSPROJECTDEFN', 'PSPROJECTITEM']) {
    const [r] = (await c.execute<{ N: number }>(`SELECT COUNT(*) AS N FROM ${table} WHERE PROJECTNAME = :p`, { p: project })).rows ?? [];
    assert.equal(r.N, 0);
  }
  owned = true;
  await p.saveSqlDefinition({ sqlId: sql, text, metadata, expectedSnapshotToken: 'absent', operatorId });
  const created = await p.createProject({ project, operatorId });
  await p.saveProject({ project, openedVersion: created.version, add: [key], operatorId });
  const pkg = parseMigrationPackage(JSON.stringify(await exportMigrationPackage(p, project)));
  await check('Native project export round-trips complete SQL payload without local stamps', async () => {
    assert.equal(pkg.assets.length, 1); assert.equal(pkg.assets[0].kind, 'sql');
    assert.deepEqual(pkg.assets[0].data, { name: sql, text, ...metadata });
    assert.deepEqual(pkg.members.map(projectKeyIdentity), [projectKeyIdentity(key)]);
    assert.ok(!JSON.stringify(pkg).includes('"version"')); report.packageChecksum = pkg.checksum;
  });
  // Remove only these just-created source fixtures, to exercise the real vacant-target path.
  await cleanup();
  const target = await databaseMigrationTarget(p, operatorId);
  const createPlan = await previewMigrationImport(pkg, target);
  await check('Vacant target preview binds native identity and classifies SQL creation', async () => {
    assert.deepEqual(createPlan.blockers, []); assert.equal(createPlan.changes[0].action, 'create');
    assert.equal(createPlan.changes[0].expectedToken, 'absent'); assert.ok(createPlan.targetIdentity);
  });
  await check('Create import commits SQL and project membership with independent full-CLOB/hash readback', async () => {
    const result = await applyMigrationImport(pkg, createPlan, target);
    assert.equal(result.error, undefined); assert.deepEqual(result.completed, [sql]);
    assert.deepEqual((await p.listProjectItems(project)).map(i => projectKeyIdentity(i.key)), [projectKeyIdentity(key)]);
    report.creationReadback = await independentRead();
  });
  await check('Repeated import is unchanged and does not advance SQL/project counters', async () => {
    const before = await counters(), plan = await previewMigrationImport(pkg, target);
    assert.equal(plan.changes[0].action, 'same');
    assert.deepEqual((await applyMigrationImport(pkg, plan, target)).completed, []);
    assert.deepEqual(await counters(), before);
  });
  await check('Update preview shows target text and all changed properties', async () => {
    const live = (await p.readSqlForMigration(key))!;
    await p.saveSqlDefinition({ sqlId: sql, text: 'SELECT 2 FROM PS_INSTALLATION', metadata: { description: 'Target baseline', definition: 'Target comments', ownerId: '' },
      openedVersion: live.version, expectedSnapshotToken: live.token, operatorId });
    const plan = await previewMigrationImport(pkg, target);
    assert.equal(plan.changes[0].action, 'update');
    assert.equal((plan.changes[0].before as { description: string }).description, 'Target baseline');
    assert.equal((await applyMigrationImport(pkg, plan, target)).error, undefined);
    report.updateReadback = await independentRead();
  });
  await check('Imported SQL executes through the read-only native query path', async () => {
    const run = await p.runReadOnlyQuery(text);
    assert.ok(run.rows.length); assert.ok(run.rows.every(r => r.RESULT === 'migration-ok'));
    report.runtime = { rows: run.rows.length, result: 'migration-ok', readOnly: true };
  });
  await check('A concurrent native SQL save invalidates the entire preview before migration writes', async () => {
    const plan = await previewMigrationImport(pkg, target), live = (await p.readSqlForMigration(key))!;
    await p.saveSqlDefinition({ sqlId: sql, text: 'SELECT 3 FROM PS_INSTALLATION', openedVersion: live.version, operatorId });
    const before = await counters();
    await assert.rejects(applyMigrationImport(pkg, plan, target), /Target changed/);
    assert.deepEqual(await counters(), before);
  });
  await check('Native writer rejects metadata drift even when SQL VERSION did not move', async () => {
    const live = (await p.readSqlForMigration(key))!;
    await c.execute("UPDATE PSSQLDESCR SET DESCR = 'Concurrent metadata' WHERE SQLID = :id AND SQLTYPE = '0'", { id: sql }); await c.commit();
    const before = await counters();
    await assert.rejects(p.saveSqlDefinition({ sqlId: sql, text, openedVersion: live.version,
      expectedSnapshotToken: live.token, metadata, operatorId }), /changed after migration preview/);
    assert.deepEqual(await counters(), before);
    assert.equal((await p.readSqlForMigration(key))!.version, live.version);
  });
  await check('Concurrent target project membership invalidates the preview', async () => {
    const plan = await previewMigrationImport(pkg, target);
    await p.saveSqlDefinition({ sqlId: keep, text: 'SELECT 9 FROM PS_INSTALLATION', operatorId });
    await p.saveProject({ project, openedVersion: await p.readProjectVersion(project), add: [keepKey], operatorId });
    const before = await counters();
    await assert.rejects(applyMigrationImport(pkg, plan, target), /Target changed/);
    assert.deepEqual(await counters(), before);
  });
  await check('Fresh preview resumes the SQL update and preserves unrelated target project members', async () => {
    const plan = await previewMigrationImport(pkg, target);
    assert.equal((await applyMigrationImport(pkg, plan, target)).error, undefined);
    const members = (await p.listProjectItems(project)).map(i => i.key.parts[0]).sort();
    assert.deepEqual(members, [sql, keep].sort()); await independentRead();
  });
  await check('Effective-dated SQL cannot be exported through a preferred display variant', async () => {
    try {
      await c.execute("UPDATE PSSQLDEFN SET ENABLEEFFDT = 'Y' WHERE SQLID = :id AND SQLTYPE = '0'", { id: sql });
      // Test the uncommitted native scope directly; no unsupported definition is persisted.
      const { readSqlMigration } = await import('../../src/providers/sqlSnapshot.js');
      await assert.rejects(readSqlMigration(c, pool.types, sql), /migration supports/);
    } finally { await c.rollback(); }
    await independentRead();
  });
  report.passed = true;
} catch (error) { report.passed = false; report.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
  try {
    await cleanup();
    if (owned) {
      for (const table of ['PSSQLDEFN', 'PSSQLDESCR', 'PSSQLTEXTDEFN', 'PSSQLHASH', 'PSSQLLANG']) {
        const [r] = (await c.execute<{ N: number }>(`SELECT COUNT(*) AS N FROM ${table} WHERE SQLID IN (:s, :k)`, { s: sql, k: keep })).rows ?? [];
        assert.equal(r.N, 0);
      }
      for (const table of ['PSPROJECTDEFN', 'PSPROJECTITEM']) {
        const [r] = (await c.execute<{ N: number }>(`SELECT COUNT(*) AS N FROM ${table} WHERE PROJECTNAME = :p`, { p: project })).rows ?? [];
        assert.equal(r.N, 0);
      }
      report.cleanup = 'All uniquely owned lab SQL/project rows absent; version counters retained.';
    }
    report.countersAfter = await counters();
  } catch (error) { report.passed = false; report.cleanupError = String(error); throw error; }
  finally {
    mkdirSync('tools/lab/results', { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    await c.close(); await pool.close(); await p.dispose(); setWriteGuard(undefined); setWriteNamePrefix('');
  }
}
