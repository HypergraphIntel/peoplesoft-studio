import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Statement } from '../providers/appEngineWriter.js';
import { adsKeyHash } from '../providers/adsTracking.js';
import type { CounterState } from '../providers/dropZoneWriter.js';
import type { StoredConfiguration } from '../providers/eventMappingWriter.js';
import type { PfcMapping } from '../providers/pfcMapper.js';
import {
  PFC_TARGETING_TABLES, checkConfiguration, maxEventNumber, normalizeConfiguration, normalizeRow, planPfcMappings, planPfcRows, pfcToken, utilityServices,
  type PfcColumns, type PfcConfiguration, type PfcTable
} from '../providers/pfcWriter.js';

/*
 * The Page and Field Configurator writer replays PIA's EOCC_CONFIGURE saves
 * captured on HRDMO (tools/corpus/save-protocol/results/pfc01-configure: a
 * first Standard configuration of JOB_CODE_TBL; pfc02-remove: its field
 * removed). Each case is planned from the state before it; every row written
 * and deleted, the tracking rows and the counters are compared with PIA's.
 */

const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');
type Row = Record<string, unknown>;
const delta = (c: string) => JSON.parse(readFileSync(path.join(RESULTS, c, 'delta.json'), 'utf8'));
const have = (c: string) => existsSync(path.join(RESULTS, c, 'delta.json'));
const t = (v: unknown) => (v === null || v === undefined ? null : String(v).trim());

function planned(plan: { statements: Statement[] }, verb: 'INSERT INTO' | 'DELETE FROM', table: string): Row[] {
  return plan.statements.filter((st) => st.sql.startsWith(`${verb} ${table} `)).map((st) => {
    if (verb === 'DELETE FROM') {
      const cols = [...st.sql.matchAll(/(\w+) = :(\w+)/g)];
      return Object.fromEntries(cols.map((m) => [m[1], st.binds[m[2]]]));
    }
    const cols = /\(([^)]*)\)/.exec(st.sql)![1].split(',').map((c) => c.trim()).filter((c) => c !== 'LASTUPDDTTM');
    return Object.fromEntries(cols.map((c, i) => [c, st.binds[`b${i}`]]));
  });
}

function sameRow(captured: Row, mine: Row, what: string): void {
  for (const [col, v] of Object.entries(captured)) {
    if (col === 'LASTUPDDTTM' || col === 'ROWID') continue;
    assert.equal(t(mine[col]), t(v), `${what}.${col}`);
  }
  for (const col of Object.keys(mine)) assert.ok(col in captured, `${what}: ${col} is not a column PIA wrote`);
}

/** Draws that make the related-content API's instance ids (RCService.GenerateInstanceID: two random runs of digits) the captured ones. */
function drawsFor(ids: number[]): () => number {
  const draws: number[] = [];
  for (const id of ids) {
    const d = String(id);
    const split = [1, 2, 3, 4].find((k) => { const b = d.slice(k); return b.length && b.length <= 5 && (b === '0' || !b.startsWith('0')); })!;
    draws.push((Number(d.slice(0, split)) + 0.5) / 10000, (Number(d.slice(split)) + 0.5) / 100000);
  }
  return () => draws.shift()!;
}

/** The record fields' constant defaults on HRDMO (PSRECFIELDDB DEFFIELDNAME, PeopleTools 8.62). */
const DEFAULTS: Record<string, Record<string, string>> = {
  PS_EOCC_CONFIG_HDR: { MARKET: 'GBL', EOCC_CONFIG_TYPE: 'STD', EFF_STATUS: 'A', EOCC_APPLY_LVL: 'H', EOCC_APPLY_TO: 'A', EOCC_PAGE_EVENT: 'N', PTAI_SYSTEM_DATA: 'N' },
  PS_EOCC_CONFIG_SEQ: { EOCC_CONFIG_TYPE: 'STD', EOCC_SEQUENCE_NBR: '1', SEQUENCE_NBR: '1', STATUS: 'A', EOCC_APPLY_TO: 'A', EOCC_MANDATORY_FLG: 'Y',
    EOCC_SMALL_FF: 'Y', EOCC_MEDIUM_FF: 'Y', EOCC_LARGE_FF: 'Y', EOCC_XLARGE_FF: 'Y', PTAI_SYSTEM_DATA: 'N' },
  PS_EOCC_CONFIG_FLD: { EOCC_CONFIG_TYPE: 'STD', EOCC_IS_REQUIRED: 'N', EOCC_VISIBLE_FLAG: 'Y', EOCC_MASK_FLAG: 'N', EOCC_DISABLED: 'N', EOCC_FIELD_ORIGIN: 'STD',
    PTAI_SYSTEM_DATA: 'N', EOCC_PROF_STATUS: 'D', EOCC_CHGTRK_FLAG: 'Y', EOCC_DFLTOVRD_FLAG: 'N' }
};

