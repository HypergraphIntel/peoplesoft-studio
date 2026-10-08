import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateSql, UntranslatableSqlError } from '../db/sqlTranslate.js';

const ms = (sql: string, binds: Record<string, unknown> = {}, schema?: string) =>
  translateSql(sql, 'mssql', binds, schema ? { schema } : {});
const db2 = (sql: string, binds: Record<string, unknown> = {}) => translateSql(sql, 'db2', binds);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

test('Oracle statements pass through untouched', () => {
  const sql = `SELECT A || B FROM DUAL WHERE X = :x FETCH FIRST :lim ROWS ONLY`;
  assert.equal(translateSql(sql, 'oracle', { x: 1, lim: 5 }).sql, sql);
});

test('named binds become @name on SQL Server and ? in text order on DB2', () => {
  const sql = `SELECT * FROM PSDBFIELD WHERE FIELDNAME = :f AND (LENGTH = :len OR FIELDNAME = :f)`;
  assert.deepEqual(ms(sql), { sql: `SELECT * FROM PSDBFIELD WHERE FIELDNAME = @f AND (LENGTH = @len OR FIELDNAME = @f)`, binds: ['f', 'len'] });
  assert.deepEqual(db2(sql), { sql: `SELECT * FROM PSDBFIELD WHERE FIELDNAME = ? AND (LENGTH = ? OR FIELDNAME = ?)`, binds: ['f', 'len', 'f'] });
});

test('a bind inside a function keeps its place in the order', () => {
  const r = db2(`UPDATE PSXLATITEM SET XLATLONGNAME = :l WHERE FIELDNAME = :f AND EFFDT = TO_DATE(:e, 'YYYY-MM-DD') AND FIELDVALUE = :v`);
  assert.deepEqual(r.binds, ['l', 'f', 'e', 'v']);
  assert.match(r.sql, /EFFDT = DATE\(CAST\(\? AS VARCHAR\(10\)\)\) AND FIELDVALUE = \?$/);
});

test('|| becomes CONCAT on SQL Server, whatever its operands', () => {
  assert.equal(
    ms(`SELECT MESSAGE_SET_NBR || '.' || MESSAGE_NBR AS K FROM PSMSGCATDEFN WHERE MESSAGE_SET_NBR || '.' || MESSAGE_NBR LIKE :n`).sql,
    `SELECT CONCAT(MESSAGE_SET_NBR, '.', MESSAGE_NBR) AS K FROM PSMSGCATDEFN WHERE CONCAT(MESSAGE_SET_NBR, '.', MESSAGE_NBR) LIKE @n`);
  assert.equal(ms(`SELECT S.AE_APPLID || '.' || S.AE_SECTION FROM PSAESECTDEFN S`).sql,
    `SELECT CONCAT(S.AE_APPLID, '.', S.AE_SECTION) FROM PSAESECTDEFN S`);
  assert.equal(ms(`SELECT UPPER(A) || (B) FROM T`).sql, `SELECT CONCAT(UPPER(A), (B)) FROM T`);
  // DB2 concatenates with || itself.
  assert.equal(db2(`SELECT A || B FROM T`).sql, `SELECT A || B FROM T`);
});

test('FETCH FIRST: SQL Server OFFSET / FETCH, a bound count written as a literal', () => {
  assert.equal(squash(ms(`SELECT RECNAME FROM PSRECDEFN WHERE RECNAME LIKE :n ORDER BY 1 FETCH FIRST :lim ROWS ONLY`, { n: 'A%', lim: 50 }).sql),
    `SELECT RECNAME FROM PSRECDEFN WHERE RECNAME LIKE @n ORDER BY 1 OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY`);
  assert.equal(squash(ms(`SELECT 1 FROM PSRECTBLSPC WHERE RECNAME = :r FETCH FIRST 1 ROWS ONLY`).sql),
    `SELECT 1 FROM PSRECTBLSPC WHERE RECNAME = @r ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY`);
  const d = db2(`SELECT RECNAME FROM PSRECDEFN WHERE RECNAME LIKE :n ORDER BY 1 FETCH FIRST :lim ROWS ONLY`, { n: 'A%', lim: 50 });
  assert.equal(d.sql, `SELECT RECNAME FROM PSRECDEFN WHERE RECNAME LIKE ? ORDER BY 1 FETCH FIRST 50 ROWS ONLY`);
  assert.deepEqual(d.binds, ['n']);
  assert.throws(() => ms(`SELECT 1 FROM T FETCH FIRST :lim ROWS ONLY`, { lim: 'x' }), UntranslatableSqlError);
});

