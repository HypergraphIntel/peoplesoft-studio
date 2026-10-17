import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbConnection } from '../db/connection.js';
import { IB_PARENTS, IB_STAMPS } from '../model/ibOperations.js';
import { checkedRow } from '../providers/ibWriter.js';

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
