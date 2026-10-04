import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 163: three byte-only (COMPLETE_DOWNSTREAM) layout rules -- the
 * reference list is unchanged in each.
 *   - `&Public` / `&Private` / `&Protected` are variables, not class-header
 *     visibility sections: 29867 / 29870 `method CopyTo(..., &Public As
 *     boolean) ...;` then a blank line stores `14 15 4F 63` (the phantom
 *     `public` section swallowed the blank line).
 *   - a bare `array` (no `of`) does not consume the whitespace after it:
 *     16893 `Function SplitStrElements(&strElements) Returns array` then a
 *     blank line stores `2D 4F`.
 *   - a class-header `instance` list keeps its trailing comma: 29006
 *     `instance string &a, ..., &msErrText,;` stores `01 03 15`, as an
 *     ordinary `Component` list does (4602, 14721 ...).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const tokens = (source: string, context: any) => {
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'owner' ? '' : `${r.recordName ?? 'PACKAGE'}.${r.fieldName ?? r.packageName}`);
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: context.owner?.packagePath !== undefined });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { ...context, commentOpcodes }).program, program, 'roundtrip');
  return { ops: decoded.tokens.map(t => t.opcode.toString(16).padStart(2, '0')), references: references.length };
};
const window = (ops: string[], at: number, before: number, after: number) => ops.slice(at - before, at + after).join(' ');

test('a parameter named &Public is not a visibility section; the blank line after its method is kept (29867)', () => {
  const header = (param: string) => `class Demo\n   method Run();\n   method CopyTo(&Source As string, ${param} As boolean);\n   \n   method Other();\nend-class;\n`;
  const { ops, references } = tokens(header('&Public'), { owner });
  const close = ops.indexOf('14', ops.indexOf('14') + 1);
  assert.equal(window(ops, close, 0, 4), '14 15 4f 63');
  // control: any other parameter name encodes the same layout
  assert.deepEqual(tokens(header('&Shared'), { owner }).ops, ops);
  assert.equal(references, tokens(header('&Shared'), { owner }).references);
});

test('a bare Returns array keeps the blank line after the Function header (16893)', () => {
  const { ops } = tokens('Function Split(&s) Returns array\n   \n   &n = 1000;\n   Return &a;\nEnd-Function;\n', { owner: { recordName: 'REC', fieldName: 'FLD' } });
  const boundary = ops.indexOf('2d');
  assert.equal(window(ops, boundary, 0, 3), '2d 4f 01');
  // control: `Returns array of string` already did
  const of = tokens('Function Split(&s) Returns array of string\n   \n   &n = 1000;\n   Return &a;\nEnd-Function;\n', { owner: { recordName: 'REC', fieldName: 'FLD' } }).ops;
  assert.equal(window(of, of.indexOf('2d'), 0, 3), '2d 4f 01');
});

test('a class-header instance list keeps its trailing comma (29006)', () => {
  const { ops } = tokens('class Demo\n   method Run();\nprivate\n   instance string &msA, &msErrText,;\nend-class;\n', { owner });
  const instance = ops.indexOf('62');
  assert.equal(window(ops, instance, 0, 7), '62 40 01 03 01 03 15');
  const plain = tokens('class Demo\n   method Run();\nprivate\n   instance string &msA, &msErrText;\nend-class;\n', { owner }).ops;
  assert.equal(window(plain, plain.indexOf('62'), 0, 6), '62 40 01 03 01 15');
});
