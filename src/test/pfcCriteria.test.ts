import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRITERIA_OPERATORS, checkCriterion, criteriaOf, criterionKey, describeCriterion, withCriterion, withCriterionValue, withoutCriterion } from '../model/pfcCriteria.js';
import { catalogCriteriaRow, criteriaDefaultText, type PfcCatalogField } from '../providers/pfcCatalog.js';

/*
 * A configuration's criteria (model/pfcCriteria.ts) on the shapes of Oracle's
 * on HRDMO: JOB_DATA_FL sequence 1, Action in a list; EE_HR_PROC_FL, Nature of
 * Action Code greater than a value and WIP Status equal to one.
 */

const SEQ = { SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1 };
const ACTION: PfcCatalogField = {
  pageField: '0.DERIVED_JOB_HDR.ACTION.22.0.P', level: 0, record: 'DERIVED_JOB_HDR', field: 'ACTION', pnlfldid: 22, ownLevel: 0,
  page: 'HR_JOBDATA_LVL_SBF', componentPage: 'HR_JOBDATA_LVL_SBF', label: 'Action', fieldType: 5, fieldUse: 0, record1: '', field1: '', recordBase: 'DERIVED_JOB_HDR'
};

test("a criterion row is the catalog field's placement with its database type and default text [JOB_DATA_FL]", () => {
  const row = catalogCriteriaRow(ACTION, 0, SEQ, 'K');
  assert.deepEqual([row.RECNAME, row.FIELDNAME, row.PNLFLDID, row.PNLNAME, row.OCCURSLEVEL, row.EOCC_FIELD_TYPE, row.LBLTEXT, row.RECNAME_BASE, row.EOCC_CRITERIA_SYM],
    ['DERIVED_JOB_HDR', 'ACTION', 22, 'HR_JOBDATA_LVL_SBF', 0, 0, 'Action', 'DERIVED_JOB_HDR', 'K']);
  assert.deepEqual([0, 2, 4, 5, 6].map(criteriaDefaultText), ['', '0', 'YYYY-MM-DD', 'HH:MM:SS', 'YYYY-MM-DD HH:MM:SS.ms AM']);
});

test('values are checked by operator and field type', () => {
  assert.deepEqual(checkCriterion('K', 0, 'PRO,OCM,DTA'), []);
  assert.equal(checkCriterion('K', 0, ' , ').length, 1);
  assert.deepEqual(checkCriterion('G', 0, ''), [], 'contains no value takes none');
  assert.equal(checkCriterion('A', 0, '').length, 1);
  assert.equal(checkCriterion('C', 2, 'abc').length, 1);
  assert.deepEqual(checkCriterion('C', 2, '899'), []);
  assert.equal(checkCriterion('A', 4, '01/02/2026').length, 1);
  assert.deepEqual(checkCriterion('I', 4, '2026-01-01', '2026-12-31'), []);
  assert.equal(checkCriterion('I', 4, '2026-01-01', '').length, 1);
  assert.equal(checkCriterion('Z', 0, 'x').length, 1);
  assert.equal(Object.keys(CRITERIA_OPERATORS).length, 15);
});

test('setting a value normalizes lists and clears what the operator does not use', () => {
  const row = catalogCriteriaRow(ACTION, 0, SEQ, 'A');
  assert.equal(withCriterionValue(row, 'K', 'PRO, OCM ,DTA,').EOCC_VALUE_MATCH, 'PRO,OCM,DTA');
  assert.deepEqual([withCriterionValue(row, 'H', 'x').EOCC_VALUE_MATCH, withCriterionValue(row, 'A', 'HIR', 'x').EOCC_VALUE_MATCH2], ['', '']);
  assert.equal(withCriterionValue(row, 'I', 'A', 'M').EOCC_VALUE_MATCH2, 'M');
});

test('criteria are added, replaced (an operator change replaces the row) and removed per sequence', () => {
  const k = withCriterionValue(catalogCriteriaRow(ACTION, 0, SEQ, 'K'), 'K', 'PRO,OCM');
  let rows = withCriterion([], k);
  assert.equal(criteriaOf(rows, SEQ).length, 1);
  const edited = withCriterionValue(k, 'A', 'HIR');
  rows = withCriterion(rows, edited, criterionKey(k));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].EOCC_CRITERIA_SYM, 'A');
  rows = withCriterion(rows, { ...edited, SEQUENCE_NBR: 2, EOCC_SEQUENCE_NBR: 2 });
  assert.equal(rows.length, 2, "another sequence's criterion is its own row");
  rows = withoutCriterion(rows, SEQ, criterionKey(edited));
  assert.deepEqual(rows.map((r) => r.EOCC_SEQUENCE_NBR), [2]);
});

test('criteria read as the configurator summarizes them', () => {
  assert.equal(describeCriterion({ LBLTEXT: 'Action', EOCC_CRITERIA_SYM: 'K', EOCC_VALUE_MATCH: 'PRO,OCM,DTA' }), 'Action in list PRO, OCM, DTA');
  assert.equal(describeCriterion({ LBLTEXT: 'Nature of Action Code', EOCC_CRITERIA_SYM: 'C', EOCC_VALUE_MATCH: '899' }), 'Nature of Action Code greater than 899');
  assert.equal(describeCriterion({ LBLTEXT: 'Hire Date', EOCC_CRITERIA_SYM: 'I', EOCC_VALUE_MATCH: '2026-01-01', EOCC_VALUE_MATCH2: '2026-12-31' }), 'Hire Date between 2026-01-01 and 2026-12-31');
  assert.equal(describeCriterion({ RECNAME: 'JOB', FIELDNAME: 'DEPTID', EOCC_CRITERIA_SYM: 'H' }), 'JOB.DEPTID contains value');
});
