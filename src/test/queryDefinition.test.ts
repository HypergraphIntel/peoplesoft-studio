import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderQuery } from '../model/queryDefinition.js';

const Q = { OPRID: ' ', QRYNAME: 'COMP_SRCH_TRW_CHILD1' };
const fld = (sel: number, n: number, rcd: number, name: string, col = 0, exp = 0, heading = ' ') =>
  ({ ...Q, SELNUM: sel, FLDNUM: n, FLDRCDNUM: rcd, FIELDNAME: name, COLUMNNUM: col, FLDEXPNUM: exp, HEADING: heading });

/** COMP_SRCH_TRW_CHILD1 on HRDMO, cut down: an outer join, a field-reference expression, constants, a subquery. */
const VIEW = {
  query: { ...Q, DESCR: 'Compensation - Total rewards', QRYTYPE: 1, VERSION: 1 },
  selects: [{ ...Q, SELNUM: 1, SELECTTYPE: 1, QRYDISTINCT: ' ' }, { ...Q, SELNUM: 2, SELECTTYPE: 2, QRYDISTINCT: ' ' }],
  records: [
    { ...Q, SELNUM: 1, RCDNUM: 1, RECNAME: 'TRW_STMT_NM_VW', CORRNAME: 'A', JOINTYPE: 1, JOINRCDNUM: 0 },
    { ...Q, SELNUM: 1, RCDNUM: 2, RECNAME: 'TRW_EE_STMT_SEC', CORRNAME: 'B', JOINTYPE: 5, JOINRCDNUM: 1 },
    { ...Q, SELNUM: 2, RCDNUM: 1, RECNAME: 'HR_SSTEXT_TEXT', CORRNAME: 'F', JOINTYPE: 1, JOINRCDNUM: 0 }
  ],
  fields: [
    fld(1, 1, 0, ' ', 2, 1, 'E.HR_SSTEXT_TEXT'), fld(1, 3, 1, 'EMPLID', 1), fld(1, 9, 1, 'TRW_STMT_ID'), fld(1, 10, 2, 'TRW_STMT_ID'),
    fld(1, 22, 2, 'HR_SSTEXT_TEXT'), fld(1, 19, 1, 'TEXT_ID'), fld(2, 1, 1, 'EFFDT')
  ],
  criteria: [
    { ...Q, SELNUM: 1, CRTNUM: 1, COMBTYPE: 3, CONDTYPE: 2, EXPRTYPE: 2, LCRTSELNUM: 1, LCRTFLDNUM: 9, R1CRTSELNUM: 1, R1CRTFLDNUM: 10, QRYOJSELNUM: 2, NEGATION: ' ' },
    { ...Q, SELNUM: 1, CRTNUM: 2, COMBTYPE: 1, CONDTYPE: 2, EXPRTYPE: 1, LCRTSELNUM: 1, LCRTFLDNUM: 19, R1CRTEXPNUM: 3, NEGATION: ' ', LPARENLVL: 1 },
    { ...Q, SELNUM: 1, CRTNUM: 3, COMBTYPE: 2, CONDTYPE: 13, EXPRTYPE: 4, R1CRTSELNUM: 2, NEGATION: ' ', RPARENLVL: 1 },
    { ...Q, SELNUM: 2, CRTNUM: 1, COMBTYPE: 3, CONDTYPE: 20, EXPRTYPE: 6, LCRTSELNUM: 2, LCRTFLDNUM: 1, NEGATION: ' ' }
  ],
  expressions: [{ ...Q, EXPNUM: 1, EXPRESSIONTEXT: ':%1.22' }, { ...Q, EXPNUM: 3, EXPRESSIONTEXT: ' ' }],
  binds: [{ ...Q, BNDNUM: 1, BNDNAME: 'CALRUN', FIELDNAME: 'CAL_RUN_ID', HEADING: 'Calendar Group', EDITTABLE: 'GPBR_CAL_RUN_VW', QRYREQUIREDPROMPT: 'Y' }]
};

test('a query: records and joins, columns, prompts, criteria in Query Manager\'s words, subqueries', () => {
  const text = renderQuery('COMP_SRCH_TRW_CHILD1', VIEW);
  assert.match(text, /Public {3}Type: User/);
  assert.match(text, /:1 {2}CALRUN +CAL_RUN_ID +"Calendar Group" {2}prompt table GPBR_CAL_RUN_VW {2}required/);
  assert.match(text, /B {3}TRW_EE_STMT_SEC {2}Left Outer Join to A/);
  // The expression column resolves ":%1.22" to select 1's field 22.
  assert.match(text, / {6}2 {2}B\.HR_SSTEXT_TEXT +"E\.HR_SSTEXT_TEXT"/);
  assert.match(text, /WHERE A\.TRW_STMT_ID equal to B\.TRW_STMT_ID {2}\(ON B\)/);
  // A blank constant keeps its space.
  assert.match(text, /AND {3}\(A\.TEXT_ID equal to ' '\n/);
  assert.match(text, /OR {4}does not exist \(Subquery 2\)\)/);
  assert.match(text, /Subquery 2\n {4}Records\n {6}F {3}HR_SSTEXT_TEXT\n {4}Criteria\n {6}WHERE F\.EFFDT Eff Date <= Current Date/);
});

test('a private query names its owner', () => {
  assert.match(renderQuery('MYQ', { ...VIEW, query: { ...VIEW.query, OPRID: 'JARED' } }), /Private \(JARED\)/);
});
