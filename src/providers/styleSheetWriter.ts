import type { Connection } from 'oracledb';
import { isScratchName } from '../peoplecode/corpus/labSafety.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { contentTextRefusal, htmlChunks } from './htmlWriter.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Saving a freeform style sheet, as App Designer does (docs/STYLESHEET_SAVE.md,
 * cases s01-s04, ZZ_PCODE_LAB_CSS):
 *
 *   PSSTYLSHEETDEFN  STYLESHEETTYPE 2, PARENTSTYLENAME ' ', NUMSTYLECLASS 0;
 *                    VERSION = the new PSVERSION SSM; stamped. Inserted on create
 *                    (DESCR / OBJECTOWNERID ' '), deleted and reinserted on a
 *                    save with the rest kept
 *   PSCONTDEFN       CONTTYPE 9, ALTCONTNUM 1, the HTML defaults; VERSION = its
 *                    own + 1 on a save (s02, s03), PSVERSION CRM + 1 on create
 *                    (s01). CRM itself does not move. App Designer takes the
 *                    number from a count it keeps for the session (s04 got 14
 *                    with CRM at 11), which nothing stored reproduces
 *   PSCONTENT        the text as HTML stores it (htmlWriter.ts): UTF-16LE, CRLF,
 *                    NUL-terminated, 32,000-byte chunks from SEQNUM 0
 *   PSVERSION        SSM + 1, SYS + 1
 *   PSLOCK           SSM + 1
 *
 * Scope: scratch names (ZZ_PCODE_LAB%), freeform style sheets. Classic and
 * sub style sheets (types 0 and 1) are style classes, not text.
 */

export class StyleSheetSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StyleSheetSaveRefusedError';
  }
}

export const STYLESHEET_CONTTYPE = 9;
export const FREEFORM_STYLESHEET = 2;

export interface StyleSheetSaveRequest {
  name: string;
  text: string;
  /** PSSTYLSHEETDEFN.VERSION when opened; undefined creates the style sheet (refused if it exists). */
  openedVersion?: number;
  operatorId: string;
}

export interface StyleSheetSaveResult {
  version: number;
  contentVersion: number;
  lastupddttm: string;
  created: boolean;
}

interface Counters { ssm: number; sys: number; lockSsm: number; crm: number }

async function readCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('SSM', 'SYS', 'CRM')${lock}`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'SSM'${lock}`);
  const get = (name: string) => {
    const r = v.find((x) => String(x.T).trim() === name);
    if (!r) throw new StyleSheetSaveRefusedError(`PSVERSION ${name} is missing; refusing to write.`);
    return Number(r.V);
  };
  if (l.length !== 1) throw new StyleSheetSaveRefusedError('PSLOCK SSM is missing; refusing to write.');
  return { ssm: get('SSM'), sys: get('SYS'), crm: get('CRM'), lockSsm: Number(l[0].V) };
}

