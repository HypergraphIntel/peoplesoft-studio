import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodePrimitiveMethodSignature } from '../peoplecode/applicationClassMetadata.js';
import { readProgramLayout } from '../peoplecode/programLayout.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { encodeProgram } from '../peoplecode/encoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { applicationClassSignatureCaptures } from './fixtures/applicationClassSignatures.js';

for (const capture of applicationClassSignatureCaptures) {
  const { signature } = capture;
  const label = Object.entries(capture.key).filter(([key, value]) => key.startsWith('OBJECTVALUE') && value !== ' ').map(([, value]) => value).join('.');
  test(`Application Class signature golden: ${label}.${signature.name}`, () => {
    const bytes = Buffer.concat(capture.programRows.map(row => Buffer.from(row.hex, 'hex')));
    assert.equal(bytes.length, capture.programRows[0].PROGLEN);
    const layout = readProgramLayout(bytes);
    const encoded = encodePrimitiveMethodSignature(signature);
    if (layout.recordCount === 2) {
      assert.equal(layout.slotCount, signature.parameterTypes.length + 1);
      assert.equal(layout.slots.byteLength, encoded.slots.length);
    }
    const nameAt = layout.names.offset + signature.nameOffset * 2;
    assert.equal(bytes.subarray(nameAt, nameAt + (signature.name.length + 1) * 2).toString('utf16le'), signature.name + '\0');
    const records = Array.from({ length: layout.recordCount }, (_, i) => layout.records.offset + i * 16);
    const at = records.find(offset => bytes.readUInt32LE(offset) === signature.nameOffset);
    assert.notEqual(at, undefined);
    assert.deepEqual(encoded.record, bytes.subarray(at!, at! + 16));
    const slotAt = layout.slots.offset + signature.slotOffset * 4;
    assert.deepEqual(encoded.slots, bytes.subarray(slotAt, slotAt + encoded.slots.length));
    // The complete source/binary/name capture remains available even where
    // method bodies or property ordering are not yet encodable.
    const names = new NameTable();
    for (const row of capture.names) {
      names.add(row.NAMENUM, [row.RECNAME.trim(), row.REFNAME.trim()].filter(Boolean).join('.'));
    }
    const decoded = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass: true });
    const declaration = decoded.declarations?.find(d => d.name === signature.name);
    assert.ok(declaration);
    assert.equal(declaration.paramCount, signature.parameterTypes.length);
    assert.equal(declaration.returnType, signature.returnType);
    if (signature.parameterTypes.length > 0) assert.deepEqual(declaration.parameterTypes, signature.parameterTypes);
    const annotations = [...capture.source.matchAll(/\/\+\s*([\s\S]*?)\s*\+\//g)].map(match => match[0]);
    const signatureTokens = decoded.tokens.filter(token => token.opcode === 0x6d).map(token => token.text.trim());
    assert.deepEqual(signatureTokens, annotations);
    assert.equal(capture.names[0].NAMENUM, 1);
    assert.equal(capture.names[0].RECNAME, ' ');
    assert.equal(capture.names[0].REFNAME, ' ');
  });
}

test('existing OU_CORPUS Application Class remains byte exact in both directions', () => {
  const capture = applicationClassSignatureCaptures.at(-1)!;
  const bytes = Buffer.concat(capture.programRows.map(row => Buffer.from(row.hex, 'hex')));
  assert.deepEqual(encodeProgram(capture.source), bytes);
  const decoded = decodeProgram(bytes, new NameTable(), { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(encodeProgram(decoded.text), bytes);
  // Live evidence differs from the earlier owner-only dependency assumption.
  // Preserve this discrepancy; do not call references: [] an artifact golden.
  assert.equal(capture.names[1].NAMENUM, 2);
  assert.equal(capture.names[1].RECNAME, 'PACKAGE');
  assert.equal(capture.names[1].REFNAME, 'TESTCLASS');
  assert.equal(capture.names[1].PACKAGEROOT, 'OU_CORPUS');
  assert.equal(capture.names[1].QUALIFYPATH, 'Utilities');
});

test('uncalibrated method signature descriptors fail explicitly', () => {
  for (const type of ['time', 'Record', 'array of string', 'string out']) {
    assert.throws(() => encodePrimitiveMethodSignature({ nameOffset: 20, slotOffset: 0, parameterTypes: [type] }), /Unsupported Application Class signature type/);
  }
});
