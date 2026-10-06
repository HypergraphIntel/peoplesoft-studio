import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictSourceSignature } from '../peoplecode/sourceSignature.js';
import { entryBoundaryCaptures } from './fixtures/entryBoundaryPeopleCode.js';

/*
 * Cycle 185: the HASH_SIGNATURE candidate against every native save
 * available offline. These pin the candidate; they do not validate it --
 * that needs the broad read-only corpus scan (source-signature/validate.ts).
 */

test('predicts the five delivered HCDEV PSPCMTXT signatures in the fixture', () => {
  assert.equal(entryBoundaryCaptures.length, 5);
  for (const capture of entryBoundaryCaptures) {
    for (const row of capture.sourceRows) {
      assert.equal(predictSourceSignature(row.PCTEXT), row.HASH_SIGNATURE,
        `${row.OBJECTVALUE1}.${row.OBJECTVALUE2}.${row.OBJECTVALUE3}`);
    }
  }
});

// docs/CONTROLLED_COMPILE_LAB.md, Cycle 180: App Designer 8.62.09 saves on HRDMO.
const SMOKE_A = 'class SmokeTest\n   method Run();\nend-class;\n\nmethod Run\n   Local integer &x;\n   &x = 1;\nend-method;\n\n';
const SMOKE_B = 'class SmokeTest\n   method Run();\nend-class;\n\nmethod Run\n   Local string &s;\n   &s = "B";\nend-method;\n\n';

test('predicts the SMOKE A and B signatures App Designer 8.62.09 wrote on HRDMO', () => {
  assert.equal(predictSourceSignature(SMOKE_A), '05Q8EHhRDJ3561gQ3yAJRCqYGO0A');
  assert.equal(predictSourceSignature(SMOKE_B), 'STHoS1JCaG+SsgCiyQkdkOIDu08A');
});

test('the text is hashed exactly as stored', () => {
  // App Designer's trailing blank line and LF endings are part of the input.
  assert.notEqual(predictSourceSignature(SMOKE_A.trimEnd() + '\n'), '05Q8EHhRDJ3561gQ3yAJRCqYGO0A');
  assert.notEqual(predictSourceSignature(SMOKE_A.replace(/\n/g, '\r\n')), '05Q8EHhRDJ3561gQ3yAJRCqYGO0A');
  // 20-byte SHA-1 plus a NUL: 28 base64 characters, always ending in "A".
  assert.match(predictSourceSignature(''), /^[A-Za-z0-9+/]{27}A$/);
});
