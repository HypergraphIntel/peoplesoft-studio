// Read-only complete calibration capture. No decoder/encoder participates.
// Usage: node scripts/capture-peoplecode.mjs OUT.json v1 v2 v3 [v4 ... v7]
import { writeFileSync } from 'node:fs';
import oracledb from 'oracledb';

const [output, ...parts] = process.argv.slice(2);
if (!output || parts.length < 1 || parts.length > 7) {
  throw new Error('Usage: capture-peoplecode.mjs OUT.json v1 [v2 ... v7]');
}
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];
const connection = await oracledb.getConnection({
  user: process.env.PS_USER,
  password: process.env.PS_PASSWORD,
  connectString: process.env.PS_CONNECT_STRING
});
try {
  const indices = [1, 2, 3, 4, 5, 6, 7];
  const columns = indices.flatMap(i => [`OBJECTID${i}`, `OBJECTVALUE${i}`]);
  const valueBinds = Object.fromEntries(indices.map(i => [`v${i}`, parts[i - 1] ?? ' ']));
  const valueWhere = indices.map(i => `OBJECTVALUE${i} = :v${i}`).join(' AND ');
  const candidates = (await connection.execute(
    `SELECT DISTINCT ${columns.join(', ')} FROM SYSADM.PSPCMTXT WHERE ${valueWhere}`, valueBinds
  )).rows;
  if (candidates.length !== 1) throw new Error(`Expected one exact source definition, found ${candidates.length}`);
  const key = candidates[0];
  const binds = Object.fromEntries(columns.map((column, i) => [`k${i}`, key[column]]));
  const where = columns.map((column, i) => `${column} = :k${i}`).join(' AND ');
  const sourceRows = (await connection.execute(
    `SELECT * FROM SYSADM.PSPCMTXT WHERE ${where} ORDER BY PROGSEQ`, binds
  )).rows;
  const chunks = (await connection.execute(
    `SELECT * FROM SYSADM.PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds
  )).rows;
  if (chunks.length === 0) throw new Error('Source has no corresponding compiled program');
  const names = (await connection.execute(
    `SELECT * FROM SYSADM.PSPCMNAME WHERE ${where} ORDER BY NAMENUM`, binds
  )).rows;
  const programRows = chunks.map(({ PROGTXT, ...row }) => ({ ...row, hex: PROGTXT.toString('hex') }));
  const capture = { key, source: sourceRows.map(row => row.PCTEXT).join(''), sourceRows, programRows, names };
  writeFileSync(output, JSON.stringify(capture, null, 2) + '\n');
  console.log(`Captured ${chunks.length} program chunks, ${names.length} name rows to ${output}`);
} finally {
  await connection.close();
}
