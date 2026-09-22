import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment, UnsupportedPeopleCodeError } from '../peoplecode/encoder.js';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { ProgramImage, compareBytes } from '../peoplecode/programImage.js';
import { ACTIVATE_BYTES } from './fixtures/compiledPeopleCode.js';

// Explicit expected source avoids a whitespace normalizer that corrupts strings
// or merely compares the decoder against itself.
for (const [source, expected] of [
  ['', ''], ['  \r\n', ''], [';', ';\n'], ['return ;', 'Return;\n'],
  ['Return true;', 'Return True;\n'], ['Return FALSE;', 'Return False;\n'],
  ['&flag=True; Return &flag;', '&flag = True;\nReturn &flag;\n'],
  ['&x = &y;', '&x = &y;\n'],
  ['&s=\'a "quote" and \'\'apostrophe\' ;', '&s = "a ""quote"" and \'apostrophe";\n'],
  ['Return "";', 'Return "";\n'],
  ['Return "£😀  x\ny";', 'Return "£😀  x\ny";\n'],
  ['Return """";', 'Return """";\n']
]) {
  test(`fragment semantic round trip: ${JSON.stringify(source)}`, () => {
    const bytes = encodeFragment(source);
    const decoded = decodeProgram(bytes, new NameTable(), { mode: 'strict' });
    assert.equal(decoded.text, expected);
    assert.deepEqual(encodeFragment(decoded.text), bytes);
  });
}

test('independent byte expectations for the supported operand shapes', () => {
  assert.deepEqual(encodeFragment('Return;'), Buffer.from([0x38, 0x15]));
  assert.deepEqual(encodeFragment('&x = "A"; Return False;'), Buffer.from([
    0x01, 0x26, 0, 0x78, 0, 0, 0, 0x06, 0x16, 0x41, 0, 0, 0, 0x15, 0x38, 0x30, 0x15
  ]));
});

for (const source of ['Return Null;', '&x = True And False;',
  'Foo;', 'Return "oops;',
  'Return "a\0b";', 'Return True', 'Return TrueValue;', '&x.y = False;',
  '/* comment */ Return;', '& = True;', '&x == True;', 'Return; garbage']) {
  test(`unsupported source fails explicitly: ${JSON.stringify(source)}`, () => {
    assert.throws(() => encodeFragment(source), (error: unknown) => {
      assert.ok(error instanceof UnsupportedPeopleCodeError);
      assert.ok(error.offset >= 0 && error.offset <= source.length);
      return true;
    });
  });
}

test('real PeopleSoft fixture decodes and replays with its name table', () => {
  const names = new NameTable();
  names.add(2, 'HTML.OU_OJ_LOAD_CSS');
  const image = new ProgramImage(ACTIVATE_BYTES, names);
  assert.equal(image.decode().text, 'AddOnLoadScript(GetHTMLText(HTML.OU_OJ_LOAD_CSS));\n');
  const replay = image.replay();
  assert.deepEqual(compareBytes(ACTIVATE_BYTES, replay.bytes), {
    equal: true, originalLength: 104, regeneratedLength: 104, differenceCount: 0, firstDifference: undefined
  });
  assert.deepEqual([...replay.names.entries()], [...names.entries()]);
});

test('opaque replay preserves unknown, malformed and trailer bytes without claiming understanding', () => {
  for (const bytes of [Buffer.from([0xff, 0x16, 1]), Buffer.from([0x38, 0x15, 0x2d, 0x07, 0xff]),
    Buffer.from([0x38, 0x15, 0x07, 0xff]), Buffer.from([0x63, 0x41, 0xff]), Buffer.alloc(0)]) {
    const image = new ProgramImage(bytes, new NameTable(), true);
    image.decode();
    assert.deepEqual(image.replay().bytes, bytes);
    assert.equal(image.replay().isApplicationClass, true);
  }
});

test('input buffers, names, decoded views and replay outputs cannot mutate the snapshot', () => {
  const bytes = Buffer.from([0x21, 0, 0, 0x15]);
  const names = new NameTable(); names.add(1, 'RECORD.FIELD');
  const image = new ProgramImage(bytes, names);
  bytes.fill(0); names.add(1, 'CHANGED');
  image.decode().tokens[0].text = 'CHANGED';
  const first = image.replay(); first.bytes.fill(0); first.names.add(1, 'CHANGED');
  assert.equal(image.decode().text, 'RECORD.FIELD;\n');
  assert.deepEqual(image.replay().bytes, Buffer.from([0x21, 0, 0, 0x15]));
});

