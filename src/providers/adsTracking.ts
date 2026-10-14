import { createHash } from 'node:crypto';
import type { DbConnection as Connection } from '../db/connection.js';
import type { Statement } from './appEngineWriter.js';
import { select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Data Migration Workbench change tracking (PSADSTRACKING): PIA records a row
 * for each key of a tracked record it saves -- the records PSADSTRACKITEM
 * lists against a data set (ADS) -- and refreshes its stamp on later saves.
 * Writers that save as a PIA page does write these rows too, or the
 * workbench's compare misses the change.
 *
 * The key hash is Oracle's (UPGPTADSTRK.MAIN Tracking, CalcKeyHash): the key
 * fields sorted by name, "( NAME = value )" each, concatenated, then
 * PeopleCode Hash() -- SHA-1 over the UTF-16LE text, base64. Proven on rows
 * PIA wrote [em01-em03]. PTKEYCOLn / PTKEYVALUEn hold the keys in the
 * record's key order, the unused ones a space.
 */

export type TrackedKey = readonly (readonly [string, string | number])[];

/** PSADSTRACKING.PTKEYHASH for a row's keys (in key order). */
export function adsKeyHash(keys: TrackedKey): string {
  const text = [...keys].map(([n, v]) => [n, String(v).trim()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([n, v]) => `( ${n} = ${v} )`).join('');
  return createHash('sha1').update(Buffer.from(text, 'utf16le')).digest('base64');
}

/** The (data set, record) pairs this database tracks. */
export async function trackedRecords(c: Connection, recnames: readonly string[]): Promise<Set<string>> {
  if (!recnames.length) return new Set();
  const binds: Record<string, unknown> = {};
  recnames.forEach((r, i) => { binds[`r${i}`] = r; });
  const rows = await select<{ A: string; R: string }>(c,
    `SELECT PTADSNAME AS A, RECNAME AS R FROM PSADSTRACKITEM WHERE RECNAME IN (${recnames.map((_, i) => `:r${i}`).join(', ')})`, binds);
  return new Set(rows.map((r) => `${String(r.A).trim()}|${String(r.R).trim()}`));
}

/** The data sets that track a record, of those found. */
export function dataSetsOf(tracked: Set<string>, recname: string): string[] {
  return [...tracked].filter((k) => k.endsWith(`|${recname}`)).map((k) => k.slice(0, k.indexOf('|'))).sort();
}

/**
 * The row's tracking stamped now: refreshed when the key has a row, inserted
 * when not (an UPDATE, then an INSERT guarded by NOT EXISTS), so the plan
 * needs no read of PSADSTRACKING.
 */
export function trackingUpsert(ads: string, recname: string, keys: TrackedKey, ts: string, operatorId: string, hashKeys: TrackedKey = keys): Statement[] {
  // hashKeys: the keys PIA hashed, when they are not the ones it lists (a drop zone's menu folder row, dz01).
  const key = { a: ads, r: recname, h: adsKeyHash(hashKeys) };
  const binds: Record<string, unknown> = { ...key, ts, op: operatorId };
  for (let i = 0; i < 16; i++) {
    binds[`c${i + 1}`] = keys[i] ? keys[i][0] : ' ';
    binds[`v${i + 1}`] = keys[i] ? String(keys[i][1]).trim() || ' ' : ' ';
  }
  const cols = Array.from({ length: 16 }, (_, i) => `PTKEYCOL${i + 1}`);
  const vals = Array.from({ length: 16 }, (_, i) => `PTKEYVALUE${i + 1}`);
  return [
    {
      sql: `UPDATE PSADSTRACKING SET LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE PTADSNAME = :a AND RECNAME = :r AND PTKEYHASH = :h`,
      binds: { ...key, ts, op: operatorId }, what: `Tracking ${recname} (${ads})`
    },
    {
      sql: `INSERT INTO PSADSTRACKING (PTADSNAME, RECNAME, PTSESSIONID, PTKEYHASH, ${cols.join(', ')}, ${vals.join(', ')}, LASTUPDDTTM, LASTUPDOPRID)
            SELECT :a, :r, ' ', :h, ${cols.map((_, i) => `:c${i + 1}`).join(', ')}, ${vals.map((_, i) => `:v${i + 1}`).join(', ')}, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op FROM DUAL
             WHERE NOT EXISTS (SELECT 'X' FROM PSADSTRACKING WHERE PTADSNAME = :a AND RECNAME = :r AND PTKEYHASH = :h)`,
      binds, what: `Tracking ${recname} (${ads})`
    }
  ];
}

/** The row's tracking removed (PIA drops a removed content reference's RCF_SERVICE_CREFS row [em07]). */
export function trackingDelete(ads: string, recname: string, keys: TrackedKey): Statement {
  return { sql: 'DELETE FROM PSADSTRACKING WHERE PTADSNAME = :a AND RECNAME = :r AND PTKEYHASH = :h', binds: { a: ads, r: recname, h: adsKeyHash(keys) }, what: `Untracking ${recname} (${ads})` };
}

/** The row's tracking re-stamped, not inserted: PIA refreshes the rows of what a drop-zone removal deletes and keeps them [dz02]. */
export function trackingRefresh(ads: string, recname: string, hashKeys: TrackedKey, ts: string, operatorId: string): Statement {
  return {
    sql: `UPDATE PSADSTRACKING SET LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE PTADSNAME = :a AND RECNAME = :r AND PTKEYHASH = :h`,
    binds: { a: ads, r: recname, h: adsKeyHash(hashKeys), ts, op: operatorId }, what: `Tracking ${recname} (${ads})`
  };
}
