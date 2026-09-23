import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { ProgramImage, compareBytes } from '../peoplecode/programImage.js';
import { ACTIVATE_BYTES } from './fixtures/compiledPeopleCode.js';
import {
  source as offset179Source,
  program as offset179Program
} from './fixtures/corpusOffset179.js';
import {
  encodeFragment,
  UnsupportedPeopleCodeError,
  encodeProgram,
  encodeProgramArtifacts
} from '../peoplecode/encoder.js';

test('runtime-created Application Class methods preserve offset 179 metadata', () => {
  const encoded = encodeProgramArtifacts(offset179Source, {
    owner: {
      recordName: 'ABS_H_D_NLDSBR',
      fieldName: 'SAME_ADDRESS_EMPL'
    }
  });

  assert.deepStrictEqual(encoded.program, offset179Program);
  assert.equal(encoded.references.length, 13);
  assert.equal(encoded.references[12].kind, 'record');
  assert.equal(encoded.references[12].recordName, 'ABS_HIST_DET');
  assert.equal(encoded.references.some(ref => ref.methodName !== undefined), false);
});

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

test('encodeProgram preserves a leading block comment', () => {
  const source =
    '/*COMMENT123*/\n' +
    'Local string &TEST;\n\n' +
    '&TEST = "ABC";';

  const program = encodeProgram(source);

  const comment = Buffer.concat([
    Buffer.from([0x24, 0x1c, 0x00]),
    Buffer.from('/*COMMENT123*/', 'utf16le')
  ]);

  assert.notEqual(program.indexOf(comment), -1);
});

test('encodeProgram preserves a block comment between top-level statements', () => {
  const source =
    'Local string &TEST;\n\n' +
    '/*X*/\n\n' +
    '&TEST = "ABC";';

  const program = encodeProgram(source);

  const comment = Buffer.concat([
    Buffer.from([0x4f, 0x24, 0x0a, 0x00]),
    Buffer.from('/*X*/', 'utf16le')
  ]);

  assert.notEqual(program.indexOf(comment), -1);
});

test('adjacent block comments share the calibrated top-level boundary', () => {
  const source =
    'Local string &TEST;\n\n' +
    '/*A*/\n' +
    '/*B*/\n\n' +
    '&TEST = "ABC";';

  const expected = Buffer.concat([
    Buffer.from([0x4f]),

    Buffer.from([0x24, 0x0a, 0x00]),
    Buffer.from('/*A*/', 'utf16le'),

    Buffer.from([0x24, 0x0a, 0x00]),
    Buffer.from('/*B*/', 'utf16le')
  ]);

  const program = encodeProgram(source);

  assert.notEqual(program.indexOf(expected), -1);
});

test('independent byte expectations for the supported operand shapes', () => {
  assert.deepEqual(encodeFragment('Return;'), Buffer.from([0x38, 0x15]));
  assert.deepEqual(encodeFragment('&x = "A"; Return False;'), Buffer.from([
    0x01, 0x26, 0, 0x78, 0, 0, 0, 0x06, 0x16, 0x41, 0, 0, 0, 0x15, 0x38, 0x30, 0x15
  ]));
});

