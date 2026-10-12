import { createHash } from 'node:crypto';
import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import {
  documentFromRows, partitionCandidates, rowsFromDocument, validateChannel, type ChannelDocument, type ChannelRows, type Row
} from '../model/channelDocument.js';
import { SaveRefusedError, validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { run, type Statement } from './appEngineWriter.js';
import { operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

/*
 * Saving a message channel as App Designer's Message Channel window does
 * (docs/MESSAGE_CHANNELS.md).
 *
 * planChannelSave compares the channel as stored with the document and
 * returns the statements that make the one the other: PSCHNLDEFN inserted or
 * updated with VERSION the new CHDM and the save's stamp, PSSUBCHNL rows
 * inserted and deleted, a recreated name's tombstone removed, CHDM and SYS
 * moved. planChannelDelete and planChannelRename are File > Delete and File >
 * Rename. All three are pure; saveChannel, deleteChannel and renameChannel
 * run them in one transaction (the channel re-read FOR UPDATE, the open token
 * checked, the result re-read and proved before COMMIT).
 */

export class ChannelSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'ChannelSaveRefusedError'; }
}

export interface StoredChannel {
  exists: boolean;
  rows: ChannelRows;
  /** PSMSGDEFN rows naming the channel, by name: the window's Messages list. */
  messages: string[];
  /** The fields the window offers to partition by (channelDocument.ts partitionCandidates). */
  candidates: string[];
  /** PSCHNLDEL rows for the name. */
  tombstones: Row[];
}

export interface Counters { CHDM: number; MSDM: number; PJM: number; SYS: number }
type CounterName = keyof Counters;
const COUNTERS: readonly CounterName[] = ['CHDM', 'MSDM', 'PJM', 'SYS'];

/** PSPROJECTITEM: a message channel is OBJECTTYPE 36, OBJECTID1 61 (CHNLNAME) [chn16]. */
export const CHANNEL_PROJECT_ITEM = { objectType: 36, objectId: 61 } as const;

const OUT_FORMAT_OBJECT = 4002;
/** PSCHNLDEFN's columns but LASTUPDDTTM, which is read as text. */
const CHANNEL_COLUMNS = ['CHNLNAME', 'VERSION', 'CHNLSTATUS', 'PUBTIMEOUTMIN', 'SUBTIMEOUTMIN', 'PUBRETRYSEC', 'SUBRETRYSEC', 'ERRORTHRESHOLD', 'APMSGARCHIVE',
  'THRUPUTTYPE', 'QUALITYOFSERVICE', 'CHNLDISPLAYNAME', 'DESCR', 'OBJECTOWNERID', 'LASTUPDOPRID', 'DESCRLONG'];
const emptyRows = (): ChannelRows => ({ channel: {}, partitions: [], languages: [], nodes: [] });
const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const val = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' && v.trim() === '' ? ' ' : String(v).trim());

/**
 * The level-0 record fields of each message naming the channel -- its
 * default version's, or its only (first) version's when none is set -- in
 * record field order, Long and image fields left out; keyed by message.
 */
async function messageFields(c: Connection, name: string): Promise<{ messages: string[]; fields: Map<string, string[]> }> {
  const messages = (await select<{ M: string }>(c, `SELECT MSGNAME AS M FROM PSMSGDEFN WHERE CHNLNAME = :c ORDER BY MSGNAME`, { c: name })).map((r) => String(r.M).trim());
  const fields = new Map<string, string[]>(messages.map((m) => [m, []]));
  if (!messages.length) return { messages, fields };
  const rows = await select<{ M: string; F: string }>(c,
    `SELECT M.MSGNAME AS M, D.FIELDNAME AS F
       FROM PSMSGDEFN M
       JOIN PSMSGREC R ON R.MSGNAME = M.MSGNAME AND R.PRNTRECNAME = '--'
        AND R.APMSGVER = CASE WHEN M.DEFAULTVER <> ' ' THEN M.DEFAULTVER ELSE (SELECT MIN(V.APMSGVER) FROM PSMSGVER V WHERE V.MSGNAME = M.MSGNAME) END
       JOIN PSRECFIELDDB D ON D.RECNAME = R.RECNAME
       JOIN PSDBFIELD F ON F.FIELDNAME = D.FIELDNAME
      WHERE M.CHNLNAME = :c AND F.FIELDTYPE NOT IN (1, 8, 9)
      ORDER BY M.MSGNAME, R.SEQNO, D.FIELDNUM`, { c: name });
  for (const r of rows) {
    const list = fields.get(String(r.M).trim());
    const f = String(r.F).trim();
    if (list && !list.includes(f)) list.push(f);
  }
  return { messages, fields };
}

