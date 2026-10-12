import { createHash } from 'node:crypto';
import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import {
  assignSyncIds, CI_METHODS, documentFromRows, rowsFromDocument, saveNames, validateCi, type CiDocument, type CiRows, type Row
} from '../model/ciDocument.js';
import { SaveRefusedError, validateOperatorId, type StoredProgram } from '../peoplecode/writeback/savePlan.js';
import { deletePeopleCode, insertPeopleCode, insertStatement, PC_EXACT, PC_KEY_COLUMNS, pcBinds, run, type Statement } from './appEngineWriter.js';
import { operatorExists, readStoredProgram, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

/*
 * Saving a Component Interface as App Designer's Component Interface window
 * does (docs/COMPONENT_INTERFACES.md).
 *
 * planCiSave compares the interface as stored with the document: PSBCDEFN
 * inserted or updated (changed columns, then VERSION -- the new BCM -- and
 * the stamp, on every save), PSBCITEM and PSCISYNCDEFN rows inserted,
 * updated and deleted by key, new items' SYNCIDs (and a new
 * synchronization row's) taken from PSSYSTEMID in the window's order, the
 * names the save stores, PSBCDEL removed when the name is made again, and
 * the counters moved as App Designer moves them: BCM, SYS + 1; CLM + 1 when
 * a standard method is taken away. Pure.
 *
 * saveCi runs a plan in one transaction (the interface re-read FOR UPDATE,
 * the open token checked, the result re-read and proved before COMMIT);
 * deleteCi and renameCi are File > Delete and File > Rename. The
 * interface's PeopleCode (74 / Methods) saves through the PeopleCode writer.
 */

export class CiSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'CiSaveRefusedError'; }
}

export interface StoredCi {
  exists: boolean;
  rows: CiRows;
  /** Its Methods PeopleCode. */
  peopleCode?: StoredProgram;
  tombstones: { ci: Row[]; peopleCode: Row[] };
}

export interface Counters { BCM: number; CLM: number; MPM: number; PCM: number; PJM: number; SYS: number }
type CounterName = keyof Counters;
const COUNTERS: readonly CounterName[] = ['BCM', 'CLM', 'MPM', 'PCM', 'PJM', 'SYS'];
export interface SystemIds { PSBCITEM: number; PSCISYNCDEFN: number }

const OUT_FORMAT_OBJECT = 4002;
const CI_PC_IDS = [74, 12, 0, 0, 0, 0, 0];
const pcValues = (name: string) => [name, 'Methods', ' ', ' ', ' ', ' ', ' '];
const emptyRows = (): CiRows => ({ defn: {}, items: [], sync: [] });

export async function readStoredCi(c: Connection, oracledb: DbTypes, name: string, forUpdate: boolean): Promise<StoredCi> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const opts = { outFormat: OUT_FORMAT_OBJECT, fetchInfo: { DESCRLONG: { type: oracledb.STRING } } };
  const all = async (sql: string, binds: Record<string, unknown> = { n: name }) => ((await c.execute<Row>(sql, binds, opts)).rows ?? []);
  const tombstones = {
    ci: await all(`SELECT BCNAME, VERSION FROM PSBCDEL WHERE BCNAME = :n`),
    peopleCode: await all(`SELECT ${PC_KEY_COLUMNS.join(', ')}, VERSION FROM PSPCMPROGDEL WHERE OBJECTID1 = 74 AND OBJECTVALUE1 = :n`)
  };
  const [defn] = await all(`SELECT D.*, TO_CHAR(D.LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM FROM PSBCDEFN D WHERE BCNAME = :n${lock}`);
  if (!defn) return { exists: false, rows: emptyRows(), tombstones };
  const rows: CiRows = {
    defn,
    items: await all(`SELECT * FROM PSBCITEM WHERE BCNAME = :n ORDER BY SEQUENCE_NBR_6${lock}`),
    sync: await all(`SELECT * FROM PSCISYNCDEFN WHERE BCNAME = :n${lock}`)
  };
  const program = await readStoredProgram(c, oracledb as never, [name, 'Methods'], forUpdate);
  return { exists: true, rows, ...(program?.program.length ? { peopleCode: program } : {}), tombstones };
}

export const ciDocumentOf = (stored: StoredCi): CiDocument => documentFromRows(stored.rows);

