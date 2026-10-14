import { createHash } from 'node:crypto';
import type { DbConnection as Connection } from '../db/connection.js';
import { EVENT_MAPPING_PORTAL } from '../model/eventMapping.js';
import { SaveRefusedError, validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { dataSetsOf, trackedRecords, trackingDelete, trackingRefresh, trackingUpsert } from './adsTracking.js';
import { run, type Statement } from './appEngineWriter.js';
import { readCounterState, type CounterName, type CounterState } from './dropZoneWriter.js';
import { cfgKeys, confKeys, insertRow, newInstanceId, now, readStoredConfiguration, type StoredConfiguration } from './eventMappingWriter.js';
import { operatorExists, select } from './peopleCodeWriter.js';
import { derivePfcMappings, pfcContentReferences, type PfcMapping } from './pfcMapper.js';

/*
 * Saving a Page and Field Configurator configuration as PeopleTools' page
 * saves it (EOCC_CONFIGURE; component SavePreChange, EOCC_CONFIG_WRK.NAVIGATION
 * FieldFormula, EOCC_COMP_CONFIG:EventMapping; docs/CUSTOMIZATION.md "Writing
 * Page and Field Configurator"; captures tools/corpus/save-protocol/results/
 * pfc01-configure, pfc02-remove).
 *
 * The configuration's rows (PS_EOCC_CONFIG_HDR, _SEQ, _CRT, _PNL, _FLD) are
 * saved as the component saves them: the header inserted or updated, a child
 * row that changed deleted and inserted [pfc02]. Then, for every content
 * reference of the component that is not a link (pfcMapper.ts), the save
 * regenerates the configuration type's Event Mapping (AddEventMapping):
 *
 * - a content reference with no Event Mapping yet gets PSPTCS_SRVCFG (the
 *   content reference's menu, ExpandFrame N, frame location S) at the next
 *   RCSCM [pfc01]; one that has it keeps it, its RCF_SERVICES tracking
 *   restamped [pfc02];
 * - the type's services are deleted (DeleteUtilityServiceMapping: Standard's
 *   PostBuild, SavePreChange, RowInit/RowInsert 1..n, page, FieldChange and
 *   search services; Masking's EOCC_MASK_*), each row with its tombstone
 *   (PSPTCSSRVCNFDEL) at the next SCNFM, its tracking restamped [pfc02];
 * - the derived rows are inserted, each at the next SCNFM, with an instance id
 *   drawn as the related-content API draws it [pfc01]. When the content
 *   reference's PSPTCS_SRVCFG already existed, each also gets a
 *   PSPTCSSRVCONFLG row with a blank language code, as PIA leaves them
 *   [pfc02]: the API sets the language only on a new service.
 *
 * An inactive header removes the type's services instead (RemoveEventMapping),
 * and a content reference left with no Event Mapping loses PSPTCS_SRVCFG
 * (PSPTCSSRVCFGDEL at the next RCSCM, as the Event Mapping list's Remove
 * [em07]). Each counter step moves SYS; a counter's next value is one past
 * the larger of PSVERSION and PSLOCK. Not written: the numbered
 * EOCC_ROWINITn/ROWINSERTn service definitions the configurator clones when
 * a configuration needs more than exist (refused instead, not captured), and
 * change-tracking (TRK) configurations (no configuration on HRDMO to check
 * the derivation against).
 */

export class PfcSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'PfcSaveRefusedError'; }
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export type PfcTable = 'header' | 'sequences' | 'criteria' | 'pages' | 'fields';
export const PFC_TABLES: Record<PfcTable, string> = {
  header: 'PS_EOCC_CONFIG_HDR', sequences: 'PS_EOCC_CONFIG_SEQ', criteria: 'PS_EOCC_CONFIG_CRT', pages: 'PS_EOCC_CONFIG_PNL', fields: 'PS_EOCC_CONFIG_FLD'
};
const CONFIG_KEYS = ['PNLGRPNAME', 'MARKET', 'EOCC_CONFIG_TYPE'] as const;
/** Each table's keys after the configuration's (PSKEYDEFN). */
export const PFC_ROW_KEYS: Record<PfcTable, readonly string[]> = {
  header: [],
  sequences: ['EOCC_SEQUENCE_NBR', 'SEQUENCE_NBR'],
  criteria: ['SEQUENCE_NBR', 'EOCC_SEQUENCE_NBR', 'RECNAME', 'FIELDNAME', 'PNLFLDID', 'EOCC_CRITERIA_SYM'],
  pages: ['SEQUENCE_NBR', 'EOCC_SEQUENCE_NBR', 'PNLNAME'],
  fields: ['SEQUENCE_NBR', 'EOCC_SEQUENCE_NBR', 'RECNAME', 'FIELDNAME', 'OCCURSLEVEL', 'RECNAME1', 'FIELDNAME1']
};
type ListTable = Exclude<PfcTable, 'header'>;
const CHILDREN: readonly ListTable[] = ['criteria', 'pages', 'fields'];

