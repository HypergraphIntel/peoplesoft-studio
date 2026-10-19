import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { projectItemFor, projectItemIdentity } from '../model/projectItems.js';
import { relatedDefinitions, sqlReferences, messageReferences, type RelatedLookup } from '../model/projectClosure.js';

/*
 * A build put ZZ_BENEFITS and ZZ_BNV_RUN_CMP into ZZ_BENEFITS as single items; the
 * developer added 42 more by hand in App Designer. These rows are what App Designer
 * wrote there (component PeopleCode, process definition) or what every delivered
 * HRDMO project uses for the type -- one layout each, over hundreds to thousands of rows.
 */

test('the new project item layouts reproduce App Designer\'s own rows', () => {
  // ZZ_BENEFITS, inserted by App Designer.
  assert.deepEqual(projectItemFor({ type: DefinitionType.ComponentPeopleCode, parts: ['ZZ_BNV_RUN_CMP', 'GBL', 'PostBuild'] }),
    { objectType: 46, objectIds: [10, 39, 12], objectValues: ['ZZ_BNV_RUN_CMP', 'GBL', 'PostBuild'] });
  assert.deepEqual(projectItemFor({ type: DefinitionType.ComponentRecordFieldPeopleCode, parts: ['ZZ_BNV_RUN_CMP', 'GBL', 'ZZ_BNV_RUNCTL', 'ZZ_BNV_FILETYPE', 'FieldChange'] }),
    { objectType: 48, objectIds: [10, 39, 1, 2], objectValues: ['ZZ_BNV_RUN_CMP', 'GBL', 'ZZ_BNV_RUNCTL', 'ZZ_BNV_FILETYPE   FieldChange'] });
  assert.deepEqual(projectItemFor({ type: DefinitionType.ProcessDefinition, parts: ['Application Engine', 'ZZ_BENEFITS'] }),
    { objectType: 20, objectIds: [29, 28], objectValues: ['Application Engine', 'ZZ_BENEFITS'] });
  // Delivered projects: 9,596 / 1,781 / 488 / 7,358 rows, one layout each.
  assert.deepEqual(projectItemFor({ type: DefinitionType.TranslateValue, parts: ['GPIT_DM10_CRIT1', 'E', '1900-01-01'] }),
    { objectType: 4, objectIds: [6, 22, 21], objectValues: ['GPIT_DM10_CRIT1', 'E', '1900-01-01'] });
  assert.deepEqual(projectItemFor({ type: DefinitionType.PagePeopleCode, parts: ['GPIT_CUD_RUNCTL', 'Activate'] }),
    { objectType: 44, objectIds: [9, 12], objectValues: ['GPIT_CUD_RUNCTL', 'Activate'] });
  assert.deepEqual(projectItemFor({ type: DefinitionType.ComponentRecordPeopleCode, parts: ['GPIT_ADDPRO_TABLE', 'GBL', 'STATE_TBL', 'SearchInit'] }),
    { objectType: 47, objectIds: [10, 39, 1, 12], objectValues: ['GPIT_ADDPRO_TABLE', 'GBL', 'STATE_TBL', 'SearchInit'] });
  assert.deepEqual(projectItemFor({ type: DefinitionType.PortalRegistry, parts: ['EMPLOYEE', 'C', 'HC_GPIT_ANF_EE_GBL'] }),
    { objectType: 55, objectIds: [99, 100, 101], objectValues: ['EMPLOYEE', 'C', 'HC_GPIT_ANF_EE_GBL'] });
  // An App Engine SQL statement is a SQL definition of SQLTYPE 1.
  assert.deepEqual(projectItemFor({ type: DefinitionType.SqlDefinition, parts: ['ZZ_BENEFITS B_BIO   INSBIO  S', '1'] }),
    { objectType: 30, objectIds: [65, 81], objectValues: ['ZZ_BENEFITS B_BIO   INSBIO  S', '1'] });
});

test('a Message Catalog entry is the row App Designer wrote: set and number unpadded, two slots', () => {
  // ZZ_BENEFITS version 113: Insert > Definitions into Project, set 25500, Select All, Save Project.
  assert.deepEqual(projectItemFor({ type: DefinitionType.MessageCatalog, parts: ['25500', '10'] }),
    { objectType: 25, objectIds: [48, 49], objectValues: ['25500', '10'] });
  // A delivered row listed with its set description names the same item.
  assert.equal(projectItemIdentity({ type: DefinitionType.MessageCatalog, parts: ['102', '67', 'International Messages'] }),
    projectItemIdentity({ type: DefinitionType.MessageCatalog, parts: ['102', '67'] }));
  assert.throws(() => projectItemFor({ type: DefinitionType.MessageCatalog, parts: ['25500'] }), /message set number, message number/);
});

