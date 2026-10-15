import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOwnershipEvidence, BaselineIndex } from '../providers/ownershipReader.js';
import { classifyOwnership, decideWrite } from '../model/ownership.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import type { DbConnection } from '../db/connection.js';

function connection(table: string, operator: string, binds: Record<string, unknown>[], exists = true): DbConnection {
  return {
    async execute<T>(sql: string, values = {}) {
      if (sql.includes(`FROM ${table}`)) {
        binds.push(values);
        return { rows: (exists ? [{ OPRID: operator, DTTM: '2026-10-14 12:00:00', VERSION: 3 }] : []) as T[] };
      }
      if (sql.includes('FROM PSPROJECTITEM')) return { rows: [] as T[] };
      throw new Error('Unexpected SQL: ' + sql);
    }, async rollback() {}, async commit() {}, async close() {}, catalog: { columns: async () => [], tableExists: async () => true }
  };
}

test('existing delivered Process Definition is stored and guarded, using process name for prefixes', async () => {
  const binds: Record<string, unknown>[] = [];
  const key = makeKey(DefinitionType.ProcessDefinition, 'SQR Report', 'ABS002');
  const evidence = await readOwnershipEvidence(connection('PS_PRCSDEFN', 'PPLSOFT', binds), key, []);
  assert.equal(evidence.exists, true);
  assert.equal(evidence.version, 3);
  assert.deepEqual(binds, [{ k0: 'SQR Report', k1: 'ABS002' }]);
  assert.equal(decideWrite(classifyOwnership(evidence), 'requireApproval', evidence.exists).action, 'ask');
  const custom = await readOwnershipEvidence(connection('PS_PRCSDEFN', 'JARED', []), makeKey(20, 'SQR Report', 'ZZ_REPORT'), [{ prefix: 'ZZ_', owner: 'organization' }]);
  assert.equal(classifyOwnership(custom).ownership, 'CUSTOM');
});

test('public and private Query ownership use the complete native key, including blank owner', async () => {
  for (const owner of ['', 'JARED']) {
    const binds: Record<string, unknown>[] = [];
    const evidence = await readOwnershipEvidence(connection('PSQRYDEFN', 'JARED', binds), makeKey(10, 'ZZ_QRY_LAB02', owner), []);
    assert.equal(evidence.exists, true);
    assert.deepEqual(binds, [{ k0: 'ZZ_QRY_LAB02', k1: owner || ' ' }]);
    assert.equal(decideWrite(classifyOwnership(evidence), 'requireApproval', true).action, 'ask');
  }
});

test('public Query baseline keys match capture normalization; a genuinely absent definition stays absent', async () => {
  const baseline = new BaselineIndex({ format: 'psft-delivered-baseline/1', appRelease: 'HRMS', toolsRelease: '8.62', capturedFrom: 'HRDMO', capturedAt: '', kinds: { PSQRYDEFN: ['DELIVERED_QRY.'] } });
  const key = makeKey(10, 'DELIVERED_QRY');
  const evidence = await readOwnershipEvidence(connection('PSQRYDEFN', 'JARED', []), key, [], baseline);
  assert.equal(evidence.baseline?.contains, true);
  assert.equal(classifyOwnership(evidence).ownership, 'DELIVERED_MODIFIED');
  assert.equal((await readOwnershipEvidence(connection('PSQRYDEFN', 'JARED', [], false), key, [])).exists, false);
});
