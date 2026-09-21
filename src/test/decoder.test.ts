import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeProgram, TokenKind, UndecodableProgramError } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/**
 * OU_OJ_LAYOUT.Activate's real PSPCMPROG bytes (HCDEV), 104 bytes matching
 * its PROGLEN exactly. Its known-correct source, from an App Designer export
 * of the same program, is a single line:
 *   AddOnLoadScript(GetHTMLText(HTML.OU_OJ_LOAD_CSS));
 *
 * This caught a real bug: byte 0x00 (the UTF-16LE upper byte of ordinary
 * ASCII text, e.g. in "AddOnLoadScript") was mapped as an unconditional
 * end-of-program opcode, so decoding stopped after essentially one byte.
 * PROGLEN for this program is exactly its buffer length, confirming there is
 * no in-band terminator to stop early on.
 */
const ACTIVATE_BYTES = Buffer.from([
  0xa0, 0x00, 0x00, 0x00, 0x00, 0x43, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x85, 0x00, 0x00, 0x00, 0x0a,
  0x41, 0x00, 0x64, 0x00, 0x64, 0x00, 0x4f, 0x00, 0x6e, 0x00,
  0x4c, 0x00, 0x6f, 0x00, 0x61, 0x00, 0x64, 0x00, 0x53, 0x00,
  0x63, 0x00, 0x72, 0x00, 0x69, 0x00, 0x70, 0x00, 0x74, 0x00,
  0x00, 0x00, 0x0b, 0x0a,
  0x47, 0x00, 0x65, 0x00, 0x74, 0x00, 0x48, 0x00, 0x54, 0x00,
  0x4d, 0x00, 0x4c, 0x00, 0x54, 0x00, 0x65, 0x00, 0x78, 0x00,
  0x74, 0x00,
  0x00, 0x00, 0x0b,
  0x21, 0x01, 0x00, 0x14, 0x14, 0x15, 0x07
]);

test('the fixed 37-byte header is recognised as one token, not 37 unknown bytes', () => {
  const result = decodeProgram(ACTIVATE_BYTES, new NameTable());
  assert.equal(result.tokens[0].kind, TokenKind.Header);
  assert.equal(result.tokens[0].offset, 0);
});

test('0xa0 is consumed by the header and never reported as an unknown opcode', () => {
  const result = decodeProgram(ACTIVATE_BYTES, new NameTable());
  const opcodes = new Set(result.unknownOpcodes.map((u) => u.opcode));
  assert.ok(!opcodes.has(0xa0));
});

test('AddOnLoadScript and GetHTMLText decode as bare identifiers after a newline', () => {
  // Confirmed against WinMessage in SAVE_PRE_CHANGE_BYTES below: a spelled
  // identifier with no introducer opcode, immediately after 0x0a, is a
  // function name -- not opcode-directed like %Mode or "A" below, but only
  // ever tried right after a newline, never on proximity alone.
  const result = decodeProgram(ACTIVATE_BYTES, new NameTable());
  assert.ok(result.text.includes('AddOnLoadScript'));
  assert.ok(result.text.includes('GetHTMLText'));
});

test('a reference whose index does not resolve stays unmapped rather than guessing', () => {
  // Activate's tail is 0x21 0x01 0x00 ... -- a real name reference, index 1,
  // which in Activate's real name table resolves to OU_OJ_LOAD_CSS (source:
  // `GetHTMLText(HTML.OU_OJ_LOAD_CSS)`). Given the EMPTY table here it
  // resolves to nothing, and must then be reported rather than rendered.
  //
  // An earlier version of this test asserted 0x21 stays unmapped because
  // "byte[2] after it is 0x00, not the 0x05 every confirmed reference ends
  // in". That rationale was wrong: the 0x05 is the separate `.` operator,
  // not part of the reference, and requiring it was a real bug -- see
  // readRecordFieldReference. The assertion still holds, for the right
  // reason now.
  const result = decodeProgram(ACTIVATE_BYTES, new NameTable());
  const opcodes = new Set(result.unknownOpcodes.map((u) => u.opcode));
  assert.ok(opcodes.has(0x21));
});

test('newline (0x0a) still decodes to a literal newline', () => {
  const result = decodeProgram(Buffer.from([0x0a, 0x0a]), new NameTable());
  assert.equal(result.text, '\n\n');
  assert.equal(result.unknownOpcodes.length, 0);
});

test('strict mode throws on the first unmapped opcode instead of collecting them', () => {
  assert.throws(
    () => decodeProgram(Buffer.from([0x0a, 0xff]), new NameTable(), { mode: 'strict' }),
    UndecodableProgramError);
});

test('raw mode lists every byte with its mapped status, and does not stop early', () => {
  const result = decodeProgram(ACTIVATE_BYTES, new NameTable(), { mode: 'raw' });
  const lines = result.text.split('\n');
  // header (4 lines) + name table (0 entries) + 2 header lines + one line per byte
  const byteLines = lines.filter((l) => /^\s*\d+\s+0x/.test(l));
  assert.equal(byteLines.length, ACTIVATE_BYTES.length);
});

/**
 * OU_VSCODE_LEARN_JN's OU_CODE_WRK.CODE program (HCDEV), 90 real PSPCMPROG
 * bytes. The user deliberately gave the same source to 17 different record
 * PeopleCode events, which all produced byte-identical programs -- source:
 *   If (%Mode = "A") Then
 *      If (%Mode = "AB") Then
 *      End-If;
 *   End-If;
 */
const CODE_WRK_BYTES = Buffer.from([
  0xa0, 0x00, 0x00, 0x00, 0x00, 0x35, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x85, 0x00, 0x00, 0x00, 0x1c, 0x0b, 0x12, 0x25, 0x00, 0x4d, 0x00, 0x6f, 0x00, 0x64, 0x00,
  0x65, 0x00, 0x00, 0x00, 0x06, 0x16, 0x41, 0x00, 0x00, 0x00, 0x14, 0x1f, 0x1c, 0x0b, 0x12, 0x25,
  0x00, 0x4d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x65, 0x00, 0x00, 0x00, 0x06, 0x16, 0x41, 0x00, 0x42,
  0x00, 0x00, 0x00, 0x14, 0x1f, 0x1a, 0x15, 0x1a, 0x15, 0x07
]);

