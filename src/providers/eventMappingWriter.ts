import { createHash } from 'node:crypto';
import type { DbConnection as Connection } from '../db/connection.js';
import {
  EVENT_MAPPING_PORTAL, normalizeConfigRow, validateConfigRows, describeMapping, type EventMappingConfigRow, type EventLevel
} from '../model/eventMapping.js';
import { SaveRefusedError, validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { trackedRecords, dataSetsOf, trackingDelete, trackingUpsert, type TrackedKey } from './adsTracking.js';
import { run, type Statement } from './appEngineWriter.js';
import { operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

/*
 * Writing Event Mapping configurations as PeopleTools' Configure Event
 * Mapping page saves them (docs/CUSTOMIZATION.md "Writing Event Mapping";
 * captures tools/corpus/save-protocol/results/em01-em08).
 *
 * The page (PTCSSERVICES.PT_EVMAPPING_FL, PTCS_EV_CFG_WRK.BTN_SAVE) saves
 * through the related-content API, which on every Save
 * - deletes and re-inserts each row of the grid, in grid order, changed or
 *   not: VERSION the next SCNFM, stamped [em04-em06]; a stored row keeps its
 *   other columns, a new one is blank but IS_DEFAULT 'N' [em04];
 * - keeps a row's EV_PARAM mapping (PSPTCS_MAPFLDS) with the Event Map
 *   Parameter in PTCS_PNLFLDNAME, and gives a new row one only when it has a
 *   parameter [em04];
 * - deletes a removed row, its mappings, and leaves PSPTCSSRVCNFDEL at the
 *   next SCNFM, after the kept rows [em06];
 * - for a content reference not configured yet, adds PSPTCS_SRVCFG (its menu
 *   and component from the registry, ExpandFrame N, frame location B) at the
 *   next RCSCM [em03, em08; RCService constructor].
 * Each SCNFM and RCSCM step moves SYS too. Removing the configuration (the
 * list's Remove) deletes every row with its tombstone, then PSPTCS_SRVCFG
 * with PSPTCSSRVCFGDEL at the next RCSCM [em07]. A service mapped for the
 * first time gets the EV_PARAM parameter (PSPTCS_PARAMS) and its VERSION the
 * next RCSDM, as the classic page does [em03] (the fluid page's own handling
 * of a service without one is not captured yet). Data Migration Workbench
 * tracking rows are kept as PIA keeps them (adsTracking.ts).
 */

export class EventMappingSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'EventMappingSaveRefusedError'; }
}

type Row = Record<string, unknown>;

export interface Counters { SCNFM: number; RCSCM: number; RCSDM: number; SYS: number }
type CounterName = keyof Counters;
const COUNTERS: readonly CounterName[] = ['SCNFM', 'RCSCM', 'RCSDM', 'SYS'];

/** PSPTCSSRVCONF's columns but LASTUPDDTTM, which is read as text. */
const CONF_COLUMNS = ['PORTAL_NAME', 'PORTAL_OBJNAME', 'PTCS_SERVICEID', 'PTCS_INSTANCEID', 'PTCS_ISCOMPSERVICE', 'PNLNAME', 'SEQNUM', 'PTCS_HIDEFROMSRCH',
  'IS_DEFAULT', 'PTCS_MAPSECOPTIONS', 'HANDLERNAME', 'PTCS_INSTANCELBL', 'PTCS_URLTARGET', 'PTCS_RCMENUOPT', 'PTCS_MAINMENUOPT', 'PTCS_SEQNUM_MMNU',
  'PTCS_SEQNUM_RMNU', 'PACKAGEROOT', 'QUALIFYPATH', 'APPCLASSID', 'PTCS_INITMIN', 'PTCS_ENABLE', 'PTCS_SRVOPENOPTION', 'PTCS_EMBEDDABLE', 'PTCS_SUOWSERV',
  'VERSION', 'LASTUPDOPRID', 'OBJECTOWNERID', 'PTCS_SRVCATTR', 'OPRID', 'PTCS_MASTERTMPL', 'RECNAME', 'PTCS_CMPEVENT', 'PTCS_PROCSEQ', 'PTCS_CMPRECEVENT',
  'PTCS_ALLOWPERSONAL', 'FIELDNAME'] as const;
