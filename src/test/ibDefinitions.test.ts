import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage, renderOperation, renderService } from '../model/ibDefinitions.js';

const T = new Map([['RTNGTYPE', new Map([['A', 'Asynchronous - One Way'], ['S', 'Synchronous']])], ['ACTIVE_FLAG', new Map([['A', 'Active']])],
  ['EFF_STATUS', new Map([['A', 'Active']])]]);

test('a rowset message: versions and their record structure under "--" roots, and its operations', () => {
  const text = renderMessage('WORKFORCE_SYNC', {
    message: { DESCR: 'Workforce', DEFAULTVER: ' ' },
    versions: [{ APMSGVER: 'VERSION_1', IB_MSGTYPE: 1 }],
    records: [
      { APMSGVER: 'VERSION_1', RECNAME: 'JOB_V1', PRNTRECNAME: 'EMPLOYMENT_V1', SEQNO: 0 },
      { APMSGVER: 'VERSION_1', RECNAME: 'EMPLOYMENT_V1', PRNTRECNAME: '--', SEQNO: 0 },
      { APMSGVER: 'VERSION_1', RECNAME: 'COMPENSATION_V1', PRNTRECNAME: 'JOB_V1', SEQNO: 1 }
    ],
    operations: [{ IB_OPERATIONNAME: 'WORKFORCE_SYNC', VERSIONNAME: 'v1' }],
    translates: T
  });
  assert.ok(!text.includes('Default version'));
  assert.match(text, /Version VERSION_1 {3}Type: Rowset\n {4}EMPLOYMENT_V1\n {6}JOB_V1\n {8}COMPENSATION_V1\n/);
  assert.match(text, /Used by: WORKFORCE_SYNC\.v1/);
});

test('a service and a service operation (PSQRY_STATS on HRDMO)', () => {
  const svc = renderService('PSQRY_STATS', {
    service: { DESCR: 'Query stats service', IB_NAMESPACE: 'http://xmlns.oracle.com/Enterprise/Tools/services' },
    operations: [{ IB_OPERATIONNAME: 'PSQRY_STATS_UPDATE', RTNGTYPE: 'A', DESCR: 'Query stats update' }], translates: T
  });
  assert.match(svc, /PSQRY_STATS_UPDATE +Asynchronous - One Way +Query stats update/);
  const op = renderOperation('PSQRY_STATS_UPDATE', {
    operation: { DESCR: 'Query stats update', IB_SERVICENAME: 'PSQRY_STATS', RTNGTYPE: 'A', DEFAULTVER: 'v1' },
    versions: [{ VERSIONNAME: 'v1', ACTIVE_FLAG: 'A', DESCR: 'Query stats update' }],
    parameters: [{ VERSIONNAME: 'v1', PARAMETERNAME: 'REQUEST', MSGNAME: 'PSQRY_STATS_MSG', IB_MSGVERSION: 'VERSION_1', QUEUENAME: 'PSQRY_STATS' }],
    handlers: [{ HANDLERNAME: 'PSQRY_STATS', HANDLERTYPE: 'ApplicationClass', ACTIVE_FLAG: 'A', HANDLERID: 'NOTF', SEQNO: 1 }],
    routings: [{ ROUTINGDEFNNAME: '~GENERATED~69163181', SENDERNODENAME: 'PSFT_HR', RECEIVERNODENAME: 'PSFT_HR', EFF_STATUS: 'A' }],
    translates: T
  });
  assert.match(op, /Service: PSQRY_STATS {3}Type: Asynchronous - One Way {3}Default version: v1/);
  assert.match(op, /Version v1 \(default\) {3}Active -- Query stats update\n {4}REQUEST +PSQRY_STATS_MSG\.VERSION_1 {3}queue PSQRY_STATS/);
  assert.match(op, /PSQRY_STATS +ApplicationClass +Active +NOTF/);
  assert.match(op, /~GENERATED~69163181 +PSFT_HR -> PSFT_HR {3}Active/);
});