test('a program built entirely from confirmed opcodes decodes with no gaps at all', () => {
  const result = decodeProgram(CODE_WRK_BYTES, new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(
    result.text,
    'If (%Mode = "A") Then\n  If (%Mode = "AB") Then\n  End-If;\nEnd-If;\n');
});

/**
 * WEBLIB_EOAW.EOAW_AP_BUILDER.RowInit (HCDEV), 85 real PSPCMPROG bytes, real
 * PSPCMNAME table {1: EOAW_AP_BUILDER}. Source (from a real App Designer
 * export of the same program):
 *   If %Mode = "A" Then
 *      WEBLIB_EOAW.EOAW_AP_BUILDER.Visible = False;
 *   End-If;
 *
 * Cross-checking this against CODE_WRK_BYTES is what caught the false
 * positive in an earlier, unshipped text-run heuristic: byte 0x21 here sits
 * exactly where a heuristic based on byte-pattern proximity alone would have
 * misread it as a one-character string literal "!", which does not exist
 * anywhere in the real source.
 */
const ROW_INIT_BYTES = Buffer.from([
  0xa0, 0x00, 0x00, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x85, 0x00, 0x00, 0x00, 0x1c, 0x12, 0x25, 0x00, 0x4d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x65,
  0x00, 0x00, 0x00, 0x06, 0x16, 0x41, 0x00, 0x00, 0x00, 0x1f, 0x21, 0x00, 0x00, 0x05, 0x0a, 0x56,
  0x00, 0x69, 0x00, 0x73, 0x00, 0x69, 0x00, 0x62, 0x00, 0x6c, 0x00, 0x65, 0x00, 0x00, 0x00, 0x06,
  0x30, 0x15, 0x1a, 0x15, 0x07
]);

function rowInitNames(): NameTable {
  const names = new NameTable();
  names.add(1, 'EOAW_AP_BUILDER');
  return names;
}

test('RowInit decodes with no unmapped opcodes when given its real name table', () => {
  const result = decodeProgram(ROW_INIT_BYTES, rowInitNames());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.ok(!result.text.includes('!'), 'no fake "!" string literal should ever appear');
  assert.ok(result.text.includes('If %Mode = "A" Then'));
  assert.ok(result.text.includes('EOAW_AP_BUILDER'));
  assert.ok(result.text.includes('Visible = False;\nEnd-If;\n'));
});

test('the reference falls through to unmapped, not a guess, without a matching name table entry', () => {
  const result = decodeProgram(ROW_INIT_BYTES, new NameTable());
  const opcodes = new Set(result.unknownOpcodes.map((u) => u.opcode));
  assert.ok(opcodes.has(0x21));
  assert.ok(!result.text.includes('EOAW_AP_BUILDER'));
});

/**
 * OU_CODE_WRK.CODE.SavePreChange (HCDEV), 169 real PSPCMPROG bytes, real
 * PSPCMNAME table {1: CODE}. Source:
 *   If (%Mode = "A") Then
 *      If (1 = 2) Then
 *      End-If;
 *      WinMessage("Test");
 *      OU_CODE_WRK.CODE.Visible = False;
 *   End-If;
 *
 * This is what first resolved 0x21 ... 0x05 as a record.field reference. It
 * also confirmed a number literal shape (opcode 0x50, 18 more bytes, the
 * value at a fixed relative position, everything else zero) and that a plain
 * function-call identifier (WinMessage) decodes the same way
 * AddOnLoadScript/GetHTMLText did: spelled directly after a newline, no
 * introducer opcode.
 */
const SAVE_PRE_CHANGE_BYTES = Buffer.from([
  0xa0, 0x00, 0x00, 0x00, 0x00, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x85, 0x00, 0x00, 0x00, 0x1c, 0x0b, 0x12, 0x25, 0x00, 0x4d, 0x00, 0x6f, 0x00, 0x64, 0x00,
  0x65, 0x00, 0x00, 0x00, 0x06, 0x16, 0x41, 0x00, 0x00, 0x00, 0x14, 0x1f, 0x1c, 0x0b, 0x50, 0x00,
  0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x06, 0x50, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x14, 0x1f, 0x1a, 0x15, 0x0a, 0x57, 0x00, 0x69, 0x00, 0x6e, 0x00,
  0x4d, 0x00, 0x65, 0x00, 0x73, 0x00, 0x73, 0x00, 0x61, 0x00, 0x67, 0x00, 0x65, 0x00, 0x00, 0x00,
  0x0b, 0x16, 0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x00, 0x00, 0x14, 0x15, 0x21, 0x00,
  0x00, 0x05, 0x0a, 0x56, 0x00, 0x69, 0x00, 0x73, 0x00, 0x69, 0x00, 0x62, 0x00, 0x6c, 0x00, 0x65,
  0x00, 0x00, 0x00, 0x06, 0x30, 0x15, 0x1a, 0x15, 0x07
]);

function codeNames(): NameTable {
  const names = new NameTable();
  names.add(1, 'CODE');
  return names;
}

test('a 169-byte program combining every confirmed construct decodes with no gaps', () => {
  const result = decodeProgram(SAVE_PRE_CHANGE_BYTES, codeNames());
  assert.equal(result.unknownOpcodes.length, 0);
});

test('number literals decode to their value', () => {
  const result = decodeProgram(SAVE_PRE_CHANGE_BYTES, codeNames());
  assert.ok(result.text.includes('(1 = 2)'));
});

test('a number literal above 255 uses more of the same 16-byte field, not a separate shape', () => {
  // Confirmed by hand-walking four real values past the single-byte range:
  // SetTracePC(3596), Char(65533), Rand() * 1000000000, and a MsgGetText
  // message number 311 -- each is the identical little-endian field 0x50
  // already used for 1/2/12/34, just with more of its 16 bytes non-zero.
  // The single-byte shape was never a separate case.
  const b = (n: bigint) => {
    const bytes = [0x50, 0x00, 0x00];
    for (let i = 0; i < 16; i++) { bytes.push(Number(n & 0xffn)); n >>= 8n; }
    return bytes;
  };
  assert.equal(
    decodeProgram(Buffer.from([...HEADER, ...b(3596n)]), new NameTable()).text, '3596');
  assert.equal(
    decodeProgram(Buffer.from([...HEADER, ...b(65533n)]), new NameTable()).text, '65533');
  assert.equal(
    decodeProgram(Buffer.from([...HEADER, ...b(1000000000n)]), new NameTable()).text, '1000000000');
});

test('a plain function-call identifier decodes the same way AddOnLoadScript did', () => {
  const result = decodeProgram(SAVE_PRE_CHANGE_BYTES, codeNames());
  assert.ok(result.text.includes('WinMessage("Test")'));
});

/**
 * OU_CODE_WRK.CODE and OU_CODE_WRK.CODE2_WRK's Workflow events (HCDEV), set
 * to reference *each other* specifically to isolate a cross-field reference
 * (every prior sample only ever referenced its own record.field). Source in
 * both, differing only in which field is self and which is referenced:
 *   If (%Mode = "A") Then
 *      If (12 = 34) Then
 *      End-If;
 *      OU_CODE_WRK.<the other field>.Visible = False;
 *   End-If;
 *
 * Both are the same 132 bytes -- the reference itself doesn't encode *which*
 * field, only a 0-based index into this program's own PSPCMNAME table -- but
 * their real PSPCMNAME tables differ (CODE's program lists itself first,
 * then CODE2_WRK; CODE2_WRK's program lists itself first, then CODE), which
 * is what makes the same index resolve to a different name in each: this is
 * what confirmed the final formula (NAMENUM = index + 1) over the earlier,
 * narrower "self-reference is index 0, and only 0" reading -- both programs
 * here use index 1, not 0, because each is referencing the *other* field,
 * not itself, and it resolves correctly in both directions.
 */
const CROSS_REF_BYTES = Buffer.from([
  0xa0, 0x00, 0x00, 0x00, 0x00, 0x5f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x85, 0x00, 0x00, 0x00, 0x1c, 0x0b, 0x12, 0x25, 0x00, 0x4d, 0x00, 0x6f, 0x00, 0x64, 0x00,
  0x65, 0x00, 0x00, 0x00, 0x06, 0x16, 0x41, 0x00, 0x00, 0x00, 0x14, 0x1f, 0x1c, 0x0b, 0x50, 0x00,
  0x00, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x06, 0x50, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x14, 0x1f, 0x1a, 0x15, 0x21, 0x01, 0x00, 0x05, 0x0a, 0x56, 0x00,
  0x69, 0x00, 0x73, 0x00, 0x69, 0x00, 0x62, 0x00, 0x6c, 0x00, 0x65, 0x00, 0x00, 0x00, 0x06, 0x30,
  0x15, 0x1a, 0x15, 0x07
]);

test('a cross-field reference resolves to the other field, using the real name table', () => {
  const fromCode = new NameTable();
  fromCode.add(1, 'CODE');
  fromCode.add(2, 'CODE2_WRK');
  const result = decodeProgram(CROSS_REF_BYTES, fromCode);
  assert.equal(result.unknownOpcodes.length, 0);
  assert.ok(result.text.includes('CODE2_WRK'));

  const fromCode2 = new NameTable();
  fromCode2.add(1, 'CODE2_WRK');
  fromCode2.add(2, 'CODE');
  const result2 = decodeProgram(CROSS_REF_BYTES, fromCode2);
  assert.equal(result2.unknownOpcodes.length, 0);
  assert.ok(result2.text.includes('CODE'));
});

test('the same cross-reference bytes decode with two-digit number literals too', () => {
  const names = new NameTable();
  names.add(1, 'CODE');
  names.add(2, 'CODE2_WRK');
  const result = decodeProgram(CROSS_REF_BYTES, names);
  assert.ok(result.text.includes('(12 = 34)'));
});

/**
 * The constructs below were confirmed by decoding all 204 PeopleCode
 * programs carried by two real project exports -- which include plain-text
 * source -- against their real PSPCMPROG bytes, and checking that every
 * decoded text token actually occurs in that source. See scripts/corpus-*.mjs.
 * Byte layouts here are written out explicitly so the framing itself is what
 * gets tested, independently of any one program.
 */
function utf16(text: string): number[] {
  return [...text].flatMap((c) => [c.charCodeAt(0), 0x00]);
}

const HEADER = [
  0xa0, 0x00, 0x00, 0x00, 0x00, 0x35, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x85, 0x00, 0x00, 0x00
];

test('a variable reference (0x01) decodes to its &-prefixed name', () => {
  // 31047 runs behind 0x01 across the corpus, 100% found in source, and
  // every single one &-prefixed.
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x01, ...utf16('&sHTML'), 0x00, 0x00]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '&sHTML');
});

