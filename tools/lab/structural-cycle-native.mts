/*
 * Structural Change Review apply -> checkpoint inverse -> redo, on HRDMO, inside ONE native transaction that is rolled
 * back at the end. The connection's commit() is a no-op, so each writer runs its real DML, verification and counters,
 * and the snapshots are read in the same session; nothing is ever committed. The page / record token is read again on
 * a separate connection after the rollback and must equal the starting token.
 *
 * Page ZZ_JOB_DATA1: delete control 123 + add a Static Text + move 112 last (Related Field references renumbered),
 *   then the exact inverse (control 123 restored under its id, the added id released, MAXPNLFLDID returned), then redo.
 * Record ZZ_RPT_LINE: insert DESCR first + remove ZZ_RPT_COUNT, inverse (ZZ_RPT_COUNT restored from its own row), redo.
 *
 *   npx tsx tools/lab/structural-cycle-native.mts
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DatabaseProvider } from '../../src/providers/database';
import { DefinitionType } from '../../src/model/definitions';
import { applyPageOperations } from '../../src/model/pageOperations';
import { applyRecordOperations } from '../../src/model/recordOperations';
import { savePage } from '../../src/providers/pageWriter';
import { readPageSnapshot, requestForPageSnapshot } from '../../src/providers/pageSnapshot';
import { saveRecord } from '../../src/providers/recordWriter';
import { readStructuredSnapshot } from '../../src/providers/structuredSnapshot';
import { recordStructureRequest } from '../../src/changeReview/structuredHeaders';
import type { DbConnection } from '../../src/db/connection';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED', PAGE = 'ZZ_JOB_DATA1', RECORD = 'ZZ_RPT_LINE';
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const provider = p as unknown as { types: never; withConnection<T>(fn: (c: DbConnection) => Promise<T>): Promise<T> };
const types = provider.types;
const startPage = await p.readPageForReview(PAGE), startRecord = await p.readStructuredForReview('record', RECORD);
const { layout } = await p.readPageLayout({ type: DefinitionType.Page, parts: [PAGE] });
const recordLayout = (await p.readRecordLayout({ type: DefinitionType.Record, parts: [RECORD] }))!;
let commitsSuppressed = 0;
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), connection: 'HRDMO',
  mode: 'apply/inverse/redo in one native transaction, rolled back; commit suppressed; nothing persisted' };

await provider.withConnection(async (raw) => {
  // The writers' commits become no-ops; their own rollback-on-error and the final rollback undo everything.
  const c: DbConnection = { catalog: raw.catalog, execute: (sql, binds, options) => raw.execute(sql, binds, options),
    commit: async () => { commitsSuppressed++; }, rollback: () => raw.rollback(), close: async () => {} };
  try {
    // ---- Page
    const s0 = await readPageSnapshot(c, types, PAGE);
    assert.equal(s0.token, startPage.token);
    const edited = applyPageOperations(layout, [{ op: 'delete', id: 123 }, { op: 'add', kind: 'staticText', left: 28, top: 64, label: 'Structural cycle' }]);
    const order = [...layout.controls.map((x) => x.pnlFldId).filter((id) => id !== 123 && id !== 112), 112];
    // The editor's own save (staging would capture this after-image in rollback; here it is applied, uncommitted).
    const forwardOrder = edited.controls.filter((x) => !x.add).map((x) => x.pnlFldId);
    await savePage(c, { pnlName: PAGE, openedVersion: s0.version, operatorId, controls: edited.controls, order: forwardOrder.filter((id) => order.includes(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b)) });
    const s1 = await readPageSnapshot(c, types, PAGE);
    const ids = (s: typeof s0) => s.value.tables.PSPNLFIELD.map((r) => r.PNLFLDID as number);
    const added = ids(s1).filter((id) => !ids(s0).includes(id));
    // Checkpoint inverse, exactly as the review rebuilds it.
    await savePage(c, { ...requestForPageSnapshot(PAGE, s1.value, s0.value, s1.version, operatorId), expectedSnapshotToken: s1.token }, types);
    const s2 = await readPageSnapshot(c, types, PAGE);
    assert.equal(s2.hash, s0.hash, 'Page inverse restores the checkpoint exactly');
    // Redo.
    await savePage(c, { ...requestForPageSnapshot(PAGE, s2.value, s1.value, s2.version, operatorId), expectedSnapshotToken: s2.token }, types);
    const s3 = await readPageSnapshot(c, types, PAGE);
    assert.equal(s3.hash, s1.hash, 'Page redo restores the reviewed after-image exactly');
    report.page = { page: PAGE, deleted: [123], added, movedLast: 112,
      maxPnlFldId: [s0.value.tables.PSPNLDEFN[0].MAXPNLFLDID, s1.value.tables.PSPNLDEFN[0].MAXPNLFLDID, s2.value.tables.PSPNLDEFN[0].MAXPNLFLDID, s3.value.tables.PSPNLDEFN[0].MAXPNLFLDID],
      inverseEqualsCheckpoint: true, redoEqualsAfterImage: true, versions: [s0.version, s1.version, s2.version, s3.version] };

    // ---- Record
    const r0 = await readStructuredSnapshot(c, types, 'record', RECORD);
    assert.equal(r0.token, startRecord.token);
    const last = recordLayout.fields[recordLayout.fields.length - 1].name;
    const edit = applyRecordOperations({ recname: RECORD, recordType: recordLayout.recordType, openedVersion: r0.version,
      fields: recordLayout.fields.map((f) => ({ name: f.name, useEdit: f.useEdit, useEdit2: f.useEdit2 ?? 0, isNew: false })) },
      recordLayout.recordType, [{ op: 'insert_field', field: 'DESCR' }, { op: 'move_field', field: 'DESCR' }, { op: 'remove_field', field: last }]);
    await saveRecord(c, { edit, operatorId }, types);
    const r1 = await readStructuredSnapshot(c, types, 'record', RECORD);
    await saveRecord(c, { ...recordStructureRequest(RECORD, r1.value, r0.value, r1.version, operatorId), expectedSnapshotToken: r1.token }, types);
    const r2 = await readStructuredSnapshot(c, types, 'record', RECORD);
    assert.equal(r2.hash, r0.hash, 'Record inverse restores the checkpoint exactly (the removed field from its own row)');
    await saveRecord(c, { ...recordStructureRequest(RECORD, r2.value, r1.value, r2.version, operatorId), expectedSnapshotToken: r2.token }, types);
    const r3 = await readStructuredSnapshot(c, types, 'record', RECORD);
    assert.equal(r3.hash, r1.hash, 'Record redo restores the reviewed after-image exactly');
    const names = (s: typeof r0) => [...s.value.tables.PSRECFIELD].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM)).map((x) => String(x.FIELDNAME).trim());
    report.record = { record: RECORD, fields: [names(r0), names(r1), names(r2), names(r3)], inverseEqualsCheckpoint: true, redoEqualsAfterImage: true };
  } finally {
    await raw.rollback();
  }
});
assert.equal((await p.readPageForReview(PAGE)).token, startPage.token, 'nothing persisted: page token unchanged');
assert.equal((await p.readStructuredForReview('record', RECORD)).token, startRecord.token, 'nothing persisted: record token unchanged');
Object.assign(report, { commitsSuppressed, persisted: false,
  notVerified: ['developer-approved application through the installed review UI', 'App Designer reopen after a returned MAXPNLFLDID'] });
writeFileSync('tools/lab/results/structural-cycle-native.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(0);
