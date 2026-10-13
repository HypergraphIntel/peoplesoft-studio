import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType } from '../model/definitions.js';
import { FieldType } from '../model/record.js';
import { definitionHoverMarkdown, fieldHoverMarkdown } from '../peoplecode/hoverText.js';
import type { FieldDefinition } from '../model/fieldDefinition.js';

const field = (over: Partial<FieldDefinition>): FieldDefinition => ({
  name: 'EMPLID', type: FieldType.Character, length: 11, decimalPositions: 0,
  labels: [{ id: 'EMPLID', longName: 'Employee ID', shortName: 'EmplID', isDefault: true }], ...over
});

test('a character field hovers with its type, length and default label', () => {
  const md = fieldHoverMarkdown(field({}));
  assert.match(md, /\*\*EMPLID\*\*/);
  assert.match(md, /Character/);
  assert.match(md, /length 11/);
  assert.match(md, /Employee ID/);
});

test('a number field shows its decimals', () => {
  const md = fieldHoverMarkdown(field({ name: 'COMPRATE', type: FieldType.Number, length: 18, decimalPositions: 6, labels: [] }));
  assert.match(md, /length 18 \(6 decimals\)/);
});

test('a field with no length omits the length clause', () => {
  const md = fieldHoverMarkdown(field({ name: 'DESCRLONG', type: FieldType.LongCharacter, length: 0, decimalPositions: 0, labels: [] }));
  assert.doesNotMatch(md, /length/);
});

test('the default label is preferred over the first', () => {
  const md = fieldHoverMarkdown(field({ labels: [
    { id: 'A', longName: 'First Label', shortName: 'A', isDefault: false },
    { id: 'B', longName: 'The Default', shortName: 'B', isDefault: true }
  ] }));
  assert.match(md, /The Default/);
  assert.doesNotMatch(md, /First Label/);
});

test('a definition hover shows name, type label, description and last-updated', () => {
  const md = definitionHoverMarkdown({
    displayName: 'JOB', type: DefinitionType.Record, description: 'Job Data',
    lastUpdated: '2026-10-13', lastUpdatedBy: 'JARED'
  });
  assert.match(md, /\*\*JOB\*\* — Records/);
  assert.match(md, /Job Data/);
  assert.match(md, /_Last updated 2026-10-13 by JARED_/);
});

test('a definition hover omits the trailer when nothing is known', () => {
  const md = definitionHoverMarkdown({ displayName: 'ZZ_PCODE_LAB:ORDERING:PARENT', type: DefinitionType.ApplicationClassPeopleCode });
  assert.match(md, /Application Class/);
  assert.doesNotMatch(md, /Last updated/);
});
