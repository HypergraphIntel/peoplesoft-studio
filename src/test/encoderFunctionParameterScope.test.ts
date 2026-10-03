import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 151: ordinary Function parameters and declaration scope.
 */
const owner = { recordName: 'PAY_LINE', fieldName: 'EMPLID' };

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

test('an `As array of Record` parameter\'s indexed element member is a FIELD row (16720, 28683)', () => {
  const { keys, operands } = encode(`Function F(&arr As array of Record)
   &x = &arr [1].PTPROPNAME.Value;
End-Function;
`);
  // Cycle 152: the header also opens the Record row
  assert.deepEqual(keys, ['PAY_LINE.EMPLID', 'PACKAGE.RECORD', 'FIELD.PTPROPNAME']);
  assert.deepEqual(operands, ['4a FIELD.PTPROPNAME #3']);
});

test('each Function header with `As array of Record` opens one PACKAGE.RECORD, shared with its other Record types (16720)', () => {
  const { keys } = encode(`Function A(&arr As array of Record, &name As string) Returns integer
   Local Record &r;
   &r = &arr [1];
   Return 0;
End-Function;

Function B(&arr As array of Record, &arr2 As array of Record) Returns array of Record
   Return &arr;
End-Function;
`);
  // A: header row, body Local's row (another unit); B: one header row for two parameters and the return
  assert.deepEqual(keys, ['PAY_LINE.EMPLID', 'PACKAGE.RECORD', 'PACKAGE.RECORD', 'PACKAGE.RECORD']);
});

test('a first-Function array parameter shares the leading section\'s Record row (4916)', () => {
  const { keys } = encode(`Local array of Record &arr;

Function A(&arr As array of Record)
   &x = &arr [1].FLD.Value;
End-Function;
`);
  assert.deepEqual(keys, ['PAY_LINE.EMPLID', 'PACKAGE.RECORD', 'FIELD.FLD']);
});

test('an untyped parameter shadows an outer Rowset: its chain stays inline (13657)', () => {
  const { keys } = encode(`Local Rowset &x;

Function F(&x)
   &x.GetRow(1).PORTAL_MEN2_WRK.MENULABEL.Visible = False;
End-Function;
`);
  assert.deepEqual(keys, ['PAY_LINE.EMPLID', 'PACKAGE.ROWSET']);
});

test('an untyped parameter shadows an outer Record: its bare members stay inline (11513)', () => {
  const { keys } = encode(`Local Record &rec;

Function F(&rec)
   If &rec.DED_TAKEN.IsChanged Then
      &rec.BEN_DED_STATUS.Value = "U";
   End-If;
End-Function;
`);
  assert.deepEqual(keys, ['PAY_LINE.EMPLID', 'PACKAGE.RECORD']);
});

test('a typed parameter of the same name keeps its own type (contrast)', () => {
  const { keys, operands } = encode(`Local Rowset &x;

Function F(&x As Rowset)
   &x.GetRow(1).PORTAL_MEN2_WRK.MENULABEL.Visible = False;
End-Function;
`);
  assert.deepEqual(keys, ['PAY_LINE.EMPLID', 'PACKAGE.ROWSET', 'RECORD.PORTAL_MEN2_WRK', 'FIELD.MENULABEL']);
  assert.deepEqual(operands, ['4a RECORD.PORTAL_MEN2_WRK #3', '4a FIELD.MENULABEL #4']);
});

test('after End-Function the outer declaration is visible again (restoration control)', () => {
  const { keys, operands } = encode(`Local Rowset &x;

Function F(&x)
   &x.GetRow(1).PORTAL_MEN2_WRK.MENULABEL.Visible = False;
End-Function;

&x.GetRow(1).PORTAL_MEN2_WRK.MENULABEL.Visible = True;
`);
  assert.deepEqual(keys, ['PAY_LINE.EMPLID', 'PACKAGE.ROWSET', 'RECORD.PORTAL_MEN2_WRK', 'FIELD.MENULABEL']);
  assert.deepEqual(operands, ['4a RECORD.PORTAL_MEN2_WRK #3', '4a FIELD.MENULABEL #4']);
});
