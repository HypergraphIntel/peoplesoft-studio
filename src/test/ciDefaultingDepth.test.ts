import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComponentStructure, type StructureField } from '../model/componentStructure.js';
import { ciBuffer, type CiSource } from '../model/ciDocument.js';

/*
 * App Designer's Component Interface "default the properties?" Yes looks at the component's pages and the secondary
 * pages they open, not at a secondary page's own secondary pages. Proved on HRDMO 8.62.09 with ZZ_CI_XCMP: page XP0
 * (EMPLID, PLAN_TYPE) opens secondary XS1 (DEDCD) which opens secondary XS2 (RUN_ID); App Designer defaulted EMPLID,
 * PLAN_TYPE and DEDCD, not RUN_ID. The same cut on PRCSRUNCNTL_SBP on 8.61.15 and 8.62.09.
 */

const f = (n: number, type: number, rec: string, field: string, sub = '', use = 0): StructureField =>
  ({ FIELDNUM: n, FIELDTYPE: type, OCCURSLEVEL: 0, RECNAME: rec, FIELDNAME: field, SUBPNLNAME: sub, FIELDUSE: use });
const EDIT_BOX = 4, SECONDARY = 18, INVISIBLE = 2;
const PAGES: Record<string, StructureField[]> = {
  XP0: [f(1, EDIT_BOX, 'REC', 'EMPLID'), f(2, EDIT_BOX, 'REC', 'PLAN_TYPE'), f(3, SECONDARY, '', '', 'XS1', INVISIBLE)],
  XS1: [f(1, EDIT_BOX, 'REC', 'DEDCD'), f(2, SECONDARY, '', '', 'XS2', INVISIBLE)],
  XS2: [f(1, EDIT_BOX, 'REC', 'RUN_ID')]
};
const FIELDS = ['EMPLID', 'PLAN_TYPE', 'DEDCD', 'RUN_ID'];

test('a placement two secondary-page hops deep is marked nested; one hop and subpages are not', () => {
  const s = buildComponentStructure(['XP0'], 'REC', (p) => PAGES[p], () => 0);
  const placed = s.level0.placed!['REC']!;
  const nested = Object.fromEntries(placed.map((p) => [p.field, p.nested?.[0]]));
  assert.deepEqual(nested, { EMPLID: false, PLAN_TYPE: false, DEDCD: false, RUN_ID: true });
  // Still in the buffer: App Designer's Structure tab shows it.
  assert.deepEqual(placed.map((p) => p.field), ['EMPLID', 'PLAN_TYPE', 'DEDCD', 'RUN_ID']);
});

test('CI defaulting skips a field visible only on a secondary page of a secondary page', () => {
  const structure = buildComponentStructure(['XP0'], 'REC', (p) => PAGES[p], () => 0);
  const src: CiSource = {
    component: 'XCMP', market: 'GBL', searchRecord: 'REC', addSearchRecord: 'REC', actions: 3, structure,
    recordType: () => 0,
    recordFields: (r) => (r === 'REC' ? FIELDS.map((name, i) => ({ name, useEdit: i === 0 ? 1 : 0 })) as never : undefined)
  };
  const buffer = ciBuffer(src);
  const defaulted = buffer.level0.fields.filter((x) => x.defaulted).map((x) => x.field);
  // App Designer's PROPERTIES for ZZ_CI_XCMP: DEDCD, EMPLID, PLAN_TYPE -- not RUN_ID.
  assert.deepEqual(defaulted, ['EMPLID', 'PLAN_TYPE', 'DEDCD']);
  assert.ok(buffer.level0.fields.some((x) => x.field === 'RUN_ID' && !x.defaulted), 'RUN_ID numbered, not defaulted');
});