/** The messages naming a channel and the fields its window offers -- for a channel not yet saved, too. */
export async function readChannelContext(c: Connection, name: string): Promise<{ messages: string[]; candidates: string[] }> {
  const { messages, fields } = await messageFields(c, name);
  return { messages, candidates: partitionCandidates(messages.map((m) => fields.get(m) ?? [])) };
}

export async function readStoredChannel(c: Connection, oracledb: DbTypes, name: string, forUpdate: boolean): Promise<StoredChannel> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const opts = { outFormat: OUT_FORMAT_OBJECT, fetchInfo: { DESCRLONG: { type: oracledb.STRING } } };
  const all = async (sql: string) => ((await c.execute<Row>(sql, { c: name }, opts)).rows ?? []);
  const [channel] = await all(`SELECT ${CHANNEL_COLUMNS.join(', ')}, TO_CHAR(LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM FROM PSCHNLDEFN WHERE CHNLNAME = :c${lock}`);
  const tombstones = await all(`SELECT CHNLNAME, VERSION FROM PSCHNLDEL WHERE CHNLNAME = :c`);
  const context = await readChannelContext(c, name);
  if (!channel) return { exists: false, rows: emptyRows(), ...context, tombstones };
  return {
    exists: true,
    rows: {
      channel,
      partitions: await all(`SELECT * FROM PSSUBCHNL WHERE CHNLNAME = :c ORDER BY FIELDNAME${lock}`),
      languages: await all(`SELECT * FROM PSCHNLDEFNLANG WHERE CHNLNAME = :c${lock}`),
      nodes: await all(`SELECT * FROM PSCHNLNODE WHERE CHNLNAME = :c${lock}`)
    },
    ...context, tombstones
  };
}

/** The channel as App Designer's window opens it. */
export function channelDocumentOf(stored: StoredChannel): ChannelDocument {
  return documentFromRows(stored.rows, stored.messages, stored.candidates);
}

/** The concurrency token: the channel's VERSION (every App Designer save moves it) and its partition rows. */
export function channelToken(stored: StoredChannel | undefined): string {
  if (!stored || !stored.exists) return 'absent';
  const parts = [`C${Number(stored.rows.channel.VERSION)}`, ...stored.rows.partitions.map((r) => `P${String(r.FIELDNAME).trim()}`).sort()];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

export async function readChannelCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const rows = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN (${COUNTERS.map((n) => `'${n}'`).join(', ')})${lock}`);
  const out = {} as Counters;
  for (const n of COUNTERS) {
    const r = rows.find((x) => String(x.T).trim() === n);
    if (!r) throw new ChannelSaveRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
    out[n] = Number(r.V);
  }
  return out;
}

/** PSVERSION moved, and PSLOCK set to the same value; SYS has no PSLOCK row App Designer moves [chn00, chn07]. */
function counterStatements(from: Counters, to: Counters): Statement[] {
  const st: Statement[] = [];
  for (const n of COUNTERS) {
    if (to[n] === from[n]) continue;
    st.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
    if (n !== 'SYS') st.push({ sql: `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, what: `Updating PSLOCK ${n}` });
  }
  return st;
}

const tombstoneDeletes = (rows: Row[], name: string): Statement[] =>
  rows.map((t) => ({ sql: 'DELETE FROM PSCHNLDEL WHERE CHNLNAME = :c AND VERSION = :v', binds: { c: name, v: t.VERSION }, expect: 1, what: 'Deleting PSCHNLDEL' }));

// ---------------------------------------------------------------------------
// Planning

export interface ChannelPlanSummary {
  changes: string[];
  inserted: number;
  updated: number;
  deleted: number;
  tombstones: string[];
}

