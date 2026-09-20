import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DefinitionType, displayName, fileExtension, keyEquals, keyFromString, keyToString, makeKey
} from '../model/definitions.js';

test('makeKey drops the blank key slots PeopleTools pads with', () => {
  const key = makeKey(DefinitionType.Record, 'PSOPRDEFN', ' ', '', '  ');
  assert.deepEqual(key.parts, ['PSOPRDEFN']);
});

test('makeKey keeps blanks that sit between populated slots', () => {
  const key = makeKey(DefinitionType.RecordPeopleCode, 'JOB', ' ', 'EFFDT', 'FieldChange');
  assert.deepEqual(key.parts, ['JOB', '', 'EFFDT', 'FieldChange']);
});

test('keys round-trip through their string form', () => {
  const key = makeKey(DefinitionType.ApplicationClassPeopleCode,
    'PT_UTIL', 'Logger', 'OnExecute');
  assert.deepEqual(keyFromString(keyToString(key)), key);
});

test('key comparison ignores case, as PeopleTools names are case-insensitive', () => {
  assert.ok(keyEquals(
    makeKey(DefinitionType.Record, 'psoprdefn'),
    makeKey(DefinitionType.Record, 'PSOPRDEFN')));
});

test('key comparison distinguishes types with identical names', () => {
  assert.ok(!keyEquals(
    makeKey(DefinitionType.Record, 'JOB'),
    makeKey(DefinitionType.Page, 'JOB')));
});

test('keyFromString rejects an unknown definition type rather than inventing one', () => {
  assert.throws(() => keyFromString('9999:JOB'), /Unknown definition type/);
});

test('record PeopleCode display name hides the GBL method slot', () => {
  const key = makeKey(DefinitionType.RecordPeopleCode, 'JOB', 'GBL', 'EFFDT', 'FieldChange');
  assert.equal(displayName(key), 'JOB.EFFDT.FieldChange');
});

test('application class display name is package-qualified with colons', () => {
  const key = makeKey(DefinitionType.ApplicationClassPeopleCode,
    'PT_UTIL', 'Logger', 'OnExecute');
  assert.equal(displayName(key), 'PT_UTIL:Logger');
});

test('file extensions stay namespaced so other PeopleSoft extensions can coexist', () => {
  // jatz.peoplesoft-tools claims `.pcode` and `.ppl` for its own `peoplecode`
  // language. Colliding on those would make grammar selection depend on load
  // order, so this extension uses `.peoplecode` and `.pssql` instead.
  const collisions = ['.pcode', '.ppl'];
  for (const type of [DefinitionType.RecordPeopleCode, DefinitionType.ApplicationClassPeopleCode]) {
    assert.equal(fileExtension(type), '.peoplecode');
    assert.ok(!collisions.includes(fileExtension(type)));
  }
  assert.equal(fileExtension(DefinitionType.SqlDefinition), '.pssql');
  assert.equal(fileExtension(DefinitionType.Record), '.psrecord');
});