/** A table's columns as the database has them (they vary by release), with the record field's constant default. */
export type PfcColumns = Record<PfcTable, Array<{ name: string; type: string; default?: string; length?: number }>>;

export interface PfcConfiguration {
  component: string;
  market: string;
  type: string;
  /** Absent when the component has no configuration of the type. */
  header?: Row;
  sequences: Row[];
  criteria: Row[];
  pages: Row[];
  fields: Row[];
}

/** What a caller passes: the configuration's rows by column name; the keys the configuration names are filled in. */
export interface PfcConfigurationInput {
  header: Row;
  sequences: Row[];
  criteria?: Row[];
  pages?: Row[];
  fields?: Row[];
}

// ---------------------------------------------------------------------------
// Reading

export async function readPfcColumns(c: Connection): Promise<PfcColumns> {
  const out = {} as PfcColumns;
  for (const [table, name] of Object.entries(PFC_TABLES) as Array<[PfcTable, string]>) {
    const cols = await select<{ N: string; T: string; L: number }>(c,
      `SELECT COLUMN_NAME AS N, DATA_TYPE AS T, CHAR_LENGTH AS L FROM ALL_TAB_COLUMNS WHERE OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND TABLE_NAME = :t ORDER BY COLUMN_ID`, { t: name });
    if (!cols.length) throw new PfcSaveRefusedError(`${name} is not in this database: the Page and Field Configurator is not installed.`);
    const defaults = await select<{ F: string; D: string }>(c,
      `SELECT FIELDNAME AS F, DEFFIELDNAME AS D FROM PSRECFIELDDB WHERE RECNAME = :r AND DEFRECNAME = ' ' AND DEFFIELDNAME <> ' '`, { r: name.replace(/^PS_/, '') });
    const byField = new Map(defaults.map((x) => [s(x.F), s(x.D)]));
    out[table] = cols.map((x) => ({ name: s(x.N), type: s(x.T), ...(Number(x.L) > 0 ? { length: Number(x.L) } : {}), ...(byField.has(s(x.N)) ? { default: byField.get(s(x.N)) } : {}) }));
  }
  return out;
}

const columnSql = (col: { name: string; type: string }) => (col.type === 'CLOB' ? `DBMS_LOB.SUBSTR(${col.name}, 4000, 1) AS ${col.name}` : col.name);

export async function readPfcConfiguration(c: Connection, columns: PfcColumns, component: string, market: string, type: string, forUpdate = false): Promise<PfcConfiguration> {
  const key = { c: component, m: market, t: type };
  const read = async (table: PfcTable) => {
    const order = [...CONFIG_KEYS, ...PFC_ROW_KEYS[table]].join(', ');
    const rows = await select<Row>(c, `SELECT ${columns[table].map(columnSql).join(', ')} FROM ${PFC_TABLES[table]}
      WHERE PNLGRPNAME = :c AND MARKET = :m AND EOCC_CONFIG_TYPE = :t ORDER BY ${order}${forUpdate && !columns[table].some((x) => x.type === 'CLOB') ? ' FOR UPDATE' : ''}`, key);
    return rows.map((r) => normalizeRow(columns, table, r));
  };
  const [header] = await read('header');
  return { component, market, type, ...(header ? { header } : {}), sequences: await read('sequences'), criteria: await read('criteria'), pages: await read('pages'), fields: await read('fields') };
}

