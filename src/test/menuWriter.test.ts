import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES } from '../db/connection.js';
import type { MenuDocument, Row } from '../model/menuDocument.js';
import { planMenuSave, type Counters, type MenuPlan } from '../providers/menuWriter.js';
import { counters, editedDocument, menuCaptureExists, rowsOf, storedDocument, storedMenu } from './menuCaptures.js';

/*
 * The menu writer's plans against App Designer's saves (docs/MENUS.md): the
 * menu as it was before a captured save and the menu after it, and the plan
 * must write App Designer's rows, compile its PeopleCode byte for byte,
 * write and remove its tombstones and move its counters.
 */

const MENU = 'ZZ_PCODE_LAB_MENU';
const MEN2 = 'ZZ_PCODE_LAB_MEN2';
const POP = 'ZZ_PCODE_LAB_POP';
const PO2 = 'ZZ_PCODE_LAB_PO2';

interface Case { name: string; menu: string; hints?: { items?: Record<string, string>; bars?: Record<string, string> }; counters?: Record<string, number> }

/** Every captured Menu Designer save (File > Rename and Delete are the writer's own functions: live replay). */
const CASES: Case[] = [
  { name: 'mn01-create', menu: MENU }, { name: 'mn02-descr', menu: MENU }, { name: 'mn03-comments', menu: MENU }, { name: 'mn04-owner', menu: MENU },
  { name: 'mn05-label', menu: MENU }, { name: 'mn06-group', menu: MENU }, { name: 'mn07-menu-order', menu: MENU }, { name: 'mn08-menu-sep', menu: MENU },
  { name: 'mn09-group-order', menu: MENU }, { name: 'mn10-group-sep', menu: MENU },
  // Menu installed: App Designer moved MDM by 2 or 3 in some sessions and by 1 in another [mn22] -- the writer moves it by 1.
  { name: 'mn11-installed', menu: MENU, counters: { MDM: 1, SYS: 1 } },
  { name: 'mn12-save-as', menu: MEN2 }, { name: 'mn13-group-order-shared', menu: MEN2 }, { name: 'mn14-group-sep-shared', menu: MEN2 },
  { name: 'mn15-installed-shared', menu: MEN2, counters: { MDM: 1, SYS: 1 } },
  { name: 'mn19-recreate-deleted', menu: MEN2 }, { name: 'mn20-group-order-sep', menu: MENU },
  { name: 'mn21-installed-on', menu: MENU, counters: { MDM: 1, SYS: 1 } }, { name: 'mn22-installed-off', menu: MENU },
  { name: 'mi01-add-item', menu: MEN2 }, { name: 'mi02-item-label', menu: MEN2 }, { name: 'mi03-search-override', menu: MEN2 },
  { name: 'mi04-separator', menu: MEN2 }, { name: 'mi05-pc-item', menu: MEN2 }, { name: 'mi06-item-peoplecode', menu: MEN2 },
  { name: 'mi07-item-reorder', menu: MEN2 },
  { name: 'mi08-item-rename', menu: MEN2, hints: { items: { 'USE|ZZ_LAB_PCITM2': 'USE|ZZ_LAB_PCITEM' } } },
  { name: 'mi09-item-rename-full', menu: MEN2, hints: { items: { 'USE|ZZ_LAB_PCITEM': 'USE|ZZ_LAB_PCITM2' } } },
  { name: 'mi10-item-delete', menu: MEN2 }, { name: 'mi11-separator-delete', menu: MEN2 }, { name: 'mi12-item-delete-cmp', menu: MEN2 },
  { name: 'mi13-second-bar', menu: MEN2 }, { name: 'mi14-item-move-bar', menu: MEN2 },
  { name: 'mb01-add-bar', menu: MEN2 }, { name: 'mb02-bar-label', menu: MEN2 }, { name: 'mb03-baritem-pc', menu: MEN2 }, { name: 'mb04-baritem-code', menu: MEN2 },
  { name: 'mb05-bar-rename-full', menu: MEN2, hints: { bars: { LAB_BAR2: 'LAB_BAR' } } },
  { name: 'mb06-bar-reorder', menu: MEN2 }, { name: 'mb07-bar-delete', menu: MEN2 },
  { name: 'mp01-popup-create', menu: POP }, { name: 'mp02-xfer-add', menu: POP }, { name: 'mp03-xfer-correction', menu: POP },
  { name: 'mp04-xfer-upd-all', menu: POP }, { name: 'mp05-xfer-new-window', menu: POP }, { name: 'mp06-xfer-keysearch', menu: POP },
  { name: 'mp07-xfer-portal', menu: POP }, { name: 'mp08-xfer-restore', menu: POP }, { name: 'mp09-popup-pc-sep', menu: POP },
  { name: 'mp10-popup-code', menu: POP }, { name: 'mp11-popup-label', menu: POP }, { name: 'mp12-xfer-menu', menu: PO2 }
];

