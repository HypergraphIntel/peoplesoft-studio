import type { Connection } from 'oracledb';
import { FieldType } from '../model/record.js';
import { isScratchName } from '../peoplecode/corpus/labSafety.js';
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
 * Scope: scratch names (ZZ_PCODE_LAB%); Character, Long Character, Number,
 * Signed Number, Date, Time and DateTime. Date, Time and DateTime have
 * PeopleTools' fixed lengths (10, 15, 26: every one on HRDMO).
 */

export class FieldCreateRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldCreateRefusedError';
  }
}

export const CREATABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.Character, FieldType.LongCharacter, FieldType.Number, FieldType.SignedNumber,
  FieldType.Date, FieldType.Time, FieldType.DateTime
];

/** The length a date or time field always has. */
export const FIXED_FIELD_LENGTH: Readonly<Partial<Record<FieldType, number>>> = {
  [FieldType.Date]: 10, [FieldType.Time]: 15, [FieldType.DateTime]: 26
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
  if (!isScratchName(r.name)) return `${r.name} is outside ZZ_PCODE_LAB: creating fields is limited to scratch names for now.`;
  if (!CREATABLE_FIELD_TYPES.includes(r.type)) return 'Only Character, Long Character, Number, Signed Number, Date, Time and DateTime fields can be created here yet.';
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