/** The concurrency token: the configuration's rows. */
export function pfcToken(config: PfcConfiguration): string {
  if (!config.header) return 'absent';
  const body = JSON.stringify([config.header, config.sequences, config.criteria, config.pages, config.fields]);
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// The configuration's rows

/** A row as the table stores it: every column, text right-trimmed or a space, numbers numeric. */
export function normalizeRow(columns: PfcColumns, table: PfcTable, row: Row): Row {
  const out: Row = {};
  for (const col of columns[table]) {
    const v = row[col.name];
    if (col.type === 'NUMBER') out[col.name] = v === null || v === undefined || s(v) === '' ? 0 : Number(v);
    else if (col.type === 'CLOB') out[col.name] = v === null || v === undefined || String(v) === '' ? null : String(v);
    else if (col.type.startsWith('VARCHAR') || col.type === 'CHAR') out[col.name] = v === null || v === undefined || String(v).trimEnd() === '' ? ' ' : String(v).trimEnd();
    else out[col.name] = v ?? null;
  }
  return out;
}

/** The input as the configuration's rows; refused on an unknown column or a value that is not one. */
export function normalizeConfiguration(columns: PfcColumns, component: string, market: string, type: string, input: PfcConfigurationInput): PfcConfiguration {
  const fix = (table: PfcTable, r: Row, i: number) => {
    const known = new Set(columns[table].map((x) => x.name));
    for (const k of Object.keys(r)) {
      if (!known.has(k.toUpperCase())) throw new PfcSaveRefusedError(`${PFC_TABLES[table]} has no column ${k} (${table} row ${i + 1}).`);
    }
    const upper = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toUpperCase(), v]));
    // A column the caller leaves out takes the record field's default, as a new row in the component does.
    for (const col of columns[table]) if (upper[col.name] === undefined && col.default !== undefined) upper[col.name] = col.default;
    for (const col of columns[table]) {
      if (col.type === 'NUMBER' && upper[col.name] !== undefined && s(upper[col.name]) !== '' && !Number.isFinite(Number(upper[col.name]))) {
        throw new PfcSaveRefusedError(`${table} row ${i + 1}: ${col.name} must be a number.`);
      }
      if (col.length && col.type.startsWith('VARCHAR') && typeof upper[col.name] === 'string' && (upper[col.name] as string).trimEnd().length > col.length) {
        throw new PfcSaveRefusedError(`${table} row ${i + 1}: ${col.name} is at most ${col.length} characters.`);
      }
    }
    return normalizeRow(columns, table, { ...upper, PNLGRPNAME: component, MARKET: market, EOCC_CONFIG_TYPE: type });
  };
  return {
    component, market, type,
    header: fix('header', input.header, 0),
    sequences: input.sequences.map((r, i) => fix('sequences', r, i)),
    criteria: (input.criteria ?? []).map((r, i) => fix('criteria', r, i)),
    pages: (input.pages ?? []).map((r, i) => fix('pages', r, i)),
    fields: (input.fields ?? []).map((r, i) => fix('fields', r, i))
  };
}

/** A row without the values a save would fill in anyway (blanks, zeros, the record defaults): what reads hand out, so a round trip is exact. */
export function compactRow(columns: PfcColumns, table: PfcTable, row: Row): Row {
  const out: Row = {};
  for (const col of columns[table]) {
    if ((CONFIG_KEYS as readonly string[]).includes(col.name)) continue;
    const v = row[col.name];
    const filled = normalizeRow(columns, table, { [col.name]: col.default })[col.name];
    if (!PFC_ROW_KEYS[table].includes(col.name) && JSON.stringify(v) === JSON.stringify(filled)) continue;
    out[col.name] = v === ' ' ? '' : v;
  }
  return out;
}

const rowKey = (table: PfcTable, r: Row) => PFC_ROW_KEYS[table].map((k) => s(r[k])).join('|');
const seqKey = (r: Row) => `${Number(r.SEQUENCE_NBR)}|${Number(r.EOCC_SEQUENCE_NBR)}`;

/** Errors the page would not let through, and the warnings its SavePreChange shows. */
export function checkConfiguration(config: PfcConfiguration): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const h = config.header!;
  if (!['A', 'I'].includes(s(h.EFF_STATUS))) errors.push(`The header's EFF_STATUS must be A or I (${s(h.EFF_STATUS) || 'blank'}).`);
  if (!s(h.DESCR)) errors.push('The header needs a description (DESCR).');
  for (const table of ['sequences', ...CHILDREN] as ListTable[]) {
    const seen = new Set<string>();
    for (const r of config[table]) {
      const k = rowKey(table, r);
      if (seen.has(k)) errors.push(`${table}: two rows with the key ${k}.`);
      seen.add(k);
    }
  }
  const seqs = new Set(config.sequences.map(seqKey));
  for (const r of config.sequences) {
    if (!['A', 'I'].includes(s(r.STATUS))) errors.push(`Sequence ${Number(r.EOCC_SEQUENCE_NBR)}: STATUS must be A or I.`);
    if (Number(r.SEQUENCE_NBR) < 1 || Number(r.EOCC_SEQUENCE_NBR) < 1) errors.push('Sequence numbers start at 1.');
  }
  for (const table of CHILDREN) {
    for (const r of config[table]) if (!seqs.has(seqKey(r))) errors.push(`${table}: a row for sequence ${seqKey(r).replace('|', '/')}, which is not in the configuration.`);
  }
  if (config.type === 'STD') {
    // EOCC_CONFIGURE SavePreChange's warnings: page configuration with a level-1 criterion; "set to blank" without criteria.
    for (const q of config.sequences.filter((r) => s(r.STATUS) !== 'I')) {
      const crt = config.criteria.filter((r) => seqKey(r) === seqKey(q));
      const pnl = config.pages.filter((r) => seqKey(r) === seqKey(q));
      const fld = config.fields.filter((r) => seqKey(r) === seqKey(q));
      if (crt.some((r) => Number(r.OCCURSLEVEL) > 0) && pnl.length && s(pnl[pnl.length - 1].PNLNAME)) {
        warnings.push(`Sequence ${Number(q.EOCC_SEQUENCE_NBR)}: page configuration is not allowed when a level 1 field is used in criteria.`);
      }
      if (!(crt.length && s(crt[crt.length - 1].FIELDNAME)) && fld.some((r) => s(r.EOCC_SET_BLANK) === 'Y')) {
        warnings.push(`Sequence ${Number(q.EOCC_SEQUENCE_NBR)}: "Set Value to Blank" is valid only in sequences with criteria.`);
      }
    }
  }
  return { errors, warnings };
}

