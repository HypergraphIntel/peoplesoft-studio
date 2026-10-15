import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PFC_CONFIGURATION_SCHEMA } from '../mcp/pfcSchema.js';
import { PFC_LIST_TABLES } from '../providers/pfcWriter.js';

/*
 * psft_page_field_config_save's configuration schema keeps every list the
 * writer saves: a list the schema dropped would reach the writer as absent and
 * be saved empty, deleting the stored rows (JOB_DATA_FL's excluded roles, the
 * masking configurations' users).
 */

test('the save tool\'s schema keeps every list the writer saves', () => {
  const shape = Object.keys(PFC_CONFIGURATION_SCHEMA.shape);
  for (const table of PFC_LIST_TABLES) assert.ok(shape.includes(table), `${table} is in the schema`);
  const parsed = PFC_CONFIGURATION_SCHEMA.parse({
    header: { DESCR: 'Job Data' }, sequences: [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1 }],
    excludedRoles: [{ ROLENAME: 'HR Admin Approver Fluid' }], seqUsers: [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, OPRID: 'PS' }]
  });
  assert.deepEqual(parsed.excludedRoles, [{ ROLENAME: 'HR Admin Approver Fluid' }]);
  assert.deepEqual(parsed.seqUsers, [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, OPRID: 'PS' }]);
});