const NUMERIC = new Set(['PTCS_INSTANCEID', 'SEQNUM', 'PTCS_SEQNUM_MMNU', 'PTCS_SEQNUM_RMNU', 'VERSION']);
const MAP_COLUMNS = ['PORTAL_NAME', 'PORTAL_OBJNAME', 'PTCS_SERVICEID', 'PTCS_INSTANCEID', 'PTCS_PARAMETERNAME', 'PTCS_PNLFLDNAME', 'PTCS_PNLNAME',
  'PTCS_MAPFIELDTYPE', 'PTCSREFRESHSERVICE', 'PTCS_MAPNULLVALUE', 'PTCS_FIELDMENUOPT', 'PTCS_SEQNUM_FMNU'] as const;
const SRVCFG_COLUMNS = ['PORTAL_NAME', 'PORTAL_OBJNAME', 'MENUNAME', 'PNLGRPNAME', 'PTCS_EXPANDFRAME', 'PTCS_RCFRAMELOC', 'PTCS_NMINPAGELETS', 'VERSION',
  'LASTUPDOPRID', 'OBJECTOWNERID'] as const;
const EV_PARAM = 'EV_PARAM';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : ' ');

// ---------------------------------------------------------------------------
// Reading

/** A content reference's Event Mapping configuration as stored. */
export interface StoredConfiguration {
  /** The content reference (PORTAL_OBJNAME). */
  cref: string;
  /** PSPTCS_SRVCFG: the content reference is configured. */
  exists: boolean;
  serviceConfig?: Row;
  /** PSPTCSSRVCONF rows, in the order the page lists them (the last save's). */
  configs: Row[];
  /** PSPTCS_MAPFLDS rows of those configurations. */
  mapFields: Row[];
}

export async function readStoredConfiguration(c: Connection, cref: string, forUpdate: boolean): Promise<StoredConfiguration> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const b = { p: EVENT_MAPPING_PORTAL, n: cref };
  const [serviceConfig] = await select<Row>(c,
    `SELECT ${SRVCFG_COLUMNS.join(', ')}, TO_CHAR(LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM FROM PSPTCS_SRVCFG WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n${lock}`, b);
  const configs = await select<Row>(c,
    `SELECT ${CONF_COLUMNS.join(', ')}, TO_CHAR(LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM FROM PSPTCSSRVCONF
      WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n ORDER BY VERSION, PTCS_INSTANCEID${lock}`, b);
  const mapFields = await select<Row>(c,
    `SELECT ${MAP_COLUMNS.join(', ')} FROM PSPTCS_MAPFLDS WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n ORDER BY PTCS_INSTANCEID, PTCS_PARAMETERNAME${lock}`, b);
  return { cref, exists: !!serviceConfig, ...(serviceConfig ? { serviceConfig } : {}), configs, mapFields };
}

/** The stored configurations as the page's rows. */
export function configRowsOf(stored: StoredConfiguration): EventMappingConfigRow[] {
  return stored.configs.map((r) => {
    const level = s(r.PTCS_ISCOMPSERVICE) as EventLevel;
    const instanceId = Number(r.PTCS_INSTANCEID);
    const param = stored.mapFields.find((m) => Number(m.PTCS_INSTANCEID) === instanceId && s(m.PTCS_PARAMETERNAME) === EV_PARAM);
    return {
      instanceId, level,
      ...(s(r.PNLNAME) ? { page: s(r.PNLNAME) } : {}), ...(s(r.RECNAME) ? { record: s(r.RECNAME) } : {}), ...(s(r.FIELDNAME) ? { field: s(r.FIELDNAME) } : {}),
      event: level === 'C' ? s(r.PTCS_CMPEVENT) : s(r.PTCS_CMPRECEVENT), serviceId: s(r.PTCS_SERVICEID),
      processing: s(r.PTCS_PROCSEQ) as EventMappingConfigRow['processing'], sequence: Number(r.SEQNUM ?? 0), enabled: s(r.PTCS_ENABLE) === 'Y',
      ...(param && s(param.PTCS_PNLFLDNAME) ? { parameter: s(param.PTCS_PNLFLDNAME) } : {})
    };
  });
}

