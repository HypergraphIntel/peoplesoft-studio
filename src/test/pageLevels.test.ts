import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPageScrolls, occursLevels, type CheckedControl } from '../model/pageLevels.js';

const page = 'ZZ_PCODE_LAB_LV';
/** A capture's ZZ_PCODE_LAB_LV controls, in tab order, as App Designer saved them. */
function saved(capture: string): Array<CheckedControl & { id: number }> {
  const t = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, 'after.json'), 'utf8')).watch.PSPNLFIELD;
  const cols: string[] = t.columns.map((c: { name: string }) => c.name);
  return (t.rows as string[][]).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])))
    .filter((r) => r.PNLNAME === page).sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM))
    .map((r) => ({ id: Number(r.PNLFLDID), fieldType: Number(r.FIELDTYPE), occursLevel: Number(r.OCCURSLEVEL), fieldUse: Number(r.FIELDUSE),
      recName: r.RECNAME, fieldName: r.FIELDNAME, label: r.LBLTEXT, assocFieldNum: Number(r.ASSOCFIELDNUM),
      recType: r.RECNAME.trim() === 'DERIVED_ADDRESS' ? 2 : 0 }));
}
const move = <T>(list: readonly T[], from: number, to: number): T[] => { const out = [...list]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out; };
const texts = (controls: readonly CheckedControl[]) => checkPageScrolls(page, controls).map((p) => `${p.text} (${p.set},${p.num})`);

test('the levels App Designer stored follow from the tab order (lv04-lv16)', () => {
  for (const capture of ['lv04-sb-level2', 'lv06-hr-level1', 'lv08-hr2-level0', 'lv09-sb-level1', 'lv11-hr1-unset', 'lv13-hr1-level1', 'lv14-reorder', 'lv15-reorder-in', 'lv16-reorder-back', 'lv18-derived-in-scroll']) {
    const controls = saved(capture);
    assert.deepEqual(occursLevels(controls), controls.map((c) => c.occursLevel), capture);
  }
});

test('the scroll-level page App Designer saved without a warning passes; a Derived/Work field in a scroll is allowed (lv16, lv18)', () => {
  assert.deepEqual(texts(saved('lv16-reorder-back')), []);
  assert.deepEqual(texts(saved('lv18-derived-in-scroll')), []);
});

test('App Designer\'s save messages for an invalid page (e1, e2, e4, lv17)', () => {
  const base = saved('lv16-reorder-back');
  // e1: ZZ_R_L0_B.ZZ_KEY0 dragged into the level-1 scroll after ZZ_R_L1_A.ZZ_KEY1.
  assert.deepEqual(texts(move(base, 8, 3)), ['More than one data record in scroll -- make fields from non-primary record related display: ZZ_R_L0_B.ZZ_KEY0. (15,22)']);
  // e2: ZZ_R_L1_A.ZZ_KEY0 dragged above the Set to Level rule, into the level-2 scroll of ZZ_R_L2_A.
  assert.deepEqual(texts(move(base, 6, 5)), ['More than one data record in scroll -- make fields from non-primary record related display: ZZ_R_L1_A.ZZ_KEY0. (15,22)']);
  // e4: the level-2 scroll bar set to level 3 inside the level-1 scroll area.
  assert.deepEqual(texts(base.map((c) => (c.fieldType === 10 ? { ...c, occursLevel: 3 } : c))), ['Invalid field level: ZZ_PCODE_LAB_LV.Scroll Bar. (15,18)']);
  // lv17: a new level-1 scroll bar after ZZ_KEY2, then straight into the Set to Level rule.
  const bar = { ...base[3], id: 10, occursLevel: 1 };
  assert.deepEqual(texts([...base.slice(0, 5), bar, ...base.slice(5)]), ['No data for scroll: ZZ_PCODE_LAB_LV.Scroll Bar. (15,19)']);
});

test('a related display must follow its control field in the same scroll; ASSOCFIELDNUM 0 is the first control', () => {
  const f = (recName: string, fieldName: string, over: Partial<CheckedControl> = {}): CheckedControl =>
    ({ fieldType: 4, occursLevel: 0, fieldUse: 0, recName, fieldName, label: '', recType: 0, ...over });
  const page0 = [f('A', 'ID', { fieldUse: 0x8 }), f('B', 'DESCR', { fieldUse: 0x11, assocFieldNum: 0 })];
  assert.deepEqual(checkPageScrolls('P', page0), []);
  assert.equal(checkPageScrolls('P', [page0[1], page0[0]]).length, 1); // before its control
  const inScroll = [f('A', 'ID', { fieldUse: 0x8 }), { ...f(' ', ' ', { fieldType: 27, occursLevel: 1 }), label: 'Scroll Area' }, f('C', 'X'),
    f('B', 'DESCR', { fieldUse: 0x11, assocFieldNum: 0 })];
  assert.match(checkPageScrolls('P', inScroll)[0].text, /^Invalid related display -- not after control or related to field outside scroll: B\.DESCR$/);
});
