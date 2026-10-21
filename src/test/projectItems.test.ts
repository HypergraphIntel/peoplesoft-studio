import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { DefinitionType, makeKey } from '../model/definitions.js';
import {
  canInsertIntoProject, itemKeyColumns, PROJECT_ITEM_DEFAULTS, projectItemFor, ProjectSaveRefusedError
} from '../model/projectItems.js';

const item = (type: DefinitionType, ...parts: string[]) => projectItemFor(makeKey(type, ...parts));
const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');

test('the row App Designer inserted for a field (case p01) is the row planned for it', (t) => {
  const delta = path.join(RESULTS, 'p01-insert-field', 'delta.json');
  if (!existsSync(delta)) return t.skip('case p01 is not present');
  const d = JSON.parse(readFileSync(delta, 'utf8'));
  const [stored] = d.otherTables.PSPROJECTITEM.inserted as Record<string, string>[];
  const planned = {
    PROJECTNAME: 'ZZ_PCODE_LAB_01',
    OBJECTTYPE: 2,
    ...itemKeyColumns(item(DefinitionType.Field, 'ZZ_PCODE_LAB_C02'), 4),
    ...PROJECT_ITEM_DEFAULTS
  };
  assert.deepEqual(Object.fromEntries(Object.entries(planned).map(([k, v]) => [k, String(v)])), stored);
});

test('each type takes the layout HRDMO\'s own project items use', () => {
  assert.deepEqual(item(DefinitionType.Record, 'JOB'), { objectType: 0, objectIds: [1], objectValues: ['JOB'] });
  assert.deepEqual(item(DefinitionType.UrlDefinition, 'ZZ_URL'), { objectType: 56, objectIds: [103], objectValues: ['ZZ_URL'] });
  // A field under a record is still the field.
  assert.deepEqual(item(DefinitionType.Field, 'EMPLID', 'JOB'), { objectType: 2, objectIds: [6], objectValues: ['EMPLID'] });
  assert.deepEqual(item(DefinitionType.Page, 'JOB_DATA1'), { objectType: 5, objectIds: [9], objectValues: ['JOB_DATA1'] });
  assert.deepEqual(item(DefinitionType.Menu, 'M'), { objectType: 6, objectIds: [3], objectValues: ['M'] });
  assert.deepEqual(item(DefinitionType.Component, 'JOB_DATA'), { objectType: 7, objectIds: [10, 39], objectValues: ['JOB_DATA', 'GBL'] });
  assert.deepEqual(item(DefinitionType.RecordPeopleCode, 'ZZ_PCODE_LAB', 'ZZ_PCODE_LAB_C01', 'FieldChange'),
    { objectType: 8, objectIds: [1, 2, 12], objectValues: ['ZZ_PCODE_LAB', 'ZZ_PCODE_LAB_C01', 'FieldChange'] });
  assert.deepEqual(item(DefinitionType.AppEngineProgram, 'AECLEANUP'), { objectType: 33, objectIds: [66], objectValues: ['AECLEANUP'] });
  assert.deepEqual(item(DefinitionType.HtmlDefinition, 'ACE_SS1', '4'), { objectType: 51, objectIds: [90, 95], objectValues: ['ACE_SS1', '4'] });
  assert.deepEqual(item(DefinitionType.SqlDefinition, 'MY_SQL'), { objectType: 30, objectIds: [65, 81], objectValues: ['MY_SQL', '0'] });
  assert.deepEqual(item(DefinitionType.ApplicationPackage, 'ZZ_PCODE_LAB'),
    { objectType: 57, objectIds: [104, 116, 117], objectValues: ['ZZ_PCODE_LAB', 'ZZ_PCODE_LAB', '.'] });
  assert.deepEqual(item(DefinitionType.ApplicationPackage, 'SUPPORT', 'ZZ_PCODE_LAB', ':'),
    { objectType: 57, objectIds: [104, 116, 117], objectValues: ['SUPPORT', 'ZZ_PCODE_LAB', ':'] });
});

test('application classes carry no OnExecute and take 105 / 106 for sub-packages', () => {
  assert.deepEqual(item(DefinitionType.ApplicationClassPeopleCode, 'ADSM', 'ADSCompareDiffObject', 'OnExecute'),
    { objectType: 58, objectIds: [104, 107], objectValues: ['ADSM', 'ADSCompareDiffObject'] });
  assert.deepEqual(item(DefinitionType.ApplicationClassPeopleCode, 'ZZ_PCODE_LAB', 'SUPPORT', 'SmokeTest'),
    { objectType: 58, objectIds: [104, 105, 107], objectValues: ['ZZ_PCODE_LAB', 'SUPPORT', 'SmokeTest'] });
  assert.deepEqual(item(DefinitionType.ApplicationClassPeopleCode, 'ADS_DMW', 'UI', 'Widgets', 'Checkbox', 'OnExecute').objectIds,
    [104, 105, 106, 107]);
  assert.throws(() => item(DefinitionType.ApplicationClassPeopleCode, 'A', 'B', 'C', 'D', 'E'), ProjectSaveRefusedError);
});

