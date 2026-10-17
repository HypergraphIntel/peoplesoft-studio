import { createHash } from 'node:crypto';
import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import {
  documentFromRows, rowsFromDocument, validateFileLayout, type FileLayoutDocument, type FileLayoutRows, type RecordFieldInfo, type Row
} from '../model/fileLayoutDocument.js';
import { SaveRefusedError, validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { run, type Statement } from './appEngineWriter.js';
import { operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

/*
 * Saving a File Layout as App Designer's File Layout window does
 * (docs/FILE_LAYOUTS.md; captures fl01-fl15).
 *
 *   Save     PSFLDDEFN inserted or updated, VERSION the new FLM and the save's stamp; PSFLDSEGDEFN and
 *            PSFLDFIELDDEFN rows inserted, updated and deleted to match; a recreated name's PSFLDDEL
 *            removed; PSVERSION / PSLOCK FLM + 1, PSVERSION SYS + 1 [fl01-fl11, fl15].
 *   Save As  the same, as a create of the copy [fl12].
 *   Delete   every row; PSFLDDEL (name, new FLM); FLM and SYS + 1 [fl14].
 *   Rename   the rows re-keyed, PSFLDDEFN restamped at the new FLM; PSFLDDEL (old name, new FLM); FLM,
 *            PJM and SYS + 1 [fl13]. Project items naming it (OBJECTTYPE 31, OBJECTID1 71) are repointed
 *            and their projects' VERSION set to the new PJM, as App Designer's rename does for message
 *            channels [chn17]; fl13's layout was in no project.
 *
 * The planners are pure; the runners execute them in one transaction (the layout read FOR UPDATE, the
 * open token checked, the result re-read and proved before COMMIT).
 */

export class FileLayoutSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'FileLayoutSaveRefusedError'; }
}

export interface StoredFileLayout { exists: boolean; rows: FileLayoutRows; tombstones: Row[] }
export interface Counters { FLM: number; PJM: number; SYS: number }
type CounterName = keyof Counters;
const COUNTERS: readonly CounterName[] = ['FLM', 'PJM', 'SYS'];
/** PSPROJECTITEM: a File Layout is OBJECTTYPE 31, OBJECTID1 71 (22 on HRDMO). */
export const FILE_LAYOUT_PROJECT_ITEM = { objectType: 31, objectId: 71 } as const;

const OUT_FORMAT_OBJECT = 4002;
const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const val = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' && v.trim() === '' ? ' ' : String(v).replace(/\s+$/, ''));
const segKey = (r: Row) => String(r.FLDSEGNAME).trim();
const fieldKey = (r: Row) => `${String(r.FLDSEGNAME).trim()}\u0000${String(r.FLDFIELDNAME).trim()}`;

export async function readStoredFileLayout(c: Connection, oracledb: DbTypes, name: string, forUpdate: boolean): Promise<StoredFileLayout> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const opts = { outFormat: OUT_FORMAT_OBJECT, fetchInfo: { DESCRLONG: { type: oracledb.STRING } } };
  const all = async (sql: string) => ((await c.execute<Row>(sql, { n: name }, opts)).rows ?? []);
  const [layout] = await all(`SELECT L.*, TO_CHAR(L.LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM_TEXT FROM PSFLDDEFN L WHERE FLDDEFNNAME = :n${lock}`);
  const tombstones = await all('SELECT FLDDEFNNAME, VERSION FROM PSFLDDEL WHERE FLDDEFNNAME = :n');
  if (!layout) return { exists: false, rows: { layout: {}, segments: [], fields: [] }, tombstones };
  layout.LASTUPDDTTM = layout.LASTUPDDTTM_TEXT;
  delete layout.LASTUPDDTTM_TEXT;
  return {
    exists: true, tombstones,
    rows: {
      layout,
      segments: await all(`SELECT * FROM PSFLDSEGDEFN WHERE FLDDEFNNAME = :n ORDER BY FLDSEGNAME${lock}`),
      fields: await all(`SELECT * FROM PSFLDFIELDDEFN WHERE FLDDEFNNAME = :n ORDER BY FLDSEGNAME, FLDSEQNO${lock}`)
    }
  };
}

