import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { ProgramImage, compareBytes } from '../peoplecode/programImage.js';
import { readProgramLayout } from '../peoplecode/programLayout.js';
import { APPLICATION_CLASS_FLAGS } from '../peoplecode/applicationClassProgram.js';
import { ACTIVATE_BYTES } from './fixtures/compiledPeopleCode.js';
import { protectedCorpusRegressions } from './fixtures/protectedCorpusRegressions.js';
import {
  source as corpus5529Source,
  program as corpus5529Program
} from './fixtures/corpus5529.js';
import {
  source as corpus6032Source,
  program as corpus6032Program
} from './fixtures/corpus6032.js';
import {
  source as corpus6455Source,
  program as corpus6455Program
} from './fixtures/corpus6455.js';
import {
  source as corpus3606Source,
  program as corpus3606Program
} from './fixtures/corpus3606.js';
import {
  source as corpus530Source,
  program as corpus530Program
} from './fixtures/corpus530.js';
import {
  source as corpus3157Source,
  program as corpus3157Program
} from './fixtures/corpus3157.js';
import {
  source as corpus14308Source,
  program as corpus14308Program
} from './fixtures/corpus14308.js';
import {
  source as corpus15002Source,
  program as corpus15002Program
} from './fixtures/corpus15002.js';
import {
  source as corpus17450Source,
  program as corpus17450Program
} from './fixtures/corpus17450.js';
import {
  source as corpus23987Source,
  program as corpus23987Program
} from './fixtures/corpus23987.js';
import {
  source as offset179Source,
  program as offset179Program
} from './fixtures/corpusOffset179.js';
import {
  encodeFragment,
  UnsupportedPeopleCodeError,
  encodeProgram,
  encodeProgramArtifacts,
  type ReusePoolTraceEvent
} from '../peoplecode/encoder.js';

for (const capture of protectedCorpusRegressions) {
  test(`HCDEV protected PSPCMPROG golden ${capture.id}`, () => {
    const actual = encodeProgramArtifacts(capture.source, {
      owner: capture.owner
    });
    assert.deepStrictEqual(actual.program, capture.program);
  });
}

test('Function metadata encodes calibrated built-in object descriptors', () => {
  const program = encodeProgram(`
Function Builtins(&file As File, &record As Record, &rows As Rowset, &row As Row, &field As Field, &api As ApiObject, &doc As XmlDoc, &exception As Exception, &node As XmlNode) Returns Record;
   Return &record;
End-Function;
`);

  const signatureTail = program.subarray(program.length - 40);
  assert.deepStrictEqual(signatureTail, Buffer.from([
    0x01, 0x00, 0x08, 0xc0,
    0x03, 0x00, 0x08, 0xc0,
    0x07, 0x00, 0x08, 0xc0,
    0x08, 0x00, 0x08, 0xc0,
    0x09, 0x00, 0x08, 0xc0,
    0x0f, 0x00, 0x08, 0xc0,
    0x1d, 0x00, 0x08, 0xc0,
    0x21, 0x00, 0x08, 0xc0,
    0x22, 0x00, 0x08, 0xc0,
    0x07, 0x00, 0x00, 0x00
  ]));
});

test('Function metadata encodes one-level array descriptors', () => {
  const program = encodeProgram(`
Function Arrays(&values As array of any) Returns array of string;
   Return &values;
End-Function;
`);

  assert.deepStrictEqual(
    program.subarray(program.length - 8),
    Buffer.from([
      0x04, 0x00, 0x10, 0xc0,
      0x07, 0x00, 0x00, 0x00
    ])
  );

  assert.deepStrictEqual(
    decodeProgram(program, new NameTable()).declarations,
    [{
      name: 'Arrays',
      paramCount: 1,
      hasReturnValue: true,
      returnType: 'array of string',
      parameterTypes: ['array of any']
    }]
  );
});

test('legacy untyped arrays preserve their short source form and any descriptor', () => {
  const program = encodeProgram(`
Function UntypedArrays(&values As array) Returns array;
   Local array &copy;
   &copy = &values;
   Return &copy;
End-Function;
`);

  assert.deepStrictEqual(
    program.subarray(program.length - 8),
    Buffer.from([
      0x04, 0x00, 0x10, 0xc0,
      0x07, 0x00, 0x00, 0x00
    ])
  );

  assert.deepStrictEqual(
    decodeProgram(program, new NameTable()).declarations,
    [{
      name: 'UntypedArrays',
      paramCount: 1,
      hasReturnValue: true,
      returnType: 'array of any',
      parameterTypes: ['array of any']
    }]
  );

  assert.equal(
    program.includes(Buffer.from('444061007200720061007900000001260063006f0070007900000015', 'hex')),
    true
  );
});

test('Function metadata points Application Class descriptors into its name trailer', () => {
  const program = encodeProgram(`
Function AppTypes(&value As PKG:Type) Returns PKG:Type;
   Return &value;
End-Function;
`);

  assert.deepStrictEqual(
    program.subarray(program.length - 8),
    Buffer.from([
      0x09, 0x01, 0x08, 0xc0,
      0x07, 0x00, 0x00, 0x00
    ])
  );

  assert.deepStrictEqual(
    decodeProgram(program, new NameTable()).declarations,
    [{
      name: 'AppTypes',
      paramCount: 1,
      hasReturnValue: true,
      returnType: 'PKG:Type',
      parameterTypes: ['PKG:Type']
    }]
  );
});

test('HCDEV definition 5529 compiles byte exactly', () => {
  const actual = encodeProgramArtifacts(corpus5529Source, {
    owner: {
      recordName: 'DERIVED_HINT',
      fieldName: 'EMAILPSWD'
    }
  });
  assert.deepStrictEqual(actual.program, corpus5529Program);
  assert.equal(actual.references.length, 25);
});

test('HCDEV definition 6032 preserves parenthesized and bare Function signature slots', () => {
  const actual = encodeProgramArtifacts(corpus6032Source, {
    owner: { recordName: 'DERIVED_HR_DR', fieldName: 'HR_DR_CONTINUE1_PB' }
  });
  assert.deepStrictEqual(actual.program, corpus6032Program);
  assert.equal(actual.references.length, 22);
});

test('HCDEV definition 6455 preserves Function-local class dependencies and import comment boundaries', () => {
  const owner = { recordName: 'DERIVED_HR_WGP', fieldName: 'DETAILS_PB' };
  const actual = encodeProgramArtifacts(corpus6455Source, { owner });
  assert.deepStrictEqual(actual.program, corpus6455Program);
  assert.equal(actual.references.length, 20);
});

test('HCDEV definition 3606 preserves Global array type and declaration boundary', () => {
  const actual = encodeProgramArtifacts(corpus3606Source, {
    owner: { recordName: 'DEPENDENT_BENEF', fieldName: 'CSB_ELIG' }
  });
  assert.deepStrictEqual(actual.program, corpus3606Program);
  assert.equal(actual.references.length, 2);
});

test('HCDEV definition 530 preserves nested Component array type', () => {
  const actual = encodeProgramArtifacts(corpus530Source, {
    owner: { recordName: 'ADDRESS_TYPE_FL', fieldName: 'EFFDT' }
  });
  assert.deepStrictEqual(actual.program, corpus530Program);
});

test('HCDEV definition 3157 preserves nested Global Record array dependency', () => {
  const actual = encodeProgramArtifacts(corpus3157Source, {
    owner: { recordName: 'CONTROL_TL_TA', fieldName: 'TL_SQL_TEXT1_BTN' }
  });
  assert.deepStrictEqual(actual.program, corpus3157Program);
  assert.equal(actual.references[2]?.kind, 'package');
  assert.equal(actual.references[2]?.packageName, 'RECORD');
});

test('HCDEV definition 14308 closes Component declaration before REM', () => {
  const actual = encodeProgramArtifacts(corpus14308Source, {
    owner: { recordName: 'PSACLMENU_VW2', fieldName: 'MENUNAME' }
  });
  assert.deepStrictEqual(actual.program, corpus14308Program);
});

test('HCDEV definition 15002 reuses owner reference for declared Function target', () => {
  const actual = encodeProgramArtifacts(corpus15002Source, {
    owner: { recordName: 'PSDOCLOJSFLD_VW', fieldName: 'IB_JSEVENT_GUI' }
  });
  assert.deepStrictEqual(actual.program, corpus15002Program);
  assert.equal(actual.references.length, 1);
});

test('HCDEV definition 17450 renders an inline Then comment before its semicolon', () => {
  const names = new NameTable();
  names.add(1, 'PSWEBLIB_WRK.CLASSID');
  names.add(2, 'PSCLASSDEFN.CLASSID');
  const decoded = decodeProgram(corpus17450Program, names);
  assert.ok(decoded.text.includes('Then /* ICE 67971300 */;'));
  const actual = encodeProgramArtifacts(corpus17450Source, {
    owner: { recordName: 'PSWEBLIB_WRK', fieldName: 'CLASSID' }
  });
  assert.deepStrictEqual(actual.program, corpus17450Program);
});

test('HCDEV definition 23987 renders the StyleSheet qualifier', () => {
  const names = new NameTable();
  names.add(1, 'PERSON_SUB_CNF_FL.GBL');
  names.add(2, 'STYLESHEET.HR_PD_SS_FL');
  assert.equal(decodeProgram(corpus23987Program, names).text.trim(), corpus23987Source.trim());
});

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

test('a system-variable receiver supports a method-call statement', () => {
  assert.deepStrictEqual(
    encodeFragment('%IntBroker.Publish(&Msg);'),
    Buffer.concat([
      Buffer.from([0x12]),
      Buffer.from('%IntBroker\0', 'utf16le'),
      Buffer.from([0x05, 0x0a]),
      Buffer.from('Publish\0', 'utf16le'),
      Buffer.from([0x0b, 0x01]),
      Buffer.from('&Msg\0', 'utf16le'),
      Buffer.from([0x14, 0x15])
    ])
  );
});

test('an As cast accepts a built-in object type', () => {
  assert.deepStrictEqual(
    encodeFragment('UseRow(&row As Row);'),
    Buffer.concat([
      Buffer.from([0x0a]),
      Buffer.from('UseRow\0', 'utf16le'),
      Buffer.from([0x0b, 0x01]),
      Buffer.from('&row\0', 'utf16le'),
      Buffer.from([0x35, 0x0a]),
      Buffer.from('Row\0', 'utf16le'),
      Buffer.from([0x14, 0x15])
    ])
  );
});

for (const source of [
  '&editable = (Not &node.IsLocal);',
  '&public = (&securityType = &publicType);'
]) {
  test(`an assignment accepts a grouped boolean expression: ${source}`, () => {
    const program = encodeProgram(source);
    const decoded = decodeProgram(program, new NameTable(), { mode: 'strict' });
    assert.deepStrictEqual(encodeProgram(decoded.text), program);
  });
}

test('a function-call result supports a property assignment statement', () => {
  const source = 'GetLevel0().SetComponentChanged = False;';
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'strict' });
  assert.deepStrictEqual(encodeProgram(decoded.text), program);
});

test('a Local Application Class declaration supports multiple variables', () => {
  assert.deepStrictEqual(
    encodeFragment('Local PKG:Type &first, &second;'),
    Buffer.concat([
      Buffer.from([0x44, 0x0a]),
      Buffer.from('PKG\0', 'utf16le'),
      Buffer.from([0x57, 0x0a]),
      Buffer.from('Type\0', 'utf16le'),
      Buffer.from([0x01]),
      Buffer.from('&first\0', 'utf16le'),
      Buffer.from([0x03, 0x01]),
      Buffer.from('&second\0', 'utf16le'),
      Buffer.from([0x15, 0x2d])
    ])
  );
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

test('Evaluate preserves a REM comment before its first When', () => {
  const source = 'Evaluate &value\n   rem text;\nWhen "0"\n   Break;\nEnd-Evaluate;';
  const program = encodeProgram(source);
  const comment = Buffer.concat([
    Buffer.from([0x24, 0x12, 0x00]),
    Buffer.from('rem text;', 'utf16le')
  ]);
  assert.notEqual(program.indexOf(comment), -1);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'strict' });
  assert.deepStrictEqual(encodeProgram(decoded.text), program);
});

test('When-Other final statement may omit its semicolon before End-Evaluate', () => {
  const program = encodeProgram(
    'Evaluate &kind\n' +
    'When-Other\n' +
    '   &result = "x"\n' +
    'End-Evaluate;'
  );

  assert.deepStrictEqual(
    program.subarray(-9),
    Buffer.from([0x06, 0x16, 0x78, 0x00, 0x00, 0x00, 0x3f, 0x15, 0x07])
  );
});

test('When-Other body preserves a comment before the statement semicolon', () => {
  const program = encodeProgram(
    'Evaluate &kind\n' +
    'When-Other\n' +
    '   &result = True /* prior value */;\n' +
    'End-Evaluate;'
  );
  const comment = Buffer.concat([
    Buffer.from([0x4e, 0x22, 0x00]),
    Buffer.from('/* prior value */', 'utf16le')
  ]);

  assert.notEqual(program.indexOf(comment), -1);
});

test('assignment accepts a parenthesized system-variable comparison', () => {
  const program = encodeProgram('&enabled = (%Mode <> %Action_Add);');
  const comparison = Buffer.concat([
    Buffer.from([0x0b, 0x12]),
    Buffer.from('%Mode', 'utf16le'),
    Buffer.from([0x00, 0x00, 0x10, 0x12]),
    Buffer.from('%Action_Add', 'utf16le'),
    Buffer.from([0x00, 0x00, 0x14])
  ]);

  assert.notEqual(program.indexOf(comparison), -1);
});

test('If condition accepts a postfix property after a parenthesized field', () => {
  const program = encodeProgram(
    'Local Record &rec;\n' +
    'If (&rec.LANGUAGE_CD).IsInBuf Then\n' +
    '   &found = True;\n' +
    'End-If;'
  );
  const memberThen = Buffer.concat([
    Buffer.from([0x05, 0x0a]),
    Buffer.from('IsInBuf', 'utf16le'),
    Buffer.from([0x00, 0x00, 0x1f])
  ]);

  assert.notEqual(program.indexOf(memberThen), -1);
});

test('If condition preserves a multiline REM tail before Then', () => {
  const program = encodeProgram(
    'If &enabled\n' +
    '   REM And\n' +
    '      &disabled = 1;\n' +
    'Then\n' +
    'End-If;'
  );
  const payload = Buffer.from('REM And\n      &disabled = 1;', 'utf16le');
  const expected = Buffer.concat([
    Buffer.from([0x24, payload.length, 0x00]),
    payload,
    Buffer.from([0x1f])
  ]);

  assert.notEqual(program.indexOf(expected), -1);
});

test('Continue encodes with its context-gated statement opcode', () => {
  const program = encodeProgram(
    'While True\n' +
    '   Continue;\n' +
    'End-While;'
  );

  assert.notEqual(program.indexOf(Buffer.from([0x6e, 0x15])), -1);
});

test('dotted assignment text inside a call string stays a bare call', () => {
  const program = encodeProgram(
    'If True Then\n' +
    '   AddOnLoadScript("document.getElementById(\'x\').style.visibility = \'visible\';");\n' +
    'Else\n' +
    '   AddOnLoadScript("document.getElementById(\'x\').style.visibility = \'hidden\';");\n' +
    'End-If;'
  );

  assert.notEqual(
    program.indexOf(Buffer.from('AddOnLoadScript', 'utf16le')),
    -1
  );
});

test('try and catch bodies preserve REM comments', () => {
  const source = `try
   rem before catch;
catch Exception &error
   rem after catch;
end-try;`;
  const program = encodeProgram(source);
  assert.notEqual(
    program.indexOf(Buffer.concat([
      Buffer.from([0x24, 0x22, 0x00]),
      Buffer.from('rem before catch;', 'utf16le')
    ])),
    -1
  );
  assert.notEqual(
    program.indexOf(Buffer.concat([
      Buffer.from([0x24, 0x20, 0x00]),
      Buffer.from('rem after catch;', 'utf16le')
    ])),
    -1
  );
  const decoded = decodeProgram(program, new NameTable(), { mode: 'strict' });
  assert.deepStrictEqual(encodeProgram(decoded.text), program);
});

test('REM after leading reference-bearing Locals closes the Local section', () => {
  assert.deepStrictEqual(
    encodeFragment('Local Rowset &rs;\n\nrem x;'),
    Buffer.from(
      '440A52006F0077007300650074000000012600720073000000152D4F' +
      '240C00720065006D00200078003B00',
      'hex'
    )
  );
});

test('a later, unrelated initialized top-level Local does not suppress an earlier leading-Local declaration-section boundary', () => {
  /*
   * ADDRESS_TYPE_FL.ADDRESS_TYPE.RowDelete (definition_id 528): `Local SQL
   * &SQL1;` is a leading, uninitialized, reference-bearing Local followed by
   * executable statements, then later (after execution has already begun,
   * with no `Declare Function` ever opening a top-level declaration
   * section) an unrelated initialized `Local Record &recContact =
   * CreateRecord(Record.EMERGENCY_CNTCT);`. The stored program still closes
   * the FIRST Local's declaration section with `15 2D 4F`; the later
   * initializer must not retroactively suppress that `0x2D`, since
   * `sawTopLevelDeclaration` is false throughout -- there is no open
   * `Declare Function` section for it to be closing.
   */
  assert.deepStrictEqual(
    encodeFragment(
      'Local Rowset &rs;\n\n' +
      '&x = 1;\n' +
      'Local Record &rec = CreateRecord(Record.PS_TEST);\n'
    ),
    Buffer.from(
      '440A52006F0077007300650074000000012600720073000000152D4F01260078000000065000000100000000000000000000000000000015440A5200650063006F007200640000000126007200650063000000060A4300720065006100740065005200650063006F007200640000000B2103001415',
      'hex'
    )
  );
});

test('a RowScrollSelect-family call denies a single-occurrence reuse across an intervening RowScrollSelect-family call', () => {
  /*
   * AE_UPGCONV_WRK.UPGPATH.FieldChange (definition_id 843): `ScrollFlush
   * (Record.PSAEAPPLDEFN);` is followed by `RowScrollSelect(1, Record.
   * UPGCONV_DEFN, Record.UPGCONV_DEFN);` (a RowScrollSelect-family call,
   * reusing UPGCONV_DEFN only within its own argument list), then
   * `RowScrollSelectNew(1, Record.UPGCONV_DEFN, Record.PSAEAPPLDEFN, ...)`.
   * Both of RowScrollSelectNew's own arguments allocate FRESH rows in the
   * stored program: the intervening RowScrollSelect call ends the window
   * in which an ordinary call's row can be picked up by a later
   * RowScrollSelect-family call's single-occurrence fallback -- reusing
   * neither the intervening call's own UPGCONV_DEFN row nor ScrollFlush's
   * earlier PSAEAPPLDEFN row (two statements back).
   */
  assert.deepStrictEqual(
    encodeFragment(
      'ScrollFlush(Record.PSAEAPPLDEFN);\n' +
      'RowScrollSelect(1, Record.UPGCONV_DEFN, Record.UPGCONV_DEFN);\n' +
      'RowScrollSelectNew(1, Record.UPGCONV_DEFN, Record.PSAEAPPLDEFN, "where", &X);\n'
    ),
    Buffer.from(
      '0A5300630072006F006C006C0046006C0075007300680000000B21010014150A52006F0077005300630072006F006C006C00530065006C0065006300740000000B50000001000000000000000000000000000000032102000321020014150A52006F0077005300630072006F006C006C00530065006C006500630074004E006500770000000B500000010000000000000000000000000000000321030003210400031677006800650072006500000003012600580000001415',
      'hex'
    )
  );
});

test('an ordinary call\'s row carries into a later RowScrollSelect-family call\'s single-occurrence fallback', () => {
  /*
   * AE_WRK.AE_DECIDE.SavePreChange (definition_id 860): a bare
   * `ScrollSelectNew(1, Record.AE_TOOLS_SAV_VW, Record.AE_STMT_TBL, ...)`
   * -- NOT itself a RowScrollSelect-family name, so an utterly ordinary
   * call -- is followed in the sibling Else branch of the SAME If by
   * `ScrollSelect(1, Record.AE_TOOLS_SAV_VW, Record.AE_STMT_TBL, ...)`.
   * ScrollSelect's own arguments reuse ScrollSelectNew's rows.
   *
   * Cycle 95: the reuse holds because both calls are in one allocation
   * unit (the If statement). As two separate top-level statements they
   * are two units and each opens its own rows.
   */
  const recordRows = (source: string) =>
    encodeProgramArtifacts(source).references.filter(reference => reference.kind === 'record').length;
  assert.strictEqual(
    recordRows(`If &a = 1 Then
   ScrollSelectNew(1, Record.AE_TOOLS_SAV_VW, Record.AE_STMT_TBL, "where", &X);
Else
   ScrollSelect(1, Record.AE_TOOLS_SAV_VW, Record.AE_STMT_TBL, "where", &X);
End-If;`),
    2
  );
  assert.strictEqual(
    recordRows(`ScrollSelectNew(1, Record.AE_TOOLS_SAV_VW, Record.AE_STMT_TBL, "where", &X);
ScrollSelect(1, Record.AE_TOOLS_SAV_VW, Record.AE_STMT_TBL, "where", &X);`),
    4
  );
});

test('a RowScrollSelect-family call\'s own control-group reuse re-populates the single-occurrence fallback pool', () => {
  /*
   * DERIVED_HR.LOOKUP_NID_BTN.FieldChange (definition_id 5687):
   *
   *   If ... Then
   *      ScrollFlush(Record.NID_SRCH_VW);
   *      &n = ScrollSelect(1, Record.NID_SRCH_VW, Record.NID_SRCH_VW1, &W);
   *   Else
   *      ScrollFlush(Record.NID_SRCH_VW);
   *      &n = ScrollSelect(1, Record.NID_SRCH_VW, Record.NID_DEP_SRCH_V1, &W);
   *   End-If;
   *
   * The If-branch's ScrollSelect (a RowScrollSelect-family call) ends the
   * single-occurrence carry-over window. The Else-branch's ScrollFlush
   * then reuses NID_SRCH_VW via its own, separate control-group reuse
   * check (not a fresh allocation) -- and that reuse must re-open the
   * window so the Else-branch's own ScrollSelect can still find
   * NID_SRCH_VW as a single-occurrence candidate, exactly as the
   * If-branch's did. NID_SRCH_VW is stored as ONE PSPCMNAME row shared by
   * all four calls, not reallocated per branch.
   */
  assert.deepStrictEqual(
    encodeFragment(
      'If &A = "E" Then\n' +
      '   ScrollFlush(Record.NID_SRCH_VW);\n' +
      '   &n = ScrollSelect(1, Record.NID_SRCH_VW, Record.NID_SRCH_VW1, &W);\n' +
      'Else\n' +
      '   ScrollFlush(Record.NID_SRCH_VW);\n' +
      '   &n = ScrollSelect(1, Record.NID_SRCH_VW, Record.NID_DEP_SRCH_V1, &W);\n' +
      'End-If;\n'
    ),
    Buffer.from(
      '1C012600410000000616450000001F0A5300630072006F006C006C0046006C0075007300680000000B21010014150126006E000000060A5300630072006F006C006C00530065006C0065006300740000000B50000001000000000000000000000000000000032101000321020003012600570000001415190A5300630072006F006C006C0046006C0075007300680000000B21010014150126006E000000060A5300630072006F006C006C00530065006C0065006300740000000B500000010000000000000000000000000000000321010003210300030126005700000014151A15',
      'hex'
    )
  );
});

