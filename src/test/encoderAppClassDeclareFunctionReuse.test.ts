import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 161: an Application Class program has ONE row per REC.FIELD for
 * the whole program (1,510 programs, 1,823 REC.FIELD-shaped stored rows,
 * none repeated), whichever construct opens it -- so a static REC.FIELD
 * uses the row of the program's `Declare Function ... PeopleCode
 * REC.FIELD <event>` target: 28936 `W3EB_BENEF_SMRY.PLAN_TYPE`, 29193
 * `CAF_SRCH.CAF_SRCH_BTN.Visible` (two declarations of that target, one
 * row). Ordinary programs keep a separate row for the static reference
 * (383 / 383 programs with a non-owner target).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const keyOf = (r: any) => r.kind === 'owner' ? '' : r.kind === 'package' ? `PACKAGE.${r.packageName}` : `${r.recordName}.${r.fieldName}`;
const encode = (source: string, context: any) => {
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, keyOf(r));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: context.owner !== undefined });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { ...context, commentOpcodes }).program, program, 'roundtrip');
  const operands = decoded.tokens.filter(t => t.opcode === 0x21).map(t => t.nameNum);
  return { rows: references.filter(r => r.kind !== 'owner').map(r => `${r.index + 1}:${r.kind}:${keyOf(r)}`), operands };
};
const appClass = (body: string) => encode([
  'class Demo',
  '   method Run();',
  'end-class;',
  '',
  'Declare Function SetKey PeopleCode CAF_SRCH.CAF_SRCH_BTN FieldFormula;',
  'Declare Function IsAccessible PeopleCode CAF_SRCH.CAF_SRCH_BTN FieldFormula;',
  '',
  'method Run',
  body,
  'end-method;',
  ''
].join('\n'), { owner });

test('a static REC.FIELD uses the App Class Declare Function row of the same target (29193)', () => {
  const { rows, operands } = appClass('   CAF_SRCH.CAF_SRCH_BTN.Visible = True;\n   CAF_SRCH.CAF_SRCH_BTN.Visible = False;');
  assert.deepEqual(rows, ['2:declare-function:CAF_SRCH.CAF_SRCH_BTN']);
  // both declarations and both static uses write the same NAMENUM
  assert.deepEqual(operands, [2, 2, 2, 2]);
});

test('a different field or record of the declared target opens its own row (controls)', () => {
  assert.deepEqual(
    appClass('   CAF_SRCH.CAF_CLEAR.Visible = True;\n   CAF_SRCH2.CAF_SRCH_BTN.Visible = True;').rows,
    ['2:declare-function:CAF_SRCH.CAF_SRCH_BTN', '3:record-field:CAF_SRCH.CAF_CLEAR', '4:record-field:CAF_SRCH2.CAF_SRCH_BTN']
  );
});

test('without a Declare Function the static REC.FIELD opens its row (control)', () => {
  const { rows } = encode('class Demo\n   method Run();\nend-class;\n\nmethod Run\n   CAF_SRCH.CAF_SRCH_BTN.Visible = True;\nend-method;\n', { owner });
  assert.deepEqual(rows, ['2:record-field:CAF_SRCH.CAF_SRCH_BTN']);
});

test('an ordinary program keeps a separate row for the static reference (control)', () => {
  const { rows } = encode('Declare Function SetKey PeopleCode CAF_SRCH.CAF_SRCH_BTN FieldFormula;\n\nCAF_SRCH.CAF_SRCH_BTN.Visible = True;\n', { owner: { recordName: 'OWN_REC', fieldName: 'OWN_FLD' } });
  assert.deepEqual(rows, ['2:declare-function:CAF_SRCH.CAF_SRCH_BTN', '3:record-field:CAF_SRCH.CAF_SRCH_BTN']);
});
