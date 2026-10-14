import { createHash } from 'node:crypto';
import type { DbConnection as Connection } from '../db/connection.js';
import { DROP_ZONE_SERVICE_URL_TYPE, UNREGISTERED_COMPONENT_PORTAL, type DropZone } from '../model/dropZones.js';
import { SaveRefusedError, validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { dataSetsOf, trackedRecords, trackingRefresh, trackingUpsert, type TrackedKey } from './adsTracking.js';
import { run, type Statement } from './appEngineWriter.js';
import { readComponentDropZones } from './dropZoneReader.js';
import { newInstanceId } from './eventMappingWriter.js';
import { operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

/*
 * Configuring drop zones as PeopleTools' Configure Drop Zones page saves them
 * (PORTAL_ADMIN.PTCS_SUBPAGE_COMP, PTCS_SUBPNL_WRK.PTSAVE_CHANGE_SUOW
 * FieldChange; docs/CUSTOMIZATION.md "Writing Drop Zones"; captures
 * tools/corpus/save-protocol/results/dz01-configure, dz02-remove).
 *
 * The configuration is stored per owner -- each content reference the
 * component is registered as, or PT_DZ_UNREGCOMP/<component> when it is not
 * -- and every Save first re-saves the owner's PSPTCS_SRVCFG at the next
 * RCSCM (deleted and inserted when it exists [dz02], inserted with the
 * component's menu, ExpandFrame N, frame location B when not [dz01]). Then,
 * for each drop zone whose subpage changed:
 *
 * - a configured one is removed [dz02]: its menu link, folder, menu
 *   (PSPTCSMNUTBLDEL at the next RCMTM), field map and configuration
 *   (PSPTCSSRVCNFDEL at the next SCNFM) deleted; the service definition kept;
 * - a subpage given is configured [dz01]: its service (named after the
 *   subpage, URL type UESP) when there is none (VERSION the next RCSDM); a
 *   page-level configuration, embeddable and single unit of work, its VERSION
 *   two SCNFM steps on; the PTCS_MENUFIELD map to the drop zone's key; a field
 *   menu (FLDM) keyed by the drop zone's field id, two RCMTM steps on; its Root
 *   folder (id Hash(menuId|"-Root")) and the link to the configuration.
 *
 * A counter's next value is one past the larger of PSVERSION and PSLOCK, and
 * both are set to it (HRDMO's RCSDM: PSVERSION 10, PSLOCK 13 -> both 14
 * [dz01]); each step moves SYS too. Data Migration Workbench tracking is kept
 * as PIA keeps it: stamped for what is written, including PIA's menu-folder
 * row that lists PTCS_MENUID twice and hashes the menu's keys [dz01]; for what
 * a removal deletes, the configuration, menu and that folder row re-stamped
 * and kept [dz02]. A changed subpage is a removal then a configuration (the
 * page's own order; not captured as one save).
 */

export class DropZoneSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'DropZoneSaveRefusedError'; }
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** PeopleCode's Hash(): SHA-1 over the UTF-16LE text, base64. */
export const peopleCodeHash = (text: string): string => createHash('sha1').update(Buffer.from(text, 'utf16le')).digest('base64');
/** A drop zone menu's Root folder id (PTCS_MENULAYOUT:RCMenuLayout.AddFolder) [dz01: ZZ_PCODE_LAB_PG.26.-Root]. */
export const rootFolderId = (menuId: string): string => peopleCodeHash(`${menuId}-Root`);

export type CounterName = 'RCSDM' | 'RCSCM' | 'SCNFM' | 'RCMTM' | 'SYS';
const LOCKED: readonly Exclude<CounterName, 'SYS'>[] = ['RCSDM', 'RCSCM', 'SCNFM', 'RCMTM'];
export interface CounterState { version: Record<CounterName, number>; lock: Record<Exclude<CounterName, 'SYS'>, number> }

/** Where a component's drop-zone configuration is stored. */
export interface DropZoneOwner { portal: string; cref: string; menu: string }

/** A drop zone's configuration as stored under an owner. */
export interface StoredDropZoneConfig {
  owner: string;
  serviceId: string;
  instanceId: number;
  page: string;
  fieldName: string;
  version: number;
  menuId?: string;
}

export interface DropZoneState {
  component: string;
  market: string;
  zones: DropZone[];
  owners: DropZoneOwner[];
  /** Each owner's PSPTCS_SRVCFG row, by owner key ("PORTAL|CREF"). */
  srvcfg: Map<string, Row | undefined>;
  configs: StoredDropZoneConfig[];
  /** Instance ids in use under each owner (any service). */
  instances: Map<string, Set<number>>;
}

export const ownerKey = (o: Pick<DropZoneOwner, 'portal' | 'cref'>): string => `${o.portal}|${o.cref}`;
const zoneKey = (page: string, fieldName: string) => `${page}|${fieldName}`;

// ---------------------------------------------------------------------------
// Reading

/** The owners Configure Drop Zones stores the component's configuration under (FetchListOfCRefs). */
export async function dropZoneOwners(c: Connection, component: string, market: string): Promise<DropZoneOwner[]> {
  const rows = await select<{ P: string; N: string; M: string }>(c,
    `SELECT DISTINCT PORTAL_NAME AS P, PORTAL_OBJNAME AS N, PORTAL_URI_SEG1 AS M FROM PSPRSMDEFN
      WHERE PORTAL_REFTYPE = 'C' AND PORTAL_URI_SEG2 = :c AND PORTAL_URI_SEG3 = :m ORDER BY 1, 2`, { c: component, m: market });
  if (rows.length) return rows.map((r) => ({ portal: s(r.P), cref: s(r.N), menu: s(r.M) }));
  const [menu] = await select<{ M: string }>(c, `SELECT MENUNAME AS M FROM PSMENUITEM WHERE PNLGRPNAME = :c ORDER BY MENUNAME`, { c: component });
  return [{ portal: UNREGISTERED_COMPONENT_PORTAL, cref: component, menu: s(menu?.M) }];
}

const SRVCFG_COLUMNS = ['PORTAL_NAME', 'PORTAL_OBJNAME', 'MENUNAME', 'PNLGRPNAME', 'PTCS_EXPANDFRAME', 'PTCS_RCFRAMELOC', 'PTCS_NMINPAGELETS', 'VERSION',
  'LASTUPDOPRID', 'OBJECTOWNERID'] as const;

/** The component's drop zones and their stored configuration; FOR UPDATE locks the owners' rows for a save. */
export async function readDropZoneState(c: Connection, component: string, market: string, forUpdate = false): Promise<DropZoneState> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const owners = await dropZoneOwners(c, component, market);
  const zones = await readComponentDropZones(c, component, market);
  const srvcfg = new Map<string, Row | undefined>();
  const configs: StoredDropZoneConfig[] = [];
  const instances = new Map<string, Set<number>>();
  for (const o of owners) {
    const k = ownerKey(o);
    const [cfg] = await select<Row>(c, `SELECT ${SRVCFG_COLUMNS.join(', ')} FROM PSPTCS_SRVCFG WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n${lock}`, { p: o.portal, n: o.cref });
    srvcfg.set(k, cfg);
    const used = await select<{ I: number }>(c, `SELECT PTCS_INSTANCEID AS I FROM PSPTCSSRVCONF WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n${lock}`, { p: o.portal, n: o.cref });
    instances.set(k, new Set(used.map((r) => Number(r.I))));
    const rows = await select<{ SID: string; IID: number; V: number; PNL: string; FLD: string; MNU: string | null }>(c,
      `SELECT C.PTCS_SERVICEID AS SID, C.PTCS_INSTANCEID AS IID, C.VERSION AS V, M.PTCS_PNLNAME AS PNL, M.PTCS_PNLFLDNAME AS FLD,
              (SELECT MIN(L.PTCS_MENUID) FROM PSPTCS_MNULINKS L WHERE L.PORTAL_NAME = C.PORTAL_NAME AND L.PORTAL_OBJNAME = C.PORTAL_OBJNAME
                  AND L.PTCS_SERVICEID = C.PTCS_SERVICEID AND L.PTCS_INSTANCEID = C.PTCS_INSTANCEID) AS MNU
         FROM PSPTCSSRVCONF C
         JOIN PSPTCSSRVDEFN D ON D.PTCS_SERVICEID = C.PTCS_SERVICEID AND D.PTCS_SERVICEURLTYP = '${DROP_ZONE_SERVICE_URL_TYPE}'
         JOIN PSPTCS_MAPFLDS M ON M.PORTAL_NAME = C.PORTAL_NAME AND M.PORTAL_OBJNAME = C.PORTAL_OBJNAME AND M.PTCS_SERVICEID = C.PTCS_SERVICEID
                              AND M.PTCS_INSTANCEID = C.PTCS_INSTANCEID AND M.PTCS_PARAMETERNAME = 'PTCS_MENUFIELD'
        WHERE C.PORTAL_NAME = :p AND C.PORTAL_OBJNAME = :n AND C.PTCS_EMBEDDABLE = 'Y' AND C.PTCS_SUOWSERV = 'Y'
        ORDER BY C.PTCS_SERVICEID, C.PTCS_INSTANCEID`, { p: o.portal, n: o.cref });
    for (const r of rows) {
      configs.push({ owner: k, serviceId: s(r.SID), instanceId: Number(r.IID), page: s(r.PNL), fieldName: s(r.FLD), version: Number(r.V),
        ...(s(r.MNU) ? { menuId: s(r.MNU) } : {}) });
    }
  }
  return { component, market, zones, owners, srvcfg, configs, instances };
}

