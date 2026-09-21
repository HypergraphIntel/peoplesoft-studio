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

test('the header still matches when bytes 7/22/30 are non-zero, not always 0', () => {
  // A database-wide sample (60k programs) found each of these three
  // positions zero in the overwhelming majority (>99.4%) but not always.
  // Requiring any of them be zero rejected the header outright for that
  // real program, which cascades the *entire* program into unrelated-
  // looking unmapped noise -- confirmed on G3UTILITIES.UtilityMethods.
  // OnExecute (byte 22): fixing this alone took a 128KB program from
  // 28+ unmapped opcodes to 0. See docs/ROADMAP.md pass forty-two.
  const withNonZero = [...HEADER];
  withNonZero[7] = 1;
  withNonZero[22] = 1;
  withNonZero[30] = 1;
  const result = decodeProgram(Buffer.from([...withNonZero, 0x15]), new NameTable());
  assert.equal(result.tokens[0].kind, TokenKind.Header);
  assert.equal(result.unknownOpcodes.length, 0);
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

test('a decimal number literal is the same field with a scale byte, not a separate shape', () => {
  // Confirmed by hand-walking three real decimal values this shape had
  // been silently refusing: WEBLIB_OU_LP_BK.ISCRIPT1's real
  // "&pcts.Push(33.34); &pcts.Push(33.33); &pcts.Push(33.33);" (scale 2,
  // magnitudes 3334/3333/3333) and, in a completely unrelated program,
  // "If &ptVersionNum < 8.52 Then" (scale 2, magnitude 852). The second
  // operand byte -- required to be zero in every previously-confirmed
  // integer sample -- is a decimal scale: value / 10^scale. Every
  // already-confirmed plain integer is scale 0, unchanged by this.
  const scaled = (scale: number, n: bigint) => {
    const bytes = [0x50, 0x00, scale];
    for (let i = 0; i < 16; i++) { bytes.push(Number(n & 0xffn)); n >>= 8n; }
    return bytes;
  };
  assert.equal(
    decodeProgram(Buffer.from([...HEADER, ...scaled(2, 3334n)]), new NameTable()).text, '33.34');
  assert.equal(
    decodeProgram(Buffer.from([...HEADER, ...scaled(2, 3333n)]), new NameTable()).text, '33.33');
  assert.equal(
    decodeProgram(Buffer.from([...HEADER, ...scaled(2, 852n)]), new NameTable()).text, '8.52');
  // A scale wide enough that the magnitude has fewer digits than the scale
  // itself needs a leading "0." -- confirmed by the general formula, not a
  // real sample yet.
  assert.equal(
    decodeProgram(Buffer.from([...HEADER, ...scaled(2, 5n)]), new NameTable()).text, '0.05');
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

test('a comment with a real non-ASCII character survives whole, not truncated to unmapped', () => {
  // Confirmed against WEBLIB_OU_LP_BK.ISCRIPT2's real "/* the Knockout
  // viewModel + templates -- see below */" (an em-dash before "see"), and
  // WEBLIB_QUERY.ISCRIPT1/WEBLIB_CTI.ISCRIPT2/WEBLIB_GS_UTIL.ISCRIPT1's own
  // comments. An earlier revision rejected the WHOLE comment if even one
  // UTF-16 code unit fell outside printable ASCII, even though the byte
  // length prefix already bounds exactly where the comment ends -- no
  // per-character validity check is needed the way the null-terminated
  // readers need one to find their own terminator safely. Rejecting it
  // fell through to walking the comment's own bytes as if they were
  // opcodes, the root cause of a whole cluster of unrelated-looking
  // unmapped opcodes (0x70/0x6f/0x73/0x74/0x72/0x6c, pass thirty-two) that
  // were really just ASCII letters colliding with real single-byte ones.
  // Corpus-wide this one fix moved coverage 98.79% -> 99.74%, by far the
  // largest single jump this project has shipped.
  const full = (text: string) => [...text].flatMap((c) => {
    const code = c.charCodeAt(0);
    return [code & 0xff, code >> 8];
  });
  const body = full('/* templates — see below */'); // — = em dash
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x24, body.length & 0xff, body.length >> 8, ...body]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '/* templates — see below */\n');
});

test('a comment of nothing but zero bytes is still refused -- the one real rejection left', () => {
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x24, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]), new NameTable());
  assert.equal(result.unknownOpcodes.some((u) => u.opcode === 0x24), true);
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
    [{ name: 'iScript_CD', paramCount: 0, hasReturnValue: false, returnType: undefined, parameterTypes: undefined }]);
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
    { name: 'First', paramCount: 0, hasReturnValue: false, returnType: undefined, parameterTypes: undefined },
    { name: 'Second', paramCount: 2, hasReturnValue: true, returnType: 'string', parameterTypes: undefined }
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
    { name: 'IsActive', paramCount: 0, hasReturnValue: true, returnType: 'boolean', parameterTypes: undefined },
    { name: 'GetNames', paramCount: 0, hasReturnValue: true, returnType: 'array of string', parameterTypes: undefined }
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
    { name: 'GetRows', paramCount: 0, hasReturnValue: true, returnType: 'Rowset', parameterTypes: undefined },
    { name: 'GetRow', paramCount: 0, hasReturnValue: true, returnType: 'Record', parameterTypes: undefined }
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
    [{ name: 'GetWidget', paramCount: 0, hasReturnValue: true, returnType: undefined, parameterTypes: undefined }]);
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
    [{ name: 'IScript_Main', paramCount: 0, hasReturnValue: false, returnType: undefined, parameterTypes: undefined }]);
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

