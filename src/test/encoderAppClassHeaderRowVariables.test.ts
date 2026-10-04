import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 161: a Row declared outside the method body -- header `instance
 * Row &x` / `property Row X` (`&X` in a body), top-level Global /
 * Component Row -- is a Row variable in every body, like a Record
 * (Cycle 120) or Rowset (Cycle 135): its bare record member is a RECORD
 * row (29457 `instance Row ... &rowTmplSec` ... `&rowTmplSec.GP_ABS_TXID_VW
 * .GP_ABS_CS_DESCR254.Label`, 29563 `&ThisRow.GP_CC_VW.PAY_ENTITY`, 28935
 * `property Row NewPlanRow` ... `&NewPlanRow.BAS_PAR_PLAN_VW`; 5 / 5
 * programs store it). Row properties stay inline; a parameter or Local of
 * the same name shadows it.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const keyOf = (r: any) => r.kind === 'owner' ? '' : r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'record' ? `RECORD.${r.recordName}` : r.kind === 'field' ? `FIELD.${r.fieldName}` : `${r.recordName}.${r.fieldName}`;
const encode = (header: string[], body: string[], parameters = '') => {
  const source = ['class Demo', `   method Run(${parameters});`, ...header.map(line => `   ${line}`), 'end-class;', '', 'method Run', ...body.map(line => `   ${line}`), 'end-method;', ''].join('\n');
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, keyOf(r));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  const operands = new Set(decoded.tokens.filter(t => t.opcode === 0x21 || t.opcode === 0x4a).map(t => t.nameNum));
  for (const r of references.filter(x => x.kind === 'record' || x.kind === 'field')) assert.ok(operands.has(r.index + 1), `operand for ${keyOf(r)}`);
  return references.filter(r => r.kind !== 'owner').map(r => `${r.index + 1}:${keyOf(r)}`);
};

test('an instance Row\'s record member is a RECORD row (29457 / 29563)', () => {
  assert.deepEqual(
    encode(['instance Row &rowTmplSec;'], ['&rowTmplSec.GP_ABS_TXID_VW.GP_ABS_CS_DESCR254.Label = "x";', '&a = &rowTmplSec.GP_ABS_TXID_VW.DESCR.Value;']),
    ['2:PACKAGE.ROW', '3:RECORD.GP_ABS_TXID_VW', '4:FIELD.GP_ABS_CS_DESCR254', '5:FIELD.DESCR']
  );
});

test('a Row property used as &Name is a Row (28935)', () => {
  assert.deepEqual(
    encode(['property Row NewPlanRow;'], ['Local Record &rcPlan = &NewPlanRow.BAS_PAR_PLAN_VW;']),
    ['2:PACKAGE.ROW', '3:PACKAGE.RECORD', '4:RECORD.BAS_PAR_PLAN_VW']
  );
});

test('Row properties stay inline; a parameter of the same name shadows it (controls)', () => {
  assert.deepEqual(encode(['instance Row &r;'], ['If &r.IsNew Then', '   &n = &r.RowNumber;', 'End-If;']), ['2:PACKAGE.ROW']);
  assert.deepEqual(encode(['instance Row &r;'], ['&a = &r.SOME_REC.SOME_FIELD;'], '&r As string'), ['2:PACKAGE.ROW']);
});
