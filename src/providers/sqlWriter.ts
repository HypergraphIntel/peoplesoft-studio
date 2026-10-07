import type { Connection } from 'oracledb';
import { isScratchName } from '../peoplecode/corpus/labSafety.js';
import { predictSourceSignature } from '../peoplecode/sourceSignature.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Saving an SQL definition's text, as App Designer does (docs/RECORD_SAVE.md,
 * cases r33 / r34, ZZ_PCODE_LAB_SQL):
 *
 *   PSSQLDEFN       VERSION = the new PSVERSION SRM, LASTUPDDTTM / LASTUPDOPRID
 *                   the save's (App Designer deletes and reinserts the row)
 *   PSSQLDESCR      deleted and reinserted unchanged
 *   PSSQLTEXTDEFN   the text rows deleted, the new text inserted
 *                   (MARKET GBL, DBTYPE ' ', EFFDT 1900-01-01, SEQNUM 0)
 *   PSSQLHASH       HASH_SIGNATURE updated: base64(SHA-1(UTF-16LE text) || 0x00),
 *                   the PSPCMTXT algorithm (r28, r33, r34 reproduced exactly)
 *   PSVERSION       SRM + 1, SYS + 1
 *   PSLOCK          SRM + 1
 *
 * Creating one (r33) inserts the same four rows: PSSQLDEFN (VERSION = new SRM,
 * ENABLEEFFDT 'N', OBJECTOWNERID ' '), PSSQLDESCR (DESCR ' ', DESCRLONG null),
 * PSSQLHASH and PSSQLTEXTDEFN, with the same counters.
 *
 * Scope: SQL definitions (SQLTYPE 0) under ZZ_PCODE_LAB, text in one
 * PSSQLTEXTDEFN row (at most 14,000 characters: how longer text is split is
 * not established), one GBL / ' ' / 1900-01-01 text and description row.
 */

export class SqlSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlSaveRefusedError';
  }
}

export const SQL_TEXT_ROW_LIMIT = 14000;
const MARKET = 'GBL';
const DBTYPE = ' ';
const EFFDT = '1900-01-01';

export interface SqlSaveRequest {
  sqlId: string;
  text: string;
  /** PSSQLDEFN.VERSION when the text was opened, the save refused if it moved; undefined creates the definition. */
  openedVersion?: number;
  operatorId: string;
}

export interface SqlSaveResult {
  version: number;
  lastupddttm: string;
  hashSignature: string;
  created: boolean;
}

interface Counters { srm: number; sys: number; lockSrm: number }

async function readCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('SRM', 'SYS')${lock}`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'SRM'${lock}`);
  const get = (name: string) => v.find((r) => String(r.T).trim() === name)?.V;
  const srm = get('SRM');
  const sys = get('SYS');
  if (srm === undefined || sys === undefined || l.length !== 1) {
    throw new SqlSaveRefusedError('PSVERSION SRM / SYS or PSLOCK SRM is missing; refusing to write.');
  }
  return { srm: Number(srm), sys: Number(sys), lockSrm: Number(l[0].V) };
}

/**
 * The text as App Designer stores and hashes it: lines ended CRLF (all 46
 * multi-line delivered SQL texts on HRDMO are CRLF, none bare LF), no
 * trailing whitespace (9,698 of 9,713 have none).
 */
export function prepareSqlText(text: string): string {
  return text.replace(/\r?\n/g, '\r\n').replace(/\s+$/, '');
}