test('a name repeated within a RowScrollSelect-family call may reuse an earlier ScrollFlush row when nested inside a control-flow block', () => {
  /*
   * AE_WRK.AE_REFRESH.FieldChange (definition_id 889), AMM_DERIVED.
   * PT_FORCE_RETRY.FieldChange (definition_id 1007), and DERIVED_BAS.
   * BN_TOGGLE.ODEM_RemoteCall (definition_id 1749) all prove that a
   * single-argument `ScrollFlush(Record.X); RowScrollSelect(N, Record.X,
   * Record.X, ...)` (or `ScrollSelect`) pair DOES share one PSPCMNAME row
   * -- even though `X` is REPEATED within RowScrollSelect's own argument
   * list, normally excluded from the single-occurrence fallback entirely
   * -- when the pair is nested inside a control-flow block (`If`, in all
   * three cases; `controlDepth > 0`). AE_UPGCONV_WRK.AE_REFRESH.FieldChange
   * (definition_id 840) and ARCH_WRK.PSARCH_COPY_ROWS.FieldChange
   * (definition_id 1283) both disprove reuse for this same repeated-name
   * shape, but their own ScrollFlush/RowScrollSelect pairs sit at flat
   * TOP level (`controlDepth === 0`, no wrapping block at all) --
   * `controlDepth` is the discriminator, not "single occurrence vs
   * repeated" by itself (ARCH_FLT_RQST.PSARCH_ID.SavePostChange,
   * definition_id 1220, the ORIGINAL single-occurrence evidence, is
   * itself nested inside its own `If %PanelGroup = ... Then` block).
   */
  assert.deepStrictEqual(
    encodeFragment(
      'If &A = "E" Then\n' +
      '   ScrollFlush(Record.MESSAGE_LOG);\n' +
      '   RowScrollSelect(1, Record.MESSAGE_LOG, Record.MESSAGE_LOG, "where", &PI);\n' +
      'End-If;\n'
    ),
    Buffer.from(
      '1C012600410000000616450000001F0A5300630072006F006C006C0046006C0075007300680000000B21010014150A52006F0077005300630072006F006C006C00530065006C0065006300740000000B50000001000000000000000000000000000000032101000321010003167700680065007200650000000301260050004900000014151A15',
      'hex'
    )
  );
});

test('Record.X.IsChanged is an inline Row-state property, not an explicit Record->FIELD chain', () => {
  /*
   * AMM_DERIVED.IB_FO_BACK_PB.FieldChange (definition_id 982):
   *
   *   If Record.AMM_DERIVED.IsChanged = True Or ...
   *
   * The explicit `Record.REC.FIELD` chain regex (calibrated for offset 433's
   * `Record.REC.FIELD.Value`) matched this too, since it only checks for two
   * dotted identifiers, not a genuine third `.Value`-style continuation.
   * That put `expectedReferenceMember` into `'field'` mode, so `IsChanged`
   * -- one of the same inline Row state/property members a Row variable's
   * `.IsChanged` already stays inline for -- got compiled as an attempted
   * FIELD reference instead of staying an ordinary inline name. Stored
   * emits `21 <ref> 05 0A "IsChanged"`: the RECORD reference followed
   * directly by inline text, no FIELD-mode PSPCMNAME row at all.
   */
  assert.deepStrictEqual(
    encodeFragment(
      'If Record.AMM_DERIVED.IsChanged = True Then\n' +
      '   &x = 1;\n' +
      'End-If;\n'
    ),
    Buffer.from(
      '1C210100050A490073004300680061006E006700650064000000062F1F012600780000000650000001000000000000000000000000000000151A15',
      'hex'
    )
  );
});

test('a quoted 0x48 reference is deduplicated within a control group, not globally', () => {
  /*
   * ACA_XML_WRK.ACA_UPDATE_PB.FieldChange (definition_id 369): two
   * `Transfer(...)` calls with an identical `MenuName."M"`/`BarName."USE"`
   * pair sit inside the SAME top-level `If` statement (one Then-branch's
   * nested call, the other's Else) -- one control group -- and both
   * compiled uses point back to the same PSPCMNAME rows.
   */
  assert.deepStrictEqual(
    encodeFragment(
      'If &A = "X" Then\n' +
      '   If &B = "Y" Then\n' +
      '      Transfer(True, MenuName."M", BarName."USE");\n' +
      '   Else\n' +
      '      Transfer(True, MenuName."M", BarName."USE");\n' +
      '   End-If;\n' +
      'End-If;\n'
    ),
    Buffer.from(
      '1C012600410000000616580000001F1C012600420000000616590000001F0A5400720061006E00730066006500720000000B2F03480100034802001415190A5400720061006E00730066006500720000000B2F034801000348020014151A151A15',
      'hex'
    )
  );

  /*
   * AE_DERIVED.AE_TEMPTBL_BTN.FieldChange (definition_id 805) disproves
   * reusing that GLOBALLY: an identical `BarName."USE"` in two SEPARATE
   * top-level `If` statements -- different control groups -- allocates a
   * completely fresh row for the second call, not reusing the first's.
   */
  assert.deepStrictEqual(
    encodeFragment(
      'If &A = "X" Then\n' +
      '   Transfer(True, MenuName."M", BarName."USE");\n' +
      'End-If;\n' +
      'If &B = "Y" Then\n' +
      '   Transfer(True, MenuName."M", BarName."USE");\n' +
      'End-If;\n'
    ),
    Buffer.from(
      '1C012600410000000616580000001F0A5400720061006E00730066006500720000000B2F034801000348020014151A151C012600420000000616590000001F0A5400720061006E00730066006500720000000B2F034803000348040014151A15',
      'hex'
    )
  );
});

test('the FIELD half of an explicit Record.REC.FIELD.Value chain is reusable by name across a different root record', () => {
  /*
   * ACL_WS_WRK.WSOPRACCESS.SaveEdit (definition_id 437):
   *
   *   &classid = Record.PTIBMAPAUTH_VW.CLASSID.Value;
   *   ...
   *   &classid = Record.PSAUTHWS_VW1.CLASSID.Value;
   *
   * both inside the same control group (an If/Else). Stored has exactly
   * one FIELD/CLASSID PSPCMNAME row, reused for both, despite the two
   * different root records -- the RECORD half of each chain still
   * allocates its own fresh row (different literal record names), but
   * the FIELD half is reusable by name alone within the control group,
   * mirroring the already-proven cross-Record-variable FIELD reuse
   * (ACCOMPLISHMENTS.EMPLID.SavePostChange).
   */
  assert.deepStrictEqual(
    encodeFragment(
      'If &A = "X" Then\n' +
      '   &classid = Record.PTIBMAPAUTH_VW.CLASSID.Value;\n' +
      'Else\n' +
      '   &classid = Record.PSAUTHWS_VW1.CLASSID.Value;\n' +
      'End-If;\n'
    ),
    Buffer.from(
      '1C012600410000000616580000001F01260063006C0061007300730069006400000006210100054A0200050A560061006C00750065000000151901260063006C0061007300730069006400000006210300054A0200050A560061006C00750065000000151A15',
      'hex'
    )
  );
});

test('typed Row FIELD identity is scoped by control group, not interned globally', () => {
  /*
   * DERIVED_GP_CS.GP_CS_SM_KEY.FieldFormula (definition_id 5358) proves
   * that a typed Row's same-name FIELD in a later top-level control group
   * gets a fresh PSPCMNAME identity from the authoritative
   * (controlGroup, fieldName) namespace.
   */
  const events: ReusePoolTraceEvent[] = [];

  encodeProgram(
    'Local Row &row;\n' +
    'If &A = "X" Then\n' +
    '   &row.REC_A.FIELD_A.Value = 1;\n' +
    'End-If;\n' +
    'If &B = "Y" Then\n' +
    '   &row.REC_A.FIELD_A.Value = 2;\n' +
    'End-If;\n',
    { reusePoolTrace: event => events.push(event) }
  );

  const scopedWrites = events.filter(event =>
    event.pool === 'scopedFieldReferences' &&
    event.action === 'WRITE'
  );
  assert.deepStrictEqual(
    scopedWrites.map(event => ({
      key: event.key,
      sequence: event.reference?.sequence
    })),
    [
      { key: '1:field_a', sequence: 4 },
      { key: '3:field_a', sequence: 6 }
    ]
  );
});

test('a Function header inside a block comment is not counted as a real function', () => {
  /*
   * AE_WRK.MESSAGE_NBR.FieldChange (definition_id 908): a whole
   * `Function Check_Integrity ... End-Function;` definition sits inside a
   * `/* ... *\/` block comment, ahead of two real Functions (`load_stmt`,
   * `Check_Syntax`). `parseFunctionMetadata`'s scan for top-level
   * `Function NAME` headers ran against the raw source text, with no
   * awareness of comments, so it picked up the commented-out function as
   * a genuine third one -- inflating the stored function-directory count
   * from 2 to 3 and adding a spurious metadata/trailer entry. The program
   * header's function count must reflect only the two real Functions.
   */
  const source =
    '/*\n' +
    'Function Commented\n' +
    '   &X = 1;\n' +
    'End-Function;\n' +
    '*/\n' +
    '\n' +
    'Function real_one\n' +
    '   &Y = 1;\n' +
    'End-Function;\n';

  assert.deepStrictEqual(
    encodeProgram(source),
    Buffer.from(
      'A0000000009B000000000000001200000000000000000000000000000001000000850000002462002F002A000A00460075006E006300740069006F006E00200043006F006D006D0065006E007400650064000A002000200020002600580020003D00200031003B000A0045006E0064002D00460075006E006300740069006F006E003B000A002A002F004F320A7200650061006C005F006F006E00650000002D0126005900000006500000010000000000000000000000000000001537152D077200650061006C005F006F006E006500000000000000000000000000000007000000',
      'hex'
    )
  );
});

test('REM may continue onto an observed single-space prose line', () => {
  const source =
    'REM KJB Removed code for Import Long Term Goals as it is\n' +
    ' no longer valid, as Record.REVIEW_GOALS is obsolete;';

  assert.deepStrictEqual(
    encodeFragment(source),
    Buffer.concat([
      Buffer.from([0x24, 0xdc, 0x00]),
      Buffer.from(source, 'utf16le')
    ])
  );
});

test('REM may continue through deeper-indented disabled code until semicolon', () => {
  const payload = Buffer.from(
    'REM If True Then\n   Evaluate &x\n      &x = 1;',
    'utf16le'
  );

  assert.deepStrictEqual(
    encodeFragment(
      'REM If True Then\n' +
      '   Evaluate &x\n' +
      '      &x = 1;'
    ),
    Buffer.concat([
      Buffer.from([0x24, payload.length, 0x00]),
      payload
    ])
  );
});

test('REM preserves a same-indent continuation and nonterminal trailing space', () => {
  const source = 'REM first line \nsecond line;';

  assert.deepStrictEqual(
    encodeFragment(source),
    Buffer.concat([
      Buffer.from([0x24, source.length * 2, 0x00]),
      Buffer.from(source, 'utf16le')
    ])
  );
});

test('an If-body REM may carry a trailing inline block comment', () => {
  const rem = 'REM &value = 0;';
  const comment = '/* disabled */';
  const program = encodeProgram(
    'If True Then\n' +
    `   ${rem} ${comment}\n` +
    'End-If;',
    { commentOpcodes: [0x24, 0x4e] }
  );
  const remPayload = Buffer.from(rem, 'utf16le');
  const commentPayload = Buffer.from(comment, 'utf16le');

  assert.notEqual(
    program.indexOf(Buffer.concat([
      Buffer.from([0x24, remPayload.length, 0x00]),
      remPayload,
      Buffer.from([0x4e, commentPayload.length, 0x00]),
      commentPayload,
      Buffer.from([0x1a])
    ])),
    -1
  );
});

test('legacy remark spelling uses the calibrated REM comment payload', () => {
  const source =
    'remark Prevent deletion of an entire project;';

  assert.deepStrictEqual(
    encodeFragment(source),
    Buffer.concat([
      Buffer.from([0x24, source.length * 2, 0x00]),
      Buffer.from(source, 'utf16le')
    ])
  );
});

test('captured variable names may start with a digit or end in #', () => {
  const source =
    'Local string &6x_plan_changed;\n' +
    'Local number &TotalRow#;\n' +
    '&6x_plan_changed = "Y";\n' +
    '&TotalRow# = 1;';
  const program = encodeProgram(source);
  const decoded = decodeProgram(
    program,
    new NameTable(),
    { mode: 'strict' }
  );

  assert.deepStrictEqual(
    encodeProgram(decoded.text),
    program
  );
  assert.ok(decoded.text.includes('&6x_plan_changed'));
  assert.ok(decoded.text.includes('&TotalRow#'));
});

