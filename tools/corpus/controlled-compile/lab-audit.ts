/*
 * Cycle 179: read-only before/after audit of the controlled-compile LAB
 * database, so that no lab write can change a non-scratch definition
 * unnoticed.
 *
 *   npx tsx tools/corpus/controlled-compile/lab-audit.ts snapshot --database HRDMO --out before.json
 *   npx tsx tools/corpus/controlled-compile/lab-audit.ts compare before.json after.json
 *
 * Connects as the access id (PSLAB_ACCESSID / PSLAB_ACCESSPSWD) to
 * PSLAB_AUDIT_CONNECT (default 127.0.0.1:15210/hrdmo), in a READ ONLY
 * transaction, SELECT only.
 *
 * Every definition is fingerprinted INSIDE Oracle. Per definition key the
 * fingerprint covers:
 * - row count and total LOB length;
 * - MAX(LASTUPDDTTM) where the table has one;
 * - the sum of ORA_HASH over every content chunk (2000-byte PSPCMPROG
 *   chunks, 1000-character PSPCMTXT chunks, every PSPCMNAME row, every
 *   non-LOB column of the definition tables), seeded by position.
 *
 * Scope:
 * - Non-scratch keys (outside ZZ_PCODE_LAB%) are what the safety rule
 *   protects: compare reports NON_SCRATCH_CHANGED and exits 1 when it
 *   is not 0, timestamp-only changes included.
 * - Scratch keys are listed separately.
 * - PSVERSION (global version counters that every definition save
 *   increments) is reported as infrastructure, not hidden.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import oracledb from 'oracledb';

import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';
import { SCRATCH_LIKE, auditChangeCount, diffAudit, type AuditInventory } from '../../../src/peoplecode/corpus/labSafety';

oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

const KEY7 = (alias: string) => [1, 2, 3, 4, 5, 6, 7].map(i => `${alias}.objectid${i}||'.'||trim(${alias}.objectvalue${i})`).join("||'/'||");

interface AuditSnapshot {
  database: string;
  takenAt: string;
  nonScratch: AuditInventory;
  scratch: AuditInventory;
  psversion: Record<string, string>;
  protected: Record<string, { source: string; program: string; names: string; lastUpdDttm: string | null }>;
}

/** Definitions protected by name: the Cycle 178 incident program. */
const PROTECTED_PROGRAMS = [{ label: 'APPS_RLR:Utilities', root: 'APPS_RLR', cls: 'Utilities' }];

