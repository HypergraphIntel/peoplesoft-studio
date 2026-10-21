/** Disposable HRDMO native writer and durable-review acceptance; not installed UI or cross-database certification. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseProvider } from '../../src/providers/database.js';
import { openDatabase } from '../../src/db/open.js';
import { DefinitionType, makeKey } from '../../src/model/definitions.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard, writeOrigin } from '../../src/providers/writeGuard.js';
import { isReviewedWrite } from '../../src/changeReview/authorization.js';
import { databaseMigrationTarget } from '../../src/providers/migrationTarget.js';
import { applyMigrationImport, exportMigrationPackage, previewMigrationImport } from '../../src/migrationPackage.js';
import Module from 'node:module';
const { createStub } = await import('../../scripts/vscode-stub.mjs');
const { vscode } = createStub(), load = (Module as any)._load;
(Module as any)._load = function(name: string, parent: unknown, main: boolean) { return name === 'vscode' ? vscode : load.call(this, name, parent, main); };
const { databaseReviewAdapters } = await import('../../src/changeReview/adapters.js');
import { stageMigrationImport } from '../../src/changeReview/migration.js';
import { ReviewService } from '../../src/changeReview/service.js';
import { ReviewStore } from '../../src/changeReview/store.js';
import type { Workspace } from '../../src/workspace.js';
import { prepareSourceForSave } from '../../src/peoplecode/writeback/savePlan.js';

const config = { name: 'HRDMO text migration acceptance', platform: 'oracle' as const,
  connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const prefix = 'ZZ_BM_' + randomBytes(3).toString('hex').toUpperCase(), project = prefix + '_P', html = prefix + '_H', css = prefix + '_C', record = prefix + '_R';
assert.ok(record.length <= 15);
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED', p = new DatabaseProvider(config), pool = await openDatabase('oracle', config), c = await pool.getConnection();
const htmlKey = makeKey(DefinitionType.HtmlDefinition, html, '4'), cssKey = makeKey(DefinitionType.StyleSheet, css), codeKey = makeKey(DefinitionType.RecordPeopleCode, record, 'DESCR', 'FieldChange');
const keys = [htmlKey, cssKey, codeKey], names = new Set([html, css, record, project]);
const root = await mkdtemp(path.join(os.tmpdir(), 'psft-text-migration-native-'));
const checks: string[] = [], report: Record<string, unknown> = { checkedAt: new Date().toISOString(), scope: 'Disposable HRDMO native provider/writer and durable ReviewService; test approval via service API, not installed UI; same database source/vacant target', prefix, checks };
let owned = false;
setWriteNamePrefix(prefix);
setWriteGuard(async write => { assert.ok(names.has(write.key.parts[0])); if (writeOrigin() === 'agent') assert.ok(isReviewedWrite(p.id, write.key), 'Every agent write needs the exact reviewed scope.'); });
const check = async (name: string, fn: () => Promise<void>) => { await fn(); checks.push(name); console.log('ok ' + checks.length + ' - ' + name); };
async function cleanup(keepRecord = false) {
  if (!owned) return;
  await c.rollback();
  for (const table of ['PSPCMTXT', 'PSPCMNAME', 'PSPCMPROG', 'PSPCMPROGDEL']) await c.execute(`DELETE FROM ${table} WHERE OBJECTID1=1 AND OBJECTVALUE1=:n`, { n: record });
  for (const table of ['PSCONTENTLANG', 'PSCONTDEFNLANG', 'PSCONTENT', 'PSCONTDEFN']) await c.execute(`DELETE FROM ${table} WHERE CONTNAME IN (:h,:s)`, { h: html, s: css });
  for (const table of ['PSSTYLSHEETDEFN', 'PSSTYLSHEETDEL', 'PSSTYLECLASS']) await c.execute(`DELETE FROM ${table} WHERE STYLESHEETNAME=:n`, { n: css });
  for (const table of ['PSPROJECTITEM', 'PSPROJECTDEFN']) await c.execute(`DELETE FROM ${table} WHERE PROJECTNAME=:n`, { n: project });
  if (!keepRecord) for (const table of ['PSKEYDEFN', 'PSINDEXDEFN', 'PSRECFIELDDB', 'PSRECFIELD', 'PSRECTBLSPC', 'PSRECDEFN', 'PSRECDEL']) await c.execute(`DELETE FROM ${table} WHERE RECNAME=:n`, { n: record });
  await c.commit();
}
try {
  await p.connect();
  for (const key of [htmlKey, cssKey]) assert.equal(await p.readContentForMigration(key), undefined);
  assert.equal(await p.readRecordLayout(makeKey(0, record)), undefined); assert.equal(await p.projectExists(project), false);
  for (const [table, column, name] of [['PSRECDEL','RECNAME',record], ['PSPCMPROGDEL','OBJECTVALUE1',record], ['PSSTYLSHEETDEL','STYLESHEETNAME',css], ['PSPROJECTITEM','PROJECTNAME',project]]) {
    const [row] = (await c.execute<{ N: number }>(`SELECT COUNT(*) AS N FROM ${table} WHERE ${column}=:n`,{n:name})).rows ?? []; assert.equal(Number(row.N),0);
  }
  owned = true;
  await p.saveRecord({ operatorId, edit: { recname: record, recordType: 2, isNew: true, openedVersion: 0, fields: [{ name: 'DESCR', useEdit: 0, isNew: true }] } });
  const text = '<!-- ' + 'é😀'.repeat(11000) + ' -->\r\n<p>Native migration</p>\r\n';
  await p.saveHtmlDefinition({ name: html, text, description: 'Native HTML', operatorId, expectedSnapshotToken: 'absent' });
  await p.saveStyleSheet({ name: css, text: '/* ' + 'é'.repeat(18000) + ' */\r\np { color: red; }\r\n', description: 'Native CSS', operatorId, expectedSnapshotToken: 'absent' });
  await p.savePeopleCode(codeKey, { source: 'Local number &count = 1;\n', openedFingerprint: 'absent', operatorId });
  const created = await p.createProject({ project, operatorId }); await p.saveProject({ project, openedVersion: created.version, add: keys, operatorId });
  const pkg = await exportMigrationPackage(p, project), target = await databaseMigrationTarget(p, operatorId);
  await check('Native export preserves multi-chunk Unicode HTML/CSS and authoritative PeopleCode with owners as prerequisites', async () => {
    assert.deepEqual(new Set(pkg.assets.map(a => a.kind)), new Set(['html','stylesheet','peoplecode']));
    assert.equal(pkg.assets.find(a => a.kind === 'html')!.data.text, text);
    assert.ok(pkg.requirements.some(k => k.type === 0 && k.parts[0] === record));
    assert.ok(pkg.requirements.some(k => k.type === 2 && k.parts[0] === 'DESCR'));
    assert.equal(pkg.assets.find(a => a.kind === 'peoplecode')!.data.text, prepareSourceForSave('Local number &count = 1;'));
  });
  await cleanup(true);
  await check('Vacant target creates each payload and project through production migration writers with full readback', async () => {
    const plan = await previewMigrationImport(pkg, target); assert.deepEqual(plan.blockers, []); assert.ok(plan.changes.every(c => c.action === 'create'));
    const receipt = await applyMigrationImport(pkg, plan, target); assert.equal(receipt.error, undefined); assert.equal(receipt.completed.length, 3);
    for (const asset of pkg.assets) assert.deepEqual((await target.read(asset))!.data, asset.data);
  });
  await check('Unchanged repeat import does not save definitions or bump native counters', async () => {
    const counters = async () => (await c.execute("SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('CRM','SSM','PPC','PJM','SYS') ORDER BY OBJECTTYPENAME")).rows;
    const before = await counters(), plan = await previewMigrationImport(pkg,target); assert.ok(plan.changes.every(c => c.action === 'same'));
    assert.deepEqual((await applyMigrationImport(pkg,plan,target)).completed,[]); assert.deepEqual(await counters(),before);
  });
  await check('Native unchanged-VERSION content metadata edit invalidates both preview and locked writer', async () => {
    const before = (await p.readContentForMigration(htmlKey))!, plan = await previewMigrationImport(pkg,target);
    await c.execute('UPDATE PSCONTDEFN SET DESCR=:d WHERE CONTNAME=:n AND CONTTYPE=4',{d:'Concurrent edit',n:html}); await c.commit();
    try {
      await assert.rejects(applyMigrationImport(pkg,plan,target), /Target changed/);
      await assert.rejects(p.saveHtmlDefinition({ name: html, text, description:'Native HTML', openedVersion:before.version, expectedSnapshotToken:before.token, operatorId }), /snapshot changed/);
    } finally { await c.execute('UPDATE PSCONTDEFN SET DESCR=:d WHERE CONTNAME=:n AND CONTTYPE=4',{d:'Native HTML',n:html}); await c.commit(); }
  });
  await cleanup(true);
  await check('Complete native migration stages without writing; exact fresh review applies all three definitions then target project', async () => {
    const workspace = { connections: [], activeProviders: [p], require: async () => p, isWritable: () => true, isSqlWritable: () => true, isPeopleCodeWritable: () => true,
      configFor: () => ({ peoplesoftOperatorId:operatorId, peoplecodeSaveMode:'compile-and-save' }) } as unknown as Workspace;
    const registered = databaseReviewAdapters(workspace, () => ({ mode: () => 'confirm', confirm: async () => { throw new Error('Legacy prompt must not bypass Change Review.'); }, hasUnsavedEditor: () => false, saved() {} }));
    const service = new ReviewService(new ReviewStore(root), { environment:registered.environment, changed() {} }, registered.adapters);
    const plan = await previewMigrationImport(pkg,target); let set = (await stageMigrationImport(service,p.id,pkg,plan,target,p))!;
    assert.equal(set.objects.length,4); assert.ok(set.objects.every(o => o.review==='PENDING')); assert.equal(await p.readContentForMigration(htmlKey),undefined);
    set = await service.validate(set.id); assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map(c=>c.validation)));
    // Test-only trusted developer decision. This does not claim an installed UI approval.
    set = await service.review(set.id,set.objects.map(o=>o.id),'APPROVED',set.revision); set = await service.apply(set.id);
    assert.equal(set.status,'APPLIED',JSON.stringify(set.journal)); assert.ok(set.objects.every(o=>o.application==='VERIFIED'));
    report.changeSet = {id:set.id,revision:set.revision,objects:set.objects.map(o=>({adapter:o.adapter,operation:o.operation,verified:o.verified}))};
    for (const asset of pkg.assets) assert.deepEqual((await target.read(asset))!.data,asset.data);
    assert.equal((await p.listProjectItems(project)).length,3);
  });
  await check('Native Record-only project export includes its associated stored PeopleCode without adding a separate project member', async () => {
    for (const table of ['PSPROJECTITEM','PSPROJECTDEFN']) await c.execute(`DELETE FROM ${table} WHERE PROJECTNAME=:n`,{n:project}); await c.commit();
    const created=await p.createProject({project,operatorId}); await p.saveProject({project,operatorId,openedVersion:created.version,add:[makeKey(0,record)]});
    const ownedRecord=await exportMigrationPackage(p,project); assert.deepEqual(ownedRecord.assets.map(a=>a.kind),['record','peoplecode']); assert.equal(ownedRecord.members.length,1);
    const same=await previewMigrationImport(ownedRecord,target); assert.deepEqual(same.blockers,[]); assert.ok(same.changes.every(c=>c.action==='same'));
  });
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
  try { await cleanup(); report.cleanupVerified = owned ? !(await p.projectExists(project)) && !(await p.readRecordLayout(makeKey(0,record))) && !(await p.readContentForMigration(htmlKey)) && !(await p.readContentForMigration(cssKey)) : true; }
  finally { await writeFile('tools/lab/results/text-migration-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n'); await c.close(); await pool.close(); await p.dispose(); await rm(root,{recursive:true,force:true}); }
}