test('a type name (0x40) decodes as a keyword', () => {
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x40, ...utf16('string'), 0x00, 0x00]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'string');
});

test('a signature annotation (0x6d) is rendered back inside its /+ +/', () => {
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x6d, ...utf16('Returns Boolean'), 0x00, 0x00]), new NameTable());
  assert.equal(result.text, '/+ Returns Boolean +/\n');
});

test('a comment (0x24) is length-prefixed in bytes, not null-terminated', () => {
  // The one construct in the format that is not null-terminated: 0x24, a
  // uint16 byte length, then that many bytes of UTF-16LE. Reading it as
  // null-terminated truncates at the first byte pair that is not text.
  const body = utf16('/* a comment */');
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x24, body.length & 0xff, body.length >> 8, ...body]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '/* a comment */\n');
});

test('a comment containing newlines survives, rather than stopping at the first one', () => {
  const body = utf16('/* line one\nline two */');
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x24, body.length & 0xff, body.length >> 8, ...body]), new NameTable());
  assert.equal(result.text, '/* line one\nline two */\n');
});

test('a length that runs past the buffer is refused rather than over-read', () => {
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x24, 0xff, 0xff, 0x41, 0x00]), new NameTable());
  const opcodes = new Set(result.unknownOpcodes.map((u) => u.opcode));
  assert.ok(opcodes.has(0x24));
});

test('a length prefix followed by zero bytes is not decoded as a comment of NULs', () => {
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x24, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]), new NameTable());
  assert.ok(!result.text.includes('\u0000'));
});

test('the header is still recognised when its variable count fields are non-zero', () => {
  // Positions 5, 6, 7, 13, 14, 21 and 29 vary per program; an earlier
  // revision demanded 6-32 all be zero and so rejected the header on 200 of
  // the 204 corpus programs, reporting 37 bytes of noise on each.
  const header = [...HEADER];
  header[5] = 0xec; header[6] = 0x03; header[7] = 0x01;
  header[13] = 0x2c; header[14] = 0x01; header[21] = 0x03; header[29] = 0x05;
  const result = decodeProgram(Buffer.from(header), new NameTable());
  assert.equal(result.tokens[0].kind, TokenKind.Header);
  assert.equal(result.unknownOpcodes.length, 0);
});

test('a comma (0x03) decodes with a following space, confirmed corpus-wide', () => {
  // Confirmed by a two-stage check against the 204-program corpus, after
  // several other candidates (0x17~|, 0x23~As, 0x20~Function, 0x26~Return)
  // looked perfect on a filtered sample and collapsed by 4-68x at full
  // scale -- see docs/ROADMAP.md. 0x03 held up both ways: isolated
  // single-opcode gaps decode to "," 98.4% of the time, and total 0x03
  // occurrences across every program track total "," in source almost
  // exactly (12798 vs 12519, within 2%), not just in a filtered subsample.
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x01, ...utf16('&a'), 0x00, 0x00, 0x03, 0x01, ...utf16('&b'), 0x00, 0x00]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '&a, &b');
});

test('0x0a is not rendered as a newline when it is really an identifier introducer', () => {
  // Reported: real output showed identifiers scattered across their own
  // lines with spurious blank lines between, e.g. "&access\nIsAuthorized
  // Viewer()" for real source "&access.IsAuthorizedViewer()". Root cause:
  // 0x0a is overloaded. It is a literal newline between statements, but far
  // more often (17835 of ~20400 corpus-wide occurrences) it is a silent
  // "bare identifier follows" introducer with no source newline at all --
  // the same role 0x12/0x16/0x01/0x40 play for other text, just reusing the
  // newline byte value. A prior revision rendered BOTH the '\n' and the
  // identifier; this checks only the identifier survives when the lookahead
  // finds one.
  const result = decodeProgram(ACTIVATE_BYTES, new NameTable());
  assert.equal(result.text.includes('\n\nAddOnLoadScript'), false);
  assert.equal(result.text.includes('AddOnLoadScript(GetHTMLText()'), true);
});

test('0x0a still renders as a real newline when no identifier follows', () => {
  // The other, genuine role: a literal newline between two already-known
  // tokens with no text-run shape between them.
  const result = decodeProgram(
    Buffer.from([0x15, 0x0a, 0x15]), new NameTable());
  assert.equal(result.text, ';\n\n;\n');
});