export function fileLayoutDocumentOf(stored: StoredFileLayout, name: string): FileLayoutDocument {
  return documentFromRows(name, stored.rows);
}

/** The concurrency token: VERSION (every App Designer save moves it) and the rows' content. */
export function fileLayoutToken(stored: StoredFileLayout | undefined): string {
  if (!stored || !stored.exists) return 'absent';
  const shape = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort().map((k) => [k, val(r[k])]))).sort();
  const parts = [`V${Number(stored.rows.layout.VERSION)}`, ...shape([stored.rows.layout]), ...shape(stored.rows.segments), ...shape(stored.rows.fields)];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

/** A record's fields as Insert > Record takes them: PSRECFIELDDB (subrecords expanded) order, PSDBFIELD type / length / decimals. */
export async function readRecordFieldInfo(c: Connection, record: string): Promise<RecordFieldInfo[]> {
  const rows = await select<{ F: string; T: number; L: number; D: number }>(c,
    `SELECT R.FIELDNAME AS F, D.FIELDTYPE AS T, D.LENGTH AS L, D.DECIMALPOS AS D
       FROM PSRECFIELDDB R JOIN PSDBFIELD D ON D.FIELDNAME = R.FIELDNAME
      WHERE R.RECNAME = :r ORDER BY R.FIELDNUM`, { r: record });
  return rows.map((r) => ({ name: String(r.F).trim(), type: Number(r.T), length: Number(r.L), decimals: Number(r.D) }));
}

export async function readFileLayoutCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const rows = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('FLM', 'PJM', 'SYS')${lock}`);
  const locks = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME IN ('FLM', 'PJM')${lock}`);
  const out = {} as Counters;
  for (const n of COUNTERS) {
    const r = rows.find((x) => String(x.T).trim() === n);
    if (!r) throw new FileLayoutSaveRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
    const l = locks.find((x) => String(x.T).trim() === n);
    // PSVERSION and PSLOCK move together [fl01-fl14]; should they disagree, the next value is past both.
    out[n] = Math.max(Number(r.V), l ? Number(l.V) : 0);
  }
  return out;
}

