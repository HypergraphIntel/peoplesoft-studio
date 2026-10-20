import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType } from '../model/definitions.js';
import { definitionExists, missingDefinitionProblems } from '../peoplecode/definitionCheck.js';

const searchOf = (names: string[], fail = false) => ({
  search: async ({ namePattern, limit }: { namePattern: string; limit: number }) => {
    if (fail) throw new Error('not searchable');
    // LIKE: '_' matches any one character.
    const re = new RegExp(`^${namePattern.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
    return names.filter((n) => re.test(n)).slice(0, limit).map((n) => ({ key: { parts: [n] } }));
  }
});

test('a definition exists only by its exact name, not by a LIKE match on its underscores', async () => {
  assert.equal(await definitionExists(searchOf(['ZZ_A', 'ZZXA']), DefinitionType.Record, 'ZZ_A'), true);
  assert.equal(await definitionExists(searchOf(['ZZXA']), DefinitionType.Record, 'ZZ_A'), false);
  assert.equal(await definitionExists(searchOf([], true), DefinitionType.Record, 'ZZ_A'), undefined);
  const many = Array.from({ length: 300 }, (_, i) => `ZZ${String(i).padStart(3, '0')}`);
  assert.equal(await definitionExists(searchOf(many), DefinitionType.Record, 'ZZ___'), undefined, 'a truncated result proves nothing');
});

test('a missing definition is a note, except Image, which is App Designer\'s 2,68 warning; unknowable ones are not reported', async () => {
  const refs = [
    { keyword: 'RECORD', name: 'ZZ_NONE', offset: 0, length: 14 },
    { keyword: 'IMAGE', name: 'ZZ_IMG', offset: 20, length: 12 },
    { keyword: 'PAGE', name: 'ZZ_PG', offset: 40, length: 10 },
    { keyword: 'BARNAME', name: 'ZZ_B', offset: 60, length: 12 },
    { keyword: 'SQL', name: 'ZZ_SQL', offset: 80, length: 10 }
  ];
  const problems = await missingDefinitionProblems(refs, async (type, name) => (name === 'ZZ_PG' ? true : type === DefinitionType.SqlDefinition ? undefined : false));
  assert.deepEqual(problems.map((p) => [p.offset, p.severity ?? 'warning', p.message]), [
    [0, 'info', 'No record ZZ_NONE in this database. Application Designer compiles the reference without checking it.'],
    [20, 'warning', 'No definition of IMAGE.ZZ_IMG found. (2,68)']
  ]);
});
