import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, UnsupportedPeopleCodeError } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 170: a native `Declare Function ... Library` (29329) -- its
 * statement bytes, and its parameter types appended to the program's
 * descriptor pool: PeopleCode types | 0xC0000000 closed by 7, then native
 * types (| 0x80000000 for Ref) closed by 0; header slot 21 counts them.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const declaration = 'Declare Function RegCloseKey Library "advapi32"\n   (long Value As number, ustring Ref As string) Returns long As number;';
const appClass = `class Demo\n   method Run();\nend-class;\n\n${declaration}\n\nmethod Run\n   &x = 1;\nend-method;\n`;

test('a native Declare Function writes its statement and its descriptor-pool arrays (29329)', () => {
  const { program } = encodeProgramArtifacts(appClass, { owner });
  const name = program.indexOf(Buffer.from('RegCloseKey\0', 'utf16le'));
  assert.deepEqual([...program.subarray(name - 3, name)], [0x31, 0x32, 0x0a]);
  assert.equal(program[name + 24], 0x33);
  const library = program.indexOf(Buffer.from('advapi32\0', 'utf16le'));
  assert.deepEqual([...program.subarray(library + 18, library + 21)], [0x41, 0x2d, 0x0b]);
  const slots = program.readUInt32LE(21);
  const pool = program.subarray(program.length - slots * 4);
  const tail = [...Array(6).keys()].map(i => pool.readUInt32LE(pool.length - 24 + i * 4));
  assert.deepEqual(tail, [0xc0000013, 0xc0000001, 7, 3, 0x8000000a, 0]);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program, 'roundtrip');
});

test('outside an Application Class program a native Declare Function stays unsupported (no evidence)', () => {
  assert.throws(() => encodeProgramArtifacts(`${declaration}\n`, { owner: { recordName: 'R', fieldName: 'F' } }), UnsupportedPeopleCodeError);
});
