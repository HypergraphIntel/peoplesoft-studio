// Read-only: fetches a single PeopleCode program's real PSPCMPROG bytes and
// PSPCMNAME table by its full 7-part key, decodes it, and writes a JSON blob
// (same shape as a corpus-build.mjs entry, minus `source`) to the path given.
// Usage: node scripts/fetch-appclass.mjs OUT.json v1 v2 v3 v4 v5 v6 v7
import { writeFileSync } from 'node:fs';
import oracledb from 'oracledb';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsBuffer = [oracledb.BLOB];
const conn = await oracledb.getConnection({
  user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING
});

const out = process.argv[2];
const parts = process.argv.slice(3);
const binds = {};
for (let i = 0; i < 7; i++) binds[`v${i + 1}`] = parts[i] ?? ' ';
const where = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTVALUE${n} = :v${n}`).join(' AND ');

try {
  const prog = await conn.execute(
    `SELECT PROGSEQ, PROGTXT FROM SYSADM.PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds);
  const names = await conn.execute(
    `SELECT NAMENUM, RECNAME, REFNAME FROM SYSADM.PSPCMNAME WHERE ${where} ORDER BY NAMENUM`, binds);
  const bytes = Buffer.concat(prog.rows.map((r) => r.PROGTXT));
  const nameEntries = names.rows.map((n) => {
    const q = (n.RECNAME ?? '').trim();
    const r = (n.REFNAME ?? '').trim();
    return [n.NAMENUM, q ? `${q}.${r}` : r];
  });
  writeFileSync(out, JSON.stringify({ key: { parts }, bytes: bytes.toString('base64'), names: nameEntries }));
  console.log(`wrote ${out}: ${bytes.length} bytes, ${nameEntries.length} names`);
} finally {
  await conn.close();
}