test('FOR UPDATE: SQL Server table hints, DB2 kept update locks', () => {
  assert.equal(ms(`SELECT VERSION FROM PSVERSION WHERE OBJECTTYPENAME = :t FOR UPDATE`).sql,
    `SELECT VERSION FROM PSVERSION WITH (UPDLOCK, ROWLOCK) WHERE OBJECTTYPENAME = @t`);
  assert.equal(ms(`SELECT A.X FROM PSLOCK A, PSVERSION B WHERE A.OBJECTTYPENAME = B.OBJECTTYPENAME FOR UPDATE OF A.X NOWAIT`).sql,
    `SELECT A.X FROM PSLOCK A WITH (UPDLOCK, ROWLOCK), PSVERSION B WITH (UPDLOCK, ROWLOCK) WHERE A.OBJECTTYPENAME = B.OBJECTTYPENAME`);
  assert.equal(db2(`SELECT VERSION FROM PSVERSION WHERE OBJECTTYPENAME = :t FOR UPDATE`).sql,
    `SELECT VERSION FROM PSVERSION WHERE OBJECTTYPENAME = ? WITH RS USE AND KEEP UPDATE LOCKS`);
});

test('FROM DUAL and SYSTIMESTAMP', () => {
  const sql = `SELECT (SELECT COUNT(*) FROM PSRECDEFN WHERE RECNAME = :r) AS N FROM DUAL`;
  assert.equal(ms(sql).sql, `SELECT (SELECT COUNT(*) FROM PSRECDEFN WHERE RECNAME = @r) AS N`);
  assert.equal(db2(sql).sql, `SELECT (SELECT COUNT(*) FROM PSRECDEFN WHERE RECNAME = ?) AS N FROM SYSIBM.SYSDUMMY1`);
  const now = `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS TS FROM DUAL`;
  assert.equal(ms(now).sql, `SELECT FORMAT(CAST(CAST(SYSDATETIME() AS DATETIME2(6)) AS DATETIME2(6)), 'yyyy-MM-ddTHH:mm:ss.ffffff') AS TS`);
  // A database whose datetimes are DATETIME: now in its ticks, timestamps converted to it.
  const dt = (sql: string) => translateSql(sql, 'mssql', {}, { dateTimeType: 'DATETIME' }).sql;
  assert.equal(dt(now), `SELECT FORMAT(CAST(CAST(GETDATE() AS DATETIME2(6)) AS DATETIME2(6)), 'yyyy-MM-ddTHH:mm:ss.ffffff') AS TS`);
  assert.equal(dt(`UPDATE T SET LASTUPDDTTM = TO_TIMESTAMP(:ts, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')`),
    `UPDATE T SET LASTUPDDTTM = CONVERT(DATETIME, CONVERT(DATETIME2(6), @ts, 126))`);
  assert.equal(db2(now).sql,
    `SELECT REPLACE(VARCHAR_FORMAT(CAST(CURRENT TIMESTAMP AS TIMESTAMP(6)), 'YYYY-MM-DD HH24:MI:SS.FF6'), ' ', 'T') AS TS FROM SYSIBM.SYSDUMMY1`);
});

test('dates and timestamps in and out', () => {
  assert.equal(ms(`SELECT TO_CHAR(EFFDT, 'YYYY-MM-DD') AS E FROM PSTREEDEFN`).sql, `SELECT CONVERT(VARCHAR(10), EFFDT, 23) AS E FROM PSTREEDEFN`);
  assert.equal(ms(`SELECT TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD HH24:MI:SS') AS LASTUPD FROM T`).sql, `SELECT CONVERT(VARCHAR(19), LASTUPDDTTM, 120) AS LASTUPD FROM T`);
  assert.equal(ms(`UPDATE T SET LASTUPDDTTM = TO_TIMESTAMP(:ts, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')`).sql,
    `UPDATE T SET LASTUPDDTTM = CONVERT(DATETIME2(6), @ts, 126)`);
  assert.equal(db2(`UPDATE T SET LASTUPDDTTM = TO_TIMESTAMP(:ts, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')`).sql,
    `UPDATE T SET LASTUPDDTTM = TIMESTAMP(REPLACE(CAST(? AS VARCHAR(32)), 'T', ' '))`);
  assert.equal(ms(`SELECT 1 FROM T WHERE EFFDT = TO_DATE(:e, 'YYYY-MM-DD')`).sql, `SELECT 1 FROM T WHERE EFFDT = CONVERT(DATE, @e, 23)`);
  assert.throws(() => ms(`SELECT TO_CHAR(X, 'DD-MON-YY') FROM T`), UntranslatableSqlError);
});

