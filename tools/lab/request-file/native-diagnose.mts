/** Read-only native metadata diagnosis for the synthetic acceptance program. */
import oracledb from 'oracledb';
import { writeFile } from 'node:fs/promises';
oracledb.fetchAsBuffer = [oracledb.BLOB];
oracledb.fetchAsString = [oracledb.CLOB];
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO only.');
const instance = Number(process.argv[2] ?? 607102);
if (!Number.isSafeInteger(instance) || instance <= 0) throw new Error('Pass a positive native process instance.');
const c = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
try {
    await c.execute('SET TRANSACTION READ ONLY');
    const q = async (sql: string, binds = {}) => (await c.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;
    const keys = Array.from({ length: 7 }, (_, i) => `OBJECTID${i + 1}, OBJECTVALUE${i + 1}`).join(', ');
    const report = {
        labRunControl: await q("SELECT OPRID,AE_APPLID,PROCESS_FREQUENCY FROM SYSADM.PS_AEREQUESTTBL WHERE AE_APPLID='ZZ_RF_EXPORT' AND OPRID='JARED'"),
        selectiveTraceEnable: await q("SELECT OPRID,PTAE_ST_ENABLETRC FROM SYSADM.PS_PTAE_ST_ENABLE WHERE OPRID='JARED'"),
        selectiveTraceScope: await q("SELECT * FROM SYSADM.PS_PTAE_ST_TRACLVL WHERE OPRID='JARED'"),
        labRequests: await q("SELECT PRCSINSTANCE,PRCSNAME,RUNCNTLID,SERVERNAMERUN,RUNSTATUS,PRCSRTNCD,DISTSTATUS,RQSTDTTM,LASTUPDDTTM FROM SYSADM.PSPRCSQUE WHERE PRCSNAME='ZZ_RF_EXPORT' AND RUNCNTLID='ZZ_RF_ACC_01' ORDER BY PRCSINSTANCE DESC"),
        processRequest: await q("SELECT PRCSINSTANCE,PRCSNAME,SERVERNAMERUN,RUNSTATUS,PRCSRTNCD,DISTSTATUS,OPSYS FROM SYSADM.PSPRCSQUE WHERE PRCSINSTANCE=:instance AND PRCSNAME='ZZ_RF_EXPORT'", { instance }),
        reportFiles: await q("SELECT * FROM SYSADM.PS_CDM_FILE_LIST WHERE PRCSINSTANCE=:instance", { instance }),
        reports: await q("SELECT PRCSINSTANCE,CONTENTID,PRCSOUTPUTDIR,DISTSTATUS,DISTNODENAME,OUTPUTDIR,ADMIN_FILENAME,FILENAME FROM SYSADM.PS_CDM_LIST WHERE PRCSINSTANCE=:instance", { instance }),
        reportNode: await q("SELECT DISTNODENAME,PT_TRANSFR_PROTCOL,URI_HOST,URI_PORT,URI_RESOURCE,URI_SCHEME,URI_RPT FROM SYSADM.PS_CDM_DIST_NODE WHERE DISTNODENAME IN (SELECT DISTNODENAME FROM SYSADM.PS_SERVERDEFN WHERE SERVERNAME='HCMDMO')"),
        diagnosticColumns: await q("SELECT TABLE_NAME,COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER='SYSADM' AND TABLE_NAME IN ('PS_CDM_FILE_LIST','PS_CDM_LIST','PS_CDM_DIST_NODE','PSPRCSQUE','PS_SERVERDEFN','PS_PTAE_ST_ENABLE','PS_PTAE_ST_TRACLVL') ORDER BY TABLE_NAME,COLUMN_ID"),
        programs: await q("SELECT * FROM SYSADM.PSAEAPPLDEFN WHERE AE_APPLID IN ('ZZ_RF_EXPORT','AEMINITEST','PSPM_REAPER')"),
        variants: await q("SELECT * FROM SYSADM.PSAESECTDTLDEFN WHERE AE_APPLID IN ('ZZ_RF_EXPORT','AEMINITEST')"),
        steps: await q("SELECT * FROM SYSADM.PSAESTEPDEFN WHERE AE_APPLID IN ('ZZ_RF_EXPORT','AEMINITEST')"),
        actions: await q("SELECT * FROM SYSADM.PSAESTMTDEFN WHERE AE_APPLID IN ('ZZ_RF_EXPORT','AEMINITEST')"),
        peopleCode: await q(`SELECT ${keys}, PROGSEQ, VERSION, NAMECOUNT, PROGLEN, PROGRUNLOC, PROGFLAGS, LICENSE_CODE, PROGEXTENDS, PTTOOLSREL, PROGTXT FROM SYSADM.PSPCMPROG WHERE OBJECTID1=66 AND OBJECTVALUE1 IN ('ZZ_RF_EXPORT','AEMINITEST','PSPM_REAPER') ORDER BY OBJECTVALUE1,OBJECTVALUE2,OBJECTVALUE6,PROGSEQ`),
        nativeBuiltinNames: await q("SELECT * FROM SYSADM.PSPCMNAME WHERE OBJECTID1=66 AND RECNAME='PACKAGE' AND REFNAME IN ('FILE','SQL') AND ROWNUM<=8"),
        names: await q(`SELECT * FROM SYSADM.PSPCMNAME WHERE OBJECTID1=66 AND OBJECTVALUE1='ZZ_RF_EXPORT' ORDER BY NAMENUM`)
    };
    for (const row of report.peopleCode as Record<string, any>[]) {
        const bytes = row.PROGTXT; delete row.PROGTXT;
        row.STORED_BYTES = Buffer.isBuffer(bytes) ? bytes.length : 0;
        row.HEADER_HEX = Buffer.isBuffer(bytes) ? bytes.subarray(0, 128).toString('hex') : null;
    }
    await writeFile('/tmp/psft-ae-runtime-diagnosis.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
} finally { await c.rollback(); await c.close(); }
