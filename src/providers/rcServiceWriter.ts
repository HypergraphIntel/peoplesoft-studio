import type { DbConnection as Connection } from '../db/connection.js';
import { SaveRefusedError, validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { dataSetsOf, trackedRecords, trackingUpsert } from './adsTracking.js';
import { run, type Statement } from './appEngineWriter.js';
import { operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

/*
 * Defining an Application Class related content service -- what Event
 * Mapping runs -- as PeopleTools' Define Related Content Service page
 * (PTCSSERVICES.PTCSSERVICES) saves one [em01; docs/CUSTOMIZATION.md]:
 * one PSPTCSSRVDEFN row with the page's defaults for URL type Application
 * Class, VERSION the next RCSDM, stamped; RCSDM and SYS + 1 (PSLOCK RCSDM
 * + 2, as the page moves it); the Data Migration Workbench tracking row.
 * Create only: editing and deleting a service are not captured.
 */

export class RcServiceSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'RcServiceSaveRefusedError'; }
}

/** The page's fields' lengths (PSDBFIELD). */
export const SERVICE_ID_MAX = 30;
export const SERVICE_NAME_MAX = 18;
export const SERVICE_DESCR_MAX = 254;

export interface AppClassServiceRequest {
  serviceId: string;
  /** Service Name (18 characters, as the page's field). */
  name: string;
  description?: string;
  /** The class: package root, the path below it (none: the root), the class. */
  packageRoot: string;
  path?: string[];
  classId: string;
  operatorId: string;
  dryRun?: boolean;
}

export interface AppClassServicePlan {
  serviceId: string;
  statements: Statement[];
  version: number;
  row: Record<string, unknown>;
}

/** The problems the page would refuse, and the lengths its fields cannot hold. */
export function validateServiceRequest(r: Pick<AppClassServiceRequest, 'serviceId' | 'name' | 'description' | 'packageRoot' | 'classId'>): string[] {
  const out: string[] = [];
  const id = r.serviceId.trim().toUpperCase();
  if (!id) out.push('A service needs an ID.');
  else if (id.length > SERVICE_ID_MAX) out.push(`Service ID ${id} is longer than ${SERVICE_ID_MAX} characters.`);
  else if (!/^[A-Z0-9_]+$/.test(id)) out.push(`Service ID ${id} may hold letters, digits and _ only.`);
  if (!r.name.trim()) out.push('A service needs a name.');
  else if (r.name.trim().length > SERVICE_NAME_MAX) out.push(`The service name is longer than ${SERVICE_NAME_MAX} characters (the page keeps ${SERVICE_NAME_MAX}).`);
  if ((r.description ?? '').length > SERVICE_DESCR_MAX) out.push(`The description is longer than ${SERVICE_DESCR_MAX} characters.`);
  if (!r.packageRoot.trim() || !r.classId.trim()) out.push('A service names its application class: package and class.');
  return out;
}

/** QUALIFYPATH as PSAPPCLASSDEFN stores it: ':' for a class at the package root, else the path joined with ':'. */
export const qualifyPath = (path: readonly string[] | undefined) => (path && path.length ? path.join(':') : ':');