function columnsOf(c: string): PfcColumns {
  const d = delta(c).otherTables;
  const tables: Partial<Record<PfcTable, string>> = { header: 'PS_EOCC_CONFIG_HDR', sequences: 'PS_EOCC_CONFIG_SEQ', criteria: 'PS_EOCC_CONFIG_SEQ', pages: 'PS_EOCC_CONFIG_SEQ', fields: 'PS_EOCC_CONFIG_FLD' };
  // The targeting lists are not in these captures: as on a release without them.
  const out = Object.fromEntries(PFC_TARGETING_TABLES.map((t) => [t, []])) as unknown as PfcColumns;
  for (const [k, name] of Object.entries(tables) as Array<[PfcTable, string]>) {
    out[k] = (d[name].columns as Array<{ name: string; type: string }>).map((x) => ({ name: x.name, type: x.type, ...(DEFAULTS[name]?.[x.name] !== undefined ? { default: DEFAULTS[name][x.name] } : {}) }));
  }
  // Criteria and pages are not in these captures; their rows stay empty.
  return out;
}

const TRACKED = new Set(['RCF_SERVICES|PSPTCS_SRVCFG', 'RCF_SERVICE_CREFS|PSPTCS_SRVCFG', 'RCF_SERVICE_CONFIGURATIONS|PSPTCSSRVCONF']);
const CREFS = [{ cref: 'HC_C_JOB_CODE_TBL_GBL', menu: 'SETUP_HRMS' }, { cref: 'HC_JOB_CODE_TBL_GBL2', menu: 'MANAGE_POSITIONS_(USF)' }];
const POSTBUILD: PfcMapping = { serviceId: 'EOCC_POSTBUILD', level: 'C', event: 'POST', sequence: 0, label: 'PostBuild Event' };
const SAVEPRECHANGE: PfcMapping = { serviceId: 'EOCC_SAVEPRECHANGE', level: 'C', event: 'SPRE', sequence: 0, label: 'SavePreChange Event' };
const ROWINIT: PfcMapping = { serviceId: 'EOCC_ROWINIT1', level: 'P', record: 'JOBCODE_TBL', event: 'RINI', sequence: 0, label: 'RowInit Event' };
const ROWINSERT: PfcMapping = { serviceId: 'EOCC_ROWINSERT1', level: 'P', record: 'JOBCODE_TBL', event: 'RINS', sequence: 0, label: 'RowInsert Event' };

function counters(version: Record<string, number>, lock: Record<string, number>): CounterState {
  return { version: { RCSDM: 14, RCMTM: 3, ...version } as CounterState['version'], lock: { RCSDM: 14, RCMTM: 3, ...lock } as CounterState['lock'] };
}

const empty = (cref: string): StoredConfiguration => ({ cref, exists: false, configs: [], mapFields: [] });

test('a first configuration writes the configuration rows PIA wrote [pfc01]', { skip: !have('pfc01-configure') }, () => {
  const d = delta('pfc01-configure').otherTables;
  const columns = columnsOf('pfc01-configure');
  const stored: PfcConfiguration = { component: 'JOB_CODE_TBL', market: 'GBL', type: 'STD', sequences: [], criteria: [], pages: [], fields: [] };
  const next = normalizeConfiguration(columns, 'JOB_CODE_TBL', 'GBL', 'STD', {
    header: { DESCR: 'ZZ Lab PFC capture', EFF_STATUS: 'A', EOCC_APPLY_LVL: 'H', EOCC_APPLY_TO: 'A' },
    sequences: [{ ...d.PS_EOCC_CONFIG_SEQ.inserted[0] }],
    fields: [{ ...d.PS_EOCC_CONFIG_FLD.inserted[0] }]
  });
  assert.deepEqual(checkConfiguration(next).errors, []);
  assert.equal(pfcToken(stored), 'absent');
  const plan = planPfcRows(columns, stored, next);
  for (const table of ['PS_EOCC_CONFIG_HDR', 'PS_EOCC_CONFIG_SEQ', 'PS_EOCC_CONFIG_FLD']) {
    const mine = planned(plan, 'INSERT INTO', table);
    assert.equal(mine.length, 1, `${table} rows`);
    sameRow(d[table].inserted[0], mine[0], table);
  }
  assert.equal(plan.statements.filter((st) => st.sql.startsWith('DELETE')).length, 0);
});

