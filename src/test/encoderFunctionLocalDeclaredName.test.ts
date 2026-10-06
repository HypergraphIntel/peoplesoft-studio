import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { compareControlledCompile, type ControlledCompileResults, type ExperimentPack } from '../peoplecode/corpus/controlledCompile.js';

/*
 * Cycle 181: a Local declared inside a Function body declares its name only
 * within that Function. Elsewhere the same name (declared nowhere else) is
 * undeclared, so a chain on it keeps inline bare members. The evidence is
 * the controlled compile: PeopleTools 8.62.09, native Windows App Designer,
 * HRDMO (G matrix). G1 / G5 have the shapes of HCDEV 10860 / 15598, and both
 * became EXACT with zero corpus regressions.
 */
const dir = resolve(__dirname, '../../tools/corpus/controlled-compile');
const pack = JSON.parse(readFileSync(resolve(dir, 'experiments.json'), 'utf8')) as ExperimentPack;
const results = JSON.parse(readFileSync(resolve(dir, 'results/8.62.09/G-matrix.json'), 'utf8')) as ControlledCompileResults;

test('the encoder reproduces every 8.62.09 G-matrix compile', () => {
  const report = compareControlledCompile(results, pack);
  assert.equal(report.definitions.length, 7);
  for (const d of report.definitions) {
    assert.equal(d.encode.bytes?.exact, true, `${d.experimentId} bytes`);
    assert.equal(d.encode.referencesExact, true, `${d.experimentId} references`);
  }
});

const owner = { recordName: 'OWN_REC', fieldName: 'OWN_FLD' };
const fieldRows = (source: string): number =>
  encodeProgramArtifacts(source, { owner }).references.filter(r => r.kind === 'field' && /^VAL$/i.test(r.fieldName ?? '')).length;

const declaredIn = (reader: string): string => `Function Load()
   Local Rowset &r2 = GetLevel0()(1).GetRowset(Scroll.T_REC);
   &v = &r2.GetRow(1).T_REC.VAL.Value;
End-Function;

Function Read()
${reader}   &v = &r2.GetRow(1).T_REC.VAL.Value;
End-Function;

Load();
Read();
`;

test('a Function-local declaration does not declare the name in another Function', () => {
  // Read() without its own declaration keeps VAL inline: only Load() opens a FIELD row.
  assert.equal(fieldRows(declaredIn('')), 1);
  // Its own declaration (G2 / G6) makes the read a reference again, in its own unit.
  assert.equal(fieldRows(declaredIn('   Local Rowset &r2;\n')), 2);
});

test('top-level and Global declarations stay program-wide', () => {
  const topLevel = `Global Rowset &r2;

Function Read()
   &v = &r2.GetRow(1).T_REC.VAL.Value;
End-Function;

Read();
`;
  const withLocal = topLevel.replace('Function Read()\n', 'Function Read()\n   Local Rowset &unused;\n');
  assert.equal(fieldRows(topLevel), 1);
  assert.equal(fieldRows(withLocal), 1);
});
