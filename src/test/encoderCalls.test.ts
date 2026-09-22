import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment, encodeProgram, UnsupportedPeopleCodeError } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { readProgramLayout } from '../peoplecode/programLayout.js';
import { CALL_STATEMENTS, CALL_PROGRAMS } from './fixtures/callPeopleCode.js';

for (const fixture of CALL_STATEMENTS) {
  test(`call/group statement regenerates actual bytes: ${fixture.source}`, () => {
    const bytes = Buffer.from(fixture.hex, 'hex');
    assert.deepEqual(encodeFragment(fixture.source), bytes);
    assert.equal(decodeProgram(bytes, new NameTable(), { mode: 'strict' }).text, fixture.source + '\n');
    assert.deepEqual(encodeFragment(decodeProgram(bytes, new NameTable()).text), bytes);
  });
}

for (const fixture of CALL_PROGRAMS) {
  test(`complete call program regenerates actual bytes: ${fixture.key}`, () => {
    const original = Buffer.from(fixture.hex, 'hex');
    const generated = encodeProgram(fixture.source);
    assert.deepEqual(generated, original);
    const layout = readProgramLayout(generated);
    assert.equal(layout.names.byteLength, 0);
    assert.equal(layout.recordCount, 0);
    assert.equal(layout.slotCount, 0);
    assert.equal(decodeProgram(generated, new NameTable(), { mode: 'strict' }).text, fixture.source + '\n');
  });
}

for (const [source, expected] of [
  ['Return (1+2)*3;', 'Return (1 + 2) * 3;\n'],
  ['&n=(1+(2*3))/(4-1);', '&n = (1 + (2 * 3)) / (4 - 1);\n'],
  ['UpdateSysVersion ( );', 'UpdateSysVersion();\n'],
  ['Return Abs(1);', 'Return Abs(1);\n'],
  ['Return Value("12");', 'Return Value("12");\n'],
  ['Return LTrim(String(12));', 'Return LTrim(String(12));\n'],
  ['&p=Find("/", &s, 2+1);', '&p = Find("/", &s, 2 + 1);\n'],
  ['Return (LTrim(String(&String)));', 'Return (LTrim(String(&String)));\n'],
  ['&n=Abs(1)+Abs(2)*3;', '&n = Abs(1) + Abs(2) * 3;\n'],
  ['WinMessage("comma, parens() and ""quotes""");', 'WinMessage("comma, parens() and ""quotes""");\n'],
  ['Return Foo(True, False, "£😀", "", (12));', 'Return Foo(True, False, "£😀", "", (12));\n'],
  ['&a=1; Foo(); Return (2);', '&a = 1;\nFoo();\nReturn (2);\n']
]) {
  test(`complete call/group semantic round trip: ${source}`, () => {
    const bytes = encodeProgram(source);
    const decoded = decodeProgram(bytes, new NameTable(), { mode: 'strict' });
    assert.equal(decoded.text, expected);
    assert.deepEqual(encodeProgram(decoded.text), bytes);
  });
}

test('a no-argument call has only the known identifier and punctuation framing', () => {
  // Synthetic short name; no claim that a function named F exists at runtime.
  assert.deepEqual(encodeFragment('F();'), Buffer.from([0x0a, 0x46, 0, 0, 0, 0x0b, 0x14, 0x15]));
});

for (const source of [
  'Return ();', 
  'Return (1;', 
  'Return 1);', 
  'Return (1, 2);',
  'F(,1);', 'F(1,);', 'F(1,,2);', 'F(1 2);', 'F(', 'F(1;', 'F()) ;',
  'Return F(1; 2);', 
  'Return F;', 
  'F;', 
  'Foo + 1;',
  'F() + 1;', 'F()(1);', 'F().Value;', 'Return %This.F();',
  'Return Pkg:Foo();',
  'Return F(1.5);', 'Return (1 = 2);', 'Return (True And False);',
  'If(True);', 'Return Not(1);', 'Return Create();', 'Return Local();',
  'True();', 'Return True();', 'Return Foo(1) garbage;', 'F(); Return (1;'
]) {
  test(`malformed/unsupported call syntax fails: ${source}`, () => {
    assert.throws(() => encodeProgram(source), (error: unknown) => {
      assert.ok(error instanceof UnsupportedPeopleCodeError);
      assert.ok(error.offset >= 0 && error.offset <= source.length);
      return true;
    });
  });
}

test('malformed argument diagnostic points to the missing operand', () => {
  assert.throws(() => encodeFragment('F(1,);'), (error: unknown) => {
    assert.ok(error instanceof UnsupportedPeopleCodeError);
    assert.equal(error.offset, 4);
    return true;
  });
});

for (const call of [false, true]) {
  test(`nested ${call ? 'calls' : 'groups'} have a deliberate depth limit`, () => {
    const source = (depth: number) => `Return ${(call ? 'Abs(' : '(').repeat(depth)}1${')'.repeat(depth)};`;
    const allowed = encodeProgram(source(128));
    assert.equal(decodeProgram(allowed, new NameTable(), { mode: 'strict' }).unknownOpcodes.length, 0);
    assert.throws(() => encodeProgram(source(129)), (error: unknown) => {
      assert.ok(error instanceof UnsupportedPeopleCodeError);
      assert.match(error.message, /nesting exceeds 128/);
      return true;
    });
  });
}
