import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';

/*
 * Cycle 135: an Application Class Rowset -- a header `instance` /
 * `property` / `Global` declaration, or a property the type-metadata
 * provider declares `Rowset` -- is a declared Rowset in every method body:
 * `.GetRow(...)` is a Row whose bare member is a RECORD row (30107
 * `&pendingActions.GetRow(&rsCount).PTAFAW_DECISION`), `.GetRow(..)
 * .GetRecord(..)` a Record whose member is a FIELD row (29415
 * `%This.rsTreeWrk_L1.GetRow(&i).GetRecord(1).FIELD_VALUE`). A same-name
 * Local in the body shadows it.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const inlineName = (program: Buffer, name: string): boolean =>
  program.includes(Buffer.concat([Buffer.from([0x0a]), Buffer.from(`${name}\0`, 'utf16le')]));
const keys = (references: readonly any[]) => references.filter(r => r.kind === 'record' || r.kind === 'field').map(r => `${r.kind}:${r.recordName ?? r.fieldName}`);

const demo = (header: string, body: string, after = '') =>
  `class Demo\n   method Run();\n${header}end-class;\n${after}\nmethod Run\n${body}\nend-method;\n`;

for (const [label, header, after] of [
  ['an instance', '   instance Rowset &rs;\n', ''],
  ['a Global', '', '\nGlobal Rowset &rs;\n']
] as const) {
  test(`${label} Rowset's GetRow() member is a RECORD reference (30107)`, () => {
    const { program, references } = encodeProgramArtifacts(demo(header, '   &x = &rs.GetRow(1).PTAFAW_DECISION;', after), { owner });
    assert.equal(inlineName(program, 'PTAFAW_DECISION'), false);
    assert.deepEqual(keys(references), ['record:PTAFAW_DECISION']);
  });
}

test('a body Local of the same name shadows a header Rowset', () => {
  const { program, references } = encodeProgramArtifacts(demo('   instance Rowset &rs;\n', '   Local any &rs;\n   &x = &rs.GetRow(1).PTAFAW_DECISION;'), { owner });
  assert.equal(inlineName(program, 'PTAFAW_DECISION'), true);
  assert.deepEqual(keys(references), []);
});

test('a property the metadata provider declares Rowset is a Rowset: GetRow().GetRecord() member is a FIELD reference (29415)', () => {
  const header = '   property Rowset rsTreeWrk_L1;\n';
  const provider = createApplicationClassTypeMetadataProvider(
    [{ path: ['APP', 'Demo'], source: `class Demo\n   method Run();\n${header}end-class;\n` }],
    { isBuiltinType: isBuiltinObjectTypeName }
  );
  const source = demo(header, '   &v = %This.rsTreeWrk_L1.GetRow(&i).GetRecord(1).FIELD_VALUE.Value;');
  const { program, references } = encodeProgramArtifacts(source, { owner, applicationClassTypeMetadata: provider });
  assert.equal(inlineName(program, 'FIELD_VALUE'), false);
  assert.deepEqual(keys(references), ['field:FIELD_VALUE']);
  // without the provider nothing is typed (metadata stays optional)
  assert.equal(inlineName(encodeProgramArtifacts(source, { owner }).program, 'FIELD_VALUE'), true);
});