test('a dot (0x05) decodes member/method access', () => {
  // Confirmed by a two-stage check against the 204-program corpus: isolated
  // single-opcode gaps decode to "." 99.3% of the time, and at full scale it
  // explains most (not all -- some "." occurrences, e.g. in package paths,
  // use a different still-unconfirmed byte) of the "." in source, off by a
  // consistent undershoot rather than a random multiple -- unlike every
  // opcode candidate rejected in pass nine. Verified against real decoded
  // output: "&access.IsAuthorizedViewer()" and "%Response.SetContentType(
  // ...)" both decode correctly (WEBLIB_OU_LP.ISCRIPT1.FieldFormula).
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x01, ...utf16('&access'), 0x00, 0x00, 0x05,
      0x01, ...utf16('IsAuthorizedViewer'), 0x00, 0x00, 0x0b, 0x14]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '&access.IsAuthorizedViewer()');
});

test('a pipe (0x23) decodes string concatenation', () => {
  // Confirmed against the corpus after fixing a display bug in
  // corpus-gapextract.mjs that had silently mislabeled opcodes under the
  // wrong hex value (Number(hexString).toString(16) round-trips wrong for
  // any two-digit or letter-containing hex string) -- every rejection in
  // pass nine may have tested the wrong byte. Re-run with correct labels:
  // 98.1% on isolated gaps, 96% of programs within a tight full-scale ratio
  // band (1.078x). Verified against real output:
  // "<p align=\"\"center\"\">" | GetHTMLText(...) | "</p>" decodes correctly
  // (WEBLIB_SDK.SDK_ZAGAT_SEARCH.FieldFormula).
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x16, ...utf16('a'), 0x00, 0x00, 0x23, 0x16, ...utf16('b'), 0x00, 0x00]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '"a" | "b"');
});

test('Else (0x19) decodes correctly inside an If/Then/Else/End-If', () => {
  // Same fixed-label re-run: 95.6% on isolated gaps, 94% of programs within
  // a tight full-scale ratio band (1.080x). Verified against real output
  // (WEBLIB_MSGWSDL.PT_IBWSDL_EIPTYPE.FieldChange): "Else" lands exactly
  // where source has it.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER, 0x1c, 0x0b, 0x12, ...utf16('%Mode'), 0x00, 0x00, 0x06, 0x16,
      ...utf16('A'), 0x00, 0x00, 0x14, 0x1f, 0x19, 0x1a, 0x15
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'If (%Mode = "A") Then\nElse\nEnd-If;\n');
});

test('Function/As/Returns/Local/End-Function decode correctly, confirmed by walking real bytes', () => {
  // Confirmed by walking WEBLIB_OU_LP.ISCRIPT2.FieldFormula's exact real
  // bytes against its known source (not aggregate corpus statistics, which
  // is why these survived where 0x20/0x25/0x38/etc. did not -- see the
  // pass-fourteen note in ROADMAP.md). Real source there:
  //   Function JSONEscape(&s As string) Returns string
  //      ...
  //   End-Function;
  // This fixture reproduces the same shape with a Local declaration added.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x32, 0x0a, ...utf16('DoThing'), 0x00, 0x00,          // Function DoThing
      0x0b, 0x01, ...utf16('&s'), 0x00, 0x00,              // (&s
      0x35, 0x40, ...utf16('string'), 0x00, 0x00,           // As string
      0x14,                                                  // )
      0x39, 0x40, ...utf16('string'), 0x00, 0x00,           // Returns string
      0x44, 0x40, ...utf16('string'), 0x00, 0x00,           // Local string
      0x01, ...utf16('&x'), 0x00, 0x00,                     // &x
      0x15,                                                  // ;
      0x37,                                                  // End-Function
      0x15                                                   // ;
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  // 0x37 renders without its own semicolon: the byte stream always supplies
  // a real 0x15 after it, and spelling one here too produced a stray `;`.
  // End-Function also decreases indent back to 0 -- confirmed necessary by
  // walking WEBLIB_OU_LP.ISCRIPT2's ten functions, which without this drift
  // progressively deeper (2 spaces to 20) instead of each starting fresh at
  // column 0; see END_FUNCTION_STYLE in decoder.ts.
  assert.equal(result.text,
    'Function DoThing(&s As string) Returns string\n  Local string &x;\nEnd-Function;\n');
});

test('import and its package-path colons decode, confirmed byte-for-byte', () => {
  // WEBLIB_OU_LP.ISCRIPT2.FieldFormula offset 37 onward is exactly this
  // shape, decoding to `import OU_JET_PACK:Model:PageDesign;`, and offset
  // 102 starts the next import line identically -- six import lines give
  // six confirmations of 0x58 and twelve of 0x57.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x58, 0x0a, ...utf16('OU_JET_PACK'), 0x00, 0x00,
      0x57, 0x0a, ...utf16('Model'), 0x00, 0x00,
      0x57, 0x0a, ...utf16('PageDesign'), 0x00, 0x00,
      0x15
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'import OU_JET_PACK:Model:PageDesign;\n');
});

test('a name reference is opcode plus a 2-byte index, with no trailing 0x05', () => {
  // The trailing 0x05 an earlier revision required was never part of the
  // reference -- it is the separate `.` operator, which only looked
  // mandatory because all three original samples were RECORD.FIELD.Visible.
  // Requiring it meant a reference used as a function argument never
  // matched, so `GetHTMLText(HTML.OU_OJET_REQUIRE_CONFIG, &siteBase)`
  // decoded as `GetHTMLText(, &siteBase)`. Corpus-wide, 1636 of the 1640
  // references that resolve this way name something that really occurs in
  // that program's source.
  const names = new NameTable();
  names.add(8, 'OU_OJET_REQUIRE_CONFIG');
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x0a, ...utf16('GetHTMLText'), 0x00, 0x00,
      0x0b,                    // (
      0x21, 0x07, 0x00,        // reference, index 7 -> NAMENUM 8
      0x14                     // )
    ]),
    names);
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'GetHTMLText(OU_OJET_REQUIRE_CONFIG)');
});

test('decoding stops at the declaration-name trailer instead of rendering it as garbage', () => {
  // Confirmed against WEBLIB_OU_LP.ISCRIPT1/2.FieldFormula (plain
  // Function-based record PeopleCode) and all nine OU_JET_PACK Application
  // Class programs: 0x2d 0x07 occurs exactly once per program, right after
  // the real code's closing `;`, and never elsewhere -- 185 of the 204
  // corpus programs carry it (the other 19 are too short to declare
  // anything), zero have a second occurrence. What follows is the
  // program's own declared names verbatim with no introducer, then a
  // packed integer dispatch table; see TRAILER_MARKER in decoder.ts.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x38, 0x16, 0x00, 0x00,   // Return ""
      0x15,                      // ;
      0x2d, 0x07,                // trailer marker
      ...utf16('DoThing'), 0x00, 0x00,   // dispatch-table name, no introducer
      0x00, 0x00, 0x00, 0x00     // dispatch-table integers
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.trailerOffset, HEADER.length + 5);
  assert.equal(result.text, 'Return "";\n');
});

