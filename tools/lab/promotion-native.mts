/**
 * V15-2: promotion between two separate Oracle environments, HRDMO (source, read only) -> HRDEV (target), through the
 * production promotion path (promoteProject: export, environment check, preview, Change Review staging) and the real
 * ReviewService with database adapters. Approval uses the trusted service test API, not the installed UI.
 *
 *   1. Promoting to the same environment is refused.
 *   2. Missing target prerequisites block a promotion (ZZ_XA8_PRJ) and nothing is staged or written.
 *   3. ZZ_RF_PRJ (record, SQL, App Engine) promotes, applies with exact readback, undoes (destructive) and redoes.
 *   4. ZZ_RPT_INVENTORY with a conflicting definition created in the target after staging: the application stops
 *      partway (PARTIALLY_APPLIED) without overwriting it; promoting again stages only what still differs and completes.
 *   5. Cleanup removes every promoted definition, project and tombstone from HRDEV, restoring its starting counts.
 *
 * WRITES HRDEV (lab): ZZ_ definitions only, removed at the end. HRDMO is only read.
 *   npx tsx tools/lab/promotion-native.mts
 */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
import { DatabaseProvider } from '../../src/providers/database.js';
import { DefinitionType, makeKey } from '../../src/model/definitions.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard, writeOrigin } from '../../src/providers/writeGuard.js';
import { isReviewedWrite } from '../../src/changeReview/authorization.js';
import { readMigrationAsset, databaseMigrationTarget } from '../../src/providers/migrationTarget.js';
import { migrationHash, exportMigrationPackage, previewMigrationImport } from '../../src/migrationPackage.js';
import { stageMigrationImport } from '../../src/changeReview/migration.js';
import { ReviewService } from '../../src/changeReview/service.js'; import { ReviewStore } from '../../src/changeReview/store.js';
import { promoteProject } from '../../src/changeReview/promotion.js';
import type { Workspace } from '../../src/workspace.js';
const { createStub } = await import('../../scripts/vscode-stub.mjs'); const { vscode } = createStub(), load = (Module as any)._load;
(Module as any)._load = function (n: string, p: unknown, m: boolean) { return n === 'vscode' ? vscode : load.call(this, n, p, m); };
const { databaseReviewAdapters } = await import('../../src/changeReview/adapters.js');

