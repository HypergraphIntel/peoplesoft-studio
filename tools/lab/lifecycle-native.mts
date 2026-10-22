/*
 * Application Package / class lifecycle under Change Review on HRDMO (V15-1). Nothing is committed.
 *
 * 1. Rollback previews through the provider (runLifecycleChange, preview): a new class in ZZ_PCODE_LAB_PK3:SUB1, the
 *    deletion of ZZ_PCODE_LAB_PK3:SUB1:Second, a new package ZZ_PKG_REVIEW; deleting ZZ_PCODE_LAB_PK3 (it has classes)
 *    is refused.
 * 2. One native transaction with commit suppressed, rolled back at the end:
 *    - class ZZReview created, its creation undone (checkpoint null again), redone exactly;
 *    - class Second deleted, then re-created from its checkpoint: the scope (row, recompiled PeopleCode, names) equals
 *      the original exactly;
 *    - package ZZ_PKG_REVIEW with subpackage SUB1 and properties created, checkpointed, deleted, then re-created from
 *      the checkpoint exactly.
 *
 *   npx tsx tools/lab/lifecycle-native.mts
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DatabaseProvider } from '../../src/providers/database';
import { readClassScope, readPackageScope, writeClassChange, writePackageChange, type LifecycleScope } from '../../src/providers/classLifecycle';
import { createSubpackage, savePackageProperties } from '../../src/providers/packageWriter';
import type { DbConnection } from '../../src/db/connection';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const provider = p as unknown as { types: never; withConnection<T>(fn: (c: DbConnection) => Promise<T>): Promise<T> };
const types = provider.types;
const NEW_CLASS = ['ZZ_PCODE_LAB_PK3', 'SUB1', 'ZZReview'], OLD_CLASS = ['ZZ_PCODE_LAB_PK3', 'SUB1', 'Second'], PKG = 'ZZ_PKG_REVIEW';
const source = 'class ZZReview\n   method Name() Returns string;\nend-class;\n\nmethod Name\n   /+ Returns String +/\n   Return "review";\nend-method;\n';
const classIntent: LifecycleScope = { scope: 'app-class/1', tables: { PSAPPCLASSDEFN: [{ APPCLASSREF: ' ', DESCR: ' ' }], PSPCMTXT: [{ PROGSEQ: 0, PCTEXT: source }], PSPCMPROG: [], PSPCMNAME: [], PSPACKAGEDEFN: [] } };
const packageIntent: LifecycleScope = { scope: 'app-package/1', tables: { PSAPPCLASSDEFN: [], PSPACKAGEDEFN: [{ PACKAGEID: PKG, PACKAGEROOT: PKG, QUALIFYPATH: '.', PACKAGELEVEL: 0, PACKAGEREF: ' ', DESCR: ' ', OBJECTOWNERID: ' ', DESCRLONG: null }] } };
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), connection: 'HRDMO', mode: 'rollback previews and one rolled-back transaction; nothing persisted' };
const tokens = { newClass: (await p.readLifecycleForReview('class', NEW_CLASS)).token, oldClass: (await p.readLifecycleForReview('class', OLD_CLASS)).token,
  pkg: (await p.readLifecycleForReview('package', [PKG])).token, pk3: (await p.readLifecycleForReview('package', ['ZZ_PCODE_LAB_PK3'])).token };

// 1. Provider rollback previews.
const previews: Record<string, unknown> = {};
const created = await p.runLifecycleChange('class', NEW_CLASS, classIntent, operatorId, tokens.newClass, true);
previews.createClass = { before: created.before.value, after: created.after.value?.tables.PSAPPCLASSDEFN, programRows: created.after.value?.tables.PSPCMPROG.length };
const removed = await p.runLifecycleChange('class', OLD_CLASS, null, operatorId, tokens.oldClass, true);
previews.deleteClass = { beforeRows: removed.before.value?.tables.PSPCMPROG.length, after: removed.after.value };
const pkgCreated = await p.runLifecycleChange('package', [PKG], packageIntent, operatorId, tokens.pkg, true);
previews.createPackage = { after: pkgCreated.after.value?.tables.PSPACKAGEDEFN.length };
await assert.rejects(p.runLifecycleChange('package', ['ZZ_PCODE_LAB_PK3'], null, operatorId, tokens.pk3, true), /still has classes/);
previews.deletePackageWithClasses = 'refused: stage its classes\' deletion first';
report.previews = previews;

// 2. Apply / undo / redo in one rolled-back transaction.
let commitsSuppressed = 0;
await provider.withConnection(async (raw) => {
  const c: DbConnection = { catalog: raw.catalog, execute: (sql, binds, options) => raw.execute(sql, binds, options),
    commit: async () => { commitsSuppressed++; }, rollback: () => raw.rollback(), close: async () => {} };
  try {
    // A new class: create, undo (delete), redo (create; its PSPCMPROGDEL marker cleared).
    const c0 = await readClassScope(c, types, NEW_CLASS);
    await writeClassChange(c, types, NEW_CLASS, c0.value, classIntent, operatorId);
    const c1 = await readClassScope(c, types, NEW_CLASS);
    await writeClassChange(c, types, NEW_CLASS, c1.value, null, operatorId);
    const c2 = await readClassScope(c, types, NEW_CLASS);
    assert.equal(c2.value, null, 'undoing the creation leaves no class');
    await writeClassChange(c, types, NEW_CLASS, null, c1.value, operatorId);
    const c3 = await readClassScope(c, types, NEW_CLASS);
    assert.equal(c3.hash, c1.hash, 'redo re-creates the reviewed class exactly');
    // An existing class: delete, then re-create from its checkpoint (PeopleCode recompiled byte for byte).
    const d0 = await readClassScope(c, types, OLD_CLASS);
    await writeClassChange(c, types, OLD_CLASS, d0.value, null, operatorId);
    assert.equal((await readClassScope(c, types, OLD_CLASS)).value, null);
    await writeClassChange(c, types, OLD_CLASS, null, d0.value, operatorId);
    const d2 = await readClassScope(c, types, OLD_CLASS);
    assert.equal(d2.hash, d0.hash, 'undoing the deletion restores the class exactly');
    // A package with a subpackage and properties: create, checkpoint, delete, re-create from the checkpoint.
    const p0 = await readPackageScope(c, types, PKG);
    await writePackageChange(c, types, PKG, p0.value, packageIntent, operatorId);
    const head = async () => Number((await c.execute<{ V: number }>(`SELECT VERSION AS V FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: PKG }, { outFormat: (types as { OUT_FORMAT_OBJECT: number }).OUT_FORMAT_OBJECT })).rows?.[0]?.V);
    await createSubpackage(c, { root: PKG, path: ['SUB1'], openedVersion: await head(), operatorId });
    await savePackageProperties(c, { root: PKG, openedVersion: await head(), description: 'Review lab package', comments: 'Created and deleted by review', ownerId: '', operatorId });
    const p1 = await readPackageScope(c, types, PKG);
    await writePackageChange(c, types, PKG, p1.value, null, operatorId);
    assert.equal((await readPackageScope(c, types, PKG)).value, null);
    await writePackageChange(c, types, PKG, null, p1.value, operatorId);
    const p3 = await readPackageScope(c, types, PKG);
    assert.equal(p3.hash, p1.hash, 'undoing the package deletion restores root, subpackage and properties exactly');
    report.cycle = { newClass: { created: true, undone: true, redoEqual: true }, existingClass: { class: OLD_CLASS.join(':'), deletedAndRestoredExactly: true, programRows: d0.value?.tables.PSPCMPROG.length },
      package: { root: PKG, rows: p1.value?.tables.PSPACKAGEDEFN.length, deletedAndRestoredExactly: true } };
  } finally { await raw.rollback(); }
});
for (const [label, [kind, key, token]] of Object.entries({ newClass: ['class', NEW_CLASS, tokens.newClass], oldClass: ['class', OLD_CLASS, tokens.oldClass], pkg: ['package', [PKG], tokens.pkg] } as const)) {
  assert.equal((await p.readLifecycleForReview(kind, key)).token, token, `${label}: nothing persisted`);
}
Object.assign(report, { commitsSuppressed, persisted: false, notVerified: ['developer-approved application through the installed review UI', 'App Designer reopen of a re-created class'] });
writeFileSync('tools/lab/results/lifecycle-native.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(0);
