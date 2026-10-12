/*
 * Calibrates ciFromComponent (src/model/ciDocument.ts) against HRDMO's
 * Component Interfaces: each one defaulted again from its component and its
 * stored items compared, one by one, to what the defaulting gives for the
 * same record field in the same scroll -- SEQUENCE_NBR_6, name, scroll,
 * Read Only. Delivered interfaces were edited after App Designer defaulted
 * them (items deleted, renamed) and their components changed since, so a
 * stored item missing from the defaulting is counted, not failed. READ ONLY.
 *
 *   npx tsx tools/lab/ci-corpus.mts [CI ...] [--verbose]
 */
import { DatabaseProvider } from '../../src/providers/database';
import { ciFromComponent, type CiItem } from '../../src/model/ciDocument';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.filter((a) => !a.startsWith('--'));
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

type Row = Record<string, unknown>;
const rows = async (sql: string, b: Record<string, unknown> = {}) => (p as unknown as { withConnection<T>(f: (c: unknown) => Promise<T>): Promise<T>; uiRows(c: unknown, s: string, b: Record<string, unknown>): Promise<Row[]> })
  .withConnection((c) => (p as unknown as { uiRows(c: unknown, s: string, b: Record<string, unknown>): Promise<Row[]> }).uiRows(c, sql, b));
const t = (v: unknown) => String(v ?? '').trim();

const defs = (await rows(`SELECT BCNAME, BCPGNAME, MARKET, BCSTDMETHODS FROM PSBCDEFN ORDER BY BCNAME`))
  .filter((d) => !only.length || only.includes(t(d.BCNAME)));
const allItems = await rows(`SELECT * FROM PSBCITEM ${only.length ? `WHERE BCNAME IN (${only.map((o) => `'${o}'`).join(',')})` : ''}`);
const byCi = new Map<string, Row[]>();
for (const r of allItems) { const k = t(r.BCNAME); if (!byCi.has(k)) byCi.set(k, []); byCi.get(k)!.push(r); }

const tally: Record<string, number> = {};
const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
const examples: Record<string, string[]> = {};
const note = (k: string, s: string) => { bump(k); const e = (examples[k] ??= []); if (e.length < (k === 'first seq divergence' ? 60 : 12)) e.push(s); };
let exactCis = 0, checked = 0;

for (const d of defs) {
  const ci = t(d.BCNAME);
  let gen: CiItem[];
  try {
    // SYNCIDs are checked where App Designer gave them all at once (a lab interface just created): from the smallest stored.
    const firstSync = Math.min(...(byCi.get(ci) ?? []).map((r) => Number(r.SYNCID)));
    gen = ciFromComponent(ci, await p.readCiSource(t(d.BCPGNAME), t(d.MARKET)), firstSync).items;
  } catch (e) { note('component unreadable', `${ci}: ${e}`); continue; }
  checked++;
  const stored = byCi.get(ci) ?? [];
  const k = (type: unknown, rec: unknown, fld: unknown, sc: unknown) => `${type}|${t(rec)}|${t(fld)}|${t(sc)}`;
  const g = new Map(gen.map((i) => [k(i.type, i.record, i.field, i.scrollName), i]));
  let same = stored.length === gen.length;
  const pairs: Array<{ stored: number; gen: number; where: string }> = [];
  for (const s of stored) {
    const i = g.get(k(s.BCTYPE, s.RECNAME, s.FIELDNAME, s.BCSCROLLNAME));
    const where = `${ci} ${s.BCTYPE} ${t(s.BCITEMPARENT)}.${t(s.BCITEMNAME)} (${t(s.RECNAME)}.${t(s.FIELDNAME)} ${t(s.BCSCROLLNAME)})`;
    if (!i) { same = false; note(`stored item not defaulted (type ${s.BCTYPE})`, where); continue; }
    bump('matched');
    if (i.seq !== Number(s.SEQUENCE_NBR_6)) { same = false; bump('seq'); }
    pairs.push({ stored: Number(s.SEQUENCE_NBR_6), gen: i.seq, where });
    if (i.name !== t(s.BCITEMNAME)) { same = false; note('name', `${where}: defaulted ${i.name}`); }
    if (i.parent !== t(s.BCITEMPARENT)) { same = false; note('parent', `${where}: defaulted ${i.parent}`); }
    if (ci.startsWith('ZZ_') && i.syncId !== Number(s.SYNCID)) { same = false; note('syncid', `${where}: stored ${s.SYNCID}, defaulted ${i.syncId}`); }
    if ((i.readOnly ? 2 : 1) !== Number(s.BCACCESS)) { same = false; note(`access stored ${s.BCACCESS}`, where); }
    if (i.level !== Number(s.BCSCROLL) || i.scrollNum !== Number(s.BCSCROLLNUM)) { same = false; note('scroll', `${where}: defaulted ${i.level}/${i.scrollNum}`); }
  }
  // The first place the stored numbering and the defaulting's part ways (later items only follow it).
  pairs.sort((x, y) => x.stored - y.stored);
  for (let n = 0; n < pairs.length; n++) {
    if (pairs[n].gen === pairs[n].stored) continue;
    const prev = pairs[n - 1];
    note('first seq divergence', `${pairs[n].where}: stored ${pairs[n].stored}, defaulted ${pairs[n].gen}${prev ? ` (after ${prev.where.split(' ').slice(2, 3)} ${prev.stored}/${prev.gen})` : ''}`);
    if (verbose) console.log('DIVERGE', pairs[n].where, pairs[n].stored, pairs[n].gen);
    break;
  }
  if (same) exactCis++;
  if (verbose) for (const i of gen) console.log(`  gen ${i.seq} ${i.type} ${i.parent}.${i.name} ${i.record}.${i.field} ${i.scrollName} ${i.readOnly ? 'RO' : ''}`);
}
await p.dispose();
console.log(`${checked} interfaces defaulted; ${exactCis} exactly as stored.`);
for (const [key, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(6)}  ${key}`);
  for (const e of examples[key] ?? []) console.log(`          ${e}`);
}
