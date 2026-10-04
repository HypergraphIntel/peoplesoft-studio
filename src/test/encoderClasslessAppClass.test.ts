import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 163: an Application Class definition whose source declares no
 * class at all (fully commented out: 29646 / 29670, and 29648 / 29672) is
 * still compiled as an Application Class program -- a blank owner row and
 * the self-only directory of an empty class (28770 `class
 * RelationSqlGenerator end-class;`): the self path as the one name-table
 * entry and one record `0 / 0 / 0x00400000 (self) / 7 (no type)`. Header:
 * statement length + 1 at 5, name bytes at 13, 0 slots at 21, 1 record at
 * 29, 0x85 at 33.
 */
const source = '/*\nimport OU_JET_PACK:Widgets:WelcomeBanner;\n*/\n';
const owner = { recordName: 'OU_JET_PACK', fieldName: 'Widgets', packagePath: ['OU_JET_PACK', 'Widgets', 'WidgetDispatcher'] };

test('a class-less Application Class definition gets the self-only directory (29646)', () => {
  const { program, references } = encodeProgramArtifacts(source, { owner, applicationClassDefinition: true });
  assert.deepEqual(references.map(r => [r.kind, r.recordName ?? '', r.fieldName ?? '']), [['owner', '', '']]);
  const self = Buffer.from('OU_JET_PACK:Widgets:WidgetDispatcher\0', 'utf16le');
  const record = Buffer.from('00000000000000000000400007000000', 'hex');
  assert.equal(program[0], 0xa0);
  assert.equal(program.readUInt32LE(13), self.length);
  assert.equal(program.readUInt32LE(21), 0);
  assert.equal(program.readUInt32LE(29), 1);
  assert.equal(program.readUInt32LE(33), 0x85);
  const statementsEnd = 37 + program.readUInt32LE(5) - 1;
  assert.equal(program[statementsEnd], 0x07);
  assert.deepEqual(program.subarray(statementsEnd + 1), Buffer.concat([self, record]));
});

test('without the definition flag the source stays an ordinary program (control)', () => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  // no directory: the program ends at its 0x07 separator
  assert.equal(program[program.length - 1], 0x07);
  assert.deepEqual(references.map(r => r.kind), ['owner']);
  assert.equal(references[0].recordName, 'OU_JET_PACK');
});

test('a definition that declares a class is unaffected by the flag (control)', () => {
  const real = 'class WidgetDispatcher\n   method Run();\nend-class;\n\nmethod Run\n   &x = 1;\nend-method;\n';
  assert.deepEqual(
    encodeProgramArtifacts(real, { owner, applicationClassDefinition: true }).program,
    encodeProgramArtifacts(real, { owner }).program
  );
});
