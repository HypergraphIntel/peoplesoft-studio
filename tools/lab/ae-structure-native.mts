/*
 * App Engine structural Change Review on HRDMO (V15-1). Nothing is committed.
 *
 * 1. Reconstruction fidelity, rollback previews: for every ZZ_ App Engine program, the document rebuilt from its own
 *    twenty-table checkpoint (aeDocumentFromSnapshot) saved by the shared writer changes nothing -- the after-image
 *    equals the checkpoint exactly.
 * 2. One native transaction, rolled back at the end (commit suppressed), on ZZ_AE_LAB01: add a step with a SQL action
 *    and rename another step (moving its SQL / PeopleCode, tombstoning the old keys); the checkpoint inverse reaches
 *    the checkpoint plus App Designer's deletion records for the removed keys only (aeTombstoneProjection); redo
 *    restores the reviewed after-image exactly. The token is read on another connection afterwards.
 *
 *   npx tsx tools/lab/ae-structure-native.mts
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DatabaseProvider } from '../../src/providers/database';
import { applyOperation, type Operation } from '../../src/model/aeOperations';
import { saveAppEngine, readStoredAppEngine, appEngineToken } from '../../src/providers/appEngineWriter';
import { readStructuredSnapshot, type StructuredSnapshot } from '../../src/providers/structuredSnapshot';
import { aeDocumentFromSnapshot, aeTombstoneProjection, AE_TOMBSTONE_TABLES } from '../../src/changeReview/aeStructure';
import { canonical, type Json } from '../../src/changeReview/model';
import type { DbConnection } from '../../src/db/connection';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED', PROGRAM = 'ZZ_AE_LAB01';
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const provider = p as unknown as { types: never; withConnection<T>(fn: (c: DbConnection) => Promise<T>): Promise<T> };
const types = provider.types;
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), connection: 'HRDMO', mode: 'rollback previews and one rolled-back transaction; nothing persisted' };

// 1. Every ZZ_ program round-trips through its checkpoint.
const programs = await provider.withConnection(async (c) => ((await c.execute<{ A: string }>(`SELECT AE_APPLID AS A FROM PSAEAPPLDEFN WHERE AE_APPLID LIKE 'ZZ%' ORDER BY 1`)).rows ?? []).map((r) => String(r.A).trim()));
const roundTrip: Array<{ program: string; unchanged: boolean; detail?: string }> = [];
for (const name of programs) {
  try {
    const start = await p.readStructuredForReview('ae', name), live = (await p.readAppEngineDocument(name))!;
    const save = async (doc: typeof live.doc) => (await p.saveAppEngineDocument({ doc, openedToken: live.token, operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: start.token })).snapshots!.after.hash;
    // The rebuilt document must save exactly as the program's own document does (both include App Designer's
    // first-save normalization, ASOF_DT NULL -> 1900-01-01 [ap01], on programs created without it).
    const [ownHash, rebuiltHash] = [await save(live.doc), await save(aeDocumentFromSnapshot(name, start.value))];
    roundTrip.push({ program: name, unchanged: rebuiltHash === ownHash, ...(ownHash !== start.hash ? { detail: 'own save normalizes (ASOF_DT)' } : {}) });
  } catch (e) { roundTrip.push({ program: name, unchanged: false, detail: 'not saveable: ' + (e instanceof Error ? e.message.split(':')[0] : String(e)) }); }
}
report.reconstruction = { programs: roundTrip.length, sameAsOwnDocument: roundTrip.filter((r) => r.unchanged).length, notes: roundTrip.filter((r) => !r.unchanged || r.detail) };

// 2. Apply / inverse / redo in one rolled-back transaction.
const startToken = (await p.readStructuredForReview('ae', PROGRAM)).token;
let commitsSuppressed = 0;
await provider.withConnection(async (raw) => {
  const c: DbConnection = { catalog: raw.catalog, execute: (sql, binds, options) => raw.execute(sql, binds, options),
    commit: async () => { commitsSuppressed++; }, rollback: () => raw.rollback(), close: async () => {} };
  const save = async (doc: ReturnType<typeof aeDocumentFromSnapshot>) => {
    const stored = await readStoredAppEngine(c, types, PROGRAM, false);
    await saveAppEngine(c, types, { doc, operatorId, openedToken: appEngineToken(stored) });
    return readStructuredSnapshot(c, types, 'ae', PROGRAM);
  };
  try {
    const s0 = await readStructuredSnapshot(c, types, 'ae', PROGRAM);
    const doc0 = aeDocumentFromSnapshot(PROGRAM, s0.value);
    const main = doc0.sections.find((s) => s.name === 'MAIN')!.variants[0];
    const [first, second] = main.steps.map((s) => s.name);
    let doc = doc0;
    for (const o of [
      { op: 'add_step', section: 'MAIN', after: first, name: 'ZZCYCLE', actions: [{ type: 'SQL', sql: 'UPDATE PS_INSTALLATION SET LAST_UPDATE_DTTM = LAST_UPDATE_DTTM WHERE 1 = 0' }] },
      { op: 'add_step', section: 'MAIN', after: 'ZZCYCLE', name: 'ZZCYCPC', actions: [{ type: 'PeopleCode', peopleCode: 'Local number &n = 1;\n' }] },
      { op: 'rename_step', section: 'MAIN', step: second, to: 'ZZRENAME' }
    ] as Operation[]) doc = applyOperation(doc, o);
    const s1 = await save(doc);
    const keys = (s: { value: StructuredSnapshot }, t: string) => s.value.tables[t].length;
    // Inverse: the document the checkpoint stores, saved against the forward state.
    const s2 = await save(aeDocumentFromSnapshot(PROGRAM, s0.value));
    const refusal = aeTombstoneProjection(s0.value, s1.value, s2.value);
    assert.equal(refusal, undefined, refusal);
    const added = Object.fromEntries(AE_TOMBSTONE_TABLES.map((t) => [t, keys(s2, t) - keys(s0, t)]));
    const tomb = (s: { value: StructuredSnapshot }) => Object.fromEntries(AE_TOMBSTONE_TABLES.map((t) => [t, s.value.tables[t].map((r) => Object.values(r).map((v) => String(v).trim()).join('|'))]));
    report.tombstones = { s0: tomb(s0), s1: tomb(s1), s2: tomb(s2) };
    // Redo: the reviewed after-image's document against the inverse's result.
    const s3 = await save(aeDocumentFromSnapshot(PROGRAM, s1.value));
    assert.equal(s3.hash, s1.hash, 'redo restores the reviewed after-image exactly');
    const nonTombstone = (s: { value: StructuredSnapshot }) => canonical(Object.fromEntries(Object.entries(s.value.tables).filter(([t]) => !(AE_TOMBSTONE_TABLES as readonly string[]).includes(t))) as Json);
    assert.equal(nonTombstone(s2), nonTombstone(s0), 'every non-tombstone table returns to the checkpoint');
    report.cycle = { program: PROGRAM, forward: ['add step ZZCYCLE (SQL) after ' + first, 'add step ZZCYCPC (PeopleCode)', `rename ${second} -> ZZRENAME`],
      inverse: 'checkpoint exactly, plus App Designer deletion records for the removed keys', tombstonesAddedByInverse: added,
      redoEqualsAfterImage: true, steps: [s0, s1, s2, s3].map((s) => s.value.tables.PSAESTEPDEFN.map((r) => String(r.AE_STEP).trim()).sort()) };
  } finally { await raw.rollback(); }
});
assert.equal((await p.readStructuredForReview('ae', PROGRAM)).token, startToken, 'nothing persisted');
Object.assign(report, { commitsSuppressed, persisted: false, notVerified: ['developer-approved application through the installed review UI', 'App Designer reopen'] });
writeFileSync('tools/lab/results/ae-structure-native.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(0);
