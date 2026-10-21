import { createHash } from 'node:crypto';
import type { DbConnection } from '../db/connection.js';
import { select } from './peopleCodeWriter.js';
import { contentTextRefusal, htmlChunks } from './htmlWriter.js';

export interface ContentMigrationData { name: string; text: string; description: string }
export interface ContentMigrationRead { data: ContentMigrationData; token: string; version: number }

/** Complete bounded content scope. Refuse metadata the calibrated writer cannot reproduce. */
export async function readContentMigration(c: DbConnection, name: string, kind: 'html' | 'stylesheet', lock = false): Promise<ContentMigrationRead | undefined> {
  if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(name)) throw new Error('Invalid text definition name.');
  const suffix = lock ? ' FOR UPDATE' : '', key = { n: name };
  const heads = await select<Record<string, unknown>>(c, `SELECT CONTNAME, ALTCONTNUM, CONTFMT, VERSION, CONTTYPE, CONTSTYLE, DESCR, URL, COMPALG, AUXFLAGMASK, OBJECTOWNERID,
    TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS STAMP, LASTUPDOPRID FROM PSCONTDEFN WHERE CONTNAME=:n${suffix}`, key);
  const rows = await select<{ ALTCONTNUM: number; CONTTYPE: number; SEQNUM: number; CONTDATA: Buffer }>(c,
    `SELECT ALTCONTNUM, CONTTYPE, SEQNUM, CONTDATA FROM PSCONTENT WHERE CONTNAME=:n ORDER BY CONTTYPE, ALTCONTNUM, SEQNUM${suffix}`, key);
  const sheets = kind === 'stylesheet' ? await select<Record<string, unknown>>(c,
    `SELECT STYLESHEETNAME, VERSION, STYLESHEETTYPE, PARENTSTYLENAME, DESCR, NUMSTYLECLASS, OBJECTOWNERID,
      TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS STAMP, LASTUPDOPRID FROM PSSTYLSHEETDEFN WHERE STYLESHEETNAME=:n${suffix}`, key) : [];
  const [others] = await select<{ N: number }>(c, `SELECT (SELECT COUNT(*) FROM PSCONTDEFNLANG WHERE CONTNAME=:n) +
    (SELECT COUNT(*) FROM PSCONTENTLANG WHERE CONTNAME=:n)${kind === 'stylesheet' ? ' + (SELECT COUNT(*) FROM PSSTYLECLASS WHERE STYLESHEETNAME=:n) + (SELECT COUNT(*) FROM PSSTYLSHEETDEL WHERE STYLESHEETNAME=:n)' : ''} AS N FROM DUAL`, key);
  if (!others || Number(others.N)) throw new Error(name + ': translated, classic or deleted content requires another migration adapter.');
  if (!heads.length && !rows.length && !sheets.length) return undefined;
  const refuse = () => new Error(name + ': migration requires one plain HTML/freeform content scope with default auxiliary metadata, no translations or alternate content.');
  const h = heads[0], sheet = sheets[0], type = kind === 'html' ? 4 : 9;
  if (heads.length !== 1 || !rows.length || Number(h.ALTCONTNUM) !== 1 || Number(h.CONTTYPE) !== type || String(h.CONTFMT).trim() ||
    Number(h.CONTSTYLE) || String(h.URL).trim() || Number(h.COMPALG) || Number(h.AUXFLAGMASK) || String(h.OBJECTOWNERID).trim() ||
    kind === 'stylesheet' && (sheets.length !== 1 || Number(sheet.STYLESHEETTYPE) !== 2 || String(sheet.PARENTSTYLENAME).trim() || Number(sheet.NUMSTYLECLASS) || String(sheet.OBJECTOWNERID).trim() || String(h.DESCR).trim())) throw refuse();
  if (rows.some((r, i) => Number(r.CONTTYPE) !== type || Number(r.ALTCONTNUM) !== 1 || Number(r.SEQNUM) !== i || !Buffer.isBuffer(r.CONTDATA))) throw refuse();
  const bytes = Buffer.concat(rows.map(r => r.CONTDATA));
  if (bytes.length > 8 * 1024 * 1024 || bytes.length < 2 || bytes.length % 2 || bytes.readUInt16LE(bytes.length - 2) !== 0) throw refuse();
  const text = bytes.subarray(0, -2).toString('utf16le'), expected = htmlChunks(text);
  if (contentTextRefusal(text) || expected.length !== rows.length || rows.some((r, i) => !r.CONTDATA.equals(expected[i]))) throw refuse();
  const version = Number((kind === 'html' ? h : sheet).VERSION), description = String((kind === 'html' ? h : sheet).DESCR ?? '').trimEnd();
  if (!Number.isSafeInteger(version) || version < 0 || description.length > 30 || description !== description.trim()) throw refuse();
  // Detect a normal save straddling this multi-table read. The token also catches edits without a VERSION bump.
  const table = kind === 'html' ? 'PSCONTDEFN' : 'PSSTYLSHEETDEFN', column = kind === 'html' ? 'CONTNAME' : 'STYLESHEETNAME';
  const check = await select<{ VERSION: number; STAMP: string }>(c, `SELECT VERSION, TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS STAMP FROM ${table} WHERE ${column}=:n`, key);
  if (check.length !== 1 || Number(check[0].VERSION) !== version || check[0].STAMP !== (kind === 'html' ? h : sheet).STAMP) throw new Error(name + ': content changed during the read.');
  return { data: { name, text, description }, version, token: createHash('sha256').update(JSON.stringify({ heads, rows, sheets })).digest('hex') };
}
