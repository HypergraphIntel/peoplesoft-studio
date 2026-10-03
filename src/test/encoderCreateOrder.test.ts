import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 136: in an Application Class program a `create` uses its class
 * row after its constructor arguments, as in ordinary PeopleCode -- unless
 * the statement's own `Local <Class> &v =` declaration already typed it.
 * 30060 `%Super = create PTAF_CRITERIA:DEFINITION:CriteriaBase(&rec.
 * PTAFCRTA_ID.Value)` stores FIELD.PTAFCRTA_ID then PACKAGE.CRITERIABASE;
 * 30067 `Local PTAF_EMC:MODEL_OBJECTS:formModel &model = create
 * PTAF_EMC:MODEL_OBJECTS:formModel(...)` stores the class row first.
 */
const owner = { recordName: 'PKG', fieldName: 'Kid', packagePath: ['PKG', 'Kid'] };
const key = (r: any): string => r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'field' ? `FIELD.${r.fieldName}` : r.kind;
const encode = (statement: string) => encodeProgramArtifacts(
  `import PKG:*;\n\nclass Kid extends PKG:Base\n   method Kid(&rec As Record);\nend-class;\n\nmethod Kid\n   /+ &rec as Record +/\n   ${statement}\nend-method;\n`,
  { owner }
);

for (const [label, statement, expected] of [
  ['a constructor\'s %Super = create uses the class after its arguments (30060)', '%Super = create PKG:Base(&rec.CRTA_ID.Value);', ['FIELD.CRTA_ID', 'PACKAGE.BASE']],
  ['a create initializing a Local of its class uses the class first (30067)', 'Local PKG:Base &b = create PKG:Base(&rec.CRTA_ID.Value);', ['PACKAGE.BASE', 'FIELD.CRTA_ID']]
] as const) {
  test(label, () => {
    const { program, references } = encode(statement);
    const keys = references.map(key);
    assert.deepEqual(keys.filter(k => k === 'FIELD.CRTA_ID' || k === 'PACKAGE.BASE'), expected);
    // the field operand carries the row's own NAMENUM (index + 1, stored as index)
    const fieldIndex = keys.indexOf('FIELD.CRTA_ID');
    assert.ok(program.includes(Buffer.from([0x4a, fieldIndex & 0xff, fieldIndex >> 8])));
  });
}
