import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 150: off a Row value, a member followed by `(` that is not a Row
 * method is the Row's child rowset by scroll name: a SCROLL row bound with
 * a 0x4A operand, one per allocation unit (2685
 * `GetLevel0().GetRow(CurrentRowNumber(0)).CENTR_DATA_BRA (CurrentRowNumber(1))
 * .GetRowset(Scroll.CENTR_DTL_BRA)`; 6084, where the same name is also a
 * `Record.` argument).
 */
const owner = { recordName: 'CENTR_DATA_BRA', fieldName: 'PROCESS_TYPE_BRA' };

const keyOf = (r: any): string => {
  switch (r.kind) {
    case 'scroll': return `SCROLL.${r.recordName}`.toUpperCase();
    case 'record': return `RECORD.${r.recordName}`.toUpperCase();
    case 'package': return `PACKAGE.${r.packageName}`.toUpperCase();
    case 'field': return `FIELD.${r.fieldName}`.toUpperCase();
    default: return `${r.recordName}.${r.fieldName}`.toUpperCase();
  }
};

const encode = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  references.forEach(r => names.add(r.index + 1, keyOf(r)));
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program, 'roundtrip');
  const operands = decoded.tokens
    .filter(t => t.opcode === 0x4a || t.opcode === 0x21)
    .map(t => `${t.opcode.toString(16)} ${names.get(t.nameNum!)} #${t.nameNum}`);
  return { keys: references.map(keyOf), operands };
};

test('a Row\'s child-rowset shorthand binds a SCROLL row before the explicit Scroll.X (2685)', () => {
  const { keys, operands } = encode(`Local Rowset &EstabRS;
&EstabRS = GetLevel0().GetRow(CurrentRowNumber(0)).CENTR_DATA_BRA (CurrentRowNumber(1)).GetRowset(Scroll.CENTR_DTL_BRA);
`);
  assert.deepEqual(keys, ['CENTR_DATA_BRA.PROCESS_TYPE_BRA', 'PACKAGE.ROWSET', 'SCROLL.CENTR_DATA_BRA', 'SCROLL.CENTR_DTL_BRA']);
  assert.deepEqual(operands, ['4a SCROLL.CENTR_DATA_BRA #3', '21 SCROLL.CENTR_DTL_BRA #4']);
});

test('chained shorthand scrolls are SCROLL rows even where the name is also a Record argument (6084)', () => {
  const { keys, operands } = encode(`If &x Then
   &v = FetchValue(Record.GB_GROUP_TBL, &ROW_L1, Record.GB_WHERE_TBL, &ROW_L2, GB_WHERE_TBL.GB_FROMCRIT_SW);
   &rsL3 = GetLevel0()(1).GB_GROUP_TBL (&ROW_L1).GB_WHERE_TBL (&ROW_L2).GetRowset(Scroll.GB_VALUES_TBL);
End-If;
`);
  assert.deepEqual(keys.slice(1), ['RECORD.GB_GROUP_TBL', 'RECORD.GB_WHERE_TBL', 'GB_WHERE_TBL.GB_FROMCRIT_SW',
    'SCROLL.GB_GROUP_TBL', 'SCROLL.GB_WHERE_TBL', 'SCROLL.GB_VALUES_TBL']);
  assert.deepEqual(operands.slice(-3), ['4a SCROLL.GB_GROUP_TBL #5', '4a SCROLL.GB_WHERE_TBL #6', '21 SCROLL.GB_VALUES_TBL #7']);
});

test('the same shorthand scroll twice in one unit is one row, in two units two rows', () => {
  const one = encode(`If &x Then
   &a = GetLevel0()(1).GB_GROUP_TBL (1).GetRowset(Scroll.GB_WHERE_TBL);
   &b = GetLevel0()(1).GB_GROUP_TBL (2).GetRowset(Scroll.GB_WHERE_TBL);
End-If;
`);
  assert.equal(one.keys.filter(k => k === 'SCROLL.GB_GROUP_TBL').length, 1);
  const two = encode(`&a = GetLevel0()(1).GB_GROUP_TBL (1).GetRowset(Scroll.GB_WHERE_TBL);
&b = GetLevel0()(1).GB_GROUP_TBL (2).GetRowset(Scroll.GB_WHERE_TBL);
`);
  assert.equal(two.keys.filter(k => k === 'SCROLL.GB_GROUP_TBL').length, 2);
  assert.deepEqual(two.operands.filter(o => o.startsWith('4a')).map(o => o.split('#')[1]), ['2', '4']);
});

test('Row methods, in any case, allocate no SCROLL row (control)', () => {
  const { keys } = encode(`Local Row &row;
&rec = &row.GETRECORD(Record.GB_GROUP_TBL);
&rs = GetLevel0()(1).GetRowset(Scroll.GB_WHERE_TBL);
&row.CopyTo(&row2);
`);
  assert.deepEqual(keys.filter(k => k.startsWith('SCROLL.')), ['SCROLL.GB_WHERE_TBL']);
});