/** The concurrency token: every save moves the configuration rows' VERSIONs. */
export function configurationToken(stored: StoredConfiguration | undefined): string {
  if (!stored || !stored.exists) return 'absent';
  const parts = [`S${Number(stored.serviceConfig?.VERSION)}`, ...stored.configs.map((r) => `C${Number(r.PTCS_INSTANCEID)}:${Number(r.VERSION)}`).sort()];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

export async function readCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const rows = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN (${COUNTERS.map((n) => `'${n}'`).join(', ')})${lock}`);
  const out = {} as Counters;
  for (const n of COUNTERS) {
    const r = rows.find((x) => s(x.T) === n);
    if (!r) throw new EventMappingSaveRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
    out[n] = Number(r.V);
  }
  return out;
}

/** What the content reference names and the services the rows map: what the plan and its checks need. */
export interface ConfigurationContext {
  /** The portal the content reference is registered in (EMPLOYEE). */
  portal: string;
  /** The content reference's menu and component (PORTAL_URI_SEG1 / SEG2), as PSPTCS_SRVCFG records them. */
  menu: string;
  component: string;
  market: string;
  /** Services mapped by the rows, by ID: whether they exist as Application Class services and carry EV_PARAM. */
  services: Map<string, { exists: boolean; appClass: boolean; evParam: boolean; version: number }>;
  /** The (data set|record) pairs this database tracks. */
  tracked: Set<string>;
}

export async function readConfigurationContext(c: Connection, portal: string, cref: string, serviceIds: readonly string[]): Promise<ConfigurationContext> {
  const [r] = await select<Row>(c,
    `SELECT PORTAL_URI_SEG1 AS M, PORTAL_URI_SEG2 AS C, PORTAL_URI_SEG3 AS K, PORTAL_CREF_USGT AS U, PORTAL_CREF_URLT AS T FROM PSPRSMDEFN
      WHERE PORTAL_NAME = :p AND PORTAL_REFTYPE = 'C' AND PORTAL_OBJNAME = :n`, { p: portal, n: cref });
  if (!r) throw new EventMappingSaveRefusedError(`${cref} is not a content reference in the ${portal} portal registry.`);
  if (s(r.U) !== 'TARG' || s(r.T) !== 'UPGE') {
    throw new EventMappingSaveRefusedError(`${cref} is not a PeopleSoft component target content reference (usage ${s(r.U)}, URL type ${s(r.T)}): the page offers only those.`);
  }
  const services = new Map<string, { exists: boolean; appClass: boolean; evParam: boolean; version: number }>();
  for (const id of [...new Set(serviceIds)]) {
    const [d] = await select<Row>(c, `SELECT PTCS_SERVICEURLTYP AS T, VERSION AS V FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID = :s`, { s: id });
    const [p] = await select<Row>(c, `SELECT 'X' AS X FROM PSPTCS_PARAMS WHERE PTCS_SERVICEID = :s AND PTCS_PARAMETERNAME = '${EV_PARAM}'`, { s: id });
    services.set(id, { exists: !!d, appClass: s(d?.T) === 'UAPC', evParam: !!p, version: Number(d?.V ?? 0) });
  }
  const tracked = await trackedRecords(c, ['PSPTCS_SRVCFG', 'PSPTCSSRVCONF', 'PSPTCSSRVDEFN']);
  return { portal, menu: s(r.M), component: s(r.C), market: s(r.K), services, tracked };
}

/**
 * Whether the rows' pages, records and fields exist as the page's
 * unrestricted prompts take them (errors), and whether they are on the
 * component's own pages as its default prompts offer (warnings)
 * [PTCS_EV_CFG_WRK.PTCS_UNRESTRICT FieldChange].
 */
export async function checkTargets(c: Connection, rows: readonly EventMappingConfigRow[], component: string): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cmpPages = `SELECT PNLNAME FROM PSPNLGROUP WHERE PNLGRPNAME = :g`;
  for (const [i, raw] of rows.entries()) {
    const r = normalizeConfigRow(raw);
    const at = `Row ${i + 1}`;
    if (r.level === 'R' && r.page) {
      const [p] = await select<Row>(c, `SELECT PNLTYPE AS T FROM PSPNLDEFN WHERE PNLNAME = :x`, { x: r.page });
      if (!p || [1, 10].includes(Number(p.T))) errors.push(`${at}: ${r.page} is not a page (subpages and layout pages are not offered).`);
      else {
        const [on] = await select<Row>(c, `SELECT 'X' AS X FROM PSPNLGROUP WHERE PNLGRPNAME = :g AND PNLNAME = :x
          UNION SELECT 'X' AS X FROM PSPNLFIELD WHERE FIELDTYPE = 18 AND SUBPNLNAME = :x AND PNLNAME IN (${cmpPages})`, { g: component, x: r.page });
        if (!on) warnings.push(`${at}: ${r.page} is not a page of ${component} (the page offers it only with Unrestricted Prompt).`);
      }
    }
    if ((r.level === 'P' || r.level === 'F') && r.record) {
      const [d] = await select<Row>(c, `SELECT RECTYPE AS T FROM PSRECDEFN WHERE RECNAME = :x`, { x: r.record });
      if (!d || [3, 7].includes(Number(d.T))) { errors.push(`${at}: ${r.record} is not a record (subrecords and temporary tables are not offered).`); continue; }
      const [on] = await select<Row>(c, `SELECT 'X' AS X FROM PSPNLFIELD WHERE RECNAME = :x AND PNLNAME IN (${cmpPages}) FETCH FIRST 1 ROWS ONLY`, { g: component, x: r.record });
      if (!on) warnings.push(`${at}: ${r.record} is not on ${component}'s pages (the page offers it only with Unrestricted Prompt).`);
      if (r.level === 'F' && r.field) {
        const [f] = await select<Row>(c, `SELECT 'X' AS X FROM PSRECFIELDDB WHERE RECNAME = :x AND FIELDNAME = :f`, { x: r.record, f: r.field });
        if (!f) errors.push(`${at}: ${r.record} has no field ${r.field}.`);
        else if (on) {
          const [pf] = await select<Row>(c, `SELECT 'X' AS X FROM PSPNLFIELD WHERE RECNAME = :x AND FIELDNAME = :f AND PNLNAME IN (${cmpPages}) FETCH FIRST 1 ROWS ONLY`,
            { g: component, x: r.record, f: r.field });
          if (!pf) warnings.push(`${at}: ${r.record}.${r.field} is not on ${component}'s pages (the page offers it only with Unrestricted Prompt).`);
        }
      }
    }
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Planning