test('HCDEV definition 3428 preserves a declared function terminal #', () => {
  const source =
    'Declare Function assign_seq# PeopleCode CSB_REGISTRANT.SEQNUM FieldFormula;\n\n' +
    'If %Panel = Panel.CSB_REG_DATA Then\n' +
    '   assign_seq#();\n' +
    'End-If;\n';
  const expected = Buffer.from(
    'a000000000720000000000000000000000000000000000000000000000000000008500000031320a610073007300690067006e005f00730065007100230000003a210100404600690065006c00640046006f0072006d0075006c006100000042152d4f1c122500500061006e0065006c000000062102001f0a610073007300690067006e005f00730065007100230000000b14151a1507',
    'hex'
  );

  assert.deepStrictEqual(
    encodeProgram(source, {
      owner: {
        recordName: 'CSB_REGISTRANT',
        fieldName: 'EMPLID'
      }
    }),
    expected
  );
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

test('a top-level While block may omit its final semicolon at EOF', () => {
  assert.deepStrictEqual(
    encodeFragment(`While &sql.Fetch(&x)
   Foo();
End-While`),
    Buffer.from(
      '25012600730071006C000000050A4600650074006300680000000B01260078000000142D' +
      '0A46006F006F0000000B141526',
      'hex'
    )
  );
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

test('a For body preserves an explicit empty statement', () => {
  const source = 'For &i = 1 To 2\n   &x = &i;;\nEnd-For;';
  const program = encodeProgram(source);
  assert.notEqual(program.indexOf(Buffer.from([0x15, 0x15])), -1);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'strict' });
  assert.deepStrictEqual(encodeProgram(decoded.text), program);
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

test('Component declarations preserve a trailing comma before the semicolon', () => {
  assert.deepStrictEqual(
    encodeFragment('Component string &A, &B,;'),
    Buffer.from(
      '544073007400720069006e006700000001260041000000030126004200000003152d',
      'hex'
    )
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

function encodeWithHtmlReferenceTrace(source: string) {
  const uses: number[] = [];
  const result = encodeProgramArtifacts(source, {
    owner: {
      recordName: 'HTML_TEST',
      fieldName: 'FIELDCHANGE'
    },
    referenceTrace: event => {
      if (
        event.action === 'USE' &&
        event.reference.kind === 'record-field' &&
        event.reference.recordName?.toUpperCase() === 'HTML'
      ) {
        uses.push(event.reference.index);
      }
    }
  });

  return {
    result,
    uses,
    htmlReferences: result.references.filter(
      reference =>
        reference.kind === 'record-field' &&
        reference.recordName?.toUpperCase() === 'HTML'
    )
  };
}

test('HTML.NAME is an explicit static record-field dependency', () => {
  const { htmlReferences, uses } = encodeWithHtmlReferenceTrace(
    'GetHTMLText(HTML.TEST_CONTENT);'
  );

  assert.deepStrictEqual(htmlReferences, [
    {
      index: 1,
      sequence: 2,
      kind: 'record-field',
      recordName: 'HTML',
      fieldName: 'TEST_CONTENT'
    }
  ]);
  assert.deepStrictEqual(uses, [1]);
});

test('repeated HTML.NAME references reuse only within one allocation unit', () => {
  // Cycle 96: each top-level statement is its own allocation unit; stored
  // opens a new HTML row in a later statement (24020) and reuses inside one
  // (18446, 20328: two uses in one If).
  const flat = encodeWithHtmlReferenceTrace(`
GetHTMLText(HTML.TEST_CONTENT);
GetHTMLText(HTML.TEST_CONTENT);`);
  assert.equal(flat.htmlReferences.length, 2);
  assert.deepStrictEqual(flat.uses, [1, 2]);

  const oneStatement = encodeWithHtmlReferenceTrace(`
If True Then
   GetHTMLText(HTML.TEST_CONTENT);
   GetHTMLText(HTML.TEST_CONTENT);
End-If;`);
  assert.equal(oneStatement.htmlReferences.length, 1);
  assert.deepStrictEqual(oneStatement.uses, [1, 1]);
});

test('different HTML names allocate different dependencies', () => {
  const { htmlReferences, uses } = encodeWithHtmlReferenceTrace(`
GetHTMLText(HTML.FIRST_CONTENT);
GetHTMLText(HTML.SECOND_CONTENT);`);

  assert.deepStrictEqual(
    htmlReferences.map(reference => reference.fieldName),
    ['FIRST_CONTENT', 'SECOND_CONTENT']
  );
  assert.deepStrictEqual(uses, [1, 2]);
});

test('HTML.NAME gets a fresh dependency in each top-level control region', () => {
  const { htmlReferences, uses } = encodeWithHtmlReferenceTrace(`
If True Then
   GetHTMLText(HTML.TEST_CONTENT);
End-If;

If True Then
   GetHTMLText(HTML.TEST_CONTENT);
End-If;`);

  assert.equal(htmlReferences.length, 2);
  assert.deepStrictEqual(uses, [1, 2]);
});

test('HTML.NAME opens a new row in each Function body statement', () => {
  // Cycle 96: each Function body statement is its own allocation unit
  // (stored: 13559, 13562, 14727, 18130 open a new HTML row in a later
  // body statement).
  const { htmlReferences, uses } = encodeWithHtmlReferenceTrace(`
Function Render()
   GetHTMLText(HTML.TEST_CONTENT);
   GetHTMLText(HTML.TEST_CONTENT);
End-Function;`);

  assert.equal(htmlReferences.length, 2);
  assert.deepStrictEqual(uses, [1, 2]);
});

test('HTML.NAME gets a fresh dependency in each ordinary Function', () => {
  const { htmlReferences, uses } = encodeWithHtmlReferenceTrace(`
Function RenderFirst()
   GetHTMLText(HTML.TEST_CONTENT);
End-Function;

Function RenderSecond()
   GetHTMLText(HTML.TEST_CONTENT);
End-Function;`);

  assert.equal(htmlReferences.length, 2);
  assert.deepStrictEqual(uses, [1, 2]);
});

test('Application Class methods share one compilation-unit HTML namespace', () => {
  const { htmlReferences, uses } = encodeWithHtmlReferenceTrace(`class HtmlTest
   method RenderFirst();
   method RenderSecond();
end-class;

method RenderFirst
   GetHTMLText(HTML.TEST_CONTENT);
end-method;

method RenderSecond
   GetHTMLText(HTML.TEST_CONTENT);
end-method;`);

  assert.equal(htmlReferences.length, 1);
  assert.deepStrictEqual(uses, [1, 1]);
});

test('Application Class fragments share one prior-fragment reference identity', () => {
  const uses: number[] = [];
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method First();
   method Second();
end-class;

method First
   TEST_REC.TEST_FIELD.Value = 1;
end-method;

method Second
   TEST_REC.TEST_FIELD.Value = 2;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    },
    referenceTrace: event => {
      if (event.action === 'USE' && event.reference.kind === 'record-field') {
        uses.push(event.reference.index);
      }
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    { index: 1, sequence: 2, kind: 'record-field', recordName: 'TEST_REC', fieldName: 'TEST_FIELD' }
  ]);
  assert.deepStrictEqual(uses, [1, 1]);
});

// Cycle 68 (definition 29389): this test originally asserted that a bare
// RECORD.FIELD reference in one top-level `If` block allocates a FRESH
// identity from an identical reference in a separate top-level `If` block
// later in the same method -- pinning `ordinaryRecordFieldReference()`'s
// then-current raw-`controlGroup` keying. A corpus-wide census
// (`cycle68-record-field-classwide-census.ts`, 581 candidates, 173 clean
// supporting mismatches, 0 genuine contradictions) proved stored PeopleTools
// instead reuses ONE identity for both occurrences here, matching the
// method-wide reuse `recordScopeId()` already provides for plain RECORD and
// FIELD references (Cycle 43/46). The original assumption was never
// corpus-verified; it is corrected in place rather than left as a stale pin.
test('Application Class shared scope reuses one identity across local control groups within a method', () => {
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   If True Then
      TEST_REC.TEST_FIELD.Value = 1;
   End-If;
   If False Then
      TEST_REC.TEST_FIELD.Value = 2;
   End-If;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    { index: 1, sequence: 2, kind: 'record-field', recordName: 'TEST_REC', fieldName: 'TEST_FIELD' }
  ]);
});

// Negative control: ordinary (non-Application-Class) PeopleCode must keep the
// existing "top-level repeat starts fresh" behavior (ABSENCE_HIST.SHPL_EE_WEEKS
// shape) -- `recordScopeId()` only collapses to a constant for Application
// Class method bodies (`recordDependenciesHaveMethodWideLifetime`), so a
// top-level (non-Application-Class) program's raw `controlGroup` is
// unaffected by this cycle's change. An explicit, different owner is
// supplied so the first TEST_REC.TEST_FIELD occurrence is not itself
// consumed as the program's own implicit owner reference.
test('ordinary PeopleCode top-level RECORD.FIELD repeats still start fresh, unaffected by Cycle 68', () => {
  const encoded = encodeProgramArtifacts(`If True Then
   TEST_REC.TEST_FIELD.Value = 1;
End-If;
If False Then
   TEST_REC.TEST_FIELD.Value = 2;
End-If;`, {
    owner: { recordName: 'OWNER_REC', fieldName: 'OWNER_FIELD' }
  });

  const fieldRefs = encoded.references.filter(r => r.kind === 'record-field');
  assert.strictEqual(fieldRefs.length, 2);
  assert.notStrictEqual(fieldRefs[0].index, fieldRefs[1].index);
});

test('Application Class import and one declaration dependency allocate before bodies', () => {
  const encoded = encodeProgramArtifacts(`import PKG:ImportedClass;

class ReferenceTest
   method Run(&message As Message);
end-class;

method Run
   Local PKG:ImportedClass &value = create PKG:ImportedClass();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: 'IMPORTEDCLASS',
      objectName: 'PKG',
      packagePath: ['PKG'],
      className: 'IMPORTEDCLASS',
      methodName: undefined
    },
    { index: 2, sequence: 3, kind: 'package', packageName: 'MESSAGE', objectName: 'Message' }
  ]);
});

test('Application Class multiple declaration dependencies all allocate before bodies, in declaration order', () => {
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method First(&rs As Rowset) Returns string;
   method Second(&row As Row, &load As boolean);
end-class;

method First
   Return "";
end-method;

method Second
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    { index: 1, sequence: 2, kind: 'package', packageName: 'ROWSET', objectName: 'Rowset' },
    { index: 2, sequence: 3, kind: 'package', packageName: 'ROW', objectName: 'Row' }
  ]);
});

test('Application Class declaration-dependency types allocate before a Declare Function reference even when the class has an inherited %This.method() call', () => {
  // Cycle 60: a corpus-wide census of 82 Application Class definitions
  // with an inherited (not-own-declared) %This.method() call AND at
  // least one undiscovered declaration-dependency type found stored
  // PSPCMNAME allocates an early PACKAGE row for every single one
  // (82/82, zero contradictions) -- `allocateModeledDeclarationDependency()`'s
  // own guard on `hasModeledApplicationClassReferenceScope` (which
  // disables it entirely for classes with an inherited %This call) was
  // too broad: that gate exists for method-dependency reuse uncertainty
  // (Cycle 32/34), not declaration-TYPE discovery. Definitions 28755,
  // 28964, and 29099 (originally suspected of "declare-function
  // misrecognition") are three real-world instances of exactly this
  // shape: a class-header parameter/return type (here, `Rowset`) was
  // being discovered late -- via a coincidental body-level Local
  // declaration, if one happened to exist, or never -- instead of early,
  // landing AFTER a `Declare Function` statement's own reference instead
  // of before it, as stored requires.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run(&x As Rowset);
   method CallInherited();
end-class;

Declare Function ExternalHelper PeopleCode FUNCLIB_TEST.HELPER FieldFormula;

method Run
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    { index: 1, sequence: 2, kind: 'package', packageName: 'ROWSET', objectName: 'Rowset' },
    {
      index: 2,
      sequence: 3,
      kind: 'declare-function',
      recordName: 'FUNCLIB_TEST',
      fieldName: 'HELPER',
      eventName: 'FieldFormula'
    },
    // Cycle 82: the inherited `%This.SomeInheritedMethod()` call allocates
    // the class's own self row (see the self-row tests below).
    {
      index: 3,
      sequence: 4,
      kind: 'package',
      packageName: 'REFERENCETEST',
      objectName: 'PKG',
      packagePath: ['PKG'],
      className: 'REFERENCETEST'
    }
  ]);
});

test('Application Class only the first wildcard import allocates PACKAGE metadata', () => {
  const encoded = encodeProgramArtifacts(`import PKGONE:*;
import PKGTWO:*;

class ReferenceTest
   method Run();
end-class;

method Run
   Local any &x;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: '',
      objectName: 'PKGONE',
      packagePath: ['PKGONE'],
      className: ''
    }
  ]);
});

test('Application Class only the first wildcard import allocates PACKAGE metadata even when the class has an inherited %This.method() call', () => {
  // Cycle 61: `claimWildcardImportMetadata()`'s "only first wildcard
  // claims" tracking previously fell back to unconditional `true` when
  // `applicationClassReferenceSession` was gated off by an inherited
  // (not-own-declared) %This.method() call elsewhere in the class -- a
  // fourth confirmed instance of the same overbroad gate (Cycles 52, 57,
  // 60 each found one before). A corpus-wide census of 28 Application
  // Class definitions with an inherited %This call AND 2+ wildcard
  // imports found stored PSPCMNAME allocates exactly ONE blank-REFNAME
  // metadata row in 27/28 (definition 30197 is a real-world instance,
  // now fully byte-identical after this fix). Routed through the
  // always-present `applicationClassTypeReferenceSession` (Cycle 57)
  // instead -- the same underlying `ApplicationClassReferenceScope`
  // instance and claim-tracking state, not a new cache.
  const encoded = encodeProgramArtifacts(`import PKGONE:*;
import PKGTWO:*;

class ReferenceTest
   method Run();
   method CallInherited();
end-class;

method Run
   Local any &x;
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: '',
      objectName: 'PKGONE',
      packagePath: ['PKGONE'],
      className: ''
    },
    // Cycle 82: self row from the inherited `%This` call.
    {
      index: 2,
      sequence: 3,
      kind: 'package',
      packageName: 'REFERENCETEST',
      objectName: 'PKG',
      packagePath: ['PKG'],
      className: 'REFERENCETEST'
    }
  ]);
});

test('Application Class method-dependency reuse of an existing class-wide type identity is unconditional on the inherited %This.method() gate', () => {
  // Cycle 61 wrote this test as a negative control, ASSUMING (without
  // direct corpus evidence at the time) that an inherited %This.method()
  // call must keep method-dependency reuse gated even for a COMPLETELY
  // UNRELATED, statically-known external class receiver -- i.e. that
  // `hasUnmodeledThisMethodDependencies` should suppress reuse here too.
  //
  // Cycle 62 population evidence overturns that assumption. A corpus-wide
  // census (`cycle62-method-dependency-typeonly-reuse-census.ts`, 722
  // candidates) found that whenever a class-wide TYPE-only identity for a
  // leaf already exists, stored PeopleTools reuses it for a method call
  // instead of allocating a separate method-qualified row -- and this
  // holds EQUALLY for the 47 candidates whose class ALSO has an inherited
  // %This call (zero contradictions). Definition `29109`
  // (`CAFNUI_UTIL:HtmlHelper`, `&helper.GenHtml(...)` called from 7+
  // different methods via `Local CAFNUI_UTIL:HtmlHelper &helper =
  // %This.Manager.HtmlHelper;`) is a real-world instance: stored has
  // exactly ONE row for `HtmlHelper` despite the class having an
  // inherited %This call elsewhere. The inherited-%This-call gate exists
  // for `%This.method()` calls' OWN dispatch uncertainty (Cycle 32/34) --
  // it was never evidenced to extend to an unrelated, statically-known
  // external class receiver, and Cycle 62's fix (routing this lookup
  // through the always-present `applicationClassTypeReferenceSession`,
  // exactly like Cycle 57's own type-only lookups) makes both cases
  // below converge, matching stored.
  //
  // Two methods (Run, RunAgain) each independently `create` the same
  // helper type and call the same method (.DoSomething()) on it. The
  // TYPE reference (sequence 3) is class-wide reused either way (Cycle
  // 57). The METHOD-dependency reference (methodName: 'DOSOMETHING') now
  // reuses that same class-wide type identity in BOTH cases -- whether or
  // not the class also has an unrelated inherited %This call.
  const source = (inherited: boolean) => `class ReferenceTest extends PKG:Base:Parent
   method Run();
   method RunAgain();
   method CallOther();
end-class;

method Run
   %Super.SomeSetup();
   Local PKG:Object:Helper &h = create PKG:Object:Helper();
   &h.DoSomething();
end-method;

method RunAgain
   %Super.SomeSetup();
   Local PKG:Object:Helper &h2 = create PKG:Object:Helper();
   &h2.DoSomething();
end-method;

method CallOther
   ${inherited ? '%This.SomeInheritedMethod();' : '%This.Run();'}
end-method;`;

  const owner = {
    recordName: 'PKG',
    fieldName: 'ReferenceTest',
    packagePath: ['PKG', 'ReferenceTest']
  };

  // Cycle 82: each `.DoSomething()` call now reuses the HELPER identity its
  // own method's `create` already established (method-local reuse, 25/57
  // changed App Class PSPCMNAME lists match stored further, 0 less), so no
  // separate method-qualified row exists in either variant.
  const helperRows = (encoded: ReturnType<typeof encodeProgramArtifacts>) =>
    encoded.references.filter((r: any) => r.kind === 'package' && r.className === 'HELPER');

  const gateOff = encodeProgramArtifacts(source(false), { owner });
  assert.strictEqual(
    helperRows(gateOff).length,
    1,
    'without an inherited %This call, both .DoSomething() calls reuse the one HELPER identity'
  );

  const gateOn = encodeProgramArtifacts(source(true), { owner });
  assert.strictEqual(
    helperRows(gateOn).length,
    1,
    'an unrelated inherited %This call must not prevent reuse of an already-established identity for a different, statically-known receiver'
  );
  assert.strictEqual(
    gateOn.references.filter((r: any) => r.kind === 'package' && r.methodName === 'DOSOMETHING').length,
    0
  );
});

test('Application Class an inherited %This.method() call allocates the class self row, not a base-class row', () => {
  // Cycle 82 replaces an earlier synthetic assertion that this call
  // allocates nothing. Corpus evidence (LOCAL SNAPSHOT): 28886's first
  // `%This` call is the inherited `%This.getDataFromInputJson(...)` and
  // stored has its own `PACKAGE|URL_BENEFITSUMMARY` row there; 29341's
  // stored self row even names an inherited method. Treating inherited
  // calls like own-method calls moves 8 more App Classes to a names-exact
  // PSPCMNAME list and 0 away. Natively, `%This`'s static class is always
  // the compilation unit's own class.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
   method CallInherited();
end-class;

method Run
   Local any &x;
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const packageRefs = encoded.references.filter((r: any) => r.kind === 'package');
  assert.deepStrictEqual(packageRefs.map((r: any) => r.className), ['REFERENCETEST']);
  assert.strictEqual(packageRefs[0].methodName, undefined);
});

test('Application Class own %This.method() calls allocate ONE self row, at the first call, before its arguments', () => {
  // Cycle 82 (LOCAL SNAPSHOT census, `cycle82-self-row-allocation-census.ts`):
  // every App Class with a live own-method `%This` call has exactly one
  // `PACKAGE|<CLASSNAME>` row, at the first call in encode order -- 28713
  // stores CRITERIAUI at NAMENUM 11, between the FIELD rows used before
  // and after its first `%This.IsNeedBrackets(&op)` call. Calls inside
  // comments allocate nothing (28757, 30143).
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
   method Helper(&x As string) Returns boolean;
   method Other();
end-class;

method Run
   /* %This.Other(); */
   Local Record &r = CreateRecord(Record.FIRST_REC);
   If %This.Helper(&r.SECOND_FLD.Value) Then
      %This.Other();
   End-If;
end-method;

method Helper
   Return True;
end-method;

method Other
   %This.Helper("x");
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const rows = encoded.references
    .filter((r: any) => r.kind !== 'owner')
    .map((r: any) => r.kind === 'package' ? `PACKAGE.${r.className ?? r.packageName}` : `${r.kind}.${r.recordName ?? r.fieldName}`);
  assert.deepStrictEqual(rows.filter(row => row === 'PACKAGE.REFERENCETEST').length, 1);
  assert.ok(rows.indexOf('PACKAGE.REFERENCETEST') > rows.indexOf('record.FIRST_REC'));
  assert.ok(rows.indexOf('PACKAGE.REFERENCETEST') < rows.findIndex(row => row.includes('SECOND_FLD')));
});

test('Application Class %This self row reuses an own-class identity already established by a Local', () => {
  // Cycle 82: 28731 declares `Local ADSM:ADSMTreeNode &ChildNode;` in an
  // earlier method; its later `%This.IsNodeHidden()` call adds no second row.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Make() Returns boolean;
   method Check() Returns boolean;
end-class;

method Make
   Local PKG:ReferenceTest &child;
   Return True;
end-method;

method Check
   Return %This.Make();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.strictEqual(
    encoded.references.filter((r: any) => r.kind === 'package' && r.className === 'REFERENCETEST').length,
    1
  );
});

test('Application Class top-level Component App Class declarations allocate at the declaration across the import fragment boundary', () => {
  // Cycle 82: 29420's `Component GPS_WFS_REPORT_MANAGER:MappingEntry
  // &_entry;` (wildcard-imported in the separate leading import fragment,
  // never used elsewhere) is stored at its declaration; 130/130 top-level
  // Global/Component App Class declarations in App Classes have the row.
  const encoded = encodeProgramArtifacts(`import PKG:*;

class ReferenceTest
   method Run();
end-class;

Component PKG:Entry &entry;

method Run
   Local Record &r = CreateRecord(Record.FIRST_REC);
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const rows = encoded.references
    .filter((r: any) => r.kind !== 'owner')
    .map((r: any) => r.kind === 'package' ? `PACKAGE.${r.className ?? r.packageName}` : `${r.kind}.${r.recordName}`);
  assert.strictEqual(rows.filter(row => row === 'PACKAGE.ENTRY').length, 1);
  assert.ok(rows.indexOf('PACKAGE.ENTRY') < rows.indexOf('record.FIRST_REC'));
});

test('Application Class leading method-body App Class Locals allocate at their declaration', () => {
  // Cycle 82: 29413's never-used leading `Local GPS_UTILS:ClassUtility
  // &_classUtil;` is stored before the method's first Record reference.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local PKG:Other:Helper &unused;
   Local Record &r = CreateRecord(Record.FIRST_REC);
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const kinds = encoded.references
    .filter((r: any) => r.kind !== 'owner')
    .map((r: any) => r.kind === 'package' ? `PACKAGE.${r.className ?? r.packageName}` : `${r.kind}.${r.recordName}`);
  assert.ok(kinds.indexOf('PACKAGE.HELPER') >= 0);
  assert.ok(kinds.indexOf('PACKAGE.HELPER') < kinds.indexOf('record.FIRST_REC'));
});

test('Application Class built-in object declarations get method-wide lifetime across control groups', () => {
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local XmlNode &first;
   If True Then
      Local XmlNode &second;
   End-If;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    { index: 1, sequence: 2, kind: 'package', packageName: 'XMLNODE', objectName: 'XmlNode' }
  ]);
});

test('Application Class built-in object declarations reuse one class-wide PACKAGE reference across different methods, even with an unrelated inherited %This.method() call', () => {
  // Cycle 64 (definitions 28755/28964/29099): `ensureLocalObjectPackageReference`
  // already gives built-in-object (Record/Rowset/Row/Field/SQL/File/
  // XmlDoc/XmlNode) `Local` declarations METHOD-WIDE lifetime (Cycle 36,
  // the test immediately above), but never consulted the class-wide
  // `applicationClassTypeReferenceSession` facade Cycle 57 built for
  // Application Class leaf types. Without an inherited %This call, the
  // pre-existing GATED `applicationClassReferenceSession` (`nextReference`'s
  // own Cycle 32 lookup) already reuses across methods -- this construct
  // alone does not isolate the new mechanism. All three real-world
  // targets (28755/28964/29099) have an inherited (not-own-declared)
  // %This.method() call elsewhere in the class, which disables that
  // GATED session (Cycle 32/34) -- exactly the condition this test
  // reproduces to isolate Cycle 64's own fix. A corpus-wide census
  // (`cycle64-builtin-classwide-reuse-census.ts`, 451 (definition,
  // built-in-leaf) candidates declared via `Local` in 2+ methods) found
  // 47 cases where stored collapses to exactly ONE identity across every
  // method while generated allocated 2-30 -- zero contradictions.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
   method RunAgain();
   method CallInherited();
end-class;

method Run
   Local Record &first;
end-method;

method RunAgain
   Local Record &second;
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordPackageRefs = encoded.references.filter(
    (r: any) => r.kind === 'package' && r.packageName === 'RECORD'
  );
  assert.strictEqual(
    recordPackageRefs.length,
    1,
    'a built-in-object leaf declared via Local in two different methods should reuse one class-wide PACKAGE identity, even with an unrelated inherited %This call'
  );
});

test('ordinary PeopleCode built-in object declarations keep their own control-group-scoped lifetime, unaffected by Cycle 64', () => {
  // Negative control: `applicationClassTypeReferenceSession` is only ever
  // populated by `encodeApplicationClassProgramV2` -- ordinary
  // (non-Application-Class) PeopleCode's own Cycle 36 control-group-
  // scoped behavior (401/651 population) must remain exactly as proven,
  // with a genuinely NEW control-group boundary still allocating its own
  // separate PACKAGE/RECORD identity.
  const encoded = encodeProgramArtifacts(`Local Record &first;
If True Then
   Local Record &second;
End-If;`);

  const recordPackageRefs = encoded.references.filter(
    (r: any) => r.kind === 'package' && r.packageName === 'RECORD'
  );
  assert.strictEqual(
    recordPackageRefs.length,
    2,
    'ordinary PeopleCode must keep allocating a separate PACKAGE/RECORD identity per control group, unaffected by the Application-Class-only class-wide reuse fix'
  );
});

test('Application Class local declarations of the same leaf type reuse one PACKAGE reference regardless of scalar vs array-of shape', () => {
  // Cycle 55: a corpus-wide census of 173 Application Class methods
  // declaring 2+ Locals of the same Application-Class leaf type (mixing
  // scalar and array-of freely, up to 21 declarations of one leaf) found
  // stored PSPCMNAME allocates exactly ONE identity in every single case
  // (definition 28882's `Local BEN_EE_DATA_FL:Object:Resource &oResource;`
  // followed by `Local array of BEN_EE_DATA_FL:Object:Resource
  // &arrResource;` is the shape that surfaced this).
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local number &n = 5;
   Local PKG:Object:Resource &oResource;
   Local array of PKG:Object:Resource &arrResource;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: 'RESOURCE',
      objectName: 'PKG',
      packagePath: ['PKG', 'Object'],
      className: 'RESOURCE',
      methodName: undefined
    }
  ]);
});

test('Application Class create-initialized locals reuse the same method-wide PACKAGE identity as plain/array-of locals of the same leaf type', () => {
  // Cycle 56: a corpus-wide census of 1,778 Application Class (method,
  // leaf) create-local candidates found stored PSPCMNAME allocates
  // exactly ONE identity in 1,758/1,778 cases, including every case where
  // a plain/array-of Local declaration of the SAME leaf already exists in
  // the same method (definition 28726's `GetOutgoingRelationships`: a
  // plain `Local ADSM:ADSRelationship &ship;`, an `array of` declaration
  // of the same leaf, and a `create ADSM:ADSRelationship(...)`-initialized
  // local all reuse ONE stored identity; the pre-fix encoder allocated 3
  // for this one method alone). `ensureRuntimeCreateReference` (the
  // `create` expression's own allocator) now checks the same method-wide
  // pool `ensureLocalApplicationClassPackageReference` established in
  // Cycle 55 before falling back to its own dedup, and vice versa.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local number &n = 5;
   Local PKG:Object:Resource &oResource;
   Local array of PKG:Object:Resource &arrResource;
   Local PKG:Object:Resource &created = create PKG:Object:Resource();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: 'RESOURCE',
      objectName: 'PKG',
      packagePath: ['PKG', 'Object'],
      className: 'RESOURCE',
      methodName: undefined
    }
  ]);
});

test('Application Class method-local create/Local references reuse a class-wide identity already established by an explicit import', () => {
  // Cycle 57: a corpus-wide census of 1,053 class-wide/import-established
  // (definition, leaf) candidates found stored PSPCMNAME converges to
  // ONE identity in 1,041/1,053 cases when a method-local Local/create
  // occurrence resolves to a leaf already named by an explicit import,
  // property, instance, or method parameter/return type elsewhere in the
  // class. `nextReference`'s own `applicationClassReferenceSession.lookup()`
  // already handled 906/920 of these (every class with no inherited
  // `%This.method()` call); the new `applicationClassTypeReferenceSession`
  // (always present, unlike the gated session) resolves the remaining
  // 106 of 133 candidates whose class DOES have an inherited call
  // elsewhere -- see the next test.
  const encoded = encodeProgramArtifacts(`import PKG:Object:Resource;

class ReferenceTest
   method Run();
end-class;

method Run
   Local PKG:Object:Resource &oResource;
   &oResource = create PKG:Object:Resource();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  assert.deepStrictEqual(encoded.references, [
    { index: 0, sequence: 1, kind: 'owner', recordName: undefined, fieldName: undefined },
    {
      index: 1,
      sequence: 2,
      kind: 'package',
      packageName: 'RESOURCE',
      objectName: 'PKG',
      packagePath: ['PKG', 'Object'],
      className: 'RESOURCE',
      methodName: undefined
    }
  ]);
});

test('Application Class class-wide reuse survives an unrelated inherited %This.method() call that disables the gated cross-fragment session', () => {
  // Cycle 57's key finding: `hasModeledApplicationClassReferenceScope`
  // (and the `applicationClassReferenceSession` it gates) is disabled
  // entirely whenever the class has ANY inherited (not-own-declared)
  // `%This.method()` call -- a Cycle 32/34 rule that is genuinely about
  // method-dependency resolution uncertainty, not about plain TYPE
  // reuse. The new, ALWAYS-present `applicationClassTypeReferenceSession`
  // is unaffected by that gate, so class-wide TYPE reuse still works here
  // even though `%This.SomeInheritedMethod()` (a method this class does
  // not itself declare) is present.
  const encoded = encodeProgramArtifacts(`import PKG:Object:Resource;

class ReferenceTest extends PKG:Base:Parent
   method Run();
end-class;

method Run
   %This.SomeInheritedMethod();
   Local PKG:Object:Resource &oResource;
   &oResource = create PKG:Object:Resource();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const resourceRefs = encoded.references.filter(
    (r): r is Extract<typeof r, { kind: 'package' }> => r.kind === 'package' && r.className === 'RESOURCE'
  );
  assert.strictEqual(resourceRefs.length, 1);
});

test('Application Class RECORD dependencies get method-wide lifetime across flat top-level statements', () => {
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local string &a = GetLevel0()(1).GetRecord(Record.TEST_REC).GetField(Field.A).Value;
   Local string &b = GetLevel0()(1).GetRecord(Record.TEST_REC).GetField(Field.B).Value;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.equal(recordReferences.length, 1);
  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(fieldReferences.map(r => (r as { fieldName: string }).fieldName), ['A', 'B']);
});

test('Application Class row-shorthand RECORD access reuses an earlier same-scope RECORD identity', () => {
  // Regression control for the Cycle 42 fix attempt that broke this exact
  // shape: a row-shorthand `.RECORDNAME` postfix access (resolved through
  // `resolvePostfixMemberReuse`'s own raw read of the SAME underlying pool
  // `dependencyScope.recordRecord` writes to) must keep finding what an
  // earlier `CreateRecord(Record.X)` already allocated once Application
  // Class RECORD dependencies get method-wide lifetime -- not silently
  // miss it and allocate a duplicate.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local Record &rec = CreateRecord(Record.TEST_REC);
   Local Rowset &rs = CreateRowset(Record.TEST_REC);
   &rs.GetRow(1).TEST_REC.CopyFieldsTo(&rec);
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.equal(recordReferences.length, 1);
});

test('ordinary PeopleCode RECORD reuse remains control-group-scoped, not method-wide', () => {
  // Negative control: outside an Application Class, two flat top-level
  // GetRecord(Record.X) calls must NOT be unified -- this is the existing,
  // load-bearing behavior Application Class method-wide lifetime must not
  // regress.
  const encoded = encodeProgramArtifacts(
    `Local string &a = GetLevel0()(1).GetRecord(Record.TEST_REC).GetField(Field.A).Value;
Local string &b = GetLevel0()(1).GetRecord(Record.TEST_REC).GetField(Field.B).Value;`
  );

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.equal(recordReferences.length, 2);
});

test('indexed array-of-Record element row-shorthand field access resolves as a FIELD dependency', () => {
  // Cycle 45 (definition 29522): `Local array of Record &Arr;` never joined
  // `recordVariables`, so an indexed element's bare `.FIELDNAME` shorthand
  // fell through to plain inline text instead of a 0x4A FIELD reference --
  // unlike a scalar `Local Record &rec;`, whose `.FIELDNAME` already worked.
  const encoded = encodeProgramArtifacts(
    `Local array of Record &Arr;
Local number &i;
&Arr = CreateArrayRept(CreateRecord(Record.TEST_REC), 0);
For &i = 1 To 3
   If &Arr [&i].A.Value = "X" Then
      &Arr [1].B.Value = "Y";
   End-If;
End-For;`
  );

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName),
    ['A', 'B']
  );
});

