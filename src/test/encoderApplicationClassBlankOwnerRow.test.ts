import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 183: every Application Class program stores a blank PSPCMNAME row
 * at NAMENUM 1 (1,510 / 1,510 HCDEV programs), even when nothing in it is
 * referenced: a header-only class, empty method bodies (28723, 28906,
 * 29905 ...), or the single-method golden-template shape (29632). Program
 * bytes do not change -- no operand refers to the row.
 */
const owner = { recordName: 'PKG', fieldName: 'Thing', packagePath: ['PKG', 'Thing'] };
const rows = (source: string) =>
  encodeProgramArtifacts(source, { owner, applicationClassDefinition: true }).references.map(r => [r.sequence, r.kind, r.packageName?.toUpperCase() ?? '']);

test('a class that encodes no fragment still stores the blank row', () => {
  assert.deepEqual(rows('class Thing\n   property string Name;\n   property number Count;\nend-class;\n'), [[1, 'owner', '']]);
  assert.deepEqual(rows('class Thing\n   method Thing();\nend-class;\n\nmethod Thing\n   \nend-method;\n'), [[1, 'owner', '']]);
});

test('the golden-template shape takes its rows from the general encoder', () => {
  const source = 'import OTHER:Sub:Thing;\n\nclass Thing\n   method Run(&input As string) Returns string;\nend-class;\n\nmethod Run\n   /+ &input as String +/\n   /+ Returns String +/\n   \n   Local OTHER:Sub:Thing &obj;\n   \n   &obj = create OTHER:Sub:Thing();\n   \n   &obj.Run("Input");\n   \n   Return "Hi"\nend-method;\n';
  const encoded = rows(source);
  assert.deepEqual(encoded[0], [1, 'owner', '']);
  assert.deepEqual(encoded.slice(1), [[2, 'package', 'THING']]);
});
