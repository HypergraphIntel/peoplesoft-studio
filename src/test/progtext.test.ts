import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleProgram, NameTable, NameResolutionError } from '../peoplecode/progtext.js';
import { decodeProgram } from '../peoplecode/decoder.js';

test('program chunks are concatenated in PROGSEQ order, not arrival order', () => {
  const bytes = assembleProgram([
    { seq: 2, data: Buffer.from([0x03]) },
    { seq: 0, data: Buffer.from([0x01]) },
    { seq: 1, data: Buffer.from([0x02]) }
  ]);
  assert.deepEqual([...bytes], [0x01, 0x02, 0x03]);
});

test('a missing PROGSEQ is an error, never a silently truncated program', () => {
  assert.throws(
    () => assembleProgram([
      { seq: 0, data: Buffer.from([0x01]) },
      { seq: 2, data: Buffer.from([0x03]) }
    ]),
    /gap at PROGSEQ 1/);
});

test('an unresolvable name index reports the drift instead of returning a guess', () => {
  const names = new NameTable();
  names.add(1, 'JOB');
  assert.throws(() => names.get(7), NameResolutionError);
});

test('the name table trims the trailing blanks PeopleTools pads PCNAME with', () => {
  const names = new NameTable();
  names.add(1, 'EFFDT      ');
  assert.equal(names.get(1), 'EFFDT');
});

test('unmapped opcodes are reported in the rendered source, not hidden', () => {
  const result = decodeProgram(Buffer.from([0xf1, 0xf2, 0x00]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 2);
  assert.match(result.text, /could not be fully decoded/);
  assert.match(result.text, /0xf1@0/);
});

test('strict mode refuses to render a program it cannot fully decode', () => {
  assert.throws(
    () => decodeProgram(Buffer.from([0xf1]), new NameTable(), { mode: 'strict' }),
    /Unmapped PeopleCode opcode 0xf1 at byte 0/);
});

test('raw mode lists the name table so the opcode map can be extended', () => {
  const names = new NameTable();
  names.add(1, 'JOB');
  const result = decodeProgram(Buffer.from([0x0a, 0x00]), names, { mode: 'raw' });
  assert.match(result.text, /1\tJOB/);
  assert.match(result.text, /0x0a/);
});

test('decoding stops at the end-of-program opcode', () => {
  const result = decodeProgram(Buffer.from([0x0a, 0x00, 0x0a]), new NameTable());
  assert.equal(result.text, '\n');
});