export interface ConfigurationPlanSummary {
  changes: string[];
  /** Rows restamped though unchanged, as the page re-saves every row (Oracle's among them). */
  restamped: number;
  warnings: string[];
}

export interface ConfigurationPlan {
  cref: string;
  empty: boolean;
  statements: Statement[];
  /** The rows as they will be stored, instance IDs assigned. */
  rows: EventMappingConfigRow[];
  counters: Counters;
  summary: ConfigurationPlanSummary;
}

export interface ConfigurationPlanOptions {
  operatorId: string;
  lastupddttm: string;
  counters: Counters;
  context: ConfigurationContext;
  /** Rand() for new instance IDs (tests pass their own). */
  random?: () => number;
  warnings?: string[];
}

/** A new configuration's instance ID as the page draws it (RCService.GenerateInstanceID): two random runs of digits, at least 1,000,000, unused on the content reference. */
export function newInstanceId(used: Set<number>, random: () => number = Math.random): number {
  for (;;) {
    const id = Number(`${Math.floor(random() * 10000)}${Math.floor(random() * 100000)}`);
    if (id >= 1000000 && !used.has(id)) return id;
  }
}

const sameRow = (a: EventMappingConfigRow, b: EventMappingConfigRow) => JSON.stringify(normalizeConfigRow(a)) === JSON.stringify(normalizeConfigRow(b));

