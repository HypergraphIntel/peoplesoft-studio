import type { Connection } from 'oracledb';
import { RecordType } from '../model/record.js';
import {
  planRecordSave, RecordSaveRefusedError, type RecordEditState, type RecordSavePlan, type Row, type StoredRecord
} from '../model/recordEdit.js';
import { isScratchName } from '../peoplecode/corpus/labSafety.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeViewSql } from './sqlWriter.js';

/*
 * Saving a record definition, as App Designer does (docs/RECORD_SAVE.md).
 * The rows come from planRecordSave (model/recordEdit.ts); this module
 * reads the stored record, moves the planned rows in one transaction, and
 * proves them before and after COMMIT.
 *
 * Scope: scratch records (ZZ_PCODE_LAB%), the record shapes and changes the
 * App Designer cases cover. Everything else is refused before anything is
 * written.
 */

export interface RecordSaveRequest {
  edit: RecordEditState;
  /** PSOPRDEFN.OPRID recorded as LASTUPDOPRID. */
  operatorId: string;
}

export interface RecordSaveResult {
  version: number;
  lastupddttm: string;
  plan: RecordSavePlan;
  /** Records whose Related Language record this is: their VERSION was set to the new one. */
  languageReferrers: string[];
}

interface Column { name: string; type: string }

async function columnsOf(c: Connection, table: string): Promise<Column[]> {
  const rows = await select<{ N: string; T: string }>(c,
    `SELECT COLUMN_NAME AS N, DATA_TYPE AS T FROM ALL_TAB_COLUMNS WHERE OWNER = 'SYSADM' AND TABLE_NAME = :t ORDER BY COLUMN_ID`,
    { t: table });
  return rows.map((r) => ({ name: r.N, type: r.T }));
}

const isTimestamp = (col: Column) => col.type.startsWith('TIMESTAMP') || col.type === 'DATE';

/** Rows with every column; timestamps as strings in TIMESTAMP_FORMAT. */
async function readRows(c: Connection, table: string, cols: Column[], where: string, binds: Record<string, unknown>, order = ''): Promise<Row[]> {
  const list = cols.map((col) => isTimestamp(col)
    ? `TO_CHAR(CAST(${col.name} AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS ${col.name}` : col.name).join(', ');
  return select<Row>(c, `SELECT ${list} FROM SYSADM.${table} WHERE ${where}${order ? ` ORDER BY ${order}` : ''}`, binds);
}

async function insertRow(c: Connection, table: string, cols: Column[], row: Row): Promise<void> {
  const missing = cols.filter((col) => !(col.name in row)).map((col) => col.name);
  if (missing.length > 0) throw new RecordSaveRefusedError(`${table} has columns this save does not know (${missing.join(', ')}); refusing to write.`);
  const binds: Record<string, unknown> = {};
  const values = cols.map((col, i) => {
    binds[`b${i}`] = row[col.name];
    return isTimestamp(col) ? `TO_TIMESTAMP(:b${i}, ${TIMESTAMP_FORMAT})` : `:b${i}`;
  });
  await expectRows(c, `INSERT INTO SYSADM.${table} (${cols.map((col) => col.name).join(', ')}) VALUES (${values.join(', ')})`,
    binds, 1, `Inserting ${table}`);
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const same = (a: Row, b: Row, cols: Column[]) => cols.every((col) => text(a[col.name]) === text(b[col.name]));

interface Counters { rdm: number; sys: number; pgm: number; lockRdm: number; lockPgm: number }

async function readCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('RDM', 'SYS', 'PGM')${lock}`);
  const l = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME IN ('RDM', 'PGM')${lock}`);
  const get = (rows: { T: string; V: number }[], name: string) => {
    const r = rows.find((x) => String(x.T).trim() === name);
    if (!r) throw new RecordSaveRefusedError(`${name} is missing from PSVERSION / PSLOCK; refusing to write.`);
    return Number(r.V);
  };
  return { rdm: get(v, 'RDM'), sys: get(v, 'SYS'), pgm: get(v, 'PGM'), lockRdm: get(l, 'RDM'), lockPgm: get(l, 'PGM') };
}

interface Tables { recfield: Column[]; recfielddb: Column[]; index: Column[]; key: Column[] }

