import type { Connection } from 'oracledb';
import { FieldType } from '../model/record.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Creating a field, as App Designer's first save of a new one does
 * (docs/FIELD_CREATE.md, case c01, ZZ_PCODE_LAB_C08):
 *
 *   PSDBFIELD    VERSION = the new PSVERSION RDM; FIELDTYPE, LENGTH, DECIMALPOS;
 *                FORMAT 0, DEFCNTRYYR 50, the other columns 0 / blank, no
 *                DESCRLONG (every field type's most common shape on HRDMO);
 *                stamped
 *   PSDBFLDLABL  one label, DEFAULT_LABEL 1
 *   PSVERSION    RDM + 1, SYS + 1
 *   PSLOCK       RDM + 1
 *
 * A Character field short enough for translate values (length 1-4: f01's
 * ZZ_FIELD_1 at 1, c07's ZZ_PCODE_LAB_C10 at 4; not C11 at 5 or c01 at 10)
 * also gets an empty translate marker: PSXLATDEFNDEL with VERSION = the new
 * XTM, and PSVERSION / PSLOCK PDM and XTM + 1.
 *
 * Scope: Character, Long Character, Number,
 * Signed Number, Date, Time, DateTime and Image Reference. Date, Time and
 * DateTime have PeopleTools' fixed lengths (10, 15, 26: every one on
 * HRDMO), Image Reference 30 (368 of 373). Image fields vary in IMAGE_FMT
 * and length, so they are not created here yet.
 */

export class FieldCreateRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldCreateRefusedError';
  }
}

export const CREATABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.Character, FieldType.LongCharacter, FieldType.Number, FieldType.SignedNumber,
  FieldType.Date, FieldType.Time, FieldType.DateTime, FieldType.ImageReference
];

/** The length a date or time field always has. */
export const FIXED_FIELD_LENGTH: Readonly<Partial<Record<FieldType, number>>> = {
  [FieldType.Date]: 10, [FieldType.Time]: 15, [FieldType.DateTime]: 26,
  // Image Reference: 368 of HRDMO's 373, with IMAGE_FMT 0 as c01's defaults write.
  [FieldType.ImageReference]: 30
};

export interface FieldCreateRequest {
  name: string;
  type: FieldType;
  length: number;
  decimalPositions: number;
  label: { id: string; longName: string; shortName: string };
  operatorId: string;
}

/** Why the field cannot be created as asked, before anything is read. */
export function fieldCreateRefusal(r: Omit<FieldCreateRequest, 'operatorId'>): string | undefined {
  if (!/^[A-Z0-9_]{1,18}$/.test(r.name)) return `${r.name} is not a valid field name (A-Z, 0-9, _; at most 18).`;
  const scope = writeScopeRefusal(r.name);
  if (scope) return scope;
  if (!CREATABLE_FIELD_TYPES.includes(r.type)) return 'Only Character, Long Character, Number, Signed Number, Date, Time, DateTime and Image Reference fields can be created here yet.';
  const fixed = FIXED_FIELD_LENGTH[r.type];
  if (fixed !== undefined && r.length !== fixed) return `A field of this type is ${fixed} long.`;
  // The limits are HRDMO's longest: Character 256, Long Character 32,767, Number 32, Signed Number 33.
  if (r.type === FieldType.Character && (r.length < 1 || r.length > 256)) return 'A Character field is 1 to 256 long.';
  if (r.type === FieldType.LongCharacter && (r.length < 0 || r.length > 32767)) return 'A Long Character field is 0 (no maximum) to 32,767 long.';
  if (r.type === FieldType.Number || r.type === FieldType.SignedNumber) {
    const max = r.type === FieldType.Number ? 32 : 33;
    if (r.length < 1 || r.length > max) return `A ${r.type === FieldType.Number ? 'Number' : 'Signed Number'} field is 1 to ${max} long.`;
    if (r.decimalPositions < 0 || r.decimalPositions >= r.length) return 'Decimal positions must be fewer than the length.';
  } else if (r.decimalPositions !== 0) return 'Only number fields have decimal positions.';
  if (!/^[A-Z0-9_]{1,18}$/.test(r.label.id)) return 'The label ID is A-Z, 0-9 and _, at most 18.';
  if (!r.label.longName.trim() || r.label.longName.length > 30) return 'The long name is 1 to 30 characters.';
  if (!r.label.shortName.trim() || r.label.shortName.length > 15) return 'The short name is 1 to 15 characters.';
  return undefined;
}