function insertRow(table: string, row: Row, ts: string | undefined): Statement {
  const cols = Object.keys(row);
  const binds: Record<string, unknown> = {};
  cols.forEach((col, i) => { binds[`b${i}`] = row[col]; });
  const values = cols.map((_, i) => `:b${i}`);
  if (ts !== undefined) { cols.push('LASTUPDDTTM'); values.push(`TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT})`); binds.ts = ts; }
  return { sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values.join(', ')})`, binds, expect: 1, what: `Inserting ${table}` };
}

/** PSVERSION set; PSLOCK moved by the same steps (its RCSDM runs ahead of PSVERSION on HRDMO [em01]); SYS has no PSLOCK row moved. */
function counterStatements(from: Counters, to: Counters): Statement[] {
  const st: Statement[] = [];
  for (const n of COUNTERS) {
    if (to[n] === from[n]) continue;
    st.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
    if (n !== 'SYS') st.push({ sql: `UPDATE PSLOCK SET VERSION = VERSION + :d WHERE OBJECTTYPENAME = '${n}'`, binds: { d: to[n] - from[n] }, what: `Updating PSLOCK ${n}` });
  }
  return st;
}

const confKeys = (cref: string, serviceId: string, instanceId: number): TrackedKey =>
  [['PORTAL_NAME', EVENT_MAPPING_PORTAL], ['PORTAL_OBJNAME', cref], ['PTCS_SERVICEID', serviceId], ['PTCS_INSTANCEID', instanceId]];
const cfgKeys = (cref: string): TrackedKey => [['PORTAL_NAME', EVENT_MAPPING_PORTAL], ['PORTAL_OBJNAME', cref]];

/**
 * The statements that make the content reference's configuration the rows,
 * as the page's Save does (module comment). Pure: the caller reads the
 * stored configuration, the context and the counters FOR UPDATE.
 */
export function planConfigurationSave(stored: StoredConfiguration, rowsIn: readonly EventMappingConfigRow[], opts: ConfigurationPlanOptions): ConfigurationPlan {
  const cref = stored.cref;
  const problems = validateConfigRows(rowsIn);
  if (problems.length) throw new EventMappingSaveRefusedError(`The configuration has errors: ${problems.slice(0, 5).map((p) => (p.row ? `row ${p.row}: ` : '') + p.message).join('; ')}`);
  const rows = rowsIn.map(normalizeConfigRow);
  const storedRows = configRowsOf(stored);
  const byId = new Map(stored.configs.map((r) => [Number(r.PTCS_INSTANCEID), r]));
  const storedById = new Map(storedRows.map((r) => [r.instanceId!, r]));
  for (const [i, r] of rows.entries()) {
    if (r.instanceId === undefined) continue;
    const was = storedById.get(r.instanceId);
    if (!was) throw new EventMappingSaveRefusedError(`Row ${i + 1}: ${cref} has no configuration ${r.instanceId} (reopen it).`);
    if (was.level !== r.level || was.serviceId !== r.serviceId) {
      throw new EventMappingSaveRefusedError(`Row ${i + 1}: a saved configuration's level and service cannot change (the page locks them); remove it and add a new row.`);
    }
  }
  for (const r of rows) {
    const svc = opts.context.services.get(r.serviceId);
    if (!svc?.exists) throw new EventMappingSaveRefusedError(`There is no related content service ${r.serviceId}.`);
    if (!svc.appClass) throw new EventMappingSaveRefusedError(`${r.serviceId} is not an Application Class service: Event Mapping runs only those.`);
  }

  const kept = new Set(rows.map((r) => r.instanceId).filter((x): x is number => !!x));
  const removed = storedRows.filter((r) => !kept.has(r.instanceId!));
  const added = rows.filter((r) => r.instanceId === undefined);
  const edited = rows.filter((r) => r.instanceId !== undefined && !sameRow(r, storedById.get(r.instanceId)!));
  const reordered = rows.filter((r) => r.instanceId !== undefined).map((r) => r.instanceId).join(',') !== storedRows.filter((r) => kept.has(r.instanceId!)).map((r) => r.instanceId).join(',');
  const changed = !stored.exists || removed.length > 0 || added.length > 0 || edited.length > 0 || reordered;
  const next = { ...opts.counters };
  const summary: ConfigurationPlanSummary = { changes: [], restamped: 0, warnings: [...(opts.warnings ?? [])] };
  if (!changed) return { cref, empty: true, statements: [], rows, counters: next, summary };

  const { context, operatorId, lastupddttm: ts } = opts;
  const statements: Statement[] = [];
  const bump = (n: Exclude<CounterName, 'SYS'>, sys: boolean) => { next[n] += 1; if (sys) next.SYS += 1; return next[n]; };

  if (!stored.exists) {
    const version = bump('RCSCM', true);
    statements.push(insertRow('PSPTCS_SRVCFG', {
      PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, MENUNAME: context.menu, PNLGRPNAME: context.component, PTCS_EXPANDFRAME: 'N',
      PTCS_RCFRAMELOC: 'B', PTCS_NMINPAGELETS: 0, VERSION: version, LASTUPDOPRID: operatorId, OBJECTOWNERID: ' '
    }, ts));
    for (const ads of dataSetsOf(context.tracked, 'PSPTCS_SRVCFG')) statements.push(...trackingUpsert(ads, 'PSPTCS_SRVCFG', cfgKeys(cref), ts, operatorId));
    summary.changes.push(`configure ${cref} (menu ${context.menu}, component ${context.component})`);
  }

  const used = new Set<number>(stored.configs.map((r) => Number(r.PTCS_INSTANCEID)));
  const random = opts.random ?? Math.random;
  const finalRows: EventMappingConfigRow[] = [];
  for (const r of rows) {
    const isNew = r.instanceId === undefined;
    const instanceId = isNew ? newInstanceId(used, random) : r.instanceId!;
    used.add(instanceId);
    const version = bump('SCNFM', true);
    const base: Row = isNew
      ? Object.fromEntries(CONF_COLUMNS.map((col) => [col, NUMERIC.has(col) ? 0 : ' ']))
      : Object.fromEntries(CONF_COLUMNS.map((col) => [col, byId.get(instanceId)![col]]));
    const row: Row = {
      ...base,
      ...(isNew ? { IS_DEFAULT: 'N' } : {}),
      PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, PTCS_SERVICEID: r.serviceId, PTCS_INSTANCEID: instanceId,
      PTCS_ISCOMPSERVICE: r.level, PNLNAME: blank(r.page), RECNAME: blank(r.record), FIELDNAME: blank(r.field),
      PTCS_CMPEVENT: r.level === 'C' ? r.event : ' ', PTCS_CMPRECEVENT: r.level === 'C' ? ' ' : r.event,
      PTCS_PROCSEQ: r.processing, PTCS_ENABLE: r.enabled ? 'Y' : 'N', SEQNUM: r.sequence,
      VERSION: version, LASTUPDOPRID: operatorId
    };
    for (const col of CONF_COLUMNS) if (row[col] === null || row[col] === undefined || (!NUMERIC.has(col) && s(row[col]) === '')) row[col] = NUMERIC.has(col) ? 0 : ' ';
    const maps = stored.mapFields.filter((m) => Number(m.PTCS_INSTANCEID) === instanceId);
    if (!isNew) {
      statements.push({ sql: 'DELETE FROM PSPTCS_MAPFLDS WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i',
        binds: { p: EVENT_MAPPING_PORTAL, n: cref, i: instanceId }, what: 'Deleting PSPTCS_MAPFLDS' });
      statements.push({ sql: 'DELETE FROM PSPTCSSRVCONF WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i',
        binds: { p: EVENT_MAPPING_PORTAL, n: cref, i: instanceId }, expect: 1, what: 'Deleting PSPTCSSRVCONF' });
    }
    statements.push(insertRow('PSPTCSSRVCONF', row, ts));
    let hasParam = false;
    for (const m of maps) {
      const ev = s(m.PTCS_PARAMETERNAME) === EV_PARAM;
      hasParam ||= ev;
      statements.push(insertRow('PSPTCS_MAPFLDS', {
        ...Object.fromEntries(MAP_COLUMNS.map((col) => [col, m[col] ?? (col === 'PTCS_SEQNUM_FMNU' ? 0 : ' ')])),
        ...(ev ? { PTCS_PNLFLDNAME: blank(r.parameter) } : {})
      }, undefined));
    }
    if (!hasParam && r.parameter) {
      statements.push(insertRow('PSPTCS_MAPFLDS', {
        PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, PTCS_SERVICEID: r.serviceId, PTCS_INSTANCEID: instanceId, PTCS_PARAMETERNAME: EV_PARAM,
        PTCS_PNLFLDNAME: r.parameter, PTCS_PNLNAME: ' ', PTCS_MAPFIELDTYPE: ' ', PTCSREFRESHSERVICE: ' ', PTCS_MAPNULLVALUE: ' ', PTCS_FIELDMENUOPT: ' ', PTCS_SEQNUM_FMNU: 0
      }, undefined));
    }
    for (const ads of dataSetsOf(context.tracked, 'PSPTCSSRVCONF')) statements.push(...trackingUpsert(ads, 'PSPTCSSRVCONF', confKeys(cref, r.serviceId, instanceId), ts, operatorId));
    const final = { ...r, instanceId };
    finalRows.push(final);
    if (isNew) summary.changes.push(`add ${describeMapping({ ...asMapping(final, cref) })}`);
    else if (edited.includes(r)) summary.changes.push(`change ${describeMapping(asMapping(final, cref))}`);
    else summary.restamped++;
  }

  // Deleted rows go last, as the page's deleted rows do [em06].
  for (const r of removed) {
    const version = bump('SCNFM', true);
    const b = { p: EVENT_MAPPING_PORTAL, n: cref, i: r.instanceId };
    statements.push({ sql: 'DELETE FROM PSPTCS_MAPFLDS WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i', binds: b, what: 'Deleting PSPTCS_MAPFLDS' });
    statements.push({ sql: 'DELETE FROM PSPTCSSRVCONF WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i', binds: b, expect: 1, what: 'Deleting PSPTCSSRVCONF' });
    statements.push(insertRow('PSPTCSSRVCNFDEL', { PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, PTCS_SERVICEID: r.serviceId, PTCS_INSTANCEID: r.instanceId, VERSION: version }, undefined));
    for (const ads of dataSetsOf(context.tracked, 'PSPTCSSRVCONF')) statements.push(trackingUpsert(ads, 'PSPTCSSRVCONF', confKeys(cref, r.serviceId, r.instanceId!), ts, operatorId)[0]);
    summary.changes.push(`remove ${describeMapping(asMapping(r, cref))}`);
  }

  // A service mapped for the first time gets EV_PARAM, as the classic page gives it [em03].
  for (const id of [...new Set(rows.map((r) => r.serviceId))]) {
    const svc = context.services.get(id)!;
    if (svc.evParam) continue;
    const version = bump('RCSDM', false);
    statements.push(insertRow('PSPTCS_PARAMS', { PTCS_SERVICEID: id, PTCS_PARAMETERNAME: EV_PARAM, SEQNUM: 1, REQUIRED_FLG: 'N', PTCS_DESCR128: 'For Event Mapping' }, undefined));
    statements.push({ sql: 'UPDATE PSPTCSSRVDEFN SET VERSION = :v WHERE PTCS_SERVICEID = :s', binds: { v: version, s: id }, expect: 1, what: 'Updating PSPTCSSRVDEFN' });
    for (const ads of dataSetsOf(context.tracked, 'PSPTCSSRVDEFN')) statements.push(...trackingUpsert(ads, 'PSPTCSSRVDEFN', [['PTCS_SERVICEID', id]], ts, operatorId));
    summary.changes.push(`give service ${id} the EV_PARAM parameter`);
  }

  statements.push(...counterStatements(opts.counters, next));
  return { cref, empty: false, statements, rows: finalRows, counters: next, summary };
}

