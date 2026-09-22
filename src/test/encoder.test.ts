import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment, UnsupportedPeopleCodeError } from '../peoplecode/encoder.js';
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

for (const source of ['Return -1;', 'Return Null;', '&x = True And False;',
  'If True Then Return; End-If;', 'Local string &x;', 'Foo;', 'Return "oops;',
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