test('0x55 is a third length-prefixed comment introducer, for <* *> style comments', () => {
  // Confirmed against WEBLIB_IB.ISCRIPT1's real "<* This laucnhes the
  // Integration HUB MAP Rapid Application *>": exact byte match, declared
  // length 122, real text 61 characters, delimiters and all -- the stored
  // text carries its own "<*"/"*>" the same way 0x24/0x4e's own comments
  // carry their own real delimiters. This is a genuinely different comment
  // style (angle-bracket-star, not slash-star), used elsewhere in the
  // corpus specifically to wrap blocks of disabled code that already
  // contain ordinary slash-star comments of their own. Reading 0x55 as
  // unknown fell through to walking the comment's own text as opcodes,
  // one of two causes (alongside pass thirty-two's trailer-marker fix)
  // behind a whole cluster of unrelated-looking unmapped opcodes across
  // nearly a dozen corpus programs -- fixing this one took coverage
  // 99.77% -> 99.99% and clean programs 191 -> 200 of 204.
  const body = utf16('<* disabled block *>');
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x15, 0x55, body.length & 0xff, body.length >> 8, ...body]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, ';\n<* disabled block *>\n');
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
  // and 53 corpus-wide occurrences in plain Function programs).
  //
  // Note (pass forty-two): 0x61 immediately followed by 0x62 was
  // originally fused into a single `instance` token here, on the
  // reasoning that only the pair occurs in this position. That silently
  // dropped a real `private` this exact sample's own source has right
  // before `instance` (`private\n   instance OU_JET_PACK:Widgets:
  // BaseWidget &objBase;`) -- the corpus checker never caught it because
  // it only verifies decoded text appears in source, never the reverse.
  // 0x61 and 0x62 are independent keywords (`private` and `instance`
  // respectively); this test's bytes were updated to include the real
  // `private` this sample always had.
  const bytes = Buffer.from([
    ...HEADER,
    0x5a, 0x0a, ...utf16('OUBanner'), 0x00, 0x00,                         // class OUBanner
    0x5c, 0x0a, ...utf16('OU_JET_PACK'), 0x00, 0x00,                      // extends OU_JET_PACK
    0x57, 0x0a, ...utf16('Widgets'), 0x00, 0x00,                          // :Widgets
    0x57, 0x0a, ...utf16('BaseWidget'), 0x00, 0x00,                       // :BaseWidget
    0x5e, 0x40, ...utf16('number'), 0x00, 0x00, 0x0a, ...utf16('ColSeq'), 0x00, 0x00, 0x15, // property number ColSeq;
    0x61,                                                                  // private
    0x62, 0x0a, ...utf16('OU_JET_PACK'), 0x00, 0x00,                      // instance OU_JET_PACK
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
    '  private\n' +
    '  instance OU_JET_PACK:Widgets:BaseWidget &objBase;\n' +
    'end-class;\n');
});

test('an Application Class trailer lists only its real methods -- self-reference and properties excluded', () => {
  // Confirmed against TI_INTEGRATION.DVMEError's real trailer, fetched live
  // and hand-walked: record 0 is always the class's own self-reference
  // (third field 0x400000, not a declaration at all), and any property
  // record's third field is likewise not a parameter count -- both would
  // otherwise surface as nonsensical multi-thousand-parameter "methods".
  // Cross-checked corpus-wide against every Application Class program's own
  // real source: 54/54 (100%) on both paramCount and hasReturnValue, and it
  // took DVMEError itself from `declarations: undefined` to all 11 of its
  // real methods, exactly.
  const names = new NameTable();
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('PKG:MyClass'), 0x00, 0x00,
    ...utf16('MyProp'), 0x00, 0x00,
    ...utf16('MyMethod'), 0x00, 0x00,
    ...declarationRecord(0, 0x400000, 0),   // self-reference (third field, not kind)
    ...declarationRecord(12, 0xa0001, 0),   // property (third field is not a paramCount)
    ...declarationRecord(19, 2, 1)          // a real method: 2 params, Returns string
  ]);
  const result = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(result.declarations,
    [{ name: 'MyMethod', paramCount: 2, hasReturnValue: true, returnType: 'string', parameterTypes: undefined }]);
});

test('an Application Class trailer whose first record is not the expected self-reference shape is refused', () => {
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('PKG:MyClass'), 0x00, 0x00,
    ...declarationRecord(0, 0, 7) // not 0x400000 -- not the shape this function understands
  ]);
  const result = decodeProgram(bytes, new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.declarations, undefined);
});

