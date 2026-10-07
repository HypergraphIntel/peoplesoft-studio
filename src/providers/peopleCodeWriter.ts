import type { BindParameters, Connection } from 'oracledb';
import {
  checkStoredProgram, compileForSave, diffPrograms, expectedProgram, fingerprint, planProgram,
  prepareSourceForSave, SaveRefusedError, storedText, targetForKey, validateOperatorId,
  type PcmKey, type StoredProgram
} from '../peoplecode/writeback/savePlan.js';
import { writeScopeRefusal } from './writeScope.js';
import { RECORD_FIELD_EVENTS } from '../model/recordEvents.js';

/*
 * The native PeopleCode save transaction (docs/CONTROLLED_COMPILE_LAB.md,
 * Cycle 185 transition model; docs/PEOPLECODE_WRITEBACK.md). The rows come
 * from savePlan.ts; this module only moves them, in one transaction, in the
 * order the save protocol fixes, and proves what it wrote before and after
 * COMMIT.
 */

type OracleDb = typeof import('oracledb');

/** oracledb.OUT_FORMAT_OBJECT, which this module must not import at runtime (the bundle loads oracledb lazily). */
const OUT_FORMAT_OBJECT = 4002;

/** Matches the program by its seven OBJECTVALUEs, as reads do; :v1..:v7. */
export function valueBinds(parts: readonly string[]): Record<string, string> {
  const binds: Record<string, string> = {};
  for (let i = 0; i < 7; i++) binds[`v${i + 1}`] = parts[i] ?? ' ';
  return binds;
}
export const VALUE_PREDICATE = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTVALUE${n} = :v${n}`).join(' AND ');
const KEY_COLUMNS = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`OBJECTID${n}`, `OBJECTVALUE${n}`]);
/** Matches one exact stored key: all seven OBJECTIDs and OBJECTVALUEs; :i1..:i7, :v1..:v7. */
const EXACT_PREDICATE = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n} = :i${n} AND OBJECTVALUE${n} = :v${n}`).join(' AND ');
const exactBinds = (key: PcmKey) => ({
  ...Object.fromEntries(key.objectIds.map((id, i) => [`i${i + 1}`, Number(id)])),
  ...Object.fromEntries(key.objectValues.map((v, i) => [`v${i + 1}`, v]))
});
export const TIMESTAMP_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS.FF6'`;

/**
 * The program stored under a definition's OBJECTVALUEs, optionally locking
 * its rows. Undefined when there is none; refused when the values match
 * more than one stored key.
 */
