// SELECT-only full source-indexed corpus capture, streamed as one definition
// per JSON line. No CLOB/BLOB truncation; all fourteen key columns are joined.
// Usage: node scripts/capture-database-corpus.mjs OUT.jsonl
import { openSync, closeSync, writeSync, writeFileSync } from 'node:fs';
import oracledb from 'oracledb';
const output = process.argv[2];
if (!output) throw new Error('Provide an output JSONL path');
const columns = [1, 2, 3, 4, 5, 6, 7].flatMap(i => [`OBJECTID${i}`, `OBJECTVALUE${i}`]);
const keyOf = row => JSON.stringify(columns.map(c => row[c]));
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];
const connection = await oracledb.getConnection({ user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING });
const file = openSync(output, 'w');
const summary = { startedAt: new Date().toISOString(), groups: [], definitions: 0, sourceChunks: 0, programChunks: 0, nameRows: 0, compiledDefinitionsWithoutSource: 0 };
try {
  const groups = (await connection.execute('SELECT OBJECTID1, COUNT(*) AS N FROM SYSADM.PSPCMTXT GROUP BY OBJECTID1 ORDER BY OBJECTID1')).rows;
  const join = columns.map(c => `t.${c} = p.${c}`).join(' AND ');
  summary.compiledDefinitionsWithoutSource = (await connection.execute(
    `SELECT COUNT(*) AS N FROM (SELECT DISTINCT ${columns.map(c => 'p.' + c).join(', ')} FROM SYSADM.PSPCMPROG p
     WHERE NOT EXISTS (SELECT 1 FROM SYSADM.PSPCMTXT t WHERE ${join}))`
  )).rows[0].N;
  for (const group of groups) {
    const corpus = new Map();
    const sources = (await connection.execute(`SELECT * FROM SYSADM.PSPCMTXT WHERE OBJECTID1 = :id ORDER BY ${columns.join(', ')}, PROGSEQ`, { id: group.OBJECTID1 })).rows;
    for (const row of sources) {
      const id = keyOf(row);
      if (!corpus.has(id)) corpus.set(id, { key: Object.fromEntries(columns.map(c => [c, row[c]])), source: '', sourceRows: [], programRows: [], names: [] });
      const entry = corpus.get(id);
      entry.source += row.PCTEXT;
      entry.sourceRows.push(row);
    }
    const resultCounts = {};
    for (const [table, order, property] of [['PSPCMPROG', 'PROGSEQ', 'programRows'], ['PSPCMNAME', 'NAMENUM', 'names']]) {
      // getRows keeps the binary/name result set bounded within a source group.
      const result = await connection.execute(`SELECT p.* FROM SYSADM.${table} p WHERE p.OBJECTID1 = :id AND EXISTS
        (SELECT 1 FROM SYSADM.PSPCMTXT t WHERE ${join}) ORDER BY ${columns.map(c => 'p.' + c).join(', ')}, p.${order}`, { id: group.OBJECTID1 }, { resultSet: true });
      let count = 0;
      try {
        for (;;) {
          const rows = await result.resultSet.getRows(100);
          if (!rows.length) break;
          for (const row of rows) {
            const entry = corpus.get(keyOf(row));
            if (!entry) throw new Error('Compiled row lacks exact source key');
            if (property === 'programRows') {
              const { PROGTXT, ...metadata } = row;
              entry.programRows.push({ ...metadata, hex: PROGTXT.toString('hex') });
            } else entry.names.push(row);
            count++;
          }
        }
      } finally { await result.resultSet.close(); }
      resultCounts[property] = count;
    }
    for (const entry of corpus.values()) writeSync(file, JSON.stringify(entry) + '\n');
    const item = { objectId1: group.OBJECTID1, definitions: corpus.size, sourceChunks: sources.length, programChunks: resultCounts.programRows, nameRows: resultCounts.names };
    summary.groups.push(item);
    for (const field of ['definitions', 'sourceChunks', 'programChunks', 'nameRows']) summary[field] += item[field];
    console.log(JSON.stringify(item));
  }
  summary.completedAt = new Date().toISOString();
  writeFileSync(output + '.manifest.json', JSON.stringify(summary, null, 2));
  console.log(`Captured ${summary.definitions} definitions; ${summary.compiledDefinitionsWithoutSource} compiled definitions have no PSPCMTXT source`);
} finally {
  closeSync(file);
  await connection.close();
}