test('an Application-Class-typed return value resolves to a specific occurrence of the type name in the trailer', () => {
  // Confirmed byte-for-byte against OU_JET_PACK.Storage.DesignRepository's
  // real `Load(...) Returns OU_JET_PACK:Model:PageDesign` (kind 0x8017f,
  // the type's own *second* name-run occurrence) and
  // `ListHeaders() Returns array of OU_JET_PACK:Model:PageDesign` (kind
  // 0x18019c, composing with the array flag exactly like a scalar array
  // does) -- an Application-Class return type is not a fixed code at all,
  // it's OBJECT_RETURN_TYPE_FLAG's sub-code read as `0x100 + charOffset`,
  // a back-reference to the specific name-run occurrence to use. Checked
  // corpus-wide across every Application Class program: 38/38 (100%) on
  // the exact returnType text. Two distinct type names here (PKG:Foo,
  // PKG:Bar) so a wrong charOffset resolves to the wrong name outright,
  // not just a coincidentally-matching one.
  const names = new NameTable();
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('PKG:MyClass'), 0x00, 0x00,  // self-reference, charOffset 0
    ...utf16('MyProp'), 0x00, 0x00,       // charOffset 12
    ...utf16('Load'), 0x00, 0x00,         // charOffset 19
    ...utf16('PKG:Foo'), 0x00, 0x00,      // MyProp's own type, charOffset 24 (no record)
    ...utf16('PKG:Bar'), 0x00, 0x00,      // Load/GetAll's return type, charOffset 32 (no record)
    ...utf16('GetAll'), 0x00, 0x00,       // charOffset 40
    ...declarationRecord(0, 0x400000, 0),               // self-reference
    ...declarationRecord(12, 0xb0000, 0),                // property (skipped)
    ...declarationRecord(19, 0, 0x80000 | (0x100 + 32)), // Load: Returns PKG:Bar
    ...declarationRecord(40, 0, 0x180000 | (0x100 + 32)) // GetAll: Returns array of PKG:Bar
  ]);
  const result = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(result.declarations, [
    { name: 'Load', paramCount: 0, hasReturnValue: true, returnType: 'PKG:Bar', parameterTypes: undefined },
    { name: 'GetAll', paramCount: 0, hasReturnValue: true, returnType: 'array of PKG:Bar', parameterTypes: undefined }
  ]);
});

test('each parameter has its own decoded type, read from the dispatch-slot table pass nineteen left unlocated', () => {
  // Confirmed byte-for-byte against WEBLIB_GS_ERPFW.ISCRIPT1's real
  // addNonNPSAction(&rsActions As Rowset, &ruleNode As XmlNode, &ruleId As
  // string, &nCurrent As integer) -- all four mixed types matched exactly,
  // in order. A Function's parameter slots carry two extra set bits
  // (0xc0000000) a method's never do; masked off before decoding, since it
  // isn't otherwise understood but never collides with a real type code.
  // Checked corpus-wide: 401/402 parameters correct (the one exception a
  // ground-truth artifact -- a duplicate-named Function overload in one
  // program's source, not a decoder error). The terminator slot after the
  // last parameter is always exactly 7, the same "nothing here" sentinel
  // used elsewhere; requiring it is what lets this refuse rather than
  // guess when the table isn't the expected shape.
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('addNonNPSAction'), 0x00, 0x00,
    ...declarationRecord(0, 4, 7),
    ...int32le(0xc0080007 | 0), // Rowset
    ...int32le(0xc0080022 | 0), // XmlNode
    ...int32le(0xc0000001 | 0), // string
    ...int32le(0xc0000011 | 0), // integer
    ...int32le(7)               // terminator
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.deepEqual(result.declarations, [{
    name: 'addNonNPSAction', paramCount: 4, hasReturnValue: false, returnType: undefined,
    parameterTypes: ['Rowset', 'XmlNode', 'string', 'integer']
  }]);
});