async function definitionTableQuery(connection: oracledb.Connection, table: string, keyExpr: string, scratchColumn: string): Promise<string> {
  const columns = (await connection.execute<{ COLUMN_NAME: string; DATA_TYPE: string }>(
    `SELECT column_name, data_type FROM all_tab_columns WHERE owner = 'SYSADM' AND table_name = :t ORDER BY column_id`,
    { t: table }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [];
  const parts = columns
    .filter(c => !/LOB|LONG|RAW/.test(c.DATA_TYPE))
    .map(c => /DATE|TIMESTAMP/.test(c.DATA_TYPE) ? `NVL(TO_CHAR(${c.COLUMN_NAME}, 'YYYYMMDDHH24MISSFF6'), '~')` : `NVL(TO_CHAR(${c.COLUMN_NAME}), '~')`);
  if (parts.length === 0) throw new Error(`No hashable columns in ${table}.`);
  return `SELECT ${keyExpr} K, COUNT(*) N, SUM(ORA_HASH(${parts.join("||'|'||")})) H,
            CASE WHEN ${scratchColumn} ${SCRATCH_LIKE} THEN 1 ELSE 0 END S
          FROM SYSADM.${table}
          GROUP BY ${keyExpr}, CASE WHEN ${scratchColumn} ${SCRATCH_LIKE} THEN 1 ELSE 0 END`;
}

async function snapshot(database: string): Promise<AuditSnapshot> {
  if (PROTECTED_DATABASE_PATTERN.test(database)) throw new Error(`${database} is an institutional database.`);
  const user = process.env.PSLAB_ACCESSID, password = process.env.PSLAB_ACCESSPSWD;
  if (!user || !password) throw new Error('PSLAB_ACCESSID / PSLAB_ACCESSPSWD are required.');
  const connection = await oracledb.getConnection({ user, password, connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo' });
  try {
    await connection.execute('SET TRANSACTION READ ONLY');
    const rows = async (sql: string, binds: oracledb.BindParameters = {}) =>
      ((await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Record<string, any>[];
    const [identity] = await rows(`SELECT SYS_CONTEXT('USERENV','DB_NAME') DB, TO_CHAR(SYSTIMESTAMP,'YYYY-MM-DD"T"HH24:MI:SS.FF6') NOW FROM DUAL`);
    if (String(identity.DB).toUpperCase() !== database.toUpperCase()) throw new Error(`Connected to ${identity.DB}, not ${database}.`);

    const nonScratch: AuditInventory = {};
    const scratch: AuditInventory = {};
    const put = (table: string, key: string, isScratch: boolean, fingerprint: string) => {
      const target = isScratch ? scratch : nonScratch;
      (target[table] ??= {})[key] = fingerprint;
    };

    const queries: Array<[string, string]> = [
      ['PSPCMPROG', `SELECT ${KEY7('p')} K, COUNT(DISTINCT p.progseq) N,
          SUM(CASE WHEN c.n = 1 THEN DBMS_LOB.GETLENGTH(p.progtxt) END) L,
          TO_CHAR(MAX(p.lastupddttm), 'YYYYMMDDHH24MISSFF6') T,
          SUM(ORA_HASH(DBMS_LOB.SUBSTR(p.progtxt, 2000, (c.n - 1) * 2000 + 1), 4294967295, MOD(p.progseq * 7919 + c.n, 4294967295))) H,
          CASE WHEN p.objectvalue1 ${SCRATCH_LIKE} THEN 1 ELSE 0 END S
        FROM SYSADM.PSPCMPROG p
        CROSS JOIN LATERAL (SELECT LEVEL n FROM DUAL CONNECT BY LEVEL <= GREATEST(1, CEIL(DBMS_LOB.GETLENGTH(p.progtxt) / 2000))) c
        GROUP BY ${KEY7('p')}, CASE WHEN p.objectvalue1 ${SCRATCH_LIKE} THEN 1 ELSE 0 END`],
      ['PSPCMTXT', `SELECT ${KEY7('t')} K, COUNT(DISTINCT t.progseq) N,
          SUM(CASE WHEN c.n = 1 THEN DBMS_LOB.GETLENGTH(t.pctext) END) L,
          NULL T,
          SUM(ORA_HASH(DBMS_LOB.SUBSTR(t.pctext, 1000, (c.n - 1) * 1000 + 1), 4294967295, MOD(t.progseq * 7919 + c.n, 4294967295))) H,
          CASE WHEN t.objectvalue1 ${SCRATCH_LIKE} THEN 1 ELSE 0 END S
        FROM SYSADM.PSPCMTXT t
        CROSS JOIN LATERAL (SELECT LEVEL n FROM DUAL CONNECT BY LEVEL <= GREATEST(1, CEIL(DBMS_LOB.GETLENGTH(t.pctext) / 1000))) c
        GROUP BY ${KEY7('t')}, CASE WHEN t.objectvalue1 ${SCRATCH_LIKE} THEN 1 ELSE 0 END`],
      ['PSPCMNAME', `SELECT ${KEY7('m')} K, COUNT(*) N, NULL L, NULL T,
          SUM(ORA_HASH(m.namenum||'|'||m.recname||'|'||m.refname||'|'||m.packageroot||'|'||m.qualifypath||'|'||m.appclassmethod, 4294967295, MOD(m.namenum, 4294967295))) H,
          CASE WHEN m.objectvalue1 ${SCRATCH_LIKE} THEN 1 ELSE 0 END S
        FROM SYSADM.PSPCMNAME m
        GROUP BY ${KEY7('m')}, CASE WHEN m.objectvalue1 ${SCRATCH_LIKE} THEN 1 ELSE 0 END`]
    ];
    for (const [table, sql] of queries) {
      for (const r of await rows(sql)) put(table, String(r.K), Number(r.S) === 1, `${r.N}|${r.L ?? ''}|${r.T ?? ''}|${r.H ?? ''}`);
    }
    const definitionTables: Array<[string, string, string]> = [
      ['PSPACKAGEDEFN', "PACKAGEROOT||':'||QUALIFYPATH||':'||PACKAGEID", 'PACKAGEROOT'],
      ['PSAPPCLASSDEFN', "PACKAGEROOT||':'||QUALIFYPATH||':'||APPCLASSID", 'PACKAGEROOT'],
      ['PSPROJECTDEFN', 'PROJECTNAME', 'PROJECTNAME'],
      ['PSPROJECTITEM', 'PROJECTNAME', 'PROJECTNAME']
    ];
    for (const [table, keyExpr, scratchColumn] of definitionTables) {
      for (const r of await rows(await definitionTableQuery(connection, table, keyExpr, scratchColumn))) {
        put(table, String(r.K), Number(r.S) === 1, `${r.N}|${r.H ?? ''}`);
      }
    }
    const psversion: Record<string, string> = {};
    for (const r of await rows('SELECT OBJECTTYPENAME, VERSION FROM SYSADM.PSVERSION')) psversion[String(r.OBJECTTYPENAME).trim()] = String(r.VERSION);

    const protectedPrograms: AuditSnapshot['protected'] = {};
    const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
    for (const p of PROTECTED_PROGRAMS) {
      const b = { r: p.root, c: p.cls };
      const text = (await rows('SELECT PCTEXT FROM SYSADM.PSPCMTXT WHERE OBJECTVALUE1 = :r AND OBJECTVALUE2 = :c ORDER BY PROGSEQ', b)).map(r => r.PCTEXT as string).join('');
      const prog = Buffer.concat((await rows('SELECT PROGTXT FROM SYSADM.PSPCMPROG WHERE OBJECTVALUE1 = :r AND OBJECTVALUE2 = :c ORDER BY PROGSEQ', b)).map(r => r.PROGTXT as Buffer));
      const names = (await rows('SELECT NAMENUM, RECNAME, REFNAME, PACKAGEROOT, QUALIFYPATH, APPCLASSMETHOD FROM SYSADM.PSPCMNAME WHERE OBJECTVALUE1 = :r AND OBJECTVALUE2 = :c ORDER BY NAMENUM', b))
        .map(r => [r.NAMENUM, ...['RECNAME', 'REFNAME', 'PACKAGEROOT', 'QUALIFYPATH', 'APPCLASSMETHOD'].map(k => String(r[k] ?? '').trim())]);
      const [ts] = await rows(`SELECT TO_CHAR(MAX(LASTUPDDTTM), 'YYYY-MM-DD"T"HH24:MI:SS.FF6') T FROM SYSADM.PSPCMPROG WHERE OBJECTVALUE1 = :r AND OBJECTVALUE2 = :c`, b);
      protectedPrograms[p.label] = { source: sha(text), program: sha(prog), names: sha(JSON.stringify(names)), lastUpdDttm: ts?.T ?? null };
    }
    return { database: String(identity.DB), takenAt: String(identity.NOW), nonScratch, scratch, psversion, protected: protectedPrograms };
  } finally {
    await connection.rollback();
    await connection.close();
  }
}

function compare(beforeFile: string, afterFile: string): number {
  const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8')) as AuditSnapshot;
  const after = JSON.parse(fs.readFileSync(afterFile, 'utf8')) as AuditSnapshot;
  const nonScratch = diffAudit(before.nonScratch, after.nonScratch);
  const scratch = diffAudit(before.scratch, after.scratch);
  const versions = Object.keys({ ...before.psversion, ...after.psversion }).filter(k => before.psversion[k] !== after.psversion[k]);
  const protectedChanged = Object.keys(before.protected).filter(k => JSON.stringify(before.protected[k]) !== JSON.stringify(after.protected[k]));
  const count = auditChangeCount(nonScratch);
  console.log(`audit ${before.takenAt} -> ${after.takenAt} on ${after.database}`);
  console.log(`NON_SCRATCH_CHANGED = ${count}`);
  for (const line of [...nonScratch.changed.map(l => `  changed ${l}`), ...nonScratch.added.map(l => `  added ${l}`), ...nonScratch.removed.map(l => `  removed ${l}`)].slice(0, 50)) console.log(line);
  console.log(`protected definitions changed: ${protectedChanged.join(' ') || 'none'}`);
  console.log(`scratch changes: ${auditChangeCount(scratch)} (${[...scratch.added.map(l => `+${l}`), ...scratch.changed.map(l => `~${l}`), ...scratch.removed.map(l => `-${l}`)].join('; ') || 'none'})`);
  console.log(`PSVERSION counters changed (infrastructure): ${versions.map(k => `${k} ${before.psversion[k]}->${after.psversion[k]}`).join(', ') || 'none'}`);
  return count + protectedChanged.length;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'snapshot') {
    const database = rest[rest.indexOf('--database') + 1];
    const out = rest[rest.indexOf('--out') + 1];
    if (!database || !out || rest.indexOf('--database') < 0 || rest.indexOf('--out') < 0) throw new Error('usage: lab-audit.ts snapshot --database <DB> --out <file>');
    const started = Date.now();
    const snap = await snapshot(database);
    fs.writeFileSync(out, `${JSON.stringify(snap)}\n`, { mode: 0o600 });
    const n = (inv: AuditInventory) => Object.values(inv).reduce((a, t) => a + Object.keys(t).length, 0);
    console.log(`snapshot ${snap.database} at ${snap.takenAt}: ${n(snap.nonScratch)} non-scratch keys, ${n(snap.scratch)} scratch keys, ${Math.round((Date.now() - started) / 1000)}s -> ${out}`);
    return;
  }
  if (command === 'compare') {
    const changed = compare(rest[0], rest[1]);
    process.exit(changed === 0 ? 0 : 1);
  }
  throw new Error('usage: lab-audit.ts snapshot --database <DB> --out <file> | compare <before> <after>');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