test('a packed key from a listing and an unpacked one name the same project item', () => {
  const packed: DefinitionKey = { type: DefinitionType.ComponentRecordFieldPeopleCode, parts: ['ZZ_BNV_RUN_CMP', 'GBL', 'ZZ_BNV_RUNCTL', 'ZZ_BNV_FILETYPE   FieldChange'] };
  const unpacked: DefinitionKey = { type: DefinitionType.ComponentRecordFieldPeopleCode, parts: ['ZZ_BNV_RUN_CMP', 'GBL', 'ZZ_BNV_RUNCTL', 'ZZ_BNV_FILETYPE', 'FieldChange'] };
  assert.equal(projectItemIdentity(packed), projectItemIdentity(unpacked));
  const aePacked: DefinitionKey = { type: DefinitionType.AppEnginePeopleCode, parts: ['ZZ_BENEFITS', 'CENSUS  GBLdefault  1900-01-01', 'WRITE', 'OnExecute'] };
  const aeUnpacked: DefinitionKey = { type: DefinitionType.AppEnginePeopleCode, parts: ['ZZ_BENEFITS', 'CENSUS', 'GBL', 'default', '1900-01-01', 'WRITE', 'OnExecute'] };
  assert.equal(projectItemIdentity(aePacked), projectItemIdentity(aeUnpacked));
});

test('code references: SQL.NAME, %SQL(NAME) and MessageBox set/number, comments ignored', () => {
  assert.deepEqual(sqlReferences('SQLExec(SQL.ZZ_BNV_PAYCAL2, &a); /* SQL.NOT_THIS */ %SQL(ZZ_BNV_CENSUS, X)'), ['ZZ_BNV_CENSUS', 'ZZ_BNV_PAYCAL2']);
  assert.deepEqual(messageReferences('MessageBox(0, "", 25500, 9, "x"); MessageBox(0, "", 25500, 20, "y"); MessageBox(0, "", 25500, 9, "z");'),
    [{ set: 25500, number: 9 }, { set: 25500, number: 20 }]);
  assert.deepEqual(messageReferences('MessageBox(0, "", 0, 0, "accepted=3"); MessageBox(0, "", 25500, 9, "real dependency");'), [{ set: 25500, number: 9 }]);
});

test('the closure finds what each member needs and skips what is already a member', async () => {
  const lookup: RelatedLookup = {
    appEngine: async (p) => p === 'ZZ_BENEFITS' ? {
      sections: ['MAIN', 'INIT'],
      statementSqlIds: ['ZZ_BENEFITS INIT    GETRC   S'],
      peopleCode: [{ type: DefinitionType.AppEnginePeopleCode, parts: ['ZZ_BENEFITS', 'INIT', 'GBL', 'default', '1900-01-01', 'SETUP', 'OnExecute'] }],
      text: 'SQLExec(SQL.ZZ_BNV_PAYCAL2, &a, &b); &c = CreateSQL(SQL.PSDELIVERED); MessageBox(0, "", 25500, 20, "No payroll.");'
    } : undefined,
    component: async () => ({ peopleCode: [{ type: DefinitionType.ComponentPeopleCode, parts: ['ZZ_BNV_RUN_CMP', 'GBL', 'PostBuild'] }], pages: ['ZZ_BNV_RUN_PNL'] }),
    pagePeopleCode: async () => [],
    recordPeopleCode: async () => [],
    translateValues: async (f) => (f === 'ZZ_BNV_MODE' ? [{ value: 'C', effdt: '1900-01-01' }, { value: 'F', effdt: '1900-01-01' }] : []),
    classSource: async () => undefined,
    sqlObject: async (id) => (id === 'ZZ_BNV_PAYCAL2' ? { delivered: false } : id === 'PSDELIVERED' ? { delivered: true } : undefined),
    contentReferences: async () => [{ portal: 'EMPLOYEE', refType: 'C', name: 'ZZ_BNV_RUN_CREF', folders: ['ZZ_BNV_INTERFACES'] }]
  };
  const members: DefinitionKey[] = [
    { type: DefinitionType.AppEngineProgram, parts: ['ZZ_BENEFITS'] },
    { type: DefinitionType.Component, parts: ['ZZ_BNV_RUN_CMP', 'GBL'] },
    { type: DefinitionType.Field, parts: ['ZZ_BNV_MODE'] },
    // Already a member, in the packed form a listing gives: must not come back.
    { type: DefinitionType.AppEngineSection, parts: ['ZZ_BENEFITS', 'MAIN'] },
    { type: DefinitionType.Page, parts: ['ZZ_BNV_RUN_PNL'] }
  ];
  const got = await relatedDefinitions(members, lookup);
  const names = got.map((r) => `${r.key.type}:${r.key.parts.join('.')}${r.addable ? '' : ' (manual)'}`).sort();
  assert.deepEqual(names, [
    '25:25500.20',
    '30:ZZ_BENEFITS INIT    GETRC   S.1',
    '30:ZZ_BNV_PAYCAL2.0',
    '34:ZZ_BENEFITS.INIT',
    '4:ZZ_BNV_MODE.C.1900-01-01',
    '4:ZZ_BNV_MODE.F.1900-01-01',
    '43:ZZ_BENEFITS.INIT.GBL.default.1900-01-01.SETUP.OnExecute',
    '46:ZZ_BNV_RUN_CMP.GBL.PostBuild',
    '55:EMPLOYEE.C.ZZ_BNV_RUN_CREF',
    '55:EMPLOYEE.F.ZZ_BNV_INTERFACES'
  ].sort());
  // A delivered SQL object is already in every target: never carried.
  assert.ok(!names.some((n) => n.includes('PSDELIVERED')));
  // Everything the closure names can now be added.
  assert.ok(got.every((r) => r.addable));
});
