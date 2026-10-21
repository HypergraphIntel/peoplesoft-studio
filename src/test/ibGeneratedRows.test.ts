import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatedRoutingName, routingParameters, routingSubdefinition } from '../providers/ibWriter.js';
import { newIbInput } from '../model/ibNew.js';

/*
 * Rows PIA fills in that a caller does not give, matched to PIA's own saves on
 * 8.61.15 (lab XX_IB_* objects) and to the delivered rows on that database:
 * a new routing's parameters and sub-definition, the routing a REST operation
 * generates, and a REST operation's alias.
 */

const LOCAL = 'LAB_LOCAL';

test('a new routing gets the request and, for a synchronous operation, the response with the nodes swapped', () => {
  const inbound = { SENDERNODENAME: 'ZZ_NODE', RECEIVERNODENAME: LOCAL, IB_OPERATIONNAME: 'ZZ_OP', VERSIONNAME: 'v1' };
  assert.deepEqual(routingParameters(inbound, 'S', LOCAL).map((p) => [p.PARAMETERNAME, p.SENDERNODENAME, p.RECEIVERNODENAME, p.ALIASNAME]), [
    ['INREQUEST', 'ZZ_NODE', LOCAL, 'ZZ_OP.v1'], ['OUTRESPONSE', LOCAL, 'ZZ_NODE', 'ZZ_OP.v1']]);
  const outbound = { ...inbound, SENDERNODENAME: LOCAL, RECEIVERNODENAME: 'ZZ_NODE' };
  assert.deepEqual(routingParameters(outbound, 'S', LOCAL).map((p) => p.PARAMETERNAME), ['OUTREQUEST', 'INRESPONSE']);
  assert.deepEqual(routingParameters(outbound, 'A', LOCAL).map((p) => p.PARAMETERNAME), ['OUTREQUEST']);
  assert.deepEqual(routingParameters(inbound, 'A', LOCAL).map((p) => p.PARAMETERNAME), ['INREQUEST']);
  assert.deepEqual(routingParameters({ ...inbound, RECEIVERNODENAME: 'OTHER' }, 'S', LOCAL), [], 'neither end local: no evidence, none generated');
});

test('a sub-definition takes the request alias inbound and the operation name and version outbound', () => {
  const routing = { IB_OPERATIONNAME: 'ZZ_OP_GET', VERSIONNAME: 'v1', RTNGTYPE: 'S' };
  assert.deepEqual(routingSubdefinition({ PARAMETERNAME: 'INREQUEST', SENDERNODENAME: '~~ANY~~', RECEIVERNODENAME: LOCAL, ALIASNAME: 'ZZ_OP.v1' }, routing),
    { IB_DIRECTION: 'I', RTNGTYPE: 'S', SENDERNODENAME: '~~ANY~~', RECEIVERNODENAME: LOCAL, ALIASNAME: 'ZZ_OP.v1' });
  assert.equal(routingSubdefinition({ PARAMETERNAME: 'OUTREQUEST', SENDERNODENAME: LOCAL, RECEIVERNODENAME: 'WADL_NODE', ALIASNAME: 'ZZ_OP.v1' }, routing).ALIASNAME, 'ZZ_OP_GET.v1');
});

test('a generated routing is named as getrandomname("~GENERATED~", 10000000, 99999999) names it', () => {
  assert.equal(generatedRoutingName(() => 0), '~GENERATED~10000000');
  assert.equal(generatedRoutingName(() => 0.4115), `~GENERATED~${Math.floor(0.4115 * 99999999) + 10000000}`);
  assert.match(generatedRoutingName(() => 0.999999999), /^~GENERATED~1\d{8}$/, 'nine digits at the top of the range, as delivered names have');
});

test('a REST operation named <alias>_<METHOD> keeps the alias PIA gives it', () => {
  const service = { IB_SERVICENAME: 'ZZ_REST', IB_REST_SERVICE: 2 };
  assert.equal(newIbInput('operation', ['ZZ_ITEMS_GET'], { service: 'ZZ_REST', method: 'GET' }, {}, 'ENG', service).properties.IB_ALIASNAME, 'ZZ_ITEMS');
  assert.equal(newIbInput('operation', ['ZZ_ITEMS'], { service: 'ZZ_REST', method: 'GET' }, {}, 'ENG', service).properties.IB_ALIASNAME, 'ZZ_ITEMS');
});

test('a REST operation typed without its method is named as PIA names it (ib12/ib16)', () => {
  const service = { IB_SERVICENAME: 'ZZ_REST', IB_REST_SERVICE: 1 };
  const typed = newIbInput('operation', ['ZZ_PCODE_LAB_IBRCG'], { service: 'ZZ_REST', method: 'GET' }, {}, 'ENG', service);
  assert.deepEqual([typed.key, typed.properties.IB_ALIASNAME], [['ZZ_PCODE_LAB_IBRCG_GET'], 'ZZ_PCODE_LAB_IBRCG']);
  assert.deepEqual(newIbInput('operation', ['ZZ_ITEMS_DELETE'], { service: 'ZZ_REST', method: 'DELETE' }, {}, 'ENG', service).key, ['ZZ_ITEMS_DELETE']);
  assert.throws(() => newIbInput('operation', ['ZZ_A_TWENTY_SEVEN_CHARS_XX'], { service: 'ZZ_REST', method: 'PATCH' }, {}, 'ENG', service), /exceeds 30 characters/);
  assert.deepEqual(newIbInput('operation', ['ZZ_STD'], { operationType: 'S' }, {}, 'ENG', { IB_SERVICENAME: 'ZZ_S', IB_REST_SERVICE: 0 }).key, ['ZZ_STD'], 'standard operations keep their name');
});