test('a first configuration maps its content references as PIA did [pfc01]', { skip: !have('pfc01-configure') }, () => {
  const d = delta('pfc01-configure').otherTables;
  const ids = (d.PSPTCSSRVCONF.inserted as Row[]).sort((a, b) => Number(a.VERSION) - Number(b.VERSION)).map((r) => Number(r.PTCS_INSTANCEID));
  const plan = planPfcMappings({
    component: 'JOB_CODE_TBL', type: 'STD', active: true, targets: CREFS.map((x) => ({ ...x, stored: empty(x.cref) })),
    derived: [POSTBUILD, SAVEPRECHANGE, ROWINIT, ROWINSERT], counters: counters({ RCSCM: 34, SCNFM: 86, SYS: 2943 }, { RCSCM: 34, SCNFM: 86 }),
    ts: '2026-10-13T22:28:41.073911', operatorId: 'JARED', tracked: TRACKED, random: drawsFor(ids)
  });
  const byVersion = (rows: Row[]) => [...rows].sort((a, b) => Number(a.VERSION) - Number(b.VERSION));
  for (const table of ['PSPTCS_SRVCFG', 'PSPTCSSRVCONF']) {
    const mine = planned(plan, 'INSERT INTO', table);
    const theirs = byVersion(d[table].inserted);
    assert.equal(mine.length, theirs.length, `${table} rows`);
    theirs.forEach((r, i) => sameRow(r, mine[i], `${table}[${i}]`));
  }
  assert.equal(planned(plan, 'INSERT INTO', 'PSPTCSSRVCONFLG').length, 0, 'a new service sets its language: no language rows');
  const mineTracking = plan.statements.filter((st) => st.sql.startsWith('INSERT INTO PSADSTRACKING')).map((st) => `${st.binds.a} ${st.binds.r} ${st.binds.h}`).sort();
  const theirs = (d.PSADSTRACKING.inserted as Row[]).map((r) => `${t(r.PTADSNAME)} ${t(r.RECNAME)} ${t(r.PTKEYHASH)}`).sort();
  assert.deepEqual(mineTracking, theirs);
  const sm = delta('pfc01-configure').summary;
  for (const [n, x] of Object.entries(sm.psversion as Record<string, { after: number }>)) assert.equal(plan.counters.version[n as keyof CounterState['version']], Number(x.after), `PSVERSION ${n}`);
  for (const [n, x] of Object.entries(sm.pslock as Record<string, { after: number }>)) assert.equal(plan.counters.lock[n as keyof CounterState['lock']], Number(x.after), `PSLOCK ${n}`);
});

