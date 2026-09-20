// One-off diagnostic: dumps the actual columns of every PeopleTools table
// src/providers/oracle.ts queries, so code can be fixed against the real
// schema instead of guessed at one ORA-00904 at a time.
//
// Usage:
//   PS_CONNECT_STRING=host:port/service PS_USER=SYSADM PS_PASSWORD=*** \
//     node scripts/schema-check.mjs
//
// If your PeopleTools tables live under a schema other than SYSADM, also set
// PS_OWNER.

import oracledb from 'oracledb';

const owner = process.env.PS_OWNER || 'SYSADM';
const tables = [
  'PSPROJECTDEFN', 'PSPROJECTITEM', 'PSRECDEFN', 'PSDBFIELD', 'PSPNLDEFN',
  'PSPNLGRPDEFN', 'PSMENUDEFN', 'PSAEAPPLDEFN', 'PSPACKAGEDEFN', 'PSSQLDEFN',
  'PSSQLTEXTDEFN', 'PSRECFIELDALL', 'PSRECFIELD', 'PSPNLGROUP', 'PSPCMPROG',
  'PSPCMNAME', 'PSVERSION', 'PSLOCK'
];

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const connectString = process.env.PS_CONNECT_STRING;
const user = process.env.PS_USER;
const password = process.env.PS_PASSWORD;

if (!connectString || !user || !password) {
  console.error('Set PS_CONNECT_STRING, PS_USER, PS_PASSWORD (and optionally PS_OWNER).');
  process.exit(1);
}

const conn = await oracledb.getConnection({ user, password, connectString });
try {
  for (const table of tables) {
    const r = await conn.execute(
      `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS
        WHERE OWNER = :ownerName AND TABLE_NAME = :tableName
        ORDER BY COLUMN_ID`,
      { ownerName: owner, tableName: table });
    const rows = r.rows ?? [];
    console.log(`\n=== ${owner}.${table} (${rows.length} columns) ===`);
    if (rows.length === 0) {
      console.log('  (not found -- wrong owner, or table does not exist)');
      continue;
    }
    for (const row of rows) console.log(`  ${row.COLUMN_NAME} (${row.DATA_TYPE})`);
  }
} finally {
  await conn.close();
}
