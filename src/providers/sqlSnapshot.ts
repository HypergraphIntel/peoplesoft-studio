import { createHash } from 'node:crypto';
import type { DbConnection, DbTypes } from '../db/connection.js';
import { readTextLob } from '../db/lob.js';
export { readTextLob as readSqlLobValue } from '../db/lob.js';
import { prepareSqlText, SQL_TEXT_ROW_LIMIT, type SqlDefinitionData } from '../model/sqlDefinition.js';

export interface SqlMigrationRead { data: SqlDefinitionData; version: number; token: string }
const tables = ['PSSQLDEFN', 'PSSQLDESCR', 'PSSQLTEXTDEFN', 'PSSQLHASH'] as const;
const columns: Record<typeof tables[number], string> = {
  PSSQLDEFN: `SQLID, SQLTYPE, VERSION, LASTUPDOPRID, TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS STAMP, ENABLEEFFDT, OBJECTOWNERID`,
  PSSQLDESCR: "SQLID, SQLTYPE, MARKET, DBTYPE, TO_CHAR(EFFDT, 'YYYY-MM-DD') AS EFFDT, DESCR, DESCRLONG",
  PSSQLTEXTDEFN: "SQLID, SQLTYPE, MARKET, DBTYPE, TO_CHAR(EFFDT, 'YYYY-MM-DD') AS EFFDT, SEQNUM, SQLTEXT",
  PSSQLHASH: "SQLID, SQLTYPE, MARKET, DBTYPE, TO_CHAR(EFFDT, 'YYYY-MM-DD') AS EFFDT, HASH_SIGNATURE"
};

/** Oracle's direct CLOB-to-string fetch can split a supplementary character at
 * its inline-data boundary. Read the complete locator instead (HRDMO evidence:
 * 19,200-character comments, emoji at UTF-16 offset 4,029). Other adapters
 * already return strings. Always release the locator, including failed reads. */

/** Read every supported row, never the display reader's preferred variant or CLOB prefix. */
export async function readSqlMigration(c: DbConnection, types: DbTypes, name: string, forUpdate = false): Promise<SqlMigrationRead | undefined> {
  if (!/^[A-Z0-9_]{1,30}$/.test(name)) throw new Error('Invalid standalone SQL name.');
  const raw: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables) {
    raw[table] = (await c.execute<Record<string, unknown>>(
      `SELECT ${columns[table]} FROM ${table} WHERE SQLID = :id AND SQLTYPE = '0'${forUpdate ? ' FOR UPDATE' : ''}`,
      { id: name }, { outFormat: types.OUT_FORMAT_OBJECT })).rows ?? [];
    const lobColumn = table === 'PSSQLTEXTDEFN' ? 'SQLTEXT' : table === 'PSSQLDESCR' ? 'DESCRLONG' : undefined;
    if (lobColumn) for (const row of raw[table]) row[lobColumn] = await readTextLob(row[lobColumn]);
  }
  const [lang] = (await c.execute<{ N: number }>("SELECT COUNT(*) AS N FROM PSSQLLANG WHERE SQLID = :id AND SQLTYPE = '0'", { id: name }, { outFormat: types.OUT_FORMAT_OBJECT })).rows ?? [];
  if (!lang || Number(lang.N) !== 0) throw new Error(name + ': SQL translations require another migration adapter.');
  if (!raw.PSSQLDEFN.length) {
    const [other] = (await c.execute<{ N: number }>('SELECT COUNT(*) AS N FROM PSSQLDEFN WHERE SQLID = :id', { id: name }, { outFormat: types.OUT_FORMAT_OBJECT })).rows ?? [];
    if (!other || Number(other.N) || Object.values(raw).some(rows => rows.length)) throw new Error(name + ': SQL ID has another SQL type or orphan rows.');
    return undefined;
  }
  const refuse = () => new Error(name + ': migration supports one non-effective-dated SQLTYPE 0, GBL / default DBTYPE / 1900-01-01 text, description and hash row, at most 14,000 characters.');
  if (tables.some(t => raw[t].length !== 1)) throw refuse();
  const head = raw.PSSQLDEFN[0], descr = raw.PSSQLDESCR[0], text = raw.PSSQLTEXTDEFN[0];
  if (head.ENABLEEFFDT !== 'N' || !Number.isSafeInteger(head.VERSION) || Number(head.VERSION) < 0
    || ['PSSQLDESCR', 'PSSQLTEXTDEFN', 'PSSQLHASH'].some(t => {
      const r = raw[t][0]; return r.MARKET !== 'GBL' || String(r.DBTYPE).trim() !== '' || r.EFFDT !== '1900-01-01';
    }) || Number(text.SEQNUM) !== 0 || typeof text.SQLTEXT !== 'string' || text.SQLTEXT.length > SQL_TEXT_ROW_LIMIT
    || typeof head.OBJECTOWNERID !== 'string' || typeof descr.DESCR !== 'string'
    || (descr.DESCRLONG !== null && typeof descr.DESCRLONG !== 'string')) throw refuse();
  // A normal native save moves the header. Refuse a snapshot straddling that save.
  const headers = (await c.execute<Record<string, unknown>>(`SELECT ${columns.PSSQLDEFN} FROM PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = '0'`, { id: name }, { outFormat: types.OUT_FORMAT_OBJECT })).rows ?? [];
  if (JSON.stringify(headers) !== JSON.stringify(raw.PSSQLDEFN)) throw new Error(name + ': SQL changed during the read; preview again.');
  return {
    data: { name, text: prepareSqlText(text.SQLTEXT), description: String(descr.DESCR ?? '').trimEnd(),
      definition: String(descr.DESCRLONG ?? ''), ownerId: String(head.OBJECTOWNERID ?? '').trimEnd() },
    version: Number(head.VERSION), token: createHash('sha256').update(JSON.stringify(raw)).digest('hex')
  };
}
