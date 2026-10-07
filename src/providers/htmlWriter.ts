import type { Connection } from 'oracledb';
import { isScratchName } from '../peoplecode/corpus/labSafety.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Saving an HTML definition, as App Designer does (docs/HTML_SAVE.md, cases
 * h01-h04, ZZ_PCODE_LAB_HTML):
 *
 *   PSCONTDEFN   one row, ALTCONTNUM 1, CONTTYPE 4: inserted on create (CONTFMT
 *                ' ', CONTSTYLE 0, DESCR ' ', URL ' ', COMPALG 0, AUXFLAGMASK 0,
 *                OBJECTOWNERID ' '); on a save deleted and reinserted with the
 *                rest kept; VERSION = the new PSVERSION CRM, LASTUPDDTTM /
 *                LASTUPDOPRID the save's
 *   PSCONTENT    the text rows deleted, the text inserted: UTF-16LE with a NUL
 *                terminator, lines ended CRLF, in chunks of 32,000 bytes from
 *                SEQNUM 0 (674 of 674 non-final chunks on HRDMO are 32,000 bytes)
 *   PSVERSION    CRM + 1, SYS + 1
 *   PSLOCK       CRM + 1
 *
 * Scope: scratch names (ZZ_PCODE_LAB%), HTML (CONTTYPE 4) with one
 * ALTCONTNUM 1 row and no language rows, as all 3,142 on HRDMO are.
 */

export class HtmlSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HtmlSaveRefusedError';
  }
}

export const HTML_CONTTYPE = 4;
export const HTML_CHUNK_BYTES = 32000;

export interface HtmlSaveRequest {
  name: string;
  text: string;
  /** PSCONTDEFN.VERSION when opened; undefined creates the definition (refused if it exists). */
  openedVersion?: number;
  /** A new description (PSCONTDEFN.DESCR, at most 30): saved with the text, as App Designer did (h03). */
  description?: string;
  operatorId: string;
}

export interface HtmlSaveResult {
  version: number;
  lastupddttm: string;
  created: boolean;
}

interface Counters { crm: number; sys: number; lockCrm: number }

async function readCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('CRM', 'SYS')${lock}`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'CRM'${lock}`);
  const get = (name: string) => v.find((r) => String(r.T).trim() === name)?.V;
  const crm = get('CRM');
  const sys = get('SYS');
  if (crm === undefined || sys === undefined || l.length !== 1) {
    throw new HtmlSaveRefusedError('PSVERSION CRM / SYS or PSLOCK CRM is missing; refusing to write.');
  }
  return { crm: Number(crm), sys: Number(sys), lockCrm: Number(l[0].V) };
}

/** The text as App Designer stores it: lines ended CRLF (2,503 multi-line HTML texts on HRDMO, none bare LF). */
export function prepareHtmlText(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/** The stored bytes, NUL-terminated UTF-16LE, cut into PSCONTENT rows. */
export function htmlChunks(text: string): Buffer[] {
  const bytes = Buffer.from(prepareHtmlText(text) + '\0', 'utf16le');
  const out: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += HTML_CHUNK_BYTES) out.push(bytes.subarray(i, i + HTML_CHUNK_BYTES));
  return out;
}

/** `blobType` is the driver's BLOB bind type (oracledb.BLOB), as the PeopleCode writer binds PROGTXT. */
/**
 * Why text cannot be stored as content here, if it cannot: a NUL inside it,
 * or a terminator exactly at a chunk boundary -- no stored text ends a chunk
 * at its terminator or one character before it (HRDMO's 127 final HTML
 * chunks), so how App Designer cuts those is not established.
 */
export function contentTextRefusal(text: string): string | undefined {
  if (text.includes('\0')) return 'The text contains a NUL character.';
  const stored = prepareHtmlText(text).length + 1;
  const perChunk = HTML_CHUNK_BYTES / 2;
  if (stored > perChunk && (stored % perChunk === 0 || stored % perChunk === 1)) {
    return `Text of exactly ${stored - 1} characters (a 16,000-character chunk boundary) is not saved here yet; add or remove a character.`;
  }
  return undefined;
}