export async function createField(c: Connection, request: FieldCreateRequest): Promise<{ version: number; lastupddttm: string }> {
  const name = request.name;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new FieldCreateRefusedError(operatorError);
    const refusal = fieldCreateRefusal(request);
    if (refusal) throw new FieldCreateRefusedError(refusal);
    const [{ N: taken }] = await select<{ N: number }>(c,
      `SELECT (SELECT COUNT(*) FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :f) + (SELECT COUNT(*) FROM SYSADM.PSDBFLDLABL WHERE FIELDNAME = :f)
            + (SELECT COUNT(*) FROM SYSADM.PSDBFIELDLANG WHERE FIELDNAME = :f) + (SELECT COUNT(*) FROM SYSADM.PSDBFLDLABLLANG WHERE FIELDNAME = :f) AS N FROM DUAL`,
      { f: name });
    if (Number(taken) > 0) throw new FieldCreateRefusedError(`A field named ${name} already exists, or left rows behind.`);
    if (!(await operatorExists(c, request.operatorId))) {
      throw new FieldCreateRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const v = await select<{ T: string; V: number }>(c,
      `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('RDM', 'SYS') FOR UPDATE`);
    const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'RDM' FOR UPDATE`);
    const get = (n: string) => {
      const r = v.find((x) => String(x.T).trim() === n);
      if (!r) throw new FieldCreateRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
      return Number(r.V) + 1;
    };
    if (l.length !== 1) throw new FieldCreateRefusedError('PSLOCK RDM is missing; refusing to write.');
    const next = { rdm: get('RDM'), sys: get('SYS'), lockRdm: Number(l[0].V) + 1 };
    const translatable = request.type === FieldType.Character && request.length <= 4;
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    await expectRows(c,
      `INSERT INTO SYSADM.PSDBFIELD (FIELDNAME, VERSION, FIELDTYPE, LENGTH, DECIMALPOS, FORMAT, FORMATLENGTH, IMAGE_FMT, FORMATFAMILY,
                                     DISPFMTNAME, DEFCNTRYYR, IMEMODE, KBLAYOUT, OBJECTOWNERID, LASTUPDDTTM, LASTUPDOPRID, FLDNOTUSED,
                                     AUXFLAGMASK, DESCRLONG)
       VALUES (:f, :v, :t, :len, :dec, 0, 0, 0, ' ', ' ', 50, 0, 0, ' ', TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, 0, 0, NULL)`,
      { f: name, v: next.rdm, t: request.type, len: request.length, dec: request.decimalPositions, ts: lastupddttm, op: request.operatorId },
      1, 'Inserting PSDBFIELD');
    await expectRows(c,
      `INSERT INTO SYSADM.PSDBFLDLABL (FIELDNAME, LABEL_ID, LONGNAME, SHORTNAME, DEFAULT_LABEL) VALUES (:f, :id, :ln, :sn, 1)`,
      { f: name, id: request.label.id, ln: request.label.longName, sn: request.label.shortName }, 1, 'Inserting PSDBFLDLABL');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'RDM'`, { v: next.rdm }, 1, 'Updating PSVERSION RDM');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'RDM'`, { v: next.lockRdm }, 1, 'Updating PSLOCK RDM');
    if (translatable) {
      const tv = await select<{ T: string; V: number }>(c,
        `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('XTM', 'PDM') FOR UPDATE`);
      const tl = await select<{ T: string; V: number }>(c,
        `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME IN ('XTM', 'PDM') FOR UPDATE`);
      const bump = (rows: { T: string; V: number }[], n: string) => {
        const r = rows.find((x) => String(x.T).trim() === n);
        if (!r) throw new FieldCreateRefusedError(`${n} is missing from PSVERSION / PSLOCK; refusing to write.`);
        return Number(r.V) + 1;
      };
      const xtm = bump(tv, 'XTM');
      await c.execute(`DELETE FROM SYSADM.PSXLATDEFNDEL WHERE FIELDNAME = :f`, { f: name });
      await expectRows(c, `INSERT INTO SYSADM.PSXLATDEFNDEL (FIELDNAME, VERSION) VALUES (:f, :v)`, { f: name, v: xtm }, 1, 'Inserting PSXLATDEFNDEL');
      for (const [table, n, value] of [['PSVERSION', 'XTM', xtm], ['PSVERSION', 'PDM', bump(tv, 'PDM')], ['PSLOCK', 'XTM', bump(tl, 'XTM')],
        ['PSLOCK', 'PDM', bump(tl, 'PDM')]] as const) {
        await expectRows(c, `UPDATE SYSADM.${table} SET VERSION = :v WHERE OBJECTTYPENAME = :n`, { v: value, n }, 1, `Updating ${table} ${n}`);
      }
    }

    const [d] = await select<{ VERSION: number; FIELDTYPE: number; LENGTH: number; TS: string }>(c,
      `SELECT VERSION, FIELDTYPE, LENGTH, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :f`,
      { f: name });
    const [{ N: labels }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSDBFLDLABL WHERE FIELDNAME = :f AND DEFAULT_LABEL = 1`, { f: name });
    if (!d || Number(d.VERSION) !== next.rdm || Number(d.FIELDTYPE) !== request.type || Number(d.LENGTH) !== request.length ||
        d.TS !== lastupddttm || Number(labels) !== 1) {
      throw new FieldCreateRefusedError('The field did not land as planned; rolled back.');
    }
    await c.commit();
    return { version: next.rdm, lastupddttm };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/*
 * Saving a field, as App Designer's field saves did (cases f02-f06,
 * ZZ_FIELD_1):
 *
 *   PSDBFIELD    rewritten: VERSION = the new PSVERSION RDM, stamped, the
 *                changed LENGTH / DECIMALPOS / DESCRLONG (f02, f04, f06)
 *   PSDBFLDLABL  rewritten: a label added (f03), the default moved (f03)
 *   PSRECDEFN    every record holding the field: VERSION = the new RDM, not
 *                restamped (f06, ZZ_FIELD_REC)
 *   PSVERSION    RDM, PDM, SYS + 1
 *   PSLOCK       RDM, PDM + 1
 *
 * Scope: the type is not changed (no case); records holding the field must
 * hold it directly (none captured through a subrecord).
 */

