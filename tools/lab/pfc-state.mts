/* Lab: JOB_CODE_TBL's Standard configuration and Event Mapping as read back (read only). */
import { DatabaseProvider } from '../../src/providers/database';
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const r = await p.readPageFieldConfiguration(process.argv[2] ?? 'JOB_CODE_TBL', 'GBL', 'STD');
console.log(JSON.stringify({ token: r.token, configuration: r.configuration, derived: r.derived.map((m) => `${m.serviceId} ${m.level} ${m.record ?? ''}`), contentReferences: r.contentReferences }, null, 1));
const rows = await p.runReadOnlyQuery(`SELECT PORTAL_OBJNAME, PTCS_SERVICEID, PTCS_INSTANCEID, VERSION, LASTUPDOPRID, TO_CHAR(LASTUPDDTTM,'HH24:MI:SS') T FROM PSPTCSSRVCONF WHERE PORTAL_NAME='_PTCS_PTEVMAP' AND PORTAL_OBJNAME IN ('HC_C_JOB_CODE_TBL_GBL','HC_JOB_CODE_TBL_GBL2') ORDER BY VERSION`, 20);
for (const x of rows.rows) console.log(Object.values(x).map((v) => String(v).trim()).join(' | '));
const lg = await p.runReadOnlyQuery(`SELECT PORTAL_OBJNAME, PTCS_SERVICEID, PTCS_INSTANCEID, '[' || LANGUAGE_CD || ']' L FROM PSPTCSSRVCONFLG WHERE PORTAL_NAME='_PTCS_PTEVMAP' AND PORTAL_OBJNAME IN ('HC_C_JOB_CODE_TBL_GBL','HC_JOB_CODE_TBL_GBL2')`, 20);
for (const x of lg.rows) console.log('LG', Object.values(x).map((v) => String(v).trim()).join(' | '));
await p.dispose();