test('class/end-class/method/end-method decode only when the caller says this is a class', () => {
  // Confirmed by walking OU_JET_PACK.Layout.ComponentRegistry (12 methods)
  // and OU_JET_PACK.Security.AccessCheck (3 methods) byte-for-byte against
  // real source. Real source there:
  //   class Widget
  //      method Widget();
  //   end-class;
  //   method Widget
  //   end-method;
  // `method` is overloaded: the declaration inside the class body (no 0x41)
  // gets no indent change, same as Local; the implementation header (0x63
  // immediately followed by 0x41, confirmed 12/12 and 3/3) opens an
  // indented body like Function does.
  //
  // Unconditionally mapping these opcodes collided with ordinary bytes in
  // non-class programs corpus-wide (end-method matched real source only
  // 8.9% of the time; see docs/ROADMAP.md pass seventeen), so they require
  // isApplicationClass -- which OracleProvider sets from the definition's
  // real OBJECTTYPE (58), not decoded content.
  const bytes = Buffer.from([
    ...HEADER,
    0x5a, 0x0a, ...utf16('Widget'), 0x00, 0x00,          // class Widget
    0x63, 0x0a, ...utf16('Widget'), 0x00, 0x00,          // method Widget (declaration)
    0x0b, 0x14,                                            // (
    0x15,                                                  // ;
    0x5b, 0x15,                                             // end-class;
    0x63, 0x41, 0x0a, ...utf16('Widget'), 0x00, 0x00,     // method Widget (implementation)
    0x64, 0x15                                              // end-method;
  ]);

  const withoutFlag = decodeProgram(bytes, new NameTable());
  assert.ok(withoutFlag.unknownOpcodes.length > 0);

  const withFlag = decodeProgram(bytes, new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(withFlag.unknownOpcodes.length, 0);
  assert.equal(withFlag.text,
    'class Widget\n  method Widget();\nend-class;\nmethod Widget\nend-method;\n');
});

test('the same reference construct still renders a following dot operator', () => {
  // With the 0x05 no longer swallowed as part of the reference, a
  // RECORD.FIELD.Property chain renders its dot: this is RowInit's real
  // shape, which previously came out as "EOAW_AP_BUILDERVisible".
  const names = new NameTable();
  names.add(1, 'EOAW_AP_BUILDER');
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x21, 0x00, 0x00,        // reference, index 0 -> NAMENUM 1
      0x05,                    // .
      0x0a, ...utf16('Visible'), 0x00, 0x00
    ]),
    names);
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'EOAW_AP_BUILDER.Visible');
});

/**
 * Declaration-name directory tests (docs/ROADMAP.md pass eighteen). Bytes
 * below mirror the real shape hand-walked against the live database:
 * `TRAILER_MARKER`, then null-terminated UTF-16LE names back to back, then
 * one 16-byte `(charOffset, ?, paramCount, kind)` record per name.
 */
function int32le(n: number): number[] {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return [...b];
}

function declarationRecord(charOffset: number, paramCount: number, kind: number): number[] {
  return [...int32le(charOffset), ...int32le(0), ...int32le(paramCount), ...int32le(kind)];
}

test('a single zero-param, no-return declaration is read from the trailer', () => {
  // WEBLIB_CD_APP.ISCRIPT1's real trailer, byte-exact: `Function iScript_CD`
  // with no parameters and no Returns clause.
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07, ...utf16('iScript_CD'), 0x00, 0x00,
    ...declarationRecord(0, 0, 7)
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.deepEqual(result.declarations,
    [{ name: 'iScript_CD', paramCount: 0, hasReturnValue: false, returnType: undefined }]);
});

test('paramCount and a Returns string clause are read for each name in a multi-function directory', () => {
  // Mirrors WEBLIB_EOAW.EOAW_AP_BUILDER's shape (two names) but with a
  // second entry that takes parameters and returns a value, to exercise
  // charOffset advancing past the first name and kind != 7.
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('First'), 0x00, 0x00,
    ...utf16('Second'), 0x00, 0x00,
    ...declarationRecord(0, 0, 7),
    ...declarationRecord(6, 2, 1)
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.deepEqual(result.declarations, [
    { name: 'First', paramCount: 0, hasReturnValue: false, returnType: undefined },
    { name: 'Second', paramCount: 2, hasReturnValue: true, returnType: 'string' }
  ]);
});

test('the scalar return-type codes and the array-of flag decode to real type names', () => {
  // 1=string, 5=boolean, 13=object, 17=integer, 19=number, and
  // ARRAY_RETURN_TYPE_FLAG (0x100000) OR one of those means "array of" it --
  // all confirmed with zero collisions against 178 real declarations
  // corpus-wide (docs/ROADMAP.md pass eighteen).
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('IsActive'), 0x00, 0x00,
    ...utf16('GetNames'), 0x00, 0x00,
    ...declarationRecord(0, 0, 5),
    ...declarationRecord(9, 0, 0x100001)
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.deepEqual(result.declarations, [
    { name: 'IsActive', paramCount: 0, hasReturnValue: true, returnType: 'boolean' },
    { name: 'GetNames', paramCount: 0, hasReturnValue: true, returnType: 'array of string' }
  ]);
});

test('the built-in object return-type codes decode to their real type names', () => {
  // 0x80000 (OBJECT_RETURN_TYPE_FLAG) OR a sub-code identifies a built-in
  // database/collection object return type -- confirmed against Rowset
  // (0x80007), XmlDoc (0x8001d), XmlNode (0x80022) and, via a system-wide
  // read-only search of live PSPCMPROG for real Returns clauses this
  // project hadn't seen an example of, Record (0x80003) -- see
  // docs/ROADMAP.md pass nineteen.
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('GetRows'), 0x00, 0x00,
    ...utf16('GetRow'), 0x00, 0x00,
    ...declarationRecord(0, 0, 0x80007),
    ...declarationRecord(8, 0, 0x80003)
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.deepEqual(result.declarations, [
    { name: 'GetRows', paramCount: 0, hasReturnValue: true, returnType: 'Rowset' },
    { name: 'GetRow', paramCount: 0, hasReturnValue: true, returnType: 'Record' }
  ]);
});

test('a Returns clause whose kind is not a known scalar, array or object code has no returnType', () => {
  // App-Class (PKG:Sub:Class) return types use a different, still-
  // unconfirmed encoding -- hasReturnValue is still known, but returnType
  // stays undefined rather than guessed.
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07, ...utf16('GetWidget'), 0x00, 0x00,
    ...declarationRecord(0, 0, 0x400001)
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.deepEqual(result.declarations,
    [{ name: 'GetWidget', paramCount: 0, hasReturnValue: true, returnType: undefined }]);
});

test('a directory whose charOffset field does not match is not reported at all', () => {
  // The self-check that rejects WEBLIB_PTNUI.PT_BUTTON_PIN-shaped programs
  // wholesale rather than emitting a misaligned table -- see decoder.ts.
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07, ...utf16('iScript_CD'), 0x00, 0x00,
    ...declarationRecord(99, 0, 7) // wrong: real offset is 0
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.equal(result.declarations, undefined);
});

