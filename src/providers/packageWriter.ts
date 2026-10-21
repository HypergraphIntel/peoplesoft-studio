import type { DbConnection as Connection } from '../db/connection.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { packageQualifyPath } from './peopleCodeWriter.js';
import { deletePrograms, moveCounters, nextCounters, programKeys } from './pageMigration.js';

/*
 * Creating an empty Application Package, as App Designer's first save of a
 * new one does (case c03, ZZ_PCODE_LAB_PK2):
 *
 *   PSPACKAGEDEFN  PACKAGEID = PACKAGEROOT = the name, QUALIFYPATH '.',
 *                  PACKAGELEVEL 0, PACKAGEREF / DESCR / OBJECTOWNERID ' ', no
 *                  DESCRLONG; VERSION = the new PSVERSION APM; stamped
 *   PSVERSION      APM + 1, SYS + 1
 *   PSLOCK         APM + 1
 *
 * Scope: a root package without classes.
 */

export class PackageCreateRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageCreateRefusedError';
  }
}

export interface SubpackageCreateRequest {
  root: string;
  /** Full path below the root, including the new final segment. */
  path: string[];
  openedVersion: number;
  operatorId: string;
  dryRun?: boolean;
}

/** Package rows/counters use the observed c05/c06 package-save protocol, without creating a class. */
export async function createSubpackage(c: Connection, request: SubpackageCreateRequest): Promise<{ version: number; lastupddttm: string }> {
  const { root, path, operatorId } = request;
  try {
    const operatorError = validateOperatorId(operatorId);
    if (operatorError) throw new PackageCreateRefusedError(operatorError);
    if (!/^[A-Z0-9_]{1,30}$/.test(root) || path.length < 1 || path.length > 2 ||
        path.some(id => !/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(id))) {
      throw new PackageCreateRefusedError('Choose a valid package path, at most two subpackages deep.');
    }
    const scope = writeScopeRefusal(root);
    if (scope) throw new PackageCreateRefusedError(scope);
    const [head] = await select<{ V: number }>(c,
      `SELECT VERSION AS V FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.' FOR UPDATE`, { r: root });
    if (!head || !Number.isSafeInteger(request.openedVersion) || Number(head.V) !== request.openedVersion) {
      throw new PackageCreateRefusedError('The package changed or was removed since it was opened. Refresh it and try again.');
    }
    if (!(await operatorExists(c, operatorId))) throw new PackageCreateRefusedError(`PeopleSoft operator ${operatorId} does not exist.`);
    if (path.length === 2) {
      const parent = await select<{ L: number }>(c,
        `SELECT PACKAGELEVEL AS L FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :p AND QUALIFYPATH = ':' FOR UPDATE`, { r: root, p: path[0] });
      if (parent.length !== 1 || Number(parent[0].L) !== 1) throw new PackageCreateRefusedError('The parent subpackage no longer exists. Refresh the package.');
    }
    const name = path.at(-1)!, qualify = packageQualifyPath(path, path.length);
    const [{ N: occupied }] = await select<{ N: number }>(c,
      `SELECT (SELECT COUNT(*) FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND UPPER(PACKAGEID) = UPPER(:p) AND QUALIFYPATH = :q)
            + (SELECT COUNT(*) FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r AND UPPER(APPCLASSID) = UPPER(:p) AND QUALIFYPATH = :q) AS N FROM DUAL`,
      { r: root, p: name, q: qualify });
    if (Number(occupied)) throw new PackageCreateRefusedError(`${name} already exists in this package.`);
    const versions = await select<{ T: string; V: number }>(c,
      `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('APM', 'SYS') FOR UPDATE`);
    const locks = await select<{ V: number }>(c, `SELECT VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME = 'APM' FOR UPDATE`);
    const next = (type: string) => {
      const row = versions.find(v => String(v.T).trim() === type);
      if (!row) throw new PackageCreateRefusedError(`PSVERSION ${type} is missing.`);
      return Number(row.V) + 1;
    };
    if (locks.length !== 1) throw new PackageCreateRefusedError('PSLOCK APM is missing.');
    const version = next('APM'), sys = next('SYS');
    const [{ TS: stamp }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const [{ N: count }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r`, { r: root });
    await expectRows(c,
      `INSERT INTO PSPACKAGEDEFN (PACKAGEID, PACKAGEROOT, QUALIFYPATH, PACKAGELEVEL, PACKAGEREF, DESCR, VERSION,
        LASTUPDDTTM, LASTUPDOPRID, OBJECTOWNERID, DESCRLONG)
       VALUES (:p, :r, :q, :l, ' ', ' ', :v, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, ' ', NULL)`,
      { p: name, r: root, q: qualify, l: path.length, v: version, ts: stamp, op: operatorId }, 1, 'Inserting subpackage');
    await expectRows(c, `UPDATE PSPACKAGEDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE PACKAGEROOT = :r`,
      { v: version, ts: stamp, op: operatorId, r: root }, Number(count) + 1, 'Updating package');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: version }, 1, 'Updating PSVERSION APM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: Number(locks[0].V) + 1 }, 1, 'Updating PSLOCK APM');
    const [{ N: verified }] = await select<{ N: number }>(c,
      `SELECT COUNT(*) AS N FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND VERSION = :v AND LASTUPDOPRID = :op AND LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT})`,
      { r: root, v: version, op: operatorId, ts: stamp });
    const created = await select<{ L: number }>(c,
      `SELECT PACKAGELEVEL AS L FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :p AND QUALIFYPATH = :q`, { r: root, p: name, q: qualify });
    if (Number(verified) !== Number(count) + 1 || created.length !== 1 || Number(created[0].L) !== path.length) {
      throw new PackageCreateRefusedError('Subpackage readback did not match the save; rolled back.');
    }
    if (request.dryRun) await c.rollback(); else await c.commit();
    return { version, lastupddttm: stamp };
  } catch (error) {
    await c.rollback().catch(() => {});
    throw error;
  }
}

export async function createPackage(c: Connection, request: { name: string; operatorId: string }): Promise<{ version: number; lastupddttm: string }> {
  const name = request.name;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new PackageCreateRefusedError(operatorError);
    if (!/^[A-Z0-9_]{1,30}$/.test(name)) throw new PackageCreateRefusedError(`${name} is not a valid package name (A-Z, 0-9, _; at most 30).`);
    const scope = writeScopeRefusal(name);
    if (scope) throw new PackageCreateRefusedError(scope);
    const [{ N: taken }] = await select<{ N: number }>(c,
      `SELECT (SELECT COUNT(*) FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :n OR PACKAGEID = :n)
            + (SELECT COUNT(*) FROM PSPCMPROG WHERE OBJECTID1 = 104 AND OBJECTVALUE1 = :n) AS N FROM DUAL`, { n: name });
    if (Number(taken) > 0) throw new PackageCreateRefusedError(`A package named ${name} already exists, or left rows behind.`);
    if (!(await operatorExists(c, request.operatorId))) {
      throw new PackageCreateRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const v = await select<{ T: string; V: number }>(c,
      `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('APM', 'SYS') FOR UPDATE`);
    const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME = 'APM' FOR UPDATE`);
    const get = (n: string) => {
      const r = v.find((x) => String(x.T).trim() === n);
      if (!r) throw new PackageCreateRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
      return Number(r.V) + 1;
    };
    if (l.length !== 1) throw new PackageCreateRefusedError('PSLOCK APM is missing; refusing to write.');
    const next = { apm: get('APM'), sys: get('SYS'), lockApm: Number(l[0].V) + 1 };
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    // Creating a deleted name clears its PSPACKAGEDEL tombstone, as App Designer's save does (dl11).
    await c.execute(`DELETE FROM PSPACKAGEDEL WHERE PACKAGEROOT = :n AND PACKAGEID = :n AND QUALIFYPATH = '.'`, { n: name });
    await expectRows(c,
      `INSERT INTO PSPACKAGEDEFN (PACKAGEID, PACKAGEROOT, QUALIFYPATH, PACKAGELEVEL, PACKAGEREF, DESCR, VERSION,
                                         LASTUPDDTTM, LASTUPDOPRID, OBJECTOWNERID, DESCRLONG)
       VALUES (:n, :n, '.', 0, ' ', ' ', :v, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, ' ', NULL)`,
      { n: name, v: next.apm, ts: lastupddttm, op: request.operatorId }, 1, 'Inserting PSPACKAGEDEFN');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: next.apm }, 1, 'Updating PSVERSION APM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: next.lockApm }, 1, 'Updating PSLOCK APM');

    const [d] = await select<{ VERSION: number; TS: string }>(c,
      `SELECT VERSION, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM PSPACKAGEDEFN
        WHERE PACKAGEROOT = :n AND PACKAGEID = :n AND QUALIFYPATH = '.'`, { n: name });
    if (!d || Number(d.VERSION) !== next.apm || d.TS !== lastupddttm) throw new PackageCreateRefusedError('The package did not land as planned; rolled back.');
    await c.commit();
    return { version: next.apm, lastupddttm };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