export async function readStoredProgram(
  c: Connection, oracledb: OracleDb, parts: readonly string[], forUpdate: boolean
): Promise<StoredProgram | undefined> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const binds = valueBinds(parts);
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { PCTEXT: { type: oracledb.STRING } } };
  const text = (await c.execute<Record<string, unknown>>(
    `SELECT ${KEY_COLUMNS.join(', ')}, PROGSEQ, HASH_SIGNATURE, PCTEXT FROM SYSADM.PSPCMTXT WHERE ${VALUE_PREDICATE}${lock}`, binds, opts)).rows ?? [];
  const program = (await c.execute<Record<string, unknown>>(
    `SELECT ${KEY_COLUMNS.join(', ')}, PROGSEQ, VERSION, NAMECOUNT, PROGLEN, PROGRUNLOC, PROGFLAGS, LICENSE_CODE,
            TO_CHAR(LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM, LASTUPDOPRID, PROGEXTENDS, PTTOOLSREL, PROGTXT
       FROM SYSADM.PSPCMPROG WHERE ${VALUE_PREDICATE}${lock}`, binds, opts)).rows ?? [];
  const names = (await c.execute<Record<string, unknown>>(
    `SELECT ${KEY_COLUMNS.join(', ')}, NAMENUM, RECNAME, REFNAME, PACKAGEROOT, QUALIFYPATH, APPCLASSMETHOD
       FROM SYSADM.PSPCMNAME WHERE ${VALUE_PREDICATE}${lock}`, binds, opts)).rows ?? [];

  const all = [...text, ...program, ...names];
  if (all.length === 0) return undefined;
  const keyOf = (r: Record<string, unknown>) => KEY_COLUMNS.map((c) => String(r[c])).join('|');
  if (new Set(all.map(keyOf)).size > 1) {
    throw new SaveRefusedError('More than one stored PeopleCode key matches this definition; refusing to choose.');
  }
  const r0 = all[0];
  return {
    key: {
      objectIds: [1, 2, 3, 4, 5, 6, 7].map((n) => Number(r0[`OBJECTID${n}`])),
      objectValues: [1, 2, 3, 4, 5, 6, 7].map((n) => String(r0[`OBJECTVALUE${n}`]))
    },
    text: text.map((r) => ({ progseq: Number(r.PROGSEQ), text: String(r.PCTEXT ?? ''), hashSignature: String(r.HASH_SIGNATURE) })),
    program: program.map((r) => ({
      progseq: Number(r.PROGSEQ), version: Number(r.VERSION), namecount: Number(r.NAMECOUNT), proglen: Number(r.PROGLEN),
      progrunloc: Number(r.PROGRUNLOC), progflags: Number(r.PROGFLAGS), licenseCode: String(r.LICENSE_CODE),
      lastupddttm: String(r.LASTUPDDTTM), lastupdoprid: String(r.LASTUPDOPRID), progextends: String(r.PROGEXTENDS),
      pttoolsrel: String(r.PTTOOLSREL), bytes: Buffer.isBuffer(r.PROGTXT) ? r.PROGTXT : Buffer.alloc(0)
    })),
    names: names.map((r) => ({
      namenum: Number(r.NAMENUM), recname: String(r.RECNAME), refname: String(r.REFNAME),
      packageroot: String(r.PACKAGEROOT), qualifypath: String(r.QUALIFYPATH), appclassmethod: String(r.APPCLASSMETHOD)
    }))
  };
}

/** Read for editing: the stored source (what App Designer shows) and the concurrency token. */
export async function readForEdit(
  c: Connection, oracledb: OracleDb, parts: readonly string[]
): Promise<{ text: string; fingerprint: string } | undefined> {
  const stored = await readStoredProgram(c, oracledb, parts, false);
  if (!stored || stored.text.length === 0) return undefined;
  return { text: storedText(stored), fingerprint: fingerprint(stored) };
}

/** Rows as objects, whatever the driver's global outFormat. */
export async function select<T>(c: Connection, sql: string, binds: Record<string, unknown> = {}): Promise<T[]> {
  return ((await c.execute(sql, binds as BindParameters, { outFormat: OUT_FORMAT_OBJECT })).rows ?? []) as T[];
}

export async function operatorExists(c: Connection, operatorId: string): Promise<boolean> {
  const [r] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSOPRDEFN WHERE OPRID = :op`, { op: operatorId });
  return Number(r?.N ?? 0) > 0;
}

export interface PeopleCodeSaveRequest {
  /** The editor's text. */
  source: string;
  /** fingerprint() of the stored program when the editor opened it. */
  openedFingerprint: string;
  /** PSOPRDEFN.OPRID recorded as LASTUPDOPRID. */
  operatorId: string;
  /** Creating a new Application Class (its program does not exist yet): adds it to its root package (c04). */
  createClass?: boolean;
}

export interface PeopleCodeSaveResult {
  kind: 'saved' | 'deleted';
  /** The concurrency token of what is stored now. */
  fingerprint: string;
  version: number;
  lastupddttm?: string;
  /** The rows the save replaced, for restoring them. */
  before: StoredProgram;
  /** The source as stored (LF endings, final newline). */
  storedSource: string;
}

interface Counters { pcm: number; sys: number; lockPcm: number }

async function readCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('PCM', 'SYS')${lock}`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'PCM'${lock}`);
  const get = (name: string) => v.find((r) => String(r.T).trim() === name)?.V;
  const pcm = get('PCM');
  const sys = get('SYS');
  if (pcm === undefined || sys === undefined || l.length !== 1) {
    throw new SaveRefusedError('PSVERSION PCM / SYS or PSLOCK PCM is missing; refusing to save.');
  }
  return { pcm: Number(pcm), sys: Number(sys), lockPcm: Number(l[0].V) };
}

async function progDelVersions(c: Connection, key: PcmKey): Promise<number[]> {
  const r = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSPCMPROGDEL WHERE ${EXACT_PREDICATE}`, exactBinds(key));
  return r.map((x) => Number(x.V));
}

