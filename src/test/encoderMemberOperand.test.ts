import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 134: a bare chain member is a reference operand (0x4A) when the
 * value before it is statically typed Row / Record, and an inline name
 * (0x0A) when the chain is late-bound -- whether or not a reference row
 * of that name already exists.
 */
const inlineName = (program: Buffer, name: string): boolean =>
  program.includes(Buffer.concat([Buffer.from([0x0a]), Buffer.from(`${name}\0`, 'utf16le')]));
const owner = { recordName: 'PKG', fieldName: 'Demo', packagePath: ['PKG', 'Demo'] };
const method = (body: string, declarations = ''): string =>
  `class Demo\n   method Run();\nend-class;\n${declarations}\nmethod Run\n${body}\nend-method;\n`;

test('GetCurrEffRow() returns a Row: its member is a RECORD reference (5758)', () => {
  const { program, references } = encodeProgramArtifacts('Local Rowset &rs;\n&x = &rs.GetCurrEffRow().PERS_DATA_EFFDT.SEX.Value;\n');
  assert.equal(inlineName(program, 'PERS_DATA_EFFDT'), false);
  assert.ok(references.some(r => r.kind === 'record' && r.recordName === 'PERS_DATA_EFFDT'));
});

test('ParentRecord returns a Record: a field member is a FIELD reference (29140)', () => {
  const { program, references } = encodeProgramArtifacts('Local Field &fld;\n&fld.ParentRecord.CAF_ACCESS_LVL_VAL.Visible = True;\n');
  assert.equal(inlineName(program, 'CAF_ACCESS_LVL_VAL'), false);
  assert.ok(references.some(r => r.kind === 'field' && r.fieldName === 'CAF_ACCESS_LVL_VAL'));
});

test('a Record property after ParentRecord stays inline', () => {
  assert.equal(inlineName(encodeProgramArtifacts('Local Field &fld;\n&x = &fld.ParentRecord.Name;\n').program, 'Name'), true);
});

test('an indexed Global array of Record in an Application Class is a Record (28764)', () => {
  const source = method('   &PMN_AllHomeStates [1].RUN_CNTL_ID.Value = "";', '\nGlobal array of Record &PMN_AllHomeStates;\n');
  assert.equal(inlineName(encodeProgramArtifacts(source, { owner }).program, 'RUN_CNTL_ID'), false);
});

for (const [type, inline] of [['any', true], ['Rowset', false]] as const) {
  test(`a ${type} root's GetRow() member ${inline ? 'stays inline' : 'is a reference'} even with that RECORD row already present (29921)`, () => {
    const source = method(`   Local ${type} &tempRowset;\n   Local Record &r = CreateRecord(Record.PTAL_PAGELET);\n   &x = &tempRowset.GetRow(1).PTAL_PAGELET;`);
    assert.equal(inlineName(encodeProgramArtifacts(source, { owner }).program, 'PTAL_PAGELET'), inline);
  });
}
