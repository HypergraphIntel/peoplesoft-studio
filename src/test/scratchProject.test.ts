import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScratchRecordProject, buildScratchShellProject, recordTemplatesFromExport, templatesFromExport } from '../peoplecode/corpus/scratchProject.js';
import { validateScratchProjectXml } from '../peoplecode/corpus/labSafety.js';

/*
 * Cycle 180: scratch-only shell projects. Synthetic templates in the
 * shape of an 8.62 -PJTF export (no delivered content).
 */
const pjm = `<instance class="PJM">
    <rowset name="PjmDefn" size="3288" count="1">
      <row>
        <szProjectName>TEMPLATE</szProjectName>
        <nProjectCount>1</nProjectCount>
        <lpPit> POINTER
          <rowset name="PjmPit" size="856" count="1">
            <row>
              <eObjectType>57</eObjectType>
              <szObjectValue_0>T</szObjectValue_0>
              <szObjectValue_1>T</szObjectValue_1>
              <szObjectValue_2>.</szObjectValue_2>
              <szObjectValue_3></szObjectValue_3>
              <eObjectID_0>104</eObjectID_0>
              <eObjectID_1>116</eObjectID_1>
              <eObjectID_2>117</eObjectID_2>
              <eObjectID_3>0</eObjectID_3>
              <bExecute>0</bExecute>
              <eSourceStatus>0</eSourceStatus>
              <eTargetStatus>0</eTargetStatus>
              <eUpgradeAction>0</eUpgradeAction>
              <bTakeAction>1</bTakeAction>
              <bCopyDone>0</bCopyDone>
            </row>
          </rowset>
        </lpPit>
      </row>
    </rowset>
  </instance>`;
const rootApm = `<instance class="APM">
    <rowset name="ApmDefn" size="968" count="1">
      <row>
        <szPackageId>T</szPackageId>
        <szPackageRoot>T</szPackageRoot>
        <szQualifyPath>.</szQualifyPath>
        <lPackageLevel>0</lPackageLevel>
        <ApmDefnList.lClassCount>0</ApmDefnList.lClassCount>
        <ApmDefnList.hDefnClassList>HANDLE</ApmDefnList.hDefnClassList>
        <ApmDefnList.lPackageCount>2</ApmDefnList.lPackageCount>
        <ApmDefnList.hDefnPackageList> HANDLE
          <rowset name="ApmPackageList" size="976" count="2">
            <row>
              <ApmDefnKey.szPackageId>A</ApmDefnKey.szPackageId>
              <ApmDefnKey.szPackageRoot>T</ApmDefnKey.szPackageRoot>
              <ApmDefnKey.szQualifyPath>:</ApmDefnKey.szQualifyPath>
              <szPackageRef></szPackageRef>
              <lPackageLevel>1</lPackageLevel>
            </row>
            <row>
              <ApmDefnKey.szPackageId>B</ApmDefnKey.szPackageId>
              <ApmDefnKey.szPackageRoot>T</ApmDefnKey.szPackageRoot>
              <ApmDefnKey.szQualifyPath>:</ApmDefnKey.szQualifyPath>
              <szPackageRef></szPackageRef>
              <lPackageLevel>1</lPackageLevel>
            </row>
          </rowset>
        </ApmDefnList.hDefnPackageList>
      </row>
    </rowset>
  </instance>`;
const level1Apm = `<instance class="APM">
    <rowset name="ApmDefn" size="968" count="1">
      <row>
        <szPackageId>A</szPackageId>
        <szPackageRoot>T</szPackageRoot>
        <szQualifyPath>:</szQualifyPath>
        <lPackageLevel>1</lPackageLevel>
        <ApmDefnList.lClassCount>1</ApmDefnList.lClassCount>
        <ApmDefnList.hDefnClassList> HANDLE
          <rowset name="ApmClassList" size="464" count="1">
            <row>
              <ApmClassKey.szClassId>X</ApmClassKey.szClassId>
              <ApmClassKey.szPackageRoot>T</ApmClassKey.szPackageRoot>
              <ApmClassKey.szQualifyPath>A</ApmClassKey.szQualifyPath>
              <lClassLevel>2</lClassLevel>
              <hClassDefn> HANDLE
                <rowset name="ApmClassDefn" size="576" count="1">
                  <row>
                    <szClassId>X</szClassId>
                  </row>
                </rowset>
              </hClassDefn>
            </row>
          </rowset>
        </ApmDefnList.hDefnClassList>
        <ApmDefnList.lPackageCount>0</ApmDefnList.lPackageCount>
        <ApmDefnList.hDefnPackageList>HANDLE</ApmDefnList.hDefnPackageList>
      </row>
    </rowset>
  </instance>`;
