import { createHash } from 'node:crypto';
import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import { dateKey, type AppEngineRows, type Row } from '../model/appEngine.js';
import {
  documentFromRows, peopleCodeKey, rowsFromDocument, splitSqlText, type AeDesiredRows, type AeDocument
} from '../model/aeDocument.js';
import { validateAppEngine } from '../model/aeValidation.js';
import { predictSourceSignature } from '../peoplecode/sourceSignature.js';
import {
  checkStoredProgram, compileForSave, expectedProgram, planProgram, prepareSourceForSave, SaveRefusedError, storedText,
  validateOperatorId, type CompileTarget, type StoredProgram
} from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';
import { readStructuredSnapshot, type StructuredPreview } from './structuredSnapshot.js';

/*
 * Saving an App Engine program as App Designer does (docs/APP_ENGINE.md).
 *
 * planAppEngineSave compares the program as stored with the document to
 * save and returns the statements that make the one the other -- PSAE*
 * rows inserted, updated (changed columns only) and deleted by key; the
 * actions' SQL / XSLT definitions; their PeopleCode, compiled as the
 * PeopleCode writer compiles it; tombstones for deleted and renamed keys,
 * removed for re-created ones; the program and touched sections restamped;
 * the counters moved as App Designer moves them. Pure: no database access.
 *
 * saveAppEngine runs a plan in one transaction: it re-reads the program FOR
 * UPDATE, checks the token taken when the document was opened, plans,
 * writes, re-reads and proves the result is the document (and the counters
 * the plan's), then commits. verifyAppEngineSave proves it again on another
 * connection after COMMIT. Any failure before COMMIT rolls back.
 *
 * Rows nobody can edit are kept: orphan SQL and PeopleCode (stored under a
 * program's keys with no action naming them) are never touched, and
 * columns no dialog writes keep their values.
 */

export class AeSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'AeSaveRefusedError'; }
}

// ---------------------------------------------------------------------------
// The program as stored

export interface StoredSql {
  sqlId: string;
  sqlType: string;
  defn: Row;
  descr: Row[];
  text: Row[];
  hash: Row[];
}

export interface StoredAppEngine {
  /** False when there is no such program (its tombstones are still read). */
  exists: boolean;
  rows: AppEngineRows;
  sql: StoredSql[];
  /** PeopleCode programs stored under the program (OBJECTID1 66), by key parts joined with '|'. */
  peopleCode: Map<string, StoredProgram>;
  tombstones: { program: Row[]; sections: Row[]; sql: Row[]; peopleCode: Row[] };
}

export interface Counters { AEM: number; AES: number; SRM: number; PCM: number; PJM: number; SYS: number }
type CounterName = keyof Counters;
const COUNTERS: readonly CounterName[] = ['AEM', 'AES', 'SRM', 'PCM', 'PJM', 'SYS'];

const OUT_FORMAT_OBJECT = 4002;
export const PC_KEY_COLUMNS = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`OBJECTID${n}`, `OBJECTVALUE${n}`]);
const PC_IDS = [66, 77, 39, 20, 21, 78, 12];

/** Reads a program's rows, its SQL, PeopleCode and tombstones; undefined when there is no such program. */
export async function readStoredAppEngine(c: Connection, oracledb: DbTypes, name: string, forUpdate: boolean): Promise<StoredAppEngine | undefined> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const opts = {
    outFormat: OUT_FORMAT_OBJECT,
    fetchInfo: { SQLTEXT: { type: oracledb.STRING }, DESCRLONG: { type: oracledb.STRING }, PCTEXT: { type: oracledb.STRING } }
  };
  const all = async (sql: string, binds: Record<string, unknown> = { a: name }) => ((await c.execute<Row>(sql, binds, opts)).rows ?? []);
  const [program] = await all(`SELECT * FROM PSAEAPPLDEFN WHERE AE_APPLID = :a${lock}`);
  const tombstones = {
    program: await all(`SELECT AE_APPLID, VERSION FROM PSAEAPPLDEL WHERE AE_APPLID = :a`),
    sections: await all(`SELECT AE_APPLID, AE_SECTION, VERSION FROM PSAESECTDEL WHERE AE_APPLID = :a`),
    sql: await all(`SELECT SQLID, SQLTYPE, VERSION FROM PSSQLDEL WHERE SUBSTR(SQLID, 1, 12) = RPAD(:a, 12) AND SQLTYPE IN ('1', '6')`),
    peopleCode: await all(`SELECT ${PC_KEY_COLUMNS.join(', ')}, VERSION FROM PSPCMPROGDEL WHERE OBJECTID1 = 66 AND OBJECTVALUE1 = :a`)
  };
  if (!program) {
    return {
      exists: false, sql: [], peopleCode: new Map(), tombstones,
      rows: { program: {}, states: [], tempTables: [], languages: [], sections: [], variants: [], steps: [], actions: [], messages: [], sqlText: [] }
    };
  }
  const rows: AppEngineRows = {
    program,
    states: await all(`SELECT * FROM PSAEAPPLSTATE WHERE AE_APPLID = :a${lock}`),
    tempTables: await all(`SELECT * FROM PSAEAPPLTEMPTBL WHERE AE_APPLID = :a${lock}`),
    languages: await all(`SELECT * FROM PSAEAPPLLANG WHERE AE_APPLID = :a${lock}`),
    sections: await all(`SELECT * FROM PSAESECTDEFN WHERE AE_APPLID = :a${lock}`),
    variants: await all(`SELECT * FROM PSAESECTDTLDEFN WHERE AE_APPLID = :a${lock}`),
    steps: await all(`SELECT * FROM PSAESTEPDEFN WHERE AE_APPLID = :a${lock}`),
    actions: await all(`SELECT * FROM PSAESTMTDEFN WHERE AE_APPLID = :a${lock}`),
    messages: await all(`SELECT * FROM PSAESTEPMSGDEFN WHERE AE_APPLID = :a${lock}`),
    sqlText: await all(`SELECT * FROM PSSQLTEXTDEFN WHERE SUBSTR(SQLID, 1, 12) = RPAD(:a, 12) AND SQLTYPE IN ('1', '6')${lock}`)
  };
  const defns = await all(`SELECT * FROM PSSQLDEFN WHERE SUBSTR(SQLID, 1, 12) = RPAD(:a, 12) AND SQLTYPE IN ('1', '6')${lock}`);
  const descrs = await all(`SELECT * FROM PSSQLDESCR WHERE SUBSTR(SQLID, 1, 12) = RPAD(:a, 12) AND SQLTYPE IN ('1', '6')${lock}`);
  const hashes = await all(`SELECT * FROM PSSQLHASH WHERE SUBSTR(SQLID, 1, 12) = RPAD(:a, 12) AND SQLTYPE IN ('1', '6')${lock}`);
  const sqlKey = (r: Row) => `${String(r.SQLID)}|${String(r.SQLTYPE).trim()}`;
  const sql: StoredSql[] = defns.map((d) => ({
    sqlId: String(d.SQLID), sqlType: String(d.SQLTYPE).trim(), defn: d,
    descr: descrs.filter((r) => sqlKey(r) === sqlKey(d)), text: rows.sqlText.filter((r) => sqlKey(r) === sqlKey(d)), hash: hashes.filter((r) => sqlKey(r) === sqlKey(d))
  }));
  // PeopleCode: every program stored under this App Engine program.
  const pcText = await all(`SELECT ${PC_KEY_COLUMNS.join(', ')}, PROGSEQ, HASH_SIGNATURE, PCTEXT FROM PSPCMTXT WHERE OBJECTID1 = 66 AND OBJECTVALUE1 = :a${lock}`);
  const pcProg = await all(`SELECT ${PC_KEY_COLUMNS.join(', ')}, PROGSEQ, VERSION, NAMECOUNT, PROGLEN, PROGRUNLOC, PROGFLAGS, LICENSE_CODE,
                                   TO_CHAR(LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM, LASTUPDOPRID, PROGEXTENDS, PTTOOLSREL, PROGTXT
                              FROM PSPCMPROG WHERE OBJECTID1 = 66 AND OBJECTVALUE1 = :a${lock}`);
  const pcNames = await all(`SELECT ${PC_KEY_COLUMNS.join(', ')}, NAMENUM, RECNAME, REFNAME, PACKAGEROOT, QUALIFYPATH, APPCLASSMETHOD
                               FROM PSPCMNAME WHERE OBJECTID1 = 66 AND OBJECTVALUE1 = :a${lock}`);
  const peopleCode = new Map<string, StoredProgram>();
  const pcKey = (r: Row) => [1, 2, 3, 4, 5, 6, 7].map((n) => String(r[`OBJECTVALUE${n}`])).join('|');
  const entry = (r: Row): StoredProgram => {
    const k = pcKey(r);
    let p = peopleCode.get(k);
    if (!p) {
      p = { key: { objectIds: [1, 2, 3, 4, 5, 6, 7].map((n) => Number(r[`OBJECTID${n}`])), objectValues: k.split('|') }, text: [], program: [], names: [] };
      peopleCode.set(k, p);
    }
    return p;
  };
  for (const r of pcText) entry(r).text.push({ progseq: Number(r.PROGSEQ), text: String(r.PCTEXT ?? ''), hashSignature: String(r.HASH_SIGNATURE) });
  for (const r of pcProg) {
    entry(r).program.push({
      progseq: Number(r.PROGSEQ), version: Number(r.VERSION), namecount: Number(r.NAMECOUNT), proglen: Number(r.PROGLEN),
      progrunloc: Number(r.PROGRUNLOC), progflags: Number(r.PROGFLAGS), licenseCode: String(r.LICENSE_CODE),
      lastupddttm: String(r.LASTUPDDTTM), lastupdoprid: String(r.LASTUPDOPRID), progextends: String(r.PROGEXTENDS),
      pttoolsrel: String(r.PTTOOLSREL), bytes: Buffer.isBuffer(r.PROGTXT) ? r.PROGTXT : Buffer.alloc(0)
    });
  }
  for (const r of pcNames) {
    entry(r).names.push({
      namenum: Number(r.NAMENUM), recname: String(r.RECNAME), refname: String(r.REFNAME), packageroot: String(r.PACKAGEROOT),
      qualifypath: String(r.QUALIFYPATH), appclassmethod: String(r.APPCLASSMETHOD)
    });
  }
  return { exists: true, rows, sql, peopleCode, tombstones };
}