test('a re-save replaces the configuration rows and the type\'s mapping as PIA did [pfc02]', { skip: !have('pfc02-remove') || !have('pfc01-configure') }, () => {
  const d1 = delta('pfc01-configure').otherTables;
  const d = delta('pfc02-remove').otherTables;
  const columns = columnsOf('pfc01-configure');

  // The configuration rows: the sequence's description cleared, its field removed (a blank row left, as the page leaves it).
  const header = normalizeRow(columns, 'header', d1.PS_EOCC_CONFIG_HDR.inserted[0]);
  const stored: PfcConfiguration = {
    component: 'JOB_CODE_TBL', market: 'GBL', type: 'STD', header,
    sequences: [normalizeRow(columns, 'sequences', d1.PS_EOCC_CONFIG_SEQ.inserted[0])], criteria: [], pages: [],
    fields: [normalizeRow(columns, 'fields', d1.PS_EOCC_CONFIG_FLD.inserted[0])]
  };
  assert.match(pfcToken(stored), /^[0-9a-f]{32}$/);
  const next = normalizeConfiguration(columns, 'JOB_CODE_TBL', 'GBL', 'STD', {
    header, sequences: [{ ...d.PS_EOCC_CONFIG_SEQ.inserted[0] }], fields: [{ ...d.PS_EOCC_CONFIG_FLD.inserted[0] }]
  });
  const rows = planPfcRows(columns, stored, next);
  for (const table of ['PS_EOCC_CONFIG_SEQ', 'PS_EOCC_CONFIG_FLD']) {
    sameRow(d[table].inserted[0], planned(rows, 'INSERT INTO', table)[0], table);
    const gone = planned(rows, 'DELETE FROM', table);
    assert.equal(gone.length, 1, `${table} deletes`);
    for (const [col, v] of Object.entries(gone[0])) assert.equal(t(v), t((d[table].deleted[0] as Row)[col]), `${table} delete ${col}`);
  }
  assert.ok(!rows.statements.some((st) => st.sql.includes('PS_EOCC_CONFIG_HDR')), 'the unchanged header is not written');

  // The mapping: every row of pfc01 deleted with its tombstone, PostBuild and SavePreChange added with language rows.
  const configs = (cref: string) => (d1.PSPTCSSRVCONF.inserted as Row[]).filter((r) => t(r.PORTAL_OBJNAME) === cref).sort((a, b) => Number(a.VERSION) - Number(b.VERSION));
  const targets = CREFS.map((x) => ({ ...x, stored: { cref: x.cref, exists: true, serviceConfig: (d1.PSPTCS_SRVCFG.inserted as Row[]).find((r) => t(r.PORTAL_OBJNAME) === x.cref), configs: configs(x.cref), mapFields: [] } }));
  const ids = (d.PSPTCSSRVCONF.inserted as Row[]).sort((a, b) => Number(a.VERSION) - Number(b.VERSION)).map((r) => Number(r.PTCS_INSTANCEID));
  const plan = planPfcMappings({
    component: 'JOB_CODE_TBL', type: 'STD', active: true, targets, derived: [POSTBUILD, SAVEPRECHANGE],
    counters: counters({ RCSCM: 36, SCNFM: 94, SYS: 2953 }, { RCSCM: 36, SCNFM: 94 }), ts: '2026-10-13T22:49:20.629349', operatorId: 'JARED', tracked: TRACKED, random: drawsFor(ids)
  });
  const tomb = planned(plan, 'INSERT INTO', 'PSPTCSSRVCNFDEL');
  const theirTomb = [...d.PSPTCSSRVCNFDEL.inserted as Row[]].sort((a, b) => Number(a.VERSION) - Number(b.VERSION));
  assert.equal(tomb.length, theirTomb.length);
  theirTomb.forEach((r, i) => sameRow(r, tomb[i], `PSPTCSSRVCNFDEL[${i}]`));
  const deleted = planned(plan, 'DELETE FROM', 'PSPTCSSRVCONF').map((r) => `${t(r.PORTAL_OBJNAME)} ${t(r.PTCS_INSTANCEID)}`).sort();
  assert.deepEqual(deleted, (d.PSPTCSSRVCONF.deleted as Row[]).map((r) => `${t(r.PORTAL_OBJNAME)} ${t(r.PTCS_INSTANCEID)}`).sort());
  const theirs = [...d.PSPTCSSRVCONF.inserted as Row[]].sort((a, b) => Number(a.VERSION) - Number(b.VERSION));
  const mine = planned(plan, 'INSERT INTO', 'PSPTCSSRVCONF');
  assert.equal(mine.length, theirs.length);
  theirs.forEach((r, i) => sameRow(r, mine[i], `PSPTCSSRVCONF[${i}]`));
  const lg = planned(plan, 'INSERT INTO', 'PSPTCSSRVCONFLG').map((r) => JSON.stringify([t(r.PORTAL_OBJNAME), t(r.PTCS_SERVICEID), t(r.PTCS_INSTANCEID), t(r.LANGUAGE_CD), t(r.PTCS_INSTANCELBL)])).sort();
  assert.deepEqual(lg, (d.PSPTCSSRVCONFLG.inserted as Row[]).map((r) => JSON.stringify([t(r.PORTAL_OBJNAME), t(r.PTCS_SERVICEID), t(r.PTCS_INSTANCEID), t(r.LANGUAGE_CD), t(r.PTCS_INSTANCELBL)])).sort());
  assert.equal(planned(plan, 'INSERT INTO', 'PSPTCS_SRVCFG').length, 0);

  // Tracking: the new rows inserted, the deleted rows and each RCF_SERVICES row restamped (PIA: 4 inserted, 10 updated).
  const inserted = plan.statements.filter((st) => st.sql.startsWith('INSERT INTO PSADSTRACKING')).map((st) => `${st.binds.a} ${st.binds.h}`).sort();
  assert.deepEqual(inserted, (d.PSADSTRACKING.inserted as Row[]).map((r) => `${t(r.PTADSNAME)} ${t(r.PTKEYHASH)}`).sort());
  const restamped = plan.statements.filter((st) => st.sql.startsWith('UPDATE PSADSTRACKING') && !plan.statements.some((x) => x.sql.startsWith('INSERT INTO PSADSTRACKING') && x.binds.h === st.binds.h));
  assert.equal(restamped.length, d.PSADSTRACKING.updated.length);
  const sm = delta('pfc02-remove').summary;
  for (const [n, x] of Object.entries(sm.psversion as Record<string, { after: number }>)) assert.equal(plan.counters.version[n as keyof CounterState['version']], Number(x.after), `PSVERSION ${n}`);
  assert.equal(plan.counters.version.RCSCM, 36, 'RCSCM does not move');
});