async function readStored(c: Connection, tables: Tables, recname: string, forUpdate: boolean): Promise<StoredRecord & { db: Row[]; keys: Row[] }> {
  const [defn] = await select<Row & { RECTYPE: number; VERSION: number }>(c,
    `SELECT RECTYPE, VERSION, RECDESCR, DBMS_LOB.SUBSTR(DESCRLONG, 4000, 1) AS DESCRLONG, OBJECTOWNERID, SETCNTRLFLD,
            PARENTRECNAME, RELLANGRECNAME, QRYSECRECNAME, OPTDELRECNAME, AUXFLAGMASK, SQLTABLENAME, BUILDSEQNO
       FROM SYSADM.PSRECDEFN WHERE RECNAME = :r${forUpdate ? ' FOR UPDATE' : ''}`, { r: recname });
  if (!defn) throw new RecordSaveRefusedError(`There is no record named ${recname}.`);
  const r = { r: recname };
  return {
    recname,
    recordType: Number(defn.RECTYPE) as RecordType,
    version: Number(defn.VERSION),
    defn,
    fields: await readRows(c, 'PSRECFIELD', tables.recfield, 'RECNAME = :r', r, 'FIELDNUM'),
    db: await readRows(c, 'PSRECFIELDDB', tables.recfielddb, 'RECNAME = :r', r, 'FIELDNUM'),
    indexes: await readRows(c, 'PSINDEXDEFN', tables.index, 'RECNAME = :r', r, 'INDEXID'),
    keys: await readRows(c, 'PSKEYDEFN', tables.key, 'RECNAME = :r', r, 'INDEXID, KEYPOSN')
  };
}

const dbRow = (row: Row, recname: string): Row => ({ ...row, RECNAME_PARENT: recname });

/**
 * Saves the record and commits, or rolls back and throws. The caller
 * verifies again after COMMIT (verifyRecordSave).
 */
/**
 * A new record's PSRECDEFN row, as App Designer inserted ZZ_PCODE_LAB_R1 (r02)
 * and R2 (r35): blank names, BUILDSEQNO 1 (21,272 of 21,345 SQL Tables, 5,503
 * of 5,540 Derived/Work), OPTTRIGFLAG 'N', no long description.
 */
export const NEW_RECDEFN_VALUES: Readonly<Row> = {
  DDLCOUNT: 0, AUDITRECNAME: ' ', RECUSE: 0, SETCNTRLFLD: ' ', RELLANGRECNAME: ' ', OPTDELRECNAME: ' ', RECDESCR: ' ',
  PARENTRECNAME: ' ', QRYSECRECNAME: ' ', SQLTABLENAME: ' ', BUILDSEQNO: 1, OPTTRIGFLAG: 'N', OBJECTOWNERID: ' ',
  SYSTEMIDFIELDNAME: ' ', TIMESTAMPFIELDNAME: ' ', AUXFLAGMASK: 0, DESCRLONG: null
};

/**
 * Creating a record, as App Designer's first save of a new one does (r02,
 * r35; docs/RECORD_SAVE.md): PSRECDEFN, PSRECFIELD / PSRECFIELDDB, the key
 * index and keys when it has keys, and for an SQL Table its PSRECTBLSPC row
 * (every SQL Table has one, no Derived/Work record does) in the tablespace
 * catalog's first entry (AAAPP on HRDMO, as R1 and R4 got); PSVERSION RDM,
 * SYS + 1, PSLOCK RDM + 1.
 */
