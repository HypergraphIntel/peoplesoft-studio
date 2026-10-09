import type { DbConnection as Connection } from '../db/connection.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { newControlFieldRefusal, newControlRows, isRecordBound, type ColumnValues, type FieldInfo, type NewControl } from './pageControlTemplates.js';

/*
 * Saving a page's layout, as App Designer does (docs/PAGE_SAVE.md, cases
 * 01-19 on ZZ_PCODE_LAB_PG): changes to existing controls -- move, resize,
 * label, use -- deleting controls, adding controls from App Designer's
 * captured default rows (pageControlTemplates.ts), and the page's
 * Description and Comments (PSPNLDEFN.DESCR / DESCRLONG, 19-props-descr).
 *
 *   PSVERSION / PSLOCK  'PDM' + 1; PSVERSION 'SYS' + 1
 *   PSPNLDEFN           VERSION = the new PDM, FIELDCOUNT = control count,
 *                       LASTUPDDTTM / LASTUPDOPRID the save's. MAXPNLFLDID
 *                       grows by the controls added (02-add-edit), never shrinks.
 *   PSPNLFIELD          per changed control, only the changed columns
 *                       (move: FIELDLEFT/TOP + the label EDITLBL*; resize:
 *                       FIELDRIGHT/BOTTOM + FIELDSIZETYPE; label: LBLTYPE/
 *                       LBLTEXT; use: FIELDUSE + SECUREINVISIBLE); FIELDNUM
 *                       where the contiguous order changed. A deleted control's
 *                       PSPNLFIELD and PSPNLFIELDEXT rows are removed.
 *                       An added control is a whole new row, PNLFLDID
 *                       MAXPNLFLDID + 1 on, numbered after the survivors.
 *   PSPNLFIELDEXT       inserted with an added control, removed with a deleted
 *                       one (its own columns are not edited here).
 *
 * A deleted PNLFLDID is never reused (MAXPNLFLDID stays). PNLNAME must be in
 * the write scope.
 */

export class PageSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageSaveRefusedError';
  }
}

/** The editable columns of one control, as the Layout editor sets them. */
export interface EditedControl {
  /** PSPNLFIELD.PNLFLDID of an existing control; a placeholder (ignored) on an added one. */
  pnlFldId: number;
  /** Present on a control the editor added: what it is and the record field it is placed on. */
  add?: NewControl;
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
  /** The surviving controls, then any added ones (those carry `add`). */
  controls: EditedControl[];
  /** The page's own properties as edited (General tab); absent leaves them as stored. */
  properties?: EditedPageProperties;
}

/** Page Properties the editor may change: PSPNLDEFN.DESCR and DESCRLONG (19-props-descr). */
export interface EditedPageProperties {
  description: string;
  comments: string;
}

/**
 * The PSPNLDEFN property columns that change, as App Designer writes them
 * (19-props-descr): DESCR blank is ' ' (NOT NULL); DESCRLONG, a nullable CLOB,
 * is NULL when empty (as a new page's is).
 */
export function planPageProperties(stored: { DESCR?: unknown; DESCRLONG?: unknown }, edited: EditedPageProperties | undefined): Record<string, string | null> {
  if (!edited) return {};
  const columns: Record<string, string | null> = {};
  const descr = edited.description.trim() ? edited.description.trimEnd() : ' ';
  if (descr.trim() !== String(stored.DESCR ?? '').trim()) columns.DESCR = descr;
  const comments = edited.comments.trim() ? edited.comments.trimEnd() : null;
  if ((comments ?? '') !== String(stored.DESCRLONG ?? '').trimEnd()) columns.DESCRLONG = comments;
  return columns;
}

export interface PageSaveResult {
  version: number;
  fieldCount: number;
  updated: number;
  deleted: number;
  inserted: number;
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
  // PeopleSoft stores a blank label as ' ' (Oracle reads '' as NULL); the editor sends it trimmed.
  { col: 'LBLTEXT', of: (c) => (c.lblText.trim() ? c.lblText : ' ') },
  { col: 'FIELDUSE', of: (c) => c.fieldUse },
  { col: 'SECUREINVISIBLE', of: (c) => c.secureInvisible }
];