test('colon-qualified names between the plain names and the record table are skipped, not read as declarations', () => {
  // Real shape (confirmed against WEBLIB_PTNUI.PT_BUTTON_PIN): plain names,
  // THEN colon-qualified imported-class names (PKG:Sub:Class -- a separate,
  // undecoded directory), THEN the plain names' own record table -- not the
  // record table immediately after the plain names. An earlier revision
  // computed the record table's start right after the last PLAIN name,
  // which is exactly where the colon-qualified names sit instead, producing
  // records with garbage-looking fields that pass eighteen's notes
  // originally (and wrongly) attributed to "some other, unknown table
  // shape" for WEBLIB_PTNUI.PT_BUTTON_PIN and two other large programs.
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('IScript_Main'), 0x00, 0x00,
    ...utf16('PTNUI:Model:Tile'), 0x00, 0x00,
    ...utf16('PTNUI:Model:LandingPageTab'), 0x00, 0x00,
    // No separate empty-string terminator here: the record table's own
    // first field (charOffset, always 0 for the first listed name) IS the
    // two zero bytes that mark the end of the name run -- see decoder.ts.
    ...declarationRecord(0, 0, 7)
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.deepEqual(result.declarations,
    [{ name: 'IScript_Main', paramCount: 0, hasReturnValue: false, returnType: undefined }]);
});

test('a program with only colon-qualified names and no record table has no declarations', () => {
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('PTNUI:Model:Tile'), 0x00, 0x00,
    0x00, 0x00
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.equal(result.declarations, undefined);
});

test('a program with no trailer marker has no declarations, not an empty list', () => {
  const result = decodeProgram(Buffer.from([...HEADER, 0x01, ...utf16('&x'), 0x00, 0x00]), new NameTable());
  assert.equal(result.declarations, undefined);
});

/**
 * Pass twenty (docs/ROADMAP.md): five more opcodes, all found hand-walking
 * `WEBLIB_OU_LP.ISCRIPT1` and `OU_JET_PACK.Layout.ComponentRegistry` live --
 * the user reported both files looking visibly wrong (indentation drifting
 * further right every line, orphan `;` with nothing before them, an
 * Application Class method's `Evaluate`/`When`/`End-Evaluate` losing its
 * bookend keywords). All five confirmed 100% against the corpus once
 * heavily-corrupted programs (unrelated failures elsewhere that misattribute
 * garbage bytes to whatever opcode happens to follow) are excluded from the
 * count.
 */
test('0x4e is a second length-prefixed comment introducer, same shape as 0x24', () => {
  // Real trailer bytes from WEBLIB_OU_LP.ISCRIPT1 (live, not the stale
  // export): reading 0x4e as unknown fell through to interpreting the
  // comment's own text as opcodes one byte at a time, producing a cascade
  // of dozens of unmapped-opcode entries and garbled text -- not just a
  // missing comment.
  const body = utf16('/* fallback if the class-line parse below doesn\'t fire */');
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x15, 0x4e, body.length & 0xff, body.length >> 8, ...body]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, ';\n/* fallback if the class-line parse below doesn\'t fire */\n');
});