async function createRecord(c: Connection, request: RecordSaveRequest): Promise<RecordSaveResult> {
  const edit = request.edit;
  const recname = edit.recname;
  if (!/^[A-Z0-9_]{1,15}$/.test(recname)) throw new RecordSaveRefusedError(`${recname} is not a valid record name (A-Z, 0-9, _; at most 15).`);
  if (edit.recordType !== RecordType.Table && edit.recordType !== RecordType.DerivedWork) {
    throw new RecordSaveRefusedError('Only SQL Table and Derived/Work records can be created here yet.');
  }
  if (edit.fields.some((f) => !f.isNew)) throw new RecordSaveRefusedError('A new record has only new fields.');
  const tables: Tables = {
    recfield: await columnsOf(c, 'PSRECFIELD'), recfielddb: await columnsOf(c, 'PSRECFIELDDB'),
    index: await columnsOf(c, 'PSINDEXDEFN'), key: await columnsOf(c, 'PSKEYDEFN')
  };
  const [{ N: taken }] = await select<{ N: number }>(c,
    `SELECT (SELECT COUNT(*) FROM SYSADM.PSRECDEFN WHERE RECNAME = :r) + (SELECT COUNT(*) FROM SYSADM.PSRECFIELD WHERE RECNAME = :r)
          + (SELECT COUNT(*) FROM SYSADM.PSRECFIELDDB WHERE RECNAME = :r) + (SELECT COUNT(*) FROM SYSADM.PSINDEXDEFN WHERE RECNAME = :r)
          + (SELECT COUNT(*) FROM SYSADM.PSRECTBLSPC WHERE RECNAME = :r) AS N FROM DUAL`, { r: recname });
  if (Number(taken) > 0) throw new RecordSaveRefusedError(`A record named ${recname} already exists, or left rows behind.`);
  const [{ N: deleted }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSRECDEL WHERE RECNAME = :r`, { r: recname });
  if (Number(deleted) > 0) {
    throw new RecordSaveRefusedError(`${recname} was deleted before (PSRECDEL); how App Designer re-creates a deleted name is not established, so choose another name.`);
  }
  for (const f of edit.fields) {
    const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :f`, { f: f.name });
    if (Number(N) === 0) throw new RecordSaveRefusedError(`There is no field named ${f.name}.`);
  }
  const [space] = edit.recordType === RecordType.Table
    ? await select<{ DDLSPACENAME: string; DBNAME: string }>(c,
      `SELECT DDLSPACENAME, DBNAME FROM SYSADM.PSTBLSPCCAT ORDER BY DDLSPACENAME FETCH FIRST 1 ROWS ONLY`)
    : [undefined];
  if (edit.recordType === RecordType.Table && !space) throw new RecordSaveRefusedError('The tablespace catalog (PSTBLSPCCAT) is empty; refusing to write.');
  if (!(await operatorExists(c, request.operatorId))) {
    throw new RecordSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
  }

  const counters = await readCounters(c, true);
  const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
    `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
  const stored: StoredRecord = { recname, recordType: edit.recordType, version: 0, fields: [], indexes: [], defn: { ...NEW_RECDEFN_VALUES } };
  const plan = planRecordSave(stored, edit, { ts: lastupddttm, operatorId: request.operatorId });
  const next: Counters = { ...counters, rdm: counters.rdm + 1, sys: counters.sys + 1, lockRdm: counters.lockRdm + 1 };

  await insertRow(c, 'PSRECDEFN', await columnsOf(c, 'PSRECDEFN'), {
    RECNAME: recname, FIELDCOUNT: plan.fieldCount, INDEXCOUNT: plan.indexCount, VERSION: next.rdm, RECTYPE: edit.recordType,
    ...NEW_RECDEFN_VALUES, ...plan.recordColumns, LASTUPDDTTM: lastupddttm, LASTUPDOPRID: request.operatorId
  });
  for (const row of plan.fields) await insertRow(c, 'PSRECFIELD', tables.recfield, row);
  for (const row of plan.fields) await insertRow(c, 'PSRECFIELDDB', tables.recfielddb, dbRow(row, recname));
  if (plan.index) {
    await insertRow(c, 'PSINDEXDEFN', tables.index, plan.index.row);
    for (const k of plan.index.keys) await insertRow(c, 'PSKEYDEFN', tables.key, k);
  }
  if (space) {
    await expectRows(c,
      `INSERT INTO SYSADM.PSRECTBLSPC (DDLSPACENAME, DBNAME, RECNAME, DBTYPE, TEMPTBLINST, PT_TS_LOCK_TYPE, PT_UTS_ENABLED)
       VALUES (:s, :d, :r, ' ', 'N', ' ', ' ')`, { s: space.DDLSPACENAME, d: space.DBNAME, r: recname }, 1, 'Inserting PSRECTBLSPC');
  }
  await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'RDM'`, { v: next.rdm }, 1, 'Updating PSVERSION RDM');
  await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
  await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'RDM'`, { v: next.lockRdm }, 1, 'Updating PSLOCK RDM');

  const result: RecordSaveResult = { version: next.rdm, lastupddttm, plan, languageReferrers: [] };
  await verifyRecordSave(c, request, result);
  const [{ N: spaces }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSRECTBLSPC WHERE RECNAME = :r`, { r: recname });
  if (Number(spaces) !== (space ? 1 : 0)) throw new RecordSaveRefusedError(`PSRECTBLSPC has ${spaces} rows for ${recname}; rolled back.`);
  const now = await readCounters(c, false);
  if ((Object.keys(next) as (keyof Counters)[]).some((k) => now[k] !== next[k])) {
    throw new RecordSaveRefusedError(`counters ${JSON.stringify(now)}, ${JSON.stringify(next)} expected; rolled back.`);
  }
  await c.commit();
  return result;
}

