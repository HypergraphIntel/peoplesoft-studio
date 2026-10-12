/*
 * The MCP's menu path end to end on HRDMO (what psft_menu_create / edit / copy /
 * rename / delete run): a standard and a popup menu built from specs, edited
 * by operations (relabel, a PeopleCode item renamed with its program, a bar
 * renamed, Cut / Paste), copied, renamed and deleted -- each saved through
 * DatabaseProvider and read back against what was asked.
 *
 * WRITES. HRDMO only; menus ZZ_MENU_E2E* only. Leaves ZZ_MENU_E2E1 and
 * ZZ_MENU_E2EP for App Designer to open.
 *
 *   npx tsx tools/lab/menu-e2e.mts
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import { applyMenuOperation, diffMenuSpec, documentFromSpec, specFromDocument, type MenuOperation, type MenuSpec } from '../../src/model/menuOperations';
import { copyMenu } from '../../src/model/menuDocument';
import { validateMenu } from '../../src/model/menuSession';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_MENU_E2E');
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const q1 = async (sql: string, b: Record<string, unknown> = {}) => ((await raw.execute(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Array<Record<string, unknown>>;

// Clean slate: earlier runs' menus.
for (const m of (await q1(`SELECT MENUNAME FROM PSMENUDEFN WHERE MENUNAME LIKE 'ZZ\\_MENU\\_E2E%' ESCAPE '\\'`)).map((r) => String(r.MENUNAME).trim())) {
  const r = await p.readMenuDocument(m);
  if (r) await p.deleteMenuDefinition(m, r.token, operatorId);
}

try {
  const standard: MenuSpec = {
    menu: 'ZZ_MENU_E2E1', description: 'MCP end to end', label: 'E2E Menu', group: 'E2E Group', menuOrder: 10,
    bars: [
      { name: 'USE', label: '&Use', items: [
        { name: 'ZZ_E2E_CMP', label: 'Lab &Component', type: 'component', component: 'ZZ_PCODE_LAB_CMP' },
        { type: 'separator' },
        { name: 'ZZ_E2E_PC', label: 'Run &Code', type: 'peoplecode', component: 'ZZ_PCODE_LAB_CMP', peopleCode: 'Local string &s = "e2e";\n' }
      ] },
      { name: 'REPORTS', label: '&Reports', items: [{ name: 'ZZ_E2E_CMP2', label: 'Lab Component &2', component: 'ZZ_PCODE_LAB_CMP2', searchRecord: 'ABSENCE_HIST' }] }
    ]
  };
  const doc = documentFromSpec(standard);
  check('standard spec validates', validateMenu(doc).every((d) => d.severity !== 'error'), JSON.stringify(validateMenu(doc)));
  const created = await p.saveMenuDocument({ doc, openedToken: 'absent', operatorId });
  check('standard created (MDM +1, PCM +1)', created.written && created.plan.increments.MDM === 1 && created.plan.increments.PCM === 1, JSON.stringify(created.plan.increments));
  let read = (await p.readMenuDocument('ZZ_MENU_E2E1'))!;
  check('standard reads back as specified', diffMenuSpec(read.doc, standard).length === 0, diffMenuSpec(read.doc, standard).join('; '));
  const items = await q1(`SELECT BARNAME, ITEMNAME, ITEMNUM, ITEMTYPE FROM PSMENUITEM WHERE MENUNAME = 'ZZ_MENU_E2E1' ORDER BY ITEMNUM`);
  check('ITEMNUM runs across the bars', items.map((r) => Number(r.ITEMNUM)).join() === '1,2,3,4', JSON.stringify(items));

  // Edit: relabel, rename the PeopleCode item (its program moves), rename a bar, Cut / Paste between bars.
  const ops: MenuOperation[] = [
    { op: 'set_menu', description: 'MCP end to end, edited' },
    { op: 'set_item', bar: 'USE', item: 'ZZ_E2E_PC', name: 'ZZ_E2E_PC2', label: 'Run &Code 2' },
    { op: 'set_bar', bar: 'REPORTS', name: 'RPTS', label: 'R&eports' },
    { op: 'move_item', bar: 'USE', item: 'ZZ_E2E_CMP', toBar: 'RPTS', index: 0 }
  ];
  let edited = read.doc;
  for (const o of ops) edited = applyMenuOperation(edited, o);
  const e = await p.saveMenuDocument({ doc: edited, openedToken: read.token, operatorId });
  check('edit saved: two renames move CLM by 3 (2 renames + a key gone), PCM by 1', e.plan.increments.CLM === 3 && e.plan.increments.PCM === 1, JSON.stringify(e.plan.increments));
  read = (await p.readMenuDocument('ZZ_MENU_E2E1'))!;
  const pc = await q1(`SELECT OBJECTVALUE2 B, OBJECTVALUE3 I FROM PSPCMPROG WHERE OBJECTID1 = 3 AND OBJECTVALUE1 = 'ZZ_MENU_E2E1'`);
  check('the PeopleCode moved with its item', pc.length === 1 && String(pc[0].I).trim() === 'ZZ_E2E_PC2', JSON.stringify(pc));
  const del = await q1(`SELECT OBJECTVALUE3 I FROM PSPCMPROGDEL WHERE OBJECTID1 = 3 AND OBJECTVALUE1 = 'ZZ_MENU_E2E1'`);
  check('the old PeopleCode key is tombstoned', del.some((r) => String(r.I).trim() === 'ZZ_E2E_PC'), JSON.stringify(del));
  const bars = specFromDocument(read.doc).bars!.map((b) => `${b.name}:${b.items.map((i) => i.name).join('+')}`).join(' ');
  check('bars and items as edited', bars === 'USE:MENUITEM1+ZZ_E2E_PC2 RPTS:ZZ_E2E_CMP+ZZ_E2E_CMP2', bars);

  // A popup with a transfer and a PeopleCode item.
  const popup: MenuSpec = { menu: 'ZZ_MENU_E2EP', type: 'popup', label: 'E2E Popup', items: [
    { name: 'ZZ_E2E_GO', label: 'Go to &Menu', type: 'transfer', transfer: { menu: 'ZZ_MENU_E2E1', component: 'ZZ_PCODE_LAB_CMP', market: 'GBL', page: 'ZZ_PCODE_LAB_PG', action: 'update' } },
    { type: 'separator' }, { name: 'ZZ_E2E_POPPC', label: 'Pop &Code', peopleCode: 'Local number &n = 1;\n' }] };
  const pd = documentFromSpec(popup);
  const pc2 = await p.saveMenuDocument({ doc: pd, openedToken: 'absent', operatorId });
  check('popup created', pc2.written, '');
  const x = await q1(`SELECT XFERMENUNAME, XFERACTION, KEYSEARCH FROM PSXFERITEM WHERE MENUNAME = 'ZZ_MENU_E2EP'`);
  check('its transfer row', x.length === 1 && String(x[0].XFERMENUNAME).trim() === 'ZZ_MENU_E2E1' && Number(x[0].XFERACTION) === 1 && Number(x[0].KEYSEARCH) === 1, JSON.stringify(x));

  // Copy (with PeopleCode), rename the copy (the popup's transfer is not to it), delete it.
  const copy = copyMenu(read.doc, 'ZZ_MENU_E2E2', true);
  await p.saveMenuDocument({ doc: copy, openedToken: 'absent', operatorId });
  const origin = await q1(`SELECT PTORIGINTYPE T, PTORIGINNAME N FROM PSMENUORIGIN WHERE MENUNAME = 'ZZ_MENU_E2E2'`);
  check('Save As records a C origin', origin.length === 1 && String(origin[0].T) === 'C' && String(origin[0].N).trim() === 'ZZ_MENU_E2E1', JSON.stringify(origin));
  const c2 = (await p.readMenuDocument('ZZ_MENU_E2E2'))!;
  await p.renameMenuDefinition('ZZ_MENU_E2E2', 'ZZ_MENU_E2E3', c2.token, operatorId);
  check('rename leaves PSMENUDEL for the old name', (await q1(`SELECT 1 FROM PSMENUDEL WHERE MENUNAME = 'ZZ_MENU_E2E2'`)).length === 1);
  check('rename moves the PeopleCode', (await q1(`SELECT 1 FROM PSPCMPROG WHERE OBJECTID1 = 3 AND OBJECTVALUE1 = 'ZZ_MENU_E2E3'`)).length === 1);
  const c3 = (await p.readMenuDocument('ZZ_MENU_E2E3'))!;
  await p.deleteMenuDefinition('ZZ_MENU_E2E3', c3.token, operatorId);
  check('delete removes it and tombstones it', !(await p.readMenuDocument('ZZ_MENU_E2E3')) && (await q1(`SELECT 1 FROM PSMENUDEL WHERE MENUNAME = 'ZZ_MENU_E2E3'`)).length === 1);

  // Refused as App Designer refuses: a second component item on one component (43,5); a stale token.
  const dup = applyMenuOperation(read.doc, { op: 'add_item', bar: 'USE', item: { name: 'ZZ_DUP', label: 'Dup', component: 'ZZ_PCODE_LAB_CMP' } });
  let refused = '';
  try { await p.saveMenuDocument({ doc: dup, openedToken: read.token, operatorId }); } catch (err) { refused = String(err); }
  check('43,5 refused', /not unique/.test(refused), refused);
  refused = '';
  try { await p.saveMenuDocument({ doc: read.doc, openedToken: 'stale', operatorId }); } catch (err) { refused = String(err); }
  check('a stale token refused', /changed in the database/.test(refused), refused);
} finally {
  await p.dispose();
  await raw.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
