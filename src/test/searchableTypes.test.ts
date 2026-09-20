import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { OracleProvider } from '../providers/oracle.js';
import { ProjectFileProvider } from '../providers/projectFile.js';
import { DefinitionType, typeLabel } from '../model/definitions.js';

const FIXTURE = path.join(
  __dirname, '..', '..', 'src', 'test', 'fixtures', 'sample-project.xml');

test('a project is a searchable type, so it can be opened by name', () => {
  // Connecting to a database must not list its projects; the only way one
  // reaches the tree is by being searched for and opened.
  const oracle = new OracleProvider({
    name: 'DEV', connectString: 'h:1521/X', user: 'SYSADM', password: ''
  });
  assert.ok(oracle.searchableTypes.includes(DefinitionType.Project));
  assert.equal(typeLabel(DefinitionType.Project), 'Projects');
});

test('the database offers only the types it has a query for', () => {
  const oracle = new OracleProvider({
    name: 'DEV', connectString: 'h:1521/X', user: 'SYSADM', password: ''
  });
  // Offering a type with no query behind it produces a dialog that fails on
  // submit, so the list and the search switch have to agree.
  assert.ok(oracle.searchableTypes.includes(DefinitionType.Record));
  assert.ok(oracle.searchableTypes.includes(DefinitionType.Page));
  assert.ok(!oracle.searchableTypes.includes(DefinitionType.HtmlDefinition));
  assert.ok(!oracle.searchableTypes.includes(DefinitionType.ApplicationClassPeopleCode));
});

test('the database can search globally, which is what keeps it out of the trees', () => {
  const oracle = new OracleProvider({
    name: 'DEV', connectString: 'h:1521/X', user: 'SYSADM', password: ''
  });
  assert.equal(oracle.capabilities.globalSearch, true);
});

test('a project export offers only the types it actually contains', async () => {
  const p = new ProjectFileProvider(FIXTURE, 'fixture');
  await p.connect();
  const types = p.searchableTypes;
  assert.ok(types.includes(DefinitionType.Record));
  assert.ok(types.includes(DefinitionType.Field));
  assert.ok(types.includes(DefinitionType.ApplicationClassPeopleCode));
  assert.ok(types.includes(DefinitionType.Menu));
  // Nothing in the fixture is a page, so a page must not be offered.
  assert.ok(!types.includes(DefinitionType.Page));
  // Nor is the project itself an item of itself.
  assert.ok(!types.includes(DefinitionType.Project));
});

test('a project export is listed locally rather than searched globally', async () => {
  const p = new ProjectFileProvider(FIXTURE, 'fixture');
  await p.connect();
  // This is what lets the browser list an export's contents for free while
  // never listing a database.
  assert.equal(p.capabilities.globalSearch, false);
});

test('searchable types are empty before connecting', () => {
  const p = new ProjectFileProvider(FIXTURE, 'fixture');
  assert.deepEqual(p.searchableTypes, []);
});
