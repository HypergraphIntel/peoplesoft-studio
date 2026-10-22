/*
 * Record field-structure review, native rollback previews only (V15-1). Every saveRecord call is dryRun with full
 * six-table checkpoints: the writer executes and verifies its DML, captures the after-image, then rolls back.
 *
 * On HRDMO: ZZ_RPT_LINE (Derived/Work) and ZZ_FL_REC_A (SQL Table, key index) take an inserted field, a move, a
 * removal and a Use change; each time the review's typed edit rebuilt from the two checkpoints (recordStructureRequest)
 * reproduces the after-image exactly under the snapshot token guard. A field with Record PeopleCode
 * (ZZ_PCODE_LAB_R2) and one on pages (ZZ_PCODE_LAB_R7) are refused for reviewed removal. Tokens are checked unchanged.
 *
 *   npx tsx tools/lab/record-structure-native-preview.mts
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DatabaseProvider } from '../../src/providers/database';
import { DefinitionType } from '../../src/model/definitions';
import { applyRecordOperations, type RecordOperation } from '../../src/model/recordOperations';
import { recordStructureRequest } from '../../src/changeReview/structuredHeaders';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

async function edit(record: string, operations: RecordOperation[]) {
  const layout = (await p.readRecordLayout({ type: DefinitionType.Record, parts: [record] }))!;
  return applyRecordOperations({ recname: layout.name, recordType: layout.recordType, openedVersion: layout.version,
    fields: layout.fields.map((f) => ({ name: f.name, useEdit: f.useEdit, useEdit2: f.useEdit2 ?? 0, isNew: false, ...(f.isSubrecord ? { isSubrecord: true } : {}) })) },
    layout.recordType, operations);
}
async function preview(record: string, label: string, operations: RecordOperation[]) {
  const start = await p.readStructuredForReview('record', record);
  const r = await p.saveRecord({ edit: await edit(record, operations), operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: start.token });
  const { before, after } = r.snapshots!;
  assert.equal(before.hash, start.hash);
  const request = recordStructureRequest(record, before.value, after.value, before.version, operatorId);
  const replay = await p.saveRecord({ ...request, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token });
  assert.equal(replay.snapshots!.after.hash, after.hash, `${record} ${label}: the rebuilt typed edit reproduces the after-image`);
  const names = (s: typeof before) => [...s.value.tables.PSRECFIELD].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM)).map((x) => String(x.FIELDNAME).trim());
  return { record, case: label, fieldsBefore: names(before), fieldsAfter: names(after),
    indexKeysAfter: after.value.tables.PSKEYDEFN.map((k) => `${String(k.INDEXID).trim()}:${String(k.FIELDNAME).trim()}`).sort(), reproduced: true };
}

const tokens = new Map<string, string>();
for (const r of ['ZZ_RPT_LINE', 'ZZ_FL_REC_A', 'ZZ_PCODE_LAB_R2', 'ZZ_PCODE_LAB_R7']) tokens.set(r, (await p.readStructuredForReview('record', r)).token);
const cases: unknown[] = [];
const line = (await p.readRecordLayout({ type: DefinitionType.Record, parts: ['ZZ_RPT_LINE'] }))!.fields.map((f) => f.name);
const flat = (await p.readRecordLayout({ type: DefinitionType.Record, parts: ['ZZ_FL_REC_A'] }))!.fields.map((f) => f.name);
cases.push(await preview('ZZ_RPT_LINE', 'insert DESCR first', [{ op: 'insert_field', field: 'DESCR' }, { op: 'move_field', field: 'DESCR' }]));
cases.push(await preview('ZZ_RPT_LINE', `move ${line[0]} last`, [{ op: 'move_field', field: line[0], after: line[line.length - 1] }]));
cases.push(await preview('ZZ_RPT_LINE', `remove ${line[line.length - 1]}`, [{ op: 'remove_field', field: line[line.length - 1] }]));
cases.push(await preview('ZZ_FL_REC_A', 'insert DESCR', [{ op: 'insert_field', field: 'DESCR' }]));
cases.push(await preview('ZZ_FL_REC_A', `remove ${flat[flat.length - 1]}`, [{ op: 'remove_field', field: flat[flat.length - 1] }]));
cases.push(await preview('ZZ_FL_REC_A', `${flat[flat.length - 1]} becomes a list box item`, [{ op: 'set_use', field: flat[flat.length - 1], listBox: true }]));

// Reviewed removal refuses a field still used elsewhere.
for (const [record, what] of [['ZZ_PCODE_LAB_R2', /Record Field PeopleCode/], ['ZZ_PCODE_LAB_R7', /page controls/]] as const) {
  const [field] = (await p.readRecordLayout({ type: DefinitionType.Record, parts: [record] }))!.fields.map((f) => f.name);
  const s = await p.readStructuredForReview('record', record);
  const used = record === 'ZZ_PCODE_LAB_R2'
    ? String((await p.withConnection(async (c) => (await c.execute<{ F: string }>(`SELECT OBJECTVALUE2 AS F FROM PSPCMPROG WHERE OBJECTID1 = 1 AND OBJECTVALUE1 = :r AND OBJECTID2 = 2`, { r: record })).rows))?.[0]?.F ?? field).trim()
    : String((await p.withConnection(async (c) => (await c.execute<{ F: string }>(`SELECT FIELDNAME AS F FROM PSPNLFIELD WHERE RECNAME = :r AND FIELDNAME <> ' '`, { r: record })).rows))?.[0]?.F ?? field).trim();
  await assert.rejects(p.saveRecord({ edit: await edit(record, [{ op: 'remove_field', field: used }]), operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: s.token }), what);
  cases.push({ record, case: `remove ${used}`, refused: String(what) });
}
for (const [r, token] of tokens) assert.equal((await p.readStructuredForReview('record', r)).token, token, `${r}: every preview rolled back`);
const report = { checkedAt: new Date().toISOString(), connection: 'HRDMO', mode: 'native rollback previews only; no commit, stage, approval or apply',
  cases, nativeScopedContentAndTokensUnchanged: true,
  notVerified: ['developer-approved apply/inverse/redo in the installed build', 'App Designer reopen of reviewed record structure', 'physical DDL (out of scope)'] };
writeFileSync('tools/lab/results/record-structure-native-preview.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(0);
