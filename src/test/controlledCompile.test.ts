import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compareControlledCompile,
  memberForms,
  ownerOfKey,
  synthesizeResults,
  type ControlledCompileResults,
  type ExperimentPack
} from '../peoplecode/corpus/controlledCompile.js';

/*
 * Cycle 172: the controlled-compile ingest. The "lab" results here are
 * synthesized from the encoder itself, so they test the comparison
 * machinery, never compiler behavior.
 */
const pack = JSON.parse(readFileSync(resolve(__dirname, '../../tools/corpus/controlled-compile/experiments.json'), 'utf8')) as ExperimentPack;

const appClassKey = (...path: string[]) => {
  const ids = [104, ...path.slice(1, -1).map((_, i) => 105 + i), 107, 12];
  const values = [path[0], ...path.slice(1, -1), path[path.length - 1], 'OnExecute'];
  while (ids.length < 7) { ids.push(0); values.push(' '); }
  return { objectIds: ids, objectValues: values };
};

test('the harness owner: App Class keys keep their package path; Record PeopleCode keys own their record and field', () => {
  assert.deepEqual(ownerOfKey(appClassKey('ZZ_PCODE_LAB', 'ORDERING', 'H1')), {
    recordName: 'ZZ_PCODE_LAB', fieldName: 'ORDERING', packagePath: ['ZZ_PCODE_LAB', 'ORDERING', 'H1']
  });
  assert.deepEqual(ownerOfKey({ objectIds: [1, 2, 12, 0, 0, 0, 0], objectValues: ['ZZ_PCODE_LAB', 'ZZ_CASE_01', 'FieldFormula', ' ', ' ', ' ', ' '] }), {
    recordName: 'ZZ_PCODE_LAB', fieldName: 'ZZ_CASE_01', packagePath: ['ZZ_PCODE_LAB', 'ZZ_CASE_01', 'FieldFormula']
  });
});

test('the experiment pack stays in the scratch namespace and pairs every family with a replica, a positive and a control', () => {
  assert.equal(pack.format, 'pcode-lab-experiments/1');
  for (const definition of [...(pack.smoke ? [pack.smoke] : []), ...pack.supportDefinitions, ...pack.experiments]) {
    assert.match(String(definition.key.objectValues[0]), /^ZZ_PCODE_LAB/);
  }
  const ids = pack.experiments.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const family of new Set(pack.experiments.map(e => e.family))) {
    const members = pack.experiments.filter(e => e.family === family);
    assert.ok(members.some(e => e.role === 'positive'), family);
    assert.ok(members.some(e => e.role === 'control'), family);
    assert.ok(members.some(e => e.corpusExpectation !== undefined), family);
  }
});

test('a capture equal to the encoder compares EXACT, decodes and agrees with the encoder', () => {
  const report = compareControlledCompile(synthesizeResults(pack), pack);
  assert.equal(report.definitions.length, pack.supportDefinitions.length + pack.experiments.length);
  for (const definition of report.definitions) {
    assert.equal(definition.encode.ok, true, definition.keyDescription);
    assert.equal(definition.encode.bytes?.exact, true, definition.keyDescription);
    assert.equal(definition.encode.referencesExact, true, definition.keyDescription);
    assert.equal(definition.decode.ok, true, definition.keyDescription);
    assert.equal(definition.decode.matchesSource, true, definition.keyDescription);
    if (definition.observation !== undefined) assert.equal(definition.observation.encoderAgrees, true, definition.keyDescription);
  }
  for (const family of report.families) assert.deepEqual(family.encoderDisagrees, []);
});