test('an inactive configuration removes the type\'s mapping, and the service when nothing is left', () => {
  const row = (serviceId: string, id: number, version: number): Row => ({ PTCS_SERVICEID: serviceId, PTCS_INSTANCEID: id, PTCS_ISCOMPSERVICE: 'C', PTCS_CMPEVENT: 'POST', VERSION: version });
  const other = { ...row('ZZ_OTHER_SERVICE', 2000001, 5), PTCS_ISCOMPSERVICE: 'C' };
  const targets = [
    { cref: 'A', menu: 'M', stored: { cref: 'A', exists: true, configs: [row('EOCC_POSTBUILD', 1000001, 1), row('EOCC_SAVEPRECHANGE', 1000002, 2)], mapFields: [] } },
    { cref: 'B', menu: 'M', stored: { cref: 'B', exists: true, configs: [row('EOCC_POSTBUILD', 1000003, 3), other], mapFields: [] } }
  ];
  const plan = planPfcMappings({
    component: 'C', type: 'STD', active: false, targets, derived: [], counters: counters({ RCSCM: 10, SCNFM: 20, SYS: 100 }, { RCSCM: 12, SCNFM: 20 }),
    ts: 'x', operatorId: 'JARED', tracked: TRACKED
  });
  assert.equal(planned(plan, 'INSERT INTO', 'PSPTCSSRVCNFDEL').length, 3);
  assert.equal(planned(plan, 'INSERT INTO', 'PSPTCSSRVCONF').length, 0);
  assert.deepEqual(plan.removedServices, ['A'], 'B keeps its other Event Mapping');
  assert.equal(planned(plan, 'INSERT INTO', 'PSPTCSSRVCFGDEL')[0].VERSION, 13, 'one past the larger of PSVERSION and PSLOCK');
  assert.ok(plan.statements.some((st) => st.sql.startsWith('DELETE FROM PSADSTRACKING') && st.binds.a === 'RCF_SERVICE_CREFS' && st.binds.h === adsKeyHash([['PORTAL_NAME', '_PTCS_PTEVMAP'], ['PORTAL_OBJNAME', 'A']])));
  assert.equal(plan.counters.version.SYS, 104);
});

