/*
 * Replays App Designer's captured menu saves through the writer on a live
 * database and compares what each wrote (docs/MENUS.md). For each capture:
 *
 *   1. every lab menu of the capture is set, as a scratch copy
 *      (ZZ_PCODE_LAB_MENU -> ZZ_MENU_W01, ...; group "Lab Group" ->
 *      "W Lab Group"), to its rows before App Designer's save -- PeopleCode
 *      and tombstones included;
 *   2. the same edit (the menu after the save, src/test/menuCaptures.ts) is
 *      saved through DatabaseProvider.saveMenuDocument;
 *   3. the rows the writer changed are compared with the rows App Designer
 *      changed -- names mapped, VERSION / LASTUPDDTTM / LASTUPDOPRID aside --
 *      and the counters' moves.
 *
 * WRITES. HRDMO only; ZZ_MENU_W* only.
 *
 *   npx tsx tools/lab/menu-replay.mts [case ...]
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import { editedDocument, menuCaptureExists, RESULTS, rowsOf } from '../../src/test/menuCaptures';
import type { MenuDocument } from '../../src/model/menuDocument';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_MENU_W');

const MAP: Record<string, string> = {
  ZZ_PCODE_LAB_MENU: 'ZZ_MENU_W01', ZZ_PCODE_LAB_MEN2: 'ZZ_MENU_W02', ZZ_PCODE_LAB_MEN3: 'ZZ_MENU_W03',
  ZZ_PCODE_LAB_POP: 'ZZ_MENU_WP1', ZZ_PCODE_LAB_PO2: 'ZZ_MENU_WP2', 'Lab Group': 'W Lab Group', 'Zz Pcode Lab Menu': 'Zz Menu W01'
};
const LAB_MENUS = ['ZZ_PCODE_LAB_MENU', 'ZZ_PCODE_LAB_MEN2', 'ZZ_PCODE_LAB_MEN3', 'ZZ_PCODE_LAB_POP', 'ZZ_PCODE_LAB_PO2'];
const map = (v: unknown) => (typeof v === 'string' && v in MAP ? MAP[v] : v);

interface Case { name: string; menu: string; hints?: { items?: Record<string, string>; bars?: Record<string, string> }; counters?: Record<string, number>;
  /** File > Rename (to) or File > Delete instead of a save of the menu after the capture. */
  rename?: string; remove?: boolean }
const MENU = 'ZZ_PCODE_LAB_MENU', MEN2 = 'ZZ_PCODE_LAB_MEN2', POP = 'ZZ_PCODE_LAB_POP', PO2 = 'ZZ_PCODE_LAB_PO2';
const ALL: Case[] = [
  ...['mn01-create', 'mn02-descr', 'mn03-comments', 'mn04-owner', 'mn05-label', 'mn06-group', 'mn07-menu-order', 'mn08-menu-sep', 'mn09-group-order',
    'mn10-group-sep', 'mn11-installed', 'mn20-group-order-sep', 'mn21-installed-on', 'mn22-installed-off'].map((name) => ({ name, menu: MENU })),
  ...['mn12-save-as', 'mn13-group-order-shared', 'mn14-group-sep-shared', 'mn15-installed-shared', 'mn19-recreate-deleted', 'mi01-add-item', 'mi02-item-label',
    'mi03-search-override', 'mi04-separator', 'mi05-pc-item', 'mi06-item-peoplecode', 'mi07-item-reorder', 'mi10-item-delete', 'mi11-separator-delete',
    'mi12-item-delete-cmp', 'mi13-second-bar', 'mi14-item-move-bar', 'mb01-add-bar', 'mb02-bar-label', 'mb03-baritem-pc', 'mb04-baritem-code',
    'mb06-bar-reorder', 'mb07-bar-delete'].map((name) => ({ name, menu: MEN2 })),
  { name: 'mi08-item-rename', menu: MEN2, hints: { items: { 'USE|ZZ_LAB_PCITM2': 'USE|ZZ_LAB_PCITEM' } } },
  { name: 'mi09-item-rename-full', menu: MEN2, hints: { items: { 'USE|ZZ_LAB_PCITEM': 'USE|ZZ_LAB_PCITM2' } } },
  { name: 'mb05-bar-rename-full', menu: MEN2, hints: { bars: { LAB_BAR2: 'LAB_BAR' } } },
  ...['mp01-popup-create', 'mp02-xfer-add', 'mp03-xfer-correction', 'mp04-xfer-upd-all', 'mp05-xfer-new-window', 'mp06-xfer-keysearch', 'mp07-xfer-portal',
    'mp08-xfer-restore', 'mp09-popup-pc-sep', 'mp10-popup-code', 'mp11-popup-label'].map((name) => ({ name, menu: POP })),
  { name: 'mp12-xfer-menu', menu: PO2 },
  // File > Rename and File > Delete, through renameMenuDefinition / deleteMenuDefinition.
  { name: 'mn16-menu-rename', menu: POP, rename: PO2 },
  { name: 'mn17-menu-rename-refs', menu: MEN2, rename: 'ZZ_PCODE_LAB_MEN3' },
  { name: 'mn18-menu-delete', menu: 'ZZ_PCODE_LAB_MEN3', remove: true }
];
const wanted = process.argv.slice(2);
const cases = ALL.filter((c) => menuCaptureExists(c.name) && (!wanted.length || wanted.includes(c.name)));