test('reordered PSPCMNAME rows: the reference comparison and the order models see the stored order', () => {
  const synthetic = synthesizeResults(pack);
  const h4 = synthetic.definitions.find(d => d.experimentId === 'H4')!;
  const parent = h4.names.find(r => r.recname === 'PACKAGE' && r.refname === 'PARENT')!;
  const child = h4.names.find(r => r.recname === 'PACKAGE' && r.refname === 'CHILD')!;
  [parent.namenum, child.namenum] = [child.namenum, parent.namenum];

  const comparison = compareControlledCompile(synthetic, pack).definitions.find(d => d.experimentId === 'H4')!;
  assert.equal(comparison.encode.bytes?.exact, true);
  assert.equal(comparison.encode.referencesExact, false);
  assert.deepEqual(comparison.encode.firstReferenceDifference, {
    nameNum: Math.min(parent.namenum, child.namenum), stored: 'PACKAGE.CHILD', generated: 'PACKAGE.PARENT'
  });
  assert.deepEqual(comparison.observation?.stored, ['PACKAGE.CHILD', 'PACKAGE.PARENT']);
  assert.equal(comparison.observation?.encoderAgrees, false);
  assert.equal(comparison.observation?.models.DECLARED_FIRST, 'refuted');
  assert.equal(comparison.observation?.models.CREATED_FIRST, 'consistent');
  assert.equal(comparison.observation?.models.IMPORT_ORDER, 'refuted');
});

test('candidates need a positive and a control, no refutation, and every replica reproduced', () => {
  const key = (id: string) => appClassKey('ZZ_PCODE_LAB', 'ORDERING', id);
  const source = (id: string) => `class ${id}\nend-class;\n`;
  const small: ExperimentPack = {
    format: 'pcode-lab-experiments/1',
    supportDefinitions: [],
    experiments: [
      { id: 'P', family: 'F', role: 'positive', variation: '', key: key('P'), source: source('P'), observe: { type: 'presence', keys: ['PACKAGE.X'] }, models: { NONE: [], SOME: ['PACKAGE.X'] }, corpusExpectation: [] },
      { id: 'Q', family: 'F', role: 'control', variation: '', key: key('Q'), source: source('Q'), observe: { type: 'presence', keys: ['PACKAGE.X'] }, models: { NONE: [], SOME: null } }
    ]
  };
  const results = synthesizeResults(small);
  const summary = compareControlledCompile(results, small).families[0];
  assert.deepEqual(summary.models.NONE, { consistent: ['P', 'Q'], refuted: [], notApplicable: [] });
  assert.deepEqual(summary.models.SOME, { consistent: [], refuted: ['P'], notApplicable: ['Q'] });
  assert.deepEqual(summary.candidates, ['NONE']);

  const unreproduced = compareControlledCompile(results, { ...small, experiments: [{ ...small.experiments[0], corpusExpectation: ['PACKAGE.X'] }, small.experiments[1]] }).families[0];
  assert.deepEqual(unreproduced.replicasNotReproduced, ['P']);
  assert.deepEqual(unreproduced.candidates, []);

  const missingControl = compareControlledCompile({ ...results, definitions: results.definitions.filter(d => d.experimentId === 'P') }, small).families[0];
  assert.deepEqual(missingControl.missing, ['Q']);
  assert.deepEqual(missingControl.candidates, []);
});

test('member forms: 0x4A references, 0x21 REC.FIELD references and 0x0A inline names, in program order', () => {
  const tokens = [
    { opcode: 0x4a, nameNum: 7, text: 'ZZ_LAB_VAL' },
    { opcode: 0x21, nameNum: 3, text: 'Scroll.ZZ_PCODE_LAB_T' },
    { opcode: 0x21, nameNum: 9, text: 'ZZ_PCODE_LAB_T.ZZ_LAB_VAL' },
    { opcode: 0x0a, text: 'Value' },
    { opcode: 0x0a, text: 'zz_lab_val' },
    { opcode: 0x16, text: '"ZZ_LAB_VAL"' }
  ];
  assert.deepEqual(memberForms(tokens, ['ZZ_LAB_VAL']), ['ZZ_LAB_VAL:ref#7', 'ZZ_LAB_VAL:recfield#9', 'ZZ_LAB_VAL:inline']);
});

test('the encoder\'s own prediction for the replicas differs from the corpus programs it fails', () => {
  const report = compareControlledCompile(synthesizeResults(pack), pack);
  const replicas = Object.fromEntries(report.families.map(f => [f.family, f.replicasNotReproduced]));
  assert.deepEqual(replicas, { '30124': ['H1'], '10860/15598': ['G1', 'G5'] });
});

test('an unknown results format is refused', () => {
  assert.throws(() => compareControlledCompile({ format: 'other' } as unknown as ControlledCompileResults, pack), /Unsupported results format/);
});
