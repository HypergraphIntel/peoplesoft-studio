// Read-only: finds the full 7-part PSPCMPROG key for an Application Class
// program by name, via DBMS_LOB.INSTR on PROGTXT (no PROGTXT is ever
// printed). Usage: node scripts/find-appclass.mjs PACKAGE ClassName
import oracledb from 'oracledb';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
const conn = await oracledb.getConnection({
  user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING
});

const needle = process.argv[3]; // class name, searched as UTF-16LE bytes in PROGTXT
try {
  const hex = Buffer.from(needle, 'utf16le').toString('hex');
  const r = await conn.execute(
    `SELECT OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, OBJECTVALUE4, OBJECTVALUE5,
            OBJECTVALUE6, OBJECTVALUE7, PROGSEQ, DBMS_LOB.GETLENGTH(PROGTXT) AS LEN
       FROM SYSADM.PSPCMPROG
      WHERE OBJECTVALUE1 = :pkg
        AND DBMS_LOB.INSTR(PROGTXT, HEXTORAW(:hex)) > 0
      ORDER BY OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, OBJECTVALUE7, PROGSEQ`,
    { pkg: process.argv[2], hex });
  for (const row of r.rows) console.log(row);
} finally {
  await conn.close();
}
