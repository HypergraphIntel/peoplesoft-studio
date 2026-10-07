import type { Connection } from 'oracledb';
import { DefinitionKey, DefinitionType } from '../model/definitions.js';
import { PROPERTIES_SPECS } from '../model/properties.js';
import {
  describeItem, itemKeyColumns, MIN_PROJECT_ITEM_SLOTS, PROJECT_ITEM_DEFAULTS, projectItemFor,
  ProjectSaveRefusedError, type ProjectItem
} from '../model/projectItems.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT, VALUE_PREDICATE, valueBinds } from './peopleCodeWriter.js';

/*
 * Saving a project: a set of changes applied to one project in one
 * transaction, as App Designer's Save Project does. docs/PROJECT_INSERT.md.
 *
 * Every save, whatever it changes, stamps the project the same way (case
 * p01):
 *
 *   PSPROJECTDEFN   VERSION = the new PSVERSION PJM, LASTUPDDTTM = the
 *                   save's database time, LASTUPDOPRID = the operator
 *   PSVERSION       PJM + 1, SYS + 1
 *   PSLOCK          PJM + 1
 *
 * Changes, each enabled only once an App Designer case has shown its rows:
 *
 *   add      one PSPROJECTITEM row per definition, the project's other items
 *            untouched (p01; the writer's own insert, p02, matches it)
 *
 * Not yet: removing items, editing the project's properties, creating a
 * project, and saving with no changes (p03 records what App Designer does).
 *
 * The request may carry the project VERSION its changes were made against;
 * a project saved since (in App Designer or here) is refused, so staged
 * changes never overwrite someone else's save.
 */

export interface ProjectSaveRequest {
  project: string;
  /** PSOPRDEFN.OPRID recorded as LASTUPDOPRID. */
  operatorId: string;
  /** The project VERSION the changes were made against; omitted, any version is accepted. */
  openedVersion?: number;
  /** Definitions to add as items. */
  add: DefinitionKey[];
}

export interface ProjectSaveResult {
  added: ProjectItem[];
  /** The project's new VERSION (= PSVERSION PJM), the concurrency token for the next save. */
  version: number;
  lastupddttm: string;
}

interface Counters { pjm: number; sys: number; lockPjm: number }

async function readCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME IN ('PJM', 'SYS')${lock}`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM SYSADM.PSLOCK WHERE OBJECTTYPENAME = 'PJM'${lock}`);
  const get = (name: string) => v.find((r) => String(r.T).trim() === name)?.V;
  const pjm = get('PJM');
  const sys = get('SYS');
  if (pjm === undefined || sys === undefined || l.length !== 1) {
    throw new ProjectSaveRefusedError('PSVERSION PJM / SYS or PSLOCK PJM is missing; refusing to write.');
  }
  return { pjm: Number(pjm), sys: Number(sys), lockPjm: Number(l[0].V) };
}

/** How many OBJECTID / OBJECTVALUE pairs this database's PSPROJECTITEM has. */
async function itemSlots(c: Connection): Promise<number> {
  const [r] = await select<{ N: number }>(c,
    `SELECT COUNT(*) AS N FROM ALL_TAB_COLUMNS
      WHERE OWNER = 'SYSADM' AND TABLE_NAME = 'PSPROJECTITEM' AND COLUMN_NAME LIKE 'OBJECTVALUE%'`);
  const n = Number(r?.N ?? 0);
  if (n < MIN_PROJECT_ITEM_SLOTS) throw new ProjectSaveRefusedError(`PSPROJECTITEM has ${n} key slots here; refusing to write.`);
  return n;
}

