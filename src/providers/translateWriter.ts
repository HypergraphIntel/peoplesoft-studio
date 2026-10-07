import type { Connection } from 'oracledb';
import { writeScopeRefusal } from './writeScope.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Translate values, as App Designer saves them (docs/RECORD_SAVE.md, cases
 * r37-r39 and r42-r44, field ZZ_PCODE_LAB_C01):
 *
 *   add          PSXLATITEM inserted, stamped, SYNCID =
 *                PSSYSTEMID('PSXLATITEM').PTNEXTSYSTEMID + 1, which moves to it;
 *                PSXLATDEFN inserted (the first value, r37) or its VERSION moved
 *                (r43), = new XTM; a PSXLATDEFNDEL row left by an earlier
 *                delete is deleted (r42)
 *   change (r38) PSXLATITEM long / short name and status, restamped, SYNCID
 *                kept; PSXLATDEFN VERSION = new XTM
 *   delete       PSXLATITEM deleted; the last value (r39): PSXLATDEFN deleted,
 *                PSXLATDEFNDEL inserted, VERSION = new XTM; otherwise (r44)
 *                PSXLATDEFN VERSION = new XTM
 *
 *   every one: PSVERSION PDM, XTM and SYS + 1; PSLOCK PDM and XTM + 1
 *
 * App Designer deletes and reinserts every PSXLATITEM and PSXLATDEFN row of
 * the field; the values it does not change keep their stamp and SYNCID, so
 * only the changed rows are written here. Changing a value's key (value /
 * effective date) is a delete and an add.
 */

export class TranslateSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslateSaveRefusedError';
  }
}

export interface TranslateItem {
  value: string;
  /** YYYY-MM-DD. */
  effectiveDate: string;
  /** 'A' active, 'I' inactive. */
  status: string;
  longName: string;
  shortName: string;
}

export type TranslateChange =
  | { kind: 'add'; item: TranslateItem }
  | { kind: 'change'; item: TranslateItem }
  | { kind: 'delete'; value: string; effectiveDate: string };

interface Counters { pdm: number; xtm: number; sys: number; lockPdm: number; lockXtm: number }

async function readCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('PDM', 'XTM', 'SYS')${lock}`);
  const l = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME IN ('PDM', 'XTM')${lock}`);
  const get = (rows: { T: string; V: number }[], name: string) => {
    const r = rows.find((x) => String(x.T).trim() === name);
    if (!r) throw new TranslateSaveRefusedError(`${name} is missing from PSVERSION / PSLOCK; refusing to write.`);
    return Number(r.V);
  };
  return { pdm: get(v, 'PDM'), xtm: get(v, 'XTM'), sys: get(v, 'SYS'), lockPdm: get(l, 'PDM'), lockXtm: get(l, 'XTM') };
}