/** The stored configuration in a line, for "changed since it was read". */
export function dropZoneToken(state: DropZoneState): string {
  const parts = [
    ...[...state.srvcfg.entries()].map(([k, r]) => `cfg ${k} ${r ? s(r.VERSION) : '-'}`),
    ...state.configs.map((x) => `conf ${x.owner} ${x.serviceId} ${x.instanceId} ${x.version} ${x.page} ${x.fieldName}`)
  ].sort();
  return createHash('sha1').update(parts.join('\n')).digest('hex');
}

export async function readCounterState(c: Connection, forUpdate: boolean): Promise<CounterState> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const names = ['RCSDM', 'RCSCM', 'SCNFM', 'RCMTM', 'SYS'];
  const v = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN (${names.map((n) => `'${n}'`).join(', ')})${lock}`);
  const l = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME IN (${LOCKED.map((n) => `'${n}'`).join(', ')})${lock}`);
  const out: CounterState = { version: {} as CounterState['version'], lock: {} as CounterState['lock'] };
  for (const n of names as CounterName[]) {
    const r = v.find((x) => s(x.T) === n);
    if (!r) throw new DropZoneSaveRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
    out.version[n] = Number(r.V);
  }
  for (const n of LOCKED) {
    const r = l.find((x) => s(x.T) === n);
    if (!r) throw new DropZoneSaveRefusedError(`PSLOCK ${n} is missing; refusing to write.`);
    out.lock[n] = Number(r.V);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Planning (pure)

/** A drop zone and the subpage it should show ('' for none). */
export interface DropZoneAssignment { page: string; fieldName: string; subpage: string }

export interface DropZonePlanOptions {
  counters: CounterState;
  /** Stamp for LASTUPDDTTM (TIMESTAMP_FORMAT text). */
  ts: string;
  operatorId: string;
  /** The (data set|record) pairs this database tracks. */
  tracked: Set<string>;
  /** Services by id: whether they exist and their URL type. */
  services: Map<string, { exists: boolean; urlType: string }>;
  random?: () => number;
}

export interface DropZonePlan {
  statements: Statement[];
  counters: CounterState;
  changes: string[];
  empty: boolean;
  /** What each changed drop zone shows after the save, per owner: "owner|page|fieldName" -> subpage ('' none). */
  expected: Map<string, string>;
}

function insertRow(table: string, row: Row, ts?: string): Statement {
  const cols = Object.keys(row);
  const binds: Record<string, unknown> = {};
  cols.forEach((col, i) => { binds[`b${i}`] = row[col]; });
  const values = cols.map((_, i) => `:b${i}`);
  if (ts !== undefined) { cols.push('LASTUPDDTTM'); values.push(`TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT})`); binds.ts = ts; }
  return { sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values.join(', ')})`, binds, expect: 1, what: `Inserting ${table}` };
}

function deleteRows(table: string, where: Row, expect?: number): Statement {
  const cols = Object.keys(where);
  return {
    sql: `DELETE FROM ${table} WHERE ${cols.map((c, i) => `${c} = :w${i}`).join(' AND ')}`,
    binds: Object.fromEntries(cols.map((c, i) => [`w${i}`, where[c]])), ...(expect !== undefined ? { expect } : {}), what: `Deleting ${table}`
  };
}

/** The statements that give each drop zone its assigned subpage, as the page's Save does (module comment). */
export function planDropZoneSave(state: DropZoneState, assignments: readonly DropZoneAssignment[], o: DropZonePlanOptions): DropZonePlan {
  const counters: CounterState = { version: { ...o.counters.version }, lock: { ...o.counters.lock } };
  const next = (n: Exclude<CounterName, 'SYS'>): number => {
    const v = Math.max(counters.version[n], counters.lock[n]) + 1;
    counters.version[n] = v;
    counters.lock[n] = v;
    counters.version.SYS += 1;
    return v;
  };
  const zones = new Map(state.zones.map((z) => [zoneKey(z.page, z.fieldName), z]));
  const changed: Array<{ zone: DropZone; subpage: string }> = [];
  for (const a of assignments) {
    const zone = zones.get(zoneKey(a.page.trim().toUpperCase(), a.fieldName.trim()));
    if (!zone) throw new DropZoneSaveRefusedError(`${a.page} has no drop zone ${a.fieldName} on ${state.component}.${state.market}.`);
    const subpage = a.subpage.trim().toUpperCase();
    if (subpage !== (zone.subpage ?? '')) changed.push({ zone, subpage });
  }
  const statements: Statement[] = [];
  const changes: string[] = [];
  const expected = new Map<string, string>();
  if (!changed.length) return { statements, counters, changes, empty: true, expected };

  const ads = (rec: string) => dataSetsOf(o.tracked, rec);
  const upsert = (rec: string, keys: TrackedKey, hashKeys?: TrackedKey) => ads(rec).flatMap((a) => trackingUpsert(a, rec, keys, o.ts, o.operatorId, hashKeys));
  const refresh = (rec: string, hashKeys: TrackedKey) => ads(rec).map((a) => trackingRefresh(a, rec, hashKeys, o.ts, o.operatorId));
  const createdServices = new Set<string>();

  for (const owner of state.owners) {
    const k = ownerKey(owner);
    const own = { PORTAL_NAME: owner.portal, PORTAL_OBJNAME: owner.cref };
    const ownKeys: TrackedKey = [['PORTAL_NAME', owner.portal], ['PORTAL_OBJNAME', owner.cref]];

    // The owner's service record, re-saved at the next RCSCM.
    const stored = state.srvcfg.get(k);
    const rcscm = next('RCSCM');
    if (stored) statements.push(deleteRows('PSPTCS_SRVCFG', own, 1));
    statements.push(insertRow('PSPTCS_SRVCFG', {
      ...own, MENUNAME: stored ? s(stored.MENUNAME) || ' ' : owner.menu || ' ', PNLGRPNAME: stored ? s(stored.PNLGRPNAME) || ' ' : state.component,
      PTCS_EXPANDFRAME: stored ? s(stored.PTCS_EXPANDFRAME) || 'N' : 'N', PTCS_RCFRAMELOC: stored ? s(stored.PTCS_RCFRAMELOC) || 'B' : 'B',
      PTCS_NMINPAGELETS: stored ? Number(stored.PTCS_NMINPAGELETS ?? 0) : 0, VERSION: rcscm, LASTUPDOPRID: o.operatorId,
      OBJECTOWNERID: stored ? s(stored.OBJECTOWNERID) || ' ' : ' '
    }, o.ts));
    statements.push(...upsert('PSPTCS_SRVCFG', ownKeys));

    const used = new Set(state.instances.get(k) ?? []);
    for (const { zone, subpage } of changed) {
      const menuKeysOf = (menuId: string): TrackedKey => [...ownKeys, ['PTCS_MENUID', menuId]];
      const prior = state.configs.find((x) => x.owner === k && x.page === zone.page && x.fieldName === zone.fieldName);
      if (prior) {
        const menuId = prior.menuId ?? zone.fieldId;
        const conf = { ...own, PTCS_SERVICEID: prior.serviceId, PTCS_INSTANCEID: prior.instanceId };
        statements.push(
          deleteRows('PSPTCS_MNULINKS', { ...own, PTCS_MENUID: menuId, PTCS_SERVICEID: prior.serviceId, PTCS_INSTANCEID: prior.instanceId }),
          deleteRows('PSPTCS_MNUFLDRS', { ...own, PTCS_MENUID: menuId }),
          deleteRows('PSPTCS_MENU_TBL', { ...own, PTCS_MENUID: menuId }),
          insertRow('PSPTCSMNUTBLDEL', { ...own, PTCS_MENUID: menuId, VERSION: next('RCMTM') }),
          deleteRows('PSPTCS_MAPFLDS', conf),
          deleteRows('PSPTCSSRVCONF', conf, 1),
          insertRow('PSPTCSSRVCNFDEL', { ...conf, VERSION: next('SCNFM') }),
          ...refresh('PSPTCSSRVCONF', [...ownKeys, ['PTCS_SERVICEID', prior.serviceId], ['PTCS_INSTANCEID', prior.instanceId]]),
          ...refresh('PSPTCS_MENU_TBL', menuKeysOf(menuId)),
          ...refresh('PSPTCS_MNUFLDRS', menuKeysOf(menuId)));
        changes.push(`${owner.cref}: "${zone.label}" on ${zone.page} no longer shows ${prior.serviceId}`);
      }
      expected.set(`${k}|${zoneKey(zone.page, zone.fieldName)}`, subpage);
      if (!subpage) continue;

      const service = o.services.get(subpage);
      if (service?.exists && service.urlType !== DROP_ZONE_SERVICE_URL_TYPE) {
        throw new DropZoneSaveRefusedError(`Service ${subpage} exists but is not an embedded-subpage (UESP) service (${service.urlType}); Configure Drop Zones would refuse it too.`);
      }
      if (!service?.exists && !createdServices.has(subpage)) {
        createdServices.add(subpage);
        statements.push(insertRow('PSPTCSSRVDEFN', {
          PTCS_SERVICEID: subpage, PTCS_SERVICENAME: subpage, DESCR254: subpage, PTCS_INITIALHEIGHT: 0, PTCS_SERVICEURLTYP: DROP_ZONE_SERVICE_URL_TYPE,
          PTCS_SERVICETYPE: 'S', MSGNODENAME: ' ', PTTILECATEGORY: ' ', PORTAL_RECNAME: ' ', FIELDNAME: ' ', PC_EVENT_TYPE: ' ', PC_FUNCTION_NAME: ' ',
          PORTAL_MENUNAME: ' ', PNLGRPNAME: ' ', MARKET: ' ', PNLNAME: subpage, PTPPB_PAGELET_ID: ' ', PTCS_QUERYNAME: ' ', PTCS_ESCAPEPARAM: 'Y',
          PTCS_POST_MAPDATA: 'N', PTCS_SECUSEEDIT: 1, USEEDIT: 0, PACKAGEROOT: ' ', QUALIFYPATH: ' ', APPCLASSID: ' ', PTCS_BULKACTION: 'N',
          VERSION: next('RCSDM'), LASTUPDOPRID: o.operatorId, OBJECTOWNERID: ' ', PTCS_SRVCATTR: 'GNRL'
        }, o.ts), ...upsert('PSPTCSSRVDEFN', [['PTCS_SERVICEID', subpage]]));
        changes.push(`service ${subpage} (embedded subpage)`);
      }

      const instanceId = newInstanceId(used, o.random);
      used.add(instanceId);
      next('SCNFM');
      const confVersion = next('SCNFM');
      const conf = { ...own, PTCS_SERVICEID: subpage, PTCS_INSTANCEID: instanceId };
      statements.push(insertRow('PSPTCSSRVCONF', {
        ...conf, PTCS_ISCOMPSERVICE: 'P', PNLNAME: zone.page, SEQNUM: 0, PTCS_HIDEFROMSRCH: 'N', IS_DEFAULT: 'N', PTCS_MAPSECOPTIONS: 'P', HANDLERNAME: ' ',
        PTCS_INSTANCELBL: subpage, PTCS_URLTARGET: 'RCF', PTCS_RCMENUOPT: 'N', PTCS_MAINMENUOPT: 'N', PTCS_SEQNUM_MMNU: 0, PTCS_SEQNUM_RMNU: 0,
        PACKAGEROOT: ' ', QUALIFYPATH: ' ', APPCLASSID: ' ', PTCS_INITMIN: 'N', PTCS_ENABLE: 'Y', PTCS_SRVOPENOPTION: ' ', PTCS_EMBEDDABLE: 'Y',
        PTCS_SUOWSERV: 'Y', VERSION: confVersion, LASTUPDOPRID: o.operatorId, OBJECTOWNERID: ' ', PTCS_SRVCATTR: ' ', OPRID: ' ', PTCS_MASTERTMPL: ' ',
        RECNAME: ' ', PTCS_CMPEVENT: ' ', PTCS_PROCSEQ: ' ', PTCS_CMPRECEVENT: ' ', PTCS_ALLOWPERSONAL: 'N', FIELDNAME: ' '
      }, o.ts));
      statements.push(insertRow('PSPTCS_MAPFLDS', {
        ...conf, PTCS_PARAMETERNAME: 'PTCS_MENUFIELD', PTCS_PNLFLDNAME: zone.fieldName, PTCS_PNLNAME: zone.page, PTCS_MAPFIELDTYPE: 'PF',
        PTCSREFRESHSERVICE: 'N', PTCS_MAPNULLVALUE: 'N', PTCS_FIELDMENUOPT: 'Y', PTCS_SEQNUM_FMNU: 0
      }));
      const menuId = zone.fieldId;
      const folderId = rootFolderId(menuId);
      next('RCMTM');
      const menuVersion = next('RCMTM');
      statements.push(
        insertRow('PSPTCS_MENU_TBL', { ...own, PTCS_MENUID: menuId, PTCS_MENUTYPE: 'FLDM', PNLNAME: zone.page, PTCS_PNLFLDNAME: zone.fieldName,
          VERSION: menuVersion, LASTUPDOPRID: o.operatorId, OBJECTOWNERID: ' ' }, o.ts),
        insertRow('PSPTCS_MNUFLDRS', { ...own, PTCS_MENUID: menuId, PTCS_FOLDERID: folderId, PTCS_PRNT_FOLDERID: folderId, PTCS_FOLDERLBL: 'Root', PTCS_FOLDERSEQNUM: 0 }),
        insertRow('PSPTCS_MNULINKS', { ...own, PTCS_MENUID: menuId, PTCS_FOLDERID: folderId, PTCS_SERVICEID: subpage, PTCS_INSTANCEID: instanceId, SEQNUM: 0 }));
      statements.push(
        ...upsert('PSPTCSSRVCONF', [...ownKeys, ['PTCS_SERVICEID', subpage], ['PTCS_INSTANCEID', instanceId]]),
        ...upsert('PSPTCS_MENU_TBL', menuKeysOf(menuId)),
        // PIA's folder rows: one listing PTCS_MENUID twice and hashing the menu's keys, one with the folder's [dz01].
        ...upsert('PSPTCS_MNUFLDRS', [...menuKeysOf(menuId), ['PTCS_MENUID', menuId]], menuKeysOf(menuId)),
        ...upsert('PSPTCS_MNUFLDRS', [...menuKeysOf(menuId), ['PTCS_FOLDERID', folderId]]),
        ...upsert('PSPTCS_MNULINKS', [...menuKeysOf(menuId), ['PTCS_FOLDERID', folderId], ['PTCS_SERVICEID', subpage], ['PTCS_INSTANCEID', instanceId]]));
      changes.push(`${owner.cref}: "${zone.label}" on ${zone.page} shows ${subpage}`);
    }
  }

  for (const n of ['RCSDM', 'RCSCM', 'SCNFM', 'RCMTM', 'SYS'] as CounterName[]) {
    if (counters.version[n] !== o.counters.version[n]) {
      statements.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: counters.version[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
    }
    if (n !== 'SYS' && counters.lock[n] !== o.counters.lock[n]) {
      statements.push({ sql: `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: counters.lock[n] }, expect: 1, what: `Updating PSLOCK ${n}` });
    }
  }
  return { statements, counters, changes, empty: false, expected };
}

