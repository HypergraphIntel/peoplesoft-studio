// A program's PSPCMNAME rows, and how often RECNAME is filled across programs with a prefix:
//   node scripts/check-recname.mjs <OBJECTVALUE1> <OBJECTVALUE2> [<OBJECTVALUE1 prefix>]
import oracledb from 'oracledb';
const [value1, value2, prefix = value1?.slice(0, 3)] = process.argv.slice(2);
if (!value1 || !value2) { console.error('usage: node scripts/check-recname.mjs <OBJECTVALUE1> <OBJECTVALUE2> [<prefix>]'); process.exit(2); }
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
const conn = await oracledb.getConnection({
  user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING
});
try {
  const r = await conn.execute(
    `SELECT NAMENUM, RECNAME, REFNAME FROM SYSADM.PSPCMNAME
      WHERE OBJECTVALUE1 = :v1 AND OBJECTVALUE2 = :v2
      ORDER BY NAMENUM FETCH FIRST 12 ROWS ONLY`, { v1: value1, v2: value2 });
  for (const x of r.rows) {
    console.log(`${String(x.NAMENUM).padStart(3)}  RECNAME=${JSON.stringify((x.RECNAME||'').trim()).padEnd(18)} REFNAME=${JSON.stringify((x.REFNAME||'').trim())}`);
  }
  // How often is RECNAME non-blank corpus-wide?
  const agg = await conn.execute(
    `SELECT COUNT(*) AS TOTAL, SUM(CASE WHEN TRIM(RECNAME) IS NOT NULL AND TRIM(RECNAME) <> '' THEN 1 ELSE 0 END) AS QUALIFIED
       FROM SYSADM.PSPCMNAME WHERE OBJECTVALUE1 LIKE :p`, { p: `${prefix}%` });
  console.log('\nPSPCMNAME rows sampled:', agg.rows[0].TOTAL, 'with a non-blank RECNAME:', agg.rows[0].QUALIFIED);
} finally {
  await conn.close();
}
