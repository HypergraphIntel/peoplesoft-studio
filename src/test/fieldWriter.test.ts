import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldType } from '../model/record.js';
import { fieldCreateRefusal } from '../providers/fieldWriter.js';
import { setWriteNamePrefix } from '../providers/writeScope.js';

const field = (over: Partial<Parameters<typeof fieldCreateRefusal>[0]>) => ({
  name: 'ZZ_PCODE_LAB_C09', type: FieldType.Character, length: 10, decimalPositions: 0,
  label: { id: 'ZZ_PCODE_LAB_C09', longName: 'ZZ Lab C09', shortName: 'C09' }, ...over
});

test('a field is created only as c01 shows and HRDMO bounds: any name (unless a prefix is set), known types, real lengths', () => {
  assert.equal(fieldCreateRefusal(field({})), undefined);
  assert.equal(fieldCreateRefusal(field({ name: 'EMPLID' })), undefined);
  setWriteNamePrefix('ZZ_PCODE_LAB');
  try {
    assert.match(fieldCreateRefusal(field({ name: 'EMPLID' }))!, /does not start with ZZ_PCODE_LAB/);
    assert.equal(fieldCreateRefusal(field({})), undefined);
  } finally {
    setWriteNamePrefix('');
  }
  assert.match(fieldCreateRefusal(field({ name: 'ZZ_PCODE_LAB_TOO_LONG_NAME' }))!, /at most 18/);
  assert.match(fieldCreateRefusal(field({ type: FieldType.Image }))!, /can be created/);
  assert.equal(fieldCreateRefusal(field({ type: FieldType.ImageReference, length: 30 })), undefined);
  assert.match(fieldCreateRefusal(field({ type: FieldType.ImageReference, length: 10 }))!, /30 long/);
  assert.match(fieldCreateRefusal(field({ length: 257 }))!, /1 to 256/);
  // Date, Time and DateTime have PeopleTools' fixed lengths.
  assert.equal(fieldCreateRefusal(field({ type: FieldType.Date, length: 10 })), undefined);
  assert.match(fieldCreateRefusal(field({ type: FieldType.DateTime, length: 10 }))!, /26 long/);
  assert.equal(fieldCreateRefusal(field({ type: FieldType.Number, length: 12, decimalPositions: 2 })), undefined);
  assert.match(fieldCreateRefusal(field({ type: FieldType.Number, length: 4, decimalPositions: 4 }))!, /fewer than the length/);
  assert.match(fieldCreateRefusal(field({ decimalPositions: 1 }))!, /Only number fields/);
  assert.equal(fieldCreateRefusal(field({ type: FieldType.LongCharacter, length: 0 })), undefined);
  assert.match(fieldCreateRefusal(field({ label: { id: 'ZZ_PCODE_LAB_C09', longName: 'x'.repeat(31), shortName: 'C09' } }))!, /long name/);
});

test('a subpackage\'s QUALIFYPATH: ":" at level 1, its parent\'s ID at level 2 (HRDMO: ADS_DMW:UI:Widgets is "UI")', async () => {
  const { packageQualifyPath } = await import('../providers/peopleCodeWriter.js');
  assert.equal(packageQualifyPath(['SUB1'], 1), ':');
  assert.equal(packageQualifyPath(['UI', 'Widgets'], 2), 'UI');
});