export async function saveSqlDefinition(c: Connection, request: SqlSaveRequest): Promise<SqlSaveResult> {
  const id = request.sqlId;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new SqlSaveRefusedError(operatorError);
    if (!isScratchName(id)) throw new SqlSaveRefusedError(`${id} is outside ZZ_PCODE_LAB: saving SQL is limited to scratch definitions for now.`);
    const text = prepareSqlText(request.text);
    if (text === '') throw new SqlSaveRefusedError('The SQL is empty.');
    if (text.length > SQL_TEXT_ROW_LIMIT) {
      throw new SqlSaveRefusedError(`SQL longer than ${SQL_TEXT_ROW_LIMIT} characters is not saved here yet (how App Designer splits it is not established).`);
    }

    const create = request.openedVersion === undefined;
    if (create) {
      if (!/^[A-Z0-9_]{1,30}$/.test(id)) throw new SqlSaveRefusedError(`${id} is not a valid definition name (A-Z, 0-9, _; at most 30).`);
      const [{ N: taken }] = await select<{ N: number }>(c,
        `SELECT (SELECT COUNT(*) FROM SYSADM.PSSQLDEFN WHERE SQLID = :id) + (SELECT COUNT(*) FROM SYSADM.PSSQLDESCR WHERE SQLID = :id)
              + (SELECT COUNT(*) FROM SYSADM.PSSQLTEXTDEFN WHERE SQLID = :id) + (SELECT COUNT(*) FROM SYSADM.PSSQLHASH WHERE SQLID = :id) AS N FROM DUAL`,
        { id });
      if (Number(taken) > 0) throw new SqlSaveRefusedError(`An SQL definition named ${id} (of some SQL type) already exists, or left rows behind.`);
    } else {
      const [defn] = await select<{ VERSION: number }>(c,
        `SELECT VERSION FROM SYSADM.PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = 0 FOR UPDATE`, { id });
      if (!defn) throw new SqlSaveRefusedError(`There is no SQL definition named ${id} (it may have been deleted since it was opened).`);
      if (Number(defn.VERSION) !== request.openedVersion) {
        throw new SqlSaveRefusedError(`${id} was saved since it was opened (version ${defn.VERSION}, not ${request.openedVersion}). Reopen it and reapply your edit.`);
      }
      const shape = await select<{ TABLE_: string; N: number; ODD: number }>(c,
        `SELECT 'TEXT' AS TABLE_, COUNT(*) AS N,
                SUM(CASE WHEN MARKET = :m AND DBTYPE = :d AND TO_CHAR(EFFDT, 'YYYY-MM-DD') = :e AND SEQNUM = 0 THEN 0 ELSE 1 END) AS ODD
           FROM SYSADM.PSSQLTEXTDEFN WHERE SQLID = :id AND SQLTYPE = 0
         UNION ALL
         SELECT 'DESCR', COUNT(*), SUM(CASE WHEN MARKET = :m AND DBTYPE = :d AND TO_CHAR(EFFDT, 'YYYY-MM-DD') = :e THEN 0 ELSE 1 END)
           FROM SYSADM.PSSQLDESCR WHERE SQLID = :id AND SQLTYPE = 0
         UNION ALL
         SELECT 'HASH', COUNT(*), SUM(CASE WHEN MARKET = :m AND DBTYPE = :d AND TO_CHAR(EFFDT, 'YYYY-MM-DD') = :e THEN 0 ELSE 1 END)
           FROM SYSADM.PSSQLHASH WHERE SQLID = :id AND SQLTYPE = 0`,
        { id, m: MARKET, d: DBTYPE, e: EFFDT });
      for (const s of shape) {
        if (Number(s.N) !== 1 || Number(s.ODD ?? 0) !== 0) {
          throw new SqlSaveRefusedError(`${id} is not a single GBL / 1900-01-01 SQL text (its ${s.TABLE_.trim().toLowerCase()} rows differ); not saved here yet.`);
        }
      }
    }
    if (!(await operatorExists(c, request.operatorId))) {
      throw new SqlSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const counters = await readCounters(c, true);
    const next: Counters = { srm: counters.srm + 1, sys: counters.sys + 1, lockSrm: counters.lockSrm + 1 };
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const hashSignature = predictSourceSignature(text);
    const key = { id, m: MARKET, d: DBTYPE, e: EFFDT };

    if (create) {
      await expectRows(c,
        `INSERT INTO SYSADM.PSSQLDEFN (SQLID, SQLTYPE, VERSION, LASTUPDOPRID, LASTUPDDTTM, ENABLEEFFDT, OBJECTOWNERID)
         VALUES (:id, '0', :v, :op, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), 'N', ' ')`,
        { v: next.srm, ts: lastupddttm, op: request.operatorId, id }, 1, 'Inserting PSSQLDEFN');
      await expectRows(c,
        `INSERT INTO SYSADM.PSSQLDESCR (SQLID, SQLTYPE, MARKET, DBTYPE, EFFDT, DESCR, DESCRLONG)
         VALUES (:id, '0', :m, :d, TO_DATE(:e, 'YYYY-MM-DD'), ' ', NULL)`, key, 1, 'Inserting PSSQLDESCR');
      await expectRows(c,
        `INSERT INTO SYSADM.PSSQLHASH (SQLID, SQLTYPE, MARKET, DBTYPE, EFFDT, HASH_SIGNATURE)
         VALUES (:id, '0', :m, :d, TO_DATE(:e, 'YYYY-MM-DD'), :h)`, { ...key, h: hashSignature }, 1, 'Inserting PSSQLHASH');
    } else {
      await expectRows(c,
        `UPDATE SYSADM.PSSQLDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
          WHERE SQLID = :id AND SQLTYPE = 0`,
        { v: next.srm, ts: lastupddttm, op: request.operatorId, id }, 1, 'Updating PSSQLDEFN');
      await expectRows(c, `DELETE FROM SYSADM.PSSQLTEXTDEFN WHERE SQLID = :id AND SQLTYPE = 0`, { id }, 1, 'Deleting PSSQLTEXTDEFN');
    }
    await expectRows(c,
      `INSERT INTO SYSADM.PSSQLTEXTDEFN (SQLID, SQLTYPE, MARKET, DBTYPE, EFFDT, SEQNUM, SQLTEXT)
       VALUES (:id, 0, :m, :d, TO_DATE(:e, 'YYYY-MM-DD'), 0, :t)`, { ...key, t: text }, 1, 'Inserting PSSQLTEXTDEFN');
    if (!create) {
      await expectRows(c,
        `UPDATE SYSADM.PSSQLHASH SET HASH_SIGNATURE = :h
          WHERE SQLID = :id AND SQLTYPE = 0 AND MARKET = :m AND DBTYPE = :d AND EFFDT = TO_DATE(:e, 'YYYY-MM-DD')`,
        { ...key, h: hashSignature }, 1, 'Updating PSSQLHASH');
    }
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SRM'`, { v: next.srm }, 1, 'Updating PSVERSION SRM');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'SRM'`, { v: next.lockSrm }, 1, 'Updating PSLOCK SRM');

    const result: SqlSaveResult = { version: next.srm, lastupddttm, hashSignature, created: create };
    await verifySqlSave(c, request, result);
    const now = await readCounters(c, false);
    if (now.srm !== next.srm || now.sys !== next.sys || now.lockSrm !== next.lockSrm) {
      throw new SqlSaveRefusedError(`counters ${JSON.stringify(now)}, ${JSON.stringify(next)} expected; rolled back.`);
    }
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** The stored text, hash and stamp are the save's. */
export async function verifySqlSave(c: Connection, request: SqlSaveRequest, result: SqlSaveResult): Promise<void> {
  const id = request.sqlId;
  const problems: string[] = [];
  const [d] = await select<{ VERSION: number; TS: string; OPRID: string }>(c,
    `SELECT VERSION, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS, LASTUPDOPRID AS OPRID
       FROM SYSADM.PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = 0`, { id });
  if (!d || Number(d.VERSION) !== result.version || d.TS !== result.lastupddttm || String(d.OPRID).trim() !== request.operatorId) {
    problems.push(`PSSQLDEFN ${JSON.stringify(d)}`);
  }
  const texts = await select<{ T: string; SEQNUM: number }>(c,
    `SELECT DBMS_LOB.SUBSTR(SQLTEXT, 4000, 1) AS T, DBMS_LOB.GETLENGTH(SQLTEXT) AS L, SEQNUM
       FROM SYSADM.PSSQLTEXTDEFN WHERE SQLID = :id AND SQLTYPE = 0`, { id });
  const want = prepareSqlText(request.text);
  if (texts.length !== 1) problems.push(`${texts.length} text rows`);
  else if (!want.startsWith(String(texts[0].T ?? ''))) problems.push('the stored text differs');
  const [h] = await select<{ H: string }>(c, `SELECT HASH_SIGNATURE AS H FROM SYSADM.PSSQLHASH WHERE SQLID = :id AND SQLTYPE = 0`, { id });
  if (h?.H !== result.hashSignature) problems.push(`PSSQLHASH ${h?.H}`);
  if (problems.length) throw new SqlSaveRefusedError(`The SQL save did not land as planned (${problems.join('; ')}).`);
}

/**
 * A view's SQL (SQLTYPE 2) written inside the record save that changes it,
 * not committed here: created as r28 created ZZ_PCODE_LAB_T's (PSSQLDEFN
 * VERSION = new SRM, ENABLEEFFDT 'N'; PSSQLDESCR; PSSQLHASH; one
 * PSSQLTEXTDEFN row), or rewritten as a save does (VERSION, stamp, text,
 * hash). PSVERSION SRM, PSLOCK SRM + 1; SYS moves once with the record's
 * save. Verified before returning.
 */
export async function writeViewSql(
  c: Connection, args: { recname: string; text: string; ts: string; operatorId: string }
): Promise<{ version: number; hashSignature: string }> {
  const id = args.recname;
  const text = prepareSqlText(args.text);
  if (text === '') throw new SqlSaveRefusedError('The view SQL is empty.');
  if (text.length > SQL_TEXT_ROW_LIMIT) throw new SqlSaveRefusedError(`View SQL longer than ${SQL_TEXT_ROW_LIMIT} characters is not saved here yet.`);
  const key = { id, m: MARKET, d: DBTYPE, e: EFFDT };
  const [defn] = await select<{ VERSION: number }>(c, `SELECT VERSION FROM SYSADM.PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = '2' FOR UPDATE`, { id });
  const shape = await select<{ T: string; N: number; ODD: number }>(c,
    `SELECT 'TEXT' AS T, COUNT(*) AS N, SUM(CASE WHEN MARKET = :m AND DBTYPE = :d AND TO_CHAR(EFFDT, 'YYYY-MM-DD') = :e AND SEQNUM = 0 THEN 0 ELSE 1 END) AS ODD
       FROM SYSADM.PSSQLTEXTDEFN WHERE SQLID = :id AND SQLTYPE = '2'
     UNION ALL SELECT 'DESCR', COUNT(*), SUM(CASE WHEN MARKET = :m AND DBTYPE = :d AND TO_CHAR(EFFDT, 'YYYY-MM-DD') = :e THEN 0 ELSE 1 END)
       FROM SYSADM.PSSQLDESCR WHERE SQLID = :id AND SQLTYPE = '2'
     UNION ALL SELECT 'HASH', COUNT(*), SUM(CASE WHEN MARKET = :m AND DBTYPE = :d AND TO_CHAR(EFFDT, 'YYYY-MM-DD') = :e THEN 0 ELSE 1 END)
       FROM SYSADM.PSSQLHASH WHERE SQLID = :id AND SQLTYPE = '2'`, key);
  const expected = defn ? 1 : 0;
  for (const s of shape) {
    if (Number(s.N) !== expected || Number(s.ODD ?? 0) !== 0) {
      throw new SqlSaveRefusedError(`${id}'s view SQL is not a single GBL / 1900-01-01 text (its ${String(s.T).trim().toLowerCase()} rows differ); not saved here yet.`);
    }
  }
  const v = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME = 'SRM' FOR UPDATE`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'SRM' FOR UPDATE`);
  if (v.length !== 1 || l.length !== 1) throw new SqlSaveRefusedError('PSVERSION / PSLOCK SRM is missing; refusing to write.');
  const version = Number(v[0].V) + 1;
  const hashSignature = predictSourceSignature(text);
  const stamp = { v: version, ts: args.ts, op: args.operatorId };
  if (defn) {
    await expectRows(c, `UPDATE SYSADM.PSSQLDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
      WHERE SQLID = :id AND SQLTYPE = '2'`, { ...stamp, id }, 1, 'Updating PSSQLDEFN');
    await expectRows(c, `DELETE FROM SYSADM.PSSQLTEXTDEFN WHERE SQLID = :id AND SQLTYPE = '2'`, { id }, 1, 'Deleting PSSQLTEXTDEFN');
    await expectRows(c, `UPDATE SYSADM.PSSQLHASH SET HASH_SIGNATURE = :h WHERE SQLID = :id AND SQLTYPE = '2'`, { id, h: hashSignature }, 1, 'Updating PSSQLHASH');
  } else {
    await expectRows(c, `INSERT INTO SYSADM.PSSQLDEFN (SQLID, SQLTYPE, VERSION, LASTUPDOPRID, LASTUPDDTTM, ENABLEEFFDT, OBJECTOWNERID)
      VALUES (:id, '2', :v, :op, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), 'N', ' ')`, { ...stamp, id }, 1, 'Inserting PSSQLDEFN');
    await expectRows(c, `INSERT INTO SYSADM.PSSQLDESCR (SQLID, SQLTYPE, MARKET, DBTYPE, EFFDT, DESCR, DESCRLONG)
      VALUES (:id, '2', :m, :d, TO_DATE(:e, 'YYYY-MM-DD'), ' ', NULL)`, key, 1, 'Inserting PSSQLDESCR');
    await expectRows(c, `INSERT INTO SYSADM.PSSQLHASH (SQLID, SQLTYPE, MARKET, DBTYPE, EFFDT, HASH_SIGNATURE)
      VALUES (:id, '2', :m, :d, TO_DATE(:e, 'YYYY-MM-DD'), :h)`, { ...key, h: hashSignature }, 1, 'Inserting PSSQLHASH');
  }
  await expectRows(c, `INSERT INTO SYSADM.PSSQLTEXTDEFN (SQLID, SQLTYPE, MARKET, DBTYPE, EFFDT, SEQNUM, SQLTEXT)
    VALUES (:id, '2', :m, :d, TO_DATE(:e, 'YYYY-MM-DD'), 0, :t)`, { ...key, t: text }, 1, 'Inserting PSSQLTEXTDEFN');
  await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SRM'`, { v: version }, 1, 'Updating PSVERSION SRM');
  await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'SRM'`, { v: Number(l[0].V) + 1 }, 1, 'Updating PSLOCK SRM');
  const [check] = await select<{ V: number; H: string; T: string }>(c,
    `SELECT D.VERSION AS V, H.HASH_SIGNATURE AS H, DBMS_LOB.SUBSTR(T.SQLTEXT, 4000, 1) AS T
       FROM SYSADM.PSSQLDEFN D, SYSADM.PSSQLHASH H, SYSADM.PSSQLTEXTDEFN T
      WHERE D.SQLID = :id AND D.SQLTYPE = '2' AND H.SQLID = :id AND H.SQLTYPE = '2' AND T.SQLID = :id AND T.SQLTYPE = '2'`, { id });
  if (!check || Number(check.V) !== version || check.H !== hashSignature || !text.startsWith(String(check.T ?? ''))) {
    throw new SqlSaveRefusedError('The view SQL did not land as planned; rolled back.');
  }
  return { version, hashSignature };
}

/**
 * A view's SQL deleted inside the record save that makes the view an SQL
 * Table (r57): PSSQLDEFN, PSSQLDESCR, PSSQLHASH and PSSQLTEXTDEFN rows of
 * SQLTYPE 2; PSVERSION SRM, PSLOCK SRM + 1.
 */
export async function deleteViewSql(c: Connection, recname: string): Promise<void> {
  const id = { id: recname };
  const [{ N: defs }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = '2'`, id);
  if (Number(defs) !== 1) throw new SqlSaveRefusedError(`${recname} has ${defs} view SQL definitions; refusing to write.`);
  const v = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME = 'SRM' FOR UPDATE`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'SRM' FOR UPDATE`);
  if (v.length !== 1 || l.length !== 1) throw new SqlSaveRefusedError('PSVERSION / PSLOCK SRM is missing; refusing to write.');
  for (const table of ['PSSQLTEXTDEFN', 'PSSQLHASH', 'PSSQLDESCR']) {
    await c.execute(`DELETE FROM SYSADM.${table} WHERE SQLID = :id AND SQLTYPE = '2'`, id);
  }
  await expectRows(c, `DELETE FROM SYSADM.PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = '2'`, id, 1, 'Deleting PSSQLDEFN');
  await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SRM'`, { v: Number(v[0].V) + 1 }, 1, 'Updating PSVERSION SRM');
  await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'SRM'`, { v: Number(l[0].V) + 1 }, 1, 'Updating PSLOCK SRM');
}
