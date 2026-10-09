import type { DbConnection as Connection } from '../db/connection.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Saving a page's layout, as App Designer does (docs/PAGE_SAVE.md, cases
 * 01-09 on ZZ_PCODE_LAB_PG). This first step covers changes to existing
 * controls -- move, resize, label, use -- and deleting controls; adding a new
 * control (a full PSPNLFIELD row of defaults) is a later step.
 *
 *   PSVERSION / PSLOCK  'PDM' + 1; PSVERSION 'SYS' + 1
 *   PSPNLDEFN           VERSION = the new PDM, FIELDCOUNT = control count,
 *                       LASTUPDDTTM / LASTUPDOPRID the save's. MAXPNLFLDID is
 *                       unchanged here (it only grows when a control is added).
 *   PSPNLFIELD          per changed control, only the changed columns
 *                       (move: FIELDLEFT/TOP + the label EDITLBL*; resize:
 *                       FIELDRIGHT/BOTTOM + FIELDSIZETYPE; label: LBLTYPE/
 *                       LBLTEXT; use: FIELDUSE + SECUREINVISIBLE); FIELDNUM
 *                       where the contiguous order changed. A deleted control's
 *                       PSPNLFIELD and PSPNLFIELDEXT rows are removed.
 *   PSPNLFIELDEXT       removed with a deleted control (its own columns are not
 *                       edited here).
 *
 * A move / resize / label / use edit never adds or removes a control, so
 * MAXPNLFLDID and the row set are unchanged; only a delete removes rows, and a
 * deleted PNLFLDID is never reused (MAXPNLFLDID stays). PNLNAME must be in the
 * write scope.
 */

export class PageSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageSaveRefusedError';
  }
}

/** The editable columns of one control, as the Layout editor sets them. */
export interface EditedControl {
  /** PSPNLFIELD.PNLFLDID of an existing control (this step edits existing controls only). */
  pnlFldId: number;
  fieldLeft: number;
  fieldTop: number;
  fieldRight: number;
  fieldBottom: number;
  editLblLeft: number;
  editLblTop: number;
  editLblRight: number;
  editLblBottom: number;
  /** PSPNLFIELD.FIELDSIZETYPE: 0 auto, 2 custom (set when resized). */
  fieldSizeType: number;
  /** PSPNLFIELD.LBLTYPE / LBLTEXT. */
  lblType: number;
  lblText: string;
  /** PSPNLFIELD.FIELDUSE bit-mask (0x01 Display Only, 0x02 Invisible). */
  fieldUse: number;
  /** PSPNLFIELD.SECUREINVISIBLE (set with the Invisible bit). */
  secureInvisible: number;
}

export interface PageSaveRequest {
  pnlName: string;
  /** PSPNLDEFN.VERSION when the page was opened; the save is refused if it moved. */
  openedVersion: number;
  operatorId: string;
  /** The surviving controls, in the order they should be numbered. Existing PNLFLDIDs only. */
  controls: EditedControl[];
}

export interface PageSaveResult {
  version: number;
  fieldCount: number;
  updated: number;
  deleted: number;
}

/** A stored control's editable columns plus its FIELDNUM, read before the write. */
export interface StoredControl extends EditedControl {
  fieldNum: number;
}

/** The columns of PSPNLFIELD this step may change, and how a control's value is read for each. */
const EDITABLE: Array<{ col: string; of: (c: EditedControl) => number | string }> = [
  { col: 'FIELDLEFT', of: (c) => c.fieldLeft },
  { col: 'FIELDTOP', of: (c) => c.fieldTop },
  { col: 'FIELDRIGHT', of: (c) => c.fieldRight },
  { col: 'FIELDBOTTOM', of: (c) => c.fieldBottom },
  { col: 'EDITLBLLEFT', of: (c) => c.editLblLeft },
  { col: 'EDITLBLTOP', of: (c) => c.editLblTop },
  { col: 'EDITLBLRIGHT', of: (c) => c.editLblRight },
  { col: 'EDITLBLBOTTOM', of: (c) => c.editLblBottom },
  { col: 'FIELDSIZETYPE', of: (c) => c.fieldSizeType },
  { col: 'LBLTYPE', of: (c) => c.lblType },
  { col: 'LBLTEXT', of: (c) => c.lblText },
  { col: 'FIELDUSE', of: (c) => c.fieldUse },
  { col: 'SECUREINVISIBLE', of: (c) => c.secureInvisible }
];