export interface ChannelPlan {
  name: string;
  empty: boolean;
  statements: Statement[];
  desired: ChannelRows;
  increments: Partial<Counters>;
  counters: Counters;
  summary: ChannelPlanSummary;
}

export interface ChannelPlanOptions {
  operatorId: string;
  lastupddttm: string;
  counters: Counters;
  oracledb: DbTypes;
}

function channelColumnBinds(row: Row, oracledb: DbTypes): { cols: string[]; values: string[]; binds: Record<string, unknown> } {
  const cols: string[] = [];
  const values: string[] = [];
  const binds: Record<string, unknown> = {};
  Object.keys(row).forEach((col, i) => {
    cols.push(col);
    if (col === 'DESCRLONG') {
      if (row[col] === null || row[col] === undefined) { values.push('NULL'); return; }
      binds[`b${i}`] = { val: String(row[col]), type: oracledb.CLOB };
    } else binds[`b${i}`] = row[col];
    values.push(`:b${i}`);
  });
  return { cols, values, binds };
}

/**
 * The statements that turn the stored channel (missing: a create) into the
 * document: every save -- properties or partitions -- restamps the row with
 * the new CHDM and moves CHDM and SYS by one [chn00-chn15].
 */
export function planChannelSave(stored: StoredChannel | undefined, doc: ChannelDocument, opts: ChannelPlanOptions): ChannelPlan {
  const creating = !stored || !stored.exists;
  const s = creating ? undefined : stored!;
  const name = doc.name;
  if (s && String(s.rows.channel.CHNLNAME).trim() !== name) throw new ChannelSaveRefusedError('The stored channel is another one; refusing.');
  const desired = rowsFromDocument(doc);
  const changes: string[] = [];
  const counts = { inserted: 0, updated: 0, deleted: 0 };

  const columns: Row = {};
  if (s) {
    for (const col of Object.keys(desired.channel)) {
      if (STAMP.has(col) || col === 'CHNLNAME') continue;
      if (val(desired.channel[col]) !== val(s.rows.channel[col])) columns[col] = desired.channel[col];
    }
  }
  const storedFields = new Set((s?.rows.partitions ?? []).map((r) => String(r.FIELDNAME).trim()));
  const desiredFields = new Set(desired.partitions.map((r) => String(r.FIELDNAME)));
  const removed = [...storedFields].filter((f) => !desiredFields.has(f)).sort();
  const added = [...desiredFields].filter((f) => !storedFields.has(f)).sort();
  const changed = creating || Object.keys(columns).length > 0 || removed.length > 0 || added.length > 0;

  const inc: Partial<Counters> = changed ? { CHDM: 1, SYS: 1 } : {};
  const next = { ...opts.counters };
  for (const n of COUNTERS) next[n] += inc[n] ?? 0;
  const statements: Statement[] = [];
  const tombstones: string[] = [];
  if (changed) {
    for (const f of removed) {
      statements.push({ sql: 'DELETE FROM PSSUBCHNL WHERE CHNLNAME = :c AND FIELDNAME = :f', binds: { c: name, f }, expect: 1, what: 'Deleting PSSUBCHNL' });
      counts.deleted++;
    }
    if (creating) {
      const { cols, values, binds } = channelColumnBinds({ ...desired.channel, VERSION: next.CHDM, LASTUPDOPRID: opts.operatorId }, opts.oracledb);
      statements.push({
        sql: `INSERT INTO PSCHNLDEFN (${cols.join(', ')}, LASTUPDDTTM) VALUES (${values.join(', ')}, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}))`,
        binds: { ...binds, ts: opts.lastupddttm }, expect: 1, what: 'Inserting PSCHNLDEFN'
      });
      counts.inserted++;
      for (const r of [...desired.languages.map((x) => ['PSCHNLDEFNLANG', x] as const), ...desired.nodes.map((x) => ['PSCHNLNODE', x] as const)]) {
        const { cols: c2, values: v2, binds: b2 } = channelColumnBinds(r[1], opts.oracledb);
        statements.push({ sql: `INSERT INTO ${r[0]} (${c2.join(', ')}) VALUES (${v2.join(', ')})`, binds: b2, expect: 1, what: `Inserting ${r[0]}` });
      }
      // A name deleted before and created again loses its tombstone, as App Designer's other definitions do [mn19, ci28].
      statements.push(...tombstoneDeletes(stored?.tombstones ?? [], name));
      if (stored?.tombstones.length) tombstones.push(`PSCHNLDEL ${name} removed`);
      changes.push(`create message channel ${name}`);
    } else {
      const binds: Record<string, unknown> = { c: name, v: next.CHDM, ts: opts.lastupddttm, op: opts.operatorId };
      const sets = Object.keys(columns).map((col, i) => {
        binds[`u${i}`] = col === 'DESCRLONG' && columns[col] !== null ? { val: String(columns[col]), type: opts.oracledb.CLOB } : columns[col];
        return `${col} = :u${i}`;
      });
      statements.push({
        sql: `UPDATE PSCHNLDEFN SET ${[...sets, `VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op`].join(', ')} WHERE CHNLNAME = :c`,
        binds, expect: 1, what: 'Updating PSCHNLDEFN'
      });
      counts.updated++;
      for (const col of Object.keys(columns)) changes.push(`channel ${col}`);
    }
    for (const f of added) {
      statements.push({ sql: 'INSERT INTO PSSUBCHNL (CHNLNAME, FIELDNAME) VALUES (:c, :f)', binds: { c: name, f }, expect: 1, what: 'Inserting PSSUBCHNL' });
      counts.inserted++;
    }
    if (added.length) changes.push(`partition by ${added.join(', ')}`);
    if (removed.length) changes.push(`no longer partition by ${removed.join(', ')}`);
    if (!creating && !Object.keys(columns).length && !added.length && !removed.length) changes.push('channel row restamped');
    statements.push(...counterStatements(opts.counters, next));
  }
  return { name, empty: !changed, statements, desired, increments: inc, counters: next, summary: { changes, ...counts, tombstones } };
}

