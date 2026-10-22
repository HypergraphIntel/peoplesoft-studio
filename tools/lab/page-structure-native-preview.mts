/*
 * Structural Page review, native rollback previews only (V15-1). Every savePage call is dryRun: the
 * writer executes and verifies its DML inside the transaction, captures the full scoped native
 * snapshots, then rolls back. Nothing is committed; the page's token is checked unchanged at the end.
 *
 * On HRDMO ZZ_JOB_DATA1 (a JOB_DATA1 copy with 13 Related Fields):
 *   - delete control 123: the writer's after-image of PSPNLFIELD equals App Designer's own delete of
 *     the same control on its Save As copy ZZ_PG_STRUCT1 (capture ps01), every column but PNLNAME;
 *   - deleting a Related Control Field (7) is refused as App Designer's (15,22) check fails (ps02);
 *   - an added Static Text, a tab order move and an Edit Box rebind (set_binding);
 *   - for each, the review's typed request rebuilt from the snapshots (requestForPageSnapshot)
 *     reproduces the after-image exactly under the snapshot token guard.
 *
 *   npx tsx tools/lab/page-structure-native-preview.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { DefinitionType } from '../../src/model/definitions';
import { applyPageOperations, resolvePageBindings, type PageOperation } from '../../src/model/pageOperations';
import { requestForPageSnapshot, type PageRow } from '../../src/providers/pageSnapshot';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED', PAGE = 'ZZ_JOB_DATA1';
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const key = { type: DefinitionType.Page, parts: [PAGE] };
const start = await p.readPageForReview(PAGE);

async function preview(label: string, operations: PageOperation[]) {
  const { layout } = await p.readPageLayout(key);
  const edited = applyPageOperations(layout, operations, await resolvePageBindings(operations, (r, f) => p.pageFieldBinding(r, f)));
  const r = await p.savePage({ pnlName: PAGE, openedVersion: layout.version, operatorId, controls: edited.controls, ...(edited.order ? { order: edited.order } : {}),
    properties: { description: edited.properties.description, comments: edited.properties.comments }, dryRun: true, captureSnapshots: true });
  const { before, after } = r.snapshots!;
  // The review's validation: the typed request rebuilt from the two snapshots reproduces the whole after-image.
  const request = requestForPageSnapshot(PAGE, before.value, after.value, before.version, operatorId);
  const replay = await p.savePage({ ...request, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token });
  assert.equal(replay.snapshots!.after.hash, after.hash, `${label}: rebuilt request reproduces the after-image`);
  const ids = (rows: PageRow[]) => new Set(rows.map((x) => x.PNLFLDID));
  const was = ids(before.value.tables.PSPNLFIELD), now = ids(after.value.tables.PSPNLFIELD);
  return { label, before, after, inserted: [...now].filter((id) => !was.has(id)), deleted: [...was].filter((id) => !now.has(id)),
    maxPnlFldId: [before.value.tables.PSPNLDEFN[0].MAXPNLFLDID, after.value.tables.PSPNLDEFN[0].MAXPNLFLDID], afterHash: after.hash, reproduced: true };
}

const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), connection: 'HRDMO', page: PAGE,
  mode: 'native rollback previews only; no commit, stage, approval or apply', baselineVersion: start.version, baselineToken: start.token };
const cases: Record<string, unknown>[] = [];

// 1. App Designer's delete of control 123 (ps01), on the same rows.
const del = await preview('delete 123', [{ op: 'delete', id: 123 }]);
const ad = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results/ps01-delete-before-related/after.json'), 'utf8')).watch.PSPNLFIELD;
const adRows = new Map((ad.rows as Array<Array<string | null>>).filter((r) => r[0] === 'ZZ_PG_STRUCT1')
  .map((r) => Object.fromEntries(ad.columns.map((c: { name: string }, i: number) => [c.name, r[i]]))).map((r: Record<string, string | null>) => [Number(r.PNLFLDID), r]));
const differences: string[] = [];
for (const row of del.after.value.tables.PSPNLFIELD) {
  const a = adRows.get(row.PNLFLDID as number);
  if (!a) { differences.push(`${row.PNLFLDID}: not in App Designer's after-image`); continue; }
  for (const [col, v] of Object.entries(row)) if (col !== 'PNLNAME' && col in a && String(v ?? '').trim() !== String(a[col] ?? '').trim()) differences.push(`${row.PNLFLDID}.${col}: ${v} vs ${a[col]}`);
}
assert.equal(del.after.value.tables.PSPNLFIELD.length, adRows.size);
assert.deepEqual(differences, [], 'the writer deletes exactly as App Designer did (ps01)');
cases.push({ case: del.label, inserted: del.inserted, deleted: del.deleted, maxPnlFldId: del.maxPnlFldId, reproduced: true,
  appDesignerPs01: `all ${adRows.size} PSPNLFIELD rows equal App Designer's after-image (every column but PNLNAME)` });

// 2. Deleting a Related Control Field leaves its Related Field invalid: App Designer warns (15,22) (ps02); the writer refuses.
const { layout } = await p.readPageLayout(key);
await assert.rejects(p.savePage({ pnlName: PAGE, openedVersion: layout.version, operatorId, controls: applyPageOperations(layout, [{ op: 'delete', id: 7 }]).controls,
  dryRun: true, captureSnapshots: true }), /\(15,22\)/);
cases.push({ case: 'delete Related Control Field 7', refused: '(15,22) More than one data record in scroll, as App Designer (ps02)' });

// 3. An added Static Text near the top, a tab order move and an Edit Box rebind.
for (const [label, ops] of [
  ['add static text at (28,64)', [{ op: 'add', kind: 'staticText', left: 28, top: 64, label: 'Structural preview' }]],
  ['move 123 to the end of the tab order', [{ op: 'set_order', order: [...layout.controls.map((c) => c.pnlFldId).filter((id) => id !== 123), 123] }]],
  ['rebind Edit Box 2 (JOB.EFFSEQ) to JOB.EMPL_RCD', [{ op: 'set_binding', id: 2, record: 'JOB', field: 'EMPL_RCD' }]]
] as Array<[string, PageOperation[]]>) {
  const r = await preview(label, ops);
  const assoc = r.after.value.tables.PSPNLFIELD.filter((x) => Number(x.FIELDUSE) & 0x10).map((x) => {
    const target = r.after.value.tables.PSPNLFIELD.find((t) => t.FIELDNUM === Number(x.ASSOCFIELDNUM) + 1);
    return [x.PNLFLDID, target?.PNLFLDID, Number(target?.FIELDUSE ?? 0) & 0x8 ? 'control field' : 'NOT A CONTROL FIELD'];
  });
  const beforeAssoc = r.before.value.tables.PSPNLFIELD.filter((x) => Number(x.FIELDUSE) & 0x10).map((x) => [x.PNLFLDID, r.before.value.tables.PSPNLFIELD.find((t) => t.FIELDNUM === Number(x.ASSOCFIELDNUM) + 1)?.PNLFLDID]);
  const byId = (xs: unknown[][]) => xs.map(([id, t]) => [Number(id), Number(t)]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(byId(assoc), byId(beforeAssoc), `${label}: every Related Field keeps its Related Control Field`);
  assert.ok(assoc.every((x) => x[2] === 'control field'), `${label}: every reference names a Display Control Field`);
  cases.push({ case: label, inserted: r.inserted, deleted: r.deleted, maxPnlFldId: r.maxPnlFldId, reproduced: true, relatedFieldsKeptTargets: assoc.length });
}

const end = await p.readPageForReview(PAGE);
assert.equal(end.token, start.token, 'every preview rolled back: the page is unchanged');
Object.assign(report, { cases, endToken: end.token, nativeScopedContentAndTokenUnchanged: true,
  notVerified: ['developer-approved apply/inverse/redo in the installed build', 'App Designer reopen of a page whose MAXPNLFLDID was returned'] });
writeFileSync('tools/lab/results/page-structure-native-preview.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
await p.disconnect?.();
process.exit(0);
