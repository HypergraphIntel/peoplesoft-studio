import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { buildProperties, hasProperties, PROPERTIES_SPECS } from '../model/properties.js';
import { escapeHtml, renderPropertiesHtml } from '../editors/propertiesHtml.js';
import { definitionContextValue } from '../views/contextValue.js';

const section = (p: ReturnType<typeof buildProperties>, title: string) =>
  Object.fromEntries(p.sections.find((s) => s.title === title)!.items.map((i) => [i.label, i.value]));

test('the eleven App Designer types with a Properties dialog have a panel; PeopleCode has none', () => {
  for (const t of [
    DefinitionType.ApplicationPackage, DefinitionType.Record, DefinitionType.Field, DefinitionType.Component,
    DefinitionType.Page, DefinitionType.Project, DefinitionType.Menu, DefinitionType.AppEngineProgram,
    DefinitionType.SqlDefinition, DefinitionType.HtmlDefinition, DefinitionType.StyleSheet
  ]) assert.ok(hasProperties(t), String(t));
  assert.equal(Object.keys(PROPERTIES_SPECS).length, 11);
  assert.equal(hasProperties(DefinitionType.RecordPeopleCode), false);
});

test('a record: General from its row, record type named, blanks blank, every column kept', () => {
  const row = {
    RECNAME: 'JOB', RECTYPE: 0, RECDESCR: 'EE Job History', DESCRLONG: 'Core record.\r\nSecond line',
    PARENTRECNAME: 'PER_ORG_ASGN', SQLTABLENAME: ' ', OBJECTOWNERID: 'HCR',
    LASTUPDDTTM: new Date(2019, 7, 13, 11, 31, 59), LASTUPDOPRID: 'PPLSOFT', VERSION: 1
  };
  const p = buildProperties({ key: makeKey(DefinitionType.Record, 'JOB'), row });
  assert.equal(p.name, 'JOB');
  assert.equal(p.typeLabel, 'Record');
  assert.deepEqual(section(p, 'General'), {
    Description: 'EE Job History', Comments: 'Core record.\r\nSecond line', 'Owner ID': 'HCR',
    'Last Updated': '2019-08-13 11:31:59', 'Last Updated By': 'PPLSOFT', Version: '1'
  });
  const use = section(p, 'Record Type and Use');
  assert.equal(use['Record Type'], 'SQL Table (0)');
  assert.equal(use['SQL Table Name'], '');
  assert.equal(use['Parent Record'], 'PER_ORG_ASGN');
  // Columns this row does not have are left out, not shown blank.
  assert.equal('Index Count' in use, false);
  assert.deepEqual(p.stored[0].columns.map((c) => c.label), Object.keys(row));
});

test('a code with no known name is shown as stored, not guessed', () => {
  const p = buildProperties({ key: makeKey(DefinitionType.Record, 'X'), row: { RECTYPE: 4 } });
  assert.equal(section(p, 'Record Type and Use')['Record Type'], '4');
});

test('a field is described by its default label, and lists its labels', () => {
  const p = buildProperties({
    key: makeKey(DefinitionType.Field, 'EMPLID', 'JOB'),
    row: { FIELDNAME: 'EMPLID', FIELDTYPE: 0, LENGTH: 11, DESCRLONG: 'Employee ID' },
    labels: [
      { LABEL_ID: 'EMPLID', LONGNAME: 'Empl ID', SHORTNAME: 'ID', DEFAULT_LABEL: 1 },
      { LABEL_ID: 'NOMOUSEOVER', LONGNAME: ' ', SHORTNAME: ' ', DEFAULT_LABEL: 0 }
    ]
  });
  assert.equal(p.name, 'EMPLID');
  assert.equal(section(p, 'General').Description, 'Empl ID');
  assert.equal(section(p, 'Field Type and Format')['Field Type'], 'Character (0)');
  assert.deepEqual(section(p, 'Labels'), { 'EMPLID (default)': 'Empl ID · short: ID', NOMOUSEOVER: '' });
});