/**
 * File > Delete [chn08]: the channel's rows; PSCHNLDEL at the new CHDM; CHDM
 * and SYS + 1. Messages naming it and project items keep the name.
 */
export function planChannelDelete(stored: StoredChannel, counters: Counters): { statements: Statement[]; counters: Counters } {
  const name = String(stored.rows.channel.CHNLNAME).trim();
  const to = { ...counters, CHDM: counters.CHDM + 1, SYS: counters.SYS + 1 };
  const st: Statement[] = ['PSSUBCHNL', 'PSCHNLNODE', 'PSCHNLDEFNLANG'].map((t) => ({ sql: `DELETE FROM ${t} WHERE CHNLNAME = :c`, binds: { c: name }, what: `Deleting ${t}` }));
  st.push({ sql: 'DELETE FROM PSCHNLDEFN WHERE CHNLNAME = :c', binds: { c: name }, expect: 1, what: 'Deleting PSCHNLDEFN' });
  st.push({ sql: 'INSERT INTO PSCHNLDEL (CHNLNAME, VERSION) VALUES (:c, :v)', binds: { c: name, v: to.CHDM }, expect: 1, what: 'Inserting PSCHNLDEL' });
  st.push(...counterStatements(counters, to));
  return { statements: st, counters: to };
}

/**
 * File > Rename [chn07, chn17]: the channel's rows re-keyed in place, its
 * row restamped with the new CHDM and display name; messages naming it
 * repointed (VERSION the new MSDM, unstamped); its project items repointed
 * and their projects' VERSION the new PJM. No tombstone. CHDM, MSDM, PJM and
 * SYS each + 1, references or not.
 */
