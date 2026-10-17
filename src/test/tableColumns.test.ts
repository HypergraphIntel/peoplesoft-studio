import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbConnection } from '../db/connection.js';
import { columnOrNull, presentOnly, tableColumns } from '../providers/tableColumns.js';

/*
 * PeopleTools 8.61.12: saving a new page with a run-control subpage failed with
 * ORA-00904 "PTDISABLESMARTPROM": invalid identifier. Smart Prompt is an 8.62 column;
 * on 8.61 PSPNLFIELDEXT does not have it, so a read names NULL and a write leaves it out.
 */

const PSPNLFIELDEXT_861 = ['PNLNAME', 'PNLFLDID', 'FFSTYLELONG', 'FIELDUSETEMP2', 'PTPOPUPPNL'];

function connection(columns: Record<string, string[]>): { c: DbConnection; reads: () => number } {
  let reads = 0;
  const c = {
    catalog: { columns: async (_c: DbConnection, table: string) => { reads++; return (columns[table] ?? []).map((name) => ({ name, dataType: 'VARCHAR2' })); }, tableExists: async () => true },
    execute: async () => ({ rows: [] }), commit: async () => {}, rollback: async () => {}, close: async () => {}
  } as unknown as DbConnection;
  return { c, reads: () => reads };
}

test('a column a later PeopleTools added is read as NULL, the rest by name', async () => {
  const { c, reads } = connection({ PSPNLFIELDEXT: PSPNLFIELDEXT_861 });
  const have = await tableColumns(c, 'PSPNLFIELDEXT');
  assert.equal(columnOrNull(have, 'E', 'PTDISABLESMARTPROM'), 'NULL AS PTDISABLESMARTPROM');
  assert.equal(columnOrNull(have, 'E', 'PTDISABLESMARTPROM', 'EXT_PTDISABLESMARTPROM'), 'NULL AS EXT_PTDISABLESMARTPROM');
  assert.equal(columnOrNull(have, 'E', 'PTPOPUPPNL'), 'E.PTPOPUPPNL');
  assert.equal(columnOrNull(have, 'E', 'PTPOPUPPNL', 'EXT_PTPOPUPPNL'), 'E.PTPOPUPPNL AS EXT_PTPOPUPPNL');
  assert.equal(columnOrNull(have, 'E', 'FFSTYLELONG', 'FFSTYLELONG', (x) => `DBMS_LOB.SUBSTR(${x}, 4000, 1)`), 'DBMS_LOB.SUBSTR(E.FFSTYLELONG, 4000, 1) AS FFSTYLELONG');
  // The catalog is read once per connection and table.
  await tableColumns(c, 'PSPNLFIELDEXT');
  assert.equal(reads(), 1);
});

test('an inserted row leaves out what this release\'s table lacks, as its App Designer does', async () => {
  const { c } = connection({ PSPNLFIELDEXT: PSPNLFIELDEXT_861 });
  // A new Edit Box's PSPNLFIELDEXT row as 8.62 writes it (pageControlTemplates.ts).
  const row = { PNLNAME: 'ZZ_NEW_PAGE', PNLFLDID: 1, FFSTYLELONG: ' ', FIELDUSETEMP2: 0, PTPOPUPPNL: ' ', PTDISABLESMARTPROM: 1 };
  const { row: kept, dropped } = presentOnly(row, await tableColumns(c, 'PSPNLFIELDEXT'));
  assert.deepEqual(Object.keys(kept), ['PNLNAME', 'PNLFLDID', 'FFSTYLELONG', 'FIELDUSETEMP2', 'PTPOPUPPNL']);
  assert.deepEqual(dropped, ['PTDISABLESMARTPROM']);
});