const NAMES: (keyof Counters)[] = ['MDM', 'PCM', 'CLM', 'PJM', 'SYS', 'ACM', 'TSM', 'TSTM'];

function planCase(c: Case, doc?: MenuDocument): MenuPlan {
  const before = counters(c.name, 'before');
  const start = Object.fromEntries(NAMES.map((n) => [n, before[n] ?? 0])) as unknown as Counters;
  return planMenuSave(storedMenu(c.name, 'before', c.menu), doc ?? editedDocument(c.name, c.menu, c.hints ?? {}),
    { operatorId: 'JARED', toolsRelease: '8.62', lastupddttm: '2026-10-11T12:00:00.000000', counters: start, oracledb: ADAPTER_TYPES });
}

function moved(caseName: string): Record<string, number> {
  const b = counters(caseName, 'before');
  const a = counters(caseName, 'after');
  return Object.fromEntries(NAMES.map((n) => [n, (a[n] ?? 0) - (b[n] ?? 0)]).filter(([, d]) => d !== 0));
}

const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const norm = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() === '' ? ' ' : String(v).trim());
const shape = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort().map((k) => [k, norm(r[k])]))).sort();

const present = CASES.filter((c) => menuCaptureExists(c.name));

test('the captures are here', () => {
  assert.equal(present.length, CASES.length, `missing: ${CASES.filter((c) => !menuCaptureExists(c.name)).map((c) => c.name).join(', ')}`);
});

test('plans write the rows App Designer wrote', () => {
  for (const c of present) {
    const p = planCase(c);
    const after = (t: string) => rowsOf(c.name, 'after', t, c.menu);
    assert.deepEqual(shape([p.desired.menu]), shape(after('PSMENUDEFN')), `${c.name} PSMENUDEFN`);
    assert.deepEqual(shape(p.desired.items), shape(after('PSMENUITEM')), `${c.name} PSMENUITEM`);
    assert.deepEqual(shape(p.desired.transfers), shape(after('PSXFERITEM')), `${c.name} PSXFERITEM`);
    assert.deepEqual(shape(p.desired.origins), shape(after('PSMENUORIGIN')), `${c.name} PSMENUORIGIN`);
  }
});

test('plans move the counters App Designer moved', () => {
  for (const c of present) {
    const p = planCase(c);
    const got = Object.fromEntries(Object.entries(p.increments).filter(([, d]) => d));
    assert.deepEqual(got, c.counters ?? moved(c.name), c.name);
  }
});