export function planChannelRename(stored: StoredChannel, to: string, target: StoredChannel, opts: ChannelPlanOptions): { statements: Statement[]; counters: Counters } {
  const from = String(stored.rows.channel.CHNLNAME).trim();
  const next = { ...opts.counters };
  for (const n of COUNTERS) next[n] += 1;
  const b = { f: from, t: to };
  const { objectType, objectId } = CHANNEL_PROJECT_ITEM;
  const st: Statement[] = [
    { sql: `UPDATE PSCHNLDEFN SET CHNLNAME = :t, CHNLDISPLAYNAME = :t, VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE CHNLNAME = :f`,
      binds: { ...b, v: next.CHDM, ts: opts.lastupddttm, op: opts.operatorId }, expect: 1, what: 'Renaming PSCHNLDEFN' },
    ...['PSSUBCHNL', 'PSCHNLNODE', 'PSCHNLDEFNLANG'].map((t) => ({ sql: `UPDATE ${t} SET CHNLNAME = :t WHERE CHNLNAME = :f`, binds: { ...b }, what: `Renaming ${t}` })),
    { sql: 'UPDATE PSMSGDEFN SET CHNLNAME = :t, VERSION = :v WHERE CHNLNAME = :f', binds: { ...b, v: next.MSDM }, what: 'Repointing PSMSGDEFN' },
    { sql: `UPDATE PSPROJECTDEFN SET VERSION = :v WHERE PROJECTNAME IN (SELECT PROJECTNAME FROM PSPROJECTITEM WHERE OBJECTTYPE = ${objectType} AND OBJECTID1 = ${objectId} AND OBJECTVALUE1 = :f)`,
      binds: { f: from, v: next.PJM }, what: 'Updating PSPROJECTDEFN' },
    { sql: `UPDATE PSPROJECTITEM SET OBJECTVALUE1 = :t WHERE OBJECTTYPE = ${objectType} AND OBJECTID1 = ${objectId} AND OBJECTVALUE1 = :f`, binds: { ...b }, what: 'Repointing PSPROJECTITEM' },
    ...tombstoneDeletes(target.tombstones, to),
    ...counterStatements(opts.counters, next)
  ];
  return { statements: st, counters: next };
}

// ---------------------------------------------------------------------------
// Running

export interface ChannelSaveRequest {
  doc: ChannelDocument;
  openedToken: string;
  operatorId: string;
  dryRun?: boolean;
}

export interface ChannelSaveResult {
  plan: ChannelPlan;
  token: string;
  written: boolean;
}

async function prepare(c: Connection, operatorId: string, name: string): Promise<void> {
  const operatorError = validateOperatorId(operatorId);
  if (operatorError) throw new ChannelSaveRefusedError(operatorError);
  const scope = writeScopeRefusal(name);
  if (scope) throw new ChannelSaveRefusedError(scope);
  if (!(await operatorExists(c, operatorId))) throw new ChannelSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
}