const isMissing = (s: StoredAppEngine | undefined) => !s || !s.exists;

/** The document of a stored program, with every PeopleCode action's source. */
export function documentOf(stored: StoredAppEngine): AeDocument {
  const sources = new Map([...stored.peopleCode].map(([k, p]) => [k, storedText(p)]));
  return documentFromRows(stored.rows, sources);
}

/**
 * The concurrency token: the program's, its sections', its SQL definitions'
 * and its PeopleCode's VERSIONs -- every App Designer save moves one of
 * them. 'absent' when there is no program.
 */
export function appEngineToken(stored: StoredAppEngine | undefined): string {
  if (isMissing(stored)) return 'absent';
  const s = stored!;
  const parts = [
    `P${Number(s.rows.program.VERSION)}`,
    ...s.rows.sections.map((r) => `S${String(r.AE_SECTION)}=${Number(r.VERSION)}`).sort(),
    ...s.sql.map((q) => `Q${q.sqlId}|${q.sqlType}=${Number(q.defn.VERSION)}`).sort(),
    ...[...s.peopleCode].map(([k, p]) => `C${k}=${p.program[0]?.version ?? 0}`).sort()
  ];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

export async function readCounters(c: Connection, forUpdate: boolean): Promise<{ version: Counters; lock: Partial<Counters> }> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('AEM', 'AES', 'SRM', 'PCM', 'PJM', 'SYS')${lock}`);
  const l = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME IN ('AEM', 'AES', 'SRM', 'PCM', 'PJM')${lock}`);
  const version = {} as Counters;
  for (const n of COUNTERS) {
    const r = v.find((x) => String(x.T).trim() === n);
    if (!r) throw new AeSaveRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
    version[n] = Number(r.V);
  }
  const lk: Partial<Counters> = {};
  for (const r of l) lk[String(r.T).trim() as CounterName] = Number(r.V);
  return { version, lock: lk };
}

// ---------------------------------------------------------------------------
// Planning

export interface Statement { sql: string; binds: Record<string, unknown>; expect?: number; what: string }

export interface AePlanSummary {
  /** Human-readable changes, for previews. */
  changes: string[];
  inserted: number;
  updated: number;
  deleted: number;
  sqlChanged: string[];
  peopleCodeChanged: string[];
  tombstones: string[];
}

export interface AePlan {
  name: string;
  /** Nothing to write. */
  empty: boolean;
  statements: Statement[];
  desired: AeDesiredRows;
  increments: Partial<Counters>;
  counters: Counters;
  stamp: { lastupddttm: string; operatorId: string };
  /** Sections whose VERSION becomes the new AES. */
  touchedSections: string[];
  definitionChanged: boolean;
  summary: AePlanSummary;
  /** PeopleCode the plan writes, for verification. */
  peopleCode: Map<string, StoredProgram>;
}

const DATE_COLUMNS = new Set(['EFFDT', 'ASOF_DT']);
const CLOB_COLUMNS = new Set(['DESCRLONG', 'SQLTEXT']);
const STAMP_COLUMNS = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);

/** A value as compared: null, a date as YYYY-MM-DD, anything else as text. */
function cmp(column: string, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (DATE_COLUMNS.has(column)) return dateKey(v);
  return String(v);
}

const TABLE_KEYS: Record<string, string[]> = {
  PSAEAPPLDEFN: ['AE_APPLID'],
  PSAEAPPLSTATE: ['AE_APPLID', 'AE_STATE_RECNAME'],
  PSAEAPPLTEMPTBL: ['AE_APPLID', 'RECNAME'],
  PSAEAPPLLANG: ['AE_APPLID', 'LANGUAGE_CD'],
  PSAESECTDEFN: ['AE_APPLID', 'AE_SECTION'],
  PSAESECTDTLDEFN: ['AE_APPLID', 'AE_SECTION', 'MARKET', 'DBTYPE', 'EFFDT'],
  PSAESTEPDEFN: ['AE_APPLID', 'AE_SECTION', 'MARKET', 'DBTYPE', 'EFFDT', 'AE_STEP'],
  PSAESTMTDEFN: ['AE_APPLID', 'AE_SECTION', 'MARKET', 'DBTYPE', 'EFFDT', 'AE_STEP', 'AE_STMT_TYPE'],
  PSAESTEPMSGDEFN: ['AE_APPLID', 'AE_SECTION', 'MARKET', 'DBTYPE', 'EFFDT', 'AE_STEP']
};

const keyOf = (table: string, row: Row) => TABLE_KEYS[table].map((k) => cmp(k, row[k])).join('\u0000');

/** A bind placeholder for a column value: dates through TO_DATE, CLOBs typed. */
function valueSql(column: string, bind: string, value: unknown, oracledb: DbTypes): { sql: string; bind: unknown } {
  if (DATE_COLUMNS.has(column)) return value === null || value === undefined ? { sql: 'NULL', bind: undefined } : { sql: `TO_DATE(:${bind}, 'YYYY-MM-DD')`, bind: dateKey(value) };
  if (CLOB_COLUMNS.has(column)) return value === null || value === undefined ? { sql: 'NULL', bind: undefined } : { sql: `:${bind}`, bind: { val: String(value), type: oracledb.CLOB } };
  return { sql: `:${bind}`, bind: value };
}

