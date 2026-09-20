import oracledb from 'oracledb';
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
const conn = await oracledb.getConnection({
  user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING
});
try {
  const r = await conn.execute(
    `SELECT NAMENUM, RECNAME, REFNAME FROM SYSADM.PSPCMNAME
      WHERE OBJECTVALUE1 = 'WEBLIB_OU_LP' AND OBJECTVALUE2 = 'ISCRIPT2'
      ORDER BY NAMENUM FETCH FIRST 12 ROWS ONLY`);
  for (const x of r.rows) {
    console.log(`${String(x.NAMENUM).padStart(3)}  RECNAME=${JSON.stringify((x.RECNAME||'').trim()).padEnd(18)} REFNAME=${JSON.stringify((x.REFNAME||'').trim())}`);
  }
  // How often is RECNAME non-blank corpus-wide?
  const agg = await conn.execute(
    `SELECT COUNT(*) AS TOTAL, SUM(CASE WHEN TRIM(RECNAME) IS NOT NULL AND TRIM(RECNAME) <> '' THEN 1 ELSE 0 END) AS QUALIFIED
       FROM SYSADM.PSPCMNAME WHERE OBJECTVALUE1 LIKE 'WEBLIB%' OR OBJECTVALUE1 LIKE 'OU_%'`);
  console.log('\nPSPCMNAME rows sampled:', agg.rows[0].TOTAL, 'with a non-blank RECNAME:', agg.rows[0].QUALIFIED);
} finally {
  await conn.close();
}