export interface FieldLabelEdit { id: string; longName: string; shortName: string; isDefault: boolean }

export interface FieldSaveRequest {
  name: string;
  /** PSDBFIELD.VERSION when opened. */
  openedVersion: number;
  length?: number;
  decimalPositions?: number;
  /** DESCRLONG; '' clears it. */
  description?: string;
  /** The field's labels as they are to be, every one. */
  labels?: FieldLabelEdit[];
  operatorId: string;
}

export async function saveField(c: Connection, request: FieldSaveRequest): Promise<{ version: number; lastupddttm: string; records: string[] }> {
  const name = request.name;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new FieldCreateRefusedError(operatorError);
    const scope = writeScopeRefusal(name);
    if (scope) throw new FieldCreateRefusedError(scope);
    const [row] = await select<{ VERSION: number; FIELDTYPE: number; LENGTH: number; DECIMALPOS: number }>(c,
      `SELECT VERSION, FIELDTYPE, LENGTH, DECIMALPOS FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :f FOR UPDATE`, { f: name });
    if (!row) throw new FieldCreateRefusedError(`There is no field named ${name}.`);
    if (Number(row.VERSION) !== request.openedVersion) {
      throw new FieldCreateRefusedError(`${name} was saved since it was opened (version ${row.VERSION}, not ${request.openedVersion}). Reopen it.`);
    }
    const type = Number(row.FIELDTYPE) as FieldType;
    const length = request.length ?? Number(row.LENGTH);
    const decimalPositions = request.decimalPositions ?? Number(row.DECIMALPOS);
    if (!CREATABLE_FIELD_TYPES.includes(type)) throw new FieldCreateRefusedError('Only fields of the types New Field creates can be saved here yet.');
    const stored = await select<{ ID: string; LN: string; SN: string; D: number }>(c,
      `SELECT LABEL_ID AS ID, LONGNAME AS LN, SHORTNAME AS SN, DEFAULT_LABEL AS D FROM SYSADM.PSDBFLDLABL WHERE FIELDNAME = :f ORDER BY LABEL_ID FOR UPDATE`, { f: name });
    const labels = request.labels ?? stored.map((l) => ({ id: String(l.ID).trim(), longName: String(l.LN ?? ''), shortName: String(l.SN ?? ''), isDefault: Number(l.D) === 1 }));
    const dflt = labels.filter((l) => l.isDefault);
    const label = dflt[0] ?? { id: name, longName: 'x', shortName: 'x', isDefault: true };
    const refusal = fieldCreateRefusal({ name, type, length, decimalPositions, label });
    if (refusal) throw new FieldCreateRefusedError(refusal);
    if (labels.length === 0 || dflt.length !== 1) throw new FieldCreateRefusedError('A field has labels, exactly one of them the default.');
    const ids = new Set<string>();
    for (const l of labels) {
      const r = fieldCreateRefusal({ name, type, length, decimalPositions, label: l });
      if (r) throw new FieldCreateRefusedError(`Label ${l.id}: ${r}`);
      if (ids.has(l.id.toUpperCase())) throw new FieldCreateRefusedError(`Label ${l.id} is listed twice.`);
      ids.add(l.id.toUpperCase());
    }
    const used = await select<{ L: string }>(c,
      `SELECT DISTINCT LABEL_ID AS L FROM SYSADM.PSRECFIELD WHERE FIELDNAME = :f AND LABEL_ID <> ' '`, { f: name });
    for (const u of used) {
      if (!ids.has(String(u.L).trim().toUpperCase())) throw new FieldCreateRefusedError(`Label ${String(u.L).trim()} is used by a record field; it cannot be removed.`);
    }
    if (request.description !== undefined && request.description.length > 4000) throw new FieldCreateRefusedError('The description is limited to 4,000 characters here.');
    // The records holding the field take its new version (f06); only records holding it directly.
    const records = (await select<{ R: string }>(c,
      `SELECT DISTINCT RECNAME AS R FROM SYSADM.PSRECFIELDDB WHERE FIELDNAME = :f ORDER BY 1`, { f: name })).map((r) => String(r.R).trim());
    const direct = new Set((await select<{ R: string }>(c,
      `SELECT DISTINCT RECNAME AS R FROM SYSADM.PSRECFIELD WHERE FIELDNAME = :f AND SUBRECORD = 'N'`, { f: name })).map((r) => String(r.R).trim()));
    for (const r of records) {
      if (!direct.has(r)) throw new FieldCreateRefusedError(`${r} holds ${name} through a subrecord; saving it is not established yet.`);
      const recordScope = writeScopeRefusal(r);
      if (recordScope) throw new FieldCreateRefusedError(`${r} holds ${name}: ${recordScope}`);
    }
    if (records.length > 0) await select(c, `SELECT VERSION FROM SYSADM.PSRECDEFN WHERE RECNAME IN (${records.map((_, i) => `:r${i}`).join(', ')}) FOR UPDATE`,
      Object.fromEntries(records.map((r, i) => [`r${i}`, r])));
    if (!(await operatorExists(c, request.operatorId))) {
      throw new FieldCreateRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const v = await select<{ T: string; V: number }>(c,
      `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('RDM', 'PDM', 'SYS') FOR UPDATE`);
    const l = await select<{ T: string; V: number }>(c,
      `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME IN ('RDM', 'PDM') FOR UPDATE`);
    const next = (rows: { T: string; V: number }[], n: string) => {
      const r = rows.find((x) => String(x.T).trim() === n);
      if (!r) throw new FieldCreateRefusedError(`${n} is missing from PSVERSION / PSLOCK; refusing to write.`);
      return Number(r.V) + 1;
    };
    const rdm = next(v, 'RDM');
    const counters: [string, string, number][] = [['PSVERSION', 'RDM', rdm], ['PSVERSION', 'PDM', next(v, 'PDM')], ['PSVERSION', 'SYS', next(v, 'SYS')],
      ['PSLOCK', 'RDM', next(l, 'RDM')], ['PSLOCK', 'PDM', next(l, 'PDM')]];
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    await expectRows(c,
      `UPDATE SYSADM.PSDBFIELD SET VERSION = :v, LENGTH = :len, DECIMALPOS = :dec, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
              ${request.description !== undefined ? ', DESCRLONG = :d' : ''}
        WHERE FIELDNAME = :f`,
      { v: rdm, len: length, dec: decimalPositions, ts: lastupddttm, op: request.operatorId, f: name,
        ...(request.description !== undefined ? { d: request.description.trim() === '' ? null : request.description } : {}) },
      1, 'Updating PSDBFIELD');
    await expectRows(c, `DELETE FROM SYSADM.PSDBFLDLABL WHERE FIELDNAME = :f`, { f: name }, stored.length, 'Deleting PSDBFLDLABL');
    for (const lb of labels) {
      await expectRows(c,
        `INSERT INTO SYSADM.PSDBFLDLABL (FIELDNAME, LABEL_ID, LONGNAME, SHORTNAME, DEFAULT_LABEL) VALUES (:f, :id, :ln, :sn, :d)`,
        { f: name, id: lb.id, ln: lb.longName, sn: lb.shortName, d: lb.isDefault ? 1 : 0 }, 1, `Inserting PSDBFLDLABL ${lb.id}`);
    }
    if (records.length > 0) {
      await expectRows(c, `UPDATE SYSADM.PSRECDEFN SET VERSION = :v WHERE RECNAME IN (${records.map((_, i) => `:r${i}`).join(', ')})`,
        { v: rdm, ...Object.fromEntries(records.map((r, i) => [`r${i}`, r])) }, records.length, 'Updating the records holding the field');
    }
    for (const [table, n, value] of counters) {
      await expectRows(c, `UPDATE SYSADM.${table} SET VERSION = :v WHERE OBJECTTYPENAME = :n`, { v: value, n }, 1, `Updating ${table} ${n}`);
    }
    const [d] = await select<{ VERSION: number; LENGTH: number; DECIMALPOS: number; TS: string }>(c,
      `SELECT VERSION, LENGTH, DECIMALPOS, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :f`, { f: name });
    const [{ N: n, D: defaults }] = await select<{ N: number; D: number }>(c,
      `SELECT COUNT(*) AS N, SUM(DEFAULT_LABEL) AS D FROM SYSADM.PSDBFLDLABL WHERE FIELDNAME = :f`, { f: name });
    if (!d || Number(d.VERSION) !== rdm || Number(d.LENGTH) !== length || Number(d.DECIMALPOS) !== decimalPositions || d.TS !== lastupddttm ||
        Number(n) !== labels.length || Number(defaults) !== 1) {
      throw new FieldCreateRefusedError('The field did not land as planned; rolled back.');
    }
    await c.commit();
    return { version: rdm, lastupddttm, records };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