function deleteWhere(table: string, row: Row, keys: readonly string[]): Statement {
  return {
    sql: `DELETE FROM ${table} WHERE ${keys.map((k, i) => `${k} = :k${i}`).join(' AND ')}`,
    binds: Object.fromEntries(keys.map((k, i) => [`k${i}`, row[k]])), expect: 1, what: `Deleting ${table}`
  };
}

export interface PfcRowsPlan { statements: Statement[]; changes: string[]; empty: boolean }

/** The statements that make the stored rows the configuration's (pure). */
export function planPfcRows(columns: PfcColumns, stored: PfcConfiguration, next: PfcConfiguration): PfcRowsPlan {
  const statements: Statement[] = [];
  const changes: string[] = [];
  const keysOf = (table: PfcTable) => [...CONFIG_KEYS, ...PFC_ROW_KEYS[table]];
  const same = (a: Row, b: Row) => JSON.stringify(a) === JSON.stringify(b);
  const inserts: Array<[ListTable, Row]> = [];
  // Children first on the way out, parents first on the way in.
  for (const table of [...CHILDREN, 'sequences'] as ListTable[]) {
    const want = new Map(next[table].map((r) => [rowKey(table, r), r]));
    for (const r of stored[table]) {
      const w = want.get(rowKey(table, r));
      if (w && same(w, r)) continue;
      statements.push(deleteWhere(PFC_TABLES[table], r, keysOf(table)));
      if (!w) changes.push(`remove ${table.replace(/s$/, '')} ${rowKey(table, r)}`);
    }
  }
  if (!stored.header) {
    statements.push(insertRow(PFC_TABLES.header, next.header!, undefined));
    changes.push(`create the ${next.type} configuration of ${next.component}.${next.market}`);
  } else if (!same(stored.header, next.header!)) {
    const cols = columns.header.map((x) => x.name).filter((n) => !(CONFIG_KEYS as readonly string[]).includes(n));
    statements.push({
      sql: `UPDATE ${PFC_TABLES.header} SET ${cols.map((n, i) => `${n} = :v${i}`).join(', ')} WHERE PNLGRPNAME = :c AND MARKET = :m AND EOCC_CONFIG_TYPE = :t`,
      binds: { ...Object.fromEntries(cols.map((n, i) => [`v${i}`, next.header![n]])), c: next.component, m: next.market, t: next.type }, expect: 1, what: `Updating ${PFC_TABLES.header}`
    });
    changes.push(`change the header${s(stored.header.EFF_STATUS) !== s(next.header!.EFF_STATUS) ? ` (${s(next.header!.EFF_STATUS) === 'A' ? 'active' : 'inactive'})` : ''}`);
  }
  for (const table of ['sequences', ...CHILDREN] as ListTable[]) {
    const had = new Map(stored[table].map((r) => [rowKey(table, r), r]));
    for (const r of next[table]) {
      const h = had.get(rowKey(table, r));
      if (h && same(h, r)) continue;
      inserts.push([table, r]);
      changes.push(`${h ? 'change' : 'add'} ${table.replace(/s$/, '')} ${rowKey(table, r)}`);
    }
  }
  for (const [table, r] of inserts) statements.push(insertRow(PFC_TABLES[table], r, undefined));
  return { statements, changes, empty: statements.length === 0 };
}

