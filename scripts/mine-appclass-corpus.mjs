// SELECT-only bulk corpus capture. Usage: node scripts/mine-appclass-corpus.mjs OUT.json
// Restrict every table to the exact seven ID/value keys present in PSPCMTXT.
import { writeFileSync } from 'node:fs';
import oracledb from 'oracledb';
const output = process.argv[2];
if (!output) throw new Error('Provide an output JSON path');
const columns = [1, 2, 3, 4, 5, 6, 7].flatMap(i => [`OBJECTID${i}`, `OBJECTVALUE${i}`]);
const keyOf = row => JSON.stringify(columns.map(column => row[column]));
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];
const connection = await oracledb.getConnection({
  user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING
});
try {
  const sources = (await connection.execute(
    `SELECT * FROM SYSADM.PSPCMTXT WHERE OBJECTID1 = 104 ORDER BY ${columns.join(', ')}, PROGSEQ`
  )).rows;
  const corpus = new Map();
  for (const row of sources) {
    const id = keyOf(row);
    if (!corpus.has(id)) corpus.set(id, { key: Object.fromEntries(columns.map(c => [c, row[c]])), source: '', sourceRows: [], programRows: [], names: [] });
    const entry = corpus.get(id);
    entry.source += row.PCTEXT;
    entry.sourceRows.push(row);
  }
  console.log(`Source: ${sources.length} chunks, ${corpus.size} definitions`);
  const exactJoin = columns.map(c => `t.${c} = p.${c}`).join(' AND ');
  for (const [table, order, property] of [['PSPCMPROG', 'PROGSEQ', 'programRows'], ['PSPCMNAME', 'NAMENUM', 'names']]) {
    const result = await connection.execute(
      `SELECT p.* FROM SYSADM.${table} p WHERE p.OBJECTID1 = 104 AND EXISTS
       (SELECT 1 FROM SYSADM.PSPCMTXT t WHERE ${exactJoin})
       ORDER BY ${columns.map(c => 'p.' + c).join(', ')}, p.${order}`
    );
    for (const row of result.rows) {
      const entry = corpus.get(keyOf(row));
      if (!entry) throw new Error('Compiled row has no exact source key');
      if (property === 'programRows') {
        const { PROGTXT, ...metadata } = row;
        entry.programRows.push({ ...metadata, hex: PROGTXT.toString('hex') });
      } else entry.names.push(row);
    }
    console.log(`${table}: ${result.rows.length} rows`);
  }
  writeFileSync(output, JSON.stringify([...corpus.values()]));
  console.log(`Saved ${corpus.size} complete source/name/program captures to ${output}`);
} finally {
  await connection.close();
}