export function planAppClassService(r: AppClassServiceRequest, ctx: { rcsdm: number; sys: number; lastupddttm: string; tracked: Set<string> }): AppClassServicePlan {
  const serviceId = r.serviceId.trim().toUpperCase();
  const version = ctx.rcsdm + 1;
  const row: Record<string, unknown> = {
    PTCS_SERVICEID: serviceId, PTCS_SERVICENAME: r.name.trim(), DESCR254: r.description?.trim() || ' ', PTCS_INITIALHEIGHT: 0,
    PTCS_SERVICEURLTYP: 'UAPC', PTCS_SERVICETYPE: 'S', MSGNODENAME: ' ', PTTILECATEGORY: ' ', PORTAL_RECNAME: ' ', FIELDNAME: ' ',
    PC_EVENT_TYPE: 'FieldFormula', PC_FUNCTION_NAME: 'IScript_', PORTAL_MENUNAME: ' ', PNLGRPNAME: ' ', MARKET: ' ', PNLNAME: ' ',
    PTPPB_PAGELET_ID: ' ', PTCS_QUERYNAME: ' ', PTCS_ESCAPEPARAM: 'Y', PTCS_POST_MAPDATA: 'N', PTCS_SECUSEEDIT: 1, USEEDIT: 0,
    PACKAGEROOT: r.packageRoot.trim().toUpperCase(), QUALIFYPATH: qualifyPath(r.path), APPCLASSID: r.classId.trim(), PTCS_BULKACTION: ' ',
    VERSION: version, LASTUPDOPRID: r.operatorId, OBJECTOWNERID: ' ', PTCS_SRVCATTR: 'GNRL'
  };
  const cols = Object.keys(row);
  const binds: Record<string, unknown> = { ts: ctx.lastupddttm };
  cols.forEach((c, i) => { binds[`b${i}`] = row[c]; });
  // PORTAL_URI_TEXT, PTCS_SRVHELPTEXT, the validity dates and PORTAL_URL_ADM stay NULL, as the page leaves them [em01].
  const statements: Statement[] = [
    { sql: `INSERT INTO PSPTCSSRVDEFN (${cols.join(', ')}, LASTUPDDTTM) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')}, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}))`,
      binds, expect: 1, what: 'Inserting PSPTCSSRVDEFN' },
    { sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'RCSDM'`, binds: { v: version }, expect: 1, what: 'Updating PSVERSION RCSDM' },
    { sql: `UPDATE PSLOCK SET VERSION = VERSION + :d WHERE OBJECTTYPENAME = 'RCSDM'`, binds: { d: 2 }, what: 'Updating PSLOCK RCSDM' },
    { sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, binds: { v: ctx.sys + 1 }, expect: 1, what: 'Updating PSVERSION SYS' }
  ];
  for (const ads of dataSetsOf(ctx.tracked, 'PSPTCSSRVDEFN')) statements.push(...trackingUpsert(ads, 'PSPTCSSRVDEFN', [['PTCS_SERVICEID', serviceId]], ctx.lastupddttm, r.operatorId));
  return { serviceId, statements, version, row };
}

/** Defines the service in one transaction; refused when it exists, the class does not, or a field is out of bounds. */
export async function createAppClassService(c: Connection, r: AppClassServiceRequest): Promise<AppClassServicePlan & { written: boolean }> {
  try {
    const problems = validateServiceRequest(r);
    if (problems.length) throw new RcServiceSaveRefusedError(problems.join(' '));
    const operatorError = validateOperatorId(r.operatorId);
    if (operatorError) throw new RcServiceSaveRefusedError(operatorError);
    const serviceId = r.serviceId.trim().toUpperCase();
    const scope = writeScopeRefusal(serviceId);
    if (scope) throw new RcServiceSaveRefusedError(scope);
    if (!(await operatorExists(c, r.operatorId))) throw new RcServiceSaveRefusedError(`PeopleSoft operator ${r.operatorId} does not exist in this database (PSOPRDEFN).`);
    if ((await select(c, `SELECT 'X' AS X FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID = :s`, { s: serviceId })).length) {
      throw new RcServiceSaveRefusedError(`A related content service ${serviceId} already exists.`);
    }
    const pkg = r.packageRoot.trim().toUpperCase();
    const qp = qualifyPath(r.path);
    if (!(await select(c, `SELECT 'X' AS X FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :p AND QUALIFYPATH = :q AND APPCLASSID = :c`, { p: pkg, q: qp, c: r.classId.trim() })).length) {
      throw new RcServiceSaveRefusedError(`There is no application class ${[pkg, ...(r.path ?? []), r.classId.trim()].join(':')}.`);
    }
    const counters = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('RCSDM', 'SYS') FOR UPDATE`);
    const v = { R: counters.find((x) => String(x.T).trim() === 'RCSDM')?.V, S: counters.find((x) => String(x.T).trim() === 'SYS')?.V };
    if (v.R === undefined || v.S === undefined) throw new RcServiceSaveRefusedError('PSVERSION RCSDM or SYS is missing; refusing to write.');
    const [{ TS }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const plan = planAppClassService(r, { rcsdm: Number(v.R), sys: Number(v.S), lastupddttm: TS, tracked: await trackedRecords(c, ['PSPTCSSRVDEFN']) });
    if (r.dryRun) { await c.rollback(); return { ...plan, written: false }; }
    await run(c, plan.statements);
    const [after] = await select<{ V: number; T: string }>(c, `SELECT VERSION AS V, PTCS_SERVICEURLTYP AS T FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID = :s`, { s: serviceId });
    if (!after || Number(after.V) !== plan.version || String(after.T).trim() !== 'UAPC') throw new RcServiceSaveRefusedError(`After the save ${serviceId} is not the service planned.`);
    await c.commit();
    return { ...plan, written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** The source of an Event Mapping service class, as Oracle's own services are written: extends PT_RCF:ServiceInterface, execute() overridden. */
export function serviceClassSource(classId: string, purpose = ''): string {
  return `import PT_RCF:*;

/* ${purpose ? purpose.replace(/\*\//g, '* /') : 'Event Mapping service'} */
class ${classId} extends PT_RCF:ServiceInterface
   method execute();
end-class;

method execute
   /+ Extends/implements PT_RCF:ServiceInterface.execute +/
   /* Runs at the mapped event, with the component buffer as the event's own PeopleCode has it
      (GetLevel0(), GetRow(), GetRecord()). The Event Map Parameter is the service's EV_PARAM
      parameter: %This.getParamValue("EV_PARAM") (PT_RCF:ServiceInterface). */
end-method;
`;
}