/** Whether the definition itself exists, so a project never lists a missing one. */
async function definitionExists(c: Connection, key: DefinitionKey): Promise<boolean> {
  if (key.type === DefinitionType.RecordPeopleCode || key.type === DefinitionType.ApplicationClassPeopleCode) {
    const parts = key.type === DefinitionType.ApplicationClassPeopleCode && key.parts.at(-1) !== 'OnExecute'
      ? [...key.parts, 'OnExecute'] : key.parts;
    const [r] = await select<{ N: number }>(c,
      `SELECT COUNT(*) AS N FROM SYSADM.PSPCMPROG WHERE ${VALUE_PREDICATE}`, valueBinds(parts));
    return Number(r?.N ?? 0) > 0;
  }
  const spec = PROPERTIES_SPECS[key.type];
  if (!spec) throw new ProjectSaveRefusedError(`${describeItem(key)}: no way to check that it exists; refusing to write.`);
  const where = spec.where(key);
  const cols = Object.keys(where);
  const [r] = await select<{ N: number }>(c,
    `SELECT COUNT(*) AS N FROM SYSADM.${spec.table} WHERE ${cols.map((col, i) => `${col} = :b${i}`).join(' AND ')}`,
    Object.fromEntries(cols.map((col, i) => [`b${i}`, where[col]])));
  return Number(r?.N ?? 0) > 0;
}

/** PS_PSPROJECTITEM is unique on the project, OBJECTTYPE and the OBJECTVALUEs. */
async function itemCount(c: Connection, project: string, item: ProjectItem, slots: number): Promise<number> {
  const row = itemKeyColumns(item, slots);
  const preds = Array.from({ length: slots }, (_, i) => `OBJECTVALUE${i + 1} = :v${i + 1}`);
  const binds: Record<string, unknown> = { p: project, t: item.objectType };
  for (let i = 1; i <= slots; i++) binds[`v${i}`] = row[`OBJECTVALUE${i}`];
  const [r] = await select<{ N: number }>(c,
    `SELECT COUNT(*) AS N FROM SYSADM.PSPROJECTITEM WHERE PROJECTNAME = :p AND OBJECTTYPE = :t AND ${preds.join(' AND ')}`, binds);
  return Number(r?.N ?? 0);
}

interface ProjectRow { VERSION: number; TS: string; OPRID: string }

async function readProject(c: Connection, project: string, forUpdate: boolean): Promise<ProjectRow | undefined> {
  const [r] = await select<ProjectRow>(c,
    `SELECT VERSION, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS, LASTUPDOPRID AS OPRID
       FROM SYSADM.PSPROJECTDEFN WHERE PROJECTNAME = :p${forUpdate ? ' FOR UPDATE' : ''}`, { p: project });
  return r;
}

const sameItem = (a: ProjectItem, b: ProjectItem) =>
  a.objectType === b.objectType && a.objectValues.join('\u0000') === b.objectValues.join('\u0000');

/**
 * The changes as rows, refused when they cannot be saved: nothing to do,
 * an unknown layout, or the same item twice.
 */
export function planProjectSave(request: ProjectSaveRequest): ProjectItem[] {
  if (request.add.length === 0) {
    throw new ProjectSaveRefusedError(`Nothing to save in project ${request.project}.`);
  }
  const items = request.add.map(projectItemFor);
  items.forEach((item, i) => {
    if (items.findIndex((other) => sameItem(other, item)) !== i) {
      throw new ProjectSaveRefusedError(`${describeItem(request.add[i])} is listed twice.`);
    }
  });
  return items;
}

/**
 * Saves the project and commits, or rolls back and throws. The caller
 * verifies again after COMMIT (verifyProjectSave).
 */
