/*
 * The eight controls 0.8.3 added to the Page Designer's Insert menu, saved
 * through the writer (DatabaseProvider.savePage, as the Layout editor and
 * psft_edit_page save) onto a scratch page, each compared with the rows App
 * Designer wrote when it inserted the same control on ZZ_PCODE_LAB_IN
 * (tools/corpus/save-protocol/results im-*, tr-*, ch-*, sp-fresh, sbp-fresh,
 * gd-*, ts-fresh, ag-fresh): every PSPNLFIELD / PSPNLFIELDEXT column but the
 * page name, PNLFLDID, FIELDNUM and TREECTRLID (the tree's FIELDNUM), and the
 * grid / analytic grid / tree rows that go with them.
 *
 * WRITES. HRDMO only; the page ZZ_PCODE_LAB_WI only (recreated).
 *
 *   npx tsx tools/lab/page-insert-replay.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { DefinitionType } from '../../src/model/definitions';
import { applyPageOperations, type PageOperation } from '../../src/model/pageOperations';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const PAGE = 'ZZ_PCODE_LAB_WI', AD_PAGE = 'ZZ_PCODE_LAB_IN';
const RESULTS = join(process.cwd(), 'tools/corpus/save-protocol/results');

const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NUMBER];
oracledb.fetchAsBuffer = [oracledb.BLOB];
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
type Row = Record<string, unknown>;
const q = async (sql: string, binds: Row = {}) => ((await raw.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Row[];

/** App Designer's row of a control: inserted by the case, or as saved after it (after.json) for a control its dialog then bound. */
function adRow(caseDir: string, table: string, id: number, saved = false): Row | undefined {
  const file = JSON.parse(readFileSync(join(RESULTS, caseDir, saved ? 'after.json' : 'delta.json'), 'utf8')).watch[table];
  if (!file) return undefined;
  if (!saved) return (file.inserted as Row[]).find((r) => Number(r.PNLFLDID) === id);
  const r = (file.rows as Array<Array<string | null>>).find((x) => Number(x[file.columns.findIndex((c: { name: string }) => c.name === 'PNLFLDID')]) === id);
  return r ? Object.fromEntries(file.columns.map((c: { name: string }, i: number) => [c.name, r[i]])) : undefined;
}
const IGNORE = new Set(['PNLNAME', 'PNLFLDID', 'FIELDNUM', 'TREECTRLID', 'PARENTPNLFLDID', 'PAGEPNLFLDID', 'GRDCOLUMNCOUNT']);
const norm = (r: Row | undefined) => (r ? Object.fromEntries(Object.keys(r).filter((k) => !IGNORE.has(k)).sort().map((k) => {
  const v = r[k]; return [k, v === null || v === undefined ? null : String(v).trim() === '' ? ' ' : String(v)];
})) : undefined);
function diff(a: Row | undefined, b: Row | undefined): string[] {
  const x = norm(a) ?? {}, y = norm(b) ?? {};
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).map((k) => `${k}: App Designer ${JSON.stringify(x[k])}, writer ${JSON.stringify(y[k])}`);
}