export interface PagePlan {
  /** PNLFLDIDs whose PSPNLFIELD / PSPNLFIELDEXT rows are removed. */
  deletes: number[];
  /** Per surviving control: the columns that changed (name -> new value), including FIELDNUM when its order moved. */
  updates: Array<{ pnlFldId: number; columns: Record<string, number | string> }>;
  /** Added controls: their new PNLFLDID and FIELDNUM, and what the editor set. */
  inserts: Array<{ pnlFldId: number; fieldNum: number; control: EditedControl & { add: NewControl } }>;
  /** The control count after the save (PSPNLDEFN.FIELDCOUNT). */
  fieldCount: number;
  /** PSPNLDEFN.MAXPNLFLDID after the save. */
  maxPnlFldId: number;
}

/**
 * The change plan from the stored controls to the edited ones: which rows are
 * deleted, and which columns change on each survivor (geometry / label / use,
 * and FIELDNUM when the contiguous order shifts). Pure -- the writer wraps the
 * database around it, and the tests check it without one.
 */
export function planPageSave(stored: readonly StoredControl[], all: readonly EditedControl[], maxPnlFldId = 0): PagePlan {
  const added = all.filter((c): c is EditedControl & { add: NewControl } => !!c.add);
  const controls = all.filter((c) => !c.add);
  const edited = new Map(controls.map((c) => [c.pnlFldId, c]));
  const storedById = new Map(stored.map((c) => [c.pnlFldId, c]));

  for (const c of controls) {
    if (!storedById.has(c.pnlFldId)) {
      throw new PageSaveRefusedError(`Control ${c.pnlFldId} is not on the stored page.`);
    }
  }
  // MAXPNLFLDID is a high-water mark; never hand out an id at or below a stored one.
  const base = Math.max(maxPnlFldId, ...stored.map((c) => c.pnlFldId), 0);

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

  const inserts = added.map((control, i) => ({ pnlFldId: base + i + 1, fieldNum: survivors.length + i + 1, control }));
  return { deletes, updates, inserts, fieldCount: controls.length + added.length, maxPnlFldId: base + added.length };
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

    const [defn] = await select<{ VERSION: number; MAXPNLFLDID: number; DESCR: string; DESCRLONG: string | null }>(c,
      `SELECT VERSION, MAXPNLFLDID, DESCR, DESCRLONG FROM PSPNLDEFN WHERE PNLNAME = :n FOR UPDATE`, { n: pnlName });
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

    const plan = planPageSave(stored, request.controls, Number(defn.MAXPNLFLDID));
    const props = planPageProperties(defn, request.properties);
    if (request.properties && request.properties.description.trim().length > 30) {
      throw new PageSaveRefusedError('The page description is limited to 30 characters (PSPNLDEFN.DESCR).');
    }
    if (plan.deletes.length === 0 && plan.updates.length === 0 && plan.inserts.length === 0 && Object.keys(props).length === 0) {
      // Nothing changed: leave the page, its version and the counters untouched.
      return { version: request.openedVersion, fieldCount: plan.fieldCount, updated: 0, deleted: 0, inserted: 0 };
    }

    // Each added control's rows, built before anything is written so a refused field stops the save clean.
    const insertRows: Array<{ field: ColumnValues; ext: ColumnValues }> = [];
    for (const ins of plan.inserts) {
      const { add } = ins.control;
      const field = isRecordBound(add.kind) ? await readFieldInfo(c, add.recName.trim(), add.fieldName.trim()) : undefined;
      const refusal = newControlFieldRefusal(add.kind, add.recName, add.fieldName, field);
      if (refusal) throw new PageSaveRefusedError(refusal);
      insertRows.push(newControlRows(pnlName, ins.pnlFldId, ins.fieldNum,
        { kind: add.kind, recName: add.recName.trim(), fieldName: add.fieldName.trim() }, ins.control, field));
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

    for (const rows of insertRows) {
      await insertRow(c, 'PSPNLFIELD', rows.field);
      await insertRow(c, 'PSPNLFIELDEXT', rows.ext);
    }

    const propSets = Object.keys(props).map((col) => `, ${col} = :p_${col}`).join('');
    const propBinds = Object.fromEntries(Object.entries(props).map(([col, v]) => [`p_${col}`, v]));
    await expectRows(c,
      `UPDATE PSPNLDEFN SET VERSION = :v, FIELDCOUNT = :fc, MAXPNLFLDID = :mx, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op${propSets}
        WHERE PNLNAME = :n`,
      { v: next.pdm + 1, fc: plan.fieldCount, mx: plan.maxPnlFldId, ts, op: operatorId, n: pnlName, ...propBinds }, 1, 'Updating PSPNLDEFN');

    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.pdm + 1 }, 1, 'Updating PSVERSION PDM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys + 1 }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.lockPdm + 1 }, 1, 'Updating PSLOCK PDM');

    const result: PageSaveResult = {
      version: next.pdm + 1, fieldCount: plan.fieldCount, updated: plan.updates.length, deleted: plan.deletes.length, inserted: plan.inserts.length
    };
    await verifyPageSave(c, request, result, plan.inserts.map((i) => i.pnlFldId));
    await c.commit();
    return result;
  } catch (err) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw err;
  }
}

