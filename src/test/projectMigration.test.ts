import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { documentFromSpec } from '../model/aeSpec.js';
import { reviewProjectMigration, renderMigrationReview } from '../projectMigration.js';
import type { DefinitionProvider, DefinitionSummary } from '../providers/provider.js';
import type { RecordDefinition } from '../model/record.js';

const fixture = () => {
  const doc = documentFromSpec({
    program: 'ZZ_MIG_AE', stateRecords: [{ record: 'ZZ_MIG_AET', default: true }],
    tempTables: ['ZZ_MIG_TMP'],
    sections: [{ name: 'MAIN', steps: [
      { name: 'INIT', actions: [{ type: 'PeopleCode', peopleCode: 'Local number &n = 1;' }] },
      { name: 'CALL', actions: [{ type: 'Call Section', program: 'ZZ_LIB', section: 'PUBLIC' }] },
      { name: 'DYNAMIC', actions: [{ type: 'Call Section', dynamic: true }] }
    ] }]
  });
  const items: DefinitionSummary[] = [
    { key: makeKey(DefinitionType.AppEngineProgram, 'ZZ_MIG_AE') },
    { key: makeKey(DefinitionType.Record, 'ZZ_MIG_AET') },
    { key: makeKey(DefinitionType.AppEnginePeopleCode, 'ZZ_MIG_AE', 'MAIN    GBLdefault  1900-01-01', 'INIT', 'OnExecute') }
  ];
  const record: RecordDefinition = { key: items[1].key, name: 'ZZ_MIG_AET', recordType: 2, description: '', version: 1,
    fields: [
      { name: 'PROCESS_INSTANCE', fieldNum: 1, type: 2, length: 10, decimalPositions: 0, useEdit: 0 },
      { name: 'ZZ_ID', fieldNum: 2, type: 0, length: 10, decimalPositions: 0, useEdit: 0, editTable: 'ZZ_PROMPT', fromSubrecord: 'ZZ_SUBREC' }
    ] };
  const provider = {
    displayName: 'Source', listProjectItems: async () => items, readRecord: async () => record,
    readAppEngineDocument: async () => ({ doc, token: 'test' })
  } as unknown as DefinitionProvider;
  return { provider, items };
};

test('migration review discovers explicit dependencies and recognizes packed AE member keys', async () => {
  const { provider } = fixture();
  const result = await reviewProjectMigration(provider, 'ZZ_PROJECT');
  assert.equal(result.format, 'psft-migration-review/1');
  assert.equal(result.comparisons.length, 0);
  const dependency = (name: string) => result.dependencies.find(d => d.label === name)!;
  assert.equal(dependency('ZZ_MIG_AET').inProject, true);
  assert.equal(dependency('ZZ_MIG_TMP').inProject, false);
  assert.equal(dependency('PROCESS_INSTANCE').inProject, false);
  assert.equal(dependency('ZZ_PROMPT').key.type, DefinitionType.Record);
  assert.equal(dependency('ZZ_SUBREC').key.type, DefinitionType.Record);
  assert.ok(result.dependencies.find(d => d.key.type === DefinitionType.AppEnginePeopleCode)!.inProject);
  assert.equal(dependency('ZZ_LIB').key.type, DefinitionType.AppEngineProgram);
  assert.ok(result.unresolved.some(note => note.includes('dynamic Call Section')));
  assert.ok(result.unresolved.some(note => note.includes('SQL, PeopleCode')));
});

test('dependency read failures remain visible and do not prevent reviewing other members', async () => {
  const { provider } = fixture();
  provider.readRecord = async () => { throw new Error('record unavailable'); };
  const review = await reviewProjectMigration(provider, 'ZZ_PROJECT');
  assert.ok(review.unresolved.some(note => note.includes('record unavailable')));
  assert.ok(review.dependencies.some(d => d.label === 'ZZ_MIG_TMP'));
});

test('sources without structured AE metadata report incomplete dependency coverage', async () => {
  const { provider } = fixture();
  provider.readAppEngineDocument = undefined;
  const review = await reviewProjectMigration(provider, 'ZZ_PROJECT');
  assert.ok(review.unresolved.some(note => note.includes('cannot provide structured AE')));
  const rendered = renderMigrationReview(review);
  assert.match(rendered, /not a migration package or a complete dependency closure/);
  assert.match(rendered, /outside project/);
  assert.match(rendered, /Import Migration Package/);
});

test('migration report escapes definition and environment text', async () => {
  const { provider } = fixture();
  const review = await reviewProjectMigration(provider, 'ZZ_PROJECT');
  review.source = 'Source | <script>';
  const rendered = renderMigrationReview(review);
  assert.ok(rendered.includes('Source \\| \\<script\\>'));
  assert.equal(rendered.includes('Source | <script>'), false);
});
