import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbConnection } from '../db/connection.js';
import { calibrationRefusal, releaseName, requireCalibratedRelease } from '../providers/calibratedRelease.js';

function database(toolsRel: string, patch: number): DbConnection {
  return { execute: async () => ({ rows: [{ TOOLSREL: toolsRel, PTPATCHREL: patch }] }) } as unknown as DbConnection;
}

test('release names pad the patch as PeopleTools prints it', () => {
  assert.equal(releaseName('8.62', 9), '8.62.09');
  assert.equal(releaseName('8.61 ', 15), '8.61.15');
});

test('Query saves run on the releases a native Windows Query save was matched on', async () => {
  assert.equal(await requireCalibratedRelease(database('8.62', 9), 'query'), '8.62.09');
  assert.equal(await requireCalibratedRelease(database('8.61', 15), 'query'), '8.61.15');
  await assert.rejects(requireCalibratedRelease(database('8.60', 3), 'query'),
    /Query saves are calibrated for PeopleTools 8\.62\.09 and 8\.61\.15; this database is 8\.60\.03\./);
});

test('Integration Broker writes on 8.61.15 only in the shapes matched there; OAuth stays on 8.62.09', () => {
  assert.equal(calibrationRefusal('integrationBrokerStandard', '8.61.15'), undefined);
  assert.equal(calibrationRefusal('integrationBroker', '8.62.09'), undefined);
  assert.match(calibrationRefusal('integrationBroker', '8.61.15') ?? '', /\(REST, nodes, routings or handlers\) are calibrated for PeopleTools 8\.62\.09; this database is 8\.61\.15/);
  assert.match(calibrationRefusal('integrationBrokerStandard', '8.61.12') ?? '', /calibrated for PeopleTools 8\.62\.09 and 8\.61\.15; this database is 8\.61\.12/);
  assert.match(calibrationRefusal('oauth', '8.61.15') ?? '', /OAuth writes/);
});

import { CALIBRATED_RELEASES, FAMILY_TABLES, familyFingerprints, schemaDifferences, tableFingerprint } from '../providers/calibratedRelease.js';
import { CALIBRATED_SCHEMAS } from '../providers/calibratedSchemas.js';

/** A database of the given release whose tables have the given columns. */
function patch(toolsRel: string, patchLevel: number, tables: Record<string, string[]>): DbConnection {
  return {
    execute: async () => ({ rows: [{ TOOLSREL: toolsRel, PTPATCHREL: patchLevel }] }),
    catalog: { columns: async (_c: DbConnection, t: string) => (tables[t] ?? []).map((name) => ({ name, dataType: 'VARCHAR2' })), tableExists: async () => true }
  } as unknown as DbConnection;
}

test('another patch of a calibrated release is accepted when the family\'s tables are the same', async () => {
  const tables = Object.fromEntries(FAMILY_TABLES.query.map((t) => [t, ['QRYNAME', 'OPRID', t + '_COL']]));
  const schemas = { query: { '8.61.15': await familyFingerprints(patch('8.61', 15, tables), 'query') } };
  assert.equal(await requireCalibratedRelease(patch('8.61', 12, tables), 'query', schemas), '8.61.12');
  // One table with an extra column: refused, naming it.
  const changed = { ...tables, PSQRYFIELD: [...tables.PSQRYFIELD, 'NEWCOL'] };
  await assert.rejects(requireCalibratedRelease(patch('8.61', 12, changed), 'query', schemas),
    /calibrated for PeopleTools 8\.62\.09 and 8\.61\.15; this database is 8\.61\.12\. Its PSQRYFIELD table differs from 8\.61\.15's\./);
  // Another release is not compared at all.
  await assert.rejects(requireCalibratedRelease(patch('8.60', 4, tables), 'query', schemas), /this database is 8\.60\.04\.$/);
});

test('stored fingerprints cover every table of every calibrated patch, and show what differs between releases', () => {
  for (const [family, releases] of Object.entries(CALIBRATED_RELEASES) as [keyof typeof CALIBRATED_RELEASES, readonly string[]][]) {
    for (const release of releases) assert.deepEqual(Object.keys(CALIBRATED_SCHEMAS[family]?.[release] ?? {}).sort(), [...FAMILY_TABLES[family]].sort(), `${family} ${release}`);
  }
  // The Query tables are the same on 8.61.15 and 8.62.09; of the IB tables only PSOPERATION (8.62's URL_ID) differs.
  assert.deepEqual(schemaDifferences(CALIBRATED_SCHEMAS.query!['8.62.09'], CALIBRATED_SCHEMAS.query!['8.61.15']), []);
  assert.deepEqual(schemaDifferences(CALIBRATED_SCHEMAS.integrationBrokerStandard!['8.62.09'], CALIBRATED_SCHEMAS.integrationBrokerStandard!['8.61.15']), ['PSOPERATION']);
  assert.equal(tableFingerprint([{ name: 'B', dataType: 'NUMBER' }, { name: 'a', dataType: 'varchar2' }]), tableFingerprint([{ name: 'A', dataType: 'VARCHAR2' }, { name: 'B', dataType: 'NUMBER' }]));
});
