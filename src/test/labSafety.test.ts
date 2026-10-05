import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCRATCH_LIKE,
  auditChangeCount,
  diffAudit,
  isScratchName,
  splitDmsStatements,
  validateScratchCleanupDms,
  validateScratchProjectXml
} from '../peoplecode/corpus/labSafety.js';

/*
 * Cycle 179: write-safety interlocks. Cycle 178's -PJFF import wrote a
 * delivered program through a blob's embedded identity; these checks run
 * before any lab write.
 */

test('the scratch namespace is exactly ZZ_PCODE_LAB, never ZZ%', () => {
  for (const name of ['ZZ_PCODE_LAB', 'ZZ_PCODE_LAB_D1', 'zz_pcode_lab', ' ZZ_PCODE_LAB ']) assert.equal(isScratchName(name), true, name);
  for (const name of ['ZZ_PAY_ACCT', 'APPS_RLR', 'ZZ', 'ZZXPCODEXLAB', '', 'PTNUI']) assert.equal(isScratchName(name), false, name);
  assert.equal(isScratchName(undefined), false);
  assert.match(SCRATCH_LIKE, /ZZ\\_PCODE\\_LAB%' ESCAPE/);
});

const pjm = (project: string, items: Array<[number, string[]]>) => `<instance class="PJM">
    <rowset name="PjmDefn" size="3288" count="1">
      <row>
        <szProjectName>${project}</szProjectName>
        <lpPit> POINTER
          <rowset name="PjmPit" size="${856 * items.length}" count="${items.length}">
${items.map(([type, values]) => `            <row>
              <eObjectType>${type}</eObjectType>
${[0, 1, 2, 3].map(i => `              <szObjectValue_${i}>${values[i] ?? ''}</szObjectValue_${i}>`).join('\n')}
            </row>`).join('\n')}
          </rowset>
        </lpPit>
      </row>
    </rowset>
  </instance>`;
const apm = (root: string, id: string, classRoot = root) => `<instance class="APM">
    <rowset name="ApmDefn" size="968" count="1">
      <row>
        <szPackageId>${id}</szPackageId>
        <szPackageRoot>${root}</szPackageRoot>
        <ApmClassKey.szClassId>SmokeTest</ApmClassKey.szClassId>
        <ApmClassKey.szPackageRoot>${classRoot}</ApmClassKey.szPackageRoot>
      </row>
    </rowset>
  </instance>`;
const pcm = (root: string, { blob = '', pnt = false, id0 = 104, names = 0 } = {}) => `<instance class="PCM">
    <rowset name="PcmProg" size="2240" count="1">
      <row>
        <eObjectID_0>${id0}</eObjectID_0>
        <szObjectValue_0>${root}</szObjectValue_0>
        <eObjectID_1>105</eObjectID_1>
        <szObjectValue_1>SUPPORT</szObjectValue_1>
        <eObjectID_2>107</eObjectID_2>
        <szObjectValue_2>SmokeTest</szObjectValue_2>
        <nNameCount>${names}</nNameCount>
        <lpPnt>${pnt ? ' POINTER\n          <rowset name="PcmPnt" size="534" count="1"><row><szRecName>PACKAGE</szRecName></row></rowset>\n        ' : 'POINTER'}</lpPnt>
      </row>
    </rowset>
    <peoplecode_text>class SmokeTest
end-class;
</peoplecode_text>
    <peoplecode_blob>${blob}</peoplecode_blob>
  </instance>`;
const file = (...instances: string[]) => `<?xml version='1.0'?>\n  <!--Warning : Don't edit this file -->\n  ${instances.join('\n  ')}\n`;

const goodItems: Array<[number, string[]]> = [[57, ['SUPPORT', 'ZZ_PCODE_LAB', ':']], [57, ['ZZ_PCODE_LAB', 'ZZ_PCODE_LAB', '.']], [58, ['ZZ_PCODE_LAB', 'SUPPORT', 'SmokeTest']]];

test('a scratch-only, source-only project file passes', () => {
  const result = validateScratchProjectXml(file(pjm('ZZ_PCODE_LAB', goodItems), apm('ZZ_PCODE_LAB', 'SUPPORT'), apm('ZZ_PCODE_LAB', 'ZZ_PCODE_LAB'), pcm('ZZ_PCODE_LAB')));
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
  assert.ok(result.identities.includes('peoplecode ZZ_PCODE_LAB.SUPPORT.SmokeTest'));
});

test('any non-scratch identity or any compiled payload is refused', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['project', file(pjm('APPS_SYS_ML', goodItems), pcm('ZZ_PCODE_LAB')), /project name APPS_SYS_ML/],
    ['item root', file(pjm('ZZ_PCODE_LAB', [[58, ['APPS_RLR', 'Utilities']]]), pcm('ZZ_PCODE_LAB')), /item root APPS_RLR/],
    ['item type', file(pjm('ZZ_PCODE_LAB', [[0, ['ZZ_PCODE_LAB']]]), pcm('ZZ_PCODE_LAB')), /item type 0/],
    ['package root', file(pjm('ZZ_PCODE_LAB', goodItems), apm('APPS_RLR', 'APPS_RLR')), /package root APPS_RLR/],
    ['class root', file(pjm('ZZ_PCODE_LAB', goodItems), apm('ZZ_PCODE_LAB', 'SUPPORT', 'ZZ_PAY_ACCT')), /package list root ZZ_PAY_ACCT/],
    ['program key', file(pjm('ZZ_PCODE_LAB', goodItems), pcm('APPS_RLR')), /PeopleCode key APPS_RLR/],
    ['record PeopleCode', file(pjm('ZZ_PCODE_LAB', goodItems), pcm('ZZ_PCODE_LAB', { id0: 1 })), /not Application Class PeopleCode/],
    ['blob', file(pjm('ZZ_PCODE_LAB', goodItems), pcm('ZZ_PCODE_LAB', { blob: 'xC8AAAQDAgEB' })), /compiled payload/],
    ['name rows', file(pjm('ZZ_PCODE_LAB', goodItems), pcm('ZZ_PCODE_LAB', { pnt: true })), /PSPCMNAME rows/],
    ['name count', file(pjm('ZZ_PCODE_LAB', goodItems), pcm('ZZ_PCODE_LAB', { names: 4 })), /declares names/],
    ['instance class', file(pjm('ZZ_PCODE_LAB', goodItems), '<instance class="RDM">\n  </instance>'), /instance class RDM/],
    ['two projects', file(pjm('ZZ_PCODE_LAB', goodItems), pjm('ZZ_PCODE_LAB_X', goodItems)), /exactly one PJM/]
  ];
  for (const [label, xml, expected] of cases) {
    const result = validateScratchProjectXml(xml);
    assert.equal(result.ok, false, label);
    assert.match(result.violations.join('\n'), expected, label);
  }
});