const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NUMBER];
oracledb.fetchAsBuffer = [oracledb.BLOB];
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

const MENU_TABLES = ['PSMENUDEFN', 'PSMENUITEM', 'PSXFERITEM', 'PSMENUDEFNLANG', 'PSMENUITEMLANG', 'PSMENUORIGIN', 'PSMENUDEL'];
const PC_TABLES = ['PSPCMPROG', 'PSPCMTXT', 'PSPCMNAME', 'PSPCMPROGDEL'];
const IGNORE = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const COUNTERS = ['MDM', 'PCM', 'CLM', 'PJM', 'SYS', 'ACM', 'TSM', 'TSTM'];
type Row = Record<string, unknown>;

/** The scratch menus' rows now, by table. */
async function scratch(): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  const q = async (sql: string) => ((await raw.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Row[];
  for (const t of MENU_TABLES) out[t] = await q(`SELECT * FROM ${t} WHERE MENUNAME LIKE 'ZZ\\_MENU\\_W%' ESCAPE '\\'`);
  for (const t of PC_TABLES) out[t] = await q(`SELECT * FROM ${t} WHERE OBJECTID1 = 3 AND OBJECTVALUE1 LIKE 'ZZ\\_MENU\\_W%' ESCAPE '\\'`);
  out.PSVERSION = await q(`SELECT OBJECTTYPENAME, VERSION FROM PSVERSION`);
  return out;
}

/** A capture side's lab rows, names mapped to the scratch copies. */
function labRows(caseName: string, phase: 'before' | 'after'): Record<string, Row[] | undefined> {
  const out: Record<string, Row[] | undefined> = {};
  for (const t of [...MENU_TABLES, ...PC_TABLES]) {
    const rows = rowsOf(caseName, phase, t);
    const watched = rows.length > 0 || hasTable(caseName, phase, t);
    out[t] = watched ? rows.filter((r) => LAB_MENUS.includes(String(r.MENUNAME ?? (r.OBJECTID1 === '3' ? r.OBJECTVALUE1 : ''))))
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, map(v)]))) : undefined;
  }
  out.PSVERSION = rowsOf(caseName, phase, 'PSVERSION');
  return out;
}
import { readFileSync } from 'node:fs';
function hasTable(caseName: string, phase: string, t: string): boolean {
  return t in JSON.parse(readFileSync(join(RESULTS, caseName, `${phase}.json`), 'utf8')).watch;
}

const norm = (r: Row) => JSON.stringify(Object.keys(r).filter((k) => !IGNORE.has(k)).sort().map((k) => {
  const v = r[k];
  return [k, v === null || v === undefined ? null : Buffer.isBuffer(v) ? v.toString('hex') : String(v).trim() === '' ? ' ' : String(v).trim()];
}));

function changes(before: Record<string, Row[] | undefined>, after: Record<string, Row[] | undefined>): Record<string, string[] | undefined> {
  const out: Record<string, string[] | undefined> = {};
  for (const t of [...MENU_TABLES, ...PC_TABLES]) {
    if (!before[t] || !after[t]) { out[t] = undefined; continue; }
    const b = before[t]!.map(norm), a = after[t]!.map(norm);
    const minus = [...b]; const plus: string[] = [];
    for (const x of a) { const i = minus.indexOf(x); if (i >= 0) minus.splice(i, 1); else plus.push(x); }
    const rows = [...minus.map((x) => `-${x}`), ...plus.map((x) => `+${x}`)].sort();
    if (rows.length) out[t] = rows;
  }
  const v = (rows: Row[] | undefined) => Object.fromEntries((rows ?? []).map((r) => [String(r.OBJECTTYPENAME).trim(), Number(r.VERSION)]));
  const vb = v(before.PSVERSION), va = v(after.PSVERSION);
  out.counters = COUNTERS.map((n) => `${n}+${(va[n] ?? 0) - (vb[n] ?? 0)}`).filter((x) => !x.endsWith('+0'));
  return out;
}