test('parameterTypes is undefined when the slot table is missing or malformed, not guessed', () => {
  // No terminator slot at all here (buffer ends right after the one param
  // slot) -- refused rather than treated as a 1-parameter function whose
  // terminator happens to be out of bounds.
  const bytes = Buffer.from([
    ...HEADER,
    0x2d, 0x07,
    ...utf16('Foo'), 0x00, 0x00,
    ...declarationRecord(0, 1, 7),
    ...int32le(0xc0000001 | 0)
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.deepEqual(result.declarations,
    [{ name: 'Foo', paramCount: 1, hasReturnValue: false, returnType: undefined, parameterTypes: undefined }]);
});

test('0x6e is Continue, gated on the next byte being a real ; -- reopened after pass twenty rejected it', () => {
  // Pass twenty's rejection (9/660) was a raw, unfiltered count that
  // included every corruption-noise occurrence of this byte value. Gating
  // on the next byte being 0x15 (an already-recognised ";" token) filters
  // that out by construction: checked this way at full corpus scale
  // (not just the usual small-unmapped-count filter), 9/17, and all 8
  // non-matches are the same single already-known-stale program
  // (WEBLIB_OU_LP.ISCRIPT1). Confirmed against four real, independent
  // samples, one with a comment that names the construct in English:
  // WEBLIB_PTDIAG.ISCRIPT1's "/* invalid package name, do not output
  // anything, continue to next app package */\nContinue;".
  const result = decodeProgram(Buffer.from([...HEADER, 0x1f, 0x6e, 0x15, 0x1a]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Then\n  Continue;\nEnd-If');
});

test('0x6e stays unmapped when not immediately followed by ;, unlike the real Continue shape', () => {
  const result = decodeProgram(Buffer.from([...HEADER, 0x1f, 0x6e, 0x1a]), new NameTable());
  assert.equal(result.unknownOpcodes.some((u) => u.opcode === 0x6e), true);
});

test('the trailer is still found when a trailing comment separates the last newline from it', () => {
  // Confirmed against WEBLIB_QUERY.ISCRIPT1's real
  // `End-Function;\n\n/* 1746200000 */\nFunction IScript_ToXML();`: the
  // comment's own bytes sit between the last real newline and the
  // trailer's 0x07, so the literal [0x2d, 0x07] marker never occurs
  // adjacently anywhere in the buffer and the strict check alone leaves
  // the whole declaration-name trailer to be misread as more statement
  // code. Took this real program from 46 unmapped opcodes to 0.
  const body = utf16('/* a comment */');
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x38, 0x16, 0x00, 0x00,             // Return ""
      0x15,                                 // ;
      0x24, body.length & 0xff, body.length >> 8, ...body, // trailing comment, no 0x2d before the 0x07
      0x07,                                 // trailer marker's second byte, bare
      ...utf16('DoThing'), 0x00, 0x00,     // dispatch-table name, no introducer
      ...declarationRecord(0, 0, 7)
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.declarations?.[0]?.name, 'DoThing');
  assert.equal(result.text, 'Return "";\n/* a comment */\n');
});

test('the relaxed trailer check never fires when the strict marker exists anywhere in the buffer', () => {
  // Safety gate: a comment immediately before a bare 0x07 must not preempt
  // a real strict [0x2d, 0x07] match that exists later in the same
  // program -- confirmed by construction here, since this program's real
  // trailer (after "Real;") is the strict shape, and the comment-adjacent
  // bare 0x07 earlier is deliberately something else (an ordinary
  // mid-stream declaration-name reference, the ~900-corpus-wide role this
  // must not be confused with).
  const body = utf16('/* not the trailer */');
  const bytes = Buffer.from([
    ...HEADER,
    0x24, body.length & 0xff, body.length >> 8, ...body,
    0x07, ...utf16('SomeName'), 0x00, 0x00, // an ordinary mid-stream 0x07 declaration-name reference
    0x15,                                     // ;
    0x2d, 0x07,                               // the real, strict trailer marker
    ...utf16('Real'), 0x00, 0x00,
    ...declarationRecord(0, 0, 7)
  ]);
  const result = decodeProgram(bytes, new NameTable());
  assert.equal(result.declarations?.[0]?.name, 'Real');
});

test('0x48 is a third name-reference sibling, for Operation."Name" references', () => {
  // Confirmed against WEBLIB_GS_JU_IB.ISCRIPT1's real
  // `CreateMessage(Operation."GL_JRNL_IMP", %IntBroker_Request);`, its only
  // unmapped opcode -- resolving via the same PSPCMNAME table 0x21/0x4a
  // use, to `OPERATION.GL_JRNL_IMP`. Rendered with the qualifier as a fixed
  // keyword and the name in quotes, not dot-joined like 0x21, since an
  // Operation name can contain characters a bare identifier can't. Every
  // other corpus-wide occurrence is in an already heavily-corrupted
  // program with a garbage-large index, safely refused by the same
  // resolution-failure fallback 0x21/0x4a already have.
  const names = new NameTable();
  names.add(5, 'OPERATION.GL_JRNL_IMP');
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x0a, ...utf16('CreateMessage'), 0x00, 0x00,
      0xb,                     // (
      0x48, 0x04, 0x00,        // reference, index 4 -> NAMENUM 5
      0x3,                     // ,
      0x12, ...utf16('%IntBroker_Request'), 0x00, 0x00,
      0x14                     // )
    ]),
    names);
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'CreateMessage(Operation."GL_JRNL_IMP", %IntBroker_Request)');
});

test('0x48 falls through to unknown for an unconfirmed qualifier, not just a bad index', () => {
  const names = new NameTable();
  names.add(5, 'QUEUE.SOME_QUEUE');
  const result = decodeProgram(Buffer.from([...HEADER, 0x48, 0x04, 0x00]), names);
  assert.equal(result.unknownOpcodes.some((u) => u.opcode === 0x48), true);
});

