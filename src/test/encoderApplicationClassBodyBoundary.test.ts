import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareControlledCompile, type ControlledCompileResults, type ExperimentPack } from '../peoplecode/corpus/controlledCompile.js';

/*
 * 8.62 track (H2): an Application Class method body that ends in a bare
 * App-Class-typed Local stores `15 64` -- no 0x2D before end-method, like
 * every other Local run in an App Class program (Cycle 113: 0 of 6,044 in
 * HCDEV). Controlled compile, PeopleTools 8.62.09, native Windows App
 * Designer, HRDMO: the H2-boundary family H10 (positive), H11 (controls)
 * and H12 (the 28918 replica, 8.61 shape). HCDEV has no program that
 * reaches this close.
 */
const dir = resolve(__dirname, '../../tools/corpus/controlled-compile');
const pack = JSON.parse(readFileSync(resolve(dir, 'experiments.json'), 'utf8')) as ExperimentPack;
const results = JSON.parse(readFileSync(resolve(dir, 'results/8.62.09/H2-boundary.json'), 'utf8')) as ControlledCompileResults;

test('the encoder reproduces every 8.62.09 H2-boundary compile', () => {
  const report = compareControlledCompile(results, pack);
  assert.deepEqual(report.definitions.map(d => d.experimentId), ['H10', 'H11', 'H12']);
  for (const d of report.definitions) {
    assert.equal(d.encode.bytes?.exact, true, `${d.experimentId} bytes`);
    assert.equal(d.encode.referencesExact, true, `${d.experimentId} references`);
  }
  const family = report.families.find(f => f.family === 'H2-boundary')!;
  assert.deepEqual(family.encoderDisagrees, []);
  assert.deepEqual(family.replicasNotReproduced, []);
  assert.deepEqual(report.definitions.find(d => d.experimentId === 'H10')!.observation!.stored,
    ['BARECLASS:15', 'BARECLASSOTHERPACKAGE:15', 'TWOBARECLASS:15', 'BARECLASSARRAY:15', 'BARECLASSBLANKLINE:4F', 'BARECLASSCOMMENT:24', 'STATEMENTTHENBARECLASS:15']);
});