function checkItem(item: TranslateItem): void {
  if (!/^\S{1,4}$/.test(item.value)) throw new TranslateSaveRefusedError('A translate value is 1 to 4 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.effectiveDate)) throw new TranslateSaveRefusedError('The effective date is YYYY-MM-DD.');
  if (item.status !== 'A' && item.status !== 'I') throw new TranslateSaveRefusedError('The status is A (active) or I (inactive).');
  if (!item.longName.trim() || item.longName.length > 30) throw new TranslateSaveRefusedError('The long name is 1 to 30 characters.');
  if (!item.shortName.trim() || item.shortName.length > 10) throw new TranslateSaveRefusedError('The short name is 1 to 10 characters.');
}

export async function saveTranslate(c: Connection, field: string, change: TranslateChange, operatorId: string): Promise<void> {
  try {
    const operatorError = validateOperatorId(operatorId);
    if (operatorError) throw new TranslateSaveRefusedError(operatorError);
    const scope = writeScopeRefusal(field);
    if (scope) throw new TranslateSaveRefusedError(scope);
    if (change.kind !== 'delete') checkItem(change.item);
    const [{ N: fieldExists }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :f`, { f: field });
    if (Number(fieldExists) === 0) throw new TranslateSaveRefusedError(`There is no field named ${field}.`);

    const defn = await select<{ VERSION: number }>(c, `SELECT VERSION FROM SYSADM.PSXLATDEFN WHERE FIELDNAME = :f FOR UPDATE`, { f: field });
    const items = await select<{ V: string; D: string }>(c,
      `SELECT FIELDVALUE AS V, TO_CHAR(EFFDT, 'YYYY-MM-DD') AS D FROM SYSADM.PSXLATITEM WHERE FIELDNAME = :f FOR UPDATE`, { f: field });
    const [{ N: deleted }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSXLATDEFNDEL WHERE FIELDNAME = :f`, { f: field });
    const key = change.kind === 'delete' ? { value: change.value, effectiveDate: change.effectiveDate } : change.item;
    const exists = items.some((i) => String(i.V).trim() === key.value && i.D === key.effectiveDate);

    if (change.kind === 'add') {
      if (exists) throw new TranslateSaveRefusedError(`${field} already has translate value ${key.value} effective ${key.effectiveDate}.`);
      if ((items.length > 0) !== (defn.length === 1)) throw new TranslateSaveRefusedError(`${field}'s translate values and header (PSXLATDEFN) disagree; refusing to write.`);
    } else {
      if (!exists) throw new TranslateSaveRefusedError(`${field} has no translate value ${key.value} effective ${key.effectiveDate}.`);
      if (defn.length !== 1) throw new TranslateSaveRefusedError(`${field} has values but no translate header (PSXLATDEFN); refusing to write.`);
    }
    if (!(await operatorExists(c, operatorId))) {
      throw new TranslateSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const counters = await readCounters(c, true);
    const next: Counters = {
      pdm: counters.pdm + 1, xtm: counters.xtm + 1, sys: counters.sys + 1, lockPdm: counters.lockPdm + 1, lockXtm: counters.lockXtm + 1
    };
    const [{ TS: ts }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const k = { f: field, v: key.value, e: key.effectiveDate };

    if (change.kind === 'add') {
      const [sid] = await select<{ N: number }>(c, `SELECT PTNEXTSYSTEMID AS N FROM SYSADM.PSSYSTEMID WHERE RECNAME = 'PSXLATITEM' FOR UPDATE`);
      if (!sid) throw new TranslateSaveRefusedError('PSSYSTEMID has no PSXLATITEM row; refusing to write.');
      const syncId = Number(sid.N) + 1;
      await expectRows(c, `UPDATE SYSADM.PSSYSTEMID SET PTNEXTSYSTEMID = :n WHERE RECNAME = 'PSXLATITEM'`, { n: syncId }, 1, 'Updating PSSYSTEMID');
      if (defn.length === 0) {
        await expectRows(c, `INSERT INTO SYSADM.PSXLATDEFN (FIELDNAME, VERSION) VALUES (:f, :v)`, { f: field, v: next.xtm }, 1, 'Inserting PSXLATDEFN');
      } else {
        await expectRows(c, `UPDATE SYSADM.PSXLATDEFN SET VERSION = :v WHERE FIELDNAME = :f`, { f: field, v: next.xtm }, 1, 'Updating PSXLATDEFN');
      }
      if (Number(deleted) > 0) await c.execute(`DELETE FROM SYSADM.PSXLATDEFNDEL WHERE FIELDNAME = :f`, { f: field });
      await expectRows(c,
        `INSERT INTO SYSADM.PSXLATITEM (FIELDNAME, FIELDVALUE, EFFDT, EFF_STATUS, XLATLONGNAME, XLATSHORTNAME, LASTUPDDTTM, LASTUPDOPRID, SYNCID)
         VALUES (:f, :v, TO_DATE(:e, 'YYYY-MM-DD'), :s, :l, :sh, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, :sync)`,
        { ...k, s: change.item.status, l: change.item.longName, sh: change.item.shortName, ts, op: operatorId, sync: syncId }, 1, 'Inserting PSXLATITEM');
    } else if (change.kind === 'change') {
      await expectRows(c,
        `UPDATE SYSADM.PSXLATITEM SET EFF_STATUS = :s, XLATLONGNAME = :l, XLATSHORTNAME = :sh,
                LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
          WHERE FIELDNAME = :f AND FIELDVALUE = :v AND EFFDT = TO_DATE(:e, 'YYYY-MM-DD')`,
        { ...k, s: change.item.status, l: change.item.longName, sh: change.item.shortName, ts, op: operatorId }, 1, 'Updating PSXLATITEM');
      await expectRows(c, `UPDATE SYSADM.PSXLATDEFN SET VERSION = :v WHERE FIELDNAME = :f`, { f: field, v: next.xtm }, 1, 'Updating PSXLATDEFN');
    } else {
      await expectRows(c, `DELETE FROM SYSADM.PSXLATITEM WHERE FIELDNAME = :f AND FIELDVALUE = :v AND EFFDT = TO_DATE(:e, 'YYYY-MM-DD')`, k, 1, 'Deleting PSXLATITEM');
      if (items.length === 1) {
        await expectRows(c, `DELETE FROM SYSADM.PSXLATDEFN WHERE FIELDNAME = :f`, { f: field }, 1, 'Deleting PSXLATDEFN');
        await c.execute(`DELETE FROM SYSADM.PSXLATDEFNDEL WHERE FIELDNAME = :f`, { f: field });
        await expectRows(c, `INSERT INTO SYSADM.PSXLATDEFNDEL (FIELDNAME, VERSION) VALUES (:f, :v)`, { f: field, v: next.xtm }, 1, 'Inserting PSXLATDEFNDEL');
      } else {
        await expectRows(c, `UPDATE SYSADM.PSXLATDEFN SET VERSION = :v WHERE FIELDNAME = :f`, { f: field, v: next.xtm }, 1, 'Updating PSXLATDEFN');
      }
    }
    for (const [table, name, value] of [['PSVERSION', 'PDM', next.pdm], ['PSVERSION', 'XTM', next.xtm], ['PSVERSION', 'SYS', next.sys],
      ['PSLOCK', 'PDM', next.lockPdm], ['PSLOCK', 'XTM', next.lockXtm]] as const) {
      await expectRows(c, `UPDATE SYSADM.${table} SET VERSION = :v WHERE OBJECTTYPENAME = :n`, { v: value, n: name }, 1, `Updating ${table} ${name}`);
    }
    const now = await readCounters(c, false);
    if ((Object.keys(next) as (keyof Counters)[]).some((x) => now[x] !== next[x])) {
      throw new TranslateSaveRefusedError(`counters ${JSON.stringify(now)}, ${JSON.stringify(next)} expected; rolled back.`);
    }
    await c.commit();
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