const pcm = `<instance class="PCM">
    <rowset name="PcmProg" size="2240" count="1">
      <row>
${[0, 1, 2, 3, 4, 5, 6].map(i => `        <eObjectID_${i}>${[104, 105, 107, 12, 0, 0, 0][i]}</eObjectID_${i}>\n        <szObjectValue_${i}>${['T', 'A', 'X', 'OnExecute', '', '', ''][i]}</szObjectValue_${i}>`).join('\n')}
        <nNameCount>3</nNameCount>
        <lSourceLen>99</lSourceLen>
        <lEntryNamesLen>9</lEntryNamesLen>
        <nEntry>1</nEntry>
        <nParams>1</nParams>
        <lpPnt> POINTER
          <rowset name="PcmPnt" size="1602" count="3"><row><szRecName>PACKAGE</szRecName></row></rowset>
        </lpPnt>
      </row>
    </rowset>
    <peoplecode_text>class X
end-class;
</peoplecode_text>
    <peoplecode_blob>QUJDREVG</peoplecode_blob>
  </instance>`;
const exportXml = `<?xml version='1.0'?>\n  <!--Warning : Don't edit this file -->\n  ${pjm}\n  ${level1Apm}\n  ${rootApm}\n  ${pcm}\n`;

test('shell projects are scratch-only, payload-free, sorted and sized from the templates', () => {
  const templates = templatesFromExport(exportXml);
  const xml = buildScratchShellProject(templates, {
    project: 'ZZ_PCODE_LAB_H',
    root: 'ZZ_PCODE_LAB',
    subpackages: ['SUPPORT', 'ORDERING', 'SCOPE'],
    create: [{ name: 'SCOPE', classes: ['SPARENT', 'SCHILD'] }, { name: 'ORDERING', classes: ['PARENT', 'H1'] }]
  });
  const v = validateScratchProjectXml(xml);
  assert.deepEqual(v.violations, []);
  assert.doesNotMatch(xml, /QUJDREVG|PcmPnt|>T<|>A<|>X</);
  assert.deepEqual([...xml.matchAll(/<instance class="(\w+)">/g)].map(m => m[1]), ['PJM', 'APM', 'APM', 'APM', 'PCM', 'PCM', 'PCM', 'PCM']);
  assert.deepEqual([...xml.matchAll(/<szPackageId>([^<]*)<\/szPackageId>/g)].map(m => m[1]), ['ORDERING', 'SCOPE', 'ZZ_PCODE_LAB']);
  assert.match(xml, /<rowset name="PjmPit" size="5992" count="7">/);
  assert.match(xml, /<rowset name="ApmPackageList" size="1464" count="3">/);
  assert.match(xml, /<rowset name="ApmClassList" size="928" count="2">/);
  const items = [...xml.matchAll(/<eObjectType>(\d+)<\/eObjectType>\s*<szObjectValue_0>([^<]*)<\/szObjectValue_0>\s*<szObjectValue_1>([^<]*)<\/szObjectValue_1>\s*<szObjectValue_2>([^<]*)</g)].map(m => m.slice(1).join('|'));
  assert.deepEqual(items, [
    '57|ORDERING|ZZ_PCODE_LAB|:', '57|SCOPE|ZZ_PCODE_LAB|:', '57|ZZ_PCODE_LAB|ZZ_PCODE_LAB|.',
    '58|ZZ_PCODE_LAB|ORDERING|H1', '58|ZZ_PCODE_LAB|ORDERING|PARENT', '58|ZZ_PCODE_LAB|SCOPE|SCHILD', '58|ZZ_PCODE_LAB|SCOPE|SPARENT'
  ]);
  assert.match(xml, /<nNameCount>0<\/nNameCount>/);
  assert.match(xml, /<peoplecode_blob><\/peoplecode_blob>/);
});

test('a non-scratch root or project is refused at generation', () => {
  const templates = templatesFromExport(exportXml);
  assert.throws(() => buildScratchShellProject(templates, { project: 'ZZ_PCODE_LAB_H', root: 'APPS_RLR', subpackages: ['A'], create: [{ name: 'A', classes: ['X'] }] }), /not scratch/);
  assert.throws(() => buildScratchShellProject(templates, { project: 'MYPROJ', root: 'ZZ_PCODE_LAB', subpackages: ['A'], create: [{ name: 'A', classes: ['X'] }] }), /project name MYPROJ/);
});