test('NVL(TRIM(x), y) keeps Oracle\'s blank-is-NULL meaning', () => {
  assert.equal(ms(`SELECT NVL(TRIM(P.PORTAL_LINK_PORTAL), P.PORTAL_NAME) FROM PSPRSMDEFN P`).sql,
    `SELECT COALESCE(NULLIF(LTRIM(RTRIM(P.PORTAL_LINK_PORTAL)), ''), P.PORTAL_NAME) FROM PSPRSMDEFN P`);
  assert.equal(db2(`SELECT NVL(TRIM(P.PORTAL_LINK_PORTAL), P.PORTAL_NAME) FROM PSPRSMDEFN P`).sql,
    `SELECT COALESCE(NULLIF(TRIM(P.PORTAL_LINK_PORTAL), ''), P.PORTAL_NAME) FROM PSPRSMDEFN P`);
});

test('SUBSTR, RPAD, LENGTH and DBMS_LOB', () => {
  assert.equal(ms(`SELECT 1 FROM PSSQLDEFN WHERE SUBSTR(SQLID, 1, 12) = RPAD(:a, 12)`).sql,
    `SELECT 1 FROM PSSQLDEFN WHERE SUBSTRING(SQLID, 1, 12) = CAST(@a AS NCHAR(12))`);
  assert.equal(db2(`SELECT 1 FROM PSSQLDEFN WHERE SUBSTR(SQLID, 1, 12) = RPAD(:a, 12)`).sql,
    `SELECT 1 FROM PSSQLDEFN WHERE SUBSTR(SQLID, 1, 12) = CAST(CAST(? AS VARCHAR(254)) AS CHAR(12))`);
  assert.equal(ms(`SELECT DBMS_LOB.SUBSTR(SQLTEXT, 4000, 1) AS T, DBMS_LOB.GETLENGTH(SQLTEXT) AS L FROM PSSQLTEXTDEFN`).sql,
    `SELECT SUBSTRING(SQLTEXT, 1, 4000) AS T, (LEN(SQLTEXT + N'x') - 1) AS L FROM PSSQLTEXTDEFN`);
  assert.equal(db2(`SELECT DBMS_LOB.SUBSTR(SQLTEXT, 4000, 1) AS T FROM PSSQLTEXTDEFN`).sql,
    `SELECT SUBSTRING(SQLTEXT, 1, LEAST(4000, LENGTH(SQLTEXT, CODEUNITS16) - 1 + 1), CODEUNITS16) AS T FROM PSSQLTEXTDEFN`);
  // A column named LENGTH is not the function.
  assert.equal(ms(`SELECT D.LENGTH FROM PSDBFIELD D`).sql, `SELECT D.LENGTH FROM PSDBFIELD D`);
});

test('strings are never rewritten', () => {
  assert.equal(ms(`SELECT 'a || b FROM DUAL FOR UPDATE' AS X FROM T WHERE Y = ':notabind'`).sql,
    `SELECT 'a || b FROM DUAL FOR UPDATE' AS X FROM T WHERE Y = ':notabind'`);
});

test('a schema other than the default is named on each table (SQL Server)', () => {
  assert.equal(ms(`SELECT R.RECNAME FROM PSRECDEFN R, PSRECFIELD F WHERE R.RECNAME = F.RECNAME AND R.RECNAME IN (SELECT RECNAME FROM PSRECDEL)`, {}, 'HR').sql,
    `SELECT R.RECNAME FROM HR.PSRECDEFN R, HR.PSRECFIELD F WHERE R.RECNAME = F.RECNAME AND R.RECNAME IN (SELECT RECNAME FROM HR.PSRECDEL)`);
  assert.equal(ms(`INSERT INTO PSLOCK (A) VALUES (:a)`, {}, 'HR').sql, `INSERT INTO HR.PSLOCK (A) VALUES (@a)`);
  assert.equal(ms(`UPDATE PSVERSION SET VERSION = :v`, {}, 'HR').sql, `UPDATE HR.PSVERSION SET VERSION = @v`);
  assert.equal(ms(`DELETE FROM PSXLATITEM WHERE FIELDNAME = :f`, {}, 'HR').sql, `DELETE FROM HR.PSXLATITEM WHERE FIELDNAME = @f`);
});

test('Oracle-only constructs are refused, not passed on', () => {
  assert.throws(() => ms(`SELECT 1 FROM T WHERE ROWNUM = 1`), /ROWNUM/);
  assert.throws(() => db2(`SELECT DECODE(A, 1, 2) FROM T`), /DECODE/);
  assert.throws(() => ms(`SELECT 1 FROM T WHERE REGEXP_LIKE(A, '^x')`), /REGEXP_LIKE/);
  assert.throws(() => ms(`SELECT 1 FROM M WHERE (M.A, M.B) IN (SELECT A, B FROM S)`), /row-value/);
  // A function's arguments and an IN list are not row values.
  assert.equal(ms(`SELECT 1 FROM T WHERE COALESCE(A, B) IN ('1', '2')`).sql, `SELECT 1 FROM T WHERE COALESCE(A, B) IN ('1', '2')`);
});