export async function expectRows(c: Connection, sql: string, binds: Record<string, unknown>, count: number, what: string): Promise<void> {
  const r = await c.execute(sql, binds as BindParameters);
  if ((r.rowsAffected ?? -1) !== count) {
    throw new SaveRefusedError(`${what} affected ${r.rowsAffected} rows, ${count} expected; rolled back.`);
  }
}

/**
 * Saves PeopleCode natively, in the protocol's order:
 *  1 lock and read the target; 2 re-check the concurrency token;
 *  3 prove the stored program re-encodes exactly; 4-5 compile the edited
 *  source and prove it decodes back; 6-7 lock the counters and compute
 *  the new values; 8 capture one database timestamp; 9-10 delete the key's
 *  PSPCMTXT / PSPCMPROG / PSPCMNAME rows and PSPCMPROGDEL marker; 11-13
 *  insert the new rows; 14-15 update PSVERSION PCM / SYS and PSLOCK PCM;
 *  16-17 re-read everything and verify it exactly; 18 COMMIT. Step 19
 *  (verify after commit, on another connection) is the caller's: see
 *  verifyCommitted. Any failure before COMMIT rolls back.
 *
 * An empty source deletes the program as App Designer does: the key's rows
 * go, PSPCMPROGDEL records the version, the counters move the same way.
 */