test('the services a save deletes follow DeleteUtilityServiceMapping', () => {
  const r = (id: string, ev: string) => ({ PTCS_SERVICEID: id, PTCS_CMPRECEVENT: ev, PTCS_PROCSEQ: 'POST' });
  assert.equal(maxEventNumber([]), 0);
  assert.equal(maxEventNumber([r('EOCC_ROWINIT1', 'RINI'), r('EOCC_ROWINIT2', 'RINI'), r('EOCC_ROWINSERT1', 'RINS')]), 2);
  // Text order: ROWINIT9 sorts after ROWINIT10, as GetMaxEventNumber's ORDER BY ... DESC takes it.
  assert.equal(maxEventNumber([r('EOCC_ROWINIT9', 'RINI'), r('EOCC_ROWINIT10', 'RINI')]), 9);
  assert.deepEqual(utilityServices('STD', 1), ['EOCC_POSTBUILD', 'EOCC_SAVEPRECHANGE', 'EOCC_ROWINIT1', 'EOCC_ROWINSERT1', 'EOCC_PAGEACTIVATE',
    'EOCC_SECONDARYPAGEACTIVATE', 'EOCC_FIELDCHANGE', 'EOCC_SEARCHINIT', 'EOCC_SEARCHSAVE']);
  assert.ok(utilityServices('MASK', 3).every((x) => x.startsWith('EOCC_MASK_')));
});

test('configuration checks: keys, sequences, statuses; the page\'s warnings', () => {
  const cols = (names: string[]) => names.map((name) => ({ name, type: /NBR|LEVEL|PNLFLDID/.test(name) ? 'NUMBER' : 'VARCHAR2' }));
  const columns: PfcColumns = {
    ...(Object.fromEntries(PFC_TARGETING_TABLES.map((t) => [t, []])) as unknown as PfcColumns),
    header: cols(['PNLGRPNAME', 'MARKET', 'EOCC_CONFIG_TYPE', 'DESCR', 'EFF_STATUS']),
    sequences: cols(['PNLGRPNAME', 'MARKET', 'EOCC_CONFIG_TYPE', 'EOCC_SEQUENCE_NBR', 'SEQUENCE_NBR', 'STATUS']),
    criteria: cols(['PNLGRPNAME', 'MARKET', 'EOCC_CONFIG_TYPE', 'SEQUENCE_NBR', 'EOCC_SEQUENCE_NBR', 'RECNAME', 'FIELDNAME', 'PNLFLDID', 'EOCC_CRITERIA_SYM', 'OCCURSLEVEL']),
    pages: cols(['PNLGRPNAME', 'MARKET', 'EOCC_CONFIG_TYPE', 'SEQUENCE_NBR', 'EOCC_SEQUENCE_NBR', 'PNLNAME']),
    fields: cols(['PNLGRPNAME', 'MARKET', 'EOCC_CONFIG_TYPE', 'SEQUENCE_NBR', 'EOCC_SEQUENCE_NBR', 'RECNAME', 'FIELDNAME', 'OCCURSLEVEL', 'RECNAME1', 'FIELDNAME1', 'EOCC_SET_BLANK'])
  };
  assert.throws(() => normalizeConfiguration(columns, 'C', 'GBL', 'STD', { header: { NOPE: 1 }, sequences: [] }), /has no column NOPE/);
  const bad = normalizeConfiguration(columns, 'C', 'GBL', 'STD', {
    header: { DESCR: 'x', EFF_STATUS: 'Z' }, sequences: [{ EOCC_SEQUENCE_NBR: 1, SEQUENCE_NBR: 1, STATUS: 'A' }],
    fields: [{ SEQUENCE_NBR: 2, EOCC_SEQUENCE_NBR: 2, RECNAME: 'R', FIELDNAME: 'F' }]
  });
  const { errors } = checkConfiguration(bad);
  assert.ok(errors.some((e) => /EFF_STATUS/.test(e)));
  assert.ok(errors.some((e) => /sequence 2\/2/.test(e)));
  const warn = normalizeConfiguration(columns, 'C', 'GBL', 'STD', {
    header: { DESCR: 'x', EFF_STATUS: 'A' }, sequences: [{ EOCC_SEQUENCE_NBR: 1, SEQUENCE_NBR: 1, STATUS: 'A' }],
    criteria: [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, RECNAME: 'JOB', FIELDNAME: 'ACTION', OCCURSLEVEL: 1, EOCC_CRITERIA_SYM: 'K' }],
    pages: [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, PNLNAME: 'P' }]
  });
  assert.deepEqual(checkConfiguration(warn).errors, []);
  assert.equal(checkConfiguration(warn).warnings.length, 1);
});
