import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 145: a method call on a receiver declared with a `%metadata` system
 * class uses no PACKAGE row in ordinary PeopleCode (its declaration and its
 * `create` still do); a source package class's receiver call does. 16085
 * `&srcDefn = &m_mgr.GetDefnToUpdate(&key1);` stores no MACRODEFN_MANAGER
 * row for the call.
 */
const owner = { recordName: 'R', fieldName: 'F' };
const keys = (references: readonly any[]) => references
  .filter(r => r.kind === 'package' || r.kind === 'record')
  .map(r => r.kind === 'package' ? `PACKAGE.${r.packageName}` : `RECORD.${r.recordName}`);
const recordOperandMatchesRow = (program: Buffer, references: readonly any[]) => {
  const index = references.findIndex(r => r.kind === 'record');
  return program.includes(Buffer.from([0x21, index & 0xff, index >> 8]));
};

test('a %metadata receiver\'s method call uses no row (16085)', () => {
  const { program, references } = encodeProgramArtifacts(
    'Local %metadata:MacroDefn:MacroDefn_Manager &m;\n&m = create %metadata:MacroDefn:MacroDefn_Manager();\n&d = &m.GetDefn(&k);\n&r = CreateRecord(Record.PSOPRDEFN);\n',
    { owner }
  );
  assert.deepEqual(keys(references), ['PACKAGE.MACRODEFN_MANAGER', 'PACKAGE.MACRODEFN_MANAGER', 'RECORD.PSOPRDEFN']);
  assert.ok(recordOperandMatchesRow(program, references));
});

test('a package class receiver\'s method call uses its row in its unit (control)', () => {
  const { program, references } = encodeProgramArtifacts(
    'Local PKG:Mgr &m;\n&m = create PKG:Mgr();\n&d = &m.GetDefn(&k);\n&r = CreateRecord(Record.PSOPRDEFN);\n',
    { owner }
  );
  assert.deepEqual(keys(references), ['PACKAGE.MGR', 'PACKAGE.MGR', 'PACKAGE.MGR', 'RECORD.PSOPRDEFN']);
  assert.ok(recordOperandMatchesRow(program, references));
});