test('a bare array-of-Record variable keeps its own Array properties/methods inline, not FIELD references', () => {
  // Negative control for the fix above: the SAME variable used WITHOUT
  // indexing first (`&Arr.Len`, an intrinsic Array property) must stay
  // plain inline text -- only an INDEXED element narrows the variable's
  // type from Array to Record. Folding array-of-Record variables into the
  // scalar `recordVariables` set directly (rather than gating on the `[`
  // that must precede the member access) regressed exactly this shape
  // during Cycle 45's own investigation.
  const encoded = encodeProgramArtifacts(
    `Local array of Record &Arr;
Local number &i;
&Arr = CreateArrayRept(CreateRecord(Record.TEST_REC), 0);
If &Arr.Len = 0 Then
   &i = 0;
End-If;
&i = &Arr [1].A.Value;`
  );

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName),
    ['A']
  );
});

test('a Record-typed Function parameter resolves bare field-shorthand access as a FIELD dependency', () => {
  // Cycle 45: the same class of declaration-tracking gap the existing
  // Row-typed-parameter fix (see its own comment) already covers, but for
  // Record -- a `Record`-typed Function PARAMETER never joined
  // `recordVariables`, so its own bare `.FIELDNAME` fell through to plain
  // inline text instead of a FIELD reference.
  const encoded = encodeProgramArtifacts(
    `Function UseRecord(&rec As Record)
   Local string &v = &rec.A.Value;
   &rec.B.Value = &v;
End-Function;`
  );

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName),
    ['A', 'B']
  );
});

test('Application Class method Record parameter resolves bare field-shorthand access as a FIELD dependency', () => {
  // Cycle 46 (definition 29522): an Application Class method
  // IMPLEMENTATION's own parameter list was never threaded into its body's
  // own `encodeFragmentInternal` call at all -- `&AbsenceRec As Record`
  // (declared only in the class header/implementation signature, not
  // re-parsed from body text) needs the SAME `recordVariables` registration
  // a `Local Record &rec;` or an ordinary Function parameter already gets.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run(&AbsenceRec As Record);
end-class;

method Run
   Local string &v = &AbsenceRec.EMPLID.Value;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName),
    ['EMPLID']
  );
});

test('Application Class method Record parameter field access reuses across control groups within one method', () => {
  // Cycle 46 (definition 29522): stored reuses ONE FIELD reference for the
  // SAME Record-typed parameter's SAME field accessed twice in one method,
  // even across different control groups (two separate `If` statements
  // here) -- `fieldDependencyScope`/`recordVariableFields` never got Cycle
  // 43's method-wide-lifetime treatment (`recordScopeId()` only covered
  // RECORD/SCROLL via `dependencyScope`), so a second, unwanted FIELD
  // reference was allocated instead of reusing the first.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run(&AbsenceRec As Record);
end-class;

method Run
   If &AbsenceRec.EMPLID.Value = "X" Then
      Return;
   End-If;
   If &AbsenceRec.EMPLID.Value = "Y" Then
      Return;
   End-If;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.equal(fieldReferences.length, 1);
});

test('Application Class bare-member FIELD access reuses one class-wide identity across different methods, even with an unrelated inherited %This.method() call', () => {
  // Cycle 65 (definition 29099, among 246 corpus candidates): Cycle 46's
  // `fieldDependencyScope` already gives bare-member FIELD access
  // METHOD-WIDE lifetime (the test immediately above), but -- like Cycle
  // 64's `ensureLocalObjectPackageReference` before it -- never consulted
  // the class-wide `applicationClassTypeReferenceSession` facade (Cycle
  // 57) before falling back to a fresh allocation, so the SAME field name
  // accessed from a SECOND method's own Record-typed receiver allocated
  // its own duplicate FIELD row. A corpus-wide census
  // (`cycle65-field-classwide-reuse-census.ts`, 1,575 (definition,
  // field-name) candidates referenced in 2+ methods) found 246 cases
  // where stored collapses to exactly ONE identity across every method
  // while generated allocated 2+ -- the only contradicting-looking
  // mismatches (13, all definition `29797`) are the same already-known,
  // pre-existing, unrelated multi-identity gap Cycles 56/57/62/64 each
  // found (generated was already 1 before this cycle, unaffected). Like
  // Cycle 64, mirrors the inherited-%This-call condition so this test
  // isolates the class-wide facade rather than the pre-existing GATED
  // `applicationClassReferenceSession` (which already reuses across
  // methods when the class has no inherited call at all).
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run(&AbsenceRec As Record);
   method RunAgain(&OtherRec As Record);
   method CallInherited();
end-class;

method Run
   Local string &v = &AbsenceRec.EMPLID.Value;
end-method;

method RunAgain
   Local string &v2 = &OtherRec.EMPLID.Value;
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.strictEqual(
    fieldReferences.length,
    1,
    'the same field name accessed via bare-member on two different methods\' Record-typed receivers should reuse one class-wide FIELD identity, even with an unrelated inherited %This call'
  );
});

test('Field.X used twice as a GetField(...) argument on a stored Record variable remains occurrence-based, unaffected by Cycle 65', () => {
  // Negative control: this is the SAME already-calibrated construct the
  // existing test 'encodeProgramArtifacts allocates repeated Scroll and
  // Field references by occurrence' covers (GetField(Field.CODE) called
  // twice on a STORED, not-freshly-.GetRecord(...)-chained, Record
  // variable) -- Cycle 65's own fix lives entirely in the bare-member
  // postfix-chain fallback (`dependencyKind === 'field'`), a completely
  // different code path from GetField(...)'s own method-call argument
  // parsing, so this must remain unaffected.
  const encoded = encodeProgramArtifacts(
    `Local Record &rec;
Local Field &fld1, &fld2;

&rec = GetRecord(Record.OU_CORPUS);

&fld1 = &rec.GetField(Field.CODE);
&fld2 = &rec.GetField(Field.CODE);`
  );

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.strictEqual(
    fieldReferences.length,
    2,
    'GetField(Field.CODE) called twice on a stored Record variable must remain occurrence-based, unaffected by Cycle 65\'s bare-member class-wide reuse fix'
  );
});

test('Application Class explicit Field.X repeated in adjacent CreateArray(...) statements reuses one identity', () => {
  // Cycle 66 (definition 29099): within ONE method, two adjacent
  // `CreateArray(...)` statements each contain a bare, explicit `Field.X`
  // argument for the same field name -- stored PeopleTools reuses ONE
  // identity; the pre-Cycle-66 encoder allocated a fresh, occurrence-based
  // row for each (matching `fieldReference()`'s own general default,
  // deliberately correct for `GetField(...)` but not for this shape). A
  // corpus-wide census (`cycle66-field-consumer-context-census.ts`, 58
  // (definition, field-name) candidates with 2+ NON-GetField bare Field.X
  // occurrences) found 100% support once GetField's own argument is
  // excluded (0 contradictions) -- broken down by enclosing call
  // (`CreateArray`, other Application Class method calls such as
  // `%This.GetSpecificRow(...)`/`%This.GetLongTranslateValue(...)`, and no
  // enclosing call at all), confirming the discriminator is "is this
  // Field.X a GetField(...) argument", not "is this specifically
  // CreateArray".
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Chart();
end-class;

method Chart
   %This.FieldsUsed = CreateArray(Field.CAF_TEXT_1, Field.CAF_RECNAME);
   %This.FieldsRequired = CreateArray(Field.CAF_RECNAME, Field.CAF_TEXT_1);
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName).sort(),
    ['CAF_RECNAME', 'CAF_TEXT_1'],
    'CAF_RECNAME and CAF_TEXT_1 should each reuse one identity across both CreateArray(...) statements, not allocate a fresh row per occurrence'
  );
});

// Cycle 69 (definition 29389): this test originally asserted that
// `GetField(...)` always owns its own explicit Field.X argument's
// occurrence, even inside an Application Class method body -- but the
// "existing calibrated test" Cycle 66 cited as proof
// ('encodeProgramArtifacts allocates repeated Scroll and Field references
// by occurrence', still above) supplies no Application Class `owner` (no
// `packagePath`): it is ordinary PeopleCode, where this reuse check is
// already gated off by `recordDependenciesHaveMethodWideLifetime`, so
// that test's outcome never actually depended on GetField-occurrence
// ownership at all -- it was an untested extrapolation into the
// Application Class case. A corpus-wide census
// (`cycle69-getfield-argument-reuse-census.ts`, 296 candidates) found 78
// Application Class cases where stored reuses ONE identity across
// repeated receiver-based `.GetField(Field.X)` calls (0 contradictions,
// 0 matched cases with a stored count of 2+), matching `29389`'s own
// `&_recDtl.GetField(Field.EFFDT)` called from two different `SQLExec(...)`
// statements. Corrected in place rather than left as a stale pin.
test('Application Class GetField(Field.CODE) called twice reuses one identity, corrected by Cycle 69', () => {
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local Record &rec = GetRecord(Record.OU_CORPUS);
   Local Field &fld1, &fld2;
   &fld1 = &rec.GetField(Field.CODE);
   &fld2 = &rec.GetField(Field.CODE);
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.strictEqual(
    fieldReferences.length,
    1,
    'GetField(Field.CODE) called twice inside an Application Class method reuses one identity, per Cycle 69\'s corpus evidence'
  );
});

test('%Super.<inheritedProperty> allocates the ancestor-declared Application Class type dependency', () => {
  // Cycle 67 (definition 28964, among a 28-candidate corpus-supported
  // population with zero contradictions): `%Super.<property>` accesses an
  // INHERITED property -- declared on an ANCESTOR class, never on this
  // class's own source, so the declaration-dependency prepass (Cycle 52/
  // 60, which only ever scans THIS class's own header) can never discover
  // its type. The caller externally resolves the ancestor's own property
  // declarations (e.g. from local snapshot metadata, when the ancestor is
  // itself locally resolvable) and supplies them via the new
  // `inheritedPropertyTypes` context field. Setting
  // `activeApplicationClassReceiver` for the resolved property reuses the
  // EXISTING, already-proven `isMethodCall` branch (Cycle 62) to allocate
  // the type dependency exactly the same way a
  // `&typedVariable.Property.Method(...)` chain already does -- no new
  // allocation path. Definition `28972`'s own stored PSPCMNAME (namenum 9,
  // `PACKAGE.TEXTCATALOG`, landing AFTER a body-level `RECORD.FIELD`
  // reference at namenum 8) proves this is allocated at the point of
  // first body-level use, not via the early declaration-dependency
  // prepass -- exactly what routing it through the postfix-chain's own
  // `isMethodCall` branch (rather than the prepass) naturally produces.
  const encoded = encodeProgramArtifacts(`class ReferenceTest extends PKG:Base:Parent
   method Run();
end-class;

method Run
   Local string &x = %Super.TxtCat.getSimpleTextPlan("A", "B");
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    },
    inheritedPropertyTypes: new Map([['txtcat', 'BEN_SUMMARY_FL:Utility:TextCatalog']])
  });

  const packageRefs = encoded.references.filter(
    (r: any) => r.kind === 'package' && (r.className ?? r.packageName) === 'TEXTCATALOG'
  );
  assert.strictEqual(
    packageRefs.length,
    1,
    '%Super.TxtCat should allocate a PACKAGE dependency for its ancestor-declared TextCatalog type when inheritedPropertyTypes resolves it'
  );
});

test('%Super.<property> with no resolved inherited type allocates nothing, unaffected by Cycle 67', () => {
  // Mandatory negative control (Phase 14/38): when the ancestor chain is
  // NOT locally resolvable (definition 28964's own real-world case --
  // `inheritedPropertyTypes` omitted or missing the entry), `%Super.<property>`
  // must fall back to its pre-Cycle-67 behavior -- plain inline text, zero
  // PACKAGE references -- rather than guessing.
  const encoded = encodeProgramArtifacts(`class ReferenceTest extends PKG:Base:Parent
   method Run();
end-class;

method Run
   Local string &x = %Super.TxtCat.getSimpleTextPlan("A", "B");
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const textCatalogRefs = encoded.references.filter(
    (r: any) => r.kind === 'package' && (r.className ?? r.packageName) === 'TEXTCATALOG'
  );
  assert.strictEqual(
    textCatalogRefs.length,
    0,
    'without a resolved ancestor property type, %Super.<property> must not allocate any PACKAGE reference for it'
  );
});

test('a Record-typed variable\'s own bare row-state member stays inline text, not a FIELD reference', () => {
  // Cycle 46 (definition 29522): `&AbsenceRec.IsDeleted` -- a Record-typed
  // receiver's own bare row-state property -- must stay inline, exactly
  // like `isInlineRowStateMember` already keeps `&row.IsDeleted` inline for
  // a Row-typed receiver (dependencyKind 'record'). Extending Cycle 46's
  // parameter threading without this regressed 29522 itself: once
  // `&AbsenceRec` became field-mode-eligible at all, `.IsDeleted` was
  // wrongly caught by the same "any bare member is a FIELD" rule.
  const encoded = encodeProgramArtifacts(
    `Function UseRecord(&rec As Record)
   If &rec.IsDeleted Then
      Return;
   End-If;
   Local string &v = &rec.A.Value;
End-Function;`
  );

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName),
    ['A']
  );
});

test('a Record-typed variable\'s own bare .Name stays inline text, not a FIELD reference', () => {
  // Cycle 63 (definitions 29144/29202): `.Name` on a Record-typed
  // receiver is the intrinsic Record-object property (the record's own
  // technical name as a string), encoded by stored PeopleTools as plain
  // inline member text -- exactly like `.Value`/`.IsDeleted`/any other
  // non-field member -- never a FIELD PSPCMNAME reference. A corpus-wide
  // census (`cycle63-name-intrinsic-census.ts`) found 144 definitions
  // where the encoder previously allocated a spurious FIELD reference for
  // a bare `.Name` on a Record-typed receiver, and ZERO of them have a
  // matching FIELD row in stored PSPCMNAME -- i.e. zero evidence a real
  // field literally named NAME is ever reached through this bare
  // shorthand. `.Name` now joins `isInlineRowStateMember`'s existing
  // exclusion set alongside `RowNumber`/`IsChanged`/etc. An ordinary
  // field access on the SAME receiver (`.A.Value`) must remain a genuine
  // FIELD reference, unaffected.
  const encoded = encodeProgramArtifacts(
    `Function UseRecord(&rec As Record)
   Local string &n = &rec.Name;
   Local string &v = &rec.A.Value;
End-Function;`
  );

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName),
    ['A']
  );
});

test('a genuine field literally named NAME, reached via GetField, still allocates a FIELD reference', () => {
  // Negative control (Cycle 63 Phase 22/27): the intrinsic `.Name`
  // exclusion is scoped to the bare-member shorthand only
  // (`dependencyKind === 'record' | 'field'`'s own bare-postfix path) --
  // it must not suppress an EXPLICIT `Field.NAME`/`GetField(Field.NAME)`
  // reference to a genuinely-named field, which goes through the
  // established, separately-evidenced Field-reference mechanism
  // untouched by this cycle's change.
  const encoded = encodeProgramArtifacts(
    `Function UseRecord(&rec As Record)
   Local Field &f = &rec.GetField(Field.NAME);
   Local string &v = &f.Value;
End-Function;`
  );

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName),
    ['NAME']
  );
});

test('Application Class method parameters do not leak into another method', () => {
  // Cycle 46: `EncodeFragmentContext.methodParameters` seeds ONE method
  // implementation fragment's own type environment -- each method body is
  // its own fresh `encodeFragmentInternal` call, so a Record-typed
  // parameter declared on one method must not make an unrelated bare
  // identifier of the same name in a DIFFERENT method resolve as a FIELD
  // dependency.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method WithParam(&AbsenceRec As Record);
   method WithoutParam();
end-class;

method WithParam
   Local string &v = &AbsenceRec.EMPLID.Value;
end-method;

method WithoutParam
   Local string &AbsenceRec = "not a record here";
   Local string &v2 = &AbsenceRec;
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const fieldReferences = encoded.references.filter(r => r.kind === 'field');
  assert.deepStrictEqual(
    fieldReferences.map(r => (r as { fieldName: string }).fieldName),
    ['EMPLID']
  );
});

test('ordinary Function Row/Record/Rowset parameter registration is unchanged after the registerTypedParameter refactor', () => {
  // Cycle 46 refactored the Function-parameter loop's Record/Row/Rowset
  // branches to call the shared `registerTypedParameter` helper instead of
  // three inlined branches -- this is a pure refactor and must not change
  // any existing Function-parameter behavior (Row: definitions 921/924;
  // Record: Cycle 45; Rowset: originally Cycle 7's narrow
  // `chainSemanticsDeclaredRowsetVariables`-only treatment, since widened
  // to also allocate PACKAGE/ROWSET -- see the dedicated Rowset-parameter
  // test below for that fix's own evidence).
  const recordEncoded = encodeProgramArtifacts(
    `Function UseRecord(&rec As Record)
   Local string &v = &rec.A.Value;
End-Function;`
  );
  assert.deepStrictEqual(
    recordEncoded.references.filter(r => r.kind === 'field').map(r => (r as { fieldName: string }).fieldName),
    ['A']
  );

  const rowEncoded = encodeProgramArtifacts(
    `Function UseRow(&rowCategory As Row)
   &rowCategory.AGC_DERIVED_ASG.GROUPBOX4.Visible = True;
End-Function;`
  );
  assert.deepStrictEqual(
    rowEncoded.references.filter(r => r.kind === 'record').map(r => (r as { recordName: string }).recordName),
    ['AGC_DERIVED_ASG']
  );
});

test('Application Class CreateRecord reuses an existing RECORD identity across control groups within one method', () => {
  // Cycle 47 (definition 29522): `&ConfRec_bef = CreateRecord(Record.X);
  // ... &ConfRec = CreateRecord(Record.X);` -- two SEPARATE CreateRecord
  // calls to the SAME record name, assigned to two DIFFERENT target
  // variables, separated by an If/Else block (different control groups).
  // Stored reuses ONE RECORD row for both; population census (repeated
  // same-record-name CreateRecord calls within one Application Class
  // method) found 83/84 (99%) reuse this way, vs. ordinary PeopleCode's
  // separately-calibrated, genuinely mixed 58/221 occurrence-based
  // behavior -- this fix is gated to Application Class fragments only.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local Record &RecA, &RecB;
   &RecA = CreateRecord(Record.TEST_REC);
   If &RecA.FIELD_A.Value = "X" Then
      &RecA.FIELD_A.Value = "Y";
   End-If;
   &RecB = CreateRecord(Record.TEST_REC);
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.equal(recordReferences.length, 1);
});

test('Application Class CreateRecord reuses a RECORD identity established by GetRecord earlier in the method', () => {
  // Cycle 47: CreateRecord's new read path goes through the SAME
  // `dependencyScope.lookupRecord` map `GetRecord`/etc. already write into
  // unconditionally -- an earlier GetRecord(Record.X) in the same method
  // must also be reusable by a LATER CreateRecord(Record.X).
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
end-class;

method Run
   Local Record &RecA, &RecB;
   &RecA = GetLevel0()(1).GetRecord(Record.TEST_REC);
   &RecB = CreateRecord(Record.TEST_REC);
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.equal(recordReferences.length, 1);
});

test('Application Class GetRecord(Record.X) reuses one class-wide RECORD identity across different methods, even with an unrelated inherited %This.method() call', () => {
  // Cycle 71 (definitions 28726/28954/...): `dependencyScope.lookupRecord`
  // already gives GetRecord(Record.X)/Select(Record.X) METHOD-WIDE
  // lifetime (Cycle 43), but -- like Cycle 65's FIELD fix before it --
  // never consulted the class-wide `applicationClassTypeReferenceSession`
  // facade (Cycle 57) before falling back to a fresh allocation, so the
  // SAME record name reached from a SECOND method allocated its own
  // duplicate RECORD row. A corpus-wide census
  // (`cycle68-record-scroll-classwide-census.ts`, 318 (definition, record)
  // candidates referenced in 2+ methods) found this exact shape (e.g.
  // `28726`'s `CreateRowset(Record.PSADSDEFNITEM)` in one method and
  // `CreateRecord(Record.PSADSDEFNITEM)` in another, sharing ONE stored
  // identity) with 0 contradictions.
  //
  // A third method with an unrelated inherited %This.method() call is
  // mandatory here (matching Cycle 65's own FIELD test precedent): without
  // it, `nextReference()`'s own universal, GATED `applicationClassReferenceSession`
  // check (Cycle 32 -- active whenever the class has NO inherited %This
  // call at all) already provides cross-fragment reuse for EVERY reference
  // kind, masking whether the class-wide TYPE-only facade this cycle wires
  // RECORD/SCROLL into is actually doing any work.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
   method RunAgain();
   method CallInherited();
end-class;

method Run
   Local Record &RecA = GetLevel0()(1).GetRecord(Record.TEST_REC);
end-method;

method RunAgain
   Local Record &RecB = GetLevel0()(1).GetRecord(Record.TEST_REC);
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.strictEqual(recordReferences.length, 1);
});

test('Application Class GetRowset(Scroll.X) reuses one class-wide SCROLL identity across different methods, even with an unrelated inherited %This.method() call', () => {
  // Cycle 71 SCROLL-side counterpart to the RECORD test above --
  // `dependencyScope.lookupScroll` had the identical gap. Same mandatory
  // inherited-%This-call gating as above.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
   method RunAgain();
   method CallInherited();
end-class;

method Run
   Local Rowset &RsA = GetLevel0()(1).GetRowset(Scroll.TEST_SCROLL);
end-method;

method RunAgain
   Local Rowset &RsB = GetLevel0()(1).GetRowset(Scroll.TEST_SCROLL);
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const scrollReferences = encoded.references.filter(r => r.kind === 'scroll');
  assert.strictEqual(scrollReferences.length, 1);
});