export async function saveProject(c: Connection, request: ProjectSaveRequest): Promise<ProjectSaveResult> {
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new ProjectSaveRefusedError(operatorError);
    const items = planProjectSave(request);

    // Lock the project row first: saves of one project serialize here.
    const before = await readProject(c, request.project, true);
    if (!before) throw new ProjectSaveRefusedError(`There is no project named ${request.project}.`);
    if (request.openedVersion !== undefined && Number(before.VERSION) !== request.openedVersion) {
      throw new ProjectSaveRefusedError(
        `Project ${request.project} was saved since these changes were made (version ${before.VERSION}, not ${request.openedVersion}). ` +
        'Reopen it and reapply them.');
    }
    if (!(await operatorExists(c, request.operatorId))) {
      throw new ProjectSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }
    const slots = await itemSlots(c);
    for (const [i, item] of items.entries()) {
      const what = describeItem(request.add[i]);
      if (!(await definitionExists(c, request.add[i]))) throw new ProjectSaveRefusedError(`${what} does not exist in this database.`);
      itemKeyColumns(item, slots);
      if (await itemCount(c, request.project, item, slots) > 0) {
        throw new ProjectSaveRefusedError(`${what} is already in project ${request.project}.`);
      }
    }

    const counters = await readCounters(c, true);
    const next: Counters = { pjm: counters.pjm + 1, sys: counters.sys + 1, lockPjm: counters.lockPjm + 1 };
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    for (const item of items) {
      const row = { PROJECTNAME: request.project, OBJECTTYPE: item.objectType, ...itemKeyColumns(item, slots), ...PROJECT_ITEM_DEFAULTS };
      const columns = Object.keys(row);
      await expectRows(c,
        `INSERT INTO SYSADM.PSPROJECTITEM (${columns.join(', ')}) VALUES (${columns.map((col) => `:${col}`).join(', ')})`,
        row, 1, 'Inserting PSPROJECTITEM');
    }
    await expectRows(c,
      `UPDATE SYSADM.PSPROJECTDEFN SET VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op
        WHERE PROJECTNAME = :p`,
      { v: next.pjm, ts: lastupddttm, op: request.operatorId, p: request.project }, 1, 'Updating PSPROJECTDEFN');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PJM'`, { v: next.pjm }, 1, 'Updating PSVERSION PJM');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PJM'`, { v: next.lockPjm }, 1, 'Updating PSLOCK PJM');

    // Prove the state before COMMIT.
    const result: ProjectSaveResult = { added: items, version: next.pjm, lastupddttm };
    await verifyProjectSave(c, request, result, slots);
    const now = await readCounters(c, false);
    if (now.pjm !== next.pjm || now.sys !== next.sys || now.lockPjm !== next.lockPjm) {
      throw new ProjectSaveRefusedError(`counters ${JSON.stringify(now)}, ${JSON.stringify(next)} expected; rolled back.`);
    }
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** Every added item is in the project exactly once and the project row carries the save's stamp. */
export async function verifyProjectSave(
  c: Connection, request: ProjectSaveRequest, result: ProjectSaveResult, slots?: number
): Promise<void> {
  const n = slots ?? await itemSlots(c);
  const problems: string[] = [];
  for (const item of result.added) {
    const count = await itemCount(c, request.project, item, n);
    if (count !== 1) problems.push(`${item.objectValues.join('.')} is stored ${count} times`);
  }
  const project = await readProject(c, request.project, false);
  if (!project) problems.push('the project row is missing');
  else {
    if (Number(project.VERSION) !== result.version) problems.push(`project VERSION ${project.VERSION}, ${result.version} expected`);
    if (project.TS !== result.lastupddttm) problems.push(`project LASTUPDDTTM ${project.TS}, ${result.lastupddttm} expected`);
    if (String(project.OPRID).trim() !== request.operatorId) problems.push(`project LASTUPDOPRID ${project.OPRID}`);
  }
  if (problems.length > 0) throw new ProjectSaveRefusedError(`The project save did not land as planned (${problems.join('; ')}).`);
}

/**
 * A new project's PSPROJECTDEFN row, as App Designer's first save of an empty
 * project wrote it (case c02, ZZ_PCODE_LAB_02; the 7 projects created in App
 * Designer on HRDMO agree): KEEPTGT 31, COMPARETYPE 1, COMMITLIMIT 50,
 * REPORTFILTER 16232832, the rest blank / zero / null.
 */
export const NEW_PROJECT_VALUES = {
  PROJECTDESCR: ' ', TGTSERVERNAME: ' ', TGTDBNAME: ' ', TGTOPRID: ' ', TGTOPRACCT: ' ', COMPRELEASE: ' ',
  SRCCOMPRELDTTM: null, TGTCOMPRELDTTM: null, COMPRELDTTM: null, KEEPTGT: 31, TGTORIENTATION: 0, COMPARETYPE: 1,
  COMMITLIMIT: 50, REPORTFILTER: 16232832, MAINTPROJ: 0, RELEASELABEL: ' ', RELEASEDTTM: null, OBJECTOWNERID: ' ', DESCRLONG: null
} as const;

/**
 * Creating an empty project (c02): PSPROJECTDEFN inserted with VERSION = the
 * new PJM; PSVERSION PJM, SYS + 1; PSLOCK PJM + 1. Items are added after,
 * by saveProject, as App Designer's Insert does.
 */
export async function createProject(c: Connection, request: { project: string; operatorId: string }): Promise<ProjectSaveResult> {
  const project = request.project;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new ProjectSaveRefusedError(operatorError);
    if (!/^[A-Z0-9_]{1,30}$/.test(project)) throw new ProjectSaveRefusedError(`${project} is not a valid project name (A-Z, 0-9, _; at most 30).`);
    const scope = writeScopeRefusal(project);
    if (scope) throw new ProjectSaveRefusedError(scope);
    const [{ N: taken }] = await select<{ N: number }>(c,
      `SELECT (SELECT COUNT(*) FROM SYSADM.PSPROJECTDEFN WHERE PROJECTNAME = :p) + (SELECT COUNT(*) FROM SYSADM.PSPROJECTITEM WHERE PROJECTNAME = :p) AS N FROM DUAL`,
      { p: project });
    if (Number(taken) > 0) throw new ProjectSaveRefusedError(`A project named ${project} already exists, or left items behind.`);
    if (!(await operatorExists(c, request.operatorId))) {
      throw new ProjectSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }
    const cols = (await select<{ C: string }>(c,
      `SELECT COLUMN_NAME AS C FROM ALL_TAB_COLUMNS WHERE OWNER = 'SYSADM' AND TABLE_NAME = 'PSPROJECTDEFN' ORDER BY COLUMN_ID`)).map((r) => r.C);
    const known = new Set(['PROJECTNAME', 'VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID', ...Object.keys(NEW_PROJECT_VALUES)]);
    const unknown = cols.filter((col) => !known.has(col));
    if (unknown.length > 0) throw new ProjectSaveRefusedError(`PSPROJECTDEFN has columns this save does not know (${unknown.join(', ')}); refusing to write.`);

    const counters = await readCounters(c, true);
    const next: Counters = { pjm: counters.pjm + 1, sys: counters.sys + 1, lockPjm: counters.lockPjm + 1 };
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const values: Record<string, unknown> = { ...NEW_PROJECT_VALUES, PROJECTNAME: project, VERSION: next.pjm, LASTUPDOPRID: request.operatorId };
    const binds: Record<string, unknown> = { ts: lastupddttm };
    const exprs = cols.map((col, i) => {
      if (col === 'LASTUPDDTTM') return `TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT})`;
      binds[`b${i}`] = values[col];
      return `:b${i}`;
    });
    await expectRows(c, `INSERT INTO SYSADM.PSPROJECTDEFN (${cols.join(', ')}) VALUES (${exprs.join(', ')})`, binds, 1, 'Inserting PSPROJECTDEFN');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PJM'`, { v: next.pjm }, 1, 'Updating PSVERSION PJM');
    await expectRows(c, `UPDATE SYSADM.PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE SYSADM.PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PJM'`, { v: next.lockPjm }, 1, 'Updating PSLOCK PJM');
    const row = await readProject(c, project, false);
    const now = await readCounters(c, false);
    if (!row || Number(row.VERSION) !== next.pjm || row.TS !== lastupddttm ||
        now.pjm !== next.pjm || now.sys !== next.sys || now.lockPjm !== next.lockPjm) {
      throw new ProjectSaveRefusedError('The project did not land as planned; rolled back.');
    }
    await c.commit();
    return { version: next.pjm, lastupddttm, added: [] };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