test('cleanup scripts: only exact-name scratch DELETEs on allowed tables', () => {
  const tables = ['PSPACKAGEDEFN', 'PSPROJECTDEFN'];
  const good = "DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT IN ('ZZ_PCODE_LAB_D1', 'ZZ_PCODE_LAB_D2');\nDELETE FROM PSPROJECTDEFN WHERE PROJECTNAME = 'ZZ_PCODE_LAB_D1';\n";
  const ok = validateScratchCleanupDms(good, tables);
  assert.deepEqual(ok.violations, []);
  assert.equal(ok.statements.length, 2);
  const refuse = (script: string, expected: RegExp) => {
    const r = validateScratchCleanupDms(script, tables);
    assert.equal(r.ok, false, script);
    assert.match(r.violations.join('\n'), expected, script);
  };
  refuse("DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT = 'APPS_RLR';", /APPS_RLR/);
  refuse("DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT LIKE 'ZZ%';", /form not allowed/);
  refuse("DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT = 'ZZ_PCODE_LAB_D1' OR 1 = 1;", /form not allowed/);
  refuse("DELETE FROM PSPCMPROG WHERE OBJECTVALUE1 = 'ZZ_PCODE_LAB_D1';", /table PSPCMPROG/);
  refuse("DELETE FROM PSPACKAGEDEFN;", /form not allowed/);
  refuse("UPDATE PSPACKAGEDEFN SET DESCR = 'x' WHERE PACKAGEROOT = 'ZZ_PCODE_LAB_D1';", /form not allowed/);
  refuse('', /empty script/);
  assert.deepEqual(splitDmsStatements("-- note\nDELETE FROM A WHERE B = 'x;y';\nDELETE FROM C WHERE D = 'z'"), ["DELETE FROM A WHERE B = 'x;y'", "DELETE FROM C WHERE D = 'z'"]);
});

test('audit comparison names every changed, added and removed definition', () => {
  const before = { PSPCMPROG: { 'a': '1|10|t1|h1', 'b': '1|10|t1|h2' }, PSPCMNAME: { 'a': '4||| h' } };
  const same = JSON.parse(JSON.stringify(before));
  assert.equal(auditChangeCount(diffAudit(before, same)), 0);
  const after = { PSPCMPROG: { 'a': '1|10|t2|h1', 'c': '1|1||h3' }, PSPCMNAME: { 'a': '4||| h' } };
  assert.deepEqual(diffAudit(before, after), { changed: ['PSPCMPROG a'], added: ['PSPCMPROG c'], removed: ['PSPCMPROG b'] });
});