test('Application Class RECORD and SCROLL of the same textual leaf remain distinct class-wide identities', () => {
  // Mandatory negative control (Phase 20/26): the class-wide facade key
  // includes `kind`, so Record.X and Scroll.X sharing the same leaf text
  // must NOT collapse into one identity even though both are now
  // class-wide reused independently. Same mandatory inherited-%This-call
  // gating as the two tests above.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
   method RunAgain();
   method CallInherited();
end-class;

method Run
   Local Record &RecA = GetLevel0()(1).GetRecord(Record.TEST_REC);
end-method;

method RunAgain
   Local Rowset &RsA = GetLevel0()(1).GetRowset(Scroll.TEST_REC);
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  const scrollReferences = encoded.references.filter(r => r.kind === 'scroll');
  assert.strictEqual(recordReferences.length, 1);
  assert.strictEqual(scrollReferences.length, 1);
  assert.notStrictEqual(recordReferences[0].index, scrollReferences[0].index);
});

test('Application Class Record.X passed to a generic method-call argument reuses one class-wide identity across methods, even with an unrelated inherited %This.method() call', () => {
  // Cycle 72 (definitions 28954/28998/...): outside every RECORD-aware
  // consumer (GetRecord/Select/GetSetId/CreateRecord's own argument),
  // `recordReference()` had NO reuse check at all -- a bare `Record.X`
  // passed to some OTHER, generic consumer (an Application Class method
  // call, an arbitrary function) always allocated fresh, even though
  // Cycle 66 already proved the analogous rule for `Field.X`. A
  // corpus-wide census (`cycle72-generic-record-argument-census.ts`, 511
  // RECORD candidates repeated 2+ times via a non-RECORD-aware consumer)
  // found 69 supporting mismatches, 0 contradictions.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run(&obj As ReferenceTest);
   method RunAgain(&obj As ReferenceTest);
   method Consume(&rec As Record);
   method CallInherited();
end-class;

method Run
   %This.Consume(Record.TEST_REC);
end-method;

method RunAgain
   %This.Consume(Record.TEST_REC);
end-method;

method Consume
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.strictEqual(recordReferences.length, 1);
});

test('Application Class Scroll.X passed to a generic method-call argument reuses one class-wide identity across methods, even with an unrelated inherited %This.method() call', () => {
  // Cycle 72 SCROLL-side counterpart to the RECORD test above (180
  // corpus candidates, 0 contradictions, now 100% matched).
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
   method RunAgain();
   method Consume(&scrollName As string);
   method CallInherited();
end-class;

method Run
   %This.Consume(Scroll.TEST_SCROLL);
end-method;

method RunAgain
   %This.Consume(Scroll.TEST_SCROLL);
end-method;

method Consume
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const scrollReferences = encoded.references.filter(r => r.kind === 'scroll');
  assert.strictEqual(scrollReferences.length, 1);
});

test('Application Class CreateRecord(Record.X) behavior is unaffected by Cycle 72 (its own, pre-existing, separately-calibrated rule)', () => {
  // Mandatory negative control (Phase 32/33): CreateRecord's own argument
  // must remain governed by its OWN, separately-calibrated rule (Cycle
  // 43/47), never Cycle 72's new generic-argument fallback --
  // `reuseRowShorthandRecord` (set only for CreateRecord's own argument)
  // explicitly excludes it from the new unconditional class-wide check.
  //
  // Verified via `git stash` that this exact source already produces ONE
  // shared identity on Cycle 71's own code (a PRE-EXISTING cross-method
  // CreateRecord mechanism, unrelated to and unchanged by this cycle) --
  // an earlier draft of this test wrongly assumed CreateRecord stays
  // occurrence-based across methods here and asserted `2`, which failed
  // (`1 !== 2`); the failure was investigated and confirmed to be a wrong
  // test assumption, not a Cycle 72 regression, before correcting the
  // assertion to `1`.
  const encoded = encodeProgramArtifacts(`class ReferenceTest
   method Run();
   method RunAgain();
   method CallInherited();
end-class;

method Run
   Local Record &RecA = CreateRecord(Record.TEST_REC);
end-method;

method RunAgain
   Local Record &RecB = CreateRecord(Record.TEST_REC);
end-method;

method CallInherited
   %This.SomeInheritedMethod();
end-method;`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'ReferenceTest',
      packagePath: ['PKG', 'ReferenceTest']
    }
  });

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.strictEqual(recordReferences.length, 1);
});

test('ordinary PeopleCode CreateRecord reuse remains occurrence-based, not method-wide', () => {
  // Negative control: outside an Application Class, two flat top-level
  // CreateRecord(Record.X) calls to DIFFERENT target variables must NOT be
  // unified -- this is the existing, separately-calibrated, load-bearing
  // "occurrence-based" behavior Application Class method-wide CreateRecord
  // reuse must not regress (population census: 146/221 ordinary
  // same-method-repeated candidates allocate fresh each time).
  const encoded = encodeProgramArtifacts(
    `Local Record &RecA, &RecB;
&RecA = CreateRecord(Record.TEST_REC);
&RecB = CreateRecord(Record.TEST_REC);`
  );

  const recordReferences = encoded.references.filter(r => r.kind === 'record');
  assert.equal(recordReferences.length, 2);
});

test('a File-typed Function parameter allocates an implicit PACKAGE/FILE dependency row', () => {
  // Cycle 74 (definitions 7499/7500/..., among a 53-candidate corpus
  // population with 0 contradictions): `Local File &f;` already allocates
  // PACKAGE/FILE (see the ApiObject/Grid/ProcessRequest tests' own
  // precedent), but `Function X(&f As File, ...)` never did -- the
  // parameter-typing dispatch only ever recognized Record/Row/Rowset.
  const encoded = encodeProgramArtifacts(
    `Function EDI_ALC1(&EDIFile As File, &Rec As Record, &bWrite As boolean) Returns boolean
   Local string &s = &EDIFile.IsOpen;
   Return True;
End-Function;`
  );

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.ok(
    packageReferences.some(r => r.packageName === 'FILE'),
    'a File-typed Function parameter must allocate a PACKAGE/FILE dependency row'
  );
});

test('a string-typed Function parameter does not allocate a PACKAGE/FILE dependency row, unaffected by Cycle 74', () => {
  // Mandatory negative control: only a genuine File-typed parameter
  // triggers the new allocation -- an unrelated scalar-typed parameter in
  // the same function must not.
  const encoded = encodeProgramArtifacts(
    `Function DoSomething(&s As string) Returns boolean
   Return True;
End-Function;`
  );

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.strictEqual(packageReferences.filter(r => r.packageName === 'FILE').length, 0);
});

test('a Global File declaration allocates an implicit PACKAGE/FILE dependency row', () => {
  // Cycle 75 (Application Engine definitions 25388/25391/..., among a
  // 965-candidate corpus population with 0 genuine contradictions --
  // the 2 apparent negative controls found during the census were both
  // `rem`-commented, non-compiled declarations): `globalDeclaration()`
  // had NO general built-in-type dispatch at all (only one array-of-Record
  // special case), unlike `Local File &f;`, which already allocates
  // PACKAGE/FILE.
  const encoded = encodeProgramArtifacts(
    `Global File &log;
&log = GetFile("test.txt", "W", %FilePath_Absolute);`
  );

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.ok(
    packageReferences.some(r => r.packageName === 'FILE'),
    'a Global File declaration must allocate a PACKAGE/FILE dependency row'
  );
});

test('a Global string declaration does not allocate a PACKAGE/FILE dependency row, unaffected by Cycle 75', () => {
  // Mandatory negative control: only a genuine File-typed Global
  // declaration triggers the new allocation.
  const encoded = encodeProgramArtifacts(`Global string &s;`);

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.strictEqual(packageReferences.filter(r => r.packageName === 'FILE').length, 0);
});

test('a Component File declaration allocates an implicit PACKAGE/FILE dependency row', () => {
  // Cycle 75 (Application Engine definitions 25969/25971/..., 11-candidate
  // corpus population, 0 contradictions): `componentDeclaration()`
  // already handles Record/Rowset/XmlDoc for this identical reason (see
  // those cases' own comments) -- File was the exact gap the XmlDoc
  // comment flagged as "unconfirmed," now confirmed.
  const encoded = encodeProgramArtifacts(
    `Component File &log;
&log = GetFile("test.txt", "W", %FilePath_Absolute);`
  );

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.ok(
    packageReferences.some(r => r.packageName === 'FILE'),
    'a Component File declaration must allocate a PACKAGE/FILE dependency row'
  );
});

test('a Component string declaration does not allocate a PACKAGE/FILE dependency row, unaffected by Cycle 75', () => {
  // Mandatory negative control: only a genuine File-typed Component
  // declaration triggers the new allocation.
  const encoded = encodeProgramArtifacts(`Component string &s;`);

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.strictEqual(packageReferences.filter(r => r.packageName === 'FILE').length, 0);
});

test('a Global Rowset declaration allocates an implicit PACKAGE/ROWSET dependency row', () => {
  // Cycle 76 (definitions 4290/7146/..., objectid1 1/9/10/66/104 -- a
  // 962-candidate corpus population spanning multiple program types, 0
  // contradictions): `globalDeclaration()` had the SAME gap for Rowset
  // that Cycle 75 found and fixed for File -- `Local Rowset &x;`/
  // `Component Rowset &x;` already allocate PACKAGE/ROWSET, but `Global
  // Rowset &x;` never did.
  const encoded = encodeProgramArtifacts(
    `Global Rowset &rs;
&rs = GetLevel0()(1).GetRowset(Scroll.TEST_REC);`
  );

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.ok(
    packageReferences.some(r => r.packageName === 'ROWSET'),
    'a Global Rowset declaration must allocate a PACKAGE/ROWSET dependency row'
  );
});

test('a Global string declaration does not allocate a PACKAGE/ROWSET dependency row, unaffected by Cycle 76', () => {
  // Mandatory negative control: only a genuine Rowset-typed Global
  // declaration triggers the new allocation.
  const encoded = encodeProgramArtifacts(`Global string &s;`);

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.strictEqual(packageReferences.filter(r => r.packageName === 'ROWSET').length, 0);
});

test('a Rowset-typed Function parameter allocates PACKAGE/ROWSET, the same as Record/Row/SQL/ApiObject/Message parameters', () => {
  // Compiler closure: this reverses a prior "genuinely mixed, do not
  // touch" finding (Cycle 7) that this exact fixture used to encode as a
  // negative assertion. Re-investigation with a token-level,
  // comment-excluding corpus census (the same methodology that resolved
  // the analogous Field-typed-Function-parameter caution) found a clean,
  // unanimous 395/395 population -- 163 Application Class method
  // parameters and 232 ordinary Function parameters, 0 contradictions in
  // either group -- every genuine `As Rowset` parameter occurrence
  // stores a PACKAGE/ROWSET row. The specific corpus definition this
  // fixture is modeled on (DERIVED_GP.FUNCLIB_FG.FieldFormula's own
  // `Function HideRecordColumns(&TargetRs As Rowset, ...)`, definition
  // 4842) was re-examined directly: it is NOT and never was EXACT --
  // Cycle 7's own cited "4 already-EXACT definitions" evidence did not
  // hold up under direct inspection, the same class of census error the
  // Field-parameter re-investigation found (comment-only/unrelated-
  // construct false positives). Full corpus regression gate confirmed
  // 0 regressions and +52 EXACT after allocating this reference.
  const encoded = encodeProgramArtifacts(
    `Function HideRecordColumns(&TargetRs As Rowset, &TargetRow As number)
   Local Record &GridRecord;
End-Function;`
  );

  const packageReferences = encoded.references.filter(r => r.kind === 'package');
  assert.strictEqual(
    packageReferences.filter(r => r.packageName === 'ROWSET').length,
    1,
    'a Rowset-typed Function parameter must allocate exactly one PACKAGE/ROWSET dependency row'
  );
});

test('a blank line after a leading bare semicolon before the first real statement stores its marker', () => {
  // Cycle 49 (9 Application Class constructors, e.g. definition 29110):
  // an Application Class method implementation's own structured
  // signature-comment echo (`/+ &param as Type +/;`) is source-owned body
  // TEXT, not stripped by the wrapper's whitespace-only leading trim --
  // its trailing `;` reaches the shared fragment encoder as a genuine
  // bare top-level empty statement. A blank line between that bare `;`
  // and the method's own first real statement was silently dropped
  // regardless of the statement's own shape: neither the general
  // blank-line path (blocked by `leadingLocalRun` still being true) nor
  // the deferred declaration-boundary path (blocked by
  // `sawLeadingLocalDeclaration` being false, since no `Local` ever
  // appeared) covered "first non-Local statement after a leading run
  // with no Local declarations at all." Reproduced here directly with
  // the real corpus shape (a constructor whose first statement is the
  // explicit superclass-constructor-invocation form).
  const encoded = encodeProgramArtifacts(`class Entity
   method Entity();
end-class;

method Entity
   /+ &rec as Record, +/
   /+ &handler as PKG:Handler +/;

   %Super = create PKG:BaseObject();

   &ObjectRec = &rec;
end-method;
`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'Entity',
      packagePath: ['PKG', 'Entity']
    }
  });

  const hex = encoded.program.toString('hex');
  const implOpen = hex.indexOf('6341');
  // Bare `;` (0x15) immediately followed by exactly one marker (0x4f)
  // before the next token -- not zero, and not merged/duplicated.
  assert.match(hex.slice(implOpen), /^6341.*?15\s*4f(?!4f)/);
  assert.ok(!hex.slice(implOpen).match(/^6341.*?154f4f/), 'must not emit two markers');
});

test('no marker is invented when there is no blank line after a leading bare semicolon', () => {
  // Negative control for the fix above: the SAME leading bare `;` scenario
  // WITHOUT an actual blank line before the first statement must NOT gain
  // a marker -- proves the fix is blank-line-driven, not an unconditional
  // insertion.
  const encoded = encodeProgramArtifacts(`class Entity
   method Entity();
end-class;

method Entity
   /+ &rec as Record, +/
   /+ &handler as PKG:Handler +/;
   %Super = create PKG:BaseObject();
end-method;
`, {
    owner: {
      recordName: 'PKG',
      fieldName: 'Entity',
      packagePath: ['PKG', 'Entity']
    }
  });

  const hex = encoded.program.toString('hex');
  const implOpen = hex.indexOf('6341');
  assert.match(hex.slice(implOpen), /^6341.*?15(?!4f)12/);
});

test('the leading-bare-semicolon marker fix applies uniformly regardless of the following statement shape', () => {
  // Cycle 49: proves the gap was about the PRECEDING bare-semicolon/
  // no-Local-run state, not about %Super (or any particular receiver)
  // specifically -- %Super, an ordinary &variable assignment, %This, and
  // ordinary object dispatch all reproduced the SAME missing marker
  // before this fix, and all four must now uniformly gain it.
  function firstMarkerByte(firstStatement: string): string {
    const encoded = encodeProgramArtifacts(`class Entity
   method Entity();
end-class;

method Entity
   /+ &rec as Record, +/
   /+ &handler as PKG:Handler +/;

   ${firstStatement}
end-method;
`, {
      owner: { recordName: 'PKG', fieldName: 'Entity', packagePath: ['PKG', 'Entity'] }
    });
    const hex = encoded.program.toString('hex');
    const implOpen = hex.indexOf('6341');
    const m = /^6341.*?15(4f)?/.exec(hex.slice(implOpen));
    return m?.[1] ?? '';
  }

  assert.equal(firstMarkerByte('%Super = create PKG:BaseObject();'), '4f');
  assert.equal(firstMarkerByte('&ObjectRec = create PKG:BaseObject();'), '4f');
  assert.equal(firstMarkerByte('%This.PrepareFields();'), '4f');
  assert.equal(firstMarkerByte('&SomeObj.PrepareFields();'), '4f');
});

test('an initialized Local declaration that closes a leading run does not duplicate its own preceding blank-line marker', () => {
  // Cycle 50 (definitions 28852, 29113, 29612): TWO independent mechanisms
  // both compute a marker for the SAME leading blank-line gap between two
  // consecutive Local declarations. The "blank formatting lines inside a
  // leading declaration-only Local run" mechanism fires immediately,
  // directly, whenever `isLocalDeclaration && hasBlankLine` (unconditional
  // on what happens later). A SEPARATE, deferred mechanism decides where
  // to close the declaration section once an INITIALIZED Local (with no
  // further uninitialized Local following) ends the run -- and, before
  // this fix, recomputed its OWN marker count from the SAME preceding gap
  // rather than recognizing the first mechanism already emitted it,
  // producing a genuine extra 0x4F. This exact shape (an import present,
  // a Record-typed parameter whose field is accessed inside the SECOND
  // Local's own initializer) is required to make `hasCompiledReferences`
  // true and activate the deferred-insertion path at all.
  const encoded = encodeProgramArtifacts(`import PKG:Other;

class Entity
   method Run(&r As Record) Returns string;
end-class;

method Run
   /+ &r as Record +/
   /+ Returns String +/
   Local string &LONG_TEXT;

   Local string &Key1 = &r.FIELD.Value;
   Return &LONG_TEXT;
end-method;
`, {
    owner: { recordName: 'PKG', fieldName: 'Entity', packagePath: ['PKG', 'Entity'] }
  });

  assert.ok(
    !encoded.program.includes(Buffer.from([0x15, 0x4f, 0x4f])),
    'must not emit two consecutive markers for one blank-line gap'
  );
  // The single, correct marker for the LONG_TEXT-to-Key1 blank line must
  // still be present -- this is a duplication fix, not a removal.
  assert.ok(
    encoded.program.includes(Buffer.from([0x15, 0x4f, 0x44])),
    'the single correct marker before the second Local declaration must remain'
  );
});

test('two adjacent uninitialized Local declarations with a blank line between them still get exactly one marker', () => {
  // Negative control: the ordinary "blank formatting lines inside a
  // leading declaration-only Local run" case (Cycle 45's own established
  // behavior, ACA_ACK_RUNCTL.ACA_ATTACHADD.FieldChange) must be
  // completely unaffected by the Cycle 50 fix -- neither Local here is
  // initialized, so the deferred mechanism this cycle touched never
  // engages at all.
  const encoded = encodeProgramArtifacts(`Local File &fileWSDL;

Local XmlDoc &XMLdoc;`);

  const hex = encoded.program.toString('hex');
  assert.ok(!hex.includes('154f4f'), 'must not duplicate the marker');
  assert.ok(hex.includes('154f44'), 'must still emit the single correct marker');
});

test('a blank line after a leading bare semicolon before the first Local declaration stores its marker', () => {
  // Cycle 51 (definition 29134 and 18 further corpus definitions, 26
  // total occurrences): the same leading bare-`;` gap Cycle 49 fixed for
  // the first NON-Local statement in a fragment, extended to cover the
  // case Cycle 49's own fix did not -- the first real statement in the
  // fragment IS ITSELF the first `Local` declaration of the run.
  // `sawLeadingLocalDeclaration` is still false at that exact point (this
  // IS the first Local reached), so neither the "blank lines inside an
  // ALREADY-open leading Local run" mechanism (requires it true) nor
  // Cycle 49's own `!isLocalDeclaration`-gated fix (this statement IS a
  // Local) can fire.
  const encoded = encodeProgramArtifacts(`class Entity
   method CreatePersonalization();
end-class;

method CreatePersonalization
   /+ Returns Personalization +/;

   Local PKG:OBJECT:Personalization &Personalization;

   &Personalization = create PKG:OBJECT:Personalization();
end-method;
`, {
    owner: { recordName: 'PKG', fieldName: 'Entity', packagePath: ['PKG', 'Entity'] }
  });

  const hex = encoded.program.toString('hex');
  const implOpen = hex.indexOf('6341');
  assert.match(hex.slice(implOpen), /^6341.*?15\s*4f(?!4f)44/);
});

test('an import section closing directly into the first Local declaration is not double-marked by the Cycle 51 fix', () => {
  // Negative control: ordinary PeopleCode's own, already-calibrated
  // "import section closes, blank line, first Local declaration" shape
  // (ACCT_CD_NEW_VW.ACCT_CD.SearchInit, golden fixture 412) is handled
  // UNCONDITIONALLY by the import-section-close branch already -- the
  // Cycle 51 fix must explicitly exclude `justClosedImportSection` or it
  // double-emits here. This is a plain import, not a bare `;` from a
  // signature-comment echo, so Cycle 51's own scenario should never
  // engage at all.
  const encoded = encodeProgramArtifacts(`import PKG:Other;

Local Rowset &MYACTIVECFS;
Local Row &ActiveCf;
Local number &I;

If &I = 1 Then
   &I = 2;
End-If;`);

  const hex = encoded.program.toString('hex');
  assert.ok(!hex.includes('154f4f'), 'must not duplicate the import-close marker');
});