/** PSVERSION and PSLOCK set to the new value (SYS has no PSLOCK row App Designer moves) [fl01, fl13]. */
function counterStatements(from: Counters, to: Counters): Statement[] {
  const st: Statement[] = [];
  for (const n of COUNTERS) {
    if (to[n] === from[n]) continue;
    st.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
    if (n !== 'SYS') st.push({ sql: `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, what: `Updating PSLOCK ${n}` });
  }
  return st;
}

function columnBinds(row: Row, oracledb: DbTypes, prefix: string): { cols: string[]; values: string[]; binds: Record<string, unknown> } {
  const cols: string[] = [], values: string[] = [], binds: Record<string, unknown> = {};
  Object.keys(row).forEach((col, i) => {
    cols.push(col);
    const v = row[col];
    if (col === 'DESCRLONG') {
      if (v === null || v === undefined) { values.push('NULL'); return; }
      binds[`${prefix}${i}`] = { val: String(v), type: oracledb.CLOB };
    } else binds[`${prefix}${i}`] = typeof v === 'string' && v === '' ? ' ' : v;
    values.push(`:${prefix}${i}`);
  });
  return { cols, values, binds };
}

function insertRow(table: string, row: Row, oracledb: DbTypes, prefix = 'b'): Statement {
  const { cols, values, binds } = columnBinds(row, oracledb, prefix);
  return { sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values.join(', ')})`, binds, expect: 1, what: `Inserting ${table}` };
}

function setClauses(row: Row, cols: string[], oracledb: DbTypes, binds: Record<string, unknown>): string[] {
  return cols.map((col, i) => {
    const v = row[col];
    if (col === 'DESCRLONG') {
      if (v === null || v === undefined) return `${col} = NULL`;
      binds[`u${i}`] = { val: String(v), type: oracledb.CLOB };
    } else binds[`u${i}`] = v;
    return `${col} = :u${i}`;
  });
}

function updateRow(table: string, keys: string[], row: Row, changed: string[], oracledb: DbTypes): Statement {
  const binds: Record<string, unknown> = {};
  const sets = setClauses(row, changed, oracledb, binds);
  keys.forEach((k, i) => { binds[`k${i}`] = row[k]; });
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE ${keys.map((k, i) => `${k} = :k${i}`).join(' AND ')}`, binds, expect: 1, what: `Updating ${table}` };
}

const changedColumns = (want: Row, have: Row, skip: Set<string>) => Object.keys(want).filter((k) => !skip.has(k) && val(want[k]) !== val(have[k]));

export interface FileLayoutPlan {
  name: string;
  empty: boolean;
  statements: Statement[];
  desired: FileLayoutRows;
  counters: Counters;
  summary: { changes: string[]; inserted: number; updated: number; deleted: number };
}

export interface PlanOptions { operatorId: string; lastupddttm: string; counters: Counters; oracledb: DbTypes }

/** The statements that turn the stored layout (missing: a create) into the document. */
export function planFileLayoutSave(stored: StoredFileLayout | undefined, doc: FileLayoutDocument, opts: PlanOptions): FileLayoutPlan {
  const creating = !stored || !stored.exists;
  const desired = rowsFromDocument(doc);
  const name = doc.name;
  const counts = { inserted: 0, updated: 0, deleted: 0 };
  const changes: string[] = [];
  const body: Statement[] = [];
  const have = creating ? { layout: {}, segments: [], fields: [] } as FileLayoutRows : stored!.rows;

  const layoutCols = creating ? [] : changedColumns(desired.layout, have.layout, new Set([...STAMP, 'FLDDEFNNAME']));
  const segHave = new Map(have.segments.map((r) => [segKey(r), r]));
  const segWant = new Map(desired.segments.map((r) => [segKey(r), r]));
  const fieldHave = new Map(have.fields.map((r) => [fieldKey(r), r]));
  const fieldWant = new Map(desired.fields.map((r) => [fieldKey(r), r]));

  for (const [k, r] of fieldHave) if (!fieldWant.has(k)) {
    body.push({ sql: 'DELETE FROM PSFLDFIELDDEFN WHERE FLDDEFNNAME = :n AND FLDSEGNAME = :s AND FLDFIELDNAME = :f', binds: { n: name, s: r.FLDSEGNAME, f: r.FLDFIELDNAME }, expect: 1, what: 'Deleting PSFLDFIELDDEFN' });
    counts.deleted++; changes.push(`delete field ${segKey(r)}.${String(r.FLDFIELDNAME).trim()}`);
  }
  for (const [k, r] of segHave) if (!segWant.has(k)) {
    body.push({ sql: 'DELETE FROM PSFLDSEGDEFN WHERE FLDDEFNNAME = :n AND FLDSEGNAME = :s', binds: { n: name, s: r.FLDSEGNAME }, expect: 1, what: 'Deleting PSFLDSEGDEFN' });
    counts.deleted++; changes.push(`delete segment ${k}`);
  }
  if (creating) {
    counts.inserted++; changes.push(`create File Layout ${name}`);
  } else if (layoutCols.length) {
    changes.push(...layoutCols.map((c) => `layout ${c}`));
  }
  for (const [k, r] of segWant) {
    const h = segHave.get(k);
    if (!h) { body.push(insertRow('PSFLDSEGDEFN', r, opts.oracledb)); counts.inserted++; if (!creating) changes.push(`add segment ${k}`); continue; }
    const cols = changedColumns(r, h, new Set(['FLDDEFNNAME', 'FLDSEGNAME']));
    if (cols.length) { body.push(updateRow('PSFLDSEGDEFN', ['FLDDEFNNAME', 'FLDSEGNAME'], r, cols, opts.oracledb)); counts.updated++; changes.push(`segment ${k}: ${cols.join(', ')}`); }
  }
  for (const [k, r] of fieldWant) {
    const h = fieldHave.get(k);
    const label = `${segKey(r)}.${String(r.FLDFIELDNAME).trim()}`;
    if (!h) { body.push(insertRow('PSFLDFIELDDEFN', r, opts.oracledb)); counts.inserted++; if (!creating) changes.push(`add field ${label}`); continue; }
    const cols = changedColumns(r, h, new Set(['FLDDEFNNAME', 'FLDSEGNAME', 'FLDFIELDNAME']));
    if (cols.length) { body.push(updateRow('PSFLDFIELDDEFN', ['FLDDEFNNAME', 'FLDSEGNAME', 'FLDFIELDNAME'], r, cols, opts.oracledb)); counts.updated++; changes.push(`field ${label}: ${cols.join(', ')}`); }
  }

  const changed = creating || layoutCols.length > 0 || body.length > 0;
  const next = { ...opts.counters };
  if (changed) { next.FLM += 1; next.SYS += 1; }
  const statements: Statement[] = [];
  if (changed) {
    if (creating) {
      const { cols, values, binds } = columnBinds({ ...desired.layout, VERSION: next.FLM, LASTUPDOPRID: opts.operatorId }, opts.oracledb, 'b');
      statements.push({ sql: `INSERT INTO PSFLDDEFN (${cols.join(', ')}, LASTUPDDTTM) VALUES (${values.join(', ')}, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}))`,
        binds: { ...binds, ts: opts.lastupddttm }, expect: 1, what: 'Inserting PSFLDDEFN' });
      // A name deleted before and created again loses its tombstone, as App Designer's other definitions do [mn19, ci28].
      for (const t of stored?.tombstones ?? []) statements.push({ sql: 'DELETE FROM PSFLDDEL WHERE FLDDEFNNAME = :n AND VERSION = :v', binds: { n: name, v: t.VERSION }, expect: 1, what: 'Deleting PSFLDDEL' });
    } else {
      const binds: Record<string, unknown> = { k: name, ver: next.FLM, ts: opts.lastupddttm, op: opts.operatorId };
      const sets = setClauses(desired.layout, layoutCols, opts.oracledb, binds);
      statements.push({ sql: `UPDATE PSFLDDEFN SET ${[...sets, `VERSION = :ver, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op`].join(', ')} WHERE FLDDEFNNAME = :k`,
        binds, expect: 1, what: 'Updating PSFLDDEFN' });
    }
    statements.push(...body, ...counterStatements(opts.counters, next));
    if (!changes.length) changes.push('layout restamped');
  }
  return { name, empty: !changed, statements, desired, counters: next, summary: { changes, ...counts } };
}

/** File > Delete [fl14]: every row; PSFLDDEL at the new FLM; FLM and SYS + 1. Project items keep the name. */
export function planFileLayoutDelete(name: string, counters: Counters): { statements: Statement[]; counters: Counters } {
  const to = { ...counters, FLM: counters.FLM + 1, SYS: counters.SYS + 1 };
  return {
    counters: to,
    statements: [
      { sql: 'DELETE FROM PSFLDFIELDDEFN WHERE FLDDEFNNAME = :n', binds: { n: name }, what: 'Deleting PSFLDFIELDDEFN' },
      { sql: 'DELETE FROM PSFLDSEGDEFN WHERE FLDDEFNNAME = :n', binds: { n: name }, what: 'Deleting PSFLDSEGDEFN' },
      { sql: 'DELETE FROM PSFLDDEFN WHERE FLDDEFNNAME = :n', binds: { n: name }, expect: 1, what: 'Deleting PSFLDDEFN' },
      { sql: 'INSERT INTO PSFLDDEL (FLDDEFNNAME, VERSION) VALUES (:n, :v)', binds: { n: name, v: to.FLM }, expect: 1, what: 'Inserting PSFLDDEL' },
      ...counterStatements(counters, to)
    ]
  };
}

/** File > Rename [fl13]: see the header. */
export function planFileLayoutRename(from: string, to: string, target: StoredFileLayout, opts: PlanOptions): { statements: Statement[]; counters: Counters } {
  const next = { FLM: opts.counters.FLM + 1, PJM: opts.counters.PJM + 1, SYS: opts.counters.SYS + 1 };
  const b = { f: from, t: to };
  const { objectType, objectId } = FILE_LAYOUT_PROJECT_ITEM;
  return {
    counters: next,
    statements: [
      { sql: `UPDATE PSFLDDEFN SET FLDDEFNNAME = :t, VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE FLDDEFNNAME = :f`,
        binds: { ...b, v: next.FLM, ts: opts.lastupddttm, op: opts.operatorId }, expect: 1, what: 'Renaming PSFLDDEFN' },
      { sql: 'UPDATE PSFLDSEGDEFN SET FLDDEFNNAME = :t WHERE FLDDEFNNAME = :f', binds: { ...b }, what: 'Renaming PSFLDSEGDEFN' },
      { sql: 'UPDATE PSFLDFIELDDEFN SET FLDDEFNNAME = :t WHERE FLDDEFNNAME = :f', binds: { ...b }, what: 'Renaming PSFLDFIELDDEFN' },
      { sql: 'INSERT INTO PSFLDDEL (FLDDEFNNAME, VERSION) VALUES (:f, :v)', binds: { f: from, v: next.FLM }, expect: 1, what: 'Inserting PSFLDDEL' },
      ...target.tombstones.map((t) => ({ sql: 'DELETE FROM PSFLDDEL WHERE FLDDEFNNAME = :t AND VERSION = :v', binds: { t: to, v: t.VERSION }, expect: 1, what: 'Deleting PSFLDDEL' })),
      { sql: `UPDATE PSPROJECTDEFN SET VERSION = :v WHERE PROJECTNAME IN (SELECT PROJECTNAME FROM PSPROJECTITEM WHERE OBJECTTYPE = ${objectType} AND OBJECTID1 = ${objectId} AND OBJECTVALUE1 = :f)`,
        binds: { f: from, v: next.PJM }, what: 'Updating PSPROJECTDEFN' },
      { sql: `UPDATE PSPROJECTITEM SET OBJECTVALUE1 = :t WHERE OBJECTTYPE = ${objectType} AND OBJECTID1 = ${objectId} AND OBJECTVALUE1 = :f`, binds: { ...b }, what: 'Repointing PSPROJECTITEM' },
      ...counterStatements(opts.counters, next)
    ]
  };
}

// ---------------------------------------------------------------------------
// Running

async function prepare(c: Connection, operatorId: string, names: string[]): Promise<void> {
  const operatorError = validateOperatorId(operatorId);
  if (operatorError) throw new FileLayoutSaveRefusedError(operatorError);
  for (const n of names) { const scope = writeScopeRefusal(n); if (scope) throw new FileLayoutSaveRefusedError(scope); }
  if (!(await operatorExists(c, operatorId))) throw new FileLayoutSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
}

async function saveContext(c: Connection): Promise<{ counters: Counters; lastupddttm: string }> {
  const counters = await readFileLayoutCounters(c, true);
  const [{ TS }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
  return { counters, lastupddttm: TS };
}

export interface FileLayoutSaveRequest { doc: FileLayoutDocument; openedToken: string; operatorId: string; dryRun?: boolean }
export interface FileLayoutSaveResult { plan: FileLayoutPlan; token: string; written: boolean; version: number }

const shape = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort().map((k) => [k, val(r[k])]))).sort();

/** Proves the stored layout is the plan's: every row, VERSION and the counters. */
async function verifyFileLayout(c: Connection, oracledb: DbTypes, plan: FileLayoutPlan): Promise<StoredFileLayout> {
  const stored = await readStoredFileLayout(c, oracledb, plan.name, false);
  if (!stored.exists) throw new FileLayoutSaveRefusedError(`After the save there is no File Layout ${plan.name}.`);
  const problems: string[] = [];
  const got = Object.fromEntries(Object.keys(plan.desired.layout).map((k) => [k, stored.rows.layout[k]]));
  if (JSON.stringify(shape([got])) !== JSON.stringify(shape([plan.desired.layout]))) problems.push('the layout row differs');
  if (JSON.stringify(shape(stored.rows.segments)) !== JSON.stringify(shape(plan.desired.segments))) problems.push('the segment rows differ');
  if (JSON.stringify(shape(stored.rows.fields)) !== JSON.stringify(shape(plan.desired.fields))) problems.push('the field rows differ');
  if (Number(stored.rows.layout.VERSION) !== plan.counters.FLM) problems.push(`VERSION ${stored.rows.layout.VERSION}, ${plan.counters.FLM} expected`);
  const now = await readFileLayoutCounters(c, false);
  for (const n of COUNTERS) if (now[n] !== plan.counters[n]) problems.push(`PSVERSION ${n} ${now[n]}, ${plan.counters[n]} expected`);
  if (problems.length) throw new FileLayoutSaveRefusedError(`The written rows are not the planned ones (${problems.join('; ')}).`);
  return stored;
}

export async function saveFileLayout(c: Connection, oracledb: DbTypes, request: FileLayoutSaveRequest): Promise<FileLayoutSaveResult> {
  try {
    await prepare(c, request.operatorId, [request.doc.name]);
    const problems = validateFileLayout(request.doc).filter((p) => p.severity === 'error');
    if (problems.length) throw new FileLayoutSaveRefusedError(`The File Layout has errors: ${problems.slice(0, 5).map((p) => `${p.path}: ${p.message}`).join('; ')}`);
    const stored = await readStoredFileLayout(c, oracledb, request.doc.name, true);
    const token = fileLayoutToken(stored);
    if (token !== request.openedToken) {
      throw new FileLayoutSaveRefusedError(request.openedToken === 'absent'
        ? `A File Layout named ${request.doc.name} already exists.`
        : `${request.doc.name} was changed in the database since it was opened (another save, possibly in App Designer). Reopen it and reapply your edit.`);
    }
    const ctx = await saveContext(c);
    const plan = planFileLayoutSave(stored, request.doc, { operatorId: request.operatorId, ...ctx, oracledb });
    if (plan.empty) { await c.rollback(); return { plan, token, written: false, version: Number(stored.rows.layout.VERSION) }; }
    await run(c, plan.statements);
    const after = await verifyFileLayout(c, oracledb, plan);
    if (request.dryRun) { await c.rollback(); return { plan, token, written: false, version: plan.counters.FLM }; }
    await c.commit();
    return { plan, token: fileLayoutToken(after), written: true, version: plan.counters.FLM };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

export async function deleteFileLayout(c: Connection, oracledb: DbTypes, name: string, openedToken: string, operatorId: string): Promise<{ counters: Counters }> {
  try {
    await prepare(c, operatorId, [name]);
    const stored = await readStoredFileLayout(c, oracledb, name, true);
    if (!stored.exists) throw new FileLayoutSaveRefusedError(`There is no File Layout ${name}.`);
    if (fileLayoutToken(stored) !== openedToken) throw new FileLayoutSaveRefusedError(`${name} was changed in the database since it was opened.`);
    const plan = planFileLayoutDelete(name, await readFileLayoutCounters(c, true));
    await run(c, plan.statements);
    if ((await readStoredFileLayout(c, oracledb, name, false)).exists) throw new FileLayoutSaveRefusedError(`${name} still has rows after the delete.`);
    await c.commit();
    return { counters: plan.counters };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

export async function renameFileLayout(c: Connection, oracledb: DbTypes, from: string, to: string, openedToken: string, operatorId: string): Promise<{ token: string; version: number }> {
  try {
    await prepare(c, operatorId, [from, to]);
    if (!/^[A-Z][A-Z0-9_#@$]{0,29}$/.test(to)) throw new FileLayoutSaveRefusedError(`${to} is not a File Layout name.`);
    const stored = await readStoredFileLayout(c, oracledb, from, true);
    if (!stored.exists) throw new FileLayoutSaveRefusedError(`There is no File Layout ${from}.`);
    if (fileLayoutToken(stored) !== openedToken) throw new FileLayoutSaveRefusedError(`${from} was changed in the database since it was opened.`);
    const target = await readStoredFileLayout(c, oracledb, to, true);
    if (target.exists) throw new FileLayoutSaveRefusedError(`A File Layout named ${to} already exists.`);
    const ctx = await saveContext(c);
    const plan = planFileLayoutRename(from, to, target, { operatorId, ...ctx, oracledb });
    await run(c, plan.statements);
    const after = await readStoredFileLayout(c, oracledb, to, false);
    if (!after.exists || (await readStoredFileLayout(c, oracledb, from, false)).exists) throw new FileLayoutSaveRefusedError(`The rename of ${from} to ${to} did not take.`);
    if (after.rows.segments.length !== stored.rows.segments.length || after.rows.fields.length !== stored.rows.fields.length) throw new FileLayoutSaveRefusedError('The renamed layout lost rows.');
    await c.commit();
    return { token: fileLayoutToken(after), version: plan.counters.FLM };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
