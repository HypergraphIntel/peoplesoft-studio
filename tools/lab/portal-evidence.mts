/** Read-only native registry population evidence. Row values are not retained. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import oracledb from 'oracledb';
import { portalUrlChecksum } from '../../src/model/portalDocument.js';
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
const c = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo' });
try {
  assert.equal((await c.execute<{ DB: string }>("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL")).rows?.[0].DB, 'HRDMO');
  const rows = (await c.execute<{ PORTAL_URL_CHKSUM: number; PORTAL_URLTEXT: string }>("SELECT PORTAL_URL_CHKSUM,PORTAL_URLTEXT FROM PSPRSMDEFN WHERE PORTAL_REFTYPE='C' AND PORTAL_URLTEXT IS NOT NULL AND PORTAL_OBJNAME NOT LIKE 'ZZ_PORTAL_%'", {}, { fetchTypeHandler: m => m.dbType === oracledb.DB_TYPE_CLOB ? { type: oracledb.STRING } : undefined })).rows!;
  const matches = rows.filter(r => portalUrlChecksum(r.PORTAL_URLTEXT) === r.PORTAL_URL_CHKSUM).length;
  assert.equal(matches, rows.length);
  const result = { peopleToolsRelease: '8.62.09', population: rows.length, matches, mismatches: rows.length - matches,
    selection: 'Content references with non-null URL text, excluding Studio portal integration fixtures',
    checksum: 'Sum of one-based character position multiplied by character value',
    script: 'tools/lab/portal-evidence.mts' };
  writeFileSync('tools/lab/results/portal-native-evidence.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await c.close(); }
