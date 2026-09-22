import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment, encodeProgram, UnsupportedPeopleCodeError } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { ProgramImage, compareBytes } from '../peoplecode/programImage.js';
import { readProgramLayout } from '../peoplecode/programLayout.js';
import { INTEGER_OPERANDS, ARITHMETIC_STATEMENTS, ASSIGNMENT_PROGRAMS } from './fixtures/numericPeopleCode.js';

for (const fixture of INTEGER_OPERANDS) {
  test(`integer operand matches captured bytes: ${fixture.value}`, () => {
    const fragment = encodeFragment(`Return ${fixture.value};`);
    assert.deepEqual(fragment.subarray(1, -1), Buffer.from(fixture.hex, 'hex'));
    assert.equal(decodeProgram(fragment, new NameTable(), { mode: 'strict' }).text, `Return ${fixture.value};\n`);
  });
}

for (const fixture of ARITHMETIC_STATEMENTS) {
  test(`arithmetic statement regenerates corpus slice: ${fixture.source}`, () => {
    const expected = Buffer.from(fixture.hex, 'hex');
    assert.deepEqual(encodeFragment(fixture.source), expected);
    const decoded = decodeProgram(expected, new NameTable(), { mode: 'strict' });
    assert.deepEqual(encodeFragment(decoded.text), expected);
  });
}

for (const fixture of ASSIGNMENT_PROGRAMS) {
  test(`complete assignment regenerates real program: ${fixture.key}`, () => {
    const original = Buffer.from(fixture.hex, 'hex');
    const generated = encodeProgram(fixture.source);
    assert.deepEqual(generated, original);
    assert.equal(decodeProgram(generated, new NameTable(), { mode: 'strict' }).text, fixture.source + '\n');
    assert.equal(readProgramLayout(generated).names.byteLength, 0);
    assert.deepEqual(encodeProgram(decodeProgram(original, new NameTable()).text), original);
  });
}

for (const [source, expected] of [
  ['&n=12+34*2-1/1;', '&n = 12 + 34 * 2 - 1 / 1;\n'],
  ['Return 0;', 'Return 0;\n'],
  ['Return 0000012;', 'Return 12;\n'],
  ['Return 0000;', 'Return 0;\n'],
  ['Return 1-2;', 'Return 1 - 2;\n'],
  ['Return 9007199254740993;', 'Return 9007199254740993;\n'],
  ['Return 340282366920938463463374607431768211455;', 'Return 340282366920938463463374607431768211455;\n'],
  ['&s = "1+2 / *"; Return &s;', '&s = "1+2 / *";\nReturn &s;\n']
]) {
  test(`complete numeric semantic round trip: ${source}`, () => {
    const bytes = encodeProgram(source);
    const decoded = decodeProgram(bytes, new NameTable(), { mode: 'strict' });
    assert.equal(decoded.text, expected);
    assert.deepEqual(encodeProgram(decoded.text), bytes);
  });
}

test('uint128 boundaries and precision use exact bytes rather than Number rounding', () => {
  const max = encodeFragment('Return 340282366920938463463374607431768211455;');
  assert.equal(max.subarray(1, -1).toString('hex'), '500000' + 'ff'.repeat(16));
  const precise = encodeFragment('Return 9007199254740993;');
  assert.equal(precise.subarray(1, -1).toString('hex'), '50000001000000000020000000000000000000');
  const zero = encodeFragment(`Return ${'0'.repeat(1000)};`);
  assert.equal(zero.subarray(1, -1).toString('hex'), '50' + '00'.repeat(18));
});

for (const source of [
  'Return 340282366920938463463374607431768211456;', // 2^128, no truncation/wrap
  `Return ${'9'.repeat(1000)};`,
  'Return 1.0;', 'Return .5;', 'Return 1e3;', 'Return 0x10;',
  'Return -1;', 'Return +1;', 'Return 1 + -2;', 'Return 1 ** 2;',
  'Return (1 + 2;', 'Return 1 +;', 'Return 1 /;', 'Return 1 2;',
  'Return 1abc;', 'Return 1_000;', 'Return 1 = 2;', 'Return 1 /* comment */;'
]) {
  test(`unsupported numeric/expression syntax fails: ${source.slice(0, 80)}`, () => {
    assert.throws(() => encodeProgram(source), UnsupportedPeopleCodeError);
  });
}

test('overflow diagnostic identifies the literal start', () => {
  assert.throws(() => encodeFragment('&n = 340282366920938463463374607431768211456;'), (error: unknown) => {
    assert.ok(error instanceof UnsupportedPeopleCodeError);
    assert.equal(error.offset, 5);
    assert.match(error.message, /128-bit/);
    return true;
  });
});

test('legacy 0x11 literals normalize diagnostically while opaque replay retains their encoding', () => {
  // Synthetic framing uses the decoder-confirmed 2000 legacy magnitude.
  const legacy = Buffer.from('381100000000d007000000000000000015', 'hex');
  const text = decodeProgram(legacy, new NameTable(), { mode: 'strict' }).text;
  assert.equal(text, 'Return 2000;\n');
  const canonical = encodeFragment(text);
  assert.equal(decodeProgram(canonical, new NameTable(), { mode: 'strict' }).text, text);
  const diagnostic = compareBytes(legacy, canonical);
  assert.equal(diagnostic.equal, false);
  assert.equal(diagnostic.firstDifference, 1);
  assert.equal(diagnostic.regeneratedLength - diagnostic.originalLength, 4);
  assert.deepEqual(new ProgramImage(legacy, new NameTable()).replay().bytes, legacy);
});