test('HTML.NAME is recognized outside GetHTMLText calls', () => {
  const { htmlReferences, uses } = encodeWithHtmlReferenceTrace(`
Local any &content;
&content = HTML.TEST_CONTENT;`);

  assert.equal(htmlReferences.length, 1);
  assert.equal(htmlReferences[0]?.fieldName, 'TEST_CONTENT');
  assert.deepStrictEqual(uses, [1]);
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

test('top-level assignment may omit its semicolon before a final standalone comment', () => {
  const encoded = encodeFragment('&FinishedEditApproval = "N"\n/* End-If;  */');

  assert.deepStrictEqual(
    encoded,
    Buffer.from(
      '012600460069006E0069007300680065006400450064006900740041007000700072006F00760061006C000000' +
      '06164E000000' +
      '241C002F002A00200045006E0064002D00490066003B00200020002A002F00',
      'hex'
    )
  );
});

test('RowNumber on a rowset element remains an inline Row property', () => {
  assert.deepStrictEqual(
    encodeFragment('&n = &rs(CurrentRowNumber()).RowNumber;'),
    Buffer.from(
      '0126006E00000006' +
      '0126007200730000000B' +
      '0A430075007200720065006E00740052006F0077004E0075006D0062006500720000000B1414' +
      '050A52006F0077004E0075006D00620065007200000015',
      'hex'
    )
  );
});

test('explicit Record.RECORD.FIELD assignment compiles the field dependency', () => {
  const actual = encodeProgram(
    'Record.PSAUTHWS_VW2.AUTHORIZEDACTIONS.Value = 4;',
    {
      owner: {
        recordName: 'ACL_WS_WRK',
        fieldName: 'WSOPRACCESS'
      }
    }
  );

  assert.deepStrictEqual(
    actual,
    Buffer.from(
      'A0000000002B00000000000000000000000000000000000000000000000000000085000000' +
      '210100054A0200050A560061006C0075006500000006500000040000000000000000000000000000001507',
      'hex'
    )
  );
});

test('an explicit Record root may lead a method-call statement', () => {
  assert.deepStrictEqual(
    encodeFragment('Record.PS_TEST.CopyFieldsTo(&target);'),
    Buffer.from(
      '210100050a43006f00700079004600690065006c006400730054006f000000' +
      '0b01260074006100720067006500740000001415',
      'hex'
    )
  );
});

test('a colon-qualified package constant is an inline expression operand', () => {
  assert.deepStrictEqual(
    encodeFragment('&key = Key:Class_Test;'),
    Buffer.from(
      '0126006b0065007900000006' +
      '0a4b0065007900000057' +
      '0a43006c006100730073005f005400650073007400000015',
      'hex'
    )
  );
});

test('%metadata is a system-variable package root', () => {
  assert.deepStrictEqual(
    encodeFragment('import %metadata:Key;'),
    Buffer.from(
      '581225006d006500740061006400610074006100000057' +
      '0a4b00650079000000152d',
      'hex'
    )
  );
});

test('flat top-level FetchValue calls allocate Record arguments per statement', () => {
  const actual = encodeProgramArtifacts(
    '&a = FetchValue(Record.PARENT, 1, Record.CHILD, 1);\n' +
    '&b = FetchValue(Record.PARENT, 2, Record.CHILD, 2);'
  );

  assert.deepStrictEqual(
    actual.references.map(reference => [reference.kind, reference.recordName]),
    [
      ['record', 'PARENT'],
      ['record', 'CHILD'],
      ['record', 'PARENT'],
      ['record', 'CHILD']
    ]
  );
});

test('quoted Component references use the calibrated 0x48 form', () => {
  const source = `If %Component = Component."HRS_PKG_MDL_APP" Then
   &bare = Component.HRS_PKG_MDL_APP;
End-If;`;

  const artifacts = encodeProgramArtifacts(source);

  assert.deepStrictEqual(
    artifacts.references.map(reference => [
      reference.kind,
      reference.recordName,
      reference.objectName
    ]),
    [
      ['quoted-reference', 'COMPONENT', undefined],
      ['component', undefined, 'HRS_PKG_MDL_APP']
    ]
  );
  assert.equal(artifacts.program.includes(Buffer.from([0x48, 0x01, 0x00])), true);
  assert.equal(artifacts.program.includes(Buffer.from([0x21, 0x02, 0x00])), true);
});

test('blank-line multiplicity before Else emits one marker per blank line', () => {
  const source = `If Record.REC.FLAG.Value Then
   &x = 1;
   
   
Else
End-If;`;

  assert.deepStrictEqual(
    encodeFragment(source),
    Buffer.from(
      '1C210100054A0200050A560061006C007500650000001F' +
      '01260078000000065000000100000000000000000000000000000015' +
      '4F4F191A15',
      'hex'
    )
  );
});

const appClassText = (opcode: number, value: string) =>
  Buffer.concat([Buffer.from([opcode]), Buffer.from(`${value}\0`, 'utf16le')]);

const appClassComment = (opcode: number, value: string) => {
  const payload = Buffer.from(value, 'utf16le');
  const header = Buffer.alloc(3);
  header[0] = opcode;
  header.writeUInt16LE(payload.length, 1);
  return Buffer.concat([header, payload]);
};

const appClassStatements = (source: string) => {
  const program = encodeProgramArtifacts(source).program;
  const layout = readProgramLayout(program);
  return program.subarray(
    layout.statements.offset,
    layout.statements.offset + layout.statements.byteLength
  );
};

const appClassMetadata = (source: string, packagePath?: string[]) => {
  const program = encodeProgramArtifacts(source, packagePath === undefined ? undefined : {
    owner: {
      recordName: packagePath[0] ?? '',
      fieldName: packagePath[1] ?? '',
      packagePath
    }
  }).program;
  const layout = readProgramLayout(program);
  const names: Array<{ text: string; charOffset: number }> = [];
  let offset = layout.names.offset;
  const namesEnd = offset + layout.names.byteLength;
  while (offset < namesEnd) {
    let end = offset;
    while (program.readUInt16LE(end) !== 0) end += 2;
    names.push({
      text: program.toString('utf16le', offset, end),
      charOffset: (offset - layout.names.offset) / 2
    });
    offset = end + 2;
  }
  const records = Array.from({ length: layout.recordCount }, (_, index) => {
    const base = layout.records.offset + index * 16;
    const attributesAndCount = program.readUInt32LE(base + 8);
    return {
      nameOffset: program.readUInt32LE(base),
      signatureSlotOffset: program.readUInt32LE(base + 4),
      flags: attributesAndCount & 0xffff0000,
      low: attributesAndCount & 0xffff,
      descriptor: program.readUInt32LE(base + 12)
    };
  });
  const slots = Array.from({ length: layout.slotCount }, (_, index) =>
    program.readUInt32LE(layout.slots.offset + index * 4)
  );
  return { names, records, slots };
};

test('Application Class metadata uses the owner path as the self name exactly once', () => {
  assert.deepStrictEqual(
    appClassMetadata('class Demo\nend-class;', ['PKG', 'Demo']).names.map(name => name.text),
    ['PKG:Demo']
  );
  assert.deepStrictEqual(
    appClassMetadata('class Demo\nend-class;').names.map(name => name.text),
    ['Demo']
  );
});

test('Application Class type names follow record descriptors before declaration-order slots', () => {
  const metadata = appClassMetadata(`class Demo extends PKG:Base
method A(&a As PKG:ParamA) Returns PKG:ReturnA;
method B(&b As PKG:ParamB) Returns PKG:ReturnB;
end-class;
method B
end-method;
method A
end-method;`, ['ROOT', 'Demo']);
  assert.deepStrictEqual(metadata.names.map(name => name.text), [
    'ROOT:Demo', 'B', 'A',
    'PKG:Base', 'PKG:ReturnB', 'PKG:ReturnA',
    'PKG:ParamA', 'PKG:ParamB'
  ]);
  const offsets = new Map(metadata.names.map(name => [name.text, name.charOffset]));
  const descriptor = (name: string) => 0x80000 | (0x100 + offsets.get(name)!);
  assert.deepStrictEqual(
    metadata.records.map(record => record.descriptor),
    [descriptor('PKG:Base'), descriptor('PKG:ReturnB'), descriptor('PKG:ReturnA')]
  );
  assert.deepStrictEqual(
    metadata.slots,
    [descriptor('PKG:ParamA'), 7, descriptor('PKG:ParamB'), 7]
  );
});

test('Application Class metadata emits the proven singleton instance directory phase', () => {
  const metadata = appClassMetadata(`class Demo
instance PKG:State &state;
method Run();
end-class;
method Run
end-method;`, ['ROOT', 'Demo']);
  assert.deepStrictEqual(metadata.names.map(name => name.text), [
    'ROOT:Demo', 'state', 'Run', 'PKG:State'
  ]);
  const stateOffset = metadata.names.find(name => name.text === 'PKG:State')!.charOffset;
  assert.deepStrictEqual(metadata.records, [
    { nameOffset: 0, signatureSlotOffset: 0, flags: APPLICATION_CLASS_FLAGS.self, low: 0, descriptor: 7 },
    {
      nameOffset: 'ROOT:Demo'.length + 1,
      signatureSlotOffset: 0,
      flags: APPLICATION_CLASS_FLAGS.private | APPLICATION_CLASS_FLAGS.property | APPLICATION_CLASS_FLAGS.storage,
      low: 0,
      descriptor: 0x80000 | (0x100 + stateOffset)
    },
    {
      nameOffset: 'ROOT:Demo'.length + 1 + 'state'.length + 1,
      signatureSlotOffset: 0,
      flags: 0,
      low: 0,
      descriptor: 7
    }
  ]);
  assert.deepStrictEqual(metadata.slots, [7]);
});

test('Application Class properties and instances follow the member hash table order', () => {
  // Cycle 100: bucket = (h * 2 + char over the upper-cased name) mod 20,
  // ascending. 28723 declares RecordName then FieldName and stores
  // FieldName (bucket 7) before RecordName (bucket 19).
  const properties = appClassMetadata(`class Demo
   property string RecordName;
   property string FieldName;
end-class;`);
  assert.deepStrictEqual(properties.names.map(name => name.text), ['Demo', 'FieldName', 'RecordName']);
  const instances = appClassMetadata(`class Demo
instance Row &first, &second;
end-class;`);
  assert.deepStrictEqual(instances.names.map(name => name.text), ['Demo', 'first', 'second']);
  assert.equal(instances.records.length, 3);
});

test('colliding members are ordered by upper-cased name descending within a bucket', () => {
  // AK and BI hash alike (2 * 'A' + 'K' = 2 * 'B' + 'I'); BI sorts first
  // although AK is declared first.
  const metadata = appClassMetadata(`class Demo
   property string AK;
   property string BI;
end-class;`);
  assert.deepStrictEqual(metadata.names.map(name => name.text), ['Demo', 'BI', 'AK']);
});

test('Application Class statement encoding emits a simple class header', () => {
  assert.deepStrictEqual(appClassStatements('class Demo\nend-class;'), Buffer.concat([
    Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x5b, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding emits an interface header', () => {
  assert.deepStrictEqual(appClassStatements('interface Contract\nend-interface;'), Buffer.concat([
    Buffer.from([0x70]), appClassText(0x0a, 'Contract'), Buffer.from([0x71, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding emits an extends path', () => {
  assert.deepStrictEqual(appClassStatements('class Demo extends PKG:Base\nend-class;'), Buffer.concat([
    Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x5c]),
    appClassText(0x0a, 'PKG'), Buffer.from([0x57]), appClassText(0x0a, 'Base'),
    Buffer.from([0x5b, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding emits implements with a %metadata root', () => {
  assert.deepStrictEqual(appClassStatements('class Demo implements %metadata:Key\nend-class;'), Buffer.concat([
    Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x72]),
    appClassText(0x12, '%metadata'), Buffer.from([0x57]), appClassText(0x0a, 'Key'),
    Buffer.from([0x5b, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding treats a constructor as an ordinary method', () => {
  assert.deepStrictEqual(appClassStatements('class Demo\n method Demo();\nend-class;'), Buffer.concat([
    Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x63]),
    appClassText(0x0a, 'Demo'), Buffer.from([0x0b, 0x14, 0x15, 0x5b, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding emits method types and out parameters', () => {
  assert.deepStrictEqual(
    appClassStatements('class Demo\n method Run(&rows As array of PKG:Row out) Returns number;\nend-class;'),
    Buffer.concat([
      Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x63]),
      appClassText(0x0a, 'Run'), Buffer.from([0x0b]), appClassText(0x01, '&rows'),
      Buffer.from([0x35]), appClassText(0x40, 'array'), appClassText(0x40, 'of'),
      appClassText(0x0a, 'PKG'), Buffer.from([0x57]), appClassText(0x0a, 'Row'),
      Buffer.from([0x5d, 0x14, 0x39]), appClassText(0x40, 'number'),
      Buffer.from([0x15, 0x5b, 0x15, 0x2d, 0x07])
    ])
  );
});

test('Application Class statement encoding emits abstract interface methods', () => {
  assert.deepStrictEqual(appClassStatements('interface Demo\n method Run() abstract;\nend-interface;'), Buffer.concat([
    Buffer.from([0x70]), appClassText(0x0a, 'Demo'), Buffer.from([0x63]),
    appClassText(0x0a, 'Run'), Buffer.from([0x0b, 0x14, 0x6f, 0x15, 0x71, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding emits a plain property', () => {
  assert.deepStrictEqual(appClassStatements('class Demo\n property string Name;\nend-class;'), Buffer.concat([
    Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x5e]),
    appClassText(0x40, 'string'), appClassText(0x0a, 'Name'),
    Buffer.from([0x15, 0x5b, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding emits readonly properties', () => {
  assert.deepStrictEqual(appClassStatements('class Demo\n property number Count readonly;\nend-class;'), Buffer.concat([
    Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x5e]),
    appClassText(0x40, 'number'), appClassText(0x0a, 'Count'),
    Buffer.from([0x60, 0x15, 0x5b, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding preserves getter/setter modifier order', () => {
  assert.deepStrictEqual(appClassStatements('class Demo\n property boolean Flag set get;\nend-class;'), Buffer.concat([
    Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x5e]),
    appClassText(0x40, 'boolean'), appClassText(0x0a, 'Flag'),
    Buffer.from([0x49, 0x5f, 0x15, 0x5b, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class statement encoding emits grouped instance variables', () => {
  assert.deepStrictEqual(appClassStatements('class Demo\n private\n instance Row &first, &second;\nend-class;'), Buffer.concat([
    Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x61, 0x62]),
    appClassText(0x0a, 'Row'), appClassText(0x01, '&first'), Buffer.from([0x03]),
    appClassText(0x01, '&second'), Buffer.from([0x15, 0x5b, 0x15, 0x2d, 0x07])
  ]));
});

test('Application Class constants are executable-only literal declarations', () => {
  const program = encodeProgramArtifacts(`class Demo
 constant &S = "x";
 constant &N = 42;
 constant &B = False;
end-class;`).program;
  const layout = readProgramLayout(program);
  assert.equal(layout.recordCount, 1);
  assert.deepStrictEqual(
    program.subarray(layout.statements.offset, layout.statements.offset + layout.statements.byteLength),
    Buffer.concat([
      Buffer.from([0x5a]), appClassText(0x0a, 'Demo'),
      Buffer.from([0x56]), appClassText(0x01, '&S'), Buffer.from([0x06]), appClassText(0x16, 'x'), Buffer.from([0x15]),
      Buffer.from([0x56]), appClassText(0x01, '&N'), Buffer.from([0x06]), Buffer.from('5000002a000000000000000000000000000000', 'hex'), Buffer.from([0x15]),
      Buffer.from([0x56]), appClassText(0x01, '&B'), Buffer.from([0x06, 0x30, 0x15, 0x5b, 0x15, 0x2d, 0x07])
    ])
  );
});

test('Application Class statement encoding preserves mixed declaration order', () => {
  const actual = appClassStatements(`class Demo
 property string Name;
protected
 method Run();
private
 instance Row &row;
 constant &N = 1;
end-class;`);
  const expectedOrder = [0x5e, 0x73, 0x63, 0x61, 0x62, 0x56];
  let cursor = 0;
  for (const opcode of expectedOrder) {
    cursor = actual.indexOf(opcode, cursor);
    assert.notEqual(cursor, -1);
    cursor++;
  }
});

test('Application Class statement encoding preserves the declaration-to-body wrapper boundary', () => {
  const actual = appClassStatements(`class Demo
 method Run();
end-class;

method Run
 Return;
end-method;`);
  assert.equal(
    actual.includes(Buffer.concat([
      Buffer.from([0x5b, 0x15, 0x2d, 0x4f, 0x63, 0x41]),
      appClassText(0x0a, 'Run'),
      Buffer.from([0x2d, 0x38, 0x15, 0x64, 0x15, 0x2d, 0x07])
    ])),
    true
  );
});

test('Application Class layout emits a comment before the class header', () => {
  assert.deepStrictEqual(
    appClassStatements('/* before */\n\nclass Demo\nend-class;'),
    Buffer.concat([
      appClassComment(0x24, '/* before */'), Buffer.from([0x4f, 0x5a]),
      appClassText(0x0a, 'Demo'), Buffer.from([0x5b, 0x15, 0x2d, 0x07])
    ])
  );
});

test('Application Class layout interleaves declaration comments', () => {
  assert.deepStrictEqual(
    appClassStatements('class Demo\n\n/* inside */\nmethod Run();\nend-class;'),
    Buffer.concat([
      Buffer.from([0x5a]), appClassText(0x0a, 'Demo'), Buffer.from([0x4f]),
      appClassComment(0x24, '/* inside */'), Buffer.from([0x63]),
      appClassText(0x0a, 'Run'), Buffer.from([0x0b, 0x14, 0x15, 0x5b, 0x15, 0x2d, 0x07])
    ])
  );
});

test('Application Class layout retains a comment after end-class', () => {
  assert.deepStrictEqual(
    appClassStatements('class Demo\nend-class;\n\n/* after */'),
    Buffer.concat([
      Buffer.from([0x5a]), appClassText(0x0a, 'Demo'),
      Buffer.from([0x5b, 0x15, 0x2d, 0x4f]), appClassComment(0x24, '/* after */'),
      Buffer.from([0x07])
    ])
  );
});

test('Application Class layout places a comment before the first implementation', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;

/* before */
method Run
Return;
end-method;`);
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x5b, 0x15, 0x2d, 0x4f]), appClassComment(0x24, '/* before */'),
    Buffer.from([0x63, 0x41]), appClassText(0x0a, 'Run'), Buffer.from([0x2d, 0x38, 0x15])
  ])), true);
});

test('Application Class layout places a comment between implementations', () => {
  const actual = appClassStatements(`class Demo
method Run();
method Next();
end-class;
method Run
Return;
end-method;

/* between */
method Next
Return;
end-method;`);
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x64, 0x15, 0x2d, 0x4f]), appClassComment(0x24, '/* between */'),
    Buffer.from([0x63, 0x41]), appClassText(0x0a, 'Next')
  ])), true);
});

test('Application Class comment-only bodies keep comments inside the wrapper', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run

/* only */

end-method;`);
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x63, 0x41]), appClassText(0x0a, 'Run'), Buffer.from([0x2d, 0x4f]),
    appClassComment(0x24, '/* only */'), Buffer.from([0x4f, 0x64, 0x15, 0x2d, 0x07])
  ])), true);
});

test('Application Class body edges emit one marker for one blank source line', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run

Return;
end-method;`);
  assert.equal(actual.includes(Buffer.concat([
    appClassText(0x0a, 'Run'), Buffer.from([0x2d, 0x4f, 0x38, 0x15, 0x64])
  ])), true);
});

test('Application Class body edges preserve multiple blank source lines', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run


Return;


end-method;`);
  assert.equal(actual.includes(Buffer.concat([
    appClassText(0x0a, 'Run'), Buffer.from([0x2d, 0x4f, 0x4f, 0x38, 0x15, 0x4f, 0x4f, 0x64])
  ])), true);
});

test('Application Class declaration gaps emit the previously missing marker', () => {
  const actual = appClassStatements(`class Demo
method Run();

method Next();
end-class;`);
  assert.equal(actual.includes(Buffer.concat([
    appClassText(0x0a, 'Run'), Buffer.from([0x0b, 0x14, 0x15, 0x4f, 0x63]),
    appClassText(0x0a, 'Next')
  ])), true);
});

test('Application Class nonempty bodies do not receive an extra entry marker', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run
Return;
end-method;`);
  assert.equal(actual.includes(Buffer.concat([
    appClassText(0x0a, 'Run'), Buffer.from([0x2d, 0x38, 0x15, 0x64])
  ])), true);
});

test('Application Class import comments precede the deferred import close', () => {
  const actual = appClassStatements('import PTWIDGETS:*; /* @col */\n\nclass Demo\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x15]), appClassComment(0x4e, '/* @col */'),
    Buffer.from([0x2d, 0x4f, 0x5a]), appClassText(0x0a, 'Demo')
  ])), true);
});

test('Application Class bodies flush deferred internal markers with compiled references', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run
&x = 1;

&x = 2;
Return Record.REC.FIELD.Value;
end-method;`);
  const assignment = appClassText(0x01, '&x');
  const first = actual.indexOf(assignment);
  assert.notEqual(first, -1);
  assert.notEqual(actual.indexOf(Buffer.concat([Buffer.from([0x15, 0x4f]), assignment]), first), -1);
});

test('Application Class bodies discard deferred internal markers without compiled references', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run
&x = 1;

&x = 2;
Return;
end-method;`);
  const assignment = appClassText(0x01, '&x');
  const first = actual.indexOf(assignment);
  assert.notEqual(first, -1);
  assert.equal(actual.indexOf(Buffer.concat([Buffer.from([0x15, 0x4f]), assignment]), first), -1);
  assert.notEqual(actual.indexOf(Buffer.concat([Buffer.from([0x15]), assignment]), first), -1);
});

test('Application Class final implementation does not flush trailing program whitespace', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run
Return;
end-method;


`);
  assert.deepStrictEqual(actual.subarray(-4), Buffer.from([0x64, 0x15, 0x2d, 0x07]));
});

test('Application Class interface layout uses the same comment and gap rules', () => {
  assert.deepStrictEqual(
    appClassStatements('interface Demo\n\n/* contract */\nmethod Run() abstract;\nend-interface;'),
    Buffer.concat([
      Buffer.from([0x70]), appClassText(0x0a, 'Demo'), Buffer.from([0x4f]),
      appClassComment(0x24, '/* contract */'), Buffer.from([0x63]),
      appClassText(0x0a, 'Run'), Buffer.from([0x0b, 0x14, 0x6f, 0x15, 0x71, 0x15, 0x2d, 0x07])
    ])
  );
});

test('Application Class unit headers preserve an explicit source semicolon', () => {
  assert.deepStrictEqual(
    appClassStatements('class Demo;\nend-class;'),
    Buffer.concat([
      Buffer.from([0x5a]), appClassText(0x0a, 'Demo'),
      Buffer.from([0x15, 0x5b, 0x15, 0x2d, 0x07])
    ])
  );
});

test('Application Class method declarations may omit their source semicolon', () => {
  const actual = appClassStatements('class Demo\nmethod Run()\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x63]), appClassText(0x0a, 'Run'),
    Buffer.from([0x0b, 0x14, 0x5b, 0x15])
  ])), true);
});

test('Application Class final instance declarations may omit their source semicolon', () => {
  const actual = appClassStatements('class Demo\ninstance Row &row\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x62]), appClassText(0x0a, 'Row'), appClassText(0x01, '&row'),
    Buffer.from([0x5b, 0x15])
  ])), true);
});

test('Application Class final instance declarations preserve an explicit semicolon', () => {
  const actual = appClassStatements('class Demo\ninstance Row &row;\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x62]), appClassText(0x0a, 'Row'), appClassText(0x01, '&row'),
    Buffer.from([0x15, 0x5b, 0x15])
  ])), true);
});

test('Application Class method declarations preserve their explicit semicolon', () => {
  const actual = appClassStatements('class Demo\nmethod Run();\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x63]), appClassText(0x0a, 'Run'),
    Buffer.from([0x0b, 0x14, 0x15, 0x5b])
  ])), true);
});

test('Application Class property declarations preserve their explicit semicolon', () => {
  const actual = appClassStatements('class Demo\nproperty string Name;\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x5e]), appClassText(0x40, 'string'), appClassText(0x0a, 'Name'),
    Buffer.from([0x15, 0x5b])
  ])), true);
});

test('Application Class constant declarations preserve their explicit semicolon', () => {
  const actual = appClassStatements('class Demo\nconstant &Value = "x";\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x56]), appClassText(0x01, '&Value'), Buffer.from([0x06]),
    appClassText(0x16, 'x'), Buffer.from([0x15, 0x5b])
  ])), true);
});

