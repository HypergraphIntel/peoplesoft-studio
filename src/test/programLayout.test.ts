import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram, encodeProgram as legacyEncodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { readProgramLayout, encodeSimpleProgramHeader, UnsupportedProgramLayoutError } from '../peoplecode/programLayout.js';
import { ACTIVATE_BYTES, SIMPLE_PROGRAMS, DIRECTORY_PROGRAM } from './fixtures/compiledPeopleCode.js';

for (const fixture of SIMPLE_PROGRAMS) {
  test(`source regenerates full PeopleSoft bytes: ${fixture.key}`, () => {
    const original = Buffer.from(fixture.hex, 'hex');
    const regenerated = encodeProgram(fixture.source);
    assert.deepEqual(regenerated, original);
    const decoded = decodeProgram(original, new NameTable(), { mode: 'strict' });
    assert.equal(decoded.text.trim(), fixture.source);
    assert.deepEqual(encodeProgram(decoded.text), original);
    assert.deepEqual(readProgramLayout(regenerated), {
      format: 0x85,
      statements: { offset: 37, byteLength: original.length - 37 },
      names: { offset: original.length, byteLength: 0 },
      records: { offset: original.length, byteLength: 0 },
      slots: { offset: original.length, byteLength: 0 },
      recordCount: 0, slotCount: 0
    });
  });
}

test('real metadata-bearing fixture has independently verified section boundaries', () => {
  const layout = readProgramLayout(DIRECTORY_PROGRAM);
  assert.deepEqual(layout, {
    format: 0x85, statements: { offset: 37, byteLength: 112 },
    names: { offset: 149, byteLength: 24 }, records: { offset: 173, byteLength: 16 },
    slots: { offset: 189, byteLength: 4 }, recordCount: 1, slotCount: 1
  });
  assert.equal(DIRECTORY_PROGRAM.subarray(149, 171).toString('utf16le'), 'iScript_RPC');
  assert.deepEqual([...DIRECTORY_PROGRAM.subarray(173, 193)], [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 0
  ]);
  assert.equal(readProgramLayout(ACTIVATE_BYTES).statements.byteLength, 67);
});

test('complete program round trip includes strings, variables, booleans and multibyte lengths', () => {
  const source = `&value = "${'£😀'.repeat(80)}";\n&flag = True;\nReturn &value;\n`;
  const bytes = encodeProgram(source);
  const layout = readProgramLayout(bytes);
  assert.equal(layout.statements.byteLength, bytes.length - 37);
  assert.ok(layout.statements.byteLength > 255);
  assert.equal(decodeProgram(bytes, new NameTable(), { mode: 'strict' }).text, source);
  assert.deepEqual(legacyEncodeProgram(source), bytes);
});

test('section boundaries come from the header even when a string contains trailer-like bytes', () => {
  // U+072D contains the literal byte pair 2d 07. It is data, not a trailer.
  const bytes = encodeProgram('Return "\u072d";');
  assert.equal(readProgramLayout(bytes).names.offset, bytes.length);
  assert.equal(decodeProgram(bytes, new NameTable()).text, 'Return "\u072d";\n');
});

test('alternate observed format can be inspected without assuming its meaning', () => {
  const bytes = Buffer.from(ACTIVATE_BYTES); bytes.writeUInt32LE(0x84, 33);
  assert.equal(readProgramLayout(bytes).format, 0x84);
});

for (const [label, mutate] of [
  ['leading marker', (b: Buffer) => { b[0] = 0; }],
  ['unassigned word', (b: Buffer) => { b[9] = 1; }],
  ['unknown format', (b: Buffer) => { b[33] = 0x86; }],
  ['statement length', (b: Buffer) => { b.writeUInt32LE(0xffffffff, 5); }],
  ['empty statement section', (b: Buffer) => { b.writeUInt32LE(0, 5); }],
  ['odd name length', (b: Buffer) => { b.writeUInt32LE(1, 13); }],
  ['record count', (b: Buffer) => { b.writeUInt32LE(1, 29); }],
  ['slot count', (b: Buffer) => { b.writeUInt32LE(1, 21); }],
  ['separator', (b: Buffer) => { b[b.length - 1] = 0; }]
] as const) {
  test(`inconsistent/unsupported layout fails: ${label}`, () => {
    const bytes = encodeProgram('Return;'); mutate(bytes);
    assert.throws(() => readProgramLayout(bytes), UnsupportedProgramLayoutError);
  });
}

test('truncated and excess data fail rather than silently disappearing', () => {
  const bytes = encodeProgram('Return;');
  for (const size of [0, 1, 36, 37, 39]) {
    assert.throws(() => readProgramLayout(bytes.subarray(0, size)), UnsupportedProgramLayoutError);
  }
  assert.throws(() => readProgramLayout(Buffer.concat([bytes, Buffer.from([0])])), UnsupportedProgramLayoutError);
});

test('header writer checks numeric limits before writing', () => {
  for (const size of [-1, 0, 1.5, NaN, Infinity, 0x1000000, 0x100000000]) {
    assert.throws(() => encodeSimpleProgramHeader(size), UnsupportedProgramLayoutError);
  }
  for (const size of [1, 256, 65536, 0xffffff]) {
    assert.equal(encodeSimpleProgramHeader(size).readUInt32LE(5), size);
  }
});