test('#If/#Then/#End-If decode as a real indented block when the branch was compiled', () => {
  // PeopleTools evaluates #If at compile time, so only the taken branch
  // ever becomes real tokens -- 0x76 (#Then) here carries just its own
  // fixed text, and the body that follows (a real `Error "oops";`) is
  // ordinary compiled opcodes that pick up their own indent from 0x76's
  // INCREASE_INDENT, exactly like a real `Then` would. Confirmed against
  // WEBLIB_HRS_CB.HRS_ISCRIPT.FieldFormula's `#If #TOOLSREL >= "8.60"
  // #Then` (an `If`/`Else`/`End-If` block, simplified here to a single
  // `Error` statement). See docs/ROADMAP.md pass thirty-seven.
  const cond = utf16('#If #TOOLSREL >= "8.60"');
  const then = utf16('#Then');
  const endIf = utf16('#End-If');
  const result = decodeProgram(
    Buffer.from([
      ...HEADER, 0x15,
      0x75, cond.length & 0xff, cond.length >> 8, ...cond,
      0x76, then.length & 0xff, then.length >> 8, ...then,
      0x1b, 0x16, ...utf16('oops'), 0x00, 0x00, 0x15,
      0x78, endIf.length & 0xff, endIf.length >> 8, ...endIf,
      0x15
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, ';\n#If #TOOLSREL >= "8.60" #Then\n  Error "oops";\n#End-If;\n');
});

test('#Then carries the whole dead branch verbatim, embedded newlines and all, when the branch was not compiled', () => {
  // The other half of the same directive: when #If's condition is false at
  // compile time, the branch is never tokenized at all -- 0x76's own
  // length-prefixed text is `#Then` plus the untouched source of the dead
  // branch, byte-for-byte, down to its own indentation and line breaks.
  // Confirmed against the same real program's `#If #TOOLSREL < "8.60"
  // #Then` (compiled under a >= 8.60 tools release, so this branch lost):
  // a single 100-byte run reading `#Then\n      &ShowNotif = Decrypt("",
  // &ShowNotif1);`, immediately followed by 0x78's `#End-If` -- no real
  // opcodes in between at all.
  const cond = utf16('#If #TOOLSREL < "8.60"');
  const thenAndDeadBody = utf16('#Then\n      &ShowNotif = Decrypt("", &ShowNotif1);');
  const endIf = utf16('#End-If');
  const result = decodeProgram(
    Buffer.from([
      ...HEADER, 0x15,
      0x75, cond.length & 0xff, cond.length >> 8, ...cond,
      0x76, thenAndDeadBody.length & 0xff, thenAndDeadBody.length >> 8, ...thenAndDeadBody,
      0x78, endIf.length & 0xff, endIf.length >> 8, ...endIf,
      0x15
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, ';\n#If #TOOLSREL < "8.60" #Then\n      &ShowNotif = Decrypt("", &ShowNotif1);\n#End-If;\n');
});

test('0x43 is Exit, the same bare-keyword shape as Break', () => {
  // Confirmed identically 3/3 across the whole corpus -- each program's
  // only unmapped opcode, always the same real source:
  // `%Response.RedirectURL(&URL);\n      Exit;\n   End-If;` (WEBLIB_EOAW.
  // EOAW_MON_ADHOC, WEBLIB_EOAW.EOAW_MON_ADHOC_NUI, WEBLIB_PTAF.
  // PTAFAW_MON_ADHOC). This was the last unmapped opcode anywhere in the
  // corpus: fixing it brings clean programs to 204/204. See
  // docs/ROADMAP.md pass thirty-eight.
  const result = decodeProgram(Buffer.from([...HEADER, 0x1a, 0x43, 0x15]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'End-If Exit;\n');
});

test('0x20 is a zero-width marker before a bare, unassigned expression statement', () => {
  // Found by decoding every program in the live database (~121k), not
  // just the 204-program corpus -- see docs/ROADMAP.md pass thirty-nine.
  // Confirmed structurally (no project-export source for these delivered
  // base objects): 5 independent occurrences across 3 real programs, all
  // sitting directly after a statement boundary (`;` or `Then`) and
  // directly before a real `(` opening a bare function-call statement
  // whose result is discarded -- `(MsgGet(6540, 127, "..."));`. Confirmed
  // against ABSENCE_HIST.ABS_RECURRENCE.SaveEdit and
  // AA_ONE_JPN_VW.ACTION_REASON_JPN.SaveEdit, each program's only
  // unmapped opcode.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER, 0x1c, 0x2f, 0x1f,             // If True Then
      0x20, 0xb, 0x0a, ...utf16('MsgGet'), 0x00, 0x00, 0xb, 0x14, 0x14, 0x15, // (MsgGet());
      0x1a, 0x15                                // End-If;
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'If True Then\n  (MsgGet());\nEnd-If;\n');
});

test('0x51 is Local\'s own zero-width sibling, for a declaration with no scope keyword at all', () => {
  // The clincher: AE_WRK.AE_BIND_VALUE.FieldEdit declares
  // `Local Record &MYREC;`, `Field &MYFLD;`, `Local Field &FLD;` and
  // `Local Record &REC;` back to back -- the three with an explicit
  // `Local` decode via the already-confirmed 0x44 exactly as everywhere
  // else, and only the one genuinely missing it (`Field &MYFLD;`,
  // PeopleCode's implicit-current-field idiom, valid with no scope
  // keyword at a program's top level) carries 0x51 instead. Reproduced
  // here as the same two declarations back to back.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x44, 0xa, ...utf16('Record'), 0x00, 0x00, 0x1, ...utf16('&MYREC'), 0x00, 0x00, 0x15,
      0x51, 0xa, ...utf16('Field'), 0x00, 0x00, 0x1, ...utf16('&MYFLD'), 0x00, 0x00, 0x15
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Local Record &MYREC;\nField &MYFLD;\n');
});

test('0x60 is a property\'s optional readonly modifier', () => {
  // Found scanning the live database (pass thirty-nine): every property in
  // ADSM.ADSCompareDiffObject.OnExecute carries this opcode right before
  // its terminating `;` (19/19) -- and that same program hands over the
  // literal text directly, since one property is commented out with `rem`
  // and the comment's own real text reads `rem property array of array
  // of string RecKeyValueList readonly;`. Absent on OU_JET_PACK.Model.
  // PageCol's plain, mutable `property number ColSeq;` (pass
  // twenty-eight) -- optional, not mandatory grammar.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x5e, 0x40, ...utf16('string'), 0x00, 0x00, 0xa, ...utf16('SessionID'), 0x00, 0x00, 0x60, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'property string SessionID readonly;\n');
});

test('0x48 generalizes past Operation to every confirmed quoted-reference qualifier', () => {
  // Found scanning the live database (pass forty): 0x48 is not
  // Operation-specific after all. ACA_NOTE_WRK.EMPLID.Workflow's real
  // `TriggerBusinessEvent(BusProcess."SEND_ACA_NOTIFICATION",
  // BusActivity."SEND_ACA_NOTIFICATION", BusEvent."Notify Employee")`
  // proves it structurally -- "Notify Employee" has a literal space, so
  // the quoted form isn't optional there either, the same reason Operation
  // needed it. MenuName/BarName/ItemName/Page (ACA_XML_WRK.ACA_UPDATE_PB.
  // FieldChange's real `Transfer(True, MenuName."ACA_SETUP_RPT",
  // BarName."USE", ItemName."ACA_EMP_XMIT", Page."ACA_EMP_XMIT_PART1", ...)`)
  // and MenuName alone (ADDL_PAY_DATA.EMPLID.RowInit's real `If %Menu <>
  // MenuName."MAINTAIN_PAYROLL_DATA_CANADA" Then`) round out the set --
  // all three programs go from real unmapped opcodes to zero.
  const names = new NameTable();
  names.add(1, 'BUSEVENT.Notify Employee');
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x48, 0x00, 0x00]),
    names);
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'BusEvent."Notify Employee"');
});