test('Application Class abstract interface declarations preserve their explicit semicolon', () => {
  const actual = appClassStatements('interface Demo\nmethod Run() abstract;\nend-interface;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x63]), appClassText(0x0a, 'Run'),
    Buffer.from([0x0b, 0x14, 0x6f, 0x15, 0x71])
  ])), true);
});

test('Application Class constructor declarations use the same source-semicolon rule', () => {
  const actual = appClassStatements('class Demo\nmethod Demo()\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    Buffer.from([0x63]), appClassText(0x0a, 'Demo'),
    Buffer.from([0x0b, 0x14, 0x5b])
  ])), true);
});

test('Application Class comments before the unit closer do not imply a declaration terminator', () => {
  const actual = appClassStatements(`class Demo
instance Row &row
/* tail */
end-class;`);
  assert.equal(actual.includes(Buffer.concat([
    appClassText(0x01, '&row'), appClassComment(0x24, '/* tail */'),
    Buffer.from([0x5b, 0x15])
  ])), true);
});

test('Application Class blank lines before the unit closer emit layout only, not a terminator', () => {
  const actual = appClassStatements(`class Demo
instance Row &row

end-class;`);
  assert.equal(actual.includes(Buffer.concat([
    appClassText(0x01, '&row'), Buffer.from([0x4f, 0x5b, 0x15])
  ])), true);
});

test('Application Class bodies preserve a real trailing source semicolon', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run
Return;
end-method;`);
  assert.equal(actual.includes(Buffer.from([0x2d, 0x38, 0x15, 0x64, 0x15, 0x2d])), true);
});

test('Application Class bodies remove only their parser-synthetic terminator', () => {
  const actual = appClassStatements(`class Demo
method Run();
end-class;
method Run
Return
end-method;`);
  assert.equal(actual.includes(Buffer.from([0x2d, 0x38, 0x64, 0x15, 0x2d])), true);
  assert.equal(actual.includes(Buffer.from([0x2d, 0x38, 0x15, 0x64])), false);
});

test('Application Class declarations preserve repeated explicit semicolons', () => {
  const actual = appClassStatements('class Demo\nmethod Run();;\nend-class;');
  assert.equal(actual.includes(Buffer.concat([
    appClassText(0x0a, 'Run'), Buffer.from([0x0b, 0x14, 0x15, 0x15, 0x5b])
  ])), true);
});

test('Application Class repeated-semicolon controls retain the independent layout residual', () => {
  const actual = appClassStatements(`class Demo
instance Row &row; /* inline */;


end-class;`);
  const expected = Buffer.concat([
    appClassText(0x01, '&row'), Buffer.from([0x15]),
    appClassComment(0x4e, '/* inline */'), Buffer.from([0x15, 0x5b])
  ]);
  assert.equal(actual.includes(expected), true);
  assert.equal(actual.includes(Buffer.concat([expected.subarray(0, -1), Buffer.from([0x4f, 0x5b])])), false);
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

/*
 * Cycle 83: blank formatting lines before While-body items are 0x4F
 * boundaries (definitions 3054, 3237, 2991). Each case encodes the same
 * program with and without the blank line and asserts that the ONLY byte
 * difference is one inserted 0x4F. The program carries a compiled
 * Record.Field reference so the reference-gated producer flushes.
 */
function insertedBytes(withGapProgram: Buffer, withoutGapProgram: Buffer): number[] {
  // Skip the 37-byte header: its program-length field changes with any insertion.
  const withGap = withGapProgram.subarray(37);
  const withoutGap = withoutGapProgram.subarray(37);
  let start = 0;
  while (start < withoutGap.length && withGap[start] === withoutGap[start]) start++;
  let endWith = withGap.length;
  let endWithout = withoutGap.length;
  while (endWithout > start && withGap[endWith - 1] === withoutGap[endWithout - 1]) {
    endWith--;
    endWithout--;
  }
  return [...withGap.subarray(start, endWith)];
}

const whileGapOwner = { owner: { recordName: 'TEST_REC', fieldName: 'TEST_FLD' } };

test('a blank line before a While-body statement emits one 0x4F', () => {
  const body = (gap: string) => `While &i < 3;
   &x = TEST_REC.TEST_FLD.Value;${gap}
   &i = &i + 1;
End-While;`;
  const delta = insertedBytes(
    encodeProgram(body('\n'), whileGapOwner as any),
    encodeProgram(body(''), whileGapOwner as any)
  );
  assert.deepStrictEqual(delta, [0x4f]);
});

test('a blank line after a semicolon-less While header emits one 0x4F', () => {
  const body = (gap: string) => `While &i < 3
${gap}   &x = TEST_REC.TEST_FLD.Value;
   &i = &i + 1;
End-While;`;
  const delta = insertedBytes(
    encodeProgram(body('\n'), whileGapOwner as any),
    encodeProgram(body(''), whileGapOwner as any)
  );
  assert.deepStrictEqual(delta, [0x4f]);
});

test('a blank line before a standalone comment in a While body emits one 0x4F', () => {
  const body = (gap: string) => `While &i < 3
   &x = TEST_REC.TEST_FLD.Value;${gap}
   /* next */
   &i = &i + 1;
End-While;`;
  const delta = insertedBytes(
    encodeProgram(body('\n'), whileGapOwner as any),
    encodeProgram(body(''), whileGapOwner as any)
  );
  assert.deepStrictEqual(delta, [0x4f]);
});

/*
 * Cycle 84: a declaration-section close WITHOUT the 0x2D byte (the run
 * contains an initialized Local) is an ordinary blank-line gap -- it carries
 * only the source's own blank lines, possibly none (definition 1769, and 90
 * more). Before the fix, the formal close's floor of one 0x4F was emitted
 * even with no blank line, so the with/without-blank-line programs did not
 * differ at all.
 */
test('an initialized-Local close after a Component declaration emits 0x4F only for a real blank line', () => {
  const program = (gap: string) => `Component Rowset &x;
Local number &n = 1;${gap}
&x = GetRowset(Scroll.TEST_REC);`;
  const delta = insertedBytes(
    encodeProgram(program('\n'), whileGapOwner as any),
    encodeProgram(program(''), whileGapOwner as any)
  );
  assert.deepStrictEqual(delta, [0x4f]);
});

test('a deferred leading-Local close with an initialized Local emits 0x4F only for a real blank line', () => {
  // PTADSCOMPST (definition 14381) shape: the run starts with an
  // initialized Local, then an uninitialized Local, then executable code.
  const program = (gap: string) => `Local Rowset &rs = GetRowset(Scroll.TEST_REC);
Local integer &i;${gap}
&i = &rs.ActiveRowCount;`;
  const delta = insertedBytes(
    encodeProgram(program('\n'), whileGapOwner as any),
    encodeProgram(program(''), whileGapOwner as any)
  );
  assert.deepStrictEqual(delta, [0x4f]);
});

/*
 * Cycle 85: a top-level Function definition does not end the leading
 * declaration phase. A Local run that follows Function definitions (before
 * any executable statement) closes formally with 0x2D 0x4F
 * (definition 14862 and 31 more); an initialized run keeps the informal
 * close (Cycle 84).
 */
function boundaryOpcodesBeforeLastStatement(source: string): string {
  const artifacts = encodeProgramArtifacts(source, whileGapOwner as any);
  const names = new NameTable();
  for (const reference of artifacts.references) names.add(reference.sequence, `N${reference.sequence}`);
  const tokens = decodeProgram(artifacts.program, names, { mode: 'auto' }).tokens;
  // The final statement starts at the last `&r` token; return the three
  // opcodes before it (the Local's `;` and the boundary bytes).
  const assignmentStart = tokens.map(t => t.text).lastIndexOf('&r');
  return tokens.slice(Math.max(0, assignmentStart - 3), assignmentStart).map(t => t.opcode.toString(16)).join(' ');
}

test('a Local run after a Function definition closes formally with 0x2D 0x4F', () => {
  assert.strictEqual(
    boundaryOpcodesBeforeLastStatement(`Function A()
End-Function;

Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
});

test('declaration-phase continuity survives several Function definitions and comments between them', () => {
  assert.strictEqual(
    boundaryOpcodesBeforeLastStatement(`Function A()
End-Function;

/* helper */

Function B()
End-Function;

Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
});

test('an initialized Local run after a Function keeps the informal close (no 0x2D)', () => {
  const opcodes = boundaryOpcodesBeforeLastStatement(`Function A()
End-Function;

Local Rowset &x = GetRowset(Scroll.TEST_REC);
Local Rowset &r;

&r = &x;`);
  assert.ok(!opcodes.includes('2d'), opcodes);
});

/*
 * Cycle 86: an initialized Local never closes an already-started leading
 * Local run; the run continues and its eventual close is informal
 * (definition 3869 and 51 more program-start runs; 28204 after a Function).
 */
function opcodesAfterFirstStatementUntil(source: string, stopText: string): string {
  const artifacts = encodeProgramArtifacts(source, whileGapOwner as any);
  const names = new NameTable();
  for (const reference of artifacts.references) names.add(reference.sequence, `N${reference.sequence}`);
  const tokens = decodeProgram(artifacts.program, names, { mode: 'auto' }).tokens;
  const firstSemicolon = tokens.findIndex(t => t.opcode === 0x15);
  const stop = tokens.findIndex((t, i) => i > firstSemicolon && String(t.text ?? '').trim() === stopText);
  return tokens.slice(firstSemicolon + 1, stop).map(t => t.opcode.toString(16)).join(' ');
}

test('an initialized Local does not close the leading Local run it follows', () => {
  // `Local Rowset &rs;` directly followed by an initialized Local: nothing
  // between them (stored), not `2D 4F`.
  assert.strictEqual(
    opcodesAfterFirstStatementUntil(`Local Rowset &rs;
Local number &n = 1;
&rs = GetRowset(Scroll.TEST_REC);`, 'Local'),
    ''
  );
});

test('a leading run containing an initialized Local closes informally before executable code (3539 shape)', () => {
  const opcodes = opcodesAfterFirstStatementUntil(`Local number &i;
Local number &cnt = 0;

Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`, 'GetRowset');
  assert.ok(!opcodes.includes('2d'), opcodes);
});

/*
 * Cycle 86: generalized declaration-run restart after a top-level Function
 * (before executable code). Every plain Local run after a Function closes
 * formally, whatever preceded the Function (15038, 15548, 17835 ...).
 */
const functionFn = `Function A()
End-Function;`;
const restartTail = `Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`;

for (const [label, prefix] of [
  ['a prior Local run', 'Local Rowset &q;\n\n'],
  ['a Global declaration', 'Global string &g;\n\n'],
  ['a Component declaration', 'Component string &c;\n\n'],
  ['an import', 'import PKG:*;\n\n']
] as const) {
  test(`a Local run after a Function closes formally even after ${label}`, () => {
    assert.strictEqual(
      boundaryOpcodesBeforeLastStatement(`${prefix}${functionFn}\n\n${restartTail}`),
      '15 2d 4f'
    );
  });
}

test('a Local run after a Function and a standalone comment closes formally', () => {
  assert.strictEqual(
    boundaryOpcodesBeforeLastStatement(`${functionFn}\n\n/* note */\n\n${restartTail}`),
    '15 2d 4f'
  );
});

test('an initialized Local run after a Function and a Global keeps the informal close', () => {
  const opcodes = boundaryOpcodesBeforeLastStatement(`Global string &g;

${functionFn}

Local Rowset &x = GetRowset(Scroll.TEST_REC);
Local Rowset &r;

&r = &x;`);
  assert.ok(!opcodes.includes('2d'), opcodes);
});

test('executable code before a Function prevents a later Local run from restarting', () => {
  const opcodes = boundaryOpcodesBeforeLastStatement(`Local Rowset &q = GetRowset(Scroll.TEST_REC);
&q.Flush();

${functionFn}

${restartTail}`);
  assert.ok(!opcodes.includes('2d'), opcodes);
});

test('a declaration after a Function gets exactly one blank-line marker (single gap owner)', () => {
  const artifacts = encodeProgramArtifacts(`Global string &g;

${functionFn}

Component string &c;

&c = TEST_REC.TEST_FLD;`, whileGapOwner as any);
  const names = new NameTable();
  for (const reference of artifacts.references) names.add(reference.sequence, `N${reference.sequence}`);
  const tokens = decodeProgram(artifacts.program, names, { mode: 'auto' }).tokens;
  const endFunction = tokens.findIndex(t => String(t.text ?? '').trim() === 'End-Function');
  const component = tokens.findIndex(t => String(t.text ?? '').trim() === 'Component');
  const between = tokens.slice(endFunction + 1, component).map(t => t.opcode.toString(16)).join(' ');
  assert.strictEqual(between, '15 2d 4f');
});

/*
 * Cycle 87: a declaration-section close is informal (no 0x2D) whenever the
 * open section contains an initialized Local, whichever construct triggers
 * the close -- standalone block comment (4585), REM (19459), disabled code
 * (2092) -- not only executable code (Cycle 84).
 */
function opcodesBeforeFirstComment(source: string): string {
  const artifacts = encodeProgramArtifacts(source, whileGapOwner as any);
  const names = new NameTable();
  for (const reference of artifacts.references) names.add(reference.sequence, `N${reference.sequence}`);
  const tokens = decodeProgram(artifacts.program, names, { mode: 'auto' }).tokens;
  const comment = tokens.findIndex(t => t.opcode === 0x24 || t.opcode === 0x55);
  return tokens.slice(Math.max(0, comment - 3), comment).map(t => t.opcode.toString(16)).join(' ');
}

const initializedSection = `Component string &c;
Local number &n = 1;
Local Rowset &r;
`;
const uninitializedSection = `Component string &c;
Local Rowset &r;
`;

for (const [label, comment] of [
  ['a standalone block comment', '/* next */'],
  ['a REM comment', 'REM next;'],
  ['disabled code', '<* &r = Null; *>']
] as const) {
  test(`a section with an initialized Local closes informally before ${label}`, () => {
    const opcodes = opcodesBeforeFirstComment(`${initializedSection}\n${comment}\n\n&r = GetRowset(Scroll.TEST_REC);`);
    assert.ok(!opcodes.includes('2d'), opcodes);
  });
}

test('a section without an initialized Local still closes formally before a standalone comment', () => {
  assert.strictEqual(
    opcodesBeforeFirstComment(`${uninitializedSection}\n/* next */\n\n&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
});

/*
 * Cycle 87: a REM before the first Local does not end leading-run
 * eligibility (5242); the run still closes formally.
 */
test('a REM before the first Local keeps the leading Local run eligible for its formal close', () => {
  assert.strictEqual(
    boundaryOpcodesBeforeLastStatement(`REM note;
Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
});

test('a REM after a started Local run still ends that run (unchanged)', () => {
  const before = boundaryOpcodesBeforeLastStatement(`Local Rowset &r;

REM note;

&r = GetRowset(Scroll.TEST_REC);`);
  assert.ok(!before.startsWith('15 2d'), before);
});

/*
 * Cycle 88: an open import section closes BEFORE a top-level REM whose next
 * real item is not another import (18061: `2D 4F REM`), as it already does
 * before a standalone block comment. A REM between imports keeps it open.
 */
test('an import section closes before a REM that is followed by a non-import item', () => {
  assert.strictEqual(
    opcodesBeforeFirstComment(`import PKG:*;

REM next;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
});

test('an import section stays open across a REM that is followed by another import', () => {
  const opcodes = opcodesBeforeFirstComment(`import PKG:*;
REM more imports;
import OTHER:*;

&r = GetRowset(Scroll.TEST_REC);`);
  assert.ok(!opcodes.includes('2d'), opcodes);
});

test('a Local run after an import and a REM still closes formally (26010 shape)', () => {
  assert.strictEqual(
    boundaryOpcodesBeforeLastStatement(`import PKG:*;

rem Local string &old;
Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
});

test('a REM that closes the import section also owns the blank line before a following declaration (23494 shape)', () => {
  const artifacts = encodeProgramArtifacts(`import PKG:*;

REM c;

Declare Function F PeopleCode TEST_REC.TEST_FLD FieldFormula;

&a = TEST_REC.TEST_FLD;`, whileGapOwner as any);
  const names = new NameTable();
  for (const reference of artifacts.references) names.add(reference.sequence, `N${reference.sequence}`);
  const opcodes = decodeProgram(artifacts.program, names, { mode: 'auto' }).tokens.map(t => t.opcode.toString(16));
  const rem = opcodes.indexOf('24');
  assert.deepStrictEqual(opcodes.slice(rem - 2, rem + 3), ['2d', '4f', '24', '4f', '31']);
});

/*
 * Cycle 89: the open import section owns a real blank-line gap before its
 * next import (5565: `import A; <blank> import B;` -> `15 4F 58`).
 */
function opcodesBetweenImports(source: string): string {
  const artifacts = encodeProgramArtifacts(source, whileGapOwner as any);
  const names = new NameTable();
  for (const reference of artifacts.references) names.add(reference.sequence, `N${reference.sequence}`);
  const tokens = decodeProgram(artifacts.program, names, { mode: 'auto' }).tokens;
  const imports = tokens.flatMap((t, i) => (String(t.text ?? '').trim() === 'import' ? [i] : []));
  const firstEnd = tokens.findIndex((t, i) => i > imports[0] && t.opcode === 0x15);
  return tokens.slice(firstEnd, imports[1]).map(t => t.opcode.toString(16)).join(' ');
}

test('a blank line between two imports emits 0x4F and keeps the import section open', () => {
  assert.strictEqual(
    opcodesBetweenImports(`import PKG:A;

import PKG:B;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 4f'
  );
});

test('two blank lines between imports emit two 0x4F markers', () => {
  assert.strictEqual(
    opcodesBetweenImports(`import PKG:A;


import PKG:B;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 4f 4f'
  );
});

test('adjacent imports emit no marker between them', () => {
  assert.strictEqual(
    opcodesBetweenImports(`import PKG:A;
import PKG:B;

&r = GetRowset(Scroll.TEST_REC);`),
    '15'
  );
});

/*
 * Cycle 90: before executable code, top-level comments (block, REM,
 * disabled code) are transparent to the declaration section: a comment
 * closes it only when the next real item neither is a declaration nor a
 * Local (27360, 28208, 28250, 19549).
 */
const declaredSection = `Declare Function F PeopleCode TEST_REC.TEST_FLD FieldFormula;
`;

test('a REM between a declaration and a Local does not close the section', () => {
  const source = `${declaredSection}
REM note;

Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`;
  assert.ok(!opcodesBeforeFirstComment(source).includes('2d'));
  assert.strictEqual(boundaryOpcodesBeforeLastStatement(source), '15 2d 4f');
});

test('a block comment followed by a REM before a Local does not close the section', () => {
  const source = `${declaredSection}
/* note */
REM more;

Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`;
  assert.ok(!opcodesBeforeFirstComment(source).includes('2d'));
  assert.strictEqual(boundaryOpcodesBeforeLastStatement(source), '15 2d 4f');
});

test('a block comment followed by disabled code before a Local does not close the section', () => {
  const source = `${declaredSection}
/* note */
<* &old = 1; *>

Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`;
  assert.ok(!opcodesBeforeFirstComment(source).includes('2d'));
  assert.strictEqual(boundaryOpcodesBeforeLastStatement(source), '15 2d 4f');
});

test('a REM between a declaration and executable code still closes the section before the REM', () => {
  assert.strictEqual(
    opcodesBeforeFirstComment(`${declaredSection}
REM note;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
});

/*
 * Cycle 91: a mixed plain / App-Class-typed Local run closed by a standalone
 * comment gets ONE 0x2D, owned by the App-Class-Local section closer
 * (4916, 18229, 20077, 25289 stored `2D 4F /*c*\/`, not `2D 2D 4F`).
 */
test('a mixed plain / App-Class Local run closed by a comment emits a single 0x2D', () => {
  assert.strictEqual(
    opcodesBeforeFirstComment(`import PKG:*;

Local Rowset &q;
Local PKG:Helper &h;
Local Rowset &r;

/* note */

&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
});

/*
 * Cycle 91: comments are transparent to the leading Local run's close as
 * well. A REM followed by another Local queues no close at the REM (28207:
 * stored `L[4F] REM Li ...`, initialized run -> informal close, no 0x2D),
 * and a block comment followed by disabled code before another Local does
 * not end the run, which closes formally at its real end (13957).
 */
test('a REM followed by another Local queues no Local-run close at the REM', () => {
  const opcodes = opcodesBeforeFirstComment(`Local Rowset &q;

REM note;
Local Rowset &x = GetRowset(Scroll.TEST_REC);
Local Rowset &r;

&r = &x;`);
  assert.ok(!opcodes.includes('2d'), opcodes);
});

test('a block comment and disabled code between two Locals do not end the leading Local run', () => {
  const source = `Local Rowset &q;

/* note */
<* &old = 1; *>
Local Rowset &r;

&r = GetRowset(Scroll.TEST_REC);`;
  assert.ok(!opcodesBeforeFirstComment(source).includes('2d'));
  assert.strictEqual(boundaryOpcodesBeforeLastStatement(source), '15 2d 4f');
});

/*
 * Cycle 92: the Application-Class-Local section stays open across following
 * declarations (and comments before them); it closes at executable code or
 * a Function (18673, 23568, 23068; 46/46 stored Local -> declaration
 * transitions carry no 0x2D).
 */
function topLevelOpcodes(source: string): string[] {
  const artifacts = encodeProgramArtifacts(source, whileGapOwner as any);
  const names = new NameTable();
  for (const reference of artifacts.references) names.add(reference.sequence, `N${reference.sequence}`);
  return decodeProgram(artifacts.program, names, { mode: 'auto' }).tokens.map(t =>
    /^(Component|Function)$/.test(String(t.text ?? '').trim()) ? String(t.text).trim() : t.opcode.toString(16)
  );
}

test('an App-Class Local section stays open across a following declaration', () => {
  const source = `import PKG:*;

Local PKG:Helper &h;

Component string &c;

&r = GetRowset(Scroll.TEST_REC);`;
  const opcodes = topLevelOpcodes(source);
  const component = opcodes.indexOf('Component');
  // only the blank-line marker before the declaration, no section close
  assert.deepStrictEqual(opcodes.slice(component - 2, component), ['15', '4f']);
  assert.strictEqual(boundaryOpcodesBeforeLastStatement(source), '15 2d 4f');
});

test('a comment before a declaration does not close the App-Class Local section', () => {
  const source = `import PKG:*;

Local PKG:Helper &h;

/* note */
Component string &c;

&r = GetRowset(Scroll.TEST_REC);`;
  assert.ok(!opcodesBeforeFirstComment(source).includes('2d'));
  assert.strictEqual(boundaryOpcodesBeforeLastStatement(source), '15 2d 4f');
});

test('an App-Class Local section still closes at executable code and at a Function', () => {
  assert.strictEqual(
    boundaryOpcodesBeforeLastStatement(`import PKG:*;

Local PKG:Helper &h;

&r = GetRowset(Scroll.TEST_REC);`),
    '15 2d 4f'
  );
  const opcodes = topLevelOpcodes(`import PKG:*;

Local PKG:Helper &h;

Function A()
End-Function;

&r = GetRowset(Scroll.TEST_REC);`);
  const fn = opcodes.indexOf('Function');
  assert.deepStrictEqual(opcodes.slice(fn - 3, fn), ['15', '2d', '4f']);
});

// Cycle 93: PSPCMNAME identities of an ordinary program, in allocation order.
const referenceKeys = (source: string): string[] =>
  encodeProgramArtifacts(source).references.map(reference =>
    reference.kind === 'package'
      ? `PACKAGE.${reference.packageName ?? ''}`
      : reference.kind === 'scroll'
        ? `SCROLL.${reference.recordName ?? ''}`
        : `${reference.recordName ?? ''}.${reference.fieldName ?? ''}`
  );

test('a nested uninitialized App Class Local allocates its row at the declaration and create reuses it', () => {
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

If &a = 1 Then
   Local PKG:Helper &h;
   &r = GetRowset(Scroll.TEST_A);
   &h = create PKG:Helper();
End-If;`),
    ['PACKAGE.HELPER', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
});

test('a nested App Class Local reuses a row an earlier create established', () => {
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

If &a = 1 Then
   &h0 = create PKG:Helper();
   &r = GetRowset(Scroll.TEST_A);
   Local PKG:Helper &h;
   &r = GetRowset(Scroll.TEST_B);
End-If;`),
    ['PACKAGE.HELPER', 'PACKAGE.HELPER', 'SCROLL.TEST_A', 'SCROLL.TEST_B']
  );
});

test('a top-level late App Class Local keeps its own row, separate from a later create', () => {
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

&r = GetRowset(Scroll.TEST_B);
Local PKG:Helper &h2;
&r = GetRowset(Scroll.TEST_C);
&h2 = create PKG:Helper();`),
    ['PACKAGE.HELPER', 'SCROLL.TEST_B', 'PACKAGE.HELPER', 'SCROLL.TEST_C', 'PACKAGE.HELPER']
  );
});

// Cycle 93: Application Class TYPE rows in ordinary programs follow the
// class's import resolution (named import vs wildcard import).

test('an ordinary program claims the wildcard-import row once', () => {
  // 5495: two wildcard imports, one blank-REFNAME PACKAGE row.
  assert.deepStrictEqual(
    referenceKeys(`import PKG_A:*;
import PKG_B:*;

&r = GetRowset(Scroll.TEST_A);`),
    ['PACKAGE.', 'SCROLL.TEST_A']
  );
  // The row sits at the FIRST wildcard import, after earlier named imports.
  assert.deepStrictEqual(
    referenceKeys(`import PKG_A:Named;
import PKG_B:*;
import PKG_C:*;

&r = GetRowset(Scroll.TEST_A);`),
    ['PACKAGE.NAMED', 'PACKAGE.', 'SCROLL.TEST_A']
  );
});

test('a leading Local of a wildcard-resolved class allocates its type row at the declaration', () => {
  // 15559: blank row, declaration row, Scroll, then the create row.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:*;

Local PKG:Helper &h;

&r = GetRowset(Scroll.TEST_A);
&h = create PKG:Helper();`),
    ['PACKAGE.', 'PACKAGE.HELPER', 'SCROLL.TEST_A', 'PACKAGE.HELPER']
  );
});

test('a leading Local of a named-import class allocates no declaration row', () => {
  // 381: the import row resolves the class, even with a wildcard import present.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;
import OTHER:*;

Local PKG:Helper &h;

&r = GetRowset(Scroll.TEST_A);
&h = create PKG:Helper();`),
    ['PACKAGE.HELPER', 'PACKAGE.', 'SCROLL.TEST_A', 'PACKAGE.HELPER']
  );
});

test('declarations of one wildcard-resolved class share a single type row', () => {
  // 14888: Component array of, then Local. 17900: array-of Locals and a scalar.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:*;

Component array of PKG:Helper &list;
Component PKG:Helper &c;
Local array of PKG:Helper &more;
Local PKG:Helper &h;

&r = GetRowset(Scroll.TEST_A);`),
    ['PACKAGE.', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
});

test('a Component of a named-import class allocates no row under a wildcard import', () => {
  // 18028 / 24499: PROCESSCONTROLLER appears once, for the import.
  assert.deepStrictEqual(
    referenceKeys(`import OTHER:*;
import PKG:Helper;

Component PKG:Helper &c;
Component array of PKG:Helper &list;

&r = GetRowset(Scroll.TEST_A);`),
    ['PACKAGE.', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
});

test('a top-level Local after a Function definition is not in the declaration phase', () => {
  // 17893: such Locals are outside the leading unit and open their own row,
  // even for a named-import class.
  const source = (importLine: string) => `${importLine}

Function A()
End-Function;

Local PKG:Helper &h;

&r = GetRowset(Scroll.TEST_A);`;
  assert.deepStrictEqual(
    referenceKeys(source('import PKG:*;')),
    ['PACKAGE.', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
  assert.deepStrictEqual(
    referenceKeys(source('import PKG:Helper;')),
    ['PACKAGE.HELPER', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
});

test('the create row is allocated after the rows its arguments allocate', () => {
  // 20249: declaration row, argument row, create row.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:*;

Local PKG:Helper &h;

&h = create PKG:Helper(GetRowset(Scroll.TEST_A));`),
    ['PACKAGE.', 'PACKAGE.HELPER', 'SCROLL.TEST_A', 'PACKAGE.HELPER']
  );
  // Named import: no declaration row, the create row still follows its arguments.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

&h = create PKG:Helper(GetRowset(Scroll.TEST_A));`),
    ['PACKAGE.HELPER', 'SCROLL.TEST_A', 'PACKAGE.HELPER']
  );
});

test('a create initializing its own declared Local keeps its row before the arguments', () => {
  // 24442 / 13522: `Local PKG:Class &v = create PKG:Class(args)`.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

&r = GetRowset(Scroll.TEST_A);
Local PKG:Helper &h = create PKG:Helper(GetRowset(Scroll.TEST_B));`),
    ['PACKAGE.HELPER', 'SCROLL.TEST_A', 'PACKAGE.HELPER', 'SCROLL.TEST_B']
  );
});

test('a top-level method call on a wildcard-resolved class opens its own row', () => {
  // 18918: create row, then the method row, then the argument rows.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:*;

Local PKG:Helper &h = create PKG:Helper();
&h.Run(GetRowset(Scroll.TEST_A));`),
    ['PACKAGE.', 'PACKAGE.HELPER', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
});

test('a top-level method call on a named-import class still reuses the create row', () => {
  // 22882: one row after the import row.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

Local PKG:Helper &h = create PKG:Helper();
&h.Run(GetRowset(Scroll.TEST_A));`),
    ['PACKAGE.HELPER', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
});

test('a try block is one allocation unit for Application Class rows', () => {
  // 17594: the create and the calls inside one try share a single row.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:*;

Local PKG:Helper &h;
try
   &h = create PKG:Helper();
   &h.Run(GetRowset(Scroll.TEST_A));
   &h.Stop();
catch Exception &e
end-try;`),
    ['PACKAGE.', 'PACKAGE.HELPER', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
});

// Cycle 93: programs whose PACKAGE rows depend on external class metadata.

test('a method call through an App Class property keeps the pre-import-resolution rows', () => {
  // 13525: the class of `&h.Owner` is declared in PKG_B:Helper, not here, so
  // the program's row stream cannot be modeled and the import-resolution
  // rules stay off for the whole program (both wildcard imports claim a row).
  const source = (call: string) => `import PKG_A:*;
import PKG_B:*;

Local PKG_B:Helper &h = create PKG_B:Helper();
${call}
&r = GetRowset(Scroll.TEST_A);`;
  assert.deepStrictEqual(
    referenceKeys(source('&h.Owner.Run();')),
    ['PACKAGE.', 'PACKAGE.', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
  // The same program without the property hop is fully resolvable.
  assert.deepStrictEqual(
    referenceKeys(source('&h.Run();')),
    ['PACKAGE.', 'PACKAGE.HELPER', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
  // A property READ alone needs no class identity.
  assert.deepStrictEqual(
    referenceKeys(source('&x = &h.Owner;')),
    ['PACKAGE.', 'PACKAGE.HELPER', 'SCROLL.TEST_A']
  );
});

test('a method call on an App Class method result is external class metadata too', () => {
  assert.deepStrictEqual(
    referenceKeys(`import PKG_A:*;
import PKG_B:*;

Local PKG_B:Helper &h = create PKG_B:Helper();
&h.GetOwner().Run();`).filter(key => key === 'PACKAGE.').length,
    2
  );
});

test('trace hooks observe exactly one encoding pass', () => {
  for (const call of ['&h.Owner.Run();', '&h.Run();']) {
    const source = `import PKG_A:*;
import PKG_B:*;

Local PKG_B:Helper &h = create PKG_B:Helper();
${call}
&r = GetRowset(Scroll.TEST_A);`;
    let allocations = 0;
    const encoded = encodeProgramArtifacts(source, {
      referenceTrace: event => {
        if (event.action === 'ALLOC') allocations++;
      }
    });
    assert.strictEqual(
      allocations,
      encoded.references.filter(reference => reference.kind !== 'owner').length
    );
  }
});

// Cycle 94: Application Class rows are scoped to an allocation unit -- the
// leading declaration section, then each top-level statement.

test('every top-level statement opens its own method row on a declared instance', () => {
  // 26262 / 1769: named and wildcard alike; 522 stored single-call gaps.
  for (const [importLine, importRow] of [['import PKG:Helper;', 'PACKAGE.HELPER'], ['import PKG:*;', 'PACKAGE.']] as const) {
    const declarationRow = importLine.endsWith('*;') ? ['PACKAGE.HELPER'] : [];
    assert.deepStrictEqual(
      referenceKeys(`${importLine}

Component PKG:Helper &h;

&h.Run();
&r = GetRowset(Scroll.TEST_A);
&h.Run();`),
      [importRow, ...declarationRow, 'PACKAGE.HELPER', 'SCROLL.TEST_A', 'PACKAGE.HELPER']
    );
  }
});

test('a leading create-initialized Local of a named-import class allocates nothing', () => {
  // 68 / 68 stored gaps: the import row is in the same (leading) unit. The
  // method call in the next statement opens the only new row.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

Local PKG:Helper &h = create PKG:Helper(GetRowset(Scroll.TEST_A));
&h.Run();`),
    ['PACKAGE.HELPER', 'SCROLL.TEST_A', 'PACKAGE.HELPER']
  );
});