export interface PackagePropertiesRequest {
  root: string;
  openedVersion: number;
  /** PSPACKAGEDEFN.DESCR, at most 30; '' is stored blank. */
  description: string;
  /** DESCRLONG; '' stores NULL. */
  comments: string;
  /** OBJECTOWNERID, at most 4; '' is stored blank. */
  ownerId: string;
  operatorId: string;
  dryRun?: boolean;
}

/**
 * The root package's Package Properties, as App Designer saves them (pk01): the root row's DESCR, OBJECTOWNERID and
 * DESCRLONG; every package row under the root at the new APM with the save's stamp; PSVERSION APM/SYS and PSLOCK APM + 1.
 */
export async function savePackageProperties(c: Connection, request: PackagePropertiesRequest): Promise<{ version: number; lastupddttm: string }> {
  const { root, operatorId } = request;
  try {
    const refusal = validateOperatorId(operatorId) ?? writeScopeRefusal(root);
    if (refusal) throw new PackageCreateRefusedError(refusal);
    if (request.description.length > 30 || request.description !== request.description.trimEnd()) throw new PackageCreateRefusedError('A package description is at most 30 characters, without trailing blanks.');
    if (!/^[A-Z0-9_]{0,4}$/.test(request.ownerId)) throw new PackageCreateRefusedError('The owner ID is at most four characters (A-Z, 0-9, _).');
    if (request.comments.length > 4000) throw new PackageCreateRefusedError('Package comments are limited to 4,000 characters here.');
    const [head] = await select<{ V: number }>(c,
      `SELECT VERSION AS V FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.' FOR UPDATE`, { r: root });
    if (!head || Number(head.V) !== request.openedVersion) throw new PackageCreateRefusedError('The package changed or was removed since it was opened. Refresh it and try again.');
    if (!(await operatorExists(c, operatorId))) throw new PackageCreateRefusedError(`PeopleSoft operator ${operatorId} does not exist.`);
    const versions = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('APM', 'SYS') FOR UPDATE`);
    const locks = await select<{ V: number }>(c, `SELECT VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME = 'APM' FOR UPDATE`);
    const next = (type: string) => { const row = versions.find(v => String(v.T).trim() === type); if (!row) throw new PackageCreateRefusedError(`PSVERSION ${type} is missing.`); return Number(row.V) + 1; };
    if (locks.length !== 1) throw new PackageCreateRefusedError('PSLOCK APM is missing.');
    const version = next('APM'), sys = next('SYS');
    const [{ TS: stamp }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const [{ N: count }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r`, { r: root });
    await expectRows(c, `UPDATE PSPACKAGEDEFN SET DESCR = :d, OBJECTOWNERID = :o, DESCRLONG = :l WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`,
      { d: request.description || ' ', o: request.ownerId || ' ', l: request.comments || null, r: root }, 1, 'Updating package properties');
    await expectRows(c, `UPDATE PSPACKAGEDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE PACKAGEROOT = :r`,
      { v: version, ts: stamp, op: operatorId, r: root }, Number(count), 'Updating package');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: version }, 1, 'Updating PSVERSION APM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: Number(locks[0].V) + 1 }, 1, 'Updating PSLOCK APM');
    const [row] = await select<{ D: string; O: string; L: string | null }>(c,
      `SELECT DESCR AS D, OBJECTOWNERID AS O, DBMS_LOB.SUBSTR(DESCRLONG, 4000, 1) AS L FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: root });
    if (!row || String(row.D).trimEnd() !== request.description || String(row.O).trim() !== request.ownerId || (row.L ?? '') !== request.comments.slice(0, 4000))
      throw new PackageCreateRefusedError('Package properties readback did not match the save; rolled back.');
    if (request.dryRun) await c.rollback(); else await c.commit();
    return { version, lastupddttm: stamp };
  } catch (error) {
    await c.rollback().catch(() => {});
    throw error;
  }
}

/** Rows naming the package outside its own definition tables, in every table with a PACKAGEROOT column (IB handlers, configuration, references). */
async function packageUsers(c: Connection, root: string, ownTables: readonly string[]): Promise<string[]> {
  const tables = await select<{ T: string }>(c, `SELECT T.TABLE_NAME AS T FROM ALL_TABLES T WHERE T.OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND T.TABLE_NAME LIKE 'PS%'
    AND EXISTS (SELECT 1 FROM ALL_TAB_COLUMNS C WHERE C.OWNER = T.OWNER AND C.TABLE_NAME = T.TABLE_NAME AND C.COLUMN_NAME = 'PACKAGEROOT') ORDER BY 1`);
  const users: string[] = [];
  for (const { T } of tables) {
    const table = String(T);
    if (ownTables.includes(table) || !/^[A-Z0-9_]+$/.test(table)) continue;
    // PeopleCode inside the package may name it; any other program that does is a user.
    const own = table === 'PSPCMNAME' ? ' AND NOT (OBJECTID1 = 104 AND OBJECTVALUE1 = :r)' : '';
    const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE PACKAGEROOT = :r${own}`, { r: root });
    if (Number(N)) users.push(table);
  }
  return users;
}
const PACKAGE_TABLES = ['PSPACKAGEDEFN', 'PSPACKAGEDEL', 'PSAPPCLASSDEFN'];
async function lockPackage(c: Connection, root: string, openedVersion: number) {
  const [head] = await select<{ V: number }>(c, `SELECT VERSION AS V FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.' FOR UPDATE`, { r: root });
  if (!head || Number(head.V) !== openedVersion) throw new PackageCreateRefusedError('The package changed or was removed since it was opened. Refresh it and try again.');
}

