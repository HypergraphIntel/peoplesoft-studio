import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 143: a REM comment starts at `rem` followed by anything that cannot
 * continue an identifier -- the ordinary encoder's `^(?:REM|remark)\b`
 * rule, now shared by the Application Class scanners. 28720's class header
 * `rem,yan add, set <Long Value> ...;` stores a 0x24 comment (text through
 * its `;`) before the next `method`; an empty `rem;` likewise (ordinary
 * 4849). Identifiers beginning with `rem` (28756 `RemoveTreeCTLH`) stay
 * names.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const source = `class Demo
   method Run();
   rem,yan add, set the value;
   method RemoveItem(&rs As Rowset);
   rem;
   method Other();
end-class;

method Run
   %This.RemoveItem(Null);
end-method;

method RemoveItem
   /+ &rs as Rowset +/
   &rs.DeleteRow(1);
end-method;

method Other
end-method;
`;

test('a class-header rem, / rem; comment is a 0x24 comment; a Remove... identifier stays a name (28720, 28756)', () => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  references.forEach(reference => names.add(reference.index + 1, ''));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const header = decoded.tokens.slice(0, decoded.tokens.findIndex(token => token.opcode === 0x5b));
  const shape = header.map(token => `${token.opcode.toString(16)}${token.opcode === 0x24 || token.opcode === 0x0a ? `:${token.text}` : ''}`);
  assert.deepEqual(shape.slice(shape.indexOf('24:rem,yan add, set the value;') - 1), [
    '15', '24:rem,yan add, set the value;',
    '63', 'a:RemoveItem', 'b', '1', '35', 'a:Rowset', '14', '15', '24:rem;',
    '63', 'a:Other', 'b', '14', '15'
  ]);
  const commentOpcodes = decoded.tokens.map(token => token.opcode).filter(opcode => opcode === 0x24 || opcode === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program);
});
