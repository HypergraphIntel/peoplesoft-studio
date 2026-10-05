import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 171: an interface (or class) whose `end-interface` has no `;` and
 * ends the program is written bare (`71 07`), and the compiler never
 * registers its methods: no method directory record, though the method's
 * signature slots remain (30162; pspcm.dll 8.61.15 returns before the
 * `;`-gated member registration).
 */
const owner = { recordName: 'PKG', fieldName: 'Api', packagePath: ['PKG', 'Api'] };
const encode = (closer: string) => {
  const source = `interface Api\n   method Get(&a As string) Returns string;\n${closer}\n`;
  const { program } = encodeProgramArtifacts(source, { owner });
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program, 'roundtrip');
  return program;
};

test('an unterminated end-interface at EOF is a bare closer with no method record (30162)', () => {
  const program = encode('end-interface');
  assert.equal(program.readUInt32LE(29), 1, 'directory records: self only');
  assert.equal(program.readUInt32LE(21), 2, 'signature slots kept');
  assert.ok(program.includes(Buffer.from([0x71, 0x07])));
});

test('a terminated end-interface registers its method (control)', () => {
  const program = encode('end-interface;');
  assert.equal(program.readUInt32LE(29), 2);
  assert.equal(program.readUInt32LE(21), 2);
  assert.ok(program.includes(Buffer.from([0x71, 0x15, 0x2d])));
});
