import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 139: a block comment ending an Application Class implementation's
 * header line is the header's: an inline 0x4E before the header's 0x2D.
 * 29320 `method ParentalLeave /* constructor *\/` stores `63 41 <name> 4E
 * 2D`; 29724 `get IsUpdatableReport /* Sets if report ... *\/` `5F 41
 * <name> 4E 2D` (all 10 such headers in the corpus). The `/+ ... +/`
 * signature annotations after it stay 0x6D; a comment on its own line
 * below the header stays a body 0x24.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const source = `class Demo
   method Demo();
   property boolean IsReady get;
end-class;

method Demo /* constructor */
   %This.Run();
end-method;

get IsReady /* Sets if ready */
   /+ Returns Boolean +/
   /* own-line comment */
   Return True;
end-get;
`;
const comment = (opcode: number, text: string) => {
  const payload = Buffer.from(text, 'utf16le');
  const header = Buffer.from([opcode, 0, 0]);
  header.writeUInt16LE(payload.length, 1);
  return Buffer.concat([header, payload]);
};
const name = (text: string) => Buffer.concat([Buffer.from([0x0a]), Buffer.from(`${text}\0`, 'utf16le')]);

test('a comment ending a method or getter header line is a 0x4E before the header 0x2D (29320, 29724)', () => {
  const { program } = encodeProgramArtifacts(source, { owner });
  assert.ok(program.includes(Buffer.concat([Buffer.from([0x63, 0x41]), name('Demo'), comment(0x4e, '/* constructor */'), Buffer.from([0x2d])])));
  assert.ok(program.includes(Buffer.concat([Buffer.from([0x5f, 0x41]), name('IsReady'), comment(0x4e, '/* Sets if ready */'), Buffer.from([0x2d])])));
  // the signature annotation stays 0x6D, the own-line comment a body 0x24
  assert.ok(program.includes(Buffer.concat([comment(0x4e, '/* Sets if ready */'), Buffer.from([0x2d, 0x6d])])));
  assert.ok(program.includes(comment(0x24, '/* own-line comment */')));
});

test('the header comment survives a decode / re-encode roundtrip', () => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  references.forEach(reference => names.add(reference.index + 1, ''));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  assert.match(decoded.text, /^method Demo \/\* constructor \*\/$/m);
  assert.match(decoded.text, /^get IsReady \/\* Sets if ready \*\/$/m);
  const commentOpcodes = decoded.tokens.map(token => token.opcode).filter(opcode => opcode === 0x24 || opcode === 0x4e);
  const reencoded = encodeProgramArtifacts(decoded.text, { owner, commentOpcodes });
  assert.deepEqual(reencoded.program, program);
});
