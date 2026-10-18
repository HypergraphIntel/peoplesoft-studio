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
  await assert.rejects(requireCalibratedRelease(database('8.61', 12), 'query'),
    /Query saves are calibrated for PeopleTools 8\.62\.09 and 8\.61\.15; this database is 8\.61\.12\./);
});

test('Integration Broker writes on 8.61.15 only in the shapes matched there; OAuth stays on 8.62.09', () => {
  assert.equal(calibrationRefusal('integrationBrokerStandard', '8.61.15'), undefined);
  assert.equal(calibrationRefusal('integrationBroker', '8.62.09'), undefined);
  assert.match(calibrationRefusal('integrationBroker', '8.61.15') ?? '', /\(REST, nodes, routings or handlers\) are calibrated for PeopleTools 8\.62\.09; this database is 8\.61\.15/);
  assert.match(calibrationRefusal('integrationBrokerStandard', '8.61.12') ?? '', /calibrated for PeopleTools 8\.62\.09 and 8\.61\.15; this database is 8\.61\.12/);
  assert.match(calibrationRefusal('oauth', '8.61.15') ?? '', /OAuth writes/);
});
