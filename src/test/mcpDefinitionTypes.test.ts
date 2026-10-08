import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseProvider } from '../providers/database.js';
import { DefinitionType, TYPE_LABELS, isPeopleCode } from '../model/definitions.js';
import { PEOPLECODE_OBJECTIDS, peopleCodeKeyFromValues, peopleCodeTypeOf } from '../model/peopleCodeKeys.js';
import { DEFINITION_TYPE_GUIDE, typeCodeSummary } from '../mcp/definitionTypes.js';

const oracle = new DatabaseProvider({ name: 'DEV', platform: 'oracle', connectString: 'h:1521/X', user: 'SYSADM', password: '' });

test('every PSPCMPROG key shape on HRDMO names one kind of PeopleCode', () => {
  assert.equal(peopleCodeTypeOf([1, 2, 12]), DefinitionType.RecordPeopleCode);
  assert.equal(peopleCodeTypeOf([10, 39, 1, 2, 12]), DefinitionType.ComponentRecordFieldPeopleCode);
  assert.equal(peopleCodeTypeOf([66, 77, 39, 20, 21, 78, 12]), DefinitionType.AppEnginePeopleCode);
  assert.equal(peopleCodeTypeOf([9, 12]), DefinitionType.PagePeopleCode);
  assert.equal(peopleCodeTypeOf([10, 39, 1, 12]), DefinitionType.ComponentRecordPeopleCode);
  assert.equal(peopleCodeTypeOf([10, 39, 12]), DefinitionType.ComponentPeopleCode);
  assert.equal(peopleCodeTypeOf([3, 4, 5, 12]), DefinitionType.MenuPeopleCode);
  // An Application Class at any package depth.
  assert.equal(peopleCodeTypeOf([104, 107, 12]), DefinitionType.ApplicationClassPeopleCode);
  assert.equal(peopleCodeTypeOf([104, 105, 106, 107, 12]), DefinitionType.ApplicationClassPeopleCode);
  // Message PeopleCode (60 87 12) is not a type yet.
  assert.equal(peopleCodeTypeOf([60, 87, 12]), undefined);
});

test('an Application Class is keyed without its OnExecute, as projects name it', () => {
  assert.deepEqual(peopleCodeKeyFromValues(DefinitionType.ApplicationClassPeopleCode, ['HR_DIRECT_REPORTS', 'DirectReports', 'OnExecute']),
    ['HR_DIRECT_REPORTS', 'DirectReports']);
  assert.deepEqual(peopleCodeKeyFromValues(DefinitionType.RecordPeopleCode, ['JOB', 'ACTION', 'FieldChange']), ['JOB', 'ACTION', 'FieldChange']);
});

test('the MCP type guide lists each type once, with a label and key parts', () => {
  const seen = new Set<DefinitionType>();
  for (const guide of DEFINITION_TYPE_GUIDE) {
    assert.ok(!seen.has(guide.type), `${guide.type} listed twice`);
    seen.add(guide.type);
    assert.ok(TYPE_LABELS[guide.type], `${guide.type} has no label`);
    assert.ok(guide.keyParts.length > 0);
  }
  assert.match(typeCodeSummary(), /^-2 Projects, 0 Records, 2 Fields, /);
  assert.match(typeCodeSummary(), /33 App Engine Programs/);
});

test('the guide and the database agree on what can be searched', () => {
  for (const type of oracle.searchableTypes) {
    assert.ok(DEFINITION_TYPE_GUIDE.some((g) => g.type === type && g.databaseSearch), `${type} searchable but not in the guide`);
  }
  for (const guide of DEFINITION_TYPE_GUIDE.filter((g) => g.databaseSearch)) {
    const searchable = oracle.searchableTypes.includes(guide.type)
      || (isPeopleCode(guide.type) && (guide.type === DefinitionType.ApplicationClassPeopleCode || PEOPLECODE_OBJECTIDS[guide.type] !== undefined));
    assert.ok(searchable, `${guide.type} said to be searchable`);
  }
});

test('Message Catalog entries and App Engine sections can be searched', () => {
  assert.ok(oracle.searchableTypes.includes(DefinitionType.MessageCatalog));
  assert.ok(oracle.searchableTypes.includes(DefinitionType.AppEngineSection));
});

test('a kind of PeopleCode with no key shape is refused, not guessed at', async () => {
  await assert.rejects(oracle.search({ type: DefinitionType.FileLayoutPeopleCode, namePattern: 'X' }), /does not support/);
});