test('0x48 also covers Panel/PanelGroup, PeopleTools\' pre-8.4x names for Page/Component', () => {
  // Confirmed against DERIVED_FP_CA.FP_CA_BTTN2.FieldChange's real
  // `DoModalPanelGroup(MenuName."HEADCOUNT_(FP)", BarName."MDX",
  // ItemName."CALINKS", Panel."FP_AVLBL_CA", ...)` -- PSPCMNAME still
  // stores these under their old names for programs compiled that far
  // back. 0 unmapped opcodes in the real program.
  const names = new NameTable();
  names.add(1, 'PANEL.FP_AVLBL_CA');
  const result = decodeProgram(Buffer.from([...HEADER, 0x48, 0x00, 0x00]), names);
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Panel."FP_AVLBL_CA"');
});

test('0x72 is implements, extends\' sibling for an interface', () => {
  // Confirmed against ACCOM_TYPE_FULLSYNC.AccomTypeFullsync.OnExecute's
  // real `class AccomTypeFullsync implements PS_PT:Integration:
  // INotificationHandler` -- this program's only unmapped opcode,
  // sitting in exactly the position 0x5c (`extends`) occupies for a real
  // base class.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x5a, 0x0a, ...utf16('AccomTypeFullsync'), 0x00, 0x00,
      0x72, 0x0a, ...utf16('PS_PT'), 0x00, 0x00,
      0x57, 0x0a, ...utf16('Integration'), 0x00, 0x00,
      0x57, 0x0a, ...utf16('INotificationHandler'), 0x00, 0x00,
      0x5b, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'class AccomTypeFullsync implements PS_PT:Integration:INotificationHandler\nend-class;\n');
});

test('a property getter\'s implementation header consumes the same 0x41 method\'s does', () => {
  // Confirmed against ADS.Common.OnExecute's real `get useFlowControl\n
  // /+ Returns Boolean +/\n\n   Return (GetUserOption(...) <> "Y");`
  // (2/2 occurrences in that program). `get` (0x5f) was previously a
  // fixed OPCODES entry with no lookahead, so it couldn't consume this
  // the way `method` (0x63) already does; moved into the same
  // isApplicationClass-gated dispatch to gain the same lookahead.
  // 0x6a (`end-get`, pass forty-two) closes it: confirmed against the
  // same program's real getters, each one's `Return (...);` immediately
  // followed by a bare `end-get;` and then the next getter's own doc
  // comment (3/3 occurrences).
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x5f, 0x41, 0xa, ...utf16('useFlowControl'), 0x00, 0x00,
      0x6d, ...utf16('Returns Boolean'), 0x00, 0x00,
      0x38, 0x2f, 0x15,
      0x6a, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'get useFlowControl\n  /+ Returns Boolean +/\n  Return True;\nend-get;\n');
});

test('0x49 is set, get\'s setter sibling -- bare shorthand form carries no indent', () => {
  // Confirmed against ADS.GVar4AdsDefnRet.OnExecute's real `property
  // string PTADSADVSRCHIN get set;` -- an auto-implemented property
  // (both accessors, no custom body), the whole thing one statement.
  // Neither `get` nor `set` carries INCREASE_INDENT_ONCE in this bare
  // form (no 0x41 implementation-header byte) -- confirmed the hard way:
  // applying it unconditionally left each subsequent `property ... get
  // set;` line in that same real program one level deeper than the
  // last, all the way down a 16-property class.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x5e, 0x40, ...utf16('string'), 0x00, 0x00, 0xa, ...utf16('PTADSADVSRCHIN'), 0x00, 0x00,
      0x5f, 0x49, 0x15,
      0x5e, 0x40, ...utf16('string'), 0x00, 0x00, 0xa, ...utf16('NextProp'), 0x00, 0x00,
      0x5f, 0x49, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text,
    'property string PTADSADVSRCHIN get set;\n' +
    'property string NextProp get set;\n');
});

test('end-set (0x6b) closes a set implementation body, the same shape as end-get', () => {
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x49, 0x41, 0xa, ...utf16('useFlowControl'), 0x00, 0x00, 0x15,
      0x6b, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'set useFlowControl;\nend-set;\n');
});