for (const source of [
  '&x = True And False;',
  'Foo;', 
  'Return "oops;',
  'Return "a\0b";', 
  'Return True', 
  'Return TrueValue;', 
  '& = True;', 
  '&x == True;', 
  'Return; garbage'
]) {
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

test('encodeProgram exactly reproduces PeopleTools For and Step fixture', () => {
  const expected = Buffer.from(
    'A0000000007F00000000000000000000000000000000000000000000000000000085000000290126006900000006500000010000000000000000000000000000002A5000000A0000000000000000000000000000002D2E152C15290126006900000006500000010000000000000000000000000000002A5000000A0000000000000000000000000000002B500000020000000000000000000000000000002D2E152C1507',
    'hex'
  );

  const actual = encodeProgram(
    'For &i = 1 To 10\n' +
    '   Break;\n' +
    'End-For;\n' +
    'For &i = 1 To 10 Step 2\n' +
    '   Break;\n' +
    'End-For;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeProgram exactly reproduces PeopleTools Repeat Until fixture', () => {
  const expected = Buffer.from(
    'A0000000000700000000000000000000000000000000000000000000000000000085000000272E15282F1507',
    'hex'
  );

  const actual = encodeProgram(
    'Repeat\n' +
    '   Break;\n' +
    'Until True;'
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

test('encodeProgram exactly reproduces PeopleTools try catch throw fixture', () => {
  const expected = Buffer.from(
    'A00000000007010000000000000000000000000000000000000000000000000000850000006501260069000000065000000100000000000000000000000000000015680A43007200650061007400650045007800630065007000740069006F006E0000000B5000000000000000000000000000000000000003500000000000000000000000000000000000000316540065007300740020003A00310000000316540065007300740000001415660A45007800630065007000740069006F006E000000012600650000002D0A570069006E004D0065007300730061006700650000000B5000000000000000000000000000000000000003500000000000000000000000000000000000000301260065000000050A54006F0053007400720069006E00670000000B141415671507',
    'hex'
  );

  const actual = encodeProgram(
    'try\n' +
    '   &i = 1;\n' +
    '   throw CreateException(0, 0, "Test :1", "Test");\n' +
    'catch Exception &e\n' +
    '   WinMessage(0, 0, &e.ToString());\n' +
    'end-try;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeFragment exactly reproduces Function Test executable bytes', () => {
  const expected = Buffer.from(
    '320A540065007300740000000B142D37152D',
    'hex'
  );

  const actual = encodeFragment(
    'Function Test()\n' +
    'End-Function;'
  );

  assert.deepEqual(actual, expected);
});

test('encodeFragment exactly reproduces AddNumbers Function executable bytes', () => {
  const source = `Function AddNumbers(&a As integer, &b As integer) Returns integer
   Local integer &result;
   
   &result = &a + &b;
   Return &result;
End-Function;`;

  const expected = Buffer.from(
    '320A4100640064004E0075006D0062006500720073000000' +
    '0B' +
    '01260061000000' +
    '35' +
    '4069006E00740065006700650072000000' +
    '03' +
    '01260062000000' +
    '35' +
    '4069006E00740065006700650072000000' +
    '14' +
    '39' +
    '4069006E00740065006700650072000000' +
    '2D' +
    '44' +
    '4069006E00740065006700650072000000' +
    '01260072006500730075006C0074000000' +
    '15' +
    '4F' +
    '01260072006500730075006C0074000000' +
    '06' +
    '01260061000000' +
    '13' +
    '01260062000000' +
    '15' +
    '38' +
    '01260072006500730075006C0074000000' +
    '15' +
    '37' +
    '15' +
    '2D',
    'hex'
  );

  assert.deepStrictEqual(
    encodeFragment(source),
    expected
  );
});

test('encodeProgram exactly reproduces complete Function Test PSPCMPROG', () => {
  const source = `Function Test()
End-Function;`;

  const expected = Buffer.from(
    'A00000000013000000000000000A0000000000000001000000000000000100000085000000' +
    '320A540065007300740000000B142D37152D07' +
    '54006500730074000000' +
    '00000000' +
    '00000000' +
    '00000000' +
    '07000000' +
    '07000000',
    'hex'
  );

  assert.deepStrictEqual(
    encodeProgram(source),
    expected
  );
});

test('encodeProgram exactly reproduces complete AddNumbers PSPCMPROG', () => {
  const source = `Function AddNumbers(&a As integer, &b As integer) Returns integer
   Local integer &result;
   
   &result = &a + &b;
   Return &result;
End-Function;`;

  const expected = Buffer.from(
    'A000000000BE00000000000000160000000000000003000000000000000100000085000000' +
    '320A4100640064004E0075006D0062006500720073000000' +
    '0B' +
    '01260061000000' +
    '35' +
    '4069006E00740065006700650072000000' +
    '03' +
    '01260062000000' +
    '35' +
    '4069006E00740065006700650072000000' +
    '14' +
    '39' +
    '4069006E00740065006700650072000000' +
    '2D' +
    '44' +
    '4069006E00740065006700650072000000' +
    '01260072006500730075006C0074000000' +
    '15' +
    '4F' +
    '01260072006500730075006C0074000000' +
    '06' +
    '01260061000000' +
    '13' +
    '01260062000000' +
    '15' +
    '38' +
    '01260072006500730075006C0074000000' +
    '15' +
    '37' +
    '15' +
    '2D' +
    '07' +
    '4100640064004E0075006D0062006500720073000000' +
    '00000000' +
    '00000000' +
    '02000000' +
    '11000000' +
    '110000C0' +
    '110000C0' +
    '07000000',
    'hex'
  );

  assert.deepStrictEqual(
    encodeProgram(source),
    expected
  );
});

test('encodeProgram exactly reproduces a Global declaration', () => {
  const source = `Global integer &g;`;

  const expected = Buffer.from(
    'A0000000001C00000000000000000000000000000000000000000000000000000085000000' +
    '454069006E0074006500670065007200000001260067000000152D07',
    'hex'
  );

  assert.deepStrictEqual(
    encodeProgram(source),
    expected
  );
});

test('encodeProgram exactly reproduces Globals followed by executable code', () => {
  const source = `Global integer &a;
Global integer &b;

&a = 1;`;

  const expected = Buffer.from(
    'A0000000005300000000000000000000000000000000000000000000000000000085000000' +
    '454069006E007400650067006500720000000126006100000015' +
    '454069006E007400650067006500720000000126006200000015' +
    '2D4F' +
    '01260061000000065000000100000000000000000000000000000015' +
    '07',
    'hex'
  );

  assert.deepStrictEqual(
    encodeProgram(source),
    expected
  );
});

test('encodeProgram exactly reproduces a Component declaration', () => {
  const source = `Component integer &c;`;

  const expected = Buffer.from(
    'A0000000001C00000000000000000000000000000000000000000000000000000085000000' +
    '544069006E0074006500670065007200000001260063000000152D07',
    'hex'
  );

  assert.deepStrictEqual(
    encodeProgram(source),
    expected
  );
});

test('encodeProgram exactly reproduces mixed Global and Component declarations', () => {
  const source = `Global integer &g;
Component integer &c;

&g = 1;`;

  const expected = Buffer.from(
    'A0000000005300000000000000000000000000000000000000000000000000000085000000' +
    '454069006E007400650067006500720000000126006700000015' +
    '544069006E007400650067006500720000000126006300000015' +
    '2D4F' +
    '01260067000000065000000100000000000000000000000000000015' +
    '07',
    'hex'
  );

  assert.deepStrictEqual(
    encodeProgram(source),
    expected
  );
});

test('encodeProgram exactly reproduces a Constant declaration', () => {
  const source = `Constant &ANSWER = 42;`;

  const expected = Buffer.from(
    'A0000000002900000000000000000000000000000000000000000000000000000085000000' +
    '5601260041004E005300570045005200000006' +
    '5000002A000000000000000000000000000000' +
    '152D07',
    'hex'
  );

  assert.deepStrictEqual(encodeProgram(source), expected);
});

test('encodeProgram exactly reproduces a mixed Global, Constant, Component declaration section', () => {
  const source = `Global integer &g;
Constant &ANSWER = 42;
Component integer &c;

&g = &ANSWER;`;

  const expected = Buffer.from(
    'A0000000007800000000000000000000000000000000000000000000000000000085000000' +
    '454069006E007400650067006500720000000126006700000015' +
    '5601260041004E0053005700450052000000065000002A00000000000000000000000000000015' +
    '544069006E007400650067006500720000000126006300000015' +
    '2D4F' +
    '012600670000000601260041004E005300570045005200000015' +
    '07',
    'hex'
  );

  assert.deepStrictEqual(encodeProgram(source), expected);
});

test('encodeProgramArtifacts exactly reproduces and deduplicates Declare Function PeopleCode references', () => {
  const source = `Declare Function Test1 PeopleCode WEBLIB_OU_LP.ISCRIPT1 FieldChange;
Declare Function Test2 PeopleCode WEBLIB_OU_LP.ISCRIPT1 FieldChange;
Declare Function Test3 PeopleCode WEBLIB_OU_LP.ISCRIPT2 FieldChange;
Declare Function Test4 PeopleCode WEBLIB_OU_LP.ISCRIPT1 FieldChange;`;

  const expected = Buffer.from(
    'A000000000BA00000000000000000000000000000000000000000000000000000085000000' +
    '31320A5400650073007400310000003A210100404600690065006C0064004300680061006E006700650000004215' +
    '31320A5400650073007400320000003A210100404600690065006C0064004300680061006E006700650000004215' +
    '31320A5400650073007400330000003A210200404600690065006C0064004300680061006E006700650000004215' +
    '31320A5400650073007400340000003A210100404600690065006C0064004300680061006E006700650000004215' +
    '2D07',
    'hex'
  );

  const result = encodeProgramArtifacts(source);

  assert.deepStrictEqual(result.program, expected);

  assert.deepStrictEqual(result.references, [
    {
      index: 1,
      sequence: 2,
      kind: 'declare-function',
      recordName: 'WEBLIB_OU_LP',
      fieldName: 'ISCRIPT1',
      eventName: 'FieldChange'
    },
    {
      index: 2,
      sequence: 3,
      kind: 'declare-function',
      recordName: 'WEBLIB_OU_LP',
      fieldName: 'ISCRIPT2',
      eventName: 'FieldChange'
    }
  ]);

});

test('encodeProgramArtifacts allocates record/field references in calibrated PSPCMNAME order', () => {
  const source = `Local string &x;

  &x = OU_CORPUS.CODE.Value;

  OU_CORPUS.CODE.Value = "TEST";

  Local Record &rec;

  &rec = GetRecord(Record.OU_CORPUS);

  Local Field &fld;

  &fld = GetField(OU_CORPUS.CODE);`;

  const result = encodeProgramArtifacts(source);

  assert.deepStrictEqual(result.references, [
    {
      index: 0,
      sequence: 1,
      kind: 'owner',
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: 'RECORD',
      objectName: 'Record'
    },
    {
      index: 2,
      sequence: 3,
      kind: 'record',
      recordName: 'OU_CORPUS'
    },
    {
      index: 3,
      sequence: 4,
      kind: 'package',
      packageName: 'FIELD',
      objectName: 'Field'
    }
  ]);
});

test('encodeProgram allocates a distinct RECORD reference for each CreateRecord occurrence', () => {
  const source = `Local Record &rec1;
  Local Record &rec2;

  &rec1 = CreateRecord(Record.OU_CORPUS);
  &rec2 = CreateRecord(Record.OU_CORPUS);`;

  const expected = Buffer.from(
    'A0000000009D00000000000000000000000000000000000000000000000000000085000000' +
    '440A5200650063006F007200640000000126007200650063003100000015' +
    '440A5200650063006F007200640000000126007200650063003200000015' +
    '2D4F' +
    '01260072006500630031000000060A4300720065006100740065005200650063006F007200640000000B2102001415' +
    '01260072006500630032000000060A4300720065006100740065005200650063006F007200640000000B210300141507',
    'hex'
  );

  const result = encodeProgramArtifacts(source, {
    owner: {
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    }
  });

  assert.deepStrictEqual(result.program, expected);

  assert.deepStrictEqual(result.references, [
    {
      index: 0,
      sequence: 1,
      kind: 'owner',
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: 'RECORD',
      objectName: 'Record'
    },
    {
      index: 2,
      sequence: 3,
      kind: 'record',
      recordName: 'OU_CORPUS'
    },
    {
      index: 3,
      sequence: 4,
      kind: 'record',
      recordName: 'OU_CORPUS'
    }
  ]);
});

test('encodeProgram exactly reproduces Rowset Row Record Field navigation fixture', () => {
  const source = `Local Rowset &rs;
Local Row &row;
Local Record &rec;
Local Field &fld;

&rs = GetLevel0();

&row = &rs.GetRow(1);

&rec = &row.GetRecord(Record.OU_CORPUS);

&fld = &rec.GetField(Field.CODE);

&fld.Value = "TEST";`;

  const expected = Buffer.from(
    'A0000000005401000000000000000000000000000000000000000000000000000085000000' +
    '440A52006F007700730065007400000001260072007300000015' +
    '440A52006F007700000001260072006F007700000015' +
    '440A5200650063006F00720064000000012600720065006300000015' +
    '440A4600690065006C006400000001260066006C006400000015' +
    '2D4F' +
    '012600720073000000060A4700650074004C006500760065006C00300000000B1415' +
    '4F' +
    '01260072006F007700000006012600720073000000050A47006500740052006F00770000000B500000010000000000000000000000000000001415' +
    '4F' +
    '01260072006500630000000601260072006F0077000000050A4700650074005200650063006F007200640000000B2105001415' +
    '4F' +
    '01260066006C0064000000060126007200650063000000050A4700650074004600690065006C00640000000B2106001415' +
    '4F' +
    '01260066006C0064000000050A560061006C007500650000000616540045005300540000001507',
    'hex'
  );

  const actual = encodeProgram(source, {
    owner: {
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    }
  });

  assert.deepStrictEqual(actual, expected);
});

test('encodeProgram exactly reproduces repeated Scroll and Field reference fixture', () => {
  const source = `Local Rowset &rs1;
Local Rowset &rs2;
Local Record &rec;
Local Field &fld1;
Local Field &fld2;

&rs1 = GetRowset(Scroll.OU_CORPUS);
&rs2 = GetRowset(Scroll.OU_CORPUS);

&rec = GetRecord(Record.OU_CORPUS);

&fld1 = &rec.GetField(Field.CODE);
&fld2 = &rec.GetField(Field.CODE);`;

  const expected = Buffer.from(
    'A0000000006C01000000000000000000000000000000000000000000000000000085000000' +
    '440A52006F0077007300650074000000012600720073003100000015' +
    '440A52006F0077007300650074000000012600720073003200000015' +
    '440A5200650063006F00720064000000012600720065006300000015' +
    '440A4600690065006C006400000001260066006C0064003100000015' +
    '440A4600690065006C006400000001260066006C0064003200000015' +
    '2D4F' +
    '0126007200730031000000060A47006500740052006F00770073006500740000000B2104001415' +
    '0126007200730032000000060A47006500740052006F00770073006500740000000B2105001415' +
    '4F' +
    '0126007200650063000000060A4700650074005200650063006F007200640000000B2106001415' +
    '4F' +
    '01260066006C00640031000000060126007200650063000000050A4700650074004600690065006C00640000000B2107001415' +
    '01260066006C00640032000000060126007200650063000000050A4700650074004600690065006C00640000000B2108001415' +
    '07',
    'hex'
  );

  const actual = encodeProgram(source, {
    owner: {
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    }
  });

  assert.deepStrictEqual(actual, expected);
});

test('encodeProgramArtifacts allocates repeated Scroll and Field references by occurrence', () => {
  const source = `Local Rowset &rs1;
Local Rowset &rs2;
Local Record &rec;
Local Field &fld1;
Local Field &fld2;

&rs1 = GetRowset(Scroll.OU_CORPUS);
&rs2 = GetRowset(Scroll.OU_CORPUS);

&rec = GetRecord(Record.OU_CORPUS);

&fld1 = &rec.GetField(Field.CODE);
&fld2 = &rec.GetField(Field.CODE);`;

  const result = encodeProgramArtifacts(source, {
    owner: {
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    }
  });

  assert.deepStrictEqual(result.references, [
    {
      index: 0,
      sequence: 1,
      kind: 'owner',
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: 'ROWSET',
      objectName: 'Rowset'
    },
    {
      index: 2,
      sequence: 3,
      kind: 'package',
      packageName: 'RECORD',
      objectName: 'Record'
    },
    {
      index: 3,
      sequence: 4,
      kind: 'package',
      packageName: 'FIELD',
      objectName: 'Field'
    },
    {
      index: 4,
      sequence: 5,
      kind: 'scroll',
      recordName: 'OU_CORPUS'
    },
    {
      index: 5,
      sequence: 6,
      kind: 'scroll',
      recordName: 'OU_CORPUS'
    },
    {
      index: 6,
      sequence: 7,
      kind: 'record',
      recordName: 'OU_CORPUS'
    },
    {
      index: 7,
      sequence: 8,
      kind: 'field',
      fieldName: 'CODE'
    },
    {
      index: 8,
      sequence: 9,
      kind: 'field',
      fieldName: 'CODE'
    }
  ]);
});

test('encodeProgram exactly reproduces deep chained object navigation', () => {
  const source = `Local Field &fld;

&fld = GetLevel0().GetRow(1).GetRowset(Scroll.OU_CORPUS).GetRow(1).GetRecord(Record.OU_CORPUS).GetField(Field.CODE);

&fld.Value = "TEST";`;

  const expected = Buffer.from(
    'A0000000000101000000000000000000000000000000000000000000000000000085000000' +
    '440A4600690065006C006400000001260066006C006400000015' +
    '2D4F' +
    '01260066006C006400000006' +
    '0A4700650074004C006500760065006C00300000000B14' +
    '050A47006500740052006F00770000000B5000000100000000000000000000000000000014' +
    '050A47006500740052006F00770073006500740000000B21020014' +
    '050A47006500740052006F00770000000B5000000100000000000000000000000000000014' +
    '050A4700650074005200650063006F007200640000000B21030014' +
    '050A4700650074004600690065006C00640000000B21040014' +
    '15' +
    '4F' +
    '01260066006C0064000000050A560061006C0075006500000006' +
    '1654004500530054000000' +
    '1507',
    'hex'
  );

  const actual = encodeProgram(source, {
    owner: {
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    }
  });

  assert.deepStrictEqual(actual, expected);
});

test('encodeProgram exactly reproduces arrays and rowset indexing', () => {
  const source = `Local array of string &values;
Local Rowset &rs;
Local Row &row;

&values = CreateArray("ONE", "TWO", "THREE");

WinMessage(&values[2]);

&rs = GetLevel0();

&row = &rs(1);

WinMessage(&row.RowNumber);`;

  const expected = Buffer.from(
    'A0000000008401000000000000000000000000000000000000000000000000000085000000' +
    '4440610072007200610079000000406F00660000004073007400720069006E0067000000012600760061006C00750065007300000015' +
    '440A52006F007700730065007400000001260072007300000015' +
    '440A52006F007700000001260072006F007700000015' +
    '2D4F' +
    '012600760061006C007500650073000000060A4300720065006100740065004100720072006100790000000B164F004E00450000000316540057004F00000003165400480052004500450000001415' +
    '4F' +
    '0A570069006E004D0065007300730061006700650000000B012600760061006C0075006500730000004C500000020000000000000000000000000000004D1415' +
    '4F' +
    '012600720073000000060A4700650074004C006500760065006C00300000000B1415' +
    '4F' +
    '01260072006F0077000000060126007200730000000B500000010000000000000000000000000000001415' +
    '4F' +
    '0A570069006E004D0065007300730061006700650000000B01260072006F0077000000050A52006F0077004E0075006D0062006500720000001415' +
    '07',
    'hex'
  );

  const actual = encodeProgram(source, {
    owner: {
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    }
  });

  assert.deepStrictEqual(actual, expected);
});

test('encodeProgram exactly reproduces indexed array l-values and reads', () => {
  const source = `Local array of string &values;
Local string &value;

&values = CreateArray("ONE", "TWO", "THREE");

&values[2] = "CHANGED";

&value = &values[2];

WinMessage(&values[2]);`;

  const expected = Buffer.from(
    'A0000000005B01000000000000000000000000000000000000000000000000000085000000' +
    '4440610072007200610079000000406F00660000004073007400720069006E0067000000012600760061006C00750065007300000015' +
    '444073007400720069006E0067000000012600760061006C0075006500000015' +
    '2D4F' +
    '012600760061006C007500650073000000060A4300720065006100740065004100720072006100790000000B164F004E00450000000316540057004F00000003165400480052004500450000001415' +
    '4F' +
    '012600760061006C0075006500730000004C500000020000000000000000000000000000004D06164300480041004E00470045004400000015' +
    '4F' +
    '012600760061006C0075006500000006012600760061006C0075006500730000004C500000020000000000000000000000000000004D15' +
    '4F' +
    '0A570069006E004D0065007300730061006700650000000B012600760061006C0075006500730000004C500000020000000000000000000000000000004D1415' +
    '07',
    'hex'
  );

  const actual = encodeProgram(source, {
    owner: {
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    }
  });

  assert.deepStrictEqual(actual, expected);
});

test('encodeProgram exactly reproduces nested If with object navigation', () => {
  const source = `Local Rowset &rs;
Local Row &row;
Local Field &fld;

&rs = GetLevel0();

If &rs.ActiveRowCount > 0 Then
   &row = &rs(1);
   &fld = &row.GetRecord(Record.OU_CORPUS).GetField(Field.CODE);
   
   If &fld.Value <> "" Then
      WinMessage(&fld.Value);
   End-If;
End-If;`;

  const expected = Buffer.from(
    'A0000000007D01000000000000000000000000000000000000000000000000000085000000' +
    '440A52006F007700730065007400000001260072007300000015' +
    '440A52006F007700000001260072006F007700000015' +
    '440A4600690065006C006400000001260066006C006400000015' +
    '2D4F' +
    '012600720073000000060A4700650074004C006500760065006C00300000000B1415' +
    '4F' +
    '1C012600720073000000050A41006300740069007600650052006F00770043006F0075006E007400000009500000000000000000000000000000000000001F' +
    '01260072006F0077000000060126007200730000000B500000010000000000000000000000000000001415' +
    '01260066006C00640000000601260072006F0077000000050A4700650074005200650063006F007200640000000B21040014050A4700650074004600690065006C00640000000B2105001415' +
    '4F' +
    '1C01260066006C0064000000050A560061006C00750065000000101600001F' +
    '0A570069006E004D0065007300730061006700650000000B01260066006C0064000000050A560061006C007500650000001415' +
    '1A15' +
    '1A15' +
    '07',
    'hex'
  );

  const actual = encodeProgram(source, {
    owner: {
      recordName: 'OU_CORPUS',
      fieldName: 'CODE'
    }
  });

  assert.deepStrictEqual(actual, expected);
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

