// READ ONLY (HRDMO lab): snapshot the rows an App Designer action touches, to diff phases.
// usage: cap.mts <phase-name>   -> writes scratchpad/cap-<phase>.json ; cap.mts diff <a> <b>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const DIR = '/tmp/claude-1000/-home-noodlesploder-repos-peoplesoft-studio/c55da749-6a49-42f8-a73f-94beada400a5/scratchpad';
const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'diff') {
  const A = JSON.parse(readFileSync(`${DIR}/cap-${a}.json`, 'utf8')), B = JSON.parse(readFileSync(`${DIR}/cap-${b}.json`, 'utf8'));
  for (const t of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const ka = new Map((A[t] ?? []).map((r: any) => [JSON.stringify(r), r])), kb = new Map((B[t] ?? []).map((r: any) => [JSON.stringify(r), r]));
    const gone = [...ka.keys()].filter(k => !kb.has(k)), added = [...kb.keys()].filter(k => !ka.has(k));
    if (gone.length || added.length) { console.log(`## ${t}`); for (const g of gone) console.log('  - ' + g); for (const n of added) console.log('  + ' + n); }
  }
  process.exit(0);
}
const require = createRequire('/home/noodlesploder/repos/peoplesoft-studio/package.json');
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB, oracledb.DATE]; oracledb.fetchAsBuffer = [oracledb.BLOB];
const c = await oracledb.getConnection({ connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD });
const q = async (s: string) => ((await c.execute(s, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows as any[]).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? 'hex:' + (v as Buffer).toString('hex').slice(0, 64) + `..(${(v as Buffer).length})` : v instanceof Date ? v.toISOString() : v])));
await c.execute(`ALTER SESSION SET NLS_TIMESTAMP_FORMAT='YYYY-MM-DD HH24:MI:SS.FF6'`);
const out: Record<string, any[]> = {
  PSVERSION: await q(`SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('APM','SYS','PCM','PBM','RDM','PJM') ORDER BY 1`),
  PSLOCK: await q(`SELECT OBJECTTYPENAME, VERSION FROM PSLOCK WHERE OBJECTTYPENAME IN ('APM','SYS','PCM','PBM','RDM','PJM') ORDER BY 1`),
  PSPACKAGEDEFN: await q(`SELECT * FROM PSPACKAGEDEFN WHERE PACKAGEROOT LIKE 'ZZ_SUBPKG%' ORDER BY PACKAGEROOT, PACKAGELEVEL, QUALIFYPATH, PACKAGEID`),
  PSPACKAGEDEL: await q(`SELECT * FROM PSPACKAGEDEL WHERE PACKAGEROOT LIKE 'ZZ_SUBPKG%'`),
  PSAPPCLASSDEFN: await q(`SELECT * FROM PSAPPCLASSDEFN WHERE PACKAGEROOT LIKE 'ZZ_SUBPKG%'`),
  PSRECDEFN: await q(`SELECT RECNAME, RECTYPE, VERSION, FIELDCOUNT, LASTUPDOPRID FROM PSRECDEFN WHERE RECNAME LIKE 'WEBLIB_ZZ_LIC%'`),
  PSPCMPROG: await q(`SELECT OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, PROGSEQ, VERSION, PROGLEN, PROGRUNLOC, PROGFLAGS, LICENSE_CODE, LASTUPDOPRID, PROGEXTENDS, PTTOOLSREL, NAMECOUNT, PROGTXT FROM PSPCMPROG WHERE OBJECTID1=1 AND OBJECTVALUE1 LIKE 'WEBLIB_ZZ_LIC%' ORDER BY 1,2,3,4`),
  PSPCMTXT: await q(`SELECT OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, PROGSEQ, HASH_SIGNATURE, PCTEXT FROM PSPCMTXT WHERE OBJECTID1=1 AND OBJECTVALUE1 LIKE 'WEBLIB_ZZ_LIC%' ORDER BY 1,2,3,4`),
  PSPCMPROGDEL: await q(`SELECT * FROM PSPCMPROGDEL WHERE OBJECTVALUE1 LIKE 'WEBLIB_ZZ_LIC%' OR OBJECTVALUE1 LIKE 'ZZ_SUBPKG%'`),
};
writeFileSync(`${DIR}/cap-${cmd}.json`, JSON.stringify(out, null, 1));
console.log('captured', cmd, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
await c.close();
