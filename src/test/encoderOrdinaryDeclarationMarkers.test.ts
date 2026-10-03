import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 141: who owns the 0x2D (a declaration section's close) and the
 * 0x4F (a preserved blank line) between ordinary leading-section
 * declarations. Each fixture is a corpus shape; the stored token sequence
 * is asserted, and decode -> re-encode reproduces the bytes.
 */
const owner = { recordName: 'R', fieldName: 'F' };
const tokens = (source: string): string => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  references.forEach(reference => names.add(reference.index + 1, reference.kind === 'owner' ? 'R.F' : `X${reference.index}.Y`));
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(token => token.opcode).filter(opcode => opcode === 0x24 || opcode === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program);
  return decoded.tokens.map(token => token.opcode.toString(16).padStart(2, '0')).join(' ');
};

test('a block comment closing the import section restarts the Local run: its close is 0x2D (25056, 21271)', () => {
  // import ; 2D 4F /* c */ Local string &s ; 2D 4F &s = ...
  assert.match(tokens('import P:C;\n\n/* c */\nLocal string &s;\n\n&s = "x";\n'), / 44 40 01 15 2d 4f 01 06 /);
});

test('a blank line before a Constant is a 0x4F, no 0x2D (18130, 28555)', () => {
  // Component ... ; 4F Constant ...
  assert.match(tokens('Component string &c;\n\nConstant &K = "x";\n\n&c = &K;\n'), / 54 40 01 15 4f 56 /);
});

test('a REM closing a run with an App Class Local closes the section once (9986)', () => {
  // ...Local P:C &b ; 2D 4F REM 4F /* c */ Function -- no second 2D
  assert.match(
    tokens('import P:C;\n\nLocal string &a;\nLocal P:C &b;\n\nREM x;\n\n/* c */\nFunction F()\n   &b = create P:C();\nEnd-Function;\n'),
    / 01 15 2d 4f 24 4f 24 32 /
  );
});

test('disabled code closing the declaration section also closes an App Class Local section (14356)', () => {
  // ...Local P:C &b ; 2D 4F <* *> 4F Function -- no second 2D
  assert.match(
    tokens('import P:C;\n\nComponent string &c;\nLocal P:C &b;\n\n<* x *>\n\nFunction F()\n   &b = create P:C();\nEnd-Function;\n'),
    / 01 15 2d 4f 55 4f 32 /
  );
});

test('a declaration after a REM still continues the run: no close before the comments (4348)', () => {
  // Local Rowset &r ; 4F /* c */ rem ... Global ... ; 2D 4F <exec>
  assert.match(
    tokens('Local Rowset &r;\n\n/* c */\nrem Global string &g;\nGlobal string &g;\n\n&r = CreateRowset(Record.PSOPRDEFN);\n'),
    / 01 15 4f 24 24 45 40 01 15 2d 4f 01 /
  );
});