/** The concurrency token: PSBCDEFN's VERSION and its PeopleCode's -- every App Designer save moves one. */
export function ciToken(stored: StoredCi | undefined): string {
  if (!stored || !stored.exists) return 'absent';
  const parts = [`B${Number(stored.rows.defn.VERSION)}`, `C${stored.peopleCode?.program[0]?.version ?? 0}`];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

export async function readCiCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const rows = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN (${COUNTERS.map((n) => `'${n}'`).join(', ')})${lock}`);
  const out = {} as Counters;
  for (const n of COUNTERS) {
    const r = rows.find((x) => String(x.T).trim() === n);
    if (!r) throw new CiSaveRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
    out[n] = Number(r.V);
  }
  return out;
}

/** PSSYSTEMID's last given SYNCIDs (ci01, ci07). */
export async function readSystemIds(c: Connection, forUpdate: boolean): Promise<SystemIds> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const rows = await select<{ R: string; V: number }>(c, `SELECT RECNAME AS R, PTNEXTSYSTEMID AS V FROM PSSYSTEMID WHERE RECNAME IN ('PSBCITEM', 'PSCISYNCDEFN')${lock}`);
  const v = (n: string) => Number(rows.find((r) => String(r.R).trim() === n)?.V ?? 0);
  return { PSBCITEM: v('PSBCITEM'), PSCISYNCDEFN: v('PSCISYNCDEFN') };
}

/** PSVERSION moved, and PSLOCK set to the same value (SYS has no PSLOCK row it moves). */
function counterStatements(from: Counters, to: Counters): Statement[] {
  const st: Statement[] = [];
  for (const n of COUNTERS) {
    if (to[n] === from[n]) continue;
    st.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
    if (n !== 'SYS') st.push({ sql: `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, what: `Updating PSLOCK ${n}` });
  }
  return st;
}

function systemIdStatements(from: SystemIds, to: SystemIds): Statement[] {
  return (['PSBCITEM', 'PSCISYNCDEFN'] as const).filter((n) => to[n] !== from[n]).map((n) => ({
    sql: `UPDATE PSSYSTEMID SET PTNEXTSYSTEMID = :v WHERE RECNAME = '${n}'`, binds: { v: to[n] }, expect: 1, what: `Updating PSSYSTEMID ${n}`
  }));
}

// ---------------------------------------------------------------------------
// Planning

export interface CiPlanSummary { changes: string[]; inserted: number; updated: number; deleted: number; renamedOnSave: string[] }

export interface CiPlan {
  name: string;
  empty: boolean;
  statements: Statement[];
  desired: CiRows;
  increments: Partial<Counters>;
  counters: Counters;
  systemIds: SystemIds;
  summary: CiPlanSummary;
  /** The document as stored after the save (SYNCIDs given, the save's names). */
  saved: CiDocument;
}

export interface CiPlanOptions {
  operatorId: string;
  lastupddttm: string;
  counters: Counters;
  systemIds: SystemIds;
  oracledb: DbTypes;
}

const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const KEYS: Record<string, string[]> = {
  PSBCITEM: ['BCNAME', 'BCTYPE', 'BCITEMPARENT', 'BCITEMNAME'],
  PSCISYNCDEFN: ['BCNAME']
};
const val = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' && v.trim() === '' ? ' ' : String(v).trim());
const keyOf = (table: string, r: Row) => KEYS[table].map((k) => val(r[k])).join('\u0000');

function diff(table: string, stored: Row[], desired: Row[]) {
  const s = new Map(stored.map((r) => [keyOf(table, r), r]));
  const d = new Map(desired.map((r) => [keyOf(table, r), r]));
  const out = { inserted: [] as Row[], deleted: [] as Row[], updated: [] as { key: Row; changes: Row }[] };
  for (const [k, r] of d) {
    const old = s.get(k);
    if (!old) { out.inserted.push(r); continue; }
    const changes: Row = {};
    for (const col of Object.keys(r)) if (!KEYS[table].includes(col) && val(r[col]) !== val(old[col])) changes[col] = r[col];
    if (Object.keys(changes).length) out.updated.push({ key: r, changes });
  }
  for (const [k, r] of s) if (!d.has(k)) out.deleted.push(r);
  return out;
}

function whereKey(table: string, r: Row, binds: Record<string, unknown>): string {
  return KEYS[table].map((k, i) => { binds[`k${i}`] = r[k]; return `${k} = :k${i}`; }).join(' AND ');
}

const isMissing = (s: StoredCi | undefined) => !s || !s.exists;