const cfg = (svc: string, name: string) => ({ name, platform: 'oracle' as const, connectString: '127.0.0.1:15210/' + svc, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
const src = new DatabaseProvider(cfg('hrdmo', 'HRDMO')), tgt = new DatabaseProvider(cfg('hrdev', 'HRDEV')), same = new DatabaseProvider(cfg('HRDMO', 'HRDMO again'));
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const checks: string[] = [], report: Record<string, unknown> = { checkedAt: new Date().toISOString(), source: 'HRDMO (PDB HRDMO, CDB CDBHCM)', target: 'HRDEV (PDB HRDEV, CDB CDBHCM)',
  scope: 'promotion between two separate Oracle PeopleTools 8.62.09 databases (cloned PDBs in one container, same PeopleSoft GUID); production promoteProject + ReviewService + database adapters; trusted service test approval, not installed UI', checks };
const check = async (name: string, fn: () => Promise<void>) => { await fn(); checks.push(name); console.log('ok ' + checks.length + ' - ' + name); };
await src.connect(); await tgt.connect(); await same.connect();
setWriteNamePrefix('ZZ_');
setWriteGuard(async w => { if (writeOrigin() === 'agent') assert.ok(isReviewedWrite(tgt.id, w.key), JSON.stringify(w.key)); });

const counts = async () => tgt['withConnection'](async (c: any) => (await c.execute(`SELECT (SELECT COUNT(*) FROM PSRECDEFN WHERE RECNAME LIKE 'ZZ%') R, (SELECT COUNT(*) FROM PSDBFIELD WHERE FIELDNAME LIKE 'ZZ%') F,
  (SELECT COUNT(*) FROM PSSQLDEFN WHERE SQLID LIKE 'ZZ%') S, (SELECT COUNT(*) FROM PSAEAPPLDEFN WHERE AE_APPLID LIKE 'ZZ%') A, (SELECT COUNT(*) FROM PSPROJECTDEFN WHERE PROJECTNAME LIKE 'ZZ%') J FROM DUAL`)).rows[0]);
const startCounts = await counts();
const dir = await mkdtemp(path.join(os.tmpdir(), 'psft-promotion-native-'));
const workspace = { connections: [], activeProviders: [tgt], require: async () => tgt, isWritable: () => true, isSqlWritable: () => true, isPeopleCodeWritable: () => true,
  configFor: () => ({ peoplesoftOperatorId: operatorId, peoplecodeSaveMode: 'compile-and-save' }) } as unknown as Workspace;
const registry = databaseReviewAdapters(workspace, () => ({ mode: () => 'confirm', confirm: async () => { throw Error('No legacy confirmation path.'); }, hasUnsavedEditor: () => false, saved() {} }) as never);
const service = new ReviewService(new ReviewStore(dir), { environment: registry.environment, changed() {} }, registry.adapters);
const approveApply = async (id: string, destructive = false) => {
  const s = await service.validate(id); assert.equal(s.status, 'READY_FOR_REVIEW', JSON.stringify(s.objects.map(o => [o.adapter, o.validation])));
  await service.review(id, s.objects.map(o => o.id), 'APPROVED', s.revision, destructive); return service.apply(id);
};
const promoted = new Set<string>();
const exact = async (pkgAssets: { key: any; data: any }[]) => { for (const a of pkgAssets) assert.equal(migrationHash((await readMigrationAsset(tgt, a.key))?.data ?? null), migrationHash(a.data), a.key.parts.join('.')); };

let failure: unknown;
try {
  await check('promotion to the same environment (HRDMO reached through another connection) is refused before anything is read or staged', async () => {
    await assert.rejects(promoteProject(service, src, 'ZZ_RF_PRJ', same, operatorId), /same environment/);
    assert.equal((await service.store.list()).length, 0);
  });
  await check('missing target prerequisites block the promotion of ZZ_XA8_PRJ; nothing is staged or written', async () => {
    const r = await promoteProject(service, src, 'ZZ_XA8_PRJ', tgt, operatorId);
    assert.equal(r.staged, undefined); assert.ok(r.plan.blockers.some(b => /Required definition missing: ZZ_XA8_F2/.test(b))); assert.ok(r.plan.blockers.some(b => /needs its Application Package/.test(b)));
    report.prerequisiteBlockers = r.plan.blockers;
    assert.deepEqual(await counts(), startCounts);
  });
  let rf = await promoteProject(service, src, 'ZZ_RF_PRJ', tgt, operatorId);
  for (const a of rf.package.assets) promoted.add(a.kind + ':' + a.data.name); promoted.add('project:ZZ_RF_PRJ');
  await check('ZZ_RF_PRJ (record, SQL, App Engine) stages on HRDEV, applies, and reads back exactly as exported from HRDMO', async () => {
    assert.ok(rf.staged); assert.deepEqual(rf.plan.changes.map(c => c.action), rf.plan.changes.map(() => 'create'));
    const applied = await approveApply(rf.staged!.id); assert.equal(applied.status, 'APPLIED', JSON.stringify(applied.journal.at(-1)));
    await exact(rf.package.assets); assert.ok(await tgt.projectExists('ZZ_RF_PRJ'));
    assert.equal((await promoteProject(service, src, 'ZZ_RF_PRJ', tgt, operatorId)).staged, undefined, 'promoting again changes nothing');
  });
  await check('the applied promotion undoes on HRDEV (destructive approval) and redoes exactly', async () => {
    const undo = await service.reverse(rf.staged!.id); const undone = await approveApply(undo.id, true); assert.equal(undone.status, 'APPLIED', JSON.stringify(undone.journal.at(-1)));
    for (const a of rf.package.assets) assert.equal(await readMigrationAsset(tgt, a.key), undefined, a.data.name);
    assert.equal(await tgt.projectExists('ZZ_RF_PRJ'), false);
    const redo = await service.redo(undo.id); const redone = await approveApply(redo.id); assert.equal(redone.status, 'APPLIED', JSON.stringify(redone.journal.at(-1)));
    await exact(rf.package.assets); assert.ok(await tgt.projectExists('ZZ_RF_PRJ'));
  });
  const inv = await promoteProject(service, src, 'ZZ_RPT_INVENTORY', tgt, operatorId);
  for (const a of inv.package.assets) promoted.add(a.kind + ':' + a.data.name); promoted.add('project:ZZ_RPT_INVENTORY');
  await check('a target change made after approval stops the application before any write (no partial overwrite), and a target field of another type blocks promotion explicitly', async () => {
    assert.ok(inv.staged);
    const s = await service.validate(inv.staged!.id); assert.equal(s.status, 'READY_FOR_REVIEW');
    await service.review(s.id, s.objects.map(o => o.id), 'APPROVED', s.revision);
    // Another developer's ZZ_RPT_TOTAL appears in the target after approval, before application.
    await tgt.createField({ name: 'ZZ_RPT_TOTAL', type: 0, length: 10, decimalPositions: 0, label: { id: 'ZZ_RPT_TOTAL', longName: 'Target-only total', shortName: 'Total' }, operatorId });
    const stopped = await service.apply(s.id);
    report.conflict = { status: stopped.status, verified: stopped.objects.filter(o => o.application === 'VERIFIED').length };
    assert.equal(stopped.status, 'CONFLICTED'); assert.equal(stopped.objects.filter(o => o.application === 'VERIFIED').length, 0);
    for (const a of inv.package.assets.filter(a => a.data.name !== 'ZZ_RPT_TOTAL')) assert.equal(await readMigrationAsset(tgt, a.key), undefined, a.data.name);
    const blocked = await promoteProject(service, src, 'ZZ_RPT_INVENTORY', tgt, operatorId);
    assert.equal(blocked.staged, undefined); assert.ok(blocked.plan.blockers.includes('Migration cannot change a field type.'));
    report.typeConflict = blocked.plan.blockers;
    // The other developer withdraws the field (lab cleanup of that row only).
    await tgt['withConnection'](async (c: any) => { for (const t of ['PSDBFLDLABL', 'PSDBFIELD']) await c.execute(`DELETE FROM ${t} WHERE FIELDNAME = 'ZZ_RPT_TOTAL'`); await c.commit(); });
  });
  await check('a writer failure after earlier definitions committed leaves PARTIALLY_APPLIED; the remaining work is prepared, freshly approved and completes exactly', async () => {
    const again = await promoteProject(service, src, 'ZZ_RPT_INVENTORY', tgt, operatorId);
    assert.ok(again.staged, JSON.stringify(again.plan.blockers));
    const s = await service.validate(again.staged!.id); assert.equal(s.status, 'READY_FOR_REVIEW');
    await service.review(s.id, s.objects.map(o => o.id), 'APPROVED', s.revision);
    // Inject one failure in the record writer for ZZ_RPT_LINE, before its DML, after the fields and ZZ_RPT_AET committed.
    const save = tgt.saveRecord.bind(tgt); let injected = false;
    (tgt as any).saveRecord = async (request: any) => { if (!injected && request.edit?.recname === 'ZZ_RPT_LINE' && !request.dryRun) { injected = true; throw new Error('Injected writer failure (lab)'); } return save(request); };
    const partial = await service.apply(s.id);
    (tgt as any).saveRecord = save;
    report.partial = { status: partial.status, verified: partial.objects.filter(o => o.application === 'VERIFIED').length, pending: partial.objects.filter(o => o.application === 'PENDING').length, injected };
    assert.ok(injected); assert.equal(partial.status, 'PARTIALLY_APPLIED', JSON.stringify(partial.journal.slice(-3)));
    // The failed writer's outcome is reconciled from live state (it wrote nothing), never retried blindly.
    const reconciled = await service.recover(s.id);
    report.reconciled = { status: reconciled.status, objects: reconciled.objects.map(o => o.application) };
    const rest = await service.prepareRemaining(s.id);
    const done = await approveApply(rest.id); assert.equal(done.status, 'APPLIED', JSON.stringify(done.journal.at(-1)));
    await exact(inv.package.assets); assert.ok(await tgt.projectExists('ZZ_RPT_INVENTORY'));
    assert.equal((await promoteProject(service, src, 'ZZ_RPT_INVENTORY', tgt, operatorId)).staged, undefined, 'nothing left to promote');
  });
  // A broader shape: an SQL Table with alternate search keys and Oracle In-Memory (Selective Fields), carried by its field settings.
  const r6 = makeKey(DefinitionType.Record, 'ZZ_PCODE_LAB_R6'), r6Layout = (await src.readRecordLayout(r6))!;
  const r6Keys = [r6, ...r6Layout.fields.map(f => makeKey(DefinitionType.Field, f.name))];
  const r6Package = await exportMigrationPackage(Object.assign(Object.create(src), { listProjectItems: async () => r6Keys.map(key => ({ key, name: key.parts.join('.') })) }), 'ZZ_R6_PRJ');
  for (const a of r6Package.assets) promoted.add(a.kind + ':' + a.data.name); promoted.add('project:ZZ_R6_PRJ');
  await check('an SQL Table with alternate search keys and Oracle In-Memory promotes; its six-table checkpoint equals the source\'s; undo removes it', async () => {
    const backend = await databaseMigrationTarget(tgt, operatorId), plan = await previewMigrationImport(r6Package, backend);
    assert.deepEqual(plan.blockers, []);
    const staged = (await stageMigrationImport(service, tgt.id, r6Package, plan, backend, tgt))!;
    const applied = await approveApply(staged.id); assert.equal(applied.status, 'APPLIED', JSON.stringify(applied.journal.at(-1)));
    const a = await src.readStructuredForReview('record', 'ZZ_PCODE_LAB_R6'), b = await tgt.readStructuredForReview('record', 'ZZ_PCODE_LAB_R6');
    const portable = (v: any) => ({ ...v.tables, PSRECTBLSPC: v.tables.PSRECTBLSPC.map((r: any) => ({ ...r, DBNAME: '(database)' })) });
    assert.deepEqual(portable(b.value), portable(a.value), 'record, fields, alternate-key indexes and In-Memory flags equal the source');
    report.alternateKeys = { indexes: b.value.tables.PSINDEXDEFN.map((r: any) => String(r.INDEXID).trim()), auxFlagMask: b.value.tables.PSRECDEFN[0].AUXFLAGMASK };
    const undo = await service.reverse(staged.id); const undone = await approveApply(undo.id, true); assert.equal(undone.status, 'APPLIED', JSON.stringify(undone.journal.at(-1)));
    assert.equal(await tgt.readRecordLayout(r6), undefined);
  });
  // A message channel (Properties and partition fields); messages travel as their own definitions.
  const chnl = makeKey(DefinitionType.MessageChannel, 'ZZ_CHNL_E2E4'), chnlData = (await src.readChannelForMigration('ZZ_CHNL_E2E4'))!.data;
  const chnlKeys = [chnl, ...chnlData.partitions.filter(f => f.startsWith('ZZ')).map(f => makeKey(DefinitionType.Field, f))];
  const chnlPackage = await exportMigrationPackage(Object.assign(Object.create(src), { listProjectItems: async () => chnlKeys.map(key => ({ key, name: key.parts.join('.') })) }), 'ZZ_CHNL_PRJ');
  for (const a of chnlPackage.assets) promoted.add(a.kind + ':' + a.data.name); promoted.add('project:ZZ_CHNL_PRJ'); promoted.add('channel:ZZ_CHNL_E2E4');
  await check('a message channel promotes with its properties and partition fields exactly, and undo deletes it', async () => {
    const backend = await databaseMigrationTarget(tgt, operatorId), plan = await previewMigrationImport(chnlPackage, backend);
    assert.deepEqual(plan.blockers, []);
    const staged = (await stageMigrationImport(service, tgt.id, chnlPackage, plan, backend, tgt))!;
    const applied = await approveApply(staged.id); assert.equal(applied.status, 'APPLIED', JSON.stringify(applied.journal.at(-1)));
    assert.equal(migrationHash((await tgt.readChannelForMigration('ZZ_CHNL_E2E4'))!.data), migrationHash(chnlData));
    report.channel = { partitions: chnlData.partitions, status: chnlData.status, thruput: chnlData.thruput };
    const undo = await service.reverse(staged.id); const undone = await approveApply(undo.id, true); assert.equal(undone.status, 'APPLIED', JSON.stringify(undone.journal.at(-1)));
    assert.equal(await tgt.readChannelDocument('ZZ_CHNL_E2E4'), undefined);
  });
} catch (error) { failure = error; } finally {
  // Remove every promoted definition, its PeopleCode/SQL and tombstones, and the projects from HRDEV.
  await tgt['withConnection'](async (c: any) => {
    const names = [...promoted].map(x => x.split(':')[1]);
    for (const n of names.filter(n => promoted.has('record:' + n))) for (const t of ['PSRECFIELDDB', 'PSRECFIELD', 'PSINDEXDEFN', 'PSKEYDEFN', 'PSRECTBLSPC', 'PSRECDEFN', 'PSRECDEL']) await c.execute(`DELETE FROM ${t} WHERE RECNAME = :n`, { n });
    for (const n of [...names.filter(n => promoted.has('field:' + n)), 'ZZ_RPT_TOTAL']) for (const t of ['PSXLATITEM', 'PSXLATDEFN', 'PSXLATDEFNDEL', 'PSDBFLDLABL', 'PSDBFIELD', 'PSDBFIELDDEL']) await c.execute(`DELETE FROM ${t} WHERE FIELDNAME = :n`, { n }).catch(() => {});
    for (const n of names.filter(n => promoted.has('ae:' + n))) {
      for (const t of ['PSAEAPPLDEL', 'PSAESECTDEL', 'PSAEAPPLDEFN', 'PSAEAPPLSTATE', 'PSAEAPPLTEMPTBL', 'PSAEAPPLLANG', 'PSAESECTDEFN', 'PSAESECTDTLDEFN', 'PSAESTEPDEFN', 'PSAESTMTDEFN', 'PSAESTEPMSGDEFN']) await c.execute(`DELETE FROM ${t} WHERE AE_APPLID = :n`, { n });
      for (const t of ['PSSQLTEXTDEFN', 'PSSQLHASH', 'PSSQLDESCR', 'PSSQLDEFN', 'PSSQLDEL']) await c.execute(`DELETE FROM ${t} WHERE SUBSTR(SQLID, 1, 12) = RPAD(:n, 12) AND SQLTYPE IN ('1', '6')`, { n });
      for (const t of ['PSPCMTXT', 'PSPCMNAME', 'PSPCMPROG', 'PSPCMPROGDEL']) await c.execute(`DELETE FROM ${t} WHERE OBJECTID1 = 66 AND OBJECTVALUE1 = :n`, { n });
    }
    for (const n of names.filter(n => promoted.has('sql:' + n))) for (const t of ['PSSQLTEXTDEFN', 'PSSQLHASH', 'PSSQLDESCR', 'PSSQLDEFN', 'PSSQLDEL']) await c.execute(`DELETE FROM ${t} WHERE SQLID = :n`, { n });
    for (const t of ['PSSUBCHNL', 'PSCHNLNODE', 'PSCHNLDEFNLANG', 'PSCHNLDEFN', 'PSCHNLDEL']) await c.execute(`DELETE FROM ${t} WHERE CHNLNAME = 'ZZ_CHNL_E2E4'`).catch(() => {});
    for (const n of ['ZZ_RF_PRJ', 'ZZ_RPT_INVENTORY', 'ZZ_R6_PRJ', 'ZZ_CHNL_PRJ']) for (const t of ['PSPROJECTITEM', 'PSPROJECTDEFN', 'PSPROJECTDEL']) await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME = :n`, { n });
    await c.commit();
  });
  report.cleanup = { start: startCounts, end: await counts() };
  if (failure) { console.error(failure); process.exit(1); }
  assert.deepEqual(await counts(), startCounts, 'HRDEV returned to its starting ZZ_ counts');
  await writeFile('tools/lab/results/promotion-native.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
