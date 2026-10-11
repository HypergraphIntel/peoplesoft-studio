/*
 * Replays App Designer's captured App Engine saves through the writer on a
 * live database and compares, row for row, what each wrote
 * (docs/APP_ENGINE.md). For each capture of ZZ_AE_LAB01:
 *
 *   1. ZZ_AE_W01 is set to the program as it was before App Designer's save
 *      (a writer save of that document, its SQL definitions' ENABLEEFFDT
 *      then set as stored there -- not compared);
 *   2. the same edit (src/test/aeCaptureOps.ts) is saved through
 *      DatabaseProvider.saveAppEngineDocument, bracketed by ae-capture.mts
 *      (case w<case>);
 *   3. the writer's delta is compared with App Designer's: every inserted,
 *      deleted and updated row of the program, its SQL and PeopleCode, its
 *      tombstones, and the counters' moves -- the program name mapped,
 *      VERSION / LASTUPDDTTM / LASTUPDOPRID / LICENSE_CODE aside.
 *
 * WRITES. HRDMO only; ZZ_AE_W01 only.
 *
 *   npx tsx tools/lab/ae-replay.mts [case ...]      (default: every case with a capture)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { documentFromRows } from '../../src/model/aeDocument';
import { renamedDocument } from '../../src/providers/appEngineWriter';
import { CAPTURE_OPS } from '../../src/test/aeCaptureOps';
import { capturedProgram, captureExists, LAB, RESULTS } from '../../src/test/aeCaptures';

const W = 'ZZ_AE_W01';
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const cases = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CAPTURE_OPS).filter(captureExists).sort();

const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

const IGNORE = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID', 'LICENSE_CODE']);
type Delta = Record<string, { inserted: Record<string, unknown>[]; deleted: Record<string, unknown>[]; updated: { key: Record<string, unknown>; changes: Record<string, { before: unknown; after: unknown }> }[] }>;
function summarize(caseName: string, program: string): Record<string, string[]> {
  const file = JSON.parse(readFileSync(join(RESULTS, caseName, 'delta.json'), 'utf8'));
  const d = file.watch as Delta;
  // A full snapshot keeps tables outside its watch set in the sweep (by ROWID): PSPCMPROGDEL there.
  for (const t of ['PSPCMPROGDEL']) {
    const o = file.otherTables?.[t];
    if (o && !d[t]) d[t] = { inserted: o.inserted ?? [], deleted: o.deleted ?? [], updated: [] };
  }
  const mine = (r: Record<string, unknown>) => ('AE_APPLID' in r ? r.AE_APPLID === program : 'SQLID' in r ? String(r.SQLID).startsWith(program.padEnd(12)) : 'OBJECTVALUE1' in r ? r.OBJECTVALUE1 === program : true);
  const name = (v: unknown) => (v === null || v === undefined ? null : String(v).split(program.padEnd(12)).join('<P12>').split(program).join('<P>'));
  const norm = (r: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(r).filter((k) => !IGNORE.has(k)).sort().map((k) => [k, name(r[k])])));
  const out: Record<string, string[]> = {};
  for (const [t, v] of Object.entries(d)) {
    if (t === 'PSVERSION' || t === 'PSLOCK') {
      const moves = v.updated.filter((u) => u.changes.VERSION).map((u) => `${String(u.key.OBJECTTYPENAME).trim()}+${Number(u.changes.VERSION.after) - Number(u.changes.VERSION.before)}`).sort();
      if (moves.length) out[t] = moves;
      continue;
    }
    const rows = [
      ...v.inserted.filter(mine).map((r) => `+${norm(r)}`),
      ...v.deleted.filter(mine).map((r) => `-${norm(r)}`),
      ...v.updated.filter((u) => mine(u.key)).map((u) => {
        const ch = Object.entries(u.changes).filter(([k]) => !IGNORE.has(k));
        // PSSQLHASH was first captured keyed by SQLID, SQLTYPE alone.
        const key = t === 'PSSQLHASH' ? { SQLID: u.key.SQLID, SQLTYPE: u.key.SQLTYPE } : u.key;
        return ch.length ? `~${norm(key)} ${JSON.stringify(Object.fromEntries(ch.map(([k, x]) => [k, [name(x.before), name(x.after)]])))}` : '';
      }).filter(Boolean)
    ].sort();
    if (rows.length) out[t] = rows;
  }
  return out;
}

const capture = (phase: 'before' | 'after', caseName: string) =>
  execFileSync('npx', ['tsx', 'tools/lab/ae-capture.mts', phase, caseName, W], { stdio: ['ignore', 'pipe', 'ignore'] });

const results: Record<string, string> = {};
try {
  for (const c of cases) {
    const edit = CAPTURE_OPS[c];
    const before = capturedProgram(c, 'before', LAB);
    if (!edit || !before) { results[c] = 'skipped (no edit or no before state)'; continue; }
    // 1. reset
    const target = renamedDocument(documentFromRows(before.rows, before.peopleCode), LAB, W);
    delete target.copiedFrom;
    const opened = await p.readAppEngineDocument(W);
    await p.saveAppEngineDocument({ doc: target, openedToken: opened?.token ?? 'absent', operatorId });
    for (const d of before.sqlDefn) {
      await raw.execute(`UPDATE PSSQLDEFN SET ENABLEEFFDT = :e WHERE SQLID = :id AND SQLTYPE = :t`,
        { e: d.ENABLEEFFDT, id: String(d.SQLID).replace(LAB.padEnd(12), W.padEnd(12)), t: d.SQLTYPE });
    }
    // Tombstones as they were before App Designer's save.
    const W12 = W.padEnd(12);
    await raw.execute(`DELETE FROM PSAESECTDEL WHERE AE_APPLID = :a`, { a: W });
    await raw.execute(`DELETE FROM PSSQLDEL WHERE SUBSTR(SQLID, 1, 12) = :p`, { p: W12 });
    await raw.execute(`DELETE FROM PSPCMPROGDEL WHERE OBJECTID1 = 66 AND OBJECTVALUE1 = :a`, { a: W });
    for (const t of before.sectDel) await raw.execute(`INSERT INTO PSAESECTDEL (AE_APPLID, AE_SECTION, VERSION) VALUES (:a, :s, :v)`, { a: W, s: t.AE_SECTION, v: Number(t.VERSION) });
    for (const t of before.sqlDel) await raw.execute(`INSERT INTO PSSQLDEL (SQLID, SQLTYPE, VERSION) VALUES (:i, :t, :v)`, { i: String(t.SQLID).replace(LAB.padEnd(12), W12), t: t.SQLTYPE, v: Number(t.VERSION) });
    for (const t of before.pcDel) {
      await raw.execute(`INSERT INTO PSPCMPROGDEL (${[1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n}, OBJECTVALUE${n}`).join(', ')}, VERSION)
        VALUES (${[1, 2, 3, 4, 5, 6, 7].map((n) => `:i${n}, :v${n}`).join(', ')}, :ver)`,
        { ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((n) => [[`i${n}`, Number(t[`OBJECTID${n}`])], [`v${n}`, n === 1 ? W : t[`OBJECTVALUE${n}`]]])), ver: Number(t.VERSION) });
    }
    const asOf = before.rows.program.ASOF_DT;
    await raw.execute(`UPDATE PSAEAPPLDEFN SET ASOF_DT = ${asOf ? `TO_DATE(:d, 'YYYY-MM-DD')` : 'NULL'} WHERE AE_APPLID = :a`,
      asOf ? { d: String(asOf).slice(0, 10), a: W } : { a: W });
    await raw.commit();
    // 2. the edit
    const now = (await p.readAppEngineDocument(W))!;
    const doc = edit(now.doc);
    capture('before', `w${c}`);
    await p.saveAppEngineDocument({ doc, openedToken: now.token, operatorId });
    capture('after', `w${c}`);
    // 3. compare
    const ad = summarize(c, LAB);
    const mine = summarize(`w${c}`, W);
    const diffs = [...new Set([...Object.keys(ad), ...Object.keys(mine)])].sort()
      .filter((t) => JSON.stringify(ad[t] ?? []) !== JSON.stringify(mine[t] ?? []))
      .map((t) => `${t}\n    App Designer: ${JSON.stringify(ad[t] ?? [])}\n    writer:       ${JSON.stringify(mine[t] ?? [])}`);
    results[c] = diffs.length ? `DIFFERENT\n  ${diffs.join('\n  ')}` : 'IDENTICAL';
    console.log(`${c}: ${results[c]}`);
  }
} catch (e) {
  console.error(e);
} finally {
  await p.dispose();
  await raw.close();
}
const identical = Object.values(results).filter((r) => r === 'IDENTICAL').length;
console.log(`\n${identical} of ${Object.keys(results).length} identical`);