// ---------------------------------------------------------------------------
// The Event Mapping

/** The services DeleteUtilityServiceMapping removes for a type, in its order; RowInit/RowInsert numbered up to maxEvent. */
export function utilityServices(type: string, maxEvent: number): string[] {
  if (type === 'MASK') {
    return ['EOCC_MASK_POSTBUILD', 'EOCC_MASK_PAGEACTIVATE', 'EOCC_MASK_SECPAGEACTIVATE', 'EOCC_MASK_ROWINSERT', 'EOCC_MASK_ROWINIT', 'EOCC_MASK_SEARCHINIT', 'EOCC_MASK_FIELDCHANGE'];
  }
  if (type === 'TRK') return ['EOCC_CHGTRK_SAVEPRECHANGE'];
  const numbered: string[] = [];
  for (let j = 1; j <= maxEvent; j++) numbered.push(`EOCC_ROWINIT${j}`, `EOCC_ROWINSERT${j}`);
  return ['EOCC_POSTBUILD', 'EOCC_SAVEPRECHANGE', ...numbered, 'EOCC_PAGEACTIVATE', 'EOCC_SECONDARYPAGEACTIVATE', 'EOCC_FIELDCHANGE', 'EOCC_SEARCHINIT', 'EOCC_SEARCHSAVE'];
}

/** Mapper.GetMaxEventNumber: the highest RowInit/RowInsert number mapped, as the first of the service ids sorted descending (text) gives it. */
export function maxEventNumber(configs: readonly Row[]): number {
  const top = (prefix: string, event: string) => {
    const ids = configs.filter((r) => s(r.PTCS_SERVICEID).startsWith(prefix) && s(r.PTCS_CMPRECEVENT) === event && s(r.PTCS_PROCSEQ) === 'POST')
      .map((r) => s(r.PTCS_SERVICEID)).sort().reverse();
    if (!ids.length) return 0;
    if (ids[0] === prefix) return 1;
    const n = Number(ids[0].slice(prefix.length));
    return Number.isFinite(n) ? n : 0;
  };
  return Math.max(top('EOCC_ROWINIT', 'RINI'), top('EOCC_ROWINSERT', 'RINS'));
}

/** A mapping's PSPTCSSRVCONF row as the configurator's ServiceHandler sets it (its Map* methods). */
export function mappingRow(m: PfcMapping, cref: string, instanceId: number, version: number, operatorId: string): Row {
  const component = m.level === 'C';
  return {
    PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, PTCS_SERVICEID: m.serviceId, PTCS_INSTANCEID: instanceId, PTCS_ISCOMPSERVICE: m.level,
    PNLNAME: m.page ?? ' ', SEQNUM: m.sequence, PTCS_HIDEFROMSRCH: 'N', IS_DEFAULT: 'N', PTCS_MAPSECOPTIONS: 'P', HANDLERNAME: ' ',
    PTCS_INSTANCELBL: m.label, PTCS_URLTARGET: 'RCF', PTCS_RCMENUOPT: 'N', PTCS_MAINMENUOPT: component ? 'Y' : 'N', PTCS_SEQNUM_MMNU: 0,
    PTCS_SEQNUM_RMNU: 0, PACKAGEROOT: ' ', QUALIFYPATH: ' ', APPCLASSID: ' ', PTCS_INITMIN: component ? ' ' : 'N', PTCS_ENABLE: 'Y',
    PTCS_SRVOPENOPTION: ' ', PTCS_EMBEDDABLE: ' ', PTCS_SUOWSERV: ' ', VERSION: version, LASTUPDOPRID: operatorId, OBJECTOWNERID: ' ',
    PTCS_SRVCATTR: ' ', OPRID: ' ', PTCS_MASTERTMPL: ' ', RECNAME: m.record ?? ' ', PTCS_CMPEVENT: component ? m.event : ' ', PTCS_PROCSEQ: 'POST',
    PTCS_CMPRECEVENT: component ? ' ' : m.event, PTCS_ALLOWPERSONAL: ' ', FIELDNAME: m.field ?? ' '
  };
}

export interface PfcTarget { cref: string; menu: string; stored: StoredConfiguration }

export interface PfcMappingPlanOptions {
  component: string;
  type: string;
  active: boolean;
  targets: readonly PfcTarget[];
  derived: readonly PfcMapping[];
  counters: CounterState;
  ts: string;
  operatorId: string;
  tracked: Set<string>;
  random?: () => number;
}

