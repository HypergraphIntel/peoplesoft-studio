import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allItems, copyMenu, insertBar, insertItem, MenuEditError, newMenu, rowsFromDocument, setItem, setMenu, setTransferFields, newTransfer
} from '../model/menuDocument.js';
import { applyMenuOp, validateMenu } from '../model/menuSession.js';
import { applyMenuOperation, diffMenuSpec, documentFromSpec, specFromDocument } from '../model/menuOperations.js';
import { menuCaptureExists, storedDocument, storedMenu } from './menuCaptures.js';

/* The Menu Designer's model against App Designer's behaviour (docs/MENUS.md): defaults, names, checks, transfers, specs. */

test('a new menu is App Designer\'s: label and group from the name, alphabetical, installed (mn01); a popup has none (mp01)', () => {
  const m = newMenu('ZZ_PCODE_LAB_MENU', 0);
  assert.equal(m.label, 'Zz Pcode Lab Menu');
  assert.equal(m.group, 'Zz Pcode Lab Menu');
  assert.deepEqual([m.menuOrder, m.groupOrder, m.installed, m.menuSeparator, m.groupSeparator], [9999, 9999, true, false, false]);
  const p = newMenu('ZZ_PCODE_LAB_POP', 1);
  assert.deepEqual([p.label, p.group, p.menuOrder, p.groupOrder, p.bars.map((b) => b.name)], ['', '', 0, 0, ['MENUITEM1']]);
});

test('default names are MENUITEMn, the smallest free; a separator keeps its default (mi04, mi05, mb01)', () => {
  let m = insertBar(newMenu('M', 0), { name: 'USE', label: '&Use' }).doc;
  m = insertItem(m, 'USE', { type: 8 }).doc;
  assert.deepEqual(allItems(m).map((x) => x.item.name), ['MENUITEM1']);
  m = insertItem(m, 'USE', { type: 9, component: 'C' }).doc;
  assert.deepEqual(allItems(m).map((x) => x.item.name), ['MENUITEM1', 'MENUITEM2']);
  assert.equal(insertBar(m).bar, 'MENUITEM1'); // bars count bars' names
  assert.equal(insertItem(m, 'USE', { type: 8, name: 'IGNORED' }).item, 'MENUITEM3');
});

test('a popup menu has Transfer / PeopleCode / Separator items; a standard one Component / PeopleCode / Separator', () => {
  assert.throws(() => insertItem(newMenu('P', 1), 'MENUITEM1', { type: 5 }), MenuEditError);
  assert.throws(() => insertItem(insertBar(newMenu('M', 0), { name: 'USE' }).doc, 'USE', { type: 12 }), MenuEditError);
  const p = insertItem(newMenu('P', 1), 'MENUITEM1', { type: 12, name: 'GO' }).doc;
  assert.deepEqual(allItems(p)[0].item.transfer, newTransfer());
});

test('App Designer\'s save checks: an item to save; a component for component and PeopleCode items (43,4); one item per component (43,5)', () => {
  const codes = (d: Parameters<typeof validateMenu>[0]) => validateMenu(d).filter((x) => x.severity === 'error').map((x) => x.code);
  assert.deepEqual(codes(newMenu('M', 0)), ['menu-empty']);
  let m = insertBar(newMenu('M', 0), { name: 'USE' }).doc;
  m = insertItem(m, 'USE', { name: 'A', label: 'A', type: 9 }).doc;
  assert.deepEqual(codes(m), ['component-required']);
  m = setItem(m, { bar: 'USE', item: 'A' }, { component: 'C' });
  m = insertItem(m, 'USE', { name: 'B', label: 'B', component: 'C' }).doc;
  assert.deepEqual(codes(m), []); // a PeopleCode item may share its component (mi05)
  m = insertItem(m, 'USE', { name: 'D', label: 'D', component: 'C' }).doc;
  assert.deepEqual(codes(m), ['component-duplicate']);
  assert.equal(m.bars[0].items[0].market, 'GBL');
});