function asMapping(r: EventMappingConfigRow, cref: string) {
  return { ...r, contentReference: cref, enabled: r.enabled };
}

/**
 * The list's Remove [em07]: every configuration row deleted with its
 * tombstone at the next SCNFM, then PSPTCS_SRVCFG with PSPTCSSRVCFGDEL at
 * the next RCSCM; each step moves SYS. Services keep EV_PARAM.
 */
export function planConfigurationRemove(stored: StoredConfiguration, counters: Counters, context: Pick<ConfigurationContext, 'tracked'>, ts: string, operatorId: string): { statements: Statement[]; counters: Counters } {
  const cref = stored.cref;
  const next = { ...counters };
  const statements: Statement[] = [];
  const b = { p: EVENT_MAPPING_PORTAL, n: cref };
  for (const r of stored.configs) {
    next.SCNFM += 1; next.SYS += 1;
    const id = Number(r.PTCS_INSTANCEID);
    const serviceId = s(r.PTCS_SERVICEID);
    statements.push({ sql: 'DELETE FROM PSPTCS_MAPFLDS WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i', binds: { ...b, i: id }, what: 'Deleting PSPTCS_MAPFLDS' });
    statements.push({ sql: 'DELETE FROM PSPTCSSRVCONF WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i', binds: { ...b, i: id }, expect: 1, what: 'Deleting PSPTCSSRVCONF' });
    statements.push(insertRow('PSPTCSSRVCNFDEL', { PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, PTCS_SERVICEID: serviceId, PTCS_INSTANCEID: id, VERSION: next.SCNFM }, undefined));
    for (const ads of dataSetsOf(context.tracked, 'PSPTCSSRVCONF')) statements.push(trackingUpsert(ads, 'PSPTCSSRVCONF', confKeys(cref, serviceId, id), ts, operatorId)[0]);
  }
  next.RCSCM += 1; next.SYS += 1;
  statements.push({ sql: 'DELETE FROM PSPTCS_SRVCFG WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n', binds: b, expect: 1, what: 'Deleting PSPTCS_SRVCFG' });
  statements.push(insertRow('PSPTCSSRVCFGDEL', { PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, VERSION: next.RCSCM }, undefined));
  for (const ads of dataSetsOf(context.tracked, 'PSPTCS_SRVCFG')) {
    // PIA drops the content reference's RCF_SERVICE_CREFS row and refreshes RCF_SERVICES [em07].
    if (ads === 'RCF_SERVICE_CREFS') statements.push(trackingDelete(ads, 'PSPTCS_SRVCFG', cfgKeys(cref)));
    else statements.push(...trackingUpsert(ads, 'PSPTCS_SRVCFG', cfgKeys(cref), ts, operatorId));
  }
  statements.push(...counterStatements(counters, next));
  return { statements, counters: next };
}