export function insertStatement(table: string, row: Row, oracledb: DbTypes): Statement {
  const cols = Object.keys(row);
  const binds: Record<string, unknown> = {};
  const values = cols.map((c, i) => {
    const v = valueSql(c, `b${i}`, row[c], oracledb);
    if (v.bind !== undefined) binds[`b${i}`] = v.bind;
    return v.sql;
  });
  return { sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values.join(', ')})`, binds, expect: 1, what: `Inserting ${table}` };
}

function whereKey(table: string, row: Row, binds: Record<string, unknown>, keyCols = TABLE_KEYS[table]): string {
  return keyCols.map((k, i) => {
    if (DATE_COLUMNS.has(k)) { binds[`k${i}`] = dateKey(row[k]); return `${k} = TO_DATE(:k${i}, 'YYYY-MM-DD')`; }
    binds[`k${i}`] = row[k]; return `${k} = :k${i}`;
  }).join(' AND ');
}

function updateStatement(table: string, key: Row, changes: Row, oracledb: DbTypes, stampSql = ''): Statement {
  const binds: Record<string, unknown> = {};
  const sets = Object.keys(changes).map((c, i) => {
    const v = valueSql(c, `u${i}`, changes[c], oracledb);
    if (v.bind !== undefined) binds[`u${i}`] = v.bind;
    return `${c} = ${v.sql}`;
  });
  if (stampSql) sets.push(stampSql);
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE ${whereKey(table, key, binds)}`, binds, expect: 1, what: `Updating ${table}` };
}

function deleteStatement(table: string, row: Row, keyCols?: string[]): Statement {
  const binds: Record<string, unknown> = {};
  return { sql: `DELETE FROM ${table} WHERE ${whereKey(table, row, binds, keyCols)}`, binds, expect: 1, what: `Deleting ${table}` };
}

interface TableDiff { inserted: Row[]; deleted: Row[]; updated: { key: Row; changes: Row }[] }

function diffTable(table: string, stored: Row[], desired: Row[]): TableDiff {
  const s = new Map(stored.map((r) => [keyOf(table, r), r]));
  const d = new Map(desired.map((r) => [keyOf(table, r), r]));
  const out: TableDiff = { inserted: [], deleted: [], updated: [] };
  for (const [k, row] of d) {
    const old = s.get(k);
    if (!old) { out.inserted.push(row); continue; }
    const changes: Row = {};
    for (const col of Object.keys(row)) {
      if (STAMP_COLUMNS.has(col) || TABLE_KEYS[table].includes(col)) continue;
      if (cmp(col, row[col]) !== cmp(col, old[col])) changes[col] = row[col];
    }
    if (Object.keys(changes).length) out.updated.push({ key: row, changes });
  }
  for (const [k, row] of s) if (!d.has(k)) out.deleted.push(row);
  return out;
}

export interface PlanOptions {
  operatorId: string;
  /** PSSTATUS.TOOLSREL, for compiling PeopleCode. */
  toolsRelease: string;
  /** One database timestamp for every stamp of the save (YYYY-MM-DDTHH24:MI:SS.FF6). */
  lastupddttm: string;
  counters: Counters;
  oracledb: DbTypes;
}

const AE_TARGET: CompileTarget = { applicationClass: false, recordName: '', fieldName: '' };

/**
 * The statements that turn the stored program (undefined: none, a create)
 * into the document, with the counters' moves (docs/APP_ENGINE.md
 * "Counters and stamps").
 */