async function reset(caseName: string): Promise<void> {
  for (const t of MENU_TABLES) await raw.execute(`DELETE FROM ${t} WHERE MENUNAME LIKE 'ZZ\\_MENU\\_W%' ESCAPE '\\'`);
  for (const t of PC_TABLES) await raw.execute(`DELETE FROM ${t} WHERE OBJECTID1 = 3 AND OBJECTVALUE1 LIKE 'ZZ\\_MENU\\_W%' ESCAPE '\\'`);
  const before = labRows(caseName, 'before');
  for (const t of [...MENU_TABLES, ...PC_TABLES]) {
    for (const r of before[t] ?? []) {
      const cols = Object.keys(r).filter((k) => k !== 'LASTUPDDTTM');
      const binds: Row = {};
      const vals = cols.map((c, i) => {
        const v = r[c];
        if (c === 'PROGTXT') { binds[`b${i}`] = { val: Buffer.from(String(v), 'hex'), type: oracledb.BLOB }; return `:b${i}`; }
        if (c === 'PCTEXT' || c === 'DESCRLONG') { binds[`b${i}`] = v === null ? null : { val: String(v), type: oracledb.CLOB }; return v === null ? 'NULL' : `:b${i}`; }
        binds[`b${i}`] = v;
        return `:b${i}`;
      });
      for (const [k, v] of Object.entries(binds)) if (v === null) delete binds[k];
      const stamp = 'LASTUPDDTTM' in r;
      await raw.execute(`INSERT INTO ${t} (${cols.join(', ')}${stamp ? ', LASTUPDDTTM' : ''}) VALUES (${vals.join(', ')}${stamp ? ', SYSTIMESTAMP' : ''})`, binds);
    }
  }
  await raw.commit();
}

const results: Record<string, string> = {};
try {
  for (const c of cases) {
    await reset(c.name);
    const W = MAP[c.menu];
    const opened = await p.readMenuDocument(W);
    const b = await scratch();
    try {
      if (c.rename) await p.renameMenuDefinition(W, MAP[c.rename], opened!.token, operatorId);
      else if (c.remove) await p.deleteMenuDefinition(W, opened!.token, operatorId);
      else {
        const doc = JSON.parse(JSON.stringify(editedDocument(c.name, c.menu, c.hints ?? {})), (_k, v) => map(v)) as MenuDocument;
        await p.saveMenuDocument({ doc, openedToken: opened?.token ?? 'absent', operatorId });
      }
    } catch (e) {
      results[c.name] = `ERROR ${e instanceof Error ? e.message : String(e)}`;
      console.log(`${c.name}: ${results[c.name]}`);
      continue;
    }
    const a = await scratch();
    const mine = changes(b, a);
    const ad = changes(labRows(c.name, 'before'), labRows(c.name, 'after'));
    const diffs = [...new Set([...Object.keys(ad), ...Object.keys(mine)])].sort()
      .filter((t) => ad[t] !== undefined && JSON.stringify(ad[t] ?? []) !== JSON.stringify(mine[t] ?? []))
      .map((t) => `${t}\n    App Designer: ${JSON.stringify(ad[t] ?? [])}\n    writer:       ${JSON.stringify(mine[t] ?? [])}`);
    results[c.name] = diffs.length ? `DIFFERENT\n  ${diffs.join('\n  ')}` : 'IDENTICAL';
    console.log(`${c.name}: ${results[c.name]}`);
  }
} catch (e) {
  console.error(e);
} finally {
  await p.dispose();
  await raw.close();
}
const identical = Object.values(results).filter((r) => r === 'IDENTICAL').length;
const report = `${Object.entries(results).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${identical} of ${Object.keys(results).length} identical\n`;
writeFileSync(join(RESULTS, 'menu-replay-report.txt'), report);
console.log(`\n${identical} of ${Object.keys(results).length} identical`);