export interface PagePlan {
  /** PNLFLDIDs whose PSPNLFIELD / PSPNLFIELDEXT rows are removed. */
  deletes: number[];
  /** Per surviving control: the columns that changed (name -> new value), including FIELDNUM when its order moved. */
  updates: Array<{ pnlFldId: number; columns: Record<string, number | string> }>;
  /** The control count after the save (PSPNLDEFN.FIELDCOUNT). */
  fieldCount: number;
}

/**
 * The change plan from the stored controls to the edited ones: which rows are
 * deleted, and which columns change on each survivor (geometry / label / use,
 * and FIELDNUM when the contiguous order shifts). Pure -- the writer wraps the
 * database around it, and the tests check it without one.
 */
export function planPageSave(stored: readonly StoredControl[], controls: readonly EditedControl[]): PagePlan {
  const edited = new Map(controls.map((c) => [c.pnlFldId, c]));
  const storedById = new Map(stored.map((c) => [c.pnlFldId, c]));

  for (const c of controls) {
    if (!storedById.has(c.pnlFldId)) {
      throw new PageSaveRefusedError(`Control ${c.pnlFldId} is not on the stored page; adding controls is not supported here yet.`);
    }
  }

  const deletes = stored.filter((c) => !edited.has(c.pnlFldId)).map((c) => c.pnlFldId);

  // FIELDNUM is a contiguous 1..N order; the survivors keep their relative
  // order (the editor does not reorder in this step) with the deleted gaps closed.
  const survivors = stored.filter((c) => edited.has(c.pnlFldId)).sort((a, b) => a.fieldNum - b.fieldNum);
  const newFieldNum = new Map(survivors.map((c, i) => [c.pnlFldId, i + 1]));

  const updates: PagePlan['updates'] = [];
  for (const s of survivors) {
    const e = edited.get(s.pnlFldId)!;
    const columns: Record<string, number | string> = {};
    for (const { col, of } of EDITABLE) {
      if (of(e) !== of(s)) columns[col] = of(e);
    }
    const num = newFieldNum.get(s.pnlFldId)!;
    if (num !== s.fieldNum) columns.FIELDNUM = num;
    if (Object.keys(columns).length > 0) updates.push({ pnlFldId: s.pnlFldId, columns });
  }

  return { deletes, updates, fieldCount: controls.length };
}

/** PSVERSION / PSLOCK 'PDM' and PSVERSION 'SYS', locked for the save. */
async function counters(c: Connection, forUpdate: boolean): Promise<{ pdm: number; sys: number; lockPdm: number }> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('PDM', 'SYS')${lock}`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME = 'PDM'${lock}`);
  const get = (t: string) => v.find((r) => String(r.T).trim() === t)?.V;
  const pdm = get('PDM');
  const sys = get('SYS');
  if (pdm === undefined || sys === undefined || l.length !== 1) {
    throw new PageSaveRefusedError('PSVERSION PDM / SYS or PSLOCK PDM is missing; refusing to write.');
  }
  return { pdm: Number(pdm), sys: Number(sys), lockPdm: Number(l[0].V) };
}