export function planAppEngineSave(stored: StoredAppEngine | undefined, doc: AeDocument, opts: PlanOptions): AePlan {
  const creating = isMissing(stored);
  const desired = rowsFromDocument(doc);
  const tombstones = stored?.tombstones ?? { program: [], sections: [], sql: [], peopleCode: [] };
  const name = doc.name;
  const oracledb = opts.oracledb;
  const statements: Statement[] = [];
  const changes: string[] = [];
  const counts = { inserted: 0, updated: 0, deleted: 0 };
  const sqlChanged: string[] = [];
  const peopleCodeChanged: string[] = [];
  const tombstoneNotes: string[] = [];
  if (!creating && String(stored!.rows.program.AE_APPLID).trim() !== name) throw new AeSaveRefusedError('The stored program is another one; refusing.');

  const s = creating ? undefined : stored!;
  // A copy or rename of another program: its SQL is moved, not created [ae13, ae14].
  const copied = doc.copiedFrom !== undefined;
  // Columns App Designer sets at a definition save [ap01]: ASOF_DT goes from NULL to 1900-01-01.
  if (!creating && desired.program.ASOF_DT === null) desired.program.ASOF_DT = '1900-01-01';

  // ---- PSAE tables
  const tables: [string, Row[], Row[]][] = [
    ['PSAEAPPLSTATE', s?.rows.states ?? [], desired.states],
    ['PSAEAPPLTEMPTBL', s?.rows.tempTables ?? [], desired.tempTables],
    ['PSAEAPPLLANG', s?.rows.languages ?? [], desired.languages],
    ['PSAESECTDEFN', s?.rows.sections ?? [], desired.sections],
    ['PSAESECTDTLDEFN', s?.rows.variants ?? [], desired.variants],
    ['PSAESTEPDEFN', s?.rows.steps ?? [], desired.steps],
    ['PSAESTMTDEFN', s?.rows.actions ?? [], desired.actions],
    ['PSAESTEPMSGDEFN', s?.rows.messages ?? [], desired.messages]
  ];
  const diffs = new Map(tables.map(([t, a, b]) => [t, diffTable(t, a, b)]));
  const programDiff = creating ? undefined : diffTable('PSAEAPPLDEFN', [s!.rows.program], [desired.program]);
  const sectionOf = (r: Row) => String(r.AE_SECTION ?? '');
  const touched = new Set<string>();
  let definitionChanged = creating || (programDiff?.updated.length ?? 0) > 0;
  for (const [table, d] of diffs) {
    if (!d.inserted.length && !d.updated.length && !d.deleted.length) continue;
    definitionChanged = true;
    if (table.startsWith('PSAESECT') || table.startsWith('PSAESTEP') || table === 'PSAESTMTDEFN') {
      for (const r of [...d.inserted, ...d.deleted, ...d.updated.map((u) => u.key)]) touched.add(sectionOf(r));
    }
  }
  if (creating) for (const r of desired.sections) touched.add(String(r.AE_SECTION));

  // Renames and re-keys: App Designer moves AES and SYS by two when SQL or PeopleCode moves with them
  // [ar01, ae11, ae18], by one otherwise [as02-as04, ap05]; a section renamed in its name box moves PJM [ae11].
  let contentMoved = false;
  let sectionRenamed = false;
  for (const sec of doc.sections) {
    const renamed = !!sec.origin && sec.origin !== sec.name;
    if (renamed) sectionRenamed = true;
    for (const v of sec.variants) {
      const rekeyed = !!v.origin && (v.origin.market !== v.market || v.origin.dbType !== v.dbType || v.origin.effdt !== v.effdt);
      for (const st of v.steps) {
        const moved = renamed || rekeyed || (!!st.origin && st.origin !== st.name);
        if (moved && st.actions.some((a) => a.origin && ((a.text ?? '') !== '' || (a.peopleCode ?? '').trim() !== ''))) contentMoved = true;
      }
    }
  }
  // Application Library's MAIN rename moves SRM and PCM, not PJM [ap05].
  const libraryToggled = !creating && String(s!.rows.program.AE_APPLLIBRARY).trim() !== String(desired.program.AE_APPLLIBRARY);

  // ---- SQL definitions
  const storedSql = new Map((s?.sql ?? []).map((q) => [`${q.sqlId}|${q.sqlType}`, q]));
  // Only SQL an action named when the program was read may be deleted; orphans are kept.
  const knownSql = new Set((s?.rows.actions ?? []).filter((a) => String(a.SQLID ?? '').trim()).map((a) => `${String(a.SQLID)}|${['X'].includes(String(a.AE_STMT_TYPE).trim()) ? '6' : '1'}`));
  const desiredSql = new Map<string, { sqlId: string; sqlType: string; origins: Set<string>; variants: AeDesiredRows['texts'] }>();
  for (const t of desired.texts) {
    const k = `${t.sqlId}|${t.sqlType}`;
    const g = desiredSql.get(k) ?? { sqlId: t.sqlId, sqlType: t.sqlType, origins: new Set<string>(), variants: [] };
    if (t.origin) g.origins.add(`${t.origin}|${t.sqlType}`);
    g.variants.push(t);
    desiredSql.set(k, g);
  }
  const sqlStatements: Statement[] = [];
  const sqlTombstones: Statement[] = [];
  let srmMoves = false;
  const variantKey = (r: { MARKET?: unknown; DBTYPE?: unknown; EFFDT?: unknown; market?: string; dbType?: string; effdt?: string }) =>
    `${String(r.market ?? r.MARKET).trim()}|${String(r.dbType ?? r.DBTYPE ?? ' ') || ' '}|${dateKey(r.effdt ?? r.EFFDT)}`;
  const storedVariantText = (q: StoredSql | undefined) => {
    const m = new Map<string, string>();
    for (const r of [...(q?.text ?? [])].sort((a, b) => Number(a.SEQNUM) - Number(b.SEQNUM))) m.set(variantKey(r), (m.get(variantKey(r)) ?? '') + String(r.SQLTEXT ?? ''));
    return m;
  };
  const textRows = (q: { sqlId: string; sqlType: string }, v: { market: string; dbType: string; effdt: string }, text: string) =>
    splitSqlText(text).map((chunk, seq) => insertStatement('PSSQLTEXTDEFN', {
      SQLID: q.sqlId, SQLTYPE: q.sqlType, MARKET: v.market, DBTYPE: v.dbType, EFFDT: v.effdt, SEQNUM: seq, SQLTEXT: chunk
    }, oracledb));
  const hashRow = (q: { sqlId: string; sqlType: string }, v: { market: string; dbType: string; effdt: string }, text: string) =>
    insertStatement('PSSQLHASH', { SQLID: q.sqlId, SQLTYPE: q.sqlType, MARKET: v.market, DBTYPE: v.dbType, EFFDT: v.effdt, HASH_SIGNATURE: predictSourceSignature(text) }, oracledb);
  const variantRowsDelete = (table: string, q: StoredSql, r: Row) => deleteStatement(table, r, table === 'PSSQLTEXTDEFN'
    ? ['SQLID', 'SQLTYPE', 'MARKET', 'DBTYPE', 'EFFDT', 'SEQNUM'] : ['SQLID', 'SQLTYPE', 'MARKET', 'DBTYPE', 'EFFDT']);
  const sqlStamp = `VERSION = :srm, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op`;

  for (const [k, g] of desiredSql) {
    const old = storedSql.get(k);
    const oldText = storedVariantText(old);
    // The document holds text as it is stored (editors store edits as App Designer does: aeDocument.ts
    // storedActionText); it is written as it is -- re-flattening stored text would change it.
    const finalText = (v: AeDesiredRows['texts'][number]) => v.text;
    if (!old) {
      // New, or moved from another SQLID (a step or section renamed): ENABLEEFFDT Y when created, N when moved [aa02, ar01].
      const moved = copied || [...g.origins].some((o) => o !== k && storedSql.has(o));
      sqlStatements.push(insertStatement('PSSQLDEFN', {
        SQLID: g.sqlId, SQLTYPE: g.sqlType, VERSION: 0, LASTUPDOPRID: opts.operatorId, ENABLEEFFDT: moved ? 'N' : 'Y', OBJECTOWNERID: ' '
      }, oracledb));
      for (const v of g.variants) {
        const text = finalText(v);
        if (!text) continue;
        sqlStatements.push(insertStatement('PSSQLDESCR', { SQLID: g.sqlId, SQLTYPE: g.sqlType, MARKET: v.market, DBTYPE: v.dbType, EFFDT: v.effdt, DESCR: ' ', DESCRLONG: null }, oracledb));
        sqlStatements.push(...textRows(g, v, text), hashRow(g, v, text));
      }
      // Its tombstone goes [ae17].
      for (const t of tombstones.sql) if (`${String(t.SQLID)}|${String(t.SQLTYPE).trim()}` === k) {
        sqlStatements.push({ ...deleteStatement('PSSQLDEL', t, ['SQLID', 'SQLTYPE', 'VERSION']), what: 'Deleting PSSQLDEL' });
      }
      sqlChanged.push(`${g.sqlId.trim()} ${moved ? 'moved' : 'created'}`);
      srmMoves = true;
      continue;
    }
    let changed = false;
    const seen = new Set<string>();
    for (const v of g.variants) {
      const vk = variantKey(v);
      seen.add(vk);
      const text = finalText(v);
      const was = oldText.get(vk);
      if (was === text) continue;
      changed = true;
      if (was === undefined) {
        sqlStatements.push(insertStatement('PSSQLDESCR', { SQLID: g.sqlId, SQLTYPE: g.sqlType, MARKET: v.market, DBTYPE: v.dbType, EFFDT: v.effdt, DESCR: ' ', DESCRLONG: null }, oracledb));
      } else {
        // A text changed: the section is restamped [aa03].
        touched.add(v.section);
        for (const r of old.text.filter((x) => variantKey(x) === vk)) sqlStatements.push(variantRowsDelete('PSSQLTEXTDEFN', old, r));
        for (const r of old.hash.filter((x) => variantKey(x) === vk)) sqlStatements.push(variantRowsDelete('PSSQLHASH', old, r));
      }
      sqlStatements.push(...textRows(g, v, text), hashRow(g, v, text));
    }
    for (const vk of oldText.keys()) {
      if (seen.has(vk)) continue;
      changed = true;
      for (const table of ['PSSQLTEXTDEFN', 'PSSQLHASH', 'PSSQLDESCR'] as const) {
        const rows = table === 'PSSQLTEXTDEFN' ? old.text : table === 'PSSQLHASH' ? old.hash : old.descr;
        for (const r of rows.filter((x) => variantKey(x) === vk)) sqlStatements.push(variantRowsDelete(table, old, r));
      }
    }
    if (changed) {
      sqlStatements.push({ sql: `UPDATE PSSQLDEFN SET ${sqlStamp} WHERE SQLID = :id AND SQLTYPE = :t`, binds: { id: g.sqlId, t: g.sqlType }, expect: 1, what: 'Updating PSSQLDEFN' });
      sqlChanged.push(`${g.sqlId.trim()} changed`);
      srmMoves = true;
    }
  }
  for (const [k, old] of storedSql) {
    if (desiredSql.has(k) || !knownSql.has(k)) continue;
    for (const r of old.text) sqlStatements.push(variantRowsDelete('PSSQLTEXTDEFN', old, r));
    for (const r of old.hash) sqlStatements.push(variantRowsDelete('PSSQLHASH', old, r));
    for (const r of old.descr) sqlStatements.push(variantRowsDelete('PSSQLDESCR', old, r));
    sqlStatements.push({ ...deleteStatement('PSSQLDEFN', old.defn, ['SQLID', 'SQLTYPE']), what: 'Deleting PSSQLDEFN' });
    sqlTombstones.push({ sql: `INSERT INTO PSSQLDEL (SQLID, SQLTYPE, VERSION) VALUES (:id, :t, :srm)`, binds: { id: old.sqlId, t: old.sqlType }, expect: 1, what: 'Inserting PSSQLDEL' });
    tombstoneNotes.push(`PSSQLDEL ${old.sqlId.trim()}`);
    sqlChanged.push(`${old.sqlId.trim()} deleted`);
    srmMoves = true;
  }

  // ---- PeopleCode
  const storedPc = s?.peopleCode ?? new Map<string, StoredProgram>();
  // Only PeopleCode a stored PeopleCode action owned may be deleted; orphans (87 HRDMO programs have some) are kept.
  const knownPc = new Set<string>();
  for (const a of (s?.rows.actions ?? []).filter((x) => String(x.AE_STMT_TYPE).trim() === 'P')) {
    const dt = String(a.DBTYPE ?? ' ').trim() || ' ';
    const parts = peopleCodeKey(name, String(a.AE_SECTION), { market: String(a.MARKET).trim(), dbType: dt, effdt: dateKey(a.EFFDT) }, String(a.AE_STEP));
    if (parts) knownPc.add(parts.join('|'));
  }
  const pcStatements: Statement[] = [];
  const pcWritten = new Map<string, StoredProgram>();
  let pcmMoves = false;
  const desiredPc = new Map(desired.peopleCode.map((p) => [p.parts.join('|'), p]));
  for (const [k, p] of desiredPc) {
    const source = prepareSourceForSave(p.source);
    const old = storedPc.get(k);
    if (old && old.program.length && storedText(old) === source) continue;
    const origin = p.origin ? storedPc.get(p.origin.join('|')) : undefined;
    const key = { objectIds: PC_IDS, objectValues: p.parts };
    if (old && old.program.length) checkStoredProgram(old, AE_TARGET, opts.toolsRelease);
    let expected: StoredProgram;
    if (!old && origin && origin.program.length && storedText(origin) === source) {
      // Moved unchanged (a step, section or variant re-keyed): the stored rows under the new key [ar01].
      expected = {
        key, text: origin.text.map((r) => ({ ...r })), names: origin.names.map((r) => ({ ...r })),
        program: origin.program.map((r) => ({ ...r, version: 0, lastupddttm: opts.lastupddttm, lastupdoprid: opts.operatorId }))
      };
      peopleCodeChanged.push(`${p.parts.slice(1, 7).join('.')} moved`);
    } else {
      const plan = planProgram(source, compileForSave(source, AE_TARGET, opts.toolsRelease));
      expected = expectedProgram(key, plan, { version: 0, lastupddttm: opts.lastupddttm, operatorId: opts.operatorId });
      peopleCodeChanged.push(`${p.parts.slice(1, 7).join('.')} ${old ? 'changed' : 'created'}`);
    }
    pcWritten.set(k, expected);
    pcStatements.push(...deletePeopleCode(k, old), ...insertPeopleCode(expected, oracledb));
    for (const t of tombstones.peopleCode) {
      if ([1, 2, 3, 4, 5, 6, 7].map((n) => String(t[`OBJECTVALUE${n}`])).join('|') === k) pcStatements.push(deletePcTombstone(t));
    }
    pcmMoves = true;
  }
  for (const [k, old] of storedPc) {
    if (desiredPc.has(k) || !knownPc.has(k)) continue;
    pcStatements.push(...deletePeopleCode(k, old));
    pcStatements.push({
      sql: `INSERT INTO PSPCMPROGDEL (${PC_KEY_COLUMNS.join(', ')}, VERSION) VALUES (${[1, 2, 3, 4, 5, 6, 7].map((n) => `:i${n}, :v${n}`).join(', ')}, :pcm)`,
      binds: Object.fromEntries([...old.key.objectIds.map((id, i) => [`i${i + 1}`, Number(id)]), ...old.key.objectValues.map((v, i) => [`v${i + 1}`, v])]),
      expect: 1, what: 'Inserting PSPCMPROGDEL'
    });
    tombstoneNotes.push(`PSPCMPROGDEL ${k.split('|').slice(1, 6).join('.')}`);
    peopleCodeChanged.push(`${k.split('|').slice(1, 7).join('.')} deleted`);
    pcmMoves = true;
  }

  // ---- counters
  const touchedSections = desired.sections.map((r) => String(r.AE_SECTION)).filter((n) => touched.has(n));
  const increments: Partial<Counters> = {};
  if (definitionChanged) increments.AEM = 1;
  if (touchedSections.length || (s?.rows.sections ?? []).some((r) => !desired.sections.some((d) => d.AE_SECTION === r.AE_SECTION))) {
    increments.AES = contentMoved ? 2 : 1;
  }
  if (srmMoves || (libraryToggled && sectionRenamed)) increments.SRM = 1;
  if (pcmMoves || (libraryToggled && sectionRenamed)) increments.PCM = 1;
  if (sectionRenamed && !libraryToggled) increments.PJM = 1;
  const anything = definitionChanged || srmMoves || pcmMoves || touchedSections.length > 0;
  if (anything) increments.SYS = contentMoved ? 2 : 1;
  const next = { ...opts.counters };
  for (const n of COUNTERS) next[n] += increments[n] ?? 0;

  // ---- PSAE statements, children deleted first, parents inserted first
  const stamp = `LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op`;
  const deleteOrder = ['PSAESTEPMSGDEFN', 'PSAESTMTDEFN', 'PSAESTEPDEFN', 'PSAESECTDTLDEFN', 'PSAESECTDEFN', 'PSAEAPPLLANG', 'PSAEAPPLTEMPTBL', 'PSAEAPPLSTATE'];
  for (const table of deleteOrder) {
    for (const r of diffs.get(table)!.deleted) {
      statements.push(deleteStatement(table, r));
      counts.deleted++;
    }
  }
  if (creating) {
    statements.push({ ...insertStatement('PSAEAPPLDEFN', { ...desired.program, VERSION: 0, LASTUPDOPRID: opts.operatorId }, oracledb), what: 'Inserting PSAEAPPLDEFN' });
    for (const t of tombstones.program) statements.push(deleteStatement('PSAEAPPLDEL', t, ['AE_APPLID', 'VERSION']));
    changes.push(`create program ${name}`);
  } else if (programDiff!.updated.length || definitionChanged) {
    const changed = programDiff!.updated[0]?.changes ?? {};
    statements.push(updateStatement('PSAEAPPLDEFN', desired.program, changed, oracledb, `VERSION = :aem, ${stamp}`));
    for (const col of Object.keys(changed)) changes.push(`program ${col}`);
  }
  for (const table of [...deleteOrder].reverse()) {
    const d = diffs.get(table)!;
    for (const r of d.inserted) {
      const row = table === 'PSAESECTDEFN' ? { ...r, VERSION: 0, LASTUPDOPRID: opts.operatorId } : r;
      statements.push(insertStatement(table, row, oracledb));
      counts.inserted++;
    }
    for (const u of d.updated) {
      statements.push(updateStatement(table, u.key, u.changes, oracledb));
      counts.updated++;
      changes.push(`${table} ${TABLE_KEYS[table].slice(1).map((k) => cmp(k, u.key[k])).join('.')}: ${Object.keys(u.changes).join(', ')}`);
    }
    if (d.inserted.length) changes.push(`${table}: ${d.inserted.length} inserted`);
    if (d.deleted.length) changes.push(`${table}: ${d.deleted.length} deleted`);
  }
  // Section tombstones and their removal [ae11, ae16, ap19].
  const storedNames = new Set((s?.rows.sections ?? []).map((r) => String(r.AE_SECTION)));
  const desiredNames = new Set(desired.sections.map((r) => String(r.AE_SECTION)));
  for (const n of storedNames) {
    if (desiredNames.has(n)) continue;
    statements.push({ sql: `INSERT INTO PSAESECTDEL (AE_APPLID, AE_SECTION, VERSION) VALUES (:a, :s, :aesdel)`, binds: { a: name, s: n }, expect: 1, what: 'Inserting PSAESECTDEL' });
    tombstoneNotes.push(`PSAESECTDEL ${n}`);
  }
  for (const t of tombstones.sections) {
    if (desiredNames.has(String(t.AE_SECTION)) && !storedNames.has(String(t.AE_SECTION))) statements.push(deleteStatement('PSAESECTDEL', t, ['AE_APPLID', 'AE_SECTION', 'VERSION']));
  }
  // Touched sections take the new AES and the save's stamp.
  for (const n of touchedSections) {
    statements.push({ sql: `UPDATE PSAESECTDEFN SET VERSION = :aes, ${stamp} WHERE AE_APPLID = :a AND AE_SECTION = :s`, binds: { a: name, s: n }, expect: 1, what: 'Stamping PSAESECTDEFN' });
  }
  statements.push(...sqlStatements, ...sqlTombstones, ...pcStatements);

  // Counter binds on every statement that names them.
  const counterBinds: Record<string, unknown> = {
    aem: next.AEM, aes: next.AES, aesdel: opts.counters.AES + 1, srm: next.SRM, pcm: next.PCM, ts: opts.lastupddttm, op: opts.operatorId
  };
  for (const st of statements) {
    for (const [b, v] of Object.entries(counterBinds)) if (new RegExp(`:${b}\\b`).test(st.sql)) st.binds[b] = v;
  }
  // Inserted rows that carry a VERSION placeholder 0: the counter they belong to.
  for (const st of statements) {
    if (/^INSERT INTO PSAESECTDEFN /.test(st.sql)) setVersion(st, next.AES, opts.lastupddttm);
    if (/^INSERT INTO PSAEAPPLDEFN /.test(st.sql)) setVersion(st, next.AEM, opts.lastupddttm);
    if (/^INSERT INTO PSSQLDEFN /.test(st.sql)) setVersion(st, next.SRM, opts.lastupddttm);
  }
  for (const p of pcWritten.values()) for (const r of p.program) r.version = next.PCM;
  for (const st of pcStatements) if (/^INSERT INTO PSPCMPROG /.test(st.sql)) st.binds.version = next.PCM;

  // Counters last.
  for (const n of COUNTERS) {
    if (!increments[n]) continue;
    statements.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: next[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
    if (n !== 'SYS') statements.push({ sql: `UPDATE PSLOCK SET VERSION = VERSION + :d WHERE OBJECTTYPENAME = '${n}'`, binds: { d: increments[n] }, expect: 1, what: `Updating PSLOCK ${n}` });
  }

  return {
    name, empty: !anything, statements, desired, increments, counters: next,
    stamp: { lastupddttm: opts.lastupddttm, operatorId: opts.operatorId }, touchedSections, definitionChanged,
    summary: { changes, ...counts, sqlChanged, peopleCodeChanged, tombstones: tombstoneNotes },
    peopleCode: pcWritten
  };
}

/** Gives an inserted row's VERSION / LASTUPDDTTM their values (inserted with placeholders). */
function setVersion(st: Statement, version: number, ts: string): void {
  const cols = /\(([^)]*)\) VALUES/.exec(st.sql)![1].split(', ');
  const vi = cols.indexOf('VERSION');
  if (vi >= 0) st.binds[`b${vi}`] = version;
  if (!cols.includes('LASTUPDDTTM')) {
    st.sql = st.sql.replace(/\) VALUES \(/, ', LASTUPDDTTM) VALUES (').replace(/\)$/, `, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}))`);
    st.binds.ts = ts;
  }
}