/** A record field's type, length and default label, or undefined when the record has no such field. */
async function readFieldInfo(c: Connection, recName: string, fieldName: string): Promise<FieldInfo | undefined> {
  // PSRECFIELDDB lists a record's fields with its subrecords' expanded; PSRECFIELD covers records it omits.
  const [f] = await select<{ FIELDTYPE: number; LENGTH: number }>(c,
    `SELECT D.FIELDTYPE, D.LENGTH FROM PSDBFIELD D
      WHERE D.FIELDNAME = :f
        AND (EXISTS (SELECT 1 FROM PSRECFIELD R WHERE R.RECNAME = :r AND R.FIELDNAME = D.FIELDNAME)
          OR EXISTS (SELECT 1 FROM PSRECFIELDDB R WHERE R.RECNAME = :r AND R.FIELDNAME = D.FIELDNAME))`, { f: fieldName, r: recName });
  if (!f) return undefined;
  const [l] = await select<{ LABEL_ID: string; LONGNAME: string }>(c,
    `SELECT LABEL_ID, LONGNAME FROM PSDBFLDLABL WHERE FIELDNAME = :f AND DEFAULT_LABEL = 1`, { f: fieldName });
  return { fieldType: Number(f.FIELDTYPE), length: Number(f.LENGTH), labelId: String(l?.LABEL_ID ?? ' '), labelText: String(l?.LONGNAME ?? fieldName) };
}

/** One whole row, every column bound. */
async function insertRow(c: Connection, table: string, row: ColumnValues): Promise<void> {
  const cols = Object.keys(row);
  const binds = Object.fromEntries(cols.map((col, i) => [`b${i}`, row[col]]));
  await expectRows(c, `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`,
    binds, 1, `Inserting ${table} ${row.PNLFLDID}`);
}

/** The committed page is what the save intended: version, field count, the added controls present, no deleted one left. */
export async function verifyPageSave(c: Connection, request: PageSaveRequest, result: PageSaveResult, insertedIds: readonly number[] = []): Promise<void> {
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
  for (const id of insertedIds) {
    const [{ N: m }] = await select<{ N: number }>(c,
      `SELECT COUNT(*) AS N FROM PSPNLFIELDEXT WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: request.pnlName, id });
    if (Number(m) !== 1) throw new PageSaveRefusedError(`Added control ${id} did not land on ${request.pnlName}; rolled back.`);
  }
}