export async function saveRecord(c: Connection, request: RecordSaveRequest): Promise<RecordSaveResult> {
  const recname = request.edit.recname;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new RecordSaveRefusedError(operatorError);
    if (!isScratchName(recname)) {
      throw new RecordSaveRefusedError(`${recname} is outside ZZ_PCODE_LAB: saving records is limited to scratch records for now.`);
    }
    if (request.edit.isNew) return await createRecord(c, request);
    const tables: Tables = {
      recfield: await columnsOf(c, 'PSRECFIELD'), recfielddb: await columnsOf(c, 'PSRECFIELDDB'),
      index: await columnsOf(c, 'PSINDEXDEFN'), key: await columnsOf(c, 'PSKEYDEFN')
    };

    // The record row first: saves of one record serialize here.
    const stored = await readStored(c, tables, recname, true);
    if (stored.version !== request.edit.openedVersion) {
      throw new RecordSaveRefusedError(
        `${recname} was saved since it was opened (version ${stored.version}, not ${request.edit.openedVersion}). Reopen it and reapply your changes.`);
    }
    // PSRECFIELDDB must mirror PSRECFIELD (the only shape the cases show),
    // and no other record may include this one.
    if (stored.db.length !== stored.fields.length ||
        stored.fields.some((f, i) => !same(dbRow(f, recname), stored.db[i], tables.recfielddb))) {
      throw new RecordSaveRefusedError(`${recname}'s PSRECFIELDDB rows do not mirror its PSRECFIELD rows; refusing to write.`);
    }
    const [{ N: includers }] = await select<{ N: number }>(c,
      `SELECT COUNT(*) AS N FROM SYSADM.PSRECFIELD WHERE FIELDNAME = :r AND SUBRECORD = 'Y'`, { r: recname });
    if (Number(includers) > 0) throw new RecordSaveRefusedError(`${recname} is used as a subrecord; refusing to write.`);
    // App Designer moves the VERSION of a record whose Related Language record
    // is the one it saves (r32: ZZ_PCODE_LAB_R1, referring to T by that alone,
    // took T's new VERSION, unstamped); an Analytic Delete reference does not
    // (r41). Parent, query security and audit references are not established,
    // so a record referred to that way is not saved here.
    const referrers = await select<{ RECNAME: string }>(c,
      `SELECT RECNAME FROM SYSADM.PSRECDEFN WHERE RECNAME <> :r AND :r IN (PARENTRECNAME, QRYSECRECNAME, AUDITRECNAME)
        AND ROWNUM <= 5`, { r: recname });
    if (referrers.length > 0) {
      throw new RecordSaveRefusedError(`${recname} is referred to by ${referrers.map((x) => text(x.RECNAME)).join(', ')} (as a parent, query security or audit record); saving it here is not supported yet.`);
    }
    const languageReferrers = await select<{ RECNAME: string }>(c,
      `SELECT RECNAME FROM SYSADM.PSRECDEFN WHERE RECNAME <> :r AND RELLANGRECNAME = :r FOR UPDATE`, { r: recname });

    for (const f of request.edit.fields.filter((x) => x.isNew)) {
      const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :f`, { f: f.name });
      if (Number(N) === 0) throw new RecordSaveRefusedError(`There is no field named ${f.name}.`);
    }
    // What the edit refers to must exist: a prompt table, a default's record
    // and field, a label of the field.
    const exists = async (sql: string, binds: Record<string, unknown>) => Number((await select<{ N: number }>(c, sql, binds))[0]?.N ?? 0) > 0;
    for (const f of request.edit.fields) {
      if (f.editTable && !(await exists(`SELECT COUNT(*) AS N FROM SYSADM.PSRECDEFN WHERE RECNAME = :r`, { r: f.editTable }))) {
        throw new RecordSaveRefusedError(`${f.name}: there is no record named ${f.editTable} to prompt on.`);
      }
      if (f.defaultRecord && !(await exists(`SELECT COUNT(*) AS N FROM SYSADM.PSRECFIELD WHERE RECNAME = :r AND FIELDNAME = :f`, { r: f.defaultRecord, f: f.defaultField ?? '' }))) {
        throw new RecordSaveRefusedError(`${f.name}: ${f.defaultRecord}.${f.defaultField ?? ''} is not a field of a record, so it cannot be the default.`);
      }
      if (f.labelId && !(await exists(`SELECT COUNT(*) AS N FROM SYSADM.PSDBFLDLABL WHERE FIELDNAME = :f AND LABEL_ID = :l`, { f: f.name, l: f.labelId }))) {
        throw new RecordSaveRefusedError(`${f.name} has no label ${f.labelId}.`);
      }
      // A translate table edit needs the field's translate values (every translate-edited field on HRDMO has them).
      const before = stored.fields.find((x) => text(x.FIELDNAME) === f.name);
      if ((f.useEdit & 0x200) !== 0 && (!before || (Number(before.USEEDIT) & 0x200) === 0) &&
          !(await exists(`SELECT COUNT(*) AS N FROM SYSADM.PSXLATITEM WHERE FIELDNAME = :f`, { f: f.name }))) {
        throw new RecordSaveRefusedError(`${f.name} has no translate values, so it cannot have a translate table edit.`);
      }
    }
    // Record Properties must refer to what exists: records, a field of this record, an owner ID.
    const props = request.edit.properties ?? {};
    for (const [label, name] of [['Parent Record', props.parentRecord], ['Related Language Record', props.relatedLanguageRecord],
      ['Query Security Record', props.querySecurityRecord], ['Analytic Delete Record', props.analyticDeleteRecord]] as const) {
      if (name && !(await exists(`SELECT COUNT(*) AS N FROM SYSADM.PSRECDEFN WHERE RECNAME = :r`, { r: name }))) {
        throw new RecordSaveRefusedError(`${label}: there is no record named ${name}.`);
      }
    }
    if (props.setControlField && !request.edit.fields.some((f) => f.name === props.setControlField)) {
      throw new RecordSaveRefusedError(`Set Control Field: ${props.setControlField} is not a field of ${recname}.`);
    }
    if (props.ownerId && !(await exists(`SELECT COUNT(*) AS N FROM SYSADM.PSXLATITEM WHERE FIELDNAME = 'OBJECTOWNERID' AND FIELDVALUE = :o`, { o: props.ownerId }))) {
      throw new RecordSaveRefusedError(`${props.ownerId} is not an owner ID in this database.`);
    }
    if (!(await operatorExists(c, request.operatorId))) {
      throw new RecordSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const counters = await readCounters(c, true);
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const plan = planRecordSave(stored, request.edit, { ts: lastupddttm, operatorId: request.operatorId });
    const next: Counters = {
      rdm: counters.rdm + 1, sys: counters.sys + 1, lockRdm: counters.lockRdm + 1,
      pgm: counters.pgm + (plan.bumpPgm ? 1 : 0), lockPgm: counters.lockPgm + (plan.bumpPgm ? 1 : 0)
    };

    const r = { r: recname };
    await expectRows(c, `DELETE FROM SYSADM.PSRECFIELDDB WHERE RECNAME = :r`, r, stored.db.length, 'Deleting PSRECFIELDDB');
    await expectRows(c, `DELETE FROM SYSADM.PSRECFIELD WHERE RECNAME = :r`, r, stored.fields.length, 'Deleting PSRECFIELD');
    for (const row of plan.fields) await insertRow(c, 'PSRECFIELD', tables.recfield, row);
    for (const row of plan.fields) await insertRow(c, 'PSRECFIELDDB', tables.recfielddb, dbRow(row, recname));

    const storedKey = stored.indexes.filter((i) => text(i.INDEXID) === '_');
    const storedKeys = stored.keys.filter((k) => text(k.INDEXID) === '_');
    if (storedKeys.length > 0) await expectRows(c, `DELETE FROM SYSADM.PSKEYDEFN WHERE RECNAME = :r AND INDEXID = '_'`, r, storedKeys.length, 'Deleting PSKEYDEFN');
    if (storedKey.length > 0) await expectRows(c, `DELETE FROM SYSADM.PSINDEXDEFN WHERE RECNAME = :r AND INDEXID = '_'`, r, storedKey.length, 'Deleting PSINDEXDEFN');
    if (plan.index) {
      await insertRow(c, 'PSINDEXDEFN', tables.index, plan.index.row);
      for (const k of plan.index.keys) await insertRow(c, 'PSKEYDEFN', tables.key, k);
    }

    // The Record Type tab (r26-r28): the tablespace row follows the SQL Table type, and a view's SQL is written when it changed.
    if (plan.tablespace === 'insert') {
      const [space] = await select<{ DDLSPACENAME: string; DBNAME: string }>(c,
        `SELECT DDLSPACENAME, DBNAME FROM SYSADM.PSTBLSPCCAT ORDER BY DDLSPACENAME FETCH FIRST 1 ROWS ONLY`);
      if (!space) throw new RecordSaveRefusedError('The tablespace catalog (PSTBLSPCCAT) is empty; refusing to write.');
      await c.execute(`DELETE FROM SYSADM.PSRECTBLSPC WHERE RECNAME = :r`, r);
      await expectRows(c,
        `INSERT INTO SYSADM.PSRECTBLSPC (DDLSPACENAME, DBNAME, RECNAME, DBTYPE, TEMPTBLINST, PT_TS_LOCK_TYPE, PT_UTS_ENABLED)
         VALUES (:s, :d, :r, ' ', 'N', ' ', ' ')`, { s: space.DDLSPACENAME, d: space.DBNAME, r: recname }, 1, 'Inserting PSRECTBLSPC');
    } else if (plan.tablespace === 'delete') {
      await c.execute(`DELETE FROM SYSADM.PSRECTBLSPC WHERE RECNAME = :r`, r);
    }
    if (plan.viewSql !== undefined) await writeViewSql(c, { recname, text: plan.viewSql, ts: lastupddttm, operatorId: request.operatorId });

    // Record Properties columns ride on the same update. DESCRLONG is a CLOB; its text (at most 4,000
    // characters, recordEdit.ts) binds as a string, which Oracle converts.
    const extra = Object.keys(plan.recordColumns);
    const extraBinds = Object.fromEntries(extra.map((col, i) => [`x${i}`, plan.recordColumns[col]]));
    await expectRows(c,
      `UPDATE SYSADM.PSRECDEFN SET FIELDCOUNT = :fc, INDEXCOUNT = :ic, VERSION = :v,
              LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op${extra.map((col, i) => `, ${col} = :x${i}`).join('')}
        WHERE RECNAME = :r`,
      { fc: plan.fieldCount, ic: plan.indexCount, v: next.rdm, ts: lastupddttm, op: request.operatorId, r: recname, ...extraBinds },
      1, 'Updating PSRECDEFN');
    if (languageReferrers.length > 0) {
      await expectRows(c, `UPDATE SYSADM.PSRECDEFN SET VERSION = :v WHERE RECNAME <> :r AND RELLANGRECNAME = :r`,
        { v: next.rdm, r: recname }, languageReferrers.length, 'Updating records whose Related Language record this is');
    }
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'RDM'`, { v: next.rdm }, 1, 'Updating PSVERSION RDM');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'RDM'`, { v: next.lockRdm }, 1, 'Updating PSLOCK RDM');
    if (plan.bumpPgm) {
      await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PGM'`, { v: next.pgm }, 1, 'Updating PSVERSION PGM');
      await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PGM'`, { v: next.lockPgm }, 1, 'Updating PSLOCK PGM');
    }

    const result: RecordSaveResult = { version: next.rdm, lastupddttm, plan, languageReferrers: languageReferrers.map((x) => text(x.RECNAME)) };
    await verifyRecordSave(c, request, result);
    const now = await readCounters(c, false);
    if ((Object.keys(next) as (keyof Counters)[]).some((k) => now[k] !== next[k])) {
      throw new RecordSaveRefusedError(`counters ${JSON.stringify(now)}, ${JSON.stringify(next)} expected; rolled back.`);
    }
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** The stored record is exactly the plan: every field, PSRECFIELDDB, index and key row, and PSRECDEFN's stamp. */
export async function verifyRecordSave(c: Connection, request: RecordSaveRequest, result: RecordSaveResult): Promise<void> {
  const recname = request.edit.recname;
  const tables: Tables = {
    recfield: await columnsOf(c, 'PSRECFIELD'), recfielddb: await columnsOf(c, 'PSRECFIELDDB'),
    index: await columnsOf(c, 'PSINDEXDEFN'), key: await columnsOf(c, 'PSKEYDEFN')
  };
  const now = await readStored(c, tables, recname, false);
  const problems: string[] = [];
  const compare = (what: string, actual: Row[], expected: Row[], cols: Column[]) => {
    if (actual.length !== expected.length) problems.push(`${what}: ${actual.length} rows, ${expected.length} expected`);
    else expected.forEach((e, i) => { if (!same(actual[i], e, cols)) problems.push(`${what} row ${i + 1} differs`); });
  };
  const { plan } = result;
  compare('PSRECFIELD', now.fields, plan.fields, tables.recfield);
  compare('PSRECFIELDDB', now.db, plan.fields.map((f) => dbRow(f, recname)), tables.recfielddb);
  compare('PSINDEXDEFN', now.indexes, plan.index ? [plan.index.row] : [], tables.index);
  compare('PSKEYDEFN', now.keys, plan.index ? plan.index.keys : [], tables.key);
  const [defn] = await select<{ FIELDCOUNT: number; INDEXCOUNT: number; VERSION: number; TS: string; OPRID: string }>(c,
    `SELECT FIELDCOUNT, INDEXCOUNT, VERSION, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS, LASTUPDOPRID AS OPRID
       FROM SYSADM.PSRECDEFN WHERE RECNAME = :r`, { r: recname });
  for (const [col, want] of Object.entries(plan.recordColumns)) {
    if (text(now.defn?.[col]) !== text(want)) problems.push(`PSRECDEFN.${col} is ${JSON.stringify(now.defn?.[col])}, ${JSON.stringify(want)} expected`);
  }
  for (const name of result.languageReferrers) {
    const [ref] = await select<{ VERSION: number }>(c, `SELECT VERSION FROM SYSADM.PSRECDEFN WHERE RECNAME = :n`, { n: name });
    if (Number(ref?.VERSION) !== result.version) problems.push(`${name}.VERSION ${ref?.VERSION}, ${result.version} expected`);
  }
  if (!defn) problems.push('PSRECDEFN row missing');
  else if (Number(defn.FIELDCOUNT) !== plan.fieldCount || Number(defn.INDEXCOUNT) !== plan.indexCount ||
           Number(defn.VERSION) !== result.version || defn.TS !== result.lastupddttm || text(defn.OPRID) !== request.operatorId) {
    problems.push(`PSRECDEFN ${JSON.stringify(defn)}`);
  }
  if (problems.length > 0) throw new RecordSaveRefusedError(`The record save did not land as planned (${problems.slice(0, 6).join('; ')}).`);
}


