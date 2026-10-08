import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type { Connection } from 'oracledb';
import { detectSchema } from '../db/oracle.js';
import { editableFields, validateConnectionEdit } from '../settings/settingsModel.js';
import type { ConnectionConfig } from '../workspace.js';

/** Every product source file (the tests excluded). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'test' ? [] : sources(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

test('no query names the SYSADM schema: the session\'s CURRENT_SCHEMA resolves the PeopleTools tables', () => {
  const offenders = sources('src').filter((f) => /SYSADM\.[A-Z_$]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
  // The data dictionary is asked about the session's schema, never a fixed owner.
  const dictionary = sources('src').filter((f) => /OWNER\s*=\s*'/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(dictionary, []);
});

const fake = (rows: unknown[] | Error) => ({
  execute: async () => { if (rows instanceof Error) throw rows; return { rows }; }
}) as unknown as Connection;

test('the schema is detected from PS.PSDBOWNER: this database\'s row, else its only row', async () => {
  assert.equal(await detectSchema(fake([{ DBNAME: 'HRDMO', OWNERID: 'SYSADM', DB: 'HRDMO' }])), 'SYSADM');
  assert.equal(await detectSchema(fake([
    { DBNAME: 'HRDEV', OWNERID: 'EMDBO', DB: 'HRTST' }, { DBNAME: 'HRTST', OWNERID: 'PSOWNER', DB: 'HRTST' }])), 'PSOWNER');
  assert.equal(await detectSchema(fake([{ DBNAME: 'OTHER', OWNERID: 'emdbo', DB: 'HRDMO' }])), 'EMDBO');
  assert.equal(await detectSchema(fake([
    { DBNAME: 'A', OWNERID: 'X', DB: 'C' }, { DBNAME: 'B', OWNERID: 'Y', DB: 'C' }])), undefined);
  assert.equal(await detectSchema(fake([])), undefined);
  assert.equal(await detectSchema(fake(new Error('ORA-00942: table or view does not exist'))), undefined);
  assert.equal(await detectSchema(fake([{ DBNAME: 'HRDMO', OWNERID: 'X; DROP', DB: 'HRDMO' }])), undefined);
});

test('a connection\'s schema is editable: upper-cased, validated, empty for detection', () => {
  const base: ConnectionConfig = { name: 'HR', kind: 'oracle', connectString: 'h:1521/HR', user: 'PEOPLE' };
  assert.ok(editableFields({ kind: 'oracle' }).includes('schema'));
  const set = validateConnectionEdit(base, { schema: ' emdbo ' });
  assert.ok(set.ok && set.value.schema === 'EMDBO');
  const cleared = validateConnectionEdit({ ...base, schema: 'EMDBO' }, { schema: '' });
  assert.ok(cleared.ok && !('schema' in cleared.value));
  const bad = validateConnectionEdit(base, { schema: 'SYSADM; DROP' });
  assert.ok(!bad.ok && bad.errors.schema);
});
