import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 169: the 0x50 operand is an 18-byte DEC (sign, scale, 16-byte
 * magnitude; pt861 psmath.dll). Executable `-n` is unary minus (0x0E)
 * before an unsigned literal; a negative Constant value is ONE signed
 * literal (29858 `Constant &UNSET_ANGLE = -4002840;` stores
 * `50 01 00 18 14 3D ...`), in ordinary and App Class header Constants.
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const literalAfter = (program: Buffer, prefix: string) => {
  const at = program.indexOf(Buffer.from(prefix, 'hex'));
  assert.ok(at >= 0, `missing ${prefix}`);
  return program.subarray(at + prefix.length / 2, at + prefix.length / 2 + 8).toString('hex');
};
const roundtrip = (source: string, context: any, isApplicationClass = false) => {
  const { program } = encodeProgramArtifacts(source, context);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto', isApplicationClass });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, context).program, program, 'roundtrip');
  return { program, text: decoded.text };
};

test('a negative Constant is one signed 0x50 literal (29858)', () => {
  const { program, text } = roundtrip('Constant &A = -4002840;\n', { owner });
  assert.equal(literalAfter(program, '000006'), '50010018143d0000');
  assert.match(text, /Constant &A = -4002840;/);
});

test('a positive Constant keeps the unsigned literal (control)', () => {
  const { program } = roundtrip('Constant &A = 4002840;\n', { owner });
  assert.equal(literalAfter(program, '000006'), '50000018143d0000');
});

test('an executable negative stays unary minus before an unsigned literal (control)', () => {
  const { program } = roundtrip('Local number &x;\n&x = -4002840;\n', { owner });
  assert.ok(program.includes(Buffer.from('0e50000018143d', 'hex')));
});

test('an App Class header negative Constant is the same signed literal', () => {
  const source = 'class Demo\n   method Run();\nprivate\n   Constant &A = -4002840;\nend-class;\n\nmethod Run\n   &x = 1;\nend-method;\n';
  const context = { owner: { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] } };
  const { program } = encodeProgramArtifacts(source, context);
  assert.ok(program.includes(Buffer.from('50010018143d', 'hex')));
});
