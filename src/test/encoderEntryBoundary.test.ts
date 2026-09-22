import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { entryBoundaryCaptures } from './fixtures/entryBoundaryPeopleCode.js';

for (const capture of entryBoundaryCaptures) {
  test(`no invented Local boundary: ${Object.values(capture.key).filter(v => typeof v === 'string' && v !== ' ').join('.')}`, () => {
    const context = capture.key.OBJECTID1 === 1 && capture.key.OBJECTID2 === 2
      ? { owner: { recordName: capture.key.OBJECTVALUE1, fieldName: capture.key.OBJECTVALUE2 } } : {};
    const expected = Buffer.concat(capture.programRows.map(row => Buffer.from(row.hex, 'hex')));
    assert.deepEqual(encodeProgramArtifacts(capture.source, context).program, expected);
    const names = new NameTable();
    for (const row of capture.names) names.add(row.NAMENUM, [row.RECNAME.trim(), row.REFNAME.trim()].filter(Boolean).join('.'));
    const decoded = decodeProgram(expected, names);
    assert.equal(decoded.unknownOpcodes.length, 0);
    assert.deepEqual(encodeProgramArtifacts(decoded.text, context).program, expected);
  });
}
