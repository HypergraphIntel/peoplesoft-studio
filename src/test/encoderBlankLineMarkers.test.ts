import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment, encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 113: a statement inside a When body keeps one 0x4F per blank line
 * before it (the general blank-line rule), not a single marker. 5208 /
 * 5373: `End-If;` + two blank lines + `If ...` inside a When stores
 * `1A 15 4F 4F 1C`.
 */
const markersBeforeIn = (bytes: Buffer, name: string): number => {
  let at = bytes.indexOf(Buffer.from(name, 'utf16le')) - 1;
  let markers = 0;
  while (bytes[--at] === 0x4f) markers++;
  return markers;
};
const markersBefore = (source: string, name: string): number => markersBeforeIn(encodeFragment(source), name);

test('two blank lines before a When-body statement are two markers (5373)', () => {
  const source = 'Evaluate &x\nWhen 1\n   F();\n\n\n   &second = 2;\nEnd-Evaluate;\n';
  assert.equal(markersBefore(source, '&second'), 2);
});

test('one blank line before a When-body statement is one marker', () => {
  const source = 'Evaluate &x\nWhen 1\n   F();\n\n   &second = 2;\nEnd-Evaluate;\n';
  assert.equal(markersBefore(source, '&second'), 1);
});

test('two blank lines before End-Evaluate are two markers (6956)', () => {
  const bytes = encodeFragment('Evaluate &x\nWhen 1\n   F();\n\n\nEnd-Evaluate;\n');
  let at = bytes.indexOf(0x3f) - 1;
  let markers = 0;
  while (bytes[at--] === 0x4f) markers++;
  assert.equal(markers, 2);
});

/*
 * Cycle 113: an Application Class program keeps its blank-line markers
 * without any compiled reference (29137 `Constants`: string assignments
 * separated by a blank line store `15 4F 01`).
 */
test('an Application Class method keeps blank lines without references (29137)', () => {
  const source = [
    'class Constants',
    '   method Constants();',
    'end-class;',
    '',
    'method Constants',
    '   &a = "A";',
    '',
    '   &b = "B";',
    'end-method;',
    ''
  ].join('\n');
  const bytes = encodeProgramArtifacts(source, { owner: { recordName: 'PKG', fieldName: 'Constants', packagePath: ['PKG', 'Constants'] } }).program;
  assert.equal(markersBeforeIn(bytes, '&b'), 1);
});

/*
 * Cycle 113: loop bodies keep one 0x4F per blank line -- after a For
 * header (4950: two blank lines -> `2D 4F 4F`), before a REM in a For body
 * (4094), and before a statement in a Repeat body (4827).
 */
test('two blank lines after a For header are two markers (4950)', () => {
  assert.equal(markersBefore('For &i = 1 To 3\n\n\n   &first = 1;\nEnd-For;\n', '&first'), 2);
});

test('a blank line before a REM in a For body is a marker (4094)', () => {
  const bytes = encodeFragment('For &i = 1 To 3\n   F();\n\n   rem skip G;\n   H();\nEnd-For;\n');
  const rem = bytes.indexOf(Buffer.from('rem skip G;', 'utf16le'));
  assert.equal(bytes.subarray(rem - 5, rem - 3).toString('hex'), '154f');
});

test('a blank line before a Repeat-body statement is a marker (4827)', () => {
  assert.equal(markersBefore('Repeat\n   F(Record.REC);\n\n   &second = 2;\nUntil &second = 2;\n', '&second'), 1);
});

/*
 * Cycle 131: the blank lines after a standalone comment are 0x4F markers
 * wherever the comment sits -- before a For body's first statement (14899
 * `2D 24 4F 01`), between an Evaluate selector and its first When (6493
 * `24 4F 3D`), leading a boolean operand (2958 `1E 24 4F 12`), after an
 * If-body statement with no `;` (2809 `24 4F 1A`). A comment directly
 * followed by code keeps no marker.
 */
const markersAfterComment = (bytes: Buffer, comment: string): number => {
  let at = bytes.indexOf(Buffer.from(comment, 'utf16le')) + Buffer.byteLength(comment, 'utf16le');
  let markers = 0;
  while (bytes[at++] === 0x4f) markers++;
  return markers;
};

test('a blank line after a comment before a For body\'s first statement is a marker (14899)', () => {
  assert.equal(markersAfterComment(encodeFragment('For &i = 1 To 3\n   /* c */\n\n   &first = 1;\nEnd-For;\n'), '/* c */'), 1);
});

test('two blank lines after a comment run before a For body\'s first statement are two markers (13828)', () => {
  const bytes = encodeFragment('For &i = 1 To 3\n   /* a */\n   /* b */\n\n\n   &first = 1;\nEnd-For;\n');
  assert.equal(markersAfterComment(bytes, '/* a */'), 0);
  assert.equal(markersAfterComment(bytes, '/* b */'), 2);
});

test('a comment directly followed by a For body\'s first statement has no marker', () => {
  assert.equal(markersAfterComment(encodeFragment('For &i = 1 To 3\n   /* c */\n   &first = 1;\nEnd-For;\n'), '/* c */'), 0);
});

test('a blank line after a comment between an Evaluate selector and its first When is a marker (6493)', () => {
  const bytes = encodeFragment('Evaluate &x\n   /* c */\n\nWhen 1\n   F();\nEnd-Evaluate;\n');
  const end = bytes.indexOf(Buffer.from('/* c */', 'utf16le')) + Buffer.byteLength('/* c */', 'utf16le');
  assert.equal(bytes.subarray(end, end + 2).toString('hex'), '4f3d');
});

test('a blank line after a comment leading a boolean operand is a marker (2958)', () => {
  assert.equal(markersAfterComment(encodeFragment('If &a = 1 Or\n      /* c */\n\n      &b = 2 Then\n   F();\nEnd-If;\n'), '/* c */'), 1);
});

test('a blank line after a comment following an If-body statement with no ; is a marker (2809)', () => {
  assert.equal(markersAfterComment(encodeFragment('If &a = 1 Then\n   F(Record.REC)\n   /* c */\n\nEnd-If;\n'), '/* c */'), 1);
});

test('an Application Class For body keeps the blank line after a leading comment (30160)', () => {
  const source = [
    'class Constants',
    '   method Constants();',
    'end-class;',
    '',
    'method Constants',
    '   For &i = 1 To 2',
    '      rem For &LevelNum = 1 To 2;',
    '',
    '      &a = "A";',
    '   End-For;',
    'end-method;',
    ''
  ].join('\n');
  const bytes = encodeProgramArtifacts(source, { owner: { recordName: 'PKG', fieldName: 'Constants', packagePath: ['PKG', 'Constants'] } }).program;
  assert.equal(markersAfterComment(bytes, 'rem For &LevelNum = 1 To 2;'), 1);
});