test('a SQL definition takes its description from PSSQLDESCR, shown as a second stored table', () => {
  const p = buildProperties({
    key: makeKey(DefinitionType.SqlDefinition, 'ACA_SQL'),
    row: { SQLID: 'ACA_SQL', SQLTYPE: '0', VERSION: 1 },
    descriptionRow: { SQLID: 'ACA_SQL', DESCR: 'Annual', DESCRLONG: 'Comments' }
  });
  assert.equal(section(p, 'General').Description, 'Annual');
  assert.equal(section(p, 'General').Comments, 'Comments');
  assert.deepEqual(p.stored.map((s) => s.table), ['PSSQLDEFN', 'PSSQLDESCR']);
});

test('packages are found by root when searched, by full key as project items, and named by path', () => {
  const spec = PROPERTIES_SPECS[DefinitionType.ApplicationPackage]!;
  assert.deepEqual(spec.where(makeKey(DefinitionType.ApplicationPackage, 'ZZ_PCODE_LAB')),
    { PACKAGEROOT: 'ZZ_PCODE_LAB', PACKAGELEVEL: 0 });
  assert.deepEqual(spec.where(makeKey(DefinitionType.ApplicationPackage, 'SUPPORT', 'ZZ_PCODE_LAB', ':')),
    { PACKAGEID: 'SUPPORT', PACKAGEROOT: 'ZZ_PCODE_LAB', QUALIFYPATH: ':' });
  const named = (row: Record<string, unknown>) => buildProperties({ key: makeKey(DefinitionType.ApplicationPackage, 'K'), row }).name;
  assert.equal(named({ PACKAGEID: 'ZZ_PCODE_LAB', PACKAGEROOT: 'ZZ_PCODE_LAB', QUALIFYPATH: '.' }), 'ZZ_PCODE_LAB');
  assert.equal(named({ PACKAGEID: 'SUPPORT', PACKAGEROOT: 'ZZ_PCODE_LAB', QUALIFYPATH: ':' }), 'ZZ_PCODE_LAB:SUPPORT');
  assert.equal(named({ PACKAGEID: 'Names', PACKAGEROOT: 'HR', QUALIFYPATH: 'Person' }), 'HR:Person:Names');
});

test('components default to the GBL market; HTML definitions key on CONTTYPE', () => {
  assert.deepEqual(PROPERTIES_SPECS[DefinitionType.Component]!.where(makeKey(DefinitionType.Component, 'JOB_DATA')),
    { PNLGRPNAME: 'JOB_DATA', MARKET: 'GBL' });
  assert.deepEqual(PROPERTIES_SPECS[DefinitionType.HtmlDefinition]!.where(makeKey(DefinitionType.HtmlDefinition, 'ADM_OPR_NAME', '4')),
    { CONTNAME: 'ADM_OPR_NAME', CONTTYPE: 4 });
});

test('the page is static, escaped, and allows only its own style', () => {
  const p = buildProperties({
    key: makeKey(DefinitionType.Record, 'R'),
    row: { RECDESCR: '<script>alert(1)</script>', DESCRLONG: 'a & "b"' }
  });
  const html = renderPropertiesHtml(p, 'HR<DMO>', 'n0nce');
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('a &amp; &quot;b&quot;'));
  assert.ok(html.includes('HR&lt;DMO&gt;'));
  assert.ok(html.includes(`content="default-src 'none'; style-src 'nonce-n0nce';"`));
  assert.ok(html.includes('<details><summary>Stored columns: PSRECDEFN (2)</summary>'));
  assert.equal(escapeHtml(`'`), '&#39;');
});

test('tree context values: Properties, Record Field PeopleCode and Delete Record match their parts', () => {
  assert.equal(definitionContextValue(makeKey(DefinitionType.Record, 'JOB')), 'definition.properties.record');
  assert.equal(definitionContextValue(makeKey(DefinitionType.Field, 'EMPLID', 'JOB')), 'definition.properties.recordField');
  assert.equal(definitionContextValue(makeKey(DefinitionType.Field, 'EMPLID')), 'definition.properties');
  assert.equal(definitionContextValue(makeKey(DefinitionType.RecordPeopleCode, 'JOB', 'EMPLID', 'FieldChange')), 'definition');
  // package.json's Delete Record when-clause matches records only.
  const deleteRecord = /\.record$/;
  assert.ok(deleteRecord.test('definition.properties.record'));
  assert.ok(!deleteRecord.test('definition.properties.recordField'));
});