test('uses of a class nested in one control structure share one row', () => {
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

Component PKG:Helper &h;

If &a = 1 Then
   &h = create PKG:Helper();
   &h.Run(GetRowset(Scroll.TEST_A));
   &h.Stop(GetRowset(Scroll.TEST_B));
End-If;
&h.Run();`),
    ['PACKAGE.HELPER', 'PACKAGE.HELPER', 'SCROLL.TEST_A', 'SCROLL.TEST_B', 'PACKAGE.HELPER']
  );
});

test('creates in separate top-level statements each open a row', () => {
  // 17900: three consecutive STRINGMAP rows.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

&r = GetRowset(Scroll.TEST_A);
&a = create PKG:Helper();
&b = create PKG:Helper();`),
    ['PACKAGE.HELPER', 'SCROLL.TEST_A', 'PACKAGE.HELPER', 'PACKAGE.HELPER']
  );
});

test('a method call on an undeclared variable allocates no row', () => {
  // 69 / 69 stored gaps.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

&r = GetRowset(Scroll.TEST_A);
&a = create PKG:Helper();
&a.Run();`),
    ['PACKAGE.HELPER', 'SCROLL.TEST_A', 'PACKAGE.HELPER']
  );
});

test('a Global Application Class instance is a method-call receiver', () => {
  // 18698: 58 / 58 stored single-call gaps.
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

Global PKG:Helper &g;

&g.Run();`),
    ['PACKAGE.HELPER', 'PACKAGE.HELPER']
  );
});

test('Function body statements are separate units and parameters are receivers', () => {
  assert.deepStrictEqual(
    referenceKeys(`import PKG:Helper;

Function A(&p As PKG:Helper)
   Local PKG:Helper &h;
   &p.Run();
   &h.Run();
End-Function;`),
    ['PACKAGE.HELPER', 'PACKAGE.HELPER', 'PACKAGE.HELPER', 'PACKAGE.HELPER']
  );
});

test('a late initialized Local array of a builtin type opens its own type row', () => {
  // 2092 (late: two RECORD rows) vs 2093 (leading section: one).
  const late = referenceKeys(`&r = GetRowset(Scroll.TEST_A);
Local Record &record;
Local array of Record &records = CreateArrayRept(&record, 0);`);
  assert.strictEqual(late.filter(key => key === 'PACKAGE.RECORD').length, 2);
  const leading = referenceKeys(`Local Record &record;
Local array of Record &records = CreateArrayRept(&record, 0);
&r = GetRowset(Scroll.TEST_A);`);
  assert.strictEqual(leading.filter(key => key === 'PACKAGE.RECORD').length, 1);
});

// Cycle 95: RECORD rows of an ordinary program live for one allocation unit.

test('a RECORD row is reused within an allocation unit and reopened in the next', () => {
  const recordRows = (source: string) =>
    encodeProgramArtifacts(source).references.filter(reference => reference.kind === 'record').length;
  // CreateRowset in one top-level statement, shorthand in the next: two rows.
  assert.strictEqual(
    recordRows(`Local Rowset &rs;
&rs = CreateRowset(Record.TEST_REC);
&x = &rs(1).TEST_REC.TEST_FIELD.Value;`),
    2
  );
  // The same two statements inside one If: one row.
  assert.strictEqual(
    recordRows(`Local Rowset &rs;
If &a = 1 Then
   &rs = CreateRowset(Record.TEST_REC);
   While &b
      &x = &rs(1).TEST_REC.TEST_FIELD.Value;
   End-While;
End-If;`),
    1
  );
  // Shorthand in two top-level statements: two rows; in one statement: one.
  assert.strictEqual(
    recordRows(`&x = &rs(1).TEST_REC.F1.Value;
&y = &rs(2).TEST_REC.F2.Value;`),
    2
  );
  assert.strictEqual(
    recordRows(`&x = &rs(1).TEST_REC.F1.Value + &rs2(2).TEST_REC.F2.Value;`),
    1
  );
  // Function body statements are separate units.
  assert.strictEqual(
    recordRows(`Function A()
   &x = &rs(1).TEST_REC.F1.Value;
   &y = &rs(1).TEST_REC.F2.Value;
End-Function;`),
    2
  );
});

// Cycle 96: FIELD rows of an ordinary program live for one allocation unit.

test('a FIELD row is reused within an allocation unit and reopened in the next', () => {
  const fieldRows = (source: string) =>
    encodeProgramArtifacts(source).references.filter(reference =>
      (reference.kind === 'field' || reference.kind === 'record-field') &&
      (reference.kind === 'field' || /^Field$/i.test(reference.recordName ?? ''))
    ).length;
  // Row shorthand in two top-level statements: two FIELD rows.
  assert.strictEqual(
    fieldRows(`&a = &rs(1).TEST_REC.TEST_FIELD.Value;
&b = &rs(2).TEST_REC.TEST_FIELD.Value;`),
    2
  );
  // In the If and Else of one If: one.
  assert.strictEqual(
    fieldRows(`If &y Then
   &a = &rs(1).TEST_REC.TEST_FIELD.Value;
Else
   &b = &rs(1).TEST_REC.TEST_FIELD.Value;
End-If;`),
    1
  );
  // One If statement: one FIELD row, including the statement-start
  // `Field.X.Value = ...` form (16080).
  assert.strictEqual(
    fieldRows(`If &rec.GetField(Field.TEST_FIELD).Value = 0 Then
   Field.TEST_FIELD.Value = 1;
End-If;`),
    1
  );
});

// Cycle 96: SCROLL rows of an ordinary program live for one allocation unit.

test('a SCROLL row is reused within an allocation unit and reopened in the next', () => {
  const scrollRows = (source: string) =>
    encodeProgramArtifacts(source).references.filter(reference =>
      reference.kind === 'scroll' ||
      (reference.kind === 'record-field' && /^Scroll$/i.test(reference.recordName ?? ''))
    ).length;
  assert.strictEqual(
    scrollRows(`&a = GetRowset(Scroll.TEST_REC);
&b = GetRowset(Scroll.TEST_REC);`),
    2
  );
  // Two calls in one If: one row.
  assert.strictEqual(
    scrollRows(`If &x Then
   Hide(Scroll.TEST_REC);
   &n = ActiveRowCount(Scroll.TEST_REC);
End-If;`),
    1
  );
});

// Cycle 96: RECORD.FIELD rows of an ordinary program live for one allocation unit.

test('a RECORD.FIELD row is shared across one try block and reopened in the next statement', () => {
  const recordFieldRows = (source: string) =>
    encodeProgramArtifacts(source, { owner: { recordName: 'OWN_REC', fieldName: 'OWN_FIELD' } })
      .references.filter(reference => reference.kind === 'record-field').length;
  // 10351: a try block is one unit, however deep the second use is nested.
  assert.strictEqual(
    recordFieldRows(`try
   &a = TEST_REC.F1;
   If &x Then
      &b = TEST_REC.F1;
   End-If;
catch Exception &e
end-try;`),
    1
  );
  assert.strictEqual(
    recordFieldRows(`&a = TEST_REC.F1;
&b = TEST_REC.F1;`),
    2
  );
});

test('Declare Function operands keep one row per REC.FIELD for the whole program', () => {
  // 27129: two Declares of one FieldFormula after a Function definition.
  const keys = encodeProgramArtifacts(`Function A()
End-Function;

Declare Function B PeopleCode TEST_LIB.F1 FieldFormula;
Declare Function C PeopleCode TEST_LIB.F1 FieldFormula;`, { owner: { recordName: 'OWN_REC', fieldName: 'OWN_FIELD' } })
    .references.filter(reference => reference.kind !== 'owner');
  assert.strictEqual(keys.length, 1);
});

// Cycle 97: built-in object properties stay inline member names.

test('built-in Row and Record properties open no PSPCMNAME row', () => {
  const rows = (source: string) =>
    encodeProgramArtifacts(source).references
      .filter(reference => reference.kind === 'record' || reference.kind === 'field')
      .map(reference => `${reference.kind}:${reference.recordName ?? reference.fieldName}`);
  // Record value: FieldCount is a property, TEST_FIELD a field (1295, 2127).
  assert.deepStrictEqual(
    rows(`Local Rowset &rs;
&n = &rs(1).TEST_REC.FieldCount;
&m = &rs(1).TEST_REC.TEST_FIELD.Value;`),
    ['record:TEST_REC', 'record:TEST_REC', 'field:TEST_FIELD']
  );
  // Row / Rowset value: DeleteEnabled and ParentRowset are properties (5182, 924).
  assert.deepStrictEqual(
    rows(`Local Rowset &rs;
&b = &rs(1).DeleteEnabled;
&r = &rs(1).ParentRowset;
&c = &rs(1).TEST_REC.TEST_FIELD.Value;`),
    ['record:TEST_REC', 'field:TEST_FIELD']
  );
});

// Cycle 98: receiver types that were lost before a member was bound.

test('Component Row, Global Record, CreateRecord and ParentRow results are typed receivers', () => {
  const rows = (source: string) =>
    encodeProgramArtifacts(source).references
      .filter(reference => reference.kind === 'record' || reference.kind === 'field')
      .map(reference => `${reference.kind}:${reference.kind === 'record' ? reference.recordName : reference.fieldName}`);
  assert.deepStrictEqual(
    rows(`Component Row &r;
&x = &r.TEST_REC.TEST_FIELD.Value;`),
    ['record:TEST_REC', 'field:TEST_FIELD']
  );
  assert.deepStrictEqual(
    rows(`Global Record &g1, &g2;
&x = &g2.TEST_FIELD.Value;`),
    ['field:TEST_FIELD']
  );
  assert.deepStrictEqual(
    rows('&x = CreateRecord(Record.TEST_REC).TEST_FIELD.Value;'),
    ['record:TEST_REC', 'field:TEST_FIELD']
  );
  assert.deepStrictEqual(
    rows(`Local Field &f;
&x = &f.ParentRow.TEST_REC.TEST_FIELD.Value;
&n = &f.ParentRow.RowNumber;`),
    ['record:TEST_REC', 'field:TEST_FIELD']
  );
});

test('a single bare member off a Row is a record reference unless it is a Row property', () => {
  const rows = (source: string) =>
    encodeProgramArtifacts(source).references
      .filter(reference => reference.kind === 'record' || reference.kind === 'field')
      .map(reference => `${reference.kind}:${reference.kind === 'record' ? reference.recordName : reference.fieldName}`);
  // 536 / 2182: `&row.REC` and `GetRow().REC` at a chain end.
  assert.deepStrictEqual(
    rows(`Local Row &row;
&rec = &row.TEST_REC;
&n = &row.RowNumber;
&b = &row.IsChanged;
&o = GetRow().OTHER_REC;`),
    ['record:TEST_REC', 'record:OTHER_REC']
  );
});

test('Selected off a Record value is a field, off a Row value a property', () => {
  // 560: `&rs.GetRow(&i).ADHOC_SALCHG_WK.SELECTED.Value`.
  const rows = (source: string) =>
    encodeProgramArtifacts(source).references
      .filter(reference => reference.kind === 'record' || reference.kind === 'field')
      .map(reference => `${reference.kind}:${reference.kind === 'record' ? reference.recordName : reference.fieldName}`);
  assert.deepStrictEqual(
    rows(`Local Rowset &rs;
&rs.GetRow(&i).TEST_REC.SELECTED.Value = "N";
&s = &rs.GetRow(&i).Selected;`),
    ['record:TEST_REC', 'field:SELECTED']
  );
});

// Cycle 99: Declare Function rows are keyed by REC.FIELD, not by event.

test('Declare Functions of one REC.FIELD share a row whatever the event', () => {
  const rows = (source: string) =>
    encodeProgramArtifacts(source, { owner: { recordName: 'OWN_REC', fieldName: 'OWN_FIELD' } })
      .references.filter(reference => reference.kind === 'declare-function')
      .map(reference => `${reference.recordName}.${reference.fieldName}`);
  // 6270: FieldFormula and FieldChange of one target -> one row.
  assert.deepStrictEqual(
    rows(`Declare Function A PeopleCode TEST_LIB.F1 FieldFormula;
Declare Function B PeopleCode TEST_LIB.F1 FieldChange;`),
    ['TEST_LIB.F1']
  );
  // Different field or different record -> separate rows.
  assert.deepStrictEqual(
    rows(`Declare Function A PeopleCode TEST_LIB.F1 FieldFormula;
Declare Function B PeopleCode TEST_LIB.F2 FieldFormula;
Declare Function C PeopleCode OTHER_LIB.F1 FieldFormula;`),
    ['TEST_LIB.F1', 'TEST_LIB.F2', 'OTHER_LIB.F1']
  );
});