export function pcBinds(objectIds: readonly number[], values: readonly string[]): Record<string, unknown> {
  return Object.fromEntries([...objectIds.map((id, i) => [`i${i + 1}`, Number(id)]), ...values.map((v, i) => [`v${i + 1}`, v])]);
}
export const PC_EXACT = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n} = :i${n} AND OBJECTVALUE${n} = :v${n}`).join(' AND ');

export function deletePeopleCode(_k: string, old: StoredProgram | undefined): Statement[] {
  if (!old) return [];
  const b = pcBinds(old.key.objectIds, old.key.objectValues);
  return [
    { sql: `DELETE FROM PSPCMTXT WHERE ${PC_EXACT}`, binds: { ...b }, expect: old.text.length, what: 'Deleting PSPCMTXT' },
    { sql: `DELETE FROM PSPCMPROG WHERE ${PC_EXACT}`, binds: { ...b }, expect: old.program.length, what: 'Deleting PSPCMPROG' },
    { sql: `DELETE FROM PSPCMNAME WHERE ${PC_EXACT}`, binds: { ...b }, expect: old.names.length, what: 'Deleting PSPCMNAME' }
  ];
}

export function deletePcTombstone(t: Row): Statement {
  const b = pcBinds([1, 2, 3, 4, 5, 6, 7].map((n) => Number(t[`OBJECTID${n}`])), [1, 2, 3, 4, 5, 6, 7].map((n) => String(t[`OBJECTVALUE${n}`])));
  return { sql: `DELETE FROM PSPCMPROGDEL WHERE ${PC_EXACT} AND VERSION = :dv`, binds: { ...b, dv: Number(t.VERSION) }, expect: 1, what: 'Deleting PSPCMPROGDEL' };
}

export function insertPeopleCode(p: StoredProgram, oracledb: DbTypes): Statement[] {
  const keyCols = PC_KEY_COLUMNS.join(', ');
  const keyVals = [1, 2, 3, 4, 5, 6, 7].map((n) => `:i${n}, :v${n}`).join(', ');
  const b = pcBinds(p.key.objectIds, p.key.objectValues);
  return [
    ...p.text.map((r) => ({
      sql: `INSERT INTO PSPCMTXT (${keyCols}, PROGSEQ, HASH_SIGNATURE, PCTEXT) VALUES (${keyVals}, :progseq, :sig, :text)`,
      binds: { ...b, progseq: r.progseq, sig: r.hashSignature, text: { val: r.text, type: oracledb.CLOB } }, expect: 1, what: 'Inserting PSPCMTXT'
    })),
    ...p.program.map((r) => ({
      sql: `INSERT INTO PSPCMPROG (${keyCols}, PROGSEQ, VERSION, NAMECOUNT, PROGLEN, PROGRUNLOC, PROGFLAGS, LICENSE_CODE, LASTUPDDTTM, LASTUPDOPRID, PROGEXTENDS, PTTOOLSREL, PROGTXT)
            VALUES (${keyVals}, :progseq, :version, :namecount, :proglen, :progrunloc, :progflags, :license, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :oprid, :progextends, :pttoolsrel, :bytes)`,
      binds: {
        ...b, progseq: r.progseq, version: r.version, namecount: r.namecount, proglen: r.proglen, progrunloc: r.progrunloc, progflags: r.progflags,
        license: r.licenseCode, ts: r.lastupddttm, oprid: r.lastupdoprid, progextends: r.progextends, pttoolsrel: r.pttoolsrel, bytes: { val: r.bytes, type: oracledb.BLOB }
      },
      expect: 1, what: 'Inserting PSPCMPROG'
    })),
    ...p.names.map((r) => ({
      sql: `INSERT INTO PSPCMNAME (${keyCols}, NAMENUM, RECNAME, REFNAME, PACKAGEROOT, QUALIFYPATH, APPCLASSMETHOD) VALUES (${keyVals}, :namenum, :recname, :refname, :packageroot, :qualifypath, :appclassmethod)`,
      binds: { ...b, ...r }, expect: 1, what: 'Inserting PSPCMNAME'
    }))
  ];
}

// ---------------------------------------------------------------------------
// Saving

export interface AeSaveRequest {
  doc: AeDocument;
  /** appEngineToken() when the document was read ('absent' to create). */
  openedToken: string;
  operatorId: string;
  /** Plan only: return the plan, write nothing. */
  dryRun?: boolean;
  /** Execute and verify the existing writer inside rollback; internal review projection only. */
  captureSnapshots?: boolean;
  expectedSnapshotToken?: string;
}

export interface AeSaveResult {
  plan: AePlan;
  /** The token of what is stored now. */
  token: string;
  /** False on a dry run or an empty plan. */
  written: boolean;
  snapshots?: StructuredPreview;
}

/** Runs the statements; each must touch the rows it expects. */
export async function run(c: Connection, statements: Statement[]): Promise<void> {
  for (const st of statements) {
    if (st.expect === undefined) await c.execute(st.sql, st.binds);
    else await expectRows(c, st.sql, st.binds, st.expect, st.what);
  }
}

/**
 * Saves the document in one transaction (see the module comment). Refused
 * unless the operator exists, the program is in the write scope, the
 * stored program is the one the document was read from, and the document
 * has no validation error.
 */
export async function saveAppEngine(c: Connection, oracledb: DbTypes, request: AeSaveRequest): Promise<AeSaveResult> {
  try {
    if (request.captureSnapshots && !request.dryRun) throw new AeSaveRefusedError('Snapshots require rollback preview.');
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new AeSaveRefusedError(operatorError);
    const scope = writeScopeRefusal(request.doc.name);
    if (scope) throw new AeSaveRefusedError(scope);
    const problems = validateAppEngine(request.doc).filter((d) => d.severity === 'error');
    if (problems.length) throw new AeSaveRefusedError(`The program has errors: ${problems.slice(0, 5).map((p) => `${p.path}: ${p.message}`).join('; ')}`);
    if (!(await operatorExists(c, request.operatorId))) throw new AeSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);

    const stored = await readStoredAppEngine(c, oracledb, request.doc.name, true);
    const before = request.captureSnapshots || request.expectedSnapshotToken ? await readStructuredSnapshot(c, oracledb, 'ae', request.doc.name) : undefined;
    if (request.expectedSnapshotToken && before!.token !== request.expectedSnapshotToken) throw new AeSaveRefusedError('Native Application Engine snapshot changed before writer.');
    const token = appEngineToken(stored);
    if (token !== request.openedToken) {
      throw new AeSaveRefusedError(request.openedToken === 'absent'
        ? `An App Engine program named ${request.doc.name} already exists.`
        : `${request.doc.name} was changed in the database since it was opened (another save, possibly in App Designer). Reopen it and reapply your edit.`);
    }
    const [{ R: toolsRelease }] = await select<{ R: string }>(c, `SELECT TOOLSREL AS R FROM PSSTATUS`);
    const counters = await readCounters(c, true);
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    // A missing program's tombstones still go when its name is created again.
    const plan = planAppEngineSave(stored, request.doc, {
      operatorId: request.operatorId, toolsRelease: String(toolsRelease).trim(), lastupddttm, counters: counters.version, oracledb
    });
    if (request.dryRun && !request.captureSnapshots || plan.empty) {
      await c.rollback();
      return { plan, token, written: false, ...(request.captureSnapshots ? { snapshots: { schema: 'structured-preview/1', before: before!, after: before! } as StructuredPreview } : {}) };
    }
    await run(c, plan.statements);
    await verifyAppEngine(c, oracledb, plan);
    if (request.captureSnapshots) {
      const after = await readStructuredSnapshot(c, oracledb, 'ae', request.doc.name);
      await c.rollback();
      return { plan, token, written: false, snapshots: { schema: 'structured-preview/1', before: before!, after } };
    }
    await c.commit();
    return { plan, token: appEngineToken(await readStoredAppEngine(c, oracledb, request.doc.name, false)), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/**
 * Proves the stored program is the plan's: its rows read back into the
 * document's rows (stamps aside), the program and touched sections carry
 * the new versions, the PeopleCode written is stored column for column, and
 * the counters are the plan's.
 */
export async function verifyAppEngine(c: Connection, oracledb: DbTypes, plan: AePlan): Promise<void> {
  const problems: string[] = [];
  const stored = await readStoredAppEngine(c, oracledb, plan.name, false);
  if (isMissing(stored)) throw new AeSaveRefusedError(`After the save there is no program ${plan.name}.`);
  const actual = rowsFromDocument(documentOf(stored!));
  const want = plan.desired;
  const norm = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !STAMP_COLUMNS.has(k)).sort()
    .map((k) => [k, cmp(k, r[k])]))).sort();
  for (const k of ['states', 'tempTables', 'languages', 'sections', 'variants', 'steps', 'actions', 'messages'] as const) {
    if (JSON.stringify(norm(actual[k])) !== JSON.stringify(norm(want[k]))) problems.push(`${k} differ`);
  }
  if (JSON.stringify(norm([actual.program])) !== JSON.stringify(norm([want.program]))) problems.push('the program row differs');
  const texts = (t: AeDesiredRows['texts']) => t.map((x) => `${x.sqlId}|${x.sqlType}|${x.market}|${x.dbType}|${x.effdt}`).sort();
  if (JSON.stringify(texts(actual.texts)) !== JSON.stringify(texts(want.texts))) problems.push('the SQL texts differ');
  if (plan.definitionChanged && Number(stored!.rows.program.VERSION) !== plan.counters.AEM) problems.push(`program VERSION ${stored!.rows.program.VERSION}, ${plan.counters.AEM} expected`);
  for (const n of plan.touchedSections) {
    const r = stored!.rows.sections.find((x) => String(x.AE_SECTION) === n);
    if (Number(r?.VERSION) !== plan.counters.AES) problems.push(`section ${n} VERSION ${r?.VERSION}, ${plan.counters.AES} expected`);
  }
  for (const [k, p] of plan.peopleCode) {
    const got = stored!.peopleCode.get(k);
    if (!got || storedText(got) !== storedText(p) || got.program.length !== p.program.length ||
      got.program.some((r, i) => !r.bytes.equals(p.program[i].bytes) || r.version !== plan.counters.PCM)) problems.push(`PeopleCode ${k} is not what was written`);
  }
  const now = await readCounters(c, false);
  for (const n of COUNTERS) if (now.version[n] !== plan.counters[n]) problems.push(`PSVERSION ${n} ${now.version[n]}, ${plan.counters[n]} expected`);
  if (problems.length) throw new AeSaveRefusedError(`The written rows are not the planned ones (${problems.slice(0, 6).join('; ')}).`);
}

/** After COMMIT, on another connection: the program is the plan's. */
export async function verifyAppEngineSave(c: Connection, oracledb: DbTypes, result: AeSaveResult): Promise<void> {
  if (!result.written) return;
  const stored = await readStoredAppEngine(c, oracledb, result.plan.name, false);
  if (appEngineToken(stored) !== result.token) throw new AeSaveRefusedError('After COMMIT the program is not what was written.');
}

// ---------------------------------------------------------------------------
// Delete and rename

/**
 * Deletes a program as App Designer's File > Delete does [ae15]: every row,
 * its SQL and PeopleCode, with tombstones; AEM, AES, SRM, PCM + 2, SYS + 1.
 */
export async function deleteAppEngine(c: Connection, oracledb: DbTypes, name: string, openedToken: string, operatorId: string): Promise<{ counters: Counters }> {
  try {
    const operatorError = validateOperatorId(operatorId);
    if (operatorError) throw new AeSaveRefusedError(operatorError);
    const scope = writeScopeRefusal(name);
    if (scope) throw new AeSaveRefusedError(scope);
    const stored = await readStoredAppEngine(c, oracledb, name, true);
    if (isMissing(stored)) throw new AeSaveRefusedError(`There is no App Engine program ${name}.`);
    if (appEngineToken(stored) !== openedToken) throw new AeSaveRefusedError(`${name} was changed in the database since it was opened.`);
    const s = stored!;
    const { version } = await readCounters(c, true);
    const next = { ...version, AEM: version.AEM + 2, AES: version.AES + 2, SYS: version.SYS + 1 } as Counters;
    if (s.sql.length) next.SRM += 2;
    if (s.peopleCode.size) next.PCM += 2;
    const st: Statement[] = [];
    const a = { a: name };
    for (const t of ['PSAESTEPMSGDEFN', 'PSAESTMTDEFN', 'PSAESTEPDEFN', 'PSAESECTDTLDEFN', 'PSAESECTDEFN', 'PSAEAPPLLANG', 'PSAEAPPLTEMPTBL', 'PSAEAPPLSTATE', 'PSAEAPPLDEFN']) {
      st.push({ sql: `DELETE FROM ${t} WHERE AE_APPLID = :a`, binds: a, what: `Deleting ${t}` });
    }
    for (const q of s.sql) {
      for (const t of ['PSSQLTEXTDEFN', 'PSSQLHASH', 'PSSQLDESCR', 'PSSQLDEFN']) st.push({ sql: `DELETE FROM ${t} WHERE SQLID = :id AND SQLTYPE = :t`, binds: { id: q.sqlId, t: q.sqlType }, what: `Deleting ${t}` });
      st.push({ sql: `INSERT INTO PSSQLDEL (SQLID, SQLTYPE, VERSION) VALUES (:id, :t, :v)`, binds: { id: q.sqlId, t: q.sqlType, v: next.SRM }, expect: 1, what: 'Inserting PSSQLDEL' });
    }
    for (const p of s.peopleCode.values()) {
      st.push(...deletePeopleCode('', p));
      st.push({ sql: `INSERT INTO PSPCMPROGDEL (${PC_KEY_COLUMNS.join(', ')}, VERSION) VALUES (${[1, 2, 3, 4, 5, 6, 7].map((n) => `:i${n}, :v${n}`).join(', ')}, :pcm)`,
        binds: { ...pcBinds(p.key.objectIds, p.key.objectValues), pcm: next.PCM }, expect: 1, what: 'Inserting PSPCMPROGDEL' });
    }
    for (const r of s.rows.sections) st.push({ sql: `INSERT INTO PSAESECTDEL (AE_APPLID, AE_SECTION, VERSION) VALUES (:a, :s, :v)`, binds: { a: name, s: r.AE_SECTION, v: next.AES }, expect: 1, what: 'Inserting PSAESECTDEL' });
    st.push({ sql: `INSERT INTO PSAEAPPLDEL (AE_APPLID, VERSION) VALUES (:a, :v)`, binds: { a: name, v: next.AEM }, expect: 1, what: 'Inserting PSAEAPPLDEL' });
    for (const n of COUNTERS) {
      const d = next[n] - version[n];
      if (!d) continue;
      st.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: next[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
      if (n !== 'SYS') st.push({ sql: `UPDATE PSLOCK SET VERSION = VERSION + :d WHERE OBJECTTYPENAME = '${n}'`, binds: { d }, expect: 1, what: `Updating PSLOCK ${n}` });
    }
    await run(c, st);
    const after = await readStoredAppEngine(c, oracledb, name, false);
    if (!isMissing(after)) throw new AeSaveRefusedError(`${name} still has rows after the delete.`);
    await c.commit();
    return { counters: next };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/**
 * Renames a program (File > Rename [ae14]): its rows, SQL and PeopleCode
 * under the new name, the old keys tombstoned. Done as a save of the
 * document under the new name, then the old program's delete-with-
 * tombstones, in one transaction.
 */
export async function renameAppEngine(c: Connection, oracledb: DbTypes, from: string, to: string, openedToken: string, operatorId: string): Promise<AeSaveResult> {
  try {
    const scope = writeScopeRefusal(to) ?? writeScopeRefusal(from);
    if (scope) throw new AeSaveRefusedError(scope);
    const stored = await readStoredAppEngine(c, oracledb, from, true);
    if (isMissing(stored)) throw new AeSaveRefusedError(`There is no App Engine program ${from}.`);
    if (appEngineToken(stored) !== openedToken) throw new AeSaveRefusedError(`${from} was changed in the database since it was opened.`);
    const target = await readStoredAppEngine(c, oracledb, to, true);
    if (!isMissing(target)) throw new AeSaveRefusedError(`An App Engine program named ${to} already exists.`);
    const doc = renamedDocument(documentOf(stored!), from, to);
    const [{ R: toolsRelease }] = await select<{ R: string }>(c, `SELECT TOOLSREL AS R FROM PSSTATUS`);
    const counters = await readCounters(c, true);
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const plan = planAppEngineSave(target, doc, { operatorId, toolsRelease: String(toolsRelease).trim(), lastupddttm, counters: counters.version, oracledb });
    // The program keeps its LICENSE_CODE and its stamps' meaning: a rename, not a copy.
    plan.desired.program.LICENSE_CODE = stored!.rows.program.LICENSE_CODE;
    for (const st of plan.statements) if (/^INSERT INTO PSAEAPPLDEFN /.test(st.sql)) {
      const cols = /\(([^)]*)\) VALUES/.exec(st.sql)![1].split(', ');
      st.binds[`b${cols.indexOf('LICENSE_CODE')}`] = stored!.rows.program.LICENSE_CODE;
    }
    await run(c, plan.statements);
    await verifyAppEngine(c, oracledb, plan);
    // The old program: deleted with tombstones (the counters already moved for the new one).
    const result = await deleteRows(c, oracledb, stored!, from, plan.counters);
    await c.commit();
    return { plan: { ...plan, counters: result }, token: appEngineToken(await readStoredAppEngine(c, oracledb, to, false)), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** A document under another program name: keys, local Call Section targets and PeopleCode keys follow; origins stay for tombstones. */
export function renamedDocument(doc: AeDocument, from: string, to: string): AeDocument {
  const next = structuredClone(doc);
  next.name = to;
  next.copiedFrom = from;
  delete next.origin;
  for (const s of next.sections) {
    delete s.origin; delete s.version;
    for (const v of s.variants) {
      delete v.origin;
      for (const st of v.steps) {
        delete st.origin;
        for (const a of st.actions) delete a.origin;
        if (st.doProgram.trim() === from) st.doProgram = to;
      }
    }
  }
  return next;
}

async function deleteRows(c: Connection, oracledb: DbTypes, s: StoredAppEngine, name: string, counters: Counters): Promise<Counters> {
  const next = { ...counters };
  const st: Statement[] = [];
  for (const t of ['PSAESTEPMSGDEFN', 'PSAESTMTDEFN', 'PSAESTEPDEFN', 'PSAESECTDTLDEFN', 'PSAESECTDEFN', 'PSAEAPPLLANG', 'PSAEAPPLTEMPTBL', 'PSAEAPPLSTATE', 'PSAEAPPLDEFN']) {
    st.push({ sql: `DELETE FROM ${t} WHERE AE_APPLID = :a`, binds: { a: name }, what: `Deleting ${t}` });
  }
  for (const q of s.sql) {
    for (const t of ['PSSQLTEXTDEFN', 'PSSQLHASH', 'PSSQLDESCR', 'PSSQLDEFN']) st.push({ sql: `DELETE FROM ${t} WHERE SQLID = :id AND SQLTYPE = :t`, binds: { id: q.sqlId, t: q.sqlType }, what: `Deleting ${t}` });
    st.push({ sql: `INSERT INTO PSSQLDEL (SQLID, SQLTYPE, VERSION) VALUES (:id, :t, :v)`, binds: { id: q.sqlId, t: q.sqlType, v: next.SRM }, expect: 1, what: 'Inserting PSSQLDEL' });
  }
  for (const p of s.peopleCode.values()) {
    st.push(...deletePeopleCode('', p));
    st.push({ sql: `INSERT INTO PSPCMPROGDEL (${PC_KEY_COLUMNS.join(', ')}, VERSION) VALUES (${[1, 2, 3, 4, 5, 6, 7].map((n) => `:i${n}, :v${n}`).join(', ')}, :pcm)`,
      binds: { ...pcBinds(p.key.objectIds, p.key.objectValues), pcm: next.PCM }, expect: 1, what: 'Inserting PSPCMPROGDEL' });
  }
  for (const r of s.rows.sections) st.push({ sql: `INSERT INTO PSAESECTDEL (AE_APPLID, AE_SECTION, VERSION) VALUES (:a, :s, :v)`, binds: { a: name, s: r.AE_SECTION, v: next.AES }, expect: 1, what: 'Inserting PSAESECTDEL' });
  st.push({ sql: `INSERT INTO PSAEAPPLDEL (AE_APPLID, VERSION) VALUES (:a, :v)`, binds: { a: name, v: next.AEM }, expect: 1, what: 'Inserting PSAEAPPLDEL' });
  // App Designer's rename also moves PJM [ae14].
  next.PJM += 1;
  st.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PJM'`, binds: { v: next.PJM }, expect: 1, what: 'Updating PSVERSION PJM' });
  st.push({ sql: `UPDATE PSLOCK SET VERSION = VERSION + 1 WHERE OBJECTTYPENAME = 'PJM'`, binds: {}, expect: 1, what: 'Updating PSLOCK PJM' });
  await run(c, st);
  return next;
}
