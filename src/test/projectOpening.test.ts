import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { isMissingProjectDefinition, missingProjectDefinitionMessage, singularLabel } from '../model/projectOpening.js';
import { ProviderError } from '../providers/provider.js';

test('recognizes explicit missing-definition reports from database readers', () => {
  for (const message of ['No page named JOB_DATA.', 'No HTML definition named X.4.',
    'No PeopleCode program found for JOB.EMPLID.FieldChange.', 'AE has no section MAIN.',
    'Integration Broker definition not found.']) {
    assert.equal(isMissingProjectDefinition(new ProviderError(message)), true, message);
  }
});

test('does not hide unrelated failures or selectively omitted export definitions', () => {
  for (const error of [new Error('No page named JOB_DATA.'), new ProviderError('ORA-00942: table or view does not exist'),
    new ProviderError('Permission denied.'), new ProviderError('HCDEV is not connected.'),
    new ProviderError('X is in this project, but the export does not carry its definition.'), undefined]) {
    assert.equal(isMissingProjectDefinition(error), false);
  }
});

test('message identifies the definition, connection, project and removal location', () => {
  assert.equal(missingProjectDefinitionMessage(makeKey(DefinitionType.Record, 'JOB'), 'HCDEV', 'MY_PROJECT'),
    'Record JOB no longer exists in HCDEV. It is still listed in project MY_PROJECT. ' +
    'You can remove it from the project in Application Designer.');
});

test('type labels read in the singular, irregular plurals included', () => {
  assert.deepEqual(['Pages', 'Queries', 'Application Classes', 'Business Processes', 'Activities', 'Indexes', 'Message Catalog Entries', 'Record PeopleCode', 'XSLT', 'Translate Values']
    .map(singularLabel), ['Page', 'Query', 'Application Class', 'Business Process', 'Activity', 'Index', 'Message Catalog Entry', 'Record PeopleCode', 'XSLT', 'Translate Value']);
});