test('binary diagnostics report changed bytes and length differences', () => {
  assert.deepEqual(compareBytes(Buffer.from([1, 2, 3]), Buffer.from([1, 4])), {
    equal: false, originalLength: 3, regeneratedLength: 2, differenceCount: 2, firstDifference: 1
  });
});

test('encodes Local boolean declaration with initializer', () => {
  const actual = encodeFragment('Local boolean &b = True;');

  const expected = Buffer.from(
    '444062006F006F006C00650061006E000000' +
    '01260062000000' +
    '062F15',
    'hex'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools Local boolean False fixture', () => {
  const expected = Buffer.from(
    'A0000000001D000000000000000000000000000000000000000000000000000000' +
    '85000000' +
    '444062006F006F006C00650061006E000000' +
    '01260062000000' +
    '06301507',
    'hex'
  );

  const actual = encodeProgram(
    'Local boolean &b = False;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools Local integer fixture', () => {
  const expected = Buffer.from(
    'A0000000002F00000000000000000000000000000000000000000000000000000085000000444069006E007400650067006500720000000126006900000006500000010000000000000000000000000000001507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &i = 1;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools integer 256/65536 fixture', () => {
  const expected = Buffer.from(
    'A0000000005D00000000000000000000000000000000000000000000000000000085000000444069006E0074006500670065007200000001260069000000065000000001000000000000000000000000000015444069006E007400650067006500720000000126006A00000006500000000001000000000000000000000000001507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &i = 256;\n' +
    'Local integer &j = 65536;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools string fixture', () => {
  const expected = Buffer.from(
    'A0000000006500000000000000000000000000000000000000000000000000000085000000444073007400720069006E00670000000126007300000006164100420043004400450046004700480049004A004B004C004D004E004F0050005100520053005400550056005700580059005A00310032003300340035003600370038003900300000001507',
    'hex'
  );

  const actual = encodeProgram(
    'Local string &s = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools escaped string fixture', () => {
  const expected = Buffer.from(
    'A0000000003700000000000000000000000000000000000000000000000000000085000000444073007400720069006E0067000000012600730000000616410042004300200022004400450046002200200047004800490000001507',
    'hex'
  );

  const actual = encodeProgram(
    'Local string &s = "ABC ""DEF"" GHI";'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools negative integer fixture', () => {
  const expected = Buffer.from(
    'A0000000008E00000000000000000000000000000000000000000000000000000085000000444069006E0074006500670065007200000001260061000000060E5000000100000000000000000000000000000015444069006E0074006500670065007200000001260062000000060E5000000001000000000000000000000000000015444069006E0074006500670065007200000001260063000000060E500000000001000000000000000000000000001507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = - 1;\n' +
    'Local integer &b = - 256;\n' +
    'Local integer &c = - 65536;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools arithmetic fixture', () => {
  const expected = Buffer.from(
    'A0000000000901000000000000000000000000000000000000000000000000000085000000444069006E00740065006700650072000000012600610000000650000001000000000000000000000000000000135000000200000000000000000000000000000015444069006E0074006500670065007200000001260062000000065000000A0000000000000000000000000000000E5000000300000000000000000000000000000015444069006E007400650067006500720000000126006300000006500000040000000000000000000000000000000F5000000500000000000000000000000000000015444069006E0074006500670065007200000001260064000000065000001400000000000000000000000000000004500000040000000000000000000000000000001507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = 1 + 2;\n' +
    'Local integer &b = 10 - 3;\n' +
    'Local integer &c = 4 * 5;\n' +
    'Local integer &d = 20 / 4;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools grouped arithmetic fixture', () => {
  const expected = Buffer.from(
    'A0000000007501000000000000000000000000000000000000000000000000000085000000444069006E0074006500670065007200000001260061000000065000000100000000000000000000000000000013500000020000000000000000000000000000000F5000000300000000000000000000000000000015444069006E0074006500670065007200000001260062000000060B500000010000000000000000000000000000001350000002000000000000000000000000000000140F5000000300000000000000000000000000000015444069006E007400650067006500720000000126006300000006500000010000000000000000000000000000000F0B5000000200000000000000000000000000000013500000030000000000000000000000000000001415444069006E0074006500670065007200000001260064000000060B500000010000000000000000000000000000001350000002000000000000000000000000000000140F0B500000030000000000000000000000000000001350000004000000000000000000000000000000141507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = 1 + 2 * 3;\n' +
    'Local integer &b = (1 + 2) * 3;\n' +
    'Local integer &c = 1 * (2 + 3);\n' +
    'Local integer &d = (1 + 2) * (3 + 4);'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools assignment fixture', () => {
  const expected = Buffer.from(
    'A0000000006500000000000000000000000000000000000000000000000000000085000000444069006E007400650067006500720000000126006100000015444069006E0074006500670065007200000001260062000000065000000A000000000000000000000000000000150126006100000006500000010000000000000000000000000000001507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a;\n' +
    'Local integer &b = 10;\n' +
    '&a = 1;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools function call fixture', () => {
  const expected = Buffer.from(
    'A0000000005000000000000000000000000000000000000000000000000000000085000000444073007400720069006E0067000000012600730000000616410042004300000015444069006E007400650067006500720000000126006E000000060A4C0065006E0000000B01260073000000141507',
    'hex'
  );

  const actual = encodeProgram(
    'Local string &s = "ABC";\n' +
    'Local integer &n = Len(&s);'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools multi-argument call fixture', () => {
  const expected = Buffer.from(
    'A0000000008A00000000000000000000000000000000000000000000000000000085000000444073007400720069006E00670000000126007300000006164100420043004400450046004700000015444073007400720069006E006700000001260078000000060A53007500620073007400720069006E00670000000B0126007300000003500000020000000000000000000000000000000350000003000000000000000000000000000000141507',
    'hex'
  );

  const actual = encodeProgram(
    'Local string &s = "ABCDEFG";\n' +
    'Local string &x = Substring(&s, 2, 3);'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools comparison fixture', () => {
  const expected = Buffer.from(
    'A0000000009901000000000000000000000000000000000000000000000000000085000000444062006F006F006C00650061006E00000001260061000000060B5000000100000000000000000000000000000006500000010000000000000000000000000000001415444062006F006F006C00650061006E00000001260062000000060B5000000100000000000000000000000000000010500000020000000000000000000000000000001415444062006F006F006C00650061006E00000001260063000000060B500000010000000000000000000000000000000D500000020000000000000000000000000000001415444062006F006F006C00650061006E00000001260064000000060B500000010000000000000000000000000000000C500000020000000000000000000000000000001415444062006F006F006C00650061006E00000001260065000000060B5000000200000000000000000000000000000009500000010000000000000000000000000000001415444062006F006F006C00650061006E00000001260066000000060B500000020000000000000000000000000000000850000001000000000000000000000000000000141507',
    'hex'
  );

  const actual = encodeProgram(
    'Local boolean &a = (1 = 1);\n' +
    'Local boolean &b = (1 <> 2);\n' +
    'Local boolean &c = (1 < 2);\n' +
    'Local boolean &d = (1 <= 2);\n' +
    'Local boolean &e = (2 > 1);\n' +
    'Local boolean &f = (2 >= 1);'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools chained boolean expression fixture', () => {
  const expected = Buffer.from(
    'A0000000009500000000000000000000000000000000000000000000000000000085000000444062006F006F006C00650061006E00000001260061000000060B2F411830182F421415444062006F006F006C00650061006E00000001260062000000060B2F411E301E2F421415444062006F006F006C00650061006E00000001260063000000060B2F41183042411E2F421415444062006F006F006C00650061006E00000001260064000000060B2F411E3041182F4242141507',
    'hex'
  );

  const actual = encodeProgram(
    'Local boolean &a = (True And False And True);\n' +
    'Local boolean &b = (True Or False Or True);\n' +
    'Local boolean &c = (True And False Or True);\n' +
    'Local boolean &d = (True Or False And True);'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools simple If fixture', () => {
  const expected = Buffer.from(
    'A0000000006A00000000000000000000000000000000000000000000000000000085000000444069006E00740065006700650072000000012600610000000650000001000000000000000000000000000000151C0126006100000006500000010000000000000000000000000000001F012600610000000650000002000000000000000000000000000000151A1507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = 1;\n' +
    'If &a = 1 Then\n' +
    '   &a = 2;\n' +
    'End-If;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools If/Else fixture', () => {
  const expected = Buffer.from(
    'A0000000008700000000000000000000000000000000000000000000000000000085000000444069006E00740065006700650072000000012600610000000650000001000000000000000000000000000000151C0126006100000006500000010000000000000000000000000000001F0126006100000006500000020000000000000000000000000000001519012600610000000650000003000000000000000000000000000000151A1507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = 1;\n' +
    'If &a = 1 Then\n' +
    '   &a = 2;\n' +
    'Else\n' +
    '   &a = 3;\n' +
    'End-If;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools nested If fixture', () => {
  const expected = Buffer.from(
    'A0000000008900000000000000000000000000000000000000000000000000000085000000444069006E00740065006700650072000000012600610000000650000001000000000000000000000000000000151C0126006100000006500000010000000000000000000000000000001F1C0126006100000006500000020000000000000000000000000000001F012600610000000650000003000000000000000000000000000000151A151A1507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = 1;\n' +
    'If &a = 1 Then\n' +
    '   If &a = 2 Then\n' +
    '      &a = 3;\n' +
    '   End-If;\n' +
    'End-If;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools Evaluate fixture', () => {
  const expected = Buffer.from(
    'A0000000006D000000000000000000000000000000000000000000000000000000850000003C01260061006E0079007400680069006E00670000003D164100620043006400450000002D2E153D500000D20400000000000000000000000000002D2E153D0B500000010000000000000000000000000000000650000002000000000000000000000000000000142D3E3F1507',
    'hex'
  );

  const actual = encodeProgram(
    'Evaluate &anything\n' +
    'When "AbCdE"\n' +
    '   Break;\n' +
    'When 1234\n' +
    '   Break;\n' +
    'When (1 = 2)\n' +
    'When-Other\n' +
    'End-Evaluate;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools While fixture', () => {
  const expected = Buffer.from(
    'A0000000007200000000000000000000000000000000000000000000000000000085000000444069006E007400650067006500720000000126006100000006500000010000000000000000000000000000001525012600610000000D5000000A0000000000000000000000000000002D012600610000000601260061000000135000000100000000000000000000000000000015261507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = 1;\n' +
    'While &a < 10\n' +
    '   &a = &a + 1;\n' +
    'End-While;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools nested If/Else fixture', () => {
  const expected = Buffer.from(
    'A000000000C300000000000000000000000000000000000000000000000000000085000000444069006E00740065006700650072000000012600610000000650000001000000000000000000000000000000151C0126006100000006500000010000000000000000000000000000001F01260061000000065000000200000000000000000000000000000015191C0126006100000006500000020000000000000000000000000000001F0126006100000006500000030000000000000000000000000000001519012600610000000650000004000000000000000000000000000000151A151A1507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = 1;\n' +
    'If &a = 1 Then\n' +
    '   &a = 2;\n' +
    'Else\n' +
    '   If &a = 2 Then\n' +
    '      &a = 3;\n' +
    '   Else\n' +
    '      &a = 4;\n' +
    '   End-If;\n' +
    'End-If;'
  );

  assert.deepEqual(actual, expected);
});

test.skip('TODO: 0x4F marker : encodeProgram exactly reproduces PeopleTools variable assignment fixture', () => {
  const expected = Buffer.from(
    'A000000000B400000000000000000000000000000000000000000000000000000085000000444069006E0074006500670065007200000001260061000000065000000A00000000000000000000000000000015444069006E0074006500670065007200000001260062000000065000001400000000000000000000000000000015444069006E0074006500670065007200000001260063000000154F0126006300000006012600610000001301260062000000150126006100000006012600630000000F500000020000000000000000000000000000001507',
    'hex'
  );

  const actual = encodeProgram(
    'Local integer &a = 10;\n' +
    'Local integer &b = 20;\n' +
    'Local integer &c;\n' +
    '\n' +
    '&c = &a + &b;\n' +
    '&a = &c * 2;'
  );

  assert.deepEqual(actual, expected);
});