export interface PfcMappingPlan {
  statements: Statement[];
  counters: CounterState;
  changes: string[];
  /** Per content reference, the type's mapping rows after the save (signatures). */
  expected: Map<string, string[]>;
  /** Content references whose PSPTCS_SRVCFG the save removes. */
  removedServices: string[];
}

export const mappingSignature = (m: { serviceId: string; level: string; record?: string; field?: string; page?: string; event: string; sequence: number }) =>
  [m.serviceId, m.level, m.record ?? '', m.field ?? '', m.page ?? '', m.event, m.sequence].join('|');

export const storedSignature = (r: Row) => mappingSignature({
  serviceId: s(r.PTCS_SERVICEID), level: s(r.PTCS_ISCOMPSERVICE), record: s(r.RECNAME), field: s(r.FIELDNAME), page: s(r.PNLNAME),
  event: s(r.PTCS_ISCOMPSERVICE) === 'C' ? s(r.PTCS_CMPEVENT) : s(r.PTCS_CMPRECEVENT), sequence: Number(r.SEQNUM ?? 0)
});

/** The statements that regenerate (or remove) the type's Event Mapping on each content reference, as the page's save does (module comment). Pure. */
export function planPfcMappings(o: PfcMappingPlanOptions): PfcMappingPlan {
  const counters: CounterState = { version: { ...o.counters.version }, lock: { ...o.counters.lock } };
  const next = (n: Exclude<CounterName, 'SYS'>): number => {
    const v = Math.max(counters.version[n], counters.lock[n]) + 1;
    counters.version[n] = v;
    counters.lock[n] = v;
    counters.version.SYS += 1;
    return v;
  };
  const statements: Statement[] = [];
  const changes: string[] = [];
  const expected = new Map<string, string[]>();
  const removedServices: string[] = [];
  const random = o.random ?? Math.random;
  const { ts, operatorId: op } = o;

  for (const { cref, menu, stored } of o.targets) {
    const b = { p: EVENT_MAPPING_PORTAL, n: cref };
    if (o.active && !stored.exists) {
      statements.push(insertRow('PSPTCS_SRVCFG', {
        PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, MENUNAME: menu, PNLGRPNAME: o.component, PTCS_EXPANDFRAME: 'N',
        PTCS_RCFRAMELOC: 'S', PTCS_NMINPAGELETS: 0, VERSION: next('RCSCM'), LASTUPDOPRID: op, OBJECTOWNERID: ' '
      }, ts));
      for (const ads of dataSetsOf(o.tracked, 'PSPTCS_SRVCFG')) statements.push(...trackingUpsert(ads, 'PSPTCS_SRVCFG', cfgKeys(cref), ts, op));
      changes.push(`${cref}: configure Event Mapping (menu ${menu})`);
    } else if (o.active) {
      for (const ads of dataSetsOf(o.tracked, 'PSPTCS_SRVCFG')) if (ads === 'RCF_SERVICES') statements.push(trackingRefresh(ads, 'PSPTCS_SRVCFG', cfgKeys(cref), ts, op));
    }

    // DeleteUtilityServiceMapping: service by service, each service's rows in stored order.
    const order = utilityServices(o.type, maxEventNumber(stored.configs));
    const doomed = order.flatMap((id) => stored.configs.filter((r) => s(r.PTCS_SERVICEID) === id));
    for (const r of doomed) {
      const id = Number(r.PTCS_INSTANCEID);
      const serviceId = s(r.PTCS_SERVICEID);
      const version = next('SCNFM');
      statements.push({ sql: 'DELETE FROM PSPTCS_MAPFLDS WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i', binds: { ...b, i: id }, what: 'Deleting PSPTCS_MAPFLDS' });
      statements.push({ sql: 'DELETE FROM PSPTCSSRVCONFLG WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i', binds: { ...b, i: id }, what: 'Deleting PSPTCSSRVCONFLG' });
      statements.push({ sql: 'DELETE FROM PSPTCSSRVCONF WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i', binds: { ...b, i: id }, expect: 1, what: 'Deleting PSPTCSSRVCONF' });
      statements.push(insertRow('PSPTCSSRVCNFDEL', { PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, PTCS_SERVICEID: serviceId, PTCS_INSTANCEID: id, VERSION: version }, undefined));
      for (const ads of dataSetsOf(o.tracked, 'PSPTCSSRVCONF')) statements.push(trackingRefresh(ads, 'PSPTCSSRVCONF', confKeys(cref, serviceId, id), ts, op));
    }

    const used = new Set(stored.configs.map((r) => Number(r.PTCS_INSTANCEID)));
    const want: string[] = [];
    if (o.active) {
      for (const m of o.derived) {
        const id = newInstanceId(used, random);
        used.add(id);
        statements.push(insertRow('PSPTCSSRVCONF', mappingRow(m, cref, id, next('SCNFM'), op), ts));
        if (stored.exists) {
          statements.push(insertRow('PSPTCSSRVCONFLG', {
            PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, PTCS_SERVICEID: m.serviceId, PTCS_INSTANCEID: id, LANGUAGE_CD: ' ', PTCS_INSTANCELBL: m.label
          }, undefined));
        }
        for (const ads of dataSetsOf(o.tracked, 'PSPTCSSRVCONF')) statements.push(...trackingUpsert(ads, 'PSPTCSSRVCONF', confKeys(cref, m.serviceId, id), ts, op));
        want.push(mappingSignature(m));
      }
      changes.push(`${cref}: ${doomed.length ? `replace ${doomed.length} ${o.type} mapping row(s) with` : 'add'} ${o.derived.length}`);
    } else {
      if (doomed.length) changes.push(`${cref}: remove ${doomed.length} ${o.type} mapping row(s)`);
      const left = stored.configs.length - doomed.length;
      if (stored.exists && left === 0) {
        statements.push({ sql: 'DELETE FROM PSPTCS_SRVCFG WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n', binds: b, expect: 1, what: 'Deleting PSPTCS_SRVCFG' });
        statements.push(insertRow('PSPTCSSRVCFGDEL', { PORTAL_NAME: EVENT_MAPPING_PORTAL, PORTAL_OBJNAME: cref, VERSION: next('RCSCM') }, undefined));
        for (const ads of dataSetsOf(o.tracked, 'PSPTCS_SRVCFG')) {
          if (ads === 'RCF_SERVICE_CREFS') statements.push(trackingDelete(ads, 'PSPTCS_SRVCFG', cfgKeys(cref)));
          else statements.push(...trackingUpsert(ads, 'PSPTCS_SRVCFG', cfgKeys(cref), ts, op));
        }
        removedServices.push(cref);
        changes.push(`${cref}: no Event Mapping left; its configuration removed`);
      }
    }
    expected.set(cref, want.sort());
  }

  for (const n of ['RCSDM', 'RCSCM', 'SCNFM', 'RCMTM', 'SYS'] as CounterName[]) {
    if (counters.version[n] !== o.counters.version[n]) {
      statements.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: counters.version[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
    }
    if (n !== 'SYS' && counters.lock[n] !== o.counters.lock[n]) {
      statements.push({ sql: `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: counters.lock[n] }, expect: 1, what: `Updating PSLOCK ${n}` });
    }
  }
  return { statements, counters, changes, expected, removedServices };
}

/** The family of rows a type's save owns on a content reference (for verifying and reading). */
export function isTypeService(type: string, serviceId: string): boolean {
  if (type === 'MASK') return serviceId.startsWith('EOCC_MASK_');
  if (type === 'TRK') return serviceId.startsWith('EOCC_CHGTRK_');
  return serviceId.startsWith('EOCC_') && !serviceId.startsWith('EOCC_MASK_') && !serviceId.startsWith('EOCC_CHGTRK_');
}

// ---------------------------------------------------------------------------
// Saving

export interface PfcSaveRequest {
  component: string;
  market?: string;
  /** STD (Standard) or MASK (Masking). */
  type: string;
  configuration: PfcConfigurationInput;
  /** pfcToken of the configuration as it was read ('absent' for a new one). */
  openedToken: string;
  operatorId: string;
  dryRun?: boolean;
}

export interface PfcSaveResult {
  rows: PfcRowsPlan;
  mappings?: PfcMappingPlan;
  derived: PfcMapping[];
  warnings: string[];
  token: string;
  written: boolean;
}

/** Saves the configuration and regenerates its Event Mapping in one transaction; refused on an error or a configuration changed since it was read. */
export async function savePfcConfiguration(c: Connection, request: PfcSaveRequest): Promise<PfcSaveResult> {
  try {
    const component = request.component.trim().toUpperCase();
    const market = (request.market ?? 'GBL').trim().toUpperCase();
    const type = request.type.trim().toUpperCase();
    if (type !== 'STD' && type !== 'MASK') throw new PfcSaveRefusedError(`Configuration type ${type} is not written (Standard STD and Masking MASK are).`);
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new PfcSaveRefusedError(operatorError);
    if (!(await operatorExists(c, request.operatorId))) throw new PfcSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    const [comp] = await select<Row>(c, `SELECT 'X' AS X FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :c AND MARKET = :m`, { c: component, m: market });
    if (!comp) throw new PfcSaveRefusedError(`${component}.${market} is not a component in this database.`);

    const counters = await readCounterState(c, true);
    const columns = await readPfcColumns(c);
    const stored = await readPfcConfiguration(c, columns, component, market, type, true);
    const token = pfcToken(stored);
    if (token !== request.openedToken) {
      throw new PfcSaveRefusedError(request.openedToken === 'absent'
        ? `${component}.${market} already has a ${type} configuration; reopen it.`
        : `${component}.${market}'s ${type} configuration was changed since it was read (another save, possibly on the PIA page). Reopen it and reapply the change.`);
    }
    const next = normalizeConfiguration(columns, component, market, type, request.configuration);
    const check = checkConfiguration(next);
    if (check.errors.length) throw new PfcSaveRefusedError(check.errors.slice(0, 6).join('; '));
    const rows = planPfcRows(columns, stored, next);
    if (rows.empty) {
      await c.rollback();
      return { rows, derived: [], warnings: check.warnings, token, written: false };
    }

    // The configurator derives the mapping from the rows being saved: write them, then derive inside the transaction.
    await run(c, rows.statements);
    const active = s(next.header!.EFF_STATUS) === 'A';
    const derived = active ? await derivePfcMappings(c, component, market, type) : [];
    const missing: string[] = [];
    for (const id of [...new Set(derived.map((m) => m.serviceId))]) {
      const [d] = await select<Row>(c, `SELECT 'X' AS X FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID = :s`, { s: id });
      if (!d) missing.push(id);
    }
    if (missing.length) {
      throw new PfcSaveRefusedError(`The configuration needs the services ${missing.join(', ')}, which this database does not have yet; the configurator clones them ` +
        'on its first save that needs them (not written here). Save it once on the PIA page.');
    }
    const targets: PfcTarget[] = [];
    for (const { cref, menu } of await pfcContentReferences(c, component, market)) targets.push({ cref, menu, stored: await readStoredConfiguration(c, cref, true) });
    const mappings = planPfcMappings({
      component, type, active, targets, derived, counters, ts: await now(c), operatorId: request.operatorId,
      tracked: await trackedRecords(c, ['PSPTCS_SRVCFG', 'PSPTCSSRVCONF'])
    });
    if (request.dryRun) {
      await c.rollback();
      return { rows, mappings, derived, warnings: check.warnings, token, written: false };
    }
    await run(c, mappings.statements);
    await verifyPfcSave(c, columns, next, type, mappings);
    await c.commit();
    return { rows, mappings, derived, warnings: check.warnings, token: pfcToken(await readPfcConfiguration(c, columns, component, market, type)), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** Proves the stored rows are the plan's: the configuration's rows, each content reference's mapping rows of the type, the counters. */
export async function verifyPfcSave(c: Connection, columns: PfcColumns, next: PfcConfiguration, type: string, plan: PfcMappingPlan): Promise<void> {
  const problems: string[] = [];
  const got = await readPfcConfiguration(c, columns, next.component, next.market, type);
  for (const table of ['sequences', ...CHILDREN] as ListTable[]) {
    const a = JSON.stringify(got[table].map((r) => rowKey(table, r) + JSON.stringify(r)).sort());
    const b = JSON.stringify(next[table].map((r) => rowKey(table, r) + JSON.stringify(r)).sort());
    if (a !== b) problems.push(`the ${table} rows differ`);
  }
  if (JSON.stringify(got.header) !== JSON.stringify(next.header)) problems.push('the header differs');
  for (const [cref, want] of plan.expected) {
    const stored = await readStoredConfiguration(c, cref, false);
    const have = stored.configs.filter((r) => isTypeService(type, s(r.PTCS_SERVICEID))).map(storedSignature).sort();
    if (JSON.stringify(have) !== JSON.stringify(want)) problems.push(`${cref}: ${have.length} ${type} mapping rows, ${want.length} expected`);
    if (plan.removedServices.includes(cref) === stored.exists) problems.push(`${cref}: PSPTCS_SRVCFG ${stored.exists ? 'still there' : 'missing'}`);
  }
  const counters = await readCounterState(c, false);
  for (const n of ['RCSCM', 'SCNFM', 'SYS'] as CounterName[]) {
    if (counters.version[n] !== plan.counters.version[n]) problems.push(`PSVERSION ${n} ${counters.version[n]}, ${plan.counters.version[n]} expected`);
  }
  if (problems.length) throw new PfcSaveRefusedError(`The written rows are not the planned ones (${problems.slice(0, 6).join('; ')}).`);
}