export async function savePeopleCode(
  c: Connection, oracledb: OracleDb, parts: readonly string[], request: PeopleCodeSaveRequest
): Promise<PeopleCodeSaveResult> {
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new SaveRefusedError(operatorError);
    // Scope before any lock: a definition outside the write scope is never
    // read FOR UPDATE.
    const scope = writeScopeRefusal(parts[0]);
    if (scope) throw new SaveRefusedError(scope);

    // 1-2
    const found = await readStoredProgram(c, oracledb, parts, true);
    if (fingerprint(found) !== request.openedFingerprint) {
      throw new SaveRefusedError('This PeopleCode was changed in the database since it was opened (another save, possibly in App Designer). Reopen it and reapply your edit.');
    }
    // Creating a program (cases 01-create, 11b-recreate): Record Field
    // PeopleCode only, for a field of the record, keyed as App Designer keys
    // it -- RECORD (1), FIELD (2), event (12), the other slots 0 / ' '.
    const creating = !found || found.program.length === 0;
    if (creating && found && (found.text.length > 0 || found.names.length > 0)) {
      throw new SaveRefusedError('This PeopleCode has source or name rows but no program rows; refusing to write over it.');
    }
    // A new Application Class (cases c04, c05): keyed PACKAGEROOT (104), its
    // subpackages (105, 106), class (107), OnExecute (12), with its
    // PSAPPCLASSDEFN row, any subpackage on its path that does not exist yet,
    // and the root package's VERSION moved to the new APM.
    const creatingClass = creating && request.createClass === true;
    let classPlan: ClassCreatePlan | undefined;
    if (creating) {
      if (prepareSourceForSave(request.source) === '') throw new SaveRefusedError('There is nothing to create: the program is empty.');
      if (creatingClass) {
        classPlan = await planClassCreate(c, parts);
      } else {
        if (parts.length !== 3 || !RECORD_FIELD_EVENTS.includes(parts[2])) {
          throw new SaveRefusedError('There is no stored program here; only Record Field PeopleCode and new Application Classes can be created yet.');
        }
        const [{ N }] = await select<{ N: number }>(c,
          `SELECT COUNT(*) AS N FROM SYSADM.PSRECFIELD WHERE RECNAME = :r AND FIELDNAME = :f`, { r: parts[0], f: parts[1] });
        if (Number(N) === 0) throw new SaveRefusedError(`${parts[1]} is not a field of ${parts[0]}.`);
      }
    }
    const stored: StoredProgram = creating
      ? {
        key: classPlan
          ? { objectIds: classPlan.objectIds, objectValues: [...parts, ...Array(7 - parts.length).fill(' ')] }
          : { objectIds: [1, 2, 12, 0, 0, 0, 0], objectValues: [parts[0], parts[1], parts[2], ' ', ' ', ' ', ' '] },
        text: [], program: [], names: []
      }
      : found!;
    const target = targetForKey(stored.key);
    if (!(await operatorExists(c, request.operatorId))) {
      throw new SaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }
    const status = (await select<{ R: string }>(c, `SELECT TOOLSREL AS R FROM SYSADM.PSSTATUS`))[0]?.R;
    if (!status) throw new SaveRefusedError('PSSTATUS has no TOOLSREL; refusing to save.');
    const toolsRelease = String(status).trim();

    // 3 (nothing stored to check when creating)
    if (!creating) checkStoredProgram(stored, target, toolsRelease);

    // 4-5
    const source = prepareSourceForSave(request.source);
    const plan = source === '' ? undefined : planProgram(source, compileForSave(source, target, toolsRelease));

    // 6-7
    const counters = await readCounters(c, true);
    // One transaction moves SYS once, a new class's package save included (c05; c04 was two saves).
    const next: Counters = { pcm: counters.pcm + 1, sys: counters.sys + 1, lockPcm: counters.lockPcm + 1 };

    // 8
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    // 9-10
    const key = stored.key;
    const kb = exactBinds(key);
    await expectRows(c, `DELETE FROM SYSADM.PSPCMTXT WHERE ${EXACT_PREDICATE}`, kb, stored.text.length, 'Deleting PSPCMTXT');
    await expectRows(c, `DELETE FROM SYSADM.PSPCMPROG WHERE ${EXACT_PREDICATE}`, kb, stored.program.length, 'Deleting PSPCMPROG');
    await expectRows(c, `DELETE FROM SYSADM.PSPCMNAME WHERE ${EXACT_PREDICATE}`, kb, stored.names.length, 'Deleting PSPCMNAME');
    await c.execute(`DELETE FROM SYSADM.PSPCMPROGDEL WHERE ${EXACT_PREDICATE}`, kb as BindParameters);

    const keyValues = (prefix = '') => Object.fromEntries([
      ...key.objectIds.map((id, i) => [`${prefix}i${i + 1}`, Number(id)]),
      ...key.objectValues.map((v, i) => [`${prefix}v${i + 1}`, v])
    ]);
    const keyInsertColumns = KEY_COLUMNS.join(', ');
    const keyInsertBinds = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`:i${n}`, `:v${n}`]).join(', ');

    let expected: StoredProgram | undefined;
    if (plan) {
      expected = expectedProgram(key, plan, { version: next.pcm, lastupddttm, operatorId: request.operatorId });
      // 11
      for (const row of expected.text) {
        await expectRows(c,
          `INSERT INTO SYSADM.PSPCMTXT (${keyInsertColumns}, PROGSEQ, HASH_SIGNATURE, PCTEXT)
           VALUES (${keyInsertBinds}, :progseq, :sig, :text)`,
          { ...keyValues(), progseq: row.progseq, sig: row.hashSignature, text: { val: row.text, type: oracledb.CLOB } },
          1, 'Inserting PSPCMTXT');
      }
      // 12
      for (const row of expected.program) {
        await expectRows(c,
          `INSERT INTO SYSADM.PSPCMPROG (${keyInsertColumns}, PROGSEQ, VERSION, NAMECOUNT, PROGLEN, PROGRUNLOC, PROGFLAGS,
             LICENSE_CODE, LASTUPDDTTM, LASTUPDOPRID, PROGEXTENDS, PTTOOLSREL, PROGTXT)
           VALUES (${keyInsertBinds}, :progseq, :version, :namecount, :proglen, :progrunloc, :progflags,
             :license, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :oprid, :progextends, :pttoolsrel, :bytes)`,
          {
            ...keyValues(), progseq: row.progseq, version: row.version, namecount: row.namecount, proglen: row.proglen,
            progrunloc: row.progrunloc, progflags: row.progflags, license: row.licenseCode, ts: row.lastupddttm,
            oprid: row.lastupdoprid, progextends: row.progextends, pttoolsrel: row.pttoolsrel,
            bytes: { val: row.bytes, type: oracledb.BLOB }
          },
          1, 'Inserting PSPCMPROG');
      }
      // 13
      for (const row of expected.names) {
        await expectRows(c,
          `INSERT INTO SYSADM.PSPCMNAME (${keyInsertColumns}, NAMENUM, RECNAME, REFNAME, PACKAGEROOT, QUALIFYPATH, APPCLASSMETHOD)
           VALUES (${keyInsertBinds}, :namenum, :recname, :refname, :packageroot, :qualifypath, :appclassmethod)`,
          { ...keyValues(), ...row },
          1, 'Inserting PSPCMNAME');
      }
    } else {
      await expectRows(c,
        `INSERT INTO SYSADM.PSPCMPROGDEL (${keyInsertColumns}, VERSION) VALUES (${keyInsertBinds}, :version)`,
        { ...keyValues(), version: next.pcm }, 1, 'Inserting PSPCMPROGDEL');
    }

    if (classPlan) await writeClassCreate(c, classPlan, lastupddttm, request.operatorId);

    // 14-15
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PCM'`, { v: next.pcm }, 1, 'Updating PSVERSION PCM');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PCM'`, { v: next.lockPcm }, 1, 'Updating PSLOCK PCM');

    // 16-17
    await verifyState(c, oracledb, parts, key, expected, next);

    // 18
    await c.commit();
    return {
      kind: plan ? 'saved' : 'deleted',
      fingerprint: fingerprint(expected),
      version: next.pcm,
      ...(plan ? { lastupddttm } : {}),
      before: stored,
      storedSource: source
    };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/**
 * Proves the stored state is exactly the save's: the program's rows equal
 * the plan column for column (or are absent after a delete), PSPCMPROGDEL
 * holds the marker only after a delete, and the counters are the new ones.
 */
export async function verifyState(
  c: Connection, oracledb: OracleDb, parts: readonly string[], key: PcmKey,
  expected: StoredProgram | undefined, counters: Counters
): Promise<void> {
  const problems: string[] = [];
  const actual = await readStoredProgram(c, oracledb, parts, false);
  if (expected) {
    if (!actual) problems.push('the program is missing');
    else problems.push(...diffPrograms(expected, actual));
  } else if (actual) {
    problems.push('the program still has rows after a delete');
  }
  const marker = await progDelVersions(c, key);
  if (expected && marker.length > 0) problems.push('PSPCMPROGDEL still marks the program deleted');
  if (!expected && (marker.length !== 1 || marker[0] !== counters.pcm)) problems.push(`PSPCMPROGDEL holds ${JSON.stringify(marker)}, [${counters.pcm}] expected`);
  const now = await readCounters(c, false);
  if (now.pcm !== counters.pcm || now.sys !== counters.sys || now.lockPcm !== counters.lockPcm) {
    problems.push(`counters ${JSON.stringify(now)}, ${JSON.stringify(counters)} expected`);
  }
  if (problems.length > 0) {
    throw new SaveRefusedError(`The written rows are not the planned ones (${problems.slice(0, 6).join('; ')}).`);
  }
}

/** Step 19: re-read on another connection after COMMIT. */
export async function verifyCommitted(
  c: Connection, oracledb: OracleDb, parts: readonly string[], result: PeopleCodeSaveResult
): Promise<void> {
  const actual = await readStoredProgram(c, oracledb, parts, false);
  const problems: string[] = [];
  if (result.kind === 'saved') {
    if (fingerprint(actual) !== result.fingerprint) problems.push('the committed program differs from what was written');
  } else if (actual) {
    problems.push('the committed program still has rows');
  }
  const marker = await progDelVersions(c, result.before.key);
  if (result.kind === 'deleted' && !marker.includes(result.version)) problems.push('PSPCMPROGDEL has no marker');
  if (result.kind === 'saved' && marker.length > 0) problems.push('PSPCMPROGDEL still marks the program deleted');
  if (problems.length > 0) {
    throw new SaveRefusedError(`After COMMIT: ${problems.join('; ')}. The replaced rows are in the save report for restoring.`);
  }
}

/** What creating an Application Class adds besides its program (cases c04, c05). */
interface ClassCreatePlan {
  root: string;
  /** Subpackage IDs from the root down (at most two, as on HRDMO). */
  subs: string[];
  className: string;
  /** PSAPPCLASSDEFN.QUALIFYPATH: ':' in the root, else the subpackage path joined by ':'. */
  classPath: string;
  objectIds: number[];
  /** Subpackages on the path that do not exist yet, with their PSPACKAGEDEFN QUALIFYPATH and level. */
  missing: { id: string; qualifyPath: string; level: number }[];
}

const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;

/** A subpackage's PSPACKAGEDEFN QUALIFYPATH: ':' at level 1, its parent's ID at level 2 (ADS_DMW:UI:Widgets is 'UI'). */
export function packageQualifyPath(subs: readonly string[], level: number): string {
  return level === 1 ? ':' : subs.slice(0, level - 1).join(':');
}

async function planClassCreate(c: Connection, parts: readonly string[]): Promise<ClassCreatePlan> {
  if (parts.length < 3 || parts.length > 5 || parts.at(-1) !== 'OnExecute') {
    throw new SaveRefusedError('A class is created in a package at most two subpackages deep.');
  }
  const [root, ...rest] = parts.slice(0, -1);
  const className = rest.pop()!;
  const subs = rest;
  for (const id of [...subs, className]) {
    if (!PACKAGE_ID.test(id)) throw new SaveRefusedError(`${id} is not a valid package or class name (a letter, then letters, digits or _; at most 30).`);
  }
  const [pkg] = await select<{ V: number }>(c,
    `SELECT VERSION AS V FROM SYSADM.PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.' FOR UPDATE`, { r: root });
  if (!pkg) throw new SaveRefusedError(`There is no Application Package ${root}.`);
  const missing: ClassCreatePlan['missing'] = [];
  for (let level = 1; level <= subs.length; level++) {
    const qualifyPath = packageQualifyPath(subs, level);
    const [row] = await select<{ L: number }>(c,
      `SELECT PACKAGELEVEL AS L FROM SYSADM.PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :p AND QUALIFYPATH = :q FOR UPDATE`,
      { r: root, p: subs[level - 1], q: qualifyPath });
    if (row && Number(row.L) !== level) throw new SaveRefusedError(`${root}:${subs.slice(0, level).join(':')} is stored at another level; refusing to write.`);
    if (!row) missing.push({ id: subs[level - 1], qualifyPath, level });
  }
  const classPath = subs.length === 0 ? ':' : subs.join(':');
  const [{ N: classes }] = await select<{ N: number }>(c,
    `SELECT COUNT(*) AS N FROM SYSADM.PSAPPCLASSDEFN WHERE PACKAGEROOT = :r AND QUALIFYPATH = :q AND UPPER(APPCLASSID) = UPPER(:k)`,
    { r: root, q: classPath, k: className });
  if (Number(classes) > 0) throw new SaveRefusedError(`${[root, ...subs].join(':')} already has a class ${className}.`);
  const objectIds = [104, ...subs.map((_, i) => 105 + i), 107, 12];
  return { root, subs, className, classPath, objectIds: [...objectIds, ...Array(7 - objectIds.length).fill(0)], missing };
}

