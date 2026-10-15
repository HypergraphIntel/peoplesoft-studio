import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPageRules, describePageRule, pageRulesOf, withPageRule, withoutPageRule, type ComponentPage } from '../model/pfcPages.js';

/*
 * A sequence's page rules (model/pfcPages.ts), on JOB_DATA_FL's shape on HRDMO:
 * sequence 17 hides Labor Information and makes Job Information display only.
 */

const SEQ = { SEQUENCE_NBR: 17, EOCC_SEQUENCE_NBR: 17 };
const PAGES: ComponentPage[] = [
  { page: 'HR_JOBDATA_WL_FL', label: 'Work Location', hidden: false },
  { page: 'HR_JOBDATA_JC_FL', label: 'Job Information', hidden: false },
  { page: 'HR_JOBDATA_JL_FL', label: 'Labor Information', hidden: false },
  { page: 'HR_JOBDATA_GPS_FL', label: 'German Public Sector', hidden: true }
];
// Compact rows, as pfcWriter reads them: EOCC_VISIBLE_FLAG N (the record default) and DISPLAYONLY 0 left out.
const STORED = [
  { ...SEQ, PNLNAME: 'HR_JOBDATA_JC_FL', EOCC_VISIBLE_FLAG: 'Y', DISPLAYONLY: 1 },
  { ...SEQ, PNLNAME: 'HR_JOBDATA_JL_FL' },
  { SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, PNLNAME: 'HR_JOBDATA_JL_FL', EOCC_VISIBLE_FLAG: 'Y' }
];

test('page rules read from compact rows: a missing flag is hidden, the record default', () => {
  assert.deepEqual(pageRulesOf(STORED, SEQ), [
    { page: 'HR_JOBDATA_JC_FL', hidden: false, displayOnly: true },
    { page: 'HR_JOBDATA_JL_FL', hidden: true, displayOnly: false }
  ]);
  assert.equal(describePageRule(pageRulesOf(STORED, SEQ)[0], false), 'shown, display only');
  assert.equal(describePageRule(undefined, true), 'hidden by the component');
  assert.equal(describePageRule({ page: 'HR_JOBDATA_GPS_FL', hidden: false, displayOnly: false }, true), 'shown (the component hides it)');
});

test('a rule is set, replaced or taken away for one sequence only', () => {
  const shown = withPageRule(STORED, SEQ, { page: 'HR_JOBDATA_JL_FL', hidden: false, displayOnly: false });
  assert.deepEqual([shown[1].EOCC_VISIBLE_FLAG, shown[1].DISPLAYONLY], ['Y', 0]);
  assert.equal(shown.length, 3);
  const added = withPageRule(STORED, SEQ, { page: 'HR_JOBDATA_GPS_FL', hidden: false, displayOnly: false });
  assert.equal(added.length, 4);
  const removed = withoutPageRule(STORED, SEQ, 'HR_JOBDATA_JL_FL');
  assert.deepEqual(removed.map((r) => `${r.EOCC_SEQUENCE_NBR}:${r.PNLNAME}`), ['17:HR_JOBDATA_JC_FL', '1:HR_JOBDATA_JL_FL']);
});

test('the save\'s warnings: a required field on a hidden or display-only page; no page left visible', () => {
  const rules = pageRulesOf(STORED, SEQ);
  assert.deepEqual(checkPageRules(17, PAGES, rules, ['HR_JOBDATA_WL_FL']), []);
  assert.match(checkPageRules(17, PAGES, rules, ['HR_JOBDATA_JC_FL']).join(), /display only but has a field configured as required/);
  assert.match(checkPageRules(17, PAGES, rules, ['HR_JOBDATA_JL_FL']).join(), /is hidden but has a field configured as required/);
  const allHidden = PAGES.filter((p) => !p.hidden).map((p) => ({ page: p.page, hidden: true, displayOnly: false }));
  assert.match(checkPageRules(17, PAGES, allHidden, []).join(), /every page of the component is hidden/);
  // Showing a page the component hides keeps one visible.
  assert.deepEqual(checkPageRules(17, PAGES, [...allHidden, { page: 'HR_JOBDATA_GPS_FL', hidden: false, displayOnly: false }], []), []);
});
