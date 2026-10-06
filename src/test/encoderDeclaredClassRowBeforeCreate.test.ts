import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { compareControlledCompile, type ControlledCompileResults, type ExperimentPack } from '../peoplecode/corpus/controlledCompile.js';

/*
 * Cycle 181: in an Application Class program, `Local A &x = create B(...)`
 * (B a different class) opens A's PACKAGE row at the declaration, before
 * B's. The evidence is the controlled compile: PeopleTools 8.62.09, native
 * Windows App Designer, HRDMO. The H matrix stores A then B under a
 * wildcard import in every variant, and keeps import order under named
 * imports. HCDEV 30124 has the same shape and became EXACT with zero
 * corpus regressions.
 */
const dir = resolve(__dirname, '../../tools/corpus/controlled-compile');
const pack = JSON.parse(readFileSync(resolve(dir, 'experiments.json'), 'utf8')) as ExperimentPack;
const results = JSON.parse(readFileSync(resolve(dir, 'results/8.62.09/H-matrix.json'), 'utf8')) as ControlledCompileResults;

test('the encoder reproduces every 8.62.09 H-matrix compile (H2 references only)', () => {
  const report = compareControlledCompile(results, pack);
  for (const d of report.definitions) {
    if (d.experimentId === 'H2') {
      // Separate 8.62 finding: a method body holding only a bare Local stores no 0x2D before end-method.
      assert.equal(d.encode.referencesExact, true, 'H2 references');
      continue;
    }
    assert.equal(d.encode.bytes?.exact, true, `${d.experimentId ?? d.keyDescription} bytes`);
    assert.equal(d.encode.referencesExact, true, `${d.experimentId ?? d.keyDescription} references`);
  }
  const h1 = report.definitions.find(d => d.experimentId === 'H1')!;
  assert.deepEqual(h1.storedReferences.slice(2), ['PACKAGE.PARENT', 'PACKAGE.CHILD']);
});

test('creating the same class as the declaration still uses one row', () => {
  const owner = { recordName: 'PKG', fieldName: 'Kid', packagePath: ['PKG', 'Kid'] };
  const { references } = encodeProgramArtifacts(
    'import PKG:*;\n\nclass Kid\n   method Run();\nend-class;\n\nmethod Run\n   Local PKG:Base &b = create PKG:Base();\nend-method;\n',
    { owner, applicationClassDefinition: true }
  );
  assert.deepEqual(references.filter(r => r.kind === 'package' && r.packageName).map(r => r.packageName?.toUpperCase()), ['BASE']);
});
