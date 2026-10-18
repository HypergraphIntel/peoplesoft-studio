import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbConnection } from '../db/connection.js';
import { chooseTablespace } from '../providers/recordWriter.js';
import { RecordSaveRefusedError } from '../model/recordEdit.js';

/** A tablespace catalog (PSTBLSPCCAT) of these names, all in one database. */
function catalog(names: string[]): DbConnection {
  return {
    execute: async (sql: string, binds: Record<string, unknown> = {}) => {
      const rows = names.map((n) => ({ DDLSPACENAME: n, DBNAME: 'PSDB' })).sort((a, b) => a.DDLSPACENAME.localeCompare(b.DDLSPACENAME));
      return { rows: /WHERE DDLSPACENAME = :s/.test(sql) ? rows.filter((r) => r.DDLSPACENAME === binds.s) : rows.slice(0, 1) };
    }
  } as unknown as DbConnection;
}

test('an SQL Table goes in the tablespace asked for, which must be in the catalog', async () => {
  assert.deepEqual(await chooseTablespace(catalog(['HRAPP', 'AAAPP']), 'hrapp'), { DDLSPACENAME: 'HRAPP', DBNAME: 'PSDB' });
  await assert.rejects(chooseTablespace(catalog(['HRAPP']), 'NOSUCH'), (e: unknown) => e instanceof RecordSaveRefusedError && /NOSUCH is not in the tablespace catalog/.test((e as Error).message));
});

test('without a choice, the catalog\'s first entry, as before', async () => {
  assert.equal((await chooseTablespace(catalog(['HRAPP', 'AAAPP']), undefined)).DDLSPACENAME, 'AAAPP');
  await assert.rejects(chooseTablespace(catalog([]), undefined), /catalog \(PSTBLSPCCAT\) is empty/);
});