interface Step { name: string; dir: string; id: number; saved?: boolean; op: PageOperation; then?: PageOperation; extra?: string[] }
// Each the same control at the same place as App Designer's capture.
const steps: Step[] = [
  { name: 'Image', dir: 'im-fresh', id: 2, op: { op: 'add', kind: 'image', left: 40, top: 172 } },
  { name: 'Image on an image field', dir: 'im-field', id: 2, saved: true, op: { op: 'add', kind: 'image', left: 40, top: 172, record: 'EMPL_PHOTO', field: 'EMPLOYEE_PHOTO' } },
  { name: 'Tree', dir: 'tr-fresh', id: 3, op: { op: 'add', kind: 'tree', left: 220, top: 132, record: 'EMPL_PHOTO' } },
  { name: 'Tree with a level', dir: 'tr-nodes', id: 3, saved: true, extra: ['PSPNLTREECTRL'],
    op: { op: 'add', kind: 'tree', left: 220, top: 132, record: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_VAL', treeLevels: [{ record: 'ZZ_PCODE_LAB_R6', field: 'ZZ_PCODE_LAB_C08' }] } },
  { name: 'Chart', dir: 'ch-fresh', id: 4, op: { op: 'add', kind: 'chart', left: 380, top: 252, record: 'EMPL_PHOTO' } },
  { name: 'Chart on a field', dir: 'ch-field', id: 4, saved: true, op: { op: 'add', kind: 'chart', left: 380, top: 252, record: 'ZZ_PCODE_LAB_R6', field: 'ZZ_PCODE_LAB_C08' } },
  { name: 'Secondary Page', dir: 'sp-fresh', id: 5, op: { op: 'add', kind: 'secondaryPage', left: 480, top: 52, page: 'ZZ_PCODE_LAB_SEC' } },
  { name: 'Subpage', dir: 'sbp-fresh', id: 6, op: { op: 'add', kind: 'subpage', left: 300, top: 300, page: 'ZZ_PCODE_LAB_SUB' } },
  { name: 'Grid', dir: 'gd-fresh', id: 8, extra: ['PSPNLCNTRLDATA'], op: { op: 'add', kind: 'grid', left: 100, top: 204, width: 380, height: 108, record: 'ZZ_PCODE_LAB_R6' } },
  { name: 'Grid column', dir: 'gd-column', id: 9, op: { op: 'add', kind: 'editBox', left: 0, top: 0, width: 120, height: 15, record: 'ZZ_PCODE_LAB_R6', field: 'ZZ_PCODE_LAB_C08', intoGrid: -1 } },
  { name: 'Tab Separator', dir: 'ts-fresh', id: 10, op: { op: 'add', kind: 'tabSeparator', left: 0, top: 0, intoGrid: -1 } },
  { name: 'Analytic Grid', dir: 'ag-fresh', id: 11, extra: ['PSPNLCNTRLDATA', 'PSPNLACEGRDDATA', 'PSPNLACEGRDAXIS'],
    op: { op: 'add', kind: 'analyticGrid', left: 180, top: 12, width: 280, height: 92, model: 'PTACEDUMMODEL' } },
  { name: 'Analytic Grid column', dir: 'ag-fresh', id: 12, op: { op: 'add', kind: 'editBox', left: 0, top: 0, width: 100, height: 0, record: 'PTACEVWRGRDREC', field: 'PTACEGRIDFLD01', intoGrid: -1 } }
];

const results: string[] = [];
try {
  // A clean scratch page with one Static Text, as App Designer's lab page began.
  if ((await q(`SELECT 1 FROM PSPNLDEFN WHERE PNLNAME = :p`, { p: PAGE })).length) {
    for (const t of ['PSPNLFIELD', 'PSPNLFIELDEXT', 'PSPNLCNTRLDATA', 'PSPNLBTNDATA', 'PSPNLACEGRDDATA', 'PSPNLACEGRDAXIS', 'PSPNLTREECTRL', 'PSPNLDEFN']) {
      await raw.execute(`DELETE FROM ${t} WHERE PNLNAME = :p`, { p: PAGE });
    }
    await raw.commit();
  }
  const layoutOf = async () => (await p.readPageLayout({ type: DefinitionType.Page, parts: [PAGE] })).layout;
  const base = { pnlFldId: -1, fieldLeft: 152, fieldTop: 72, fieldRight: 280, fieldBottom: 92, editLblLeft: 0, editLblTop: 0, editLblRight: 0, editLblBottom: 0,
    fieldSizeType: 0, lblType: 1, lblText: 'Text', fieldUse: 0, secureInvisible: 0, add: { kind: 'staticText' as const, recName: '', fieldName: '' } };
  await p.createPage({ pnlName: PAGE, operatorId, controls: [base] });

  // A grid's columns go with it in one save (the grid is the save's first added control: intoGrid -1).
  const groups: Step[][] = [];
  for (const s of steps) {
    if ((s.op as { intoGrid?: number }).intoGrid !== undefined) groups[groups.length - 1].push(s); else groups.push([s]);
  }
  for (const group of groups) {
    const before = new Set((await q(`SELECT PNLFLDID FROM PSPNLFIELD WHERE PNLNAME = :p`, { p: PAGE })).map((r) => Number(r.PNLFLDID)));
    const layout = await layoutOf();
    const { controls, properties, order } = applyPageOperations(layout, group.map((s) => s.op));
    await p.savePage({ pnlName: PAGE, openedVersion: layout.version, operatorId, controls, properties, ...(order ? { order } : {}), saveInvalid: true });
    const added = (await q(`SELECT PNLFLDID FROM PSPNLFIELD WHERE PNLNAME = :p ORDER BY PNLFLDID`, { p: PAGE })).map((r) => Number(r.PNLFLDID)).filter((id) => !before.has(id));
    for (const [i, s] of group.entries()) {
      const id = added[i];
      const mine = async (table: string) => (await q(`SELECT * FROM ${table} WHERE PNLNAME = :p AND ${table === 'PSPNLTREECTRL' ? 'TREECTRLID = (SELECT TREECTRLID FROM PSPNLFIELD WHERE PNLNAME = :p AND PNLFLDID = :id)' : 'PNLFLDID = :id'}`,
        { p: PAGE, id }));
      const problems = [
        ...diff(adRow(s.dir, 'PSPNLFIELD', s.id, s.saved), (await mine('PSPNLFIELD'))[0]).map((d) => `PSPNLFIELD ${d}`),
        ...diff(adRow(s.dir, 'PSPNLFIELDEXT', s.id, s.saved), (await mine('PSPNLFIELDEXT'))[0]).map((d) => `PSPNLFIELDEXT ${d}`)
      ];
      for (const t of s.extra ?? []) {
        const ad = t === 'PSPNLTREECTRL' ? JSON.parse(readFileSync(join(RESULTS, s.dir, 'delta.json'), 'utf8')).watch[t].inserted as Row[] : [adRow(s.dir, t, s.id)];
        const w = await mine(t);
        if (ad.length !== w.length) problems.push(`${t}: App Designer ${ad.length} rows, writer ${w.length}`);
        ad.forEach((r, j) => problems.push(...diff(r, w[j]).map((d) => `${t} ${d}`)));
      }
      results.push(`${s.name} (${s.dir}): ${problems.length ? `DIFFERENT\n    ${problems.join('\n    ')}` : 'IDENTICAL'}`);
      console.log(results[results.length - 1]);
    }
    // The grid counted its columns as App Designer's did (gd-column 1, then 2 with the Tab Separator; ag-fresh 1).
    if (group.length > 1) {
      const [g] = await q(`SELECT GRDCOLUMNCOUNT FROM PSPNLFIELD WHERE PNLNAME = :p AND PNLFLDID = :id`, { p: PAGE, id: added[0] });
      const line = `  ${group[0].name} GRDCOLUMNCOUNT ${g.GRDCOLUMNCOUNT} (columns ${group.length - 1})`;
      results.push(line); console.log(line);
    }
  }
} finally {
  await p.dispose();
  await raw.close();
}
const identical = results.filter((r) => r.endsWith('IDENTICAL')).length;
writeFileSync(join(RESULTS, 'page-insert-replay-report.txt'), `${results.join('\n')}\n\n${identical} of ${steps.length} identical\n`);
console.log(`\n${identical} of ${steps.length} identical`);
void AD_PAGE;
