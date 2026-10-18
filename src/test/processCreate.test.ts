import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEW_PROCESS_DEFAULTS, restartEnabled } from '../providers/processWriter.js';

/*
 * A PIA Add on PeopleTools 8.61.15 (Application Engine, one process group, nothing else
 * entered) and psft_process_create now store equal PS_PRCSDEFN rows.
 */

test('output format keeps its record default, blank', () => {
  assert.equal(NEW_PROCESS_DEFAULTS.OUTDESTFORMAT, ' ');
});

test('an Application Engine process restarts unless its program disables restart (page Activate)', () => {
  assert.equal(restartEnabled('Application Engine', 'N'), '1');
  assert.equal(restartEnabled('Application Engine', 'Y'), '0');
  // No program by that name: the SQLExec finds nothing, so restart is enabled.
  assert.equal(restartEnabled('Application Engine', undefined), '1');
  // Other process types keep the record default.
  assert.equal(restartEnabled('SQR Report', 'Y'), undefined);
  assert.equal(NEW_PROCESS_DEFAULTS.RESTARTENABLED, '0');
});