async function saveContext(c: Connection): Promise<{ counters: Counters; lastupddttm: string }> {
  const counters = await readChannelCounters(c, true);
  const [{ TS }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
  return { counters, lastupddttm: TS };
}

/** Saves the document in one transaction; refused on a validation error or a changed channel. */
export async function saveChannel(c: Connection, oracledb: DbTypes, request: ChannelSaveRequest): Promise<ChannelSaveResult> {
  try {
    await prepare(c, request.operatorId, request.doc.name);
    const problems = validateChannel(request.doc).filter((d) => d.severity === 'error');
    if (problems.length) throw new ChannelSaveRefusedError(`The message channel has errors: ${problems.slice(0, 5).map((p) => `${p.path}: ${p.message}`).join('; ')}`);
    const stored = await readStoredChannel(c, oracledb, request.doc.name, true);
    const token = channelToken(stored);
    if (token !== request.openedToken) {
      throw new ChannelSaveRefusedError(request.openedToken === 'absent'
        ? `A message channel named ${request.doc.name} already exists.`
        : `${request.doc.name} was changed in the database since it was opened (another save, possibly in App Designer). Reopen it and reapply your edit.`);
    }
    const ctx = await saveContext(c);
    const plan = planChannelSave(stored, request.doc, { operatorId: request.operatorId, ...ctx, oracledb });
    if (request.dryRun || plan.empty) {
      await c.rollback();
      return { plan, token, written: false };
    }
    await run(c, plan.statements);
    await verifyChannel(c, oracledb, plan);
    await c.commit();
    return { plan, token: channelToken(await readStoredChannel(c, oracledb, request.doc.name, false)), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

const shape = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort().map((k) => [k, val(r[k])]))).sort();

/** Proves the stored channel is the plan's: its row, partitions, VERSION and the counters. */
export async function verifyChannel(c: Connection, oracledb: DbTypes, plan: ChannelPlan): Promise<void> {
  const problems: string[] = [];
  const stored = await readStoredChannel(c, oracledb, plan.name, false);
  if (!stored.exists) throw new ChannelSaveRefusedError(`After the save there is no message channel ${plan.name}.`);
  const want = plan.desired;
  const got: Row = Object.fromEntries(Object.keys(want.channel).map((k) => [k, stored.rows.channel[k]]));
  if (JSON.stringify(shape([got])) !== JSON.stringify(shape([want.channel]))) problems.push('the channel row differs');
  if (JSON.stringify(shape(stored.rows.partitions)) !== JSON.stringify(shape(want.partitions))) problems.push('the partition rows differ');
  if (Number(stored.rows.channel.VERSION) !== plan.counters.CHDM) problems.push(`channel VERSION ${stored.rows.channel.VERSION}, ${plan.counters.CHDM} expected`);
  const now = await readChannelCounters(c, false);
  for (const n of COUNTERS) if (now[n] !== plan.counters[n]) problems.push(`PSVERSION ${n} ${now[n]}, ${plan.counters[n]} expected`);
  if (problems.length) throw new ChannelSaveRefusedError(`The written rows are not the planned ones (${problems.slice(0, 6).join('; ')}).`);
}

/** After COMMIT, on another connection: the channel is the one written. */
export async function verifyChannelSave(c: Connection, oracledb: DbTypes, result: ChannelSaveResult): Promise<void> {
  if (!result.written) return;
  if (channelToken(await readStoredChannel(c, oracledb, result.plan.name, false)) !== result.token) throw new ChannelSaveRefusedError('After COMMIT the message channel is not what was written.');
}

export async function deleteChannel(c: Connection, oracledb: DbTypes, name: string, openedToken: string, operatorId: string): Promise<{ counters: Counters }> {
  try {
    await prepare(c, operatorId, name);
    const stored = await readStoredChannel(c, oracledb, name, true);
    if (!stored.exists) throw new ChannelSaveRefusedError(`There is no message channel ${name}.`);
    if (channelToken(stored) !== openedToken) throw new ChannelSaveRefusedError(`${name} was changed in the database since it was opened.`);
    const plan = planChannelDelete(stored, await readChannelCounters(c, true));
    await run(c, plan.statements);
    if ((await readStoredChannel(c, oracledb, name, false)).exists) throw new ChannelSaveRefusedError(`${name} still has rows after the delete.`);
    await c.commit();
    return { counters: plan.counters };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

export async function renameChannel(c: Connection, oracledb: DbTypes, from: string, to: string, openedToken: string, operatorId: string): Promise<ChannelSaveResult> {
  try {
    await prepare(c, operatorId, from);
    const scope = writeScopeRefusal(to);
    if (scope) throw new ChannelSaveRefusedError(scope);
    const stored = await readStoredChannel(c, oracledb, from, true);
    if (!stored.exists) throw new ChannelSaveRefusedError(`There is no message channel ${from}.`);
    if (channelToken(stored) !== openedToken) throw new ChannelSaveRefusedError(`${from} was changed in the database since it was opened.`);
    const target = await readStoredChannel(c, oracledb, to, true);
    if (target.exists) throw new ChannelSaveRefusedError(`A message channel named ${to} already exists.`);
    const ctx = await saveContext(c);
    const plan = planChannelRename(stored, to, target, { operatorId, ...ctx, oracledb });
    await run(c, plan.statements);
    const after = await readStoredChannel(c, oracledb, to, false);
    if (!after.exists || (await readStoredChannel(c, oracledb, from, false)).exists) throw new ChannelSaveRefusedError(`The rename of ${from} to ${to} did not take.`);
    if (Number(after.rows.channel.VERSION) !== plan.counters.CHDM) throw new ChannelSaveRefusedError(`After the rename ${to} has VERSION ${after.rows.channel.VERSION}, ${plan.counters.CHDM} expected.`);
    await c.commit();
    const doc = channelDocumentOf(after);
    return {
      plan: {
        name: to, empty: false, statements: plan.statements, desired: rowsFromDocument(doc), increments: Object.fromEntries(COUNTERS.map((n) => [n, 1])), counters: plan.counters,
        summary: { changes: [`rename ${from} to ${to}`], inserted: 0, updated: 0, deleted: 0, tombstones: [] }
      },
      token: channelToken(after), written: true
    };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