/*
 * Cycle 181: scratch fields, derived records and Record Field PeopleCode
 * shells for the G matrix. Synthetic templates in the 8.62 export shape.
 */
const label = (p: string, id: string, extra = '') => `<row>
                    <${p}LabelID>${id}</${p}LabelID>
                    <${p}LongName>Long ${id}</${p}LongName>
                    <${p}ShortName>S ${id}</${p}ShortName>
                    <bIsDefault>0</bIsDefault>${extra}
                  </row>`;
const fieldTemplate = `<instance class="FIELD">
    <rowset name="Field" size="936" count="1">
      <row>
        <szObjectOwnerID>PPT</szObjectOwnerID>
        <szFieldName>TFIELD</szFieldName>
        <eFieldType>0</eFieldType>
        <nLength>4</nLength>
        <nLabelCount>2</nLabelCount>
        <hDBFldLabel> HANDLE
          <rowset name="DBFldLabel" size="528" count="2">
                  ${label('sz', 'TL1')}
                  ${label('sz', 'TL2')}
          </rowset>
        </hDBFldLabel>
        <szEditTable></szEditTable>
        <szLabelID>TL1</szLabelID>
        <szLongName>Long TL1</szLongName>
        <szShortName>S TL1</szShortName>
      </row>
    </rowset>
  </instance>`;
const recRow = (name: string, type: number) => `<row>
              <fStatus>0</fStatus>
              <atmFieldName>${name}</atmFieldName>
              <eFieldType>${type}</eFieldType>
              <nLength>30</nLength>
              <eFormat>6</eFormat>
              <szObjectOwnerID></szObjectOwnerID>
              <nLabelCount>3</nLabelCount>
              <hDBFldLabel> HANDLE
                <rowset name="DBFldLabel" size="96" count="3">
                  ${label('atm', `${name}1`)}
                  ${label('atm', `${name}2`)}
                  ${label('atm', `${name}3`)}
                </rowset>
              </hDBFldLabel>
              <atmEditTable></atmEditTable>
              <atmLongName>Long ${name}</atmLongName>
              <atmShortName>S ${name}</atmShortName>
              <atmPhysicalRecNameList>TREC     </atmPhysicalRecNameList>
              <nRecFieldFrmtCount>0</nRecFieldFrmtCount>
            </row>`;
const recordTemplate = `<instance class="RDM">
    <rowset name="RecDefn" size="920" count="1">
      <row>
        <szObjectOwnerID>PPT</szObjectOwnerID>
        <szRecName>TREC</szRecName>
        <eRecType>2</eRecType>
        <nFieldCount>2</nFieldCount>
        <szParentRecName></szParentRecName>
        <hRft> HANDLE
          <rowset name="RecField" size="880" count="2">
            ${recRow('TNUM', 2)}
            ${recRow('TCHAR', 0)}
          </rowset>
        </hRft>
        <nIndexCount>0</nIndexCount>
      </row>
    </rowset>
  </instance>`;
const recordPcm = pcm.replace(/<eObjectID_(\d)>\d+<\/eObjectID_\1>\s*<szObjectValue_\1>[^<]*<\/szObjectValue_\1>/g, (_m, i: string) =>
  `<eObjectID_${i}>${[1, 2, 12, 0, 0, 0, 0][Number(i)]}</eObjectID_${i}>\n        <szObjectValue_${i}>${['TREC', 'TCHAR', 'FieldChange', '', '', '', ''][Number(i)]}</szObjectValue_${i}>`);
const recordExport = `<?xml version='1.0'?>\n  <!--Warning : Don't edit this file -->\n  ${pjm}\n  ${fieldTemplate}\n  ${recordTemplate}\n  ${pcm}\n  ${recordPcm}\n`;
const gSpec = {
  project: 'ZZ_PCODE_LAB_G',
  fields: [{ name: 'ZZ_PCODE_LAB_C01', length: 1 }, { name: 'ZZ_PCODE_LAB_KEY', length: 10 }, { name: 'ZZ_PCODE_LAB_VAL', length: 10 }],
  records: [{ name: 'ZZ_PCODE_LAB', fields: ['ZZ_PCODE_LAB_C01'] }, { name: 'ZZ_PCODE_LAB_T', fields: ['ZZ_PCODE_LAB_KEY', 'ZZ_PCODE_LAB_VAL'] }],
  programs: [{ record: 'ZZ_PCODE_LAB', field: 'ZZ_PCODE_LAB_C01', event: 'FieldFormula' }]
};