test('0x5d is a method parameter\'s out modifier', () => {
  // Confirmed against ADS.Common.OnExecute's real `method
  // ADSHasAbsentRecords(&adsName As string, &missingRecordsInProj As
  // string out) Returns boolean;` -- a parameter named for carrying
  // output, out is exactly what it should be. This was the resolution
  // to a pattern pass forty investigated and left open: not every
  // non-first string parameter, not same-type-as-previous, but whether
  // that specific parameter is declared out.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x63, 0xa, ...utf16('F'), 0x00, 0x00, 0xb,
      0x1, ...utf16('&x'), 0x00, 0x00, 0x35, 0x40, ...utf16('string'), 0x00, 0x00, 0x5d,
      0x14, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'method F(&x As string out);\n');
});

test('0x70 is interface, class\'s sibling for an interface declaration', () => {
  // Confirmed against BN_CERTIFICATE.WeightCalculator.OnExecute, whose
  // own doc comment says so directly ("This interface is a
  // implementation of the Strategy pattern..."); 0x70 sits right before
  // the bare name with no 0x5a/0x5c (class/extends) anywhere in the
  // program.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x70, 0x0a, ...utf16('WeightCalculator'), 0x00, 0x00
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'interface WeightCalculator');
});

test('0x6f/0x71 are abstract and end-interface, closing the same interface', () => {
  // Confirmed against the same BN_CERTIFICATE.WeightCalculator.
  // OnExecute: `method calculate(&intA As integer, &intB As integer)
  // Returns number` is followed by `0x6f;` then `0x71;` -- `abstract`
  // modifying the bodyless interface method, then `end-interface`
  // closing the block. Corroborated independently by a reference
  // PeopleCodeParser.java (a separate, older decompiler project) which
  // lists the same two byte values for the same two keywords.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x70, 0x0a, ...utf16('WeightCalculator'), 0x00, 0x00,
      0x63, 0xa, ...utf16('calculate'), 0x00, 0x00, 0xb, 0x14, 0x39, 0x40, ...utf16('number'), 0x00, 0x00,
      0x6f, 0x15,
      0x71, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text,
    'interface WeightCalculator\n' +
    '  method calculate() Returns number abstract;\n' +
    'end-interface;\n');
});

test('0x33 is Library, for an external DLL function declaration', () => {
  // Confirmed against APPS_RLR.Utilities.OnExecute's real
  // `Declare Function RegCloseKey Library "advapi32" (...)`.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x31, 0x32, 0x0a, ...utf16('RegCloseKey'), 0x00, 0x00,
      0x33, 0x16, ...utf16('advapi32'), 0x00, 0x00
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Declare Function RegCloseKey Library "advapi32"');
});

test('a DLL declaration\'s parameter list decodes fully: Value/Ref passing mode and the zero-width 0x41 before it', () => {
  // Confirmed against APPS_RLR.Utilities.OnExecute's real
  // `Declare Function RegCloseKey Library "advapi32"\n      (long Value
  // As number) Returns long;` -- the program's only unmapped opcodes
  // once Library itself decoded were 0x36 (Value), and a third role for
  // the already-overloaded 0x41 (zero-width, gated on the next byte
  // being the newline opcode 0x2d this time, distinct from its And/Or
  // and method-header gates).
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x31, 0x32, 0x0a, ...utf16('RegCloseKey'), 0x00, 0x00,
      0x33, 0x16, ...utf16('advapi32'), 0x00, 0x00,
      0x41, 0x2d,
      0xb, 0xa, ...utf16('long'), 0x00, 0x00, 0x36, 0x35, 0x40, ...utf16('number'), 0x00, 0x00, 0x14,
      0x39, 0xa, ...utf16('long'), 0x00, 0x00, 0x15
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text,
    'Declare Function RegCloseKey Library "advapi32"\n  (long Value As number) Returns long;\n');
});

test('0x3b is Ref, Value\'s pass-by-reference sibling', () => {
  const result = decodeProgram(Buffer.from([...HEADER, 0x3b]), new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'Ref');
});

test('0x61 is a class\'s private section header', () => {
  // Confirmed against ADS.Relation.SqlGenerator.OnExecute's real class
  // block: `method GenerateSql() Returns string;\n\nprivate\n   method
  // GenerateSqlPerMapping() Returns string;\n   method
  // GenerateSqlPerCriteria() Returns string;\nend-class;` -- this
  // program's only unmapped opcode.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x5a, 0x0a, ...utf16('SqlGenerator'), 0x00, 0x00,
      0x63, 0xa, ...utf16('GenerateSql'), 0x00, 0x00, 0xb, 0x14, 0x39, 0x40, ...utf16('string'), 0x00, 0x00, 0x15,
      0x61,
      0x63, 0xa, ...utf16('GenerateSqlPerMapping'), 0x00, 0x00, 0xb, 0x14, 0x39, 0x40, ...utf16('string'), 0x00, 0x00, 0x15,
      0x5b, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text,
    'class SqlGenerator\n' +
    '  method GenerateSql() Returns string;\n' +
    '  private\n' +
    '  method GenerateSqlPerMapping() Returns string;\n' +
    'end-class;\n');
});