test('0x2c is End-For, decreasing indent the way End-If does', () => {
  // Confirmed by hand-walking WEBLIB_OU_LP.ISCRIPT1: an inner End-If was
  // followed by an orphan `;` on its own line -- 0x2c reported as unknown
  // (contributing no text) immediately before the real 0x15 (`;`) that
  // closes the enclosing For loop.
  const result = decodeProgram(Buffer.from([...HEADER, 0x2c]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'End-For');
});

test('0x2f is True, alongside the already-confirmed 0x30 False', () => {
  const result = decodeProgram(Buffer.from([...HEADER, 0x2f]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'True');
});

test('Evaluate/When-Other/End-Evaluate (0x3c/0x3e/0x3f) decode as keywords', () => {
  // Confirmed against OU_JET_PACK.Layout.ComponentRegistry's real
  // GetRequireModule method, which lost its Evaluate/End-Evaluate bookends
  // entirely before this (the individual When cases still rendered, since
  // 0x3d was already confirmed, but the block they belonged to did not).
  const result = decodeProgram(Buffer.from([...HEADER, 0x3c, 0x3e, 0x3f]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Evaluate\nWhen-Other\nEnd-Evaluate');
});

test('While/End-While (0x25/0x26) and Break (0x2e) decode as keywords', () => {
  const result = decodeProgram(Buffer.from([...HEADER, 0x25, 0x2e, 0x26]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'While Break\nEnd-While');
});

test('0x45 is Global, not Local (0x44) -- corrected from an early false lead in this same pass', () => {
  // A first attempt at 0x45 checked only whether the program's source
  // contained the word "LOCAL" anywhere, which is true of nearly every
  // PeopleCode program and so was never real evidence. Cross-checking
  // against https://github.com/cache117/decode-pcode's independently
  // written opcode table (0x44 Local, 0x45 Global) and then confirming
  // against the corpus (22/22, 100%) corrected it.
  const result = decodeProgram(Buffer.from([...HEADER, 0x45]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Global');
});

test('consecutive NEWLINE_AFTER then NEWLINE_BEFORE tokens produce one newline, not a blank line', () => {
  // The user reported OU_JET_PACK.Layout.ComponentRegistry's class header
  // rendering with a blank line after every single method declaration --
  // `;` (NEWLINE_AFTER) immediately followed by the next `method`
  // (NEWLINE_BEFORE) each independently emitted a newline, and a stale
  // `writeIndent` (setting atLineStart false right after writing the
  // indent) meant the second one had no way to notice the first already
  // started a fresh line. This is corpus-wide: it hit every `;` immediately
  // followed by another NEWLINE_BEFORE-flagged token (Local, method,
  // Function, End-If, ...), not just class headers -- invisible to
  // corpus-validate.mjs's text-only, whitespace-blind comparison the whole
  // time this project has measured against it.
  const bytes = Buffer.from([
    ...HEADER,
    0x63, 0x0a, ...utf16('Widget'), 0x00, 0x00, 0x0b, 0x14, 0x15, // method Widget();
    0x63, 0x0a, ...utf16('Other'), 0x00, 0x00, 0x0b, 0x14, 0x15   // method Other();
  ]);
  const result = decodeProgram(bytes, new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'method Widget();\nmethod Other();\n');
});

test('0x42 is a zero-width clause-end marker, confirmed in three different grammatical positions', () => {
  // Hand-walked corpus-wide (491 occurrences): always a single byte with no
  // operand, and always sits where the source has no character at all --
  // before `;` ending a Declare Function ... PeopleCode statement, before `)`
  // closing a parenthesised boolean sub-expression, and before `Then` ending
  // an If condition. Unlike 0x41 below, this needs no lookahead gate: every
  // context checked agreed, so it is mapped unconditionally in OPCODES.
  const declareFunction = decodeProgram(
    Buffer.from([...HEADER, 0x32, 0x0a, ...utf16('F'), 0x00, 0x00, 0x42, 0x15]), new NameTable());
  assert.equal(declareFunction.unknownOpcodes.length, 0);
  assert.equal(declareFunction.text, 'Function F;\n');

  const beforeThen = decodeProgram(Buffer.from([...HEADER, 0x2f, 0x42, 0x1f]), new NameTable());
  assert.equal(beforeThen.unknownOpcodes.length, 0);
  assert.equal(beforeThen.text, 'True Then\n');
});

test('0x41 is a zero-width marker only immediately before And/Or, not elsewhere', () => {
  // Hand-walked WEBLIB_GS_SSO.ISCRIPT1 and four other programs byte for byte:
  // a compound boolean condition wrapped across a line
  // (`If %DbType = "SYBASE" Or\n %DbType = "INFORMIX" Then`) has this byte
  // right before both "Or" and, in other samples, "And" -- confirmed 22/22
  // (100%) on every program with a small unmapped-opcode count. This same
  // byte value is ALSO used for an unrelated Application Class
  // method-header marker (see the 0x63 handling above), so it is gated on
  // the very next byte being And (0x18) or Or (0x1e) rather than mapped
  // unconditionally -- anywhere else, it must still surface as unknown.
  // Or (0x1e) itself carries a trailing newline (AND_OR_STYLE), the same as
  // in the real wrapped-condition source this was confirmed against.
  const beforeOr = decodeProgram(Buffer.from([...HEADER, 0x2f, 0x41, 0x1e, 0x30]), new NameTable());
  assert.equal(beforeOr.unknownOpcodes.length, 0);
  assert.equal(beforeOr.text, 'True Or\nFalse');

  const beforeAnd = decodeProgram(Buffer.from([...HEADER, 0x2f, 0x41, 0x18, 0x30]), new NameTable());
  assert.equal(beforeAnd.unknownOpcodes.length, 0);
  assert.equal(beforeAnd.text, 'True And\nFalse');

  const elsewhere = decodeProgram(Buffer.from([...HEADER, 0x2f, 0x41, 0x30]), new NameTable());
  assert.equal(elsewhere.unknownOpcodes.length, 1);
  assert.equal(elsewhere.unknownOpcodes[0].opcode, 0x41);
});

test('Declare Function ... PeopleCode ... decodes, confirmed byte-for-byte against WEBLIB_GS_CMD.ISCRIPT1', () => {
  // WEBLIB_GS_CMD.ISCRIPT1's only statement is exactly this construct, and it
  // now decodes with zero unmapped opcodes, byte for byte identical to real
  // source: "Declare Function UpdateGHServer PeopleCode
  // GS_CMD_WRK.GS_CMD_CFGSTR FieldFormula;". 0x31 (Declare, merged with the
  // Function token that follows it) and 0x3a (PeopleCode) were both
  // confirmed structurally (next token is exactly Function/a reference, not
  // a text match) at 35/35 (100%) on every program with a small
  // unmapped-opcode count, and of 944 Function tokens corpus-wide only the
  // 212 that really are a Declare statement are preceded by 0x31 -- an
  // ordinary `Function ... End-Function` body is untouched.
  const names = new NameTable();
  names.add(1, 'GS_CMD_WRK.GS_CMD_CFGSTR');
  const bytes = Buffer.from([
    ...HEADER,
    0x31, 0x32, 0x0a, ...utf16('UpdateGHServer'), 0x00, 0x00,
    0x3a, 0x21, 0x00, 0x00, 0x40, ...utf16('FieldFormula'), 0x00, 0x00,
    0x42, 0x15
  ]);
  const result = decodeProgram(bytes, names);
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Declare Function UpdateGHServer PeopleCode GS_CMD_WRK.GS_CMD_CFGSTR FieldFormula;\n');
});

test('Declare Function is not inserted before an ordinary Function definition', () => {
  const result = decodeProgram(Buffer.from([...HEADER, 0x32, 0x0a, ...utf16('F'), 0x00, 0x00]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text.startsWith('Function F'), true);
  assert.equal(result.text.includes('Declare'), false);
});

test('try/catch/end-try decode, confirmed byte-for-byte against WEBLIB_MSGWSDL.WSDLSUMMARY', () => {
  // Real source: a whole function body wrapped in
  // "try\n ...\ncatch Exception &e\n ...\nend-try;", with no class or method
  // anywhere -- unlike class/method below, this needs no isApplicationClass
  // gating. Confirmed 100% (88/88) on every program with a small
  // unmapped-opcode count; the raw corpus-wide rate looks much worse (91.9%
  // for try, ~30% for catch/end-try) purely from a handful of
  // already-heavily-corrupted programs (the same false signal every
  // unfiltered check in this file's history has produced), not from any
  // real counter-example. These are also part of the Application Class
  // vocabulary pass sixteen rejected when wholesale-adopting
  // PeopleCodeParser.java's table -- that was the reference project's own,
  // different byte values for try/catch/end-try, evidently wrong on this
  // database; 0x65/0x66/0x67 were found independently by hand-walking.
  const bytes = Buffer.from([
    ...HEADER,
    0x65,                                                     // try
    0x1, ...utf16('&x'), 0x00, 0x00, 0x15,                    // &x;
    0x66, 0xa, ...utf16('Exception'), 0x00, 0x00,              // catch Exception
    0x1, ...utf16('&e'), 0x00, 0x00, 0x4f,                     // &e
    0x1, ...utf16('&y'), 0x00, 0x00, 0x15,                     // &y;
    0x67, 0x15                                                 // end-try;
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text,
    'try\n  &x;\ncatch Exception &e\n  &y;\nend-try;\n');
});

test('Component is the third scope declarator, alongside Local/Global', () => {
  // Confirmed against four programs whose real source is a single top-level
  // `Component <type> &var;` declaration (e.g. WEBLIB_EOPP_LN.ISCRIPT1:
  // "Component string &CurrentTP_CREFName;"), each the program's only
  // unmapped opcode. Structurally confirmed on the corpus (10/10 programs
  // with a small unmapped-opcode count).
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x54, 0x40, ...utf16('string'), 0x00, 0x00, 0x1, ...utf16('&x'), 0x00, 0x00, 0x15]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Component string &x;\n');
});

test('Null (0x4b) decodes as a literal, confirmed byte-for-byte in an If condition', () => {
  // WEBLIB_HMCRWSDL.HMCR_WSDL_DISCOVER.FieldFormula's real source has
  // "If &PortalFolder <> Null Then" -- 0x4b sits exactly between "<>" and
  // "Then", its only unmapped opcode. Structurally confirmed on the corpus
  // (23/23): always right after a comparison operator, "=", "(" or ",",
  // the same shape as any other literal value.
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x1c, 0x1, ...utf16('&x'), 0x00, 0x00, 0x10, 0x4b, 0x1f]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'If &x <> Null Then\n');
});

test('Error decodes as a statement keyword, confirmed byte-for-byte in two different shapes', () => {
  // WEBLIB_GS_DUO.ISCRIPT1: 'Error ("No default DUO setup selected...");'.
  // WEBLIB_OU_TN.HTML_FUNCS: 'Then\n Error MsgGet(30002, ...)' -- confirming
  // it takes a following bare statement (not necessarily its own
  // parenthesised call) and that the newline before it is real even
  // directly after Then, not something render() needs to suppress.
  // Structurally confirmed 4/4 on the corpus.
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x1f, 0x1b, 0xb, 0x16, ...utf16('x'), 0x00, 0x00, 0x14, 0x15]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Then\n  Error ("x");\n');
});

test('Step decodes in a For loop, confirmed byte-for-byte against WEBLIB_HRCD.ISCRIPT2', () => {
  // Real source: "For &i = &arrProfileHierarchy.Len To 1 Step - 1", 0x2b
  // its only unmapped opcode. Structurally confirmed 3/3 on the corpus
  // (always right after a number literal, right before "-").
  const result = decodeProgram(Buffer.from([...HEADER, 0x2a, 0x50, 0, 0, 1, ...Array(15).fill(0), 0x2b, 0xe]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'To 1 Step -');
});

test('0x4a is a name reference like 0x21, but renders bare -- no qualifier prefix', () => {
  // `&recVar.FIELDNAME.Value` writes FIELDNAME bare, unlike a direct
  // RECORD.FIELD reference (0x21), which keeps its qualifier. Confirmed by
  // cross-checking every computed NAMENUM against
  // WEBLIB_GPDE.GPDE_AL_ISCRIPT.FieldFormula's own name table directly (not
  // just rendered text): 6/6 exact matches. Corpus-wide: 633/659 (96.0%),
  // every miss an out-of-range index in an already heavily-corrupted
  // program, the same safe fallback 0x21 already has.
  const names = new NameTable();
  names.add(5, 'FIELD.GPDE_ELSTER_TKT');
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x1, ...utf16('&recELSTERfile'), 0x00, 0x00,
      0x5,                     // .
      0x4a, 0x04, 0x00,        // reference, index 4 -> NAMENUM 5, rendered bare
      0x5,                     // .
      0xa, ...utf16('Value'), 0x00, 0x00
    ]),
    names);
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '&recELSTERfile.GPDE_ELSTER_TKT.Value');
});

test('0x4a falls through to unknown when the index does not resolve, like 0x21', () => {
  const result = decodeProgram(Buffer.from([...HEADER, 0x4a, 0x00, 0x00]), new NameTable());
  assert.equal(result.unknownOpcodes.some((u) => u.opcode === 0x4a), true);
});

test('Constant, throw and ComponentLife decode, each confirmed byte-for-byte as the only unmapped opcode in a real program', () => {
  // Constant: WEBLIB_PTTILE.ISCRIPT1's real
  // `Constant &QUERYPARAMETER_ID = "ID";`. throw: WEBLIB_PTSF.ISCRIPT1's
  // real `throw CreateException(262, 2018, "Search Exception: %1 ",
  // &sError);`. ComponentLife: WEBLIB_PTPN.PTPN_ISCRIPT.SavePreChange's
  // real `ComponentLife PTPN_PUBLISH:PublishToWindow &wlSrch;`.
  const constant = decodeProgram(
    Buffer.from([...HEADER, 0x56, 0x1, ...utf16('&x'), 0x00, 0x00, 0x6, 0x16, ...utf16('ID'), 0x00, 0x00, 0x15]),
    new NameTable());
  assert.equal(constant.unknownOpcodes.length, 0);
  assert.equal(constant.text, 'Constant &x = "ID";\n');

  const thrown = decodeProgram(
    Buffer.from([...HEADER, 0x68, 0xa, ...utf16('CreateException'), 0x00, 0x00, 0xb, 0x14, 0x15]),
    new NameTable());
  assert.equal(thrown.unknownOpcodes.length, 0);
  assert.equal(thrown.text, 'throw CreateException();\n');

  const componentLife = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x79, 0xa, ...utf16('PTPN_PUBLISH'), 0x00, 0x00, 0x57, 0xa, ...utf16('PublishToWindow'), 0x00, 0x00,
      0x1, ...utf16('&wlSrch'), 0x00, 0x00, 0x15
    ]),
    new NameTable());
  assert.equal(componentLife.unknownOpcodes.length, 0);
  assert.equal(componentLife.text, 'ComponentLife PTPN_PUBLISH:PublishToWindow &wlSrch;\n');
});