test('record projects: scratch fields, derived records and payload-free Record PeopleCode shells', () => {
  const t = recordTemplatesFromExport(recordExport);
  assert.match(t.recordPcm, /<szObjectValue_0>TREC</);
  const xml = buildScratchRecordProject(t, gSpec);
  assert.deepEqual(validateScratchProjectXml(xml).violations, []);
  assert.doesNotMatch(xml, /TFIELD|TREC|TCHAR|TNUM|TL1|TL2|PPT|QUJDREVG|PcmPnt|FieldChange/);
  assert.deepEqual([...xml.matchAll(/<instance class="(\w+)">/g)].map(m => m[1]), ['PJM', 'RDM', 'RDM', 'FIELD', 'FIELD', 'FIELD', 'PCM']);
  const items = [...xml.matchAll(/<eObjectType>(\d+)<\/eObjectType>\s*<szObjectValue_0>([^<]*)<\/szObjectValue_0>\s*<szObjectValue_1>([^<]*)<\/szObjectValue_1>\s*<szObjectValue_2>([^<]*)</g)].map(m => m.slice(1).join('|'));
  assert.deepEqual(items, ['0|ZZ_PCODE_LAB||', '0|ZZ_PCODE_LAB_T||', '2|ZZ_PCODE_LAB_C01||', '2|ZZ_PCODE_LAB_KEY||', '2|ZZ_PCODE_LAB_VAL||', '8|ZZ_PCODE_LAB|ZZ_PCODE_LAB_C01|FieldFormula']);
  assert.match(xml, /<rowset name="PjmPit" size="5136" count="6">/);
  const recT = /<instance class="RDM">(?:(?!<\/instance>)[\s\S])*<szRecName>ZZ_PCODE_LAB_T<[\s\S]*?<\/instance>/.exec(xml)![0];
  assert.match(recT, /<nFieldCount>2<\/nFieldCount>/);
  assert.match(recT, /<rowset name="RecField" size="880" count="2">/);
  assert.deepEqual([...recT.matchAll(/<atmFieldName>([^<]*)</g)].map(m => m[1]), ['ZZ_PCODE_LAB_KEY', 'ZZ_PCODE_LAB_VAL']);
  assert.deepEqual([...recT.matchAll(/<eFieldType>(\d)</g)].map(m => m[1]), ['0', '0']);
  assert.deepEqual([...recT.matchAll(/<rowset name="DBFldLabel" size="(\d+)" count="(\d+)">/g)].map(m => `${m[1]}/${m[2]}`), ['32/1', '32/1']);
  assert.deepEqual([...recT.matchAll(/<nLabelCount>(\d+)</g)].map(m => m[1]), ['1', '1']);
  assert.deepEqual([...recT.matchAll(/<atmPhysicalRecNameList>([^<]*)</g)].map(m => m[1]), ['ZZ_PCODE_LAB_T     ', 'ZZ_PCODE_LAB_T     ']);
  const val = /<instance class="FIELD">(?:(?!<\/instance>)[\s\S])*<szFieldName>ZZ_PCODE_LAB_VAL<[\s\S]*?<\/instance>/.exec(xml)![0];
  assert.match(val, /<nLength>10<\/nLength>/);
  assert.match(val, /<rowset name="DBFldLabel" size="264" count="1">/);
  assert.match(val, /<szShortName>VAL<\/szShortName>/);
  assert.match(xml, /<nNameCount>0<\/nNameCount>/);
  assert.match(xml, /<peoplecode_blob><\/peoplecode_blob>/);
});

test('record projects refuse non-scratch records, fields and programs', () => {
  const t = recordTemplatesFromExport(recordExport);
  assert.throws(() => buildScratchRecordProject(t, { ...gSpec, records: [...gSpec.records, { name: 'JOB', fields: ['ZZ_PCODE_LAB_KEY'] }] }), /record JOB is not scratch|record item JOB/);
  assert.throws(() => buildScratchRecordProject(t, { ...gSpec, fields: [...gSpec.fields, { name: 'EMPLID', length: 11 }] }), /EMPLID/);
  assert.throws(() => buildScratchRecordProject(t, { ...gSpec, programs: [{ record: 'ZZ_PCODE_LAB', field: 'EMPLID', event: 'FieldFormula' }] }), /EMPLID/);
  assert.throws(() => buildScratchRecordProject(t, { ...gSpec, records: [{ name: 'ZZ_PCODE_LAB', fields: ['ZZ_PCODE_LAB_NOPE'] }] }), /undeclared field/);
});
