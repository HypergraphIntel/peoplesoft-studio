import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 117: a parenthesized group holds the full expression grammar
 * (arithmetic, comparison, And / Or, Not) whatever its left operand, in
 * every expression position. Corpus shapes: App Class getters `Return
 * (%This.AppMsgs.Len > 0);`, `If (%This.level = 1) Then`, 19510
 * `PT_WORK.PT_BUTTON_NEWWIN.Visible = (IsNewWindowEnabled() And Not (...))`,
 * 21960 `Not ((Record.GP_ABS_EVENT).IsDeleted)`, 4861 `GetRowset((@&x))`.
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const program = (source: string) => encodeProgramArtifacts(source, { owner }).program;
const group = (bytes: Buffer) => bytes.subarray(bytes.indexOf(0x0b), bytes.lastIndexOf(0x14) + 1);

test('Return of a grouped comparison on a %This property chain', () => {
  const bytes = program('Return (%This.AppMsgs.Len > 0);\n');
  // 38 Return, 0B ( %This . AppMsgs . Len 09 > 0 14 ), 15
  assert.equal(bytes[bytes.indexOf(0x38) + 1], 0x0b);
  assert.ok(bytes.includes(Buffer.from([0x09, 0x50])));
  assert.equal(bytes.subarray(-3).toString('hex'), '141507');
});

test('If with a grouped comparison on a %This property chain', () => {
  assert.doesNotThrow(() => program('If (%This.level = 1) Then\nEnd-If;\n'));
});

test('a grouped function result And Not (...) is one boolean group in If and in an assignment (19510)', () => {
  const inIf = program('If (IsNewWindowEnabled() And Not (&X = 1)) Then\nEnd-If;\n');
  const assigned = program('&b = (IsNewWindowEnabled() And Not (&X = 1));\n');
  // the And chain is wrapped in 0x41 .. 0x42 in both positions
  assert.deepEqual(group(assigned).subarray(0, group(inIf).length - 3), group(inIf).subarray(0, group(inIf).length - 3));
  assert.ok(group(assigned).includes(Buffer.from([0x41, 0x18, 0x1d])));
});

test('a grouped comparison the old lookahead recognized is unchanged in either position', () => {
  const inIf = program('If (&a = 1) Then\nEnd-If;\n');
  const assigned = program('&b = (&a = 1);\n');
  assert.deepEqual(group(assigned), group(inIf));
});

test('a group in a Not operand continues its postfix chain (21960)', () => {
  const bytes = program('If Not ((Record.REC).IsDeleted) Then\nEnd-If;\n');
  assert.ok(bytes.includes(Buffer.from('IsDeleted', 'utf16le')));
});

test('an @ operand inside a group is an ordinary primary (4861)', () => {
  assert.doesNotThrow(() => program('&rs = &rs0(1).GetRowset((@&s));\n'));
  assert.doesNotThrow(() => program('&t = (@("A" | &n) + @("B" | &n));\n'));
});