const quoteText = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function savePage(c: Connection, request: PageSaveRequest): Promise<PageSaveResult> {
  const { pnlName, operatorId } = request;
  const scope = writeScopeRefusal(pnlName);
  if (scope) throw new PageSaveRefusedError(scope);
  const opError = validateOperatorId(operatorId);
  if (opError) throw new PageSaveRefusedError(opError);

  try {
    if (!(await operatorExists(c, operatorId))) {
      throw new PageSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const [defn] = await select<{ VERSION: number; MAXPNLFLDID: number }>(c,
      `SELECT VERSION, MAXPNLFLDID FROM PSPNLDEFN WHERE PNLNAME = :n FOR UPDATE`, { n: pnlName });
    if (!defn) throw new PageSaveRefusedError(`No page named ${pnlName}.`);
    if (Number(defn.VERSION) !== request.openedVersion) {
      throw new PageSaveRefusedError(`${pnlName} changed since it was opened (version ${defn.VERSION}, opened ${request.openedVersion}); reopen it.`);
    }

    const storedRows = await select<Record<string, number | string>>(c,
      `SELECT PNLFLDID, FIELDNUM, FIELDLEFT, FIELDTOP, FIELDRIGHT, FIELDBOTTOM, EDITLBLLEFT, EDITLBLTOP, EDITLBLRIGHT, EDITLBLBOTTOM,
              FIELDSIZETYPE, LBLTYPE, LBLTEXT, FIELDUSE, SECUREINVISIBLE
         FROM PSPNLFIELD WHERE PNLNAME = :n`, { n: pnlName });
    const stored: StoredControl[] = storedRows.map((r) => ({
      pnlFldId: Number(r.PNLFLDID), fieldNum: Number(r.FIELDNUM),
      fieldLeft: Number(r.FIELDLEFT), fieldTop: Number(r.FIELDTOP), fieldRight: Number(r.FIELDRIGHT), fieldBottom: Number(r.FIELDBOTTOM),
      editLblLeft: Number(r.EDITLBLLEFT), editLblTop: Number(r.EDITLBLTOP), editLblRight: Number(r.EDITLBLRIGHT), editLblBottom: Number(r.EDITLBLBOTTOM),
      fieldSizeType: Number(r.FIELDSIZETYPE), lblType: Number(r.LBLTYPE), lblText: String(r.LBLTEXT ?? ''),
      fieldUse: Number(r.FIELDUSE), secureInvisible: Number(r.SECUREINVISIBLE)
    }));

    const plan = planPageSave(stored, request.controls);
    if (plan.deletes.length === 0 && plan.updates.length === 0) {
      // Nothing changed: leave the page, its version and the counters untouched.
      return { version: request.openedVersion, fieldCount: plan.fieldCount, updated: 0, deleted: 0 };
    }
    const next = await counters(c, true);

    const [{ TS: ts }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    for (const id of plan.deletes) {
      await expectRows(c, `DELETE FROM PSPNLFIELD WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id }, 1, `Deleting PSPNLFIELD ${id}`);
      // PSPNLFIELDEXT has one row per control, but a very old page may lack it.
      await c.execute(`DELETE FROM PSPNLFIELDEXT WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
    }

    for (const u of plan.updates) {
      const binds: Record<string, unknown> = { n: pnlName, id: u.pnlFldId };
      const sets = Object.entries(u.columns).map(([col, value], i) => {
        if (col === 'LBLTEXT') return `${col} = ${quoteText(String(value))}`;
        binds[`v${i}`] = value;
        return `${col} = :v${i}`;
      });
      await expectRows(c, `UPDATE PSPNLFIELD SET ${sets.join(', ')} WHERE PNLNAME = :n AND PNLFLDID = :id`, binds, 1, `Updating PSPNLFIELD ${u.pnlFldId}`);
    }

    await expectRows(c,
      `UPDATE PSPNLDEFN SET VERSION = :v, FIELDCOUNT = :fc, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
        WHERE PNLNAME = :n`,
      { v: next.pdm + 1, fc: plan.fieldCount, ts, op: operatorId, n: pnlName }, 1, 'Updating PSPNLDEFN');

    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.pdm + 1 }, 1, 'Updating PSVERSION PDM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys + 1 }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.lockPdm + 1 }, 1, 'Updating PSLOCK PDM');

    const result: PageSaveResult = { version: next.pdm + 1, fieldCount: plan.fieldCount, updated: plan.updates.length, deleted: plan.deletes.length };
    await verifyPageSave(c, request, result);
    await c.commit();
    return result;
  } catch (err) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw err;
  }
}

/** The committed page is what the save intended: version, field count, and no deleted control left. */
export async function verifyPageSave(c: Connection, request: PageSaveRequest, result: PageSaveResult): Promise<void> {
  const [defn] = await select<{ VERSION: number; FIELDCOUNT: number }>(c,
    `SELECT VERSION, FIELDCOUNT FROM PSPNLDEFN WHERE PNLNAME = :n`, { n: request.pnlName });
  if (!defn || Number(defn.VERSION) !== result.version || Number(defn.FIELDCOUNT) !== result.fieldCount) {
    throw new PageSaveRefusedError(`${request.pnlName} did not land as planned (version ${defn?.VERSION}, count ${defn?.FIELDCOUNT}); rolled back.`);
  }
  const [{ N: n }] = await select<{ N: number }>(c,
    `SELECT COUNT(*) AS N FROM PSPNLFIELD WHERE PNLNAME = :n`, { n: request.pnlName });
  if (Number(n) !== result.fieldCount) {
    throw new PageSaveRefusedError(`${request.pnlName} has ${n} controls after the save, expected ${result.fieldCount}; rolled back.`);
  }
}