/**
 * The package side of a new class, in the class's transaction: its
 * PSAPPCLASSDEFN row, each missing subpackage (PSPACKAGEDEFN), and every
 * package row under the root -- the root's and each subpackage's -- given
 * VERSION = the new APM and the save's stamp (c06: the root and SUB1 both);
 * PSVERSION and PSLOCK APM + 1. App Designer also deletes and reinserts the
 * package's other class rows unchanged, which leaves them as they are.
 */
async function writeClassCreate(c: Connection, plan: ClassCreatePlan, lastupddttm: string, operatorId: string): Promise<void> {
  const apm = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME = 'APM' FOR UPDATE`);
  const lockApm = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'APM' FOR UPDATE`);
  if (apm.length !== 1 || lockApm.length !== 1) throw new SaveRefusedError('PSVERSION / PSLOCK APM is missing; refusing to save.');
  const newApm = Number(apm[0].V) + 1;
  const stamp = { ts: lastupddttm, op: operatorId };
  for (const sub of plan.missing) {
    await expectRows(c,
      `INSERT INTO SYSADM.PSPACKAGEDEFN (PACKAGEID, PACKAGEROOT, QUALIFYPATH, PACKAGELEVEL, PACKAGEREF, DESCR, VERSION,
                                         LASTUPDDTTM, LASTUPDOPRID, OBJECTOWNERID, DESCRLONG)
       VALUES (:p, :r, :q, :l, ' ', ' ', :v, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, ' ', NULL)`,
      { p: sub.id, r: plan.root, q: sub.qualifyPath, l: sub.level, v: newApm, ...stamp }, 1, `Inserting PSPACKAGEDEFN ${sub.id}`);
  }
  await expectRows(c,
    `INSERT INTO SYSADM.PSAPPCLASSDEFN (APPCLASSID, PACKAGEROOT, QUALIFYPATH, APPCLASSREF, DESCR) VALUES (:k, :r, :q, ' ', ' ')`,
    { k: plan.className, r: plan.root, q: plan.classPath }, 1, 'Inserting PSAPPCLASSDEFN');
  const [{ N: packages }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM SYSADM.PSPACKAGEDEFN WHERE PACKAGEROOT = :r`, { r: plan.root });
  await expectRows(c,
    `UPDATE SYSADM.PSPACKAGEDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
      WHERE PACKAGEROOT = :r`,
    { v: newApm, r: plan.root, ...stamp }, Number(packages), 'Updating PSPACKAGEDEFN');
  await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: newApm }, 1, 'Updating PSVERSION APM');
  await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: Number(lockApm[0].V) + 1 }, 1, 'Updating PSLOCK APM');
  const [check] = await select<{ V: number; N: number; S: number }>(c,
    `SELECT (SELECT VERSION FROM SYSADM.PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.') AS V,
            (SELECT COUNT(*) FROM SYSADM.PSAPPCLASSDEFN WHERE PACKAGEROOT = :r AND APPCLASSID = :k AND QUALIFYPATH = :q) AS N,
            (SELECT COUNT(*) FROM SYSADM.PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND VERSION = :v AND LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT})) AS S
       FROM DUAL`,
    { r: plan.root, k: plan.className, q: plan.classPath, v: newApm, ts: lastupddttm });
  if (Number(check?.V) !== newApm || Number(check?.N) !== 1 || Number(check?.S) !== Number(packages)) {
    throw new SaveRefusedError('The new class did not land in its package as planned; rolled back.');
  }
}