/** The statements that turn the stored interface (missing: a create) into the document, with the counters' moves. */
export function planCiSave(stored: StoredCi | undefined, doc: CiDocument, opts: CiPlanOptions): CiPlan {
  const creating = isMissing(stored);
  const s = creating ? undefined : stored!;
  const ora = opts.oracledb;
  if (s && String(s.rows.defn.BCNAME).trim() !== doc.name) throw new CiSaveRefusedError('The stored interface is another one; refusing.');

  // The save gives SYNCIDs to new items in the window's order, and stores its names (ci01-ci04, ci14, ci20).
  const saved: CiDocument = { ...doc, ...(doc.sync ? { sync: { ...doc.sync } } : {}), items: doc.items.map((i) => ({ ...i })) };
  const ids = { ...opts.systemIds };
  ids.PSBCITEM = assignSyncIds(saved.items, ids.PSBCITEM + 1);
  if (saved.sync && !saved.sync.syncId) saved.sync.syncId = ++ids.PSCISYNCDEFN;
  const renamedOnSave = [...saveNames(saved.items)].map(([it, old]) => `${old} stored as ${it.name}`);
  const desired = rowsFromDocument(saved);

  const changes: string[] = [];
  const counts = { inserted: 0, updated: 0, deleted: 0 };
  const statements: Statement[] = [];
  const defnChanges: Row = {};
  if (s) for (const col of Object.keys(desired.defn)) {
    if (STAMP.has(col) || col === 'BCNAME') continue;
    if (val(desired.defn[col]) !== val(s.rows.defn[col])) defnChanges[col] = desired.defn[col];
  }
  const items = diff('PSBCITEM', s?.rows.items ?? [], desired.items);
  const sync = diff('PSCISYNCDEFN', s?.rows.sync ?? [], desired.sync);
  const anything = creating || Object.keys(defnChanges).length > 0 ||
    [items, sync].some((d) => d.inserted.length || d.deleted.length || d.updated.length);

  // Counters: BCM and SYS on every save; CLM when a standard method is taken away (permission lists grant methods: ci06).
  const inc: Partial<Counters> = {};
  const methodsRemoved = s ? Number(s.rows.defn.BCSTDMETHODS) & ~Number(desired.defn.BCSTDMETHODS) : 0;
  if (anything) { inc.BCM = 1; inc.SYS = 1; }
  if (methodsRemoved) inc.CLM = 1;
  const next = { ...opts.counters };
  for (const n of COUNTERS) next[n] += inc[n] ?? 0;

  for (const r of sync.deleted) { const b: Record<string, unknown> = {}; statements.push({ sql: `DELETE FROM PSCISYNCDEFN WHERE ${whereKey('PSCISYNCDEFN', r, b)}`, binds: b, expect: 1, what: 'Deleting PSCISYNCDEFN' }); }
  for (const r of items.deleted) { const b: Record<string, unknown> = {}; statements.push({ sql: `DELETE FROM PSBCITEM WHERE ${whereKey('PSBCITEM', r, b)}`, binds: b, expect: 1, what: 'Deleting PSBCITEM' }); counts.deleted++; }
  const stampSql = `VERSION = :bcm, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op`;
  if (creating) {
    const ins = insertStatement('PSBCDEFN', { ...desired.defn, VERSION: next.BCM, LASTUPDOPRID: opts.operatorId }, ora);
    ins.sql = ins.sql.replace(/\) VALUES \(/, ', LASTUPDDTTM) VALUES (').replace(/\)$/, `, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}))`);
    statements.push(ins);
    for (const t of stored?.tombstones.ci ?? []) {
      statements.push({ sql: 'DELETE FROM PSBCDEL WHERE BCNAME = :n AND VERSION = :v', binds: { n: doc.name, v: t.VERSION }, expect: 1, what: 'Deleting PSBCDEL' });
    }
    changes.push(`create Component Interface ${doc.name} on ${doc.component}.${doc.market}`);
  } else if (anything) {
    const binds: Record<string, unknown> = { n: doc.name };
    const sets = Object.keys(defnChanges).map((c, i) => {
      binds[`u${i}`] = c === 'DESCRLONG' && defnChanges[c] !== null ? { val: String(defnChanges[c]), type: ora.CLOB } : defnChanges[c];
      return `${c} = :u${i}`;
    });
    statements.push({ sql: `UPDATE PSBCDEFN SET ${[...sets, stampSql].join(', ')} WHERE BCNAME = :n`, binds, expect: 1, what: 'Updating PSBCDEFN' });
    for (const c of Object.keys(defnChanges)) if (c !== 'ITEMCOUNT') changes.push(`interface ${c}`);
  }
  for (const r of items.inserted) { statements.push(insertStatement('PSBCITEM', r, ora)); counts.inserted++; }
  for (const u of items.updated) {
    const b: Record<string, unknown> = {};
    const sets = Object.keys(u.changes).map((c, i) => { b[`u${i}`] = u.changes[c]; return `${c} = :u${i}`; });
    statements.push({ sql: `UPDATE PSBCITEM SET ${sets.join(', ')} WHERE ${whereKey('PSBCITEM', u.key, b)}`, binds: b, expect: 1, what: 'Updating PSBCITEM' });
    counts.updated++;
    changes.push(`${String(u.key.BCITEMPARENT).trim()}.${String(u.key.BCITEMNAME).trim()}: ${Object.keys(u.changes).join(', ')}`);
  }
  if (items.inserted.length) changes.push(`PSBCITEM: ${items.inserted.length} inserted`);
  if (items.deleted.length) changes.push(`PSBCITEM: ${items.deleted.length} deleted`);
  for (const r of sync.inserted) { statements.push(insertStatement('PSCISYNCDEFN', r, ora)); changes.push('synchronizable'); }
  for (const u of sync.updated) {
    const b: Record<string, unknown> = {};
    const sets = Object.keys(u.changes).map((c, i) => { b[`u${i}`] = u.changes[c]; return `${c} = :u${i}`; });
    statements.push({ sql: `UPDATE PSCISYNCDEFN SET ${sets.join(', ')} WHERE ${whereKey('PSCISYNCDEFN', u.key, b)}`, binds: b, expect: 1, what: 'Updating PSCISYNCDEFN' });
    changes.push(`synchronization: ${Object.keys(u.changes).join(', ')}`);
  }
  if (sync.deleted.length) changes.push('not synchronizable');
  // Permission lists' grants of a method taken away go with it (inferred from CLM moving: ci06).
  for (const [m, bit] of Object.entries(CI_METHODS)) {
    if (methodsRemoved & bit) {
      statements.push({ sql: 'DELETE FROM PSAUTHBUSCOMP WHERE BCNAME = :n AND BCMETHOD = :m', binds: { n: doc.name, m }, what: 'Deleting PSAUTHBUSCOMP' });
      changes.push(`standard method ${m} removed`);
    }
  }
  for (const st of statements) {
    if (/:bcm\b/.test(st.sql)) st.binds.bcm = next.BCM;
    if (/:ts\b/.test(st.sql)) st.binds.ts = opts.lastupddttm;
    if (/:op\b/.test(st.sql)) st.binds.op = opts.operatorId;
  }
  statements.push(...systemIdStatements(opts.systemIds, ids), ...counterStatements(opts.counters, next));
  desired.defn = { ...desired.defn, VERSION: next.BCM };
  return {
    name: doc.name, empty: !anything, statements, desired, increments: inc, counters: next, systemIds: ids,
    summary: { changes, ...counts, renamedOnSave }, saved
  };
}