/** `blobType` is the driver's BLOB bind type (oracledb.BLOB). */
export async function saveStyleSheet(c: Connection, blobType: unknown, request: StyleSheetSaveRequest): Promise<StyleSheetSaveResult> {
  const name = request.name;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new StyleSheetSaveRefusedError(operatorError);
    if (!isScratchName(name)) throw new StyleSheetSaveRefusedError(`${name} is outside ZZ_PCODE_LAB: saving style sheets is limited to scratch definitions for now.`);
    if (name.length > 30 || !/^[A-Z0-9_]+$/.test(name)) throw new StyleSheetSaveRefusedError(`${name} is not a valid definition name (A-Z, 0-9, _; at most 30).`);
    const textError = contentTextRefusal(request.text);
    if (textError) throw new StyleSheetSaveRefusedError(textError);
    const create = request.openedVersion === undefined;

    const sheets = await select<{ VERSION: number; STYLESHEETTYPE: number; NUMSTYLECLASS: number }>(c,
      `SELECT VERSION, STYLESHEETTYPE, NUMSTYLECLASS FROM SYSADM.PSSTYLSHEETDEFN WHERE STYLESHEETNAME = :n FOR UPDATE`, { n: name });
    const contents = await select<{ VERSION: number; CONTTYPE: number; ALTCONTNUM: number }>(c,
      `SELECT VERSION, CONTTYPE, ALTCONTNUM FROM SYSADM.PSCONTDEFN WHERE CONTNAME = :n FOR UPDATE`, { n: name });
    const [{ N: others }] = await select<{ N: number }>(c,
      `SELECT (SELECT COUNT(*) FROM SYSADM.PSSTYLECLASS WHERE STYLESHEETNAME = :n) + (SELECT COUNT(*) FROM SYSADM.PSCONTDEFNLANG WHERE CONTNAME = :n)
            + (SELECT COUNT(*) FROM SYSADM.PSCONTENTLANG WHERE CONTNAME = :n) + (SELECT COUNT(*) FROM SYSADM.PSSTYLSHEETDEL WHERE STYLESHEETNAME = :n) AS N FROM DUAL`,
      { n: name });
    if (create) {
      if (sheets.length > 0) throw new StyleSheetSaveRefusedError(`A style sheet named ${name} already exists.`);
      if (contents.length > 0) throw new StyleSheetSaveRefusedError(`A content definition named ${name} already exists.`);
      const [{ N: text }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSCONTENT WHERE CONTNAME = :n`, { n: name });
      if (Number(text) + Number(others) > 0) throw new StyleSheetSaveRefusedError(`${name} has leftover style sheet or content rows; refusing to write.`);
    } else {
      const s = sheets[0];
      if (sheets.length !== 1 || Number(s.STYLESHEETTYPE) !== FREEFORM_STYLESHEET) {
        throw new StyleSheetSaveRefusedError(`${name} is not a freeform style sheet; only freeform style sheets are saved as text.`);
      }
      if (Number(s.VERSION) !== request.openedVersion) {
        throw new StyleSheetSaveRefusedError(`${name} was saved since it was opened (version ${s.VERSION}, not ${request.openedVersion}). Reopen it and reapply your edit.`);
      }
      const d = contents[0];
      if (contents.length !== 1 || Number(d.CONTTYPE) !== STYLESHEET_CONTTYPE || Number(d.ALTCONTNUM) !== 1) {
        throw new StyleSheetSaveRefusedError(`${name}'s text is not a single style sheet content row (CONTTYPE 9, ALTCONTNUM 1); not saved here.`);
      }
      if (Number(others) > 0) throw new StyleSheetSaveRefusedError(`${name} has style classes, translations or a deletion marker; not saved here.`);
    }
    if (!(await operatorExists(c, request.operatorId))) {
      throw new StyleSheetSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const counters = await readCounters(c, true);
    const next = { ssm: counters.ssm + 1, sys: counters.sys + 1, lockSsm: counters.lockSsm + 1 };
    const contentVersion = create ? counters.crm + 1 : Number(contents[0].VERSION) + 1;
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const stamp = { ts: lastupddttm, op: request.operatorId };
    const key = { n: name, t: STYLESHEET_CONTTYPE };

    if (create) {
      await expectRows(c,
        `INSERT INTO SYSADM.PSSTYLSHEETDEFN (STYLESHEETNAME, VERSION, STYLESHEETTYPE, PARENTSTYLENAME, DESCR, NUMSTYLECLASS,
                                             LASTUPDDTTM, LASTUPDOPRID, OBJECTOWNERID)
         VALUES (:n, :v, 2, ' ', ' ', 0, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, ' ')`,
        { n: name, v: next.ssm, ...stamp }, 1, 'Inserting PSSTYLSHEETDEFN');
      await expectRows(c,
        `INSERT INTO SYSADM.PSCONTDEFN (CONTNAME, ALTCONTNUM, CONTFMT, VERSION, CONTTYPE, CONTSTYLE, DESCR, URL, COMPALG, AUXFLAGMASK,
                                        LASTUPDDTTM, LASTUPDOPRID, OBJECTOWNERID)
         VALUES (:n, 1, ' ', :v, :t, 0, ' ', ' ', 0, 0, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, ' ')`,
        { ...key, v: contentVersion, ...stamp }, 1, 'Inserting PSCONTDEFN');
    } else {
      await expectRows(c,
        `UPDATE SYSADM.PSSTYLSHEETDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
          WHERE STYLESHEETNAME = :n`, { n: name, v: next.ssm, ...stamp }, 1, 'Updating PSSTYLSHEETDEFN');
      await expectRows(c,
        `UPDATE SYSADM.PSCONTDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
          WHERE CONTNAME = :n AND CONTTYPE = :t AND ALTCONTNUM = 1`, { ...key, v: contentVersion, ...stamp }, 1, 'Updating PSCONTDEFN');
      await c.execute(`DELETE FROM SYSADM.PSCONTENT WHERE CONTNAME = :n AND CONTTYPE = :t`, key);
    }
    for (const [seq, chunk] of htmlChunks(request.text).entries()) {
      await expectRows(c,
        `INSERT INTO SYSADM.PSCONTENT (CONTNAME, ALTCONTNUM, CONTTYPE, SEQNUM, CONTDATA) VALUES (:n, 1, :t, :s, :d)`,
        { ...key, s: seq, d: { val: chunk, type: blobType } }, 1, `Inserting PSCONTENT ${seq}`);
    }
    for (const [table, counter, value] of [['PSVERSION', 'SSM', next.ssm], ['PSVERSION', 'SYS', next.sys], ['PSLOCK', 'SSM', next.lockSsm]] as const) {
      await expectRows(c, `UPDATE SYSADM.${table} SET VERSION = :v WHERE OBJECTTYPENAME = :o`, { v: value, o: counter }, 1, `Updating ${table} ${counter}`);
    }

    const result: StyleSheetSaveResult = { version: next.ssm, contentVersion, lastupddttm, created: create };
    await verifyStyleSheetSave(c, request, result);
    const now = await readCounters(c, false);
    if (now.ssm !== next.ssm || now.sys !== next.sys || now.lockSsm !== next.lockSsm || now.crm !== counters.crm) {
      throw new StyleSheetSaveRefusedError(`counters ${JSON.stringify(now)}, ${JSON.stringify(next)} expected; rolled back.`);
    }
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** The stored style sheet, content row and text are the save's. */
export async function verifyStyleSheetSave(c: Connection, request: StyleSheetSaveRequest, result: StyleSheetSaveResult): Promise<void> {
  const problems: string[] = [];
  const stamped = (row: { VERSION: number; TS: string; OPRID: string } | undefined, version: number) =>
    row && Number(row.VERSION) === version && row.TS === result.lastupddttm && String(row.OPRID).trim() === request.operatorId;
  const [s] = await select<{ VERSION: number; TS: string; OPRID: string; T: number }>(c,
    `SELECT VERSION, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS, LASTUPDOPRID AS OPRID, STYLESHEETTYPE AS T
       FROM SYSADM.PSSTYLSHEETDEFN WHERE STYLESHEETNAME = :n`, { n: request.name });
  if (!stamped(s, result.version) || Number(s.T) !== FREEFORM_STYLESHEET) problems.push(`PSSTYLSHEETDEFN ${JSON.stringify(s)}`);
  const [d] = await select<{ VERSION: number; TS: string; OPRID: string }>(c,
    `SELECT VERSION, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS, LASTUPDOPRID AS OPRID
       FROM SYSADM.PSCONTDEFN WHERE CONTNAME = :n AND CONTTYPE = :t AND ALTCONTNUM = 1`, { n: request.name, t: STYLESHEET_CONTTYPE });
  if (!stamped(d, result.contentVersion)) problems.push(`PSCONTDEFN ${JSON.stringify(d)}`);
  const rows = await select<{ SEQNUM: number; D: Buffer }>(c,
    `SELECT SEQNUM, CONTDATA AS D FROM SYSADM.PSCONTENT WHERE CONTNAME = :n AND CONTTYPE = :t ORDER BY SEQNUM`,
    { n: request.name, t: STYLESHEET_CONTTYPE });
  const want = htmlChunks(request.text);
  if (rows.length !== want.length || rows.some((r, i) => Number(r.SEQNUM) !== i || !Buffer.from(r.D).equals(want[i]))) {
    problems.push(`PSCONTENT (${rows.length} rows, ${want.length} expected, or their bytes differ)`);
  }
  if (problems.length) throw new StyleSheetSaveRefusedError(`The style sheet save did not land as planned (${problems.join('; ')}).`);
}
