import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 148: an indexed element of a `Global array of Record` is a Record,
 * so its bare member is a FIELD row -- as for a Local one (Cycle 45). The
 * symbolic `REC.FIELD` beside it keeps its RECORD.FIELD row
 * (24518 PSADS_WORK.LOADPRCSMONITORPB.FieldChange).
 */
const owner = { recordName: 'PSADS_WORK', fieldName: 'LOADPRCSMONITORPB' };
const source = `Declare Function Init_home_State PeopleCode FUNCLIB_PMN.FUNCLIB FieldFormula;

Global array of Record &PMN_AllHomeStates;

Init_home_State("Home", "Read-Write");
&PMN_AllHomeStates [&PMN_AllHomeStates.Len].RUN_CNTL_ID.Value = PSPRJDEFN_VW.PROJECTNAME.Value;
Transfer( False, MenuName.PROCESSMONITOR, BarName."INQUIRE", ItemName.PROCESSMONITOR, Panel.PMN_PRCSLIST, "U", &PMN_AllHomeStates [&PMN_AllHomeStates.Len]);
`;

const keyOf = (r: any): string => {
  switch (r.kind) {
    case 'package': return `PACKAGE.${r.packageName}`.toUpperCase();
    case 'field': return `FIELD.${r.fieldName}`.toUpperCase();
    case 'record': return `RECORD.${r.recordName}`.toUpperCase();
    default: return `${r.recordName}.${r.fieldName}`.toUpperCase();
  }
};

test('an indexed Global array-of-Record element member is a FIELD row; the symbolic REC.FIELD stays RECORD.FIELD (24518)', () => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  // the stored PSPCMNAME list of 24518, in order
  assert.deepEqual(references.map(keyOf), [
    'PSADS_WORK.LOADPRCSMONITORPB', 'FUNCLIB_PMN.FUNCLIB', 'PACKAGE.RECORD', 'FIELD.RUN_CNTL_ID',
    'PSPRJDEFN_VW.PROJECTNAME', 'MENUNAME.PROCESSMONITOR', 'BARNAME.INQUIRE', 'ITEMNAME.PROCESSMONITOR', 'PANEL.PMN_PRCSLIST'
  ]);
  assert.equal(references.filter(r => r.kind === 'field').length, 1);
  const names = new NameTable();
  references.forEach(r => names.add(r.index + 1, keyOf(r)));
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  // the FIELD operand (0x4A) and the symbolic / declared-function operands (0x21) bind their own rows
  const field = references.find(r => r.kind === 'field')!;
  assert.deepEqual(decoded.tokens.filter(t => t.opcode === 0x4a).map(t => t.nameNum), [field.index + 1]);
  const symbolic = references.filter(r => r.kind === 'record-field' || r.kind === 'declare-function');
  assert.deepEqual(decoded.tokens.filter(t => t.opcode === 0x21).map(t => t.nameNum), symbolic.map(r => r.index + 1));
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program);
});

test('a bare Global array-of-Record variable keeps .Len inline (control)', () => {
  const { references } = encodeProgramArtifacts(`Global array of Record &g;
Local number &n = &g.Len;
`, { owner });
  assert.equal(references.filter(r => r.kind === 'field').length, 0);
});