test('property/instance/extends decode, picking pass thirteen back up: the Application Class trailer', () => {
  // Confirmed byte-for-byte against real known source in three OU_JET_PACK
  // corpus programs: OU_JET_PACK.Model.PageCol ("property number ColSeq;",
  // 5 properties all the same opcode), OU_JET_PACK.Storage.
  // DesignRepository and OU_LANDINGPAGE.LandingPage.OUBanner ("instance
  // OU_JET_PACK:Widgets:BaseWidget &objBase;"), and OUBanner's own "class
  // OUBanner extends OU_JET_PACK:Widgets:BaseWidget". Checked corpus-wide
  // across all 15 Application Class programs: 31/31 (100%), and it took
  // TI_INTEGRATION.DVMEError -- the very sample pass nineteen left this
  // pass to pick up from -- from 4 unmapped opcodes to 0.
  //
  // Gated the same way as class/method: 0x5e and 0x5c never occur outside
  // an Application Class program, but 0x61 and 0x62 individually do (353
  // and 53 corpus-wide occurrences in plain Function programs) -- only the
  // pair, 0x61 immediately followed by 0x62, is `instance`.
  const bytes = Buffer.from([
    ...HEADER,
    0x5a, 0x0a, ...utf16('OUBanner'), 0x00, 0x00,                         // class OUBanner
    0x5c, 0x0a, ...utf16('OU_JET_PACK'), 0x00, 0x00,                      // extends OU_JET_PACK
    0x57, 0x0a, ...utf16('Widgets'), 0x00, 0x00,                          // :Widgets
    0x57, 0x0a, ...utf16('BaseWidget'), 0x00, 0x00,                       // :BaseWidget
    0x5e, 0x40, ...utf16('number'), 0x00, 0x00, 0x0a, ...utf16('ColSeq'), 0x00, 0x00, 0x15, // property number ColSeq;
    0x61, 0x62, 0x0a, ...utf16('OU_JET_PACK'), 0x00, 0x00,                // instance OU_JET_PACK
    0x57, 0x0a, ...utf16('Widgets'), 0x00, 0x00,                          // :Widgets
    0x57, 0x0a, ...utf16('BaseWidget'), 0x00, 0x00,                       // :BaseWidget
    0x1, ...utf16('&objBase'), 0x00, 0x00, 0x15,                          // &objBase;
    0x5b, 0x15                                                             // end-class;
  ]);

  const withoutFlag = decodeProgram(bytes, new NameTable());
  assert.ok(withoutFlag.unknownOpcodes.length > 0);

  const result = decodeProgram(bytes, new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text,
    'class OUBanner extends OU_JET_PACK:Widgets:BaseWidget\n' +
    '  property number ColSeq;\n' +
    '  instance OU_JET_PACK:Widgets:BaseWidget &objBase;\n' +
    'end-class;\n');
});
