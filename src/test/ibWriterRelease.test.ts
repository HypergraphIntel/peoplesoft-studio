import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbConnection } from '../db/connection.js';
import { IB_PARENTS, IB_STAMPS } from '../model/ibOperations.js';
import { checkedRow, ibStandardShape, presentIbInput } from '../providers/ibWriter.js';
import { newIbInput } from '../model/ibNew.js';

/*
 * The creation defaults were observed on 8.62.09 and name two 8.62 columns:
 * PSOPERATION.URL_ID and PSMSGNODEDEFN.PTIB_NOPING. HCDEV 8.61.15 has neither, so
 * a new service operation or node there must not write them.
 */

function catalog(table: string, columns: string[], defaults: Record<string, unknown>): DbConnection {
  const type = (name: string) => (typeof defaults[name] === 'number' ? 'NUMBER' : /DESCRLONG/.test(name) ? 'CLOB' : name === 'LASTUPDDTTM' ? 'TIMESTAMP(6)' : 'VARCHAR2');
  return { catalog: { columns: async (_c: DbConnection, t: string) => (t === table ? columns : []).map((name) => ({ name, dataType: type(name) })),
    tableExists: async () => true }, execute: async () => ({ rows: [] }) } as unknown as DbConnection;
}

for (const [kind, key, column] of [['operation', 'IB_OPERATIONNAME', 'URL_ID'], ['node', 'MSGNODENAME', 'PTIB_NOPING']] as const) {
  const table = IB_PARENTS[kind];
  const on862 = [key, ...Object.keys(table.defaults), ...IB_STAMPS];
  const on861 = on862.filter((c) => c !== column);

  test(`a new ${kind} on 8.61 leaves out ${column}; on 8.62 it is written`, async () => {
    assert.ok(column in table.defaults, `${column} is a calibrated ${kind} default`);
    const parent = { [key]: 'ZZ_RELEASE_TEST' };
    const old = await checkedRow(catalog(table.table, on861, table.defaults), table, {}, undefined, parent);
    assert.ok(!(column in old));
    const current = await checkedRow(catalog(table.table, on862, table.defaults), table, {}, undefined, parent);
    assert.ok(column in current);
  });

  test(`a ${kind} edit naming ${column} on 8.61 is still refused, not dropped`, async () => {
    await assert.rejects(checkedRow(catalog(table.table, on861, table.defaults), table, { [column]: column === 'URL_ID' ? 'X' : 1 }, undefined, { [key]: 'ZZ_RELEASE_TEST' }),
      new RegExp(`${column} is not a stored column`));
  });
}

test('a new input offers only the columns this release stores, so the writer accepts it', async () => {
  // psft_ib_new on 8.61.15 handed out PSOPERATION.URL_ID, which the writer then refused
  // as not a stored column.
  const table = IB_PARENTS.operation;
  const on861 = ['IB_OPERATIONNAME', ...Object.keys(table.defaults), ...IB_STAMPS].filter((c) => c !== 'URL_ID');
  const input = newIbInput('operation', ['ZZ_RELEASE_TEST'], { operationType: 'S' }, {}, 'ENG', { IB_SERVICENAME: 'ZZ_SERVICE', IB_REST_SERVICE: 0 }, '8.61');
  assert.ok('URL_ID' in input.properties);
  const shaped = await presentIbInput(catalog(table.table, on861, table.defaults), input);
  assert.ok(!('URL_ID' in shaped.properties));
  assert.equal(shaped.properties.DEFAULTVER, 'v1');
  assert.equal(shaped.sections.versions.length, 1, 'sections of tables the catalog does not list are kept as they are');
});

test('8.61.15 writes only the shapes matched to PIA there', () => {
  const op = newIbInput('operation', ['ZZ_OP'], { operationType: 'S' }, {}, 'ENG', { IB_SERVICENAME: 'ZZ_SERVICE', IB_REST_SERVICE: 0 });
  assert.equal(ibStandardShape(op), true);
  assert.equal(ibStandardShape({ ...op, sections: { ...op.sections, handlers: [{ HANDLERNAME: 'REQUESTHDLR' }] } }), false);
  assert.equal(ibStandardShape(newIbInput('operation', ['ZZ_OP'], { method: 'GET' }, {}, 'ENG', { IB_SERVICENAME: 'ZZ_REST', IB_REST_SERVICE: 2 })), false);
  assert.equal(ibStandardShape(newIbInput('service', ['ZZ_S'], { serviceKind: 'standard' }, {}, 'ENG')), true);
  assert.equal(ibStandardShape(newIbInput('service', ['ZZ_S'], { serviceKind: 'rest', restRole: 'provider' }, {}, 'ENG')), false);
  const message = newIbInput('message', ['ZZ_M'], {}, {}, 'ENG');
  assert.equal(ibStandardShape(message), true);
  assert.equal(ibStandardShape({ ...message, sections: { ...message.sections, records: [{ RECNAME: 'ZZ_REC' }] } }), false);
  assert.equal(ibStandardShape(newIbInput('node', ['ZZ_N'], {}, {}, 'ENG')), false);
});