test('0x62 alone (no leading 0x61) is instance', () => {
  // Corrected from pass twenty-eight's fused "0x61 immediately followed
  // by 0x62" pairing (see the property/instance/extends test above):
  // 0x62 is its own independent keyword. Confirmed against EOAW_CORE.
  // Utils.OnExecute's real `Local string &errorSetting;\ninstance array
  // of string &delegationProcesses;` -- an instance declaration with no
  // `private` before it.
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x62, 0x40, ...utf16('string'), 0x00, 0x00, 0x1, ...utf16('&errorSetting'), 0x00, 0x00, 0x15
    ]),
    new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, 'instance string &errorSetting;\n');
});

test('0x48 still falls through to unknown for a qualifier outside the confirmed set', () => {
  const names = new NameTable();
  names.add(1, 'SOMEUNKNOWNTYPE.Foo');
  const result = decodeProgram(Buffer.from([...HEADER, 0x48, 0x00, 0x00]), names);
  assert.equal(result.unknownOpcodes.some((u) => u.opcode === 0x48), true);
});

test('0x27/0x28 are Repeat/Until, PeopleCode\'s third loop shape', () => {
  // Found scanning the live database (pass forty). ADS_DMW.SelectBuilder.
  // OnExecute's real `&start = 1;\nRepeat\n  &found = Find(",",
  // &expression, &start);\n  ...\n  &start = &found + 1;\nUntil &found <=
  // 0;` matches exactly: 0x27 sits right after the statement before the
  // loop and right before its first body statement (same shape as Try,
  // hence TRY_STYLE); 0x28 sits right after the body's last `;` and right
  // before the exit condition, which the real trailing `;` already
  // terminates. Confirmed on 2 independent occurrences in this program
  // alone (10 -> 6 unmapped opcodes) plus a third in
  // ADSM.CompareDataManager.OnExecute (a parenthesised condition,
  // `Until (...)`, 14 -> 12 unmapped).
  const num = (n: number) => {
    const bytes = [0x50, 0x00, 0x00];
    for (let i = 0; i < 16; i++) { bytes.push(n & 0xff); n = n >> 8; }
    return bytes;
  };
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x1, ...utf16('&x'), 0x00, 0x00, 0x6, ...num(0), 0x15,
      0x27,
      0x1, ...utf16('&x'), 0x00, 0x00, 0x6, ...num(1), 0x15,
      0x28, 0x1, ...utf16('&x'), 0x00, 0x00, 0xc, ...num(0), 0x15
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '&x = 0;\nRepeat\n  &x = 1;\nUntil &x <= 0;\n');
});

test('0x77 is #Else, completing the #If/#Then/#Else/#End-If directive family', () => {
  // Confirmed against AGC_PROCESS_AG.ActivityGuideCreation.OnExecute's
  // real `#If #ToolsRel < "8.58" #Then\n   %This.SetLanguages(&list);
  // \n#Else\n   /* 8.58 and greater... */\n   If Not
  // &list.bCreateMLInstances Then\n      %This.SetLanguages(&list);\n
  // End-If;\n#End-If`: the `< "8.58"` branch lost (compiled under a
  // newer tools release), so `#Then` carries its dead body verbatim
  // (pass thirty-seven's shape), while `#Else`'s own text is bare (10
  // bytes, exactly `#Else`) since ITS branch compiled normally -- a real
  // comment and `If` follow as ordinary tokens. 11 -> 2 unmapped opcodes
  // in the real program (the 2 left are unrelated). See
  // docs/ROADMAP.md pass forty.
  const cond = utf16('#If #ToolsRel < "8.58"');
  const thenAndDeadBody = utf16('#Then\n   %This.SetLanguages(&list);');
  const elseKeyword = utf16('#Else');
  const endIf = utf16('#End-If');
  const result = decodeProgram(
    Buffer.from([
      ...HEADER,
      0x75, cond.length & 0xff, cond.length >> 8, ...cond,
      0x76, thenAndDeadBody.length & 0xff, thenAndDeadBody.length >> 8, ...thenAndDeadBody,
      0x77, elseKeyword.length & 0xff, elseKeyword.length >> 8, ...elseKeyword,
      0x1c, 0x2f, 0x1f, 0x1a, 0x15,
      0x78, endIf.length & 0xff, endIf.length >> 8, ...endIf
    ]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text,
    '#If #ToolsRel < "8.58" #Then\n' +
    '   %This.SetLanguages(&list);\n' +
    '#Else\n' +
    '  If True Then\n' +
    '  End-If;\n' +
    '#End-If');
});

test('a string literal with a real non-ASCII character survives whole, the same bug as comments once had', () => {
  // readTextRun (used for string literals and bare identifiers, unlike
  // comments' own length-prefixed readLengthPrefixedText) had the same
  // printable-ASCII-only restriction pass thirty-two's comment fix
  // removed, just never carried over to this reader. Confirmed against
  // HCB_CORE_LIBRARIES.HCB_JsonBuilder.OnExecute's real
  // `&Emplid_CurrSymbol = "£"` (its string literal's only character is
  // U+00A3) -- rejecting it fell through to walking the character's own
  // bytes as a fresh opcode, cascading the rest of the statement into
  // unmapped noise. 11 -> 1 unmapped opcodes in the real program (the one
  // left is unrelated). See docs/ROADMAP.md pass forty.
  const result = decodeProgram(
    Buffer.from([...HEADER, 0x16, 0xa3, 0x00, 0x00, 0x00]),
    new NameTable());
  assert.equal(result.unknownOpcodes.length, 0);
  assert.equal(result.text, '"£"');
});