/**
 * Deleting one class from the package editor, then saving the package (dl09): the class row and its PeopleCode go with a
 * PSPCMPROGDEL at the new PCM; PCM/PBM and their locks + 1; every package row moves to the new APM with the save's stamp
 * (APM and lock + 1); SYS + 2, once per step. Programs outside the package that name it refuse.
 */
export async function deleteClass(c: Connection, request: { root: string; path: readonly string[]; className: string; openedVersion: number; operatorId: string; dryRun?: boolean }) {
  const { root, path, className, operatorId } = request;
  try {
    const refusal = validateOperatorId(operatorId) ?? writeScopeRefusal(root);
    if (refusal) throw new PackageCreateRefusedError(refusal);
    if (path.length > 2 || [...path, className].some(id => !/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(id))) throw new PackageCreateRefusedError('Invalid class path.');
    if (!(await operatorExists(c, operatorId))) throw new PackageCreateRefusedError(`PeopleSoft operator ${operatorId} does not exist.`);
    await lockPackage(c, root, request.openedVersion);
    const qualify = path.length ? path.join(':') : ':';
    if (!(await select(c, `SELECT 1 FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r AND QUALIFYPATH = :q AND APPCLASSID = :k FOR UPDATE`, { r: root, q: qualify, k: className })).length)
      throw new PackageCreateRefusedError(`${[root, ...path, className].join(':')} does not exist.`);
    const users = await packageUsers(c, root, [...PACKAGE_TABLES, 'PSPACKAGELANG']);
    if (users.length) throw new PackageCreateRefusedError(`${root} is named outside the package (${users.slice(0, 5).join(', ')}); deleting its classes needs a wider review.`);
    const values = [root, ...path, className, 'OnExecute'];
    const ids = [104, ...path.map((_, i) => 105 + i), 107, 12];
    const extra = ids.slice(1).map((id, i) => ` AND OBJECTID${i + 2} = ${id} AND OBJECTVALUE${i + 2} = :v${i + 2}`).join('');
    const programs = await programKeys(c, 104, root, extra, Object.fromEntries(values.slice(1).map((v, i) => ['v' + (i + 2), v])));
    const start = await nextCounters(c, ['PCM', 'PBM', 'APM']);
    await deletePrograms(c, programs, programs.map(() => start.version.PCM + 1));
    await expectRows(c, `DELETE FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r AND QUALIFYPATH = :q AND APPCLASSID = :k`, { r: root, q: qualify, k: className }, 1, 'Deleting PSAPPCLASSDEFN');
    const [{ TS: stamp }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const [{ N: count }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r`, { r: root });
    await expectRows(c, `UPDATE PSPACKAGEDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE PACKAGEROOT = :r`,
      { v: start.version.APM + 1, ts: stamp, op: operatorId, r: root }, Number(count), 'Updating package');
    await moveCounters(c, start, { PCM: 1, PBM: 1, APM: 1, SYS: 2 });
    if (request.dryRun) await c.rollback(); else await c.commit();
    return { version: start.version.APM + 1 };
  } catch (error) {
    await c.rollback().catch(() => {});
    throw error;
  }
}

/**
 * File > Delete of an Application Package (dl04, dl05, dl10): its package rows, classes and their PeopleCode go;
 * PSPACKAGEDEL for the root at the new APM; APM/SYS and lock APM + 1; PCM and lock PCM + 1 plus one per class, each class's
 * PSPCMPROGDEL taking the following PCM values (dl05 ordered them by descending QUALIFYPATH). Anything outside the
 * package that names it, or a project that lists it, refuses unless a rollback preview assumes those projects deleted.
 */
export async function deletePackage(c: Connection, request: { root: string; openedVersion: number; operatorId: string; dryRun?: boolean; proposedProjectDeletions?: readonly string[] }) {
  const { root, operatorId } = request;
  try {
    if (request.proposedProjectDeletions?.length && !request.dryRun) throw new PackageCreateRefusedError('Proposed deletions are valid only in rollback preview.');
    const refusal = validateOperatorId(operatorId) ?? writeScopeRefusal(root);
    if (refusal) throw new PackageCreateRefusedError(refusal);
    if (!(await operatorExists(c, operatorId))) throw new PackageCreateRefusedError(`PeopleSoft operator ${operatorId} does not exist.`);
    await lockPackage(c, root, request.openedVersion);
    const users = await packageUsers(c, root, [...PACKAGE_TABLES, 'PSPACKAGEDEFN']);
    if (users.length) throw new PackageCreateRefusedError(`${root} is named outside the package (${users.slice(0, 5).join(', ')}); deleting it needs a wider review.`);
    const projects = (await select<{ N: string }>(c, `SELECT DISTINCT PROJECTNAME AS N FROM PSPROJECTITEM WHERE (OBJECTTYPE = 57 AND OBJECTVALUE2 = :r) OR (OBJECTTYPE = 58 AND OBJECTVALUE1 = :r)`, { r: root }))
      .map(r => String(r.N).trim()).filter(n => !(request.proposedProjectDeletions ?? []).includes(n));
    if (projects.length) throw new PackageCreateRefusedError(`${root} is listed by project ${projects[0]}.`);
    const classes = (await select<{ Q: string; K: string }>(c, `SELECT QUALIFYPATH AS Q, APPCLASSID AS K FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r FOR UPDATE`, { r: root }))
      .sort((a, b) => a.Q < b.Q ? 1 : a.Q > b.Q ? -1 : a.K < b.K ? 1 : -1);
    const programs = [];
    for (const k of classes) {
      const path = String(k.Q).trim() === ':' ? [] : String(k.Q).trim().split(':'), values = [...path, String(k.K).trim(), 'OnExecute'], ids = [...path.map((_, i) => 105 + i), 107, 12];
      programs.push(...await programKeys(c, 104, root, ids.map((id, i) => ` AND OBJECTID${i + 2} = ${id} AND OBJECTVALUE${i + 2} = :v${i + 2}`).join(''), Object.fromEntries(values.map((v, i) => ['v' + (i + 2), v]))));
    }
    const [{ N: stray }] = await select<{ N: number }>(c, `SELECT COUNT(DISTINCT OBJECTVALUE2 || OBJECTVALUE3 || OBJECTVALUE4) AS N FROM PSPCMPROG WHERE OBJECTID1 = 104 AND OBJECTVALUE1 = :r`, { r: root });
    if (Number(stray) !== programs.length) throw new PackageCreateRefusedError(`${root} has PeopleCode outside its classes; refusing to delete.`);
    const start = await nextCounters(c, ['APM', 'PCM']);
    await deletePrograms(c, programs, programs.map((_, i) => start.version.PCM + 2 + i));
    await c.execute(`DELETE FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r`, { r: root });
    await c.execute(`DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r`, { r: root });
    await c.execute(`DELETE FROM PSPACKAGEDEL WHERE PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: root });
    await expectRows(c, `INSERT INTO PSPACKAGEDEL (PACKAGEID, PACKAGEROOT, QUALIFYPATH, VERSION) VALUES (:r, :r, '.', :v)`, { r: root, v: start.version.APM + 1 }, 1, 'Inserting PSPACKAGEDEL');
    await moveCounters(c, start, { APM: 1, PCM: 1 + programs.length, SYS: 1 });
    if (request.dryRun) await c.rollback(); else await c.commit();
    return { version: start.version.APM + 1 };
  } catch (error) {
    await c.rollback().catch(() => {});
    throw error;
  }
}