// ---------------------------------------------------------------------------
// Saving

export interface CiSaveRequest {
  doc: CiDocument;
  openedToken: string;
  operatorId: string;
  dryRun?: boolean;
  /** Save As with "save a copy of the PeopleCode" Yes (ci25): the source interface whose Methods program the copy takes. */
  copyPeopleCodeFrom?: string;
}

export interface CiSaveResult { plan: CiPlan; token: string; written: boolean }

async function prepare(c: Connection, operatorId: string, name: string): Promise<void> {
  const operatorError = validateOperatorId(operatorId);
  if (operatorError) throw new CiSaveRefusedError(operatorError);
  const scope = writeScopeRefusal(name);
  if (scope) throw new CiSaveRefusedError(scope);
  if (!(await operatorExists(c, operatorId))) throw new CiSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
}

async function stamp(c: Connection): Promise<string> {
  const [{ TS }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
  return TS;
}

/** A program's rows under another key, with this version and stamp (Save As, Rename). */
function movedProgram(p: StoredProgram, name: string, version: number | undefined, ts: string, operatorId: string): StoredProgram {
  return {
    key: { objectIds: [...CI_PC_IDS], objectValues: pcValues(name) }, text: p.text.map((r) => ({ ...r })), names: p.names.map((r) => ({ ...r })),
    program: p.program.map((r) => ({ ...r, version: version ?? r.version, lastupddttm: ts, lastupdoprid: operatorId }))
  };
}

const pcTombstone = (name: string, version: number): Statement => ({
  sql: `INSERT INTO PSPCMPROGDEL (${PC_KEY_COLUMNS.join(', ')}, VERSION) VALUES (${[1, 2, 3, 4, 5, 6, 7].map((n) => `:i${n}, :v${n}`).join(', ')}, :dv)`,
  binds: { ...pcBinds(CI_PC_IDS, pcValues(name)), dv: version }, expect: 1, what: 'Inserting PSPCMPROGDEL'
});

const removePcTombstones = (name: string): Statement => ({
  sql: `DELETE FROM PSPCMPROGDEL WHERE OBJECTID1 = 74 AND OBJECTVALUE1 = :n AND OBJECTID2 = 12 AND OBJECTVALUE2 = 'Methods'`, binds: { n: name }, what: 'Deleting PSPCMPROGDEL'
});

/** Saves the document in one transaction; refused on a validation error or a changed interface. */
export async function saveCi(c: Connection, oracledb: DbTypes, request: CiSaveRequest): Promise<CiSaveResult> {
  try {
    await prepare(c, request.operatorId, request.doc.name);
    const problems = validateCi(request.doc).filter((d) => d.severity === 'error');
    if (problems.length) throw new CiSaveRefusedError(`The interface has errors: ${problems.slice(0, 5).map((p) => `${p.path}: ${p.message}`).join('; ')}`);
    const stored = await readStoredCi(c, oracledb, request.doc.name, true);
    const token = ciToken(stored);
    if (token !== request.openedToken) {
      throw new CiSaveRefusedError(request.openedToken === 'absent'
        ? `A Component Interface named ${request.doc.name} already exists.`
        : `${request.doc.name} was changed in the database since it was opened (another save, possibly in App Designer). Reopen it and reapply your edit.`);
    }
    const counters = await readCiCounters(c, true);
    const systemIds = await readSystemIds(c, true);
    const ts = await stamp(c);
    const plan = planCiSave(stored, request.doc, { operatorId: request.operatorId, lastupddttm: ts, counters, systemIds, oracledb });
    // Save As copying the PeopleCode: the program under the new name at the new PCM (ci25).
    if (request.copyPeopleCodeFrom && !stored.exists) {
      const source = await readStoredProgram(c, oracledb as never, [request.copyPeopleCodeFrom, 'Methods'], false);
      if (source?.program.length) {
        const pcm = plan.counters.PCM + 1;
        const before = { ...plan.counters };
        plan.counters.PCM = pcm;
        plan.increments.PCM = 1;
        const counterSql = plan.statements.findIndex((st) => /UPDATE PSVERSION/.test(st.sql));
        const pcRows = [removePcTombstones(request.doc.name), ...insertPeopleCode(movedProgram(source, request.doc.name, pcm, ts, request.operatorId), oracledb)];
        plan.statements.splice(counterSql < 0 ? plan.statements.length : counterSql, 0, ...pcRows);
        plan.statements.push(...counterStatements({ ...before, PCM: before.PCM }, { ...before, PCM: pcm }).filter((st) => /'PCM'/.test(st.sql)));
        plan.summary.changes.push(`PeopleCode copied from ${request.copyPeopleCodeFrom}`);
      }
    }
    if (request.dryRun || plan.empty) {
      await c.rollback();
      return { plan, token, written: false };
    }
    await run(c, plan.statements);
    await verifyCi(c, oracledb, plan);
    await c.commit();
    return { plan, token: ciToken(await readStoredCi(c, oracledb, request.doc.name, false)), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

const normalize = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort()
  .map((k) => [k, val(r[k])]))).sort();

/** Proves the stored interface is the plan's: rows, version, counters. */
export async function verifyCi(c: Connection, oracledb: DbTypes, plan: CiPlan): Promise<void> {
  const problems: string[] = [];
  const stored = await readStoredCi(c, oracledb, plan.name, false);
  if (!stored.exists) throw new CiSaveRefusedError(`After the save there is no interface ${plan.name}.`);
  const want = plan.desired;
  if (JSON.stringify(normalize(stored.rows.items)) !== JSON.stringify(normalize(want.items))) problems.push('the items differ');
  if (JSON.stringify(normalize(stored.rows.sync)) !== JSON.stringify(normalize(want.sync))) problems.push('the synchronization row differs');
  const defnKeys = Object.keys(want.defn).filter((k) => !STAMP.has(k));
  if (defnKeys.some((k) => val(stored.rows.defn[k]) !== val(want.defn[k]))) problems.push('the PSBCDEFN row differs');
  if (!plan.empty && Number(stored.rows.defn.VERSION) !== plan.counters.BCM) problems.push(`VERSION ${stored.rows.defn.VERSION}, ${plan.counters.BCM} expected`);
  const now = await readCiCounters(c, false);
  for (const n of COUNTERS) if (now[n] !== plan.counters[n]) problems.push(`PSVERSION ${n} ${now[n]}, ${plan.counters[n]} expected`);
  if (problems.length) throw new CiSaveRefusedError(`The written rows are not the planned ones (${problems.slice(0, 6).join('; ')}).`);
}

export async function verifyCiSave(c: Connection, oracledb: DbTypes, result: CiSaveResult): Promise<void> {
  if (!result.written) return;
  if (ciToken(await readStoredCi(c, oracledb, result.plan.name, false)) !== result.token) throw new CiSaveRefusedError('After COMMIT the interface is not what was written.');
}

// ---------------------------------------------------------------------------
// Delete and rename

/** The tables keyed by BCNAME beside PSBCDEFN / PSBCITEM, re-keyed by a rename and emptied by a delete. */
const CI_TABLES = ['PSBCITEM', 'PSBCITEMLANG', 'PSBCDEFNLANG', 'PSCISYNCDEFN', 'PSCIREF', 'PSCIREFPROPERTY', 'PSCIREFENUM', 'PSCIREFLANG'];

/**
 * File > Delete [ci27]: every row of the interface, its PeopleCode with a
 * PSPCMPROGDEL marker at the new PCM, PSBCDEL at the new BCM; BCM, CLM, SYS
 * + 1 (PCM + 1 with PeopleCode). Permission lists' grants of it go too
 * (inferred from CLM).
 */
export async function deleteCi(c: Connection, oracledb: DbTypes, name: string, openedToken: string, operatorId: string): Promise<{ counters: Counters }> {
  try {
    await prepare(c, operatorId, name);
    const stored = await readStoredCi(c, oracledb, name, true);
    if (!stored.exists) throw new CiSaveRefusedError(`There is no Component Interface ${name}.`);
    if (ciToken(stored) !== openedToken) throw new CiSaveRefusedError(`${name} was changed in the database since it was opened.`);
    const from = await readCiCounters(c, true);
    const to = { ...from, BCM: from.BCM + 1, CLM: from.CLM + 1, SYS: from.SYS + 1, PCM: from.PCM + (stored.peopleCode ? 1 : 0) };
    const st: Statement[] = CI_TABLES.map((t) => ({ sql: `DELETE FROM ${t} WHERE BCNAME = :n`, binds: { n: name }, what: `Deleting ${t}` }));
    st.push({ sql: 'DELETE FROM PSBCDEFN WHERE BCNAME = :n', binds: { n: name }, expect: 1, what: 'Deleting PSBCDEFN' });
    if (stored.peopleCode) st.push(...deletePeopleCode('', stored.peopleCode), pcTombstone(name, to.PCM));
    st.push({ sql: 'DELETE FROM PSAUTHBUSCOMP WHERE BCNAME = :n', binds: { n: name }, what: 'Deleting PSAUTHBUSCOMP' });
    st.push({ sql: 'INSERT INTO PSBCDEL (BCNAME, VERSION) VALUES (:n, :v)', binds: { n: name, v: to.BCM }, expect: 1, what: 'Inserting PSBCDEL' });
    st.push(...counterStatements(from, to));
    await run(c, st);
    if ((await readStoredCi(c, oracledb, name, false)).exists) throw new CiSaveRefusedError(`${name} still has rows after the delete.`);
    await c.commit();
    return { counters: to };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/**
 * File > Rename [ci26]: PSBCDEFN re-keyed in place (BCDISPLAYNAME too when it
 * was the name; VERSION the new BCM, restamped), its items and other rows
 * re-keyed, its PeopleCode re-keyed in place (VERSION kept, restamped) with
 * a PSPCMPROGDEL marker for the old key at the new PCM, PSBCDEL for the old
 * name; BCM, CLM, MPM, PCM, PJM, SYS each + 1. Permission lists' grants
 * follow (inferred from CLM).
 */
export async function renameCi(c: Connection, oracledb: DbTypes, from: string, to: string, openedToken: string, operatorId: string): Promise<CiSaveResult> {
  try {
    await prepare(c, operatorId, from);
    const scope = writeScopeRefusal(to);
    if (scope) throw new CiSaveRefusedError(scope);
    const stored = await readStoredCi(c, oracledb, from, true);
    if (!stored.exists) throw new CiSaveRefusedError(`There is no Component Interface ${from}.`);
    if (ciToken(stored) !== openedToken) throw new CiSaveRefusedError(`${from} was changed in the database since it was opened.`);
    const target = await readStoredCi(c, oracledb, to, true);
    if (target.exists) throw new CiSaveRefusedError(`A Component Interface named ${to} already exists.`);
    const counters = await readCiCounters(c, true);
    const next = { ...counters };
    for (const n of COUNTERS) next[n] += 1;
    const ts = await stamp(c);
    const b = { f: from, t: to };
    const display = String(stored.rows.defn.BCDISPLAYNAME).trim() === from ? to : String(stored.rows.defn.BCDISPLAYNAME);
    const st: Statement[] = [{
      sql: `UPDATE PSBCDEFN SET BCNAME = :t, BCDISPLAYNAME = :d, VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE BCNAME = :f`,
      binds: { ...b, d: display, v: next.BCM, ts, op: operatorId }, expect: 1, what: 'Renaming PSBCDEFN'
    }];
    for (const t of CI_TABLES) st.push({ sql: `UPDATE ${t} SET BCNAME = :t WHERE BCNAME = :f`, binds: { ...b }, what: `Renaming ${t}` });
    for (const t of target.tombstones.ci) st.push({ sql: 'DELETE FROM PSBCDEL WHERE BCNAME = :n AND VERSION = :v', binds: { n: to, v: t.VERSION }, expect: 1, what: 'Deleting PSBCDEL' });
    st.push({ sql: 'INSERT INTO PSBCDEL (BCNAME, VERSION) VALUES (:f, :v)', binds: { f: from, v: next.BCM }, expect: 1, what: 'Inserting PSBCDEL' });
    if (stored.peopleCode) {
      const k = pcBinds(CI_PC_IDS, pcValues(from));
      st.push(
        { sql: `UPDATE PSPCMPROG SET OBJECTVALUE1 = :t, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE ${PC_EXACT}`,
          binds: { ...k, t: to, ts, op: operatorId }, expect: stored.peopleCode.program.length, what: 'Renaming PSPCMPROG' },
        { sql: `UPDATE PSPCMTXT SET OBJECTVALUE1 = :t WHERE ${PC_EXACT}`, binds: { ...k, t: to }, expect: stored.peopleCode.text.length, what: 'Renaming PSPCMTXT' },
        { sql: `UPDATE PSPCMNAME SET OBJECTVALUE1 = :t WHERE ${PC_EXACT}`, binds: { ...k, t: to }, expect: stored.peopleCode.names.length, what: 'Renaming PSPCMNAME' },
        removePcTombstones(to), pcTombstone(from, next.PCM)
      );
    }
    st.push({ sql: 'UPDATE PSAUTHBUSCOMP SET BCNAME = :t WHERE BCNAME = :f', binds: { ...b }, what: 'Renaming PSAUTHBUSCOMP' });
    st.push(...counterStatements(counters, next));
    await run(c, st);
    const after = await readStoredCi(c, oracledb, to, false);
    if (!after.exists || (await readStoredCi(c, oracledb, from, false)).exists) throw new CiSaveRefusedError(`The rename of ${from} to ${to} did not take.`);
    await c.commit();
    const doc = ciDocumentOf(after);
    const plan: CiPlan = {
      name: to, empty: false, statements: st, desired: after.rows, increments: Object.fromEntries(COUNTERS.map((n) => [n, 1])), counters: next,
      systemIds: { PSBCITEM: 0, PSCISYNCDEFN: 0 }, saved: doc,
      summary: { changes: [`rename ${from} to ${to}`], inserted: 0, updated: 0, deleted: 0, renamedOnSave: [] }
    };
    return { plan, token: ciToken(after), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