test('the menu row is stamped when App Designer stamped it, the group written when it wrote the group', () => {
  for (const c of present) {
    const p = planCase(c);
    const b = rowsOf(c.name, 'before', 'PSMENUDEFN', c.menu)[0];
    const a = rowsOf(c.name, 'after', 'PSMENUDEFN', c.menu)[0];
    const stamped = !b || b.LASTUPDDTTM !== a.LASTUPDDTTM;
    assert.equal(p.menuStamped, stamped, `${c.name} stamp`);
    // Every other menu whose VERSION App Designer moved is one the plan writes as the group's.
    const others = rowsOf(c.name, 'after', 'PSMENUDEFN').filter((r) => r.MENUNAME !== c.menu && rowsOf(c.name, 'before', 'PSMENUDEFN', String(r.MENUNAME))[0]?.VERSION !== r.VERSION);
    for (const o of others) assert.ok(p.summary.groupMenus.includes(String(o.MENUNAME)), `${c.name}: ${o.MENUNAME} is the group's`);
    if (others.length) assert.equal(p.groupWritten, true, c.name);
  }
});

test('ItemSelected PeopleCode compiles to App Designer\'s bytes and versions; moved and deleted programs are tombstoned', () => {
  let compiled = 0;
  for (const c of present) {
    const p = planCase(c);
    for (const [k, prog] of p.peopleCode) {
      const [bar, item] = k.split('|');
      const stored = rowsOf(c.name, 'after', 'PSPCMPROG', c.menu).find((r) => String(r.OBJECTVALUE2).trim() === bar && String(r.OBJECTVALUE3).trim() === item);
      assert.ok(stored, `${c.name} ${k} stored`);
      assert.equal(prog.program[0].bytes.toString('hex'), String(stored!.PROGTXT), `${c.name} ${k} bytes`);
      assert.equal(prog.program[0].version, Number(stored!.VERSION), `${c.name} ${k} VERSION`);
      compiled++;
    }
    // def-capture cases watch PSPCMPROGDEL: the plan writes the tombstones App Designer wrote.
    const was = new Set(rowsOf(c.name, 'before', 'PSPCMPROGDEL', c.menu).map((r) => `${r.OBJECTVALUE2}|${r.OBJECTVALUE3}|${r.VERSION}`));
    const added = rowsOf(c.name, 'after', 'PSPCMPROGDEL', c.menu).filter((r) => !was.has(`${r.OBJECTVALUE2}|${r.OBJECTVALUE3}|${r.VERSION}`))
      .map((r) => `${String(r.OBJECTVALUE2).trim()}|${String(r.OBJECTVALUE3).trim()}|${r.VERSION}`).sort();
    if (!rowsOf(c.name, 'after', 'PSPCMPROGDEL').length && !rowsOf(c.name, 'before', 'PSPCMPROGDEL').length) continue;
    const planned = p.statements.filter((s) => s.what === 'Inserting PSPCMPROGDEL').map((s) => `${String(s.binds.v2).trim()}|${String(s.binds.v3).trim()}|${s.binds.dv}`).sort();
    assert.deepEqual(planned, added, `${c.name} tombstones`);
  }
  assert.ok(compiled >= 4, `compiled ${compiled}`);
});

test('re-creating a deleted menu removes its PSMENUDEL row', () => {
  const p = planCase(present.find((c) => c.name === 'mn19-recreate-deleted')!);
  assert.ok(p.statements.some((s) => s.what === 'Deleting PSMENUDEL'));
});

test('a stored menu read and saved unchanged plans nothing', () => {
  for (const c of present) {
    const s = storedMenu(c.name, 'after', c.menu);
    if (!s.exists) continue;
    const now = counters(c.name, 'after');
    const p = planMenuSave(s, storedDocument(s), {
      operatorId: 'JARED', toolsRelease: '8.62', lastupddttm: '2026-10-11T12:00:00.000000',
      counters: Object.fromEntries(NAMES.map((n) => [n, now[n] ?? 0])) as unknown as Counters, oracledb: ADAPTER_TYPES
    });
    assert.equal(p.empty, true, `${c.name}: ${p.summary.changes.join('; ')} ${p.summary.peopleCodeChanged.join('; ')}`);
    assert.equal(p.statements.length, 0, c.name);
  }
});