// ---------------------------------------------------------------------------
// Saving

export interface DropZoneSaveRequest {
  component: string;
  market?: string;
  assignments: DropZoneAssignment[];
  /** dropZoneToken of the configuration the caller read. */
  openedToken: string;
  operatorId: string;
  dryRun?: boolean;
}

export interface DropZoneSaveResult { plan: DropZonePlan; token: string; written: boolean }

async function now(c: Connection): Promise<string> {
  const [{ TS }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
  return TS;
}

/** Checks a save may run: the operator, the write scope of every service it adds or removes, the subpages are subpages. */
async function checkRequest(c: Connection, state: DropZoneState, request: DropZoneSaveRequest): Promise<Map<string, { exists: boolean; urlType: string }>> {
  const operatorError = validateOperatorId(request.operatorId);
  if (operatorError) throw new DropZoneSaveRefusedError(operatorError);
  if (!(await operatorExists(c, request.operatorId))) throw new DropZoneSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
  const subpages = [...new Set(request.assignments.map((a) => a.subpage.trim().toUpperCase()).filter(Boolean))];
  const removed = state.configs.filter((x) => request.assignments.some((a) =>
    a.page.trim().toUpperCase() === x.page && a.fieldName.trim() === x.fieldName && a.subpage.trim().toUpperCase() !== x.serviceId)).map((x) => x.serviceId);
  // The drop zone is usually on Oracle's page; what is the organization's is the subpage it shows.
  for (const id of new Set([...subpages, ...removed])) {
    const scope = writeScopeRefusal(id);
    if (scope) throw new DropZoneSaveRefusedError(`Subpage ${scope}`);
  }
  const services = new Map<string, { exists: boolean; urlType: string }>();
  for (const id of subpages) {
    const [p] = await select<{ T: number }>(c, `SELECT PNLTYPE AS T FROM PSPNLDEFN WHERE PNLNAME = :p`, { p: id });
    if (!p) throw new DropZoneSaveRefusedError(`${id} is not a page in this database.`);
    if (Number(p.T) !== 1) throw new DropZoneSaveRefusedError(`${id} is not a subpage (its page type is ${p.T}): a drop zone shows a subpage.`);
    const [d] = await select<{ U: string }>(c, `SELECT PTCS_SERVICEURLTYP AS U FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID = :s`, { s: id });
    services.set(id, { exists: Boolean(d), urlType: s(d?.U) });
  }
  if (state.owners.some((o) => o.portal !== UNREGISTERED_COMPONENT_PORTAL)) {
    const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSPTCS_SRVCFG WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :c`,
      { p: UNREGISTERED_COMPONENT_PORTAL, c: state.component });
    if (Number(N) > 0) {
      throw new DropZoneSaveRefusedError(`${state.component} has drop zones configured from before it was registered (${UNREGISTERED_COMPONENT_PORTAL}); ` +
        'save it once on the Configure Drop Zones page, which moves them, then here.');
    }
  }
  return services;
}

/** Saves the drop zones' subpages in one transaction; refused on an error or a configuration changed since it was read. */
export async function saveDropZones(c: Connection, request: DropZoneSaveRequest): Promise<DropZoneSaveResult> {
  try {
    const component = request.component.trim().toUpperCase();
    const market = (request.market ?? 'GBL').trim().toUpperCase();
    const counters = await readCounterState(c, true);
    const state = await readDropZoneState(c, component, market, true);
    const token = dropZoneToken(state);
    if (token !== request.openedToken) {
      throw new DropZoneSaveRefusedError(`${component}'s drop-zone configuration was changed since it was read (another save, possibly on the PIA page). Reopen it and reapply the change.`);
    }
    const services = await checkRequest(c, state, request);
    const plan = planDropZoneSave(state, request.assignments, {
      counters, ts: await now(c), operatorId: request.operatorId,
      tracked: await trackedRecords(c, ['PSPTCS_SRVCFG', 'PSPTCSSRVDEFN', 'PSPTCSSRVCONF', 'PSPTCS_MENU_TBL', 'PSPTCS_MNUFLDRS', 'PSPTCS_MNULINKS']), services
    });
    if (request.dryRun || plan.empty) {
      await c.rollback();
      return { plan, token, written: false };
    }
    await run(c, plan.statements);
    await verifyDropZones(c, component, market, plan);
    await c.commit();
    return { plan, token: dropZoneToken(await readDropZoneState(c, component, market)), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** Proves the stored configuration is the plan's: each changed drop zone's subpage under each owner, and the counters. */
export async function verifyDropZones(c: Connection, component: string, market: string, plan: DropZonePlan): Promise<void> {
  const problems: string[] = [];
  const state = await readDropZoneState(c, component, market);
  for (const [key, subpage] of plan.expected) {
    const [portal, cref, page, ...rest] = key.split('|');
    const fieldName = rest.join('|');
    const got = state.configs.filter((x) => x.owner === `${portal}|${cref}` && x.page === page && x.fieldName === fieldName);
    if (subpage ? got.length !== 1 || got[0].serviceId !== subpage : got.length !== 0) {
      problems.push(`${cref} ${page} ${fieldName}: ${got.map((x) => x.serviceId).join(', ') || 'none'}, ${subpage || 'none'} expected`);
    }
  }
  const counters = await readCounterState(c, false);
  for (const n of ['RCSDM', 'RCSCM', 'SCNFM', 'RCMTM', 'SYS'] as CounterName[]) {
    if (counters.version[n] !== plan.counters.version[n]) problems.push(`PSVERSION ${n} ${counters.version[n]}, ${plan.counters.version[n]} expected`);
  }
  if (problems.length) throw new DropZoneSaveRefusedError(`The written rows are not the planned ones (${problems.slice(0, 6).join('; ')}).`);
}
