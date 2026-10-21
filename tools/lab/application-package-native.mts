/** Native HRDMO metadata acceptance. Creates only a unique disposable package, then removes its rows. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { DatabaseProvider } from '../../src/providers/database.js';
import { openDatabase } from '../../src/db/open.js';
import { makeKey } from '../../src/model/definitions.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard } from '../../src/providers/writeGuard.js';

assert.ok(process.env.PSLAB_ACCESSID && process.env.PSLAB_ACCESSPSWD, 'Supply lab credentials through the environment.');
const config = { name: 'HRDMO package acceptance', platform: 'oracle' as const, connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo',
  user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i);
const root = 'ZZ_AP_' + randomBytes(4).toString('hex').toUpperCase(), operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const p = new DatabaseProvider(config), pool = await openDatabase('oracle', config), c = await pool.getConnection();
setWriteNamePrefix(root); setWriteGuard(async write => { assert.equal(write.key.parts[0], root); });
const checks: { name: string; passed: boolean }[] = [], report: Record<string, any> = {
  checkedAt: new Date().toISOString(), root, scope: 'Oracle HRDMO provider save/readback; no native App Designer equivalence claim', checks, cleanupVerified: false };
const check = async (name: string, fn: () => Promise<void>) => { await fn(); checks.push({ name, passed: true }); console.log(`ok ${checks.length} - ${name}`); };
const counters = async () => (await c.execute<{ T: string; V: number }>("SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('APM','PCM','SYS') ORDER BY OBJECTTYPENAME")).rows!;
let owned = false;
try {
  await p.connect(); report.environment = await p.readEnvironment();
  assert.equal(await p.packageExists(root), false); owned = true;
  await check('new empty package has a root tree and independent native row', async () => {
    await p.createPackage({ name: root, operatorId });
    const doc = await p.readApplicationPackage(root); assert.ok(doc); assert.equal(doc.tree.children.length, 0);
    assert.equal((await c.execute<{ N: number }>('SELECT COUNT(*) AS N FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r', { r: root })).rows![0].N, 1);
  });
  const first = (await p.readApplicationPackage(root))!;
  await check('empty subpackage commits with APM/SYS +1, unchanged PCM and native readback', async () => {
    const before = await counters(); await p.createSubpackage({ root, path: ['Sub'], openedVersion: first.version!, operatorId });
    const after = await counters();
    for (const row of before) assert.equal(after.find(r => r.T === row.T)!.V, row.V + (row.T.trim() === 'PCM' ? 0 : 1));
    const doc = (await p.readApplicationPackage(root))!; assert.equal(doc.tree.children[0].name, 'Sub'); assert.equal(doc.tree.children[0].children.length, 0);
  });
  await check('stale package tree is refused without advancing counters', async () => {
    const before = await counters();
    await assert.rejects(p.createSubpackage({ root, path: ['Stale'], openedVersion: first.version!, operatorId }), /changed/);
    assert.deepEqual(await counters(), before);
  });
  await check('nested empty package saves, duplicate sibling is refused, dry run leaves no rows', async () => {
    let doc = (await p.readApplicationPackage(root))!;
    await p.createSubpackage({ root, path: ['Sub', 'Nested'], openedVersion: doc.version!, operatorId });
    doc = (await p.readApplicationPackage(root))!;
    assert.equal(doc.tree.children[0].children[0].name, 'Nested');
    const before = await counters();
    await assert.rejects(p.createSubpackage({ root, path: ['Sub', 'Nested'], openedVersion: doc.version!, operatorId }), /already exists/);
    await p.createSubpackage({ root, path: ['Dry'], openedVersion: doc.version!, operatorId, dryRun: true });
    assert.deepEqual(await counters(), before); assert.ok(!(await p.readApplicationPackage(root))!.tree.children.some(n => n.name === 'Dry'));
  });
  const key = makeKey(58, root, 'Sub', 'Nested', 'Leaf', 'OnExecute');
  const source = 'class Leaf\n   method Value() Returns string;\nend-class;\n\nmethod Value\n   Return "ready";\nend-method;\n';
  const storedSource = source.replace('method Value\n', 'method Value\n   /+ Returns String +/\n');
  await check('class creation saves PeopleCode under its nested tree identity and reopens stored source', async () => {
    await p.savePeopleCode(key, { source, openedFingerprint: 'absent', operatorId, createClass: true });
    const doc = (await p.readApplicationPackage(root))!, leaf = doc.tree.children[0].children[0].children[0];
    assert.equal(leaf.kind, 'class'); assert.deepEqual(leaf.key, key);
    assert.equal((await p.readPeopleCodeForEdit(key))?.text, storedSource);
    assert.ok((await p.readText(key)).includes('ready'));
  });
  await check('normal class edit saves and stale PeopleCode edit is refused', async () => {
    const before = (await p.readPeopleCodeForEdit(key))!;
    const updated = storedSource.replace('ready', 'updated');
    await p.savePeopleCode(key, { source: updated, openedFingerprint: before.fingerprint, operatorId });
    assert.equal((await p.readPeopleCodeForEdit(key))?.text, updated);
    await assert.rejects(p.savePeopleCode(key, { source, openedFingerprint: before.fingerprint, operatorId }), /changed in the database/);
  });
  report.passed = true;
} catch (error) { report.passed = false; report.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
  try {
    if (owned) {
      await c.rollback();
      for (const table of ['PSPCMTXT', 'PSPCMNAME', 'PSPCMPROG', 'PSPCMPROGDEL']) await c.execute(`DELETE FROM ${table} WHERE OBJECTID1 = 104 AND OBJECTVALUE1 = :r`, { r: root });
      await c.execute('DELETE FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r', { r: root });
      await c.execute('DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r', { r: root }); await c.commit();
      const [row] = (await c.execute<{ N: number }>(`SELECT (SELECT COUNT(*) FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r)
        + (SELECT COUNT(*) FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r)
        + (SELECT COUNT(*) FROM PSPCMPROG WHERE OBJECTID1 = 104 AND OBJECTVALUE1 = :r) AS N FROM DUAL`, { r: root })).rows!;
      assert.equal(row.N, 0); report.cleanupVerified = true;
    }
  } finally {
    await writeFile('tools/lab/results/application-package-native-2026-10-20.json', JSON.stringify(report, null, 2) + '\n');
    await c.close(); await pool.close(); await p.dispose(); setWriteGuard(undefined); setWriteNamePrefix('');
  }
}
