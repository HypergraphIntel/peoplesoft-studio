import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const keyword = (text: string) => Buffer.concat([Buffer.from([0x40]), Buffer.from(`${text}\0`, 'utf16le')]);
const descriptor = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
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
 * Cycle 140: an untyped `array` in a class-header type -- `instance array
 * &x;` (28813), `Returns array` (28821), `&args As array` (29458), `array
 * of array` (29247) -- is the type keyword 0x40 like every stored `array`
 * (6,272, none inline), and its signature descriptor is `array of any`
 * (0x100004; `array of array` 0x200004). A variable named `&array` and a
 * class path stay what they are.
 */
const arraySource = `import PKG:*;

class Demo
   method Run(&args As array) Returns array of array;
   instance array &values;
   instance array of PKG:Item &items;
end-class;

method Run
   /+ &args as Array +/
   /+ Returns Array of Array +/
   Local array &array;
   Return &array;
end-method;
`;

test('an untyped array in a class-header type is the keyword 0x40, descriptor array of any (28813, 29247, 29458)', () => {
  const program = roundtrips(arraySource);
  for (const opcode of [0x35, 0x39, 0x62]) assert.ok(program.includes(Buffer.concat([Buffer.from([opcode]), keyword('array')])));
  assert.ok(program.includes(Buffer.concat([keyword('array'), keyword('of'), keyword('array')])));
  assert.ok(program.includes(descriptor(0x100004)));
  assert.ok(program.includes(descriptor(0x200004)));
  // controls: the `&array` variable and the `array of PKG:Item` class path
  assert.ok(program.includes(Buffer.concat([Buffer.from([0x01]), Buffer.from('&array\0', 'utf16le')])));
  assert.ok(program.includes(Buffer.concat([Buffer.from([0x0a]), Buffer.from('PKG\0', 'utf16le'), Buffer.from([0x57, 0x0a]), Buffer.from('Item\0', 'utf16le')])));
});
