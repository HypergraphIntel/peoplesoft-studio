import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const roundtrips = (source: string, context: Record<string, unknown> = {}) => {
  const { program, references } = encodeProgramArtifacts(source, { owner, ...context });
  const names = new NameTable();
  references.forEach(reference => names.add(reference.index + 1, ''));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(token => token.opcode).filter(opcode => opcode === 0x24 || opcode === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes, ...context }).program, program);
  return program;
};

/*
 * Cycle 140: between two implementations a directive's records end the
 * blank-line run before them -- only blank lines after the gap's last
 * directive are 0x4F markers. 29724 / 29734 `end-get;` <blank> `#If ...
 * #Then` `get ConfirmationWithReport` store `6A 15 2D 75 .. 76 5F`, and
 * `#End-If;` <blank> `method saveData` `78 .. 15 4F 63`.
 */
const directiveSource = `class Demo
   property string A get;
   property boolean B get;
   method C();
end-class;

get A
   /+ Returns String +/
   Return "a";
end-get;

#If #ToolsRel >= "8.55" #Then
   get B
      /+ Returns Boolean +/
      Return True;
   end-get;
#End-If;

method C
end-method;
`;

test('a blank line before a directive between implementations is no marker; one after the last directive is (29724)', () => {
  const program = roundtrips(directiveSource, { conditionalCompilation: { toolsRelease: '8.61' } });
  const closer = Buffer.from([0x6a, 0x15, 0x2d]);
  const first = program.indexOf(closer);
  assert.equal(program[first + 3], 0x75);
  const second = program.indexOf(closer, first + 1);
  assert.equal(program[second + 3], 0x78);
  const endIf = program.indexOf(Buffer.from([0x15, 0x4f, 0x63, 0x41]), second);
  assert.ok(endIf > second);
});