// ---------------------------------------------------------------------------
// Running

export interface ConfigurationSaveRequest {
  /** The content reference (PORTAL_OBJNAME). */
  cref: string;
  /** The portal it is registered in (default EMPLOYEE). */
  portal?: string;
  rows: EventMappingConfigRow[];
  openedToken: string;
  operatorId: string;
  dryRun?: boolean;
}

export interface ConfigurationSaveResult {
  plan: ConfigurationPlan;
  token: string;
  written: boolean;
}

async function prepare(c: Connection, operatorId: string, serviceIds: readonly string[]): Promise<void> {
  const operatorError = validateOperatorId(operatorId);
  if (operatorError) throw new EventMappingSaveRefusedError(operatorError);
  // The configuration hangs off a content reference that is usually Oracle's; what is the organization's is the code it runs.
  for (const id of serviceIds) {
    const scope = writeScopeRefusal(id);
    if (scope) throw new EventMappingSaveRefusedError(`Service ${scope}`);
  }
  if (!(await operatorExists(c, operatorId))) throw new EventMappingSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
}

async function now(c: Connection): Promise<string> {
  const [{ TS }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
  return TS;
}

/** Saves the content reference's configuration in one transaction; refused on an error or a configuration changed since it was read. */
export async function saveConfiguration(c: Connection, request: ConfigurationSaveRequest): Promise<ConfigurationSaveResult> {
  try {
    const rows = request.rows.map(normalizeConfigRow);
    const portal = (request.portal ?? 'EMPLOYEE').trim().toUpperCase();
    const cref = request.cref.trim().toUpperCase();
    await prepare(c, request.operatorId, [...new Set(rows.filter((r) => !r.instanceId).map((r) => r.serviceId))]);
    const stored = await readStoredConfiguration(c, cref, true);
    const token = configurationToken(stored);
    if (token !== request.openedToken) {
      throw new EventMappingSaveRefusedError(request.openedToken === 'absent'
        ? `${cref} already has an Event Mapping configuration; reopen it.`
        : `${cref}'s Event Mapping configuration was changed since it was read (another save, possibly on the PIA page). Reopen it and reapply the change.`);
    }
    const context = await readConfigurationContext(c, portal, cref, rows.map((r) => r.serviceId));
    const targets = await checkTargets(c, rows, context.component);
    if (targets.errors.length) throw new EventMappingSaveRefusedError(targets.errors.slice(0, 5).join('; '));
    const plan = planConfigurationSave(stored, rows, {
      operatorId: request.operatorId, lastupddttm: await now(c), counters: await readCounters(c, true), context, warnings: targets.warnings
    });
    if (request.dryRun || plan.empty) {
      await c.rollback();
      return { plan, token, written: false };
    }
    await run(c, plan.statements);
    await verifyConfiguration(c, plan);
    await c.commit();
    return { plan, token: configurationToken(await readStoredConfiguration(c, cref, false)), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** Proves the stored configuration is the plan's: its rows, their VERSIONs, the parameters, the counters. */
export async function verifyConfiguration(c: Connection, plan: ConfigurationPlan): Promise<void> {
  const problems: string[] = [];
  const stored = await readStoredConfiguration(c, plan.cref, false);
  if (!stored.exists) problems.push('PSPTCS_SRVCFG is missing');
  const got = configRowsOf(stored).map((r) => JSON.stringify(normalizeConfigRow(r))).sort();
  const want = plan.rows.map((r) => JSON.stringify(normalizeConfigRow(r))).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push('the configuration rows differ');
  const versions = stored.configs.map((r) => Number(r.VERSION));
  if (versions.some((v) => v > plan.counters.SCNFM)) problems.push('a row VERSION is past SCNFM');
  const counters = await readCounters(c, false);
  for (const n of COUNTERS) if (counters[n] !== plan.counters[n]) problems.push(`PSVERSION ${n} ${counters[n]}, ${plan.counters[n]} expected`);
  if (problems.length) throw new EventMappingSaveRefusedError(`The written rows are not the planned ones (${problems.slice(0, 6).join('; ')}).`);
}

/** Removes the content reference's configuration (the list's Remove) in one transaction. */
export async function removeConfiguration(c: Connection, cref: string, openedToken: string, operatorId: string): Promise<{ counters: Counters }> {
  try {
    const name = cref.trim().toUpperCase();
    const stored = await readStoredConfiguration(c, name, true);
    await prepare(c, operatorId, [...new Set(stored.configs.map((r) => s(r.PTCS_SERVICEID)))]);
    if (!stored.exists) throw new EventMappingSaveRefusedError(`${name} has no Event Mapping configuration.`);
    if (configurationToken(stored) !== openedToken) throw new EventMappingSaveRefusedError(`${name}'s Event Mapping configuration was changed since it was read.`);
    const context = { tracked: await trackedRecords(c, ['PSPTCS_SRVCFG', 'PSPTCSSRVCONF']) };
    const plan = planConfigurationRemove(stored, await readCounters(c, true), context, await now(c), operatorId);
    await run(c, plan.statements);
    const after = await readStoredConfiguration(c, name, false);
    if (after.exists || after.configs.length || after.mapFields.length) throw new EventMappingSaveRefusedError(`${name} still has configuration rows after the remove.`);
    await c.commit();
    return { counters: plan.counters };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