test('Transfer Properties: a field set clears those that depend on it (mp07, mp08); Use Current / LOCAL are blank', () => {
  const full = { ...newTransfer(), menu: 'M', component: 'C', market: 'GBL', page: 'P', action: 2 };
  assert.deepEqual(setTransferFields(full, { node: 'EMPL' }), { ...newTransfer(), node: 'EMPL', action: 1, useData: false });
  assert.deepEqual(setTransferFields(full, { portal: 'Use Current' }), full);
  assert.deepEqual(setTransferFields(full, { component: 'D' }), { ...full, component: 'D', market: '', page: '', action: 1 });
});

test('a group chosen from the list brings its order and separator (they are the group\'s)', () => {
  const m = setMenu(newMenu('M', 0), { group: 'Lab Group' }, new Map([['Lab Group', { order: 30, separator: true }]]));
  assert.deepEqual([m.group, m.groupOrder, m.groupSeparator], ['Lab Group', 30, true]);
  assert.throws(() => setMenu(newMenu('P', 1), { group: 'G' }), /only a Menu Label/);
});

test('Save As copies the menu with a C origin (mn12); without PeopleCode when not asked', () => {
  const s = storedMenu('mb04-baritem-code', 'after', 'ZZ_PCODE_LAB_MEN2');
  if (!s.exists) return;
  const doc = storedDocument(s);
  const copy = copyMenu(doc, 'ZZ_COPY', false);
  assert.deepEqual(rowsFromDocument(copy).origins, [{ MENUNAME: 'ZZ_COPY', PTORIGINTYPE: 'C', PTORIGINNAME: 'ZZ_PCODE_LAB_MEN2' }]);
  assert.equal(rowsFromDocument(copy).peopleCode.length, 0);
  assert.equal(rowsFromDocument(copyMenu(doc, 'ZZ_COPY', true)).peopleCode.length, 1);
});

test('every captured menu survives spec -> document -> spec, and its rows are the same (bar / item order, types, transfers)', () => {
  const cases: Array<[string, string]> = [['mn22-installed-off', 'ZZ_PCODE_LAB_MENU'], ['mb06-bar-reorder', 'ZZ_PCODE_LAB_MEN2'], ['mi13-second-bar', 'ZZ_PCODE_LAB_MEN2'],
    ['mb04-baritem-code', 'ZZ_PCODE_LAB_MEN2'], ['mp11-popup-label', 'ZZ_PCODE_LAB_POP'], ['mp12-xfer-menu', 'ZZ_PCODE_LAB_PO2']];
  for (const [c, menu] of cases) {
    if (!menuCaptureExists(c)) continue;
    const doc = storedDocument(storedMenu(c, 'after', menu));
    const spec = specFromDocument(doc);
    const rebuilt = documentFromSpec(spec);
    const strip = (rows: ReturnType<typeof rowsFromDocument>) => ({ ...rows, origins: [], peopleCode: rows.peopleCode.map(({ origin: _o, ...pc }) => pc) });
    assert.deepEqual(strip(rowsFromDocument(rebuilt)), strip(rowsFromDocument(doc)), c);
    assert.deepEqual(diffMenuSpec(rebuilt, spec), [], c);
  }
});

test('operations by name: rename an item (its origin kept for the save), move it, delete a bar', () => {
  const s = storedMenu('mb06-bar-reorder', 'after', 'ZZ_PCODE_LAB_MEN2');
  if (!s.exists) return;
  let doc = storedDocument(s);
  doc = applyMenuOperation(doc, { op: 'set_item', bar: 'LAB_BAR2', item: 'ZZ_LAB_PCITEM', name: 'zz_lab_pc2', label: 'Bar Code 2' });
  const it = doc.bars.find((b) => b.name === 'LAB_BAR2')!.items.find((i) => i.name === 'ZZ_LAB_PC2')!;
  assert.deepEqual(it.origin, { bar: 'LAB_BAR2', item: 'ZZ_LAB_PCITEM' });
  doc = applyMenuOperation(doc, { op: 'move_item', bar: 'LAB_BAR2', item: 'ZZ_LAB_PC2', index: 0 });
  assert.equal(doc.bars.find((b) => b.name === 'LAB_BAR2')!.items[0].name, 'ZZ_LAB_PC2');
  doc = applyMenuOp(doc, { kind: 'deleteBar', bar: 'LAB_BAR2' });
  assert.deepEqual(doc.bars.map((b) => b.name), ['USE']);
});