test('types without a known layout, and malformed keys, are refused', () => {
  assert.equal(canInsertIntoProject(DefinitionType.Project), false);
  assert.throws(() => item(DefinitionType.Project, 'P'), /cannot be inserted/);
  assert.throws(() => item(DefinitionType.RecordPeopleCode, 'REC', 'FIELD'), /record.field.event/);
  assert.throws(() => item(DefinitionType.HtmlDefinition, 'X'), /content type/);
});

test('key columns are padded to the table\'s slots, and a longer key is refused', () => {
  assert.deepEqual(itemKeyColumns(item(DefinitionType.Component, 'C'), 4), {
    OBJECTID1: 10, OBJECTVALUE1: 'C', OBJECTID2: 39, OBJECTVALUE2: 'GBL',
    OBJECTID3: 0, OBJECTVALUE3: ' ', OBJECTID4: 0, OBJECTVALUE4: ' '
  });
  assert.equal(Object.keys(itemKeyColumns(item(DefinitionType.Record, 'R'), 7)).length, 14);
  assert.throws(() => itemKeyColumns(item(DefinitionType.RecordPeopleCode, 'R', 'F', 'E'), 2), /2 key slots/);
});

test('a project save plans one item per added definition and refuses what it cannot save', async () => {
  const { planProjectSave } = await import('../providers/projectWriter.js');
  const base = { project: 'ZZ_PCODE_LAB_01', operatorId: 'JARED' };
  assert.deepEqual(planProjectSave({ ...base, add: [makeKey(DefinitionType.Field, 'A'), makeKey(DefinitionType.Record, 'A')] })
    .map((i) => i.objectType), [2, 0]);
  assert.throws(() => planProjectSave({ ...base, add: [] }), /Nothing to save/);
  // A field under a record and the bare field are the same item.
  assert.throws(() => planProjectSave({ ...base, add: [makeKey(DefinitionType.Field, 'A'), makeKey(DefinitionType.Field, 'A', 'REC')] }),
    /listed twice/);
  assert.throws(() => planProjectSave({ ...base, add: [makeKey(DefinitionType.Project, 'P')] }), ProjectSaveRefusedError);
});

test('AE section and PeopleCode project members use the observed HRDMO layouts and packed variant key',()=>{
 const section={type:DefinitionType.AppEngineSection,parts:['ZZ_MCP_AE','MAIN']};
 assert.deepEqual(projectItemFor(section),{objectType:34,objectIds:[66,77],objectValues:['ZZ_MCP_AE','MAIN']});
 const parts=['ZZ_MCP_AE','MAIN','GBL','default','1900-01-01','Step02','OnExecute'];
 const item=projectItemFor({type:DefinitionType.AppEnginePeopleCode,parts});
 assert.deepEqual(item,{objectType:43,objectIds:[66,77,78,12],objectValues:['ZZ_MCP_AE','MAIN    GBLdefault  1900-01-01','Step02','OnExecute']});
 assert.deepEqual(projectItemFor({type:DefinitionType.AppEnginePeopleCode,parts:item.objectValues}),item);
 assert.equal(canInsertIntoProject(DefinitionType.AppEngineSection),true);
 assert.equal(canInsertIntoProject(DefinitionType.AppEnginePeopleCode),true);
});


test('AE project keys normalize the API platform label to its native PeopleCode key',()=>{
 const item=projectItemFor({type:DefinitionType.AppEnginePeopleCode,parts:['ZZ_AE','ORACLE','GBL','Oracle','2000-01-01','Pc','OnExecute']});
 assert.equal(item.objectValues[1],'ORACLE  GBLORACLE   2000-01-01');
});

test('native Query membership preserves its blank public owner and distinct private owner',()=>{
  assert.equal(canInsertIntoProject(DefinitionType.Query),true);
  assert.deepEqual(item(DefinitionType.Query,'ZZ_QRY'),{objectType:10,objectIds:[30,25],objectValues:['ZZ_QRY',' ']});
  assert.deepEqual(item(DefinitionType.Query,'ZZ_QRY','JARED'),{objectType:10,objectIds:[30,25],objectValues:['ZZ_QRY','JARED']});
  assert.throws(()=>item(DefinitionType.Query,'ZZ_QRY','JARED','EXTRA'),/optional private owner/);
});
