import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { searchProjectText } from '../projectTextSearch.js';

const keys = [makeKey(DefinitionType.SqlDefinition, 'SQL'), makeKey(DefinitionType.Page, 'PAGE'),
  makeKey(DefinitionType.HtmlDefinition, 'HTML'), makeKey(DefinitionType.RecordPeopleCode, 'REC', 'FIELD', 'FieldChange')];

test('project search filters unsupported types, skips failed reads and retains later hits', async () => {
  const read: string[] = [];
  const progress: number[][] = [];
  const result = await searchProjectText({
    listProjectItems: async (project) => {
      assert.equal(project, 'DEMO');
      return keys.map((key) => ({ key }));
    },
    canReadAsText: (type) => type !== DefinitionType.Page,
    readText: async (key) => {
      read.push(key.parts[0]);
      if (key.type === DefinitionType.HtmlDefinition) throw new Error('deleted');
      return 'target\r\nTARGETED\r\nTARGET';
    }
  }, 'DEMO', 'TARGET', { matchCase: true, wholeWord: true }, undefined,
  (done, total) => progress.push([done, total]));
  assert.deepEqual(read, ['SQL', 'HTML', 'REC']);
  assert.deepEqual(result.hits.map((h) => [h.key.parts[0], h.line, h.column]), [['SQL', 2, 0], ['REC', 2, 0]]);
  assert.equal(result.scanned, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.cancelled, false);
  assert.deepEqual(progress.at(-1), [3, 3]);
});

test('cancellation during a read stops subsequent reads and returns partial results', async () => {
  const token = { isCancellationRequested: false };
  let reads = 0;
  const result = await searchProjectText({
    listProjectItems: async () => keys.map((key) => ({ key })),
    canReadAsText: () => true,
    readText: async () => { reads++; token.isCancellationRequested = true; return 'hit'; }
  }, 'DEMO', 'hit', {}, token);
  assert.equal(reads, 1);
  assert.equal(result.hits.length, 1);
  assert.equal(result.cancelled, true);
});

test('pre-cancellation does not list items; cancellation during listing does not read', async () => {
  const token = { isCancellationRequested: true };
  const provider = {
    listProjectItems: async () => { token.isCancellationRequested = true; return keys.map((key) => ({ key })); },
    canReadAsText: () => true,
    readText: async () => { assert.fail('must not read'); }
  };
  assert.equal((await searchProjectText({ ...provider, listProjectItems: async () => assert.fail('must not list') },
    'DEMO', 'hit', {}, token)).cancelled, true);
  token.isCancellationRequested = false;
  assert.equal((await searchProjectText(provider, 'DEMO', 'hit', {}, token)).cancelled, true);
});

test('an empty project has no hits and a listing failure is reported to the caller', async () => {
  const provider = { listProjectItems: async () => [], canReadAsText: () => true, readText: async () => '' };
  assert.deepEqual(await searchProjectText(provider, 'EMPTY', 'hit'), { hits: [], scanned: 0, skipped: 0, cancelled: false });
  await assert.rejects(searchProjectText({ ...provider, listProjectItems: async () => { throw new Error('list failed'); } },
    'DEMO', 'hit'), /list failed/);
});