/**
 * Deleting a record, as App Designer does (case r40, ZZ_PCODE_LAB_R3): every
 * PSRECDEFN / PSRECFIELD / PSRECFIELDDB / PSINDEXDEFN / PSKEYDEFN /
 * PSRECTBLSPC row of the record deleted, PSRECDEL inserted with VERSION =
 * the new RDM; PSVERSION RDM, AEM and SYS + 1; PSLOCK RDM and AEM + 1.
 *
 * Refused for anything r40 does not cover: a record outside ZZ_PCODE_LAB,
 * not an SQL Table or Derived/Work record, with Record PeopleCode, referred
 * to by another record, page, component or project, with a materialized
 * view row, or one already marked deleted.
 */
export async function deleteRecord(c: Connection, request: { recname: string; openedVersion: number; operatorId: string }): Promise<{ version: number }> {
  const recname = request.recname;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new RecordSaveRefusedError(operatorError);
    if (!isScratchName(recname)) throw new RecordSaveRefusedError(`${recname} is outside ZZ_PCODE_LAB: deleting records is limited to scratch records for now.`);
    const [defn] = await select<{ RECTYPE: number; VERSION: number }>(c,
      `SELECT RECTYPE, VERSION FROM SYSADM.PSRECDEFN WHERE RECNAME = :r FOR UPDATE`, { r: recname });
    if (!defn) throw new RecordSaveRefusedError(`There is no record named ${recname}.`);
    if (Number(defn.VERSION) !== request.openedVersion) {
      throw new RecordSaveRefusedError(`${recname} was saved since it was opened (version ${defn.VERSION}, not ${request.openedVersion}).`);
    }
    if (Number(defn.RECTYPE) !== RecordType.Table && Number(defn.RECTYPE) !== RecordType.DerivedWork) {
      throw new RecordSaveRefusedError('Only SQL Table and Derived/Work records can be deleted here yet.');
    }
    const uses: [string, string][] = [
      ['has Record PeopleCode', `SELECT COUNT(*) AS N FROM SYSADM.PSPCMPROG WHERE OBJECTID1 = 1 AND OBJECTVALUE1 = :r`],
      ['is a subrecord of other records', `SELECT COUNT(*) AS N FROM SYSADM.PSRECFIELD WHERE FIELDNAME = :r AND SUBRECORD = 'Y'`],
      ['is referred to by other records', `SELECT COUNT(*) AS N FROM SYSADM.PSRECDEFN WHERE RECNAME <> :r AND :r IN (PARENTRECNAME, RELLANGRECNAME, QRYSECRECNAME, OPTDELRECNAME, AUDITRECNAME)`],
      ['is on pages', `SELECT COUNT(*) AS N FROM SYSADM.PSPNLFIELD WHERE RECNAME = :r`],
      ['is a component search record', `SELECT COUNT(*) AS N FROM SYSADM.PSPNLGRPDEFN WHERE :r IN (SEARCHRECNAME, ADDSRCHRECNAME)`],
      ['is in projects', `SELECT COUNT(*) AS N FROM SYSADM.PSPROJECTITEM WHERE OBJECTTYPE IN (0, 1, 8) AND OBJECTVALUE1 = :r`],
      ['has a materialized view row', `SELECT COUNT(*) AS N FROM SYSADM.PSPTMATVWDEFN WHERE RECNAME = :r`],
      ['has an earlier deletion marker (PSRECDEL)', `SELECT COUNT(*) AS N FROM SYSADM.PSRECDEL WHERE RECNAME = :r`]
    ];
    for (const [what, sql] of uses) {
      const [{ N }] = await select<{ N: number }>(c, sql, { r: recname });
      if (Number(N) > 0) throw new RecordSaveRefusedError(`${recname} ${what}; deleting it here is not supported yet.`);
    }
    if (!(await operatorExists(c, request.operatorId))) {
      throw new RecordSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }
    const v = await select<{ T: string; V: number }>(c,
      `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('RDM', 'AEM', 'SYS') FOR UPDATE`);
    const l = await select<{ T: string; V: number }>(c,
      `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME IN ('RDM', 'AEM') FOR UPDATE`);
    const get = (rows: { T: string; V: number }[], name: string) => {
      const r = rows.find((x) => String(x.T).trim() === name);
      if (!r) throw new RecordSaveRefusedError(`${name} is missing from PSVERSION / PSLOCK; refusing to write.`);
      return Number(r.V) + 1;
    };
    const next = { rdm: get(v, 'RDM'), aem: get(v, 'AEM'), sys: get(v, 'SYS'), lockRdm: get(l, 'RDM'), lockAem: get(l, 'AEM') };
    const r = { r: recname };
    for (const table of ['PSRECFIELDDB', 'PSRECFIELD', 'PSKEYDEFN', 'PSINDEXDEFN', 'PSRECTBLSPC']) {
      await c.execute(`DELETE FROM SYSADM.${table} WHERE RECNAME = :r`, r);
    }
    await expectRows(c, `DELETE FROM SYSADM.PSRECDEFN WHERE RECNAME = :r`, r, 1, 'Deleting PSRECDEFN');
    await expectRows(c, `INSERT INTO SYSADM.PSRECDEL (RECNAME, VERSION) VALUES (:r, :v)`, { r: recname, v: next.rdm }, 1, 'Inserting PSRECDEL');
    for (const [table, name, value] of [['PSVERSION', 'RDM', next.rdm], ['PSVERSION', 'AEM', next.aem], ['PSVERSION', 'SYS', next.sys],
      ['PSLOCK', 'RDM', next.lockRdm], ['PSLOCK', 'AEM', next.lockAem]] as const) {
      await expectRows(c, `UPDATE SYSADM.${table} SET VERSION = :v WHERE OBJECTTYPENAME = :n`, { v: value, n: name }, 1, `Updating ${table} ${name}`);
    }
    const left = await select<{ N: number }>(c,
      `SELECT (SELECT COUNT(*) FROM SYSADM.PSRECDEFN WHERE RECNAME = :r) + (SELECT COUNT(*) FROM SYSADM.PSRECFIELD WHERE RECNAME = :r)
            + (SELECT COUNT(*) FROM SYSADM.PSRECFIELDDB WHERE RECNAME = :r) + (SELECT COUNT(*) FROM SYSADM.PSINDEXDEFN WHERE RECNAME = :r) AS N FROM DUAL`, r);
    if (Number(left[0].N) !== 0) throw new RecordSaveRefusedError('Rows of the record remain after the delete; rolled back.');
    await c.commit();
    return { version: next.rdm };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