export async function saveHtmlDefinition(c: Connection, blobType: unknown, request: HtmlSaveRequest): Promise<HtmlSaveResult> {
  const name = request.name;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new HtmlSaveRefusedError(operatorError);
    if (!isScratchName(name)) throw new HtmlSaveRefusedError(`${name} is outside ZZ_PCODE_LAB: saving HTML is limited to scratch definitions for now.`);
    if (name.length > 30 || !/^[A-Z0-9_]+$/.test(name)) throw new HtmlSaveRefusedError(`${name} is not a valid definition name (A-Z, 0-9, _; at most 30).`);
    const textError = contentTextRefusal(request.text);
    if (textError) throw new HtmlSaveRefusedError(textError);
    if (request.description !== undefined && request.description.length > 30) throw new HtmlSaveRefusedError('The description is at most 30 characters.');
    const descr = request.description === undefined ? undefined : request.description.trim() || ' ';
    const create = request.openedVersion === undefined;

    const defns = await select<{ VERSION: number; CONTTYPE: number; ALTCONTNUM: number }>(c,
      `SELECT VERSION, CONTTYPE, ALTCONTNUM FROM SYSADM.PSCONTDEFN WHERE CONTNAME = :n FOR UPDATE`, { n: name });
    if (create) {
      if (defns.length > 0) throw new HtmlSaveRefusedError(`A content definition named ${name} already exists.`);
      const [{ N: orphans }] = await select<{ N: number }>(c,
        `SELECT (SELECT COUNT(*) FROM SYSADM.PSCONTENT WHERE CONTNAME = :n) + (SELECT COUNT(*) FROM SYSADM.PSCONTDEFNLANG WHERE CONTNAME = :n)
              + (SELECT COUNT(*) FROM SYSADM.PSCONTENTLANG WHERE CONTNAME = :n) AS N FROM DUAL`, { n: name });
      if (Number(orphans) > 0) throw new HtmlSaveRefusedError(`${name} has content rows but no definition; refusing to write.`);
    } else {
      const d = defns[0];
      if (defns.length !== 1 || Number(d.CONTTYPE) !== HTML_CONTTYPE || Number(d.ALTCONTNUM) !== 1) {
        throw new HtmlSaveRefusedError(`${name} is not a single HTML definition (CONTTYPE 4, ALTCONTNUM 1); not saved here.`);
      }
      if (Number(d.VERSION) !== request.openedVersion) {
        throw new HtmlSaveRefusedError(`${name} was saved since it was opened (version ${d.VERSION}, not ${request.openedVersion}). Reopen it and reapply your edit.`);
      }
      const [{ N: lang }] = await select<{ N: number }>(c,
        `SELECT (SELECT COUNT(*) FROM SYSADM.PSCONTDEFNLANG WHERE CONTNAME = :n) + (SELECT COUNT(*) FROM SYSADM.PSCONTENTLANG WHERE CONTNAME = :n) AS N FROM DUAL`,
        { n: name });
      if (Number(lang) > 0) throw new HtmlSaveRefusedError(`${name} has translations (language rows); not saved here yet.`);
    }
    if (!(await operatorExists(c, request.operatorId))) {
      throw new HtmlSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const counters = await readCounters(c, true);
    const next: Counters = { crm: counters.crm + 1, sys: counters.sys + 1, lockCrm: counters.lockCrm + 1 };
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const key = { n: name, t: HTML_CONTTYPE };

    if (create) {
      await expectRows(c,
        `INSERT INTO SYSADM.PSCONTDEFN (CONTNAME, ALTCONTNUM, CONTFMT, VERSION, CONTTYPE, CONTSTYLE, DESCR, URL, COMPALG, AUXFLAGMASK,
                                        LASTUPDDTTM, LASTUPDOPRID, OBJECTOWNERID)
         VALUES (:n, 1, ' ', :v, :t, 0, :d, ' ', 0, 0, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, ' ')`,
        { ...key, v: next.crm, d: descr ?? ' ', ts: lastupddttm, op: request.operatorId }, 1, 'Inserting PSCONTDEFN');
    } else {
      await expectRows(c,
        `UPDATE SYSADM.PSCONTDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op${descr !== undefined ? ', DESCR = :d' : ''}
          WHERE CONTNAME = :n AND CONTTYPE = :t AND ALTCONTNUM = 1`,
        { ...key, v: next.crm, ts: lastupddttm, op: request.operatorId, ...(descr !== undefined ? { d: descr } : {}) }, 1, 'Updating PSCONTDEFN');
      await c.execute(`DELETE FROM SYSADM.PSCONTENT WHERE CONTNAME = :n AND CONTTYPE = :t`, key);
    }
    const chunks = htmlChunks(request.text);
    for (const [seq, chunk] of chunks.entries()) {
      await expectRows(c,
        `INSERT INTO SYSADM.PSCONTENT (CONTNAME, ALTCONTNUM, CONTTYPE, SEQNUM, CONTDATA) VALUES (:n, 1, :t, :s, :d)`,
        { ...key, s: seq, d: { val: chunk, type: blobType } }, 1, `Inserting PSCONTENT ${seq}`);
    }
    for (const [table, name2, value] of [['PSVERSION', 'CRM', next.crm], ['PSVERSION', 'SYS', next.sys], ['PSLOCK', 'CRM', next.lockCrm]] as const) {
      await expectRows(c, `UPDATE SYSADM.${table} SET VERSION = :v WHERE OBJECTTYPENAME = :o`, { v: value, o: name2 }, 1, `Updating ${table} ${name2}`);
    }

    const result: HtmlSaveResult = { version: next.crm, lastupddttm, created: create };
    await verifyHtmlSave(c, request, result);
    const now = await readCounters(c, false);
    if (now.crm !== next.crm || now.sys !== next.sys || now.lockCrm !== next.lockCrm) {
      throw new HtmlSaveRefusedError(`counters ${JSON.stringify(now)}, ${JSON.stringify(next)} expected; rolled back.`);
    }
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** The stored definition and text are the save's. */
export async function verifyHtmlSave(c: Connection, request: HtmlSaveRequest, result: HtmlSaveResult): Promise<void> {
  const problems: string[] = [];
  const [d] = await select<{ VERSION: number; TS: string; OPRID: string; DESCR: string }>(c,
    `SELECT VERSION, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS, LASTUPDOPRID AS OPRID, DESCR
       FROM SYSADM.PSCONTDEFN WHERE CONTNAME = :n AND CONTTYPE = :t AND ALTCONTNUM = 1`, { n: request.name, t: HTML_CONTTYPE });
  if (!d || Number(d.VERSION) !== result.version || d.TS !== result.lastupddttm || String(d.OPRID).trim() !== request.operatorId ||
      (request.description !== undefined && String(d.DESCR ?? '').trim() !== request.description.trim())) {
    problems.push(`PSCONTDEFN ${JSON.stringify(d)}`);
  }
  const rows = await select<{ SEQNUM: number; D: Buffer }>(c,
    `SELECT SEQNUM, CONTDATA AS D FROM SYSADM.PSCONTENT WHERE CONTNAME = :n AND CONTTYPE = :t ORDER BY SEQNUM`,
    { n: request.name, t: HTML_CONTTYPE });
  const want = htmlChunks(request.text);
  if (rows.length !== want.length || rows.some((r, i) => Number(r.SEQNUM) !== i || !Buffer.from(r.D).equals(want[i]))) {
    problems.push(`PSCONTENT (${rows.length} rows, ${want.length} expected, or their bytes differ)`);
  }
  if (problems.length) throw new HtmlSaveRefusedError(`The HTML save did not land as planned (${problems.join('; ')}).`);
}
