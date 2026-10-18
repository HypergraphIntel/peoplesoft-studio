import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfigRow, validateConfigRows, type EventMappingConfigRow } from '../model/eventMapping.js';
import { adsKeyHash } from '../providers/adsTracking.js';
import {
  configRowsOf, configurationToken, newInstanceId, planConfigurationRemove, planConfigurationSave,
  type ConfigurationContext, type Counters, type StoredConfiguration
} from '../providers/eventMappingWriter.js';
import { planAppClassService, qualifyPath, serviceClassSource, validateServiceRequest } from '../providers/rcServiceWriter.js';
import { applyDelta, captureExists, counterValues, execute, insertedRows, tableText, type Tables } from './eventMappingCaptures.js';

/*
 * The Event Mapping writer against the Configure Event Mapping page's saves
 * on HRDMO (eventMappingCaptures.ts): from each capture's rows before, the
 * plan for what the page saved writes the rows and moves the counters the
 * page did.
 */

const CREF = 'ZZ_PCODE_LAB_CMP_GBL';
const SVC = 'ZZ_PCODE_LAB_EMSVC';
const TABLES = ['PSPTCS_SRVCFG', 'PSPTCSSRVCONF', 'PSPTCS_MAPFLDS', 'PSPTCSSRVCNFDEL', 'PSPTCSSRVCFGDEL'] as const;
const CASES = ['em03-config-add', 'em04-fluid-add-record', 'em05-fluid-page-record-edit', 'em06-fluid-delete-row', 'em07-fluid-remove-config'];
const have = CASES.every(captureExists);

const context = (evParam = true): ConfigurationContext => ({
  portal: 'EMPLOYEE', menu: 'ZZ_PCODE_LAB_MENU', component: 'ZZ_PCODE_LAB_CMP', market: 'GBL',
  services: new Map([[SVC, { exists: true, appClass: true, evParam, version: 7 }]]),
  tracked: new Set(['RCF_SERVICES|PSPTCS_SRVCFG', 'RCF_SERVICE_CREFS|PSPTCS_SRVCFG', 'RCF_SERVICE_CONFIGURATIONS|PSPTCSSRVCONF', 'RCF_SERVICE_DEFINITIONS|PSPTCSSRVDEFN'])
});

/** The rows before each case, chained from the empty content reference. */
function states(): Map<string, Tables> {
  const out = new Map<string, Tables>();
  let t: Tables = {};
  for (const c of CASES) {
    out.set(c, t);
    t = applyDelta(c, t, TABLES);
  }
  out.set('end', t);
  return out;
}

function stored(t: Tables): StoredConfiguration {
  const cfg = (t.PSPTCS_SRVCFG ?? []).find((r) => r.PORTAL_OBJNAME === CREF);
  const configs = (t.PSPTCSSRVCONF ?? []).filter((r) => r.PORTAL_OBJNAME === CREF).sort((a, b) => Number(a.VERSION) - Number(b.VERSION));
  return { cref: CREF, exists: !!cfg, ...(cfg ? { serviceConfig: cfg } : {}), configs, mapFields: (t.PSPTCS_MAPFLDS ?? []).filter((r) => r.PORTAL_OBJNAME === CREF) };
}

const counters = (caseName: string, side: 'before' | 'after'): Counters => {
  const v = counterValues(caseName, side);
  return { SCNFM: v.SCNFM ?? 0, RCSCM: v.RCSCM ?? 0, RCSDM: v.RCSDM ?? 0, SYS: v.SYS };
};

/** Rand() that yields the captured instance ID's two runs of digits. */
const randomFor = (...ids: number[]) => {
  const seq = ids.flatMap((id) => { const t = String(id); return [Number(`0.${t.slice(0, 4)}5`), Number(`0.${t.slice(4)}5`)]; });
  return () => seq.shift() ?? 0.5;
};

function check(caseName: string, before: Tables, after: Tables, rows: EventMappingConfigRow[], random: () => number) {
  const s = stored(before);
  const from = { ...counters(caseName, 'before') };
  const plan = planConfigurationSave(s, rows, { operatorId: 'JARED', lastupddttm: '2026-10-12T15:00:00.000000', counters: from, context: context(), random });
  const ran = execute(plan.statements, before, { ...from });
  for (const t of ['PSPTCSSRVCONF', 'PSPTCS_MAPFLDS', 'PSPTCSSRVCNFDEL']) {
    assert.deepEqual(tableText(ran.tables[t] ?? []), tableText(after[t] ?? []), `${caseName}: ${t}`);
  }
  const want = counters(caseName, 'after');
  for (const n of ['SCNFM', 'SYS'] as const) assert.equal(ran.counters[n] ?? from[n], want[n], `${caseName}: ${n}`);
  return plan;
}

test('the captures are here', { skip: !have && 'captures not present' }, () => {
  assert.ok(have);
});

test('the key hash is PIA\'s: SHA-1 over UTF-16LE "( NAME = value )" sorted by name [em01, em03, em04]', () => {
  assert.equal(adsKeyHash([['PTCS_SERVICEID', 'ZZ_PCODE_LAB_EMSVC']]), 'T6Lgaueh9pJxTyXQS/5qOXLuZvM=');
  assert.equal(adsKeyHash([['PORTAL_NAME', '_PTCS_PTEVMAP'], ['PORTAL_OBJNAME', CREF]]), '+CU4DjsCws6BuWN15lLnEeGd8Wg=');
  assert.equal(adsKeyHash([['PORTAL_NAME', '_PTCS_PTEVMAP'], ['PORTAL_OBJNAME', CREF], ['PTCS_SERVICEID', SVC], ['PTCS_INSTANCEID', 380061827]]), 'kB3LaV02BGN5Jh6JBfstmqL70Io=');
  assert.equal(adsKeyHash([['PORTAL_NAME', 'EMPLOYEE'], ['PORTAL_OBJNAME', 'HC_TL_SRCH_APPRV_GRP_GBL'], ['PTCS_MENUID', 'TL_MNG_GRP_APPROVE.7'], ['PTCS_FOLDERID', '8+JlOlVI3YjwYyiJB0B0PCcQGPo=']]),
    'TiVzluShoGg6gj++V+lzOYZBsLo=');
});

test('a new row on a saved configuration: every row re-saved at the next SCNFM, the parameter its own mapping [em04]', { skip: !have && 'captures' }, () => {
  const st = states();
  const before = st.get('em04-fluid-add-record')!;
  const rows = [
    ...configRowsOf(stored(before)),
    { level: 'F', record: 'zz_pcode_lab_t', field: 'ZZ_PCODE_LAB_N1', event: 'RFCH', serviceId: SVC, processing: 'PRE', sequence: 1, enabled: true, parameter: 'zz_lab_param' } as EventMappingConfigRow
  ];
  const plan = check('em04-fluid-add-record', before, st.get('em05-fluid-page-record-edit')!, rows, randomFor(380061827));
  assert.equal(plan.summary.restamped, 1);
  assert.deepEqual(plan.summary.changes, [`add Record Field ZZ_PCODE_LAB_T.ZZ_PCODE_LAB_N1 FieldChange -> ${SVC}, Pre Process, sequence 1`]);
});

test('page and record rows added, one disabled, a sequence changed [em05]', { skip: !have && 'captures' }, () => {
  const st = states();
  const before = st.get('em05-fluid-page-record-edit')!;
  const [c, f] = configRowsOf(stored(before));
  const rows: EventMappingConfigRow[] = [
    { ...c, sequence: 2 }, f,
    { level: 'R', page: 'ZZ_PCODE_LAB_PG', event: 'PACT', serviceId: SVC, processing: 'OVER', sequence: 2, enabled: true },
    { level: 'P', record: 'ZZ_PCODE_LAB_T', event: 'RINI', serviceId: SVC, processing: 'PRE', sequence: 1, enabled: false }
  ];
  check('em05-fluid-page-record-edit', before, st.get('em06-fluid-delete-row')!, rows, randomFor(561179544, 247649065));
});

test('a row deleted: the others re-saved first, then its tombstone at the next SCNFM [em06]', { skip: !have && 'captures' }, () => {
  const st = states();
  const before = st.get('em06-fluid-delete-row')!;
  const rows = configRowsOf(stored(before)).filter((r) => r.level !== 'R');
  const plan = check('em06-fluid-delete-row', before, st.get('em07-fluid-remove-config')!, rows, randomFor());
  assert.equal(insertedRows('em06-fluid-delete-row', 'PSPTCSSRVCNFDEL')[0].VERSION, String(plan.counters.SCNFM));
});

test('Remove: every row with its tombstone, then the content reference\'s at the next RCSCM [em07]', { skip: !have && 'captures' }, () => {
  const st = states();
  const before = st.get('em07-fluid-remove-config')!;
  const from = counters('em07-fluid-remove-config', 'before');
  const plan = planConfigurationRemove(stored(before), from, context(), '2026-10-12T15:00:00.000000', 'JARED');
  const ran = execute(plan.statements, before, { ...from });
  const after = st.get('end')!;
  for (const t of TABLES.filter((x) => x !== 'PSPTCSSRVCNFDEL')) assert.deepEqual(tableText(ran.tables[t] ?? []), tableText(after[t] ?? []), t);
  // The tombstones' VERSIONs follow the order the API reads the rows in -- the table's storage order, no column's --
  // so the writer numbers them in saved order: the same instances and the same VERSIONs, perhaps paired otherwise.
  const tomb = (rows: Tables[string]) => ({ ids: rows.map((r) => String(r.PTCS_INSTANCEID)).sort(), versions: rows.map((r) => String(r.VERSION)).sort() });
  assert.deepEqual(tomb(ran.tables.PSPTCSSRVCNFDEL), tomb(after.PSPTCSSRVCNFDEL));
  const want = counters('em07-fluid-remove-config', 'after');
  for (const n of ['SCNFM', 'RCSCM', 'SYS'] as const) assert.equal(plan.counters[n], want[n], n);
  assert.ok(plan.statements.some((x) => x.what === 'Untracking PSPTCS_SRVCFG (RCF_SERVICE_CREFS)'));
});

test('a content reference configured for the first time: PSPTCS_SRVCFG as the page adds it [em03]', { skip: !have && 'captures' }, () => {
  const s: StoredConfiguration = { cref: CREF, exists: false, configs: [], mapFields: [] };
  const from: Counters = { SCNFM: 1, RCSCM: 1, RCSDM: 7, SYS: 2787 };
  const plan = planConfigurationSave(s, [{ level: 'C', event: 'POST', serviceId: SVC, processing: 'POST', sequence: 1, enabled: true }],
    { operatorId: 'JARED', lastupddttm: '2026-10-12T15:00:00.000000', counters: from, context: context(false), random: randomFor(515711512) });
  const ran = execute(plan.statements, {}, { ...from });
  const [cfg] = ran.tables.PSPTCS_SRVCFG;
  const captured = insertedRows('em03-config-add', 'PSPTCS_SRVCFG')[0];
  for (const k of ['PORTAL_NAME', 'PORTAL_OBJNAME', 'MENUNAME', 'PNLGRPNAME', 'PTCS_EXPANDFRAME', 'PTCS_RCFRAMELOC', 'PTCS_NMINPAGELETS', 'LASTUPDOPRID']) {
    assert.equal(String(cfg[k]).trim(), String(captured[k]).trim(), k);
  }
  assert.equal(cfg.VERSION, 2);
  // The service gets EV_PARAM as the classic page gave it, at the next RCSDM.
  assert.deepEqual(ran.tables.PSPTCS_PARAMS.map((r) => [r.PTCS_SERVICEID, r.PTCS_PARAMETERNAME, r.SEQNUM, r.REQUIRED_FLG, r.PTCS_DESCR128]),
    insertedRows('em03-config-add', 'PSPTCS_PARAMS').map((r) => [r.PTCS_SERVICEID, r.PTCS_PARAMETERNAME, Number(r.SEQNUM), r.REQUIRED_FLG, r.PTCS_DESCR128]));
  assert.equal(plan.counters.RCSDM, 8);
  assert.equal(ran.tables.PSPTCSSRVCONF[0].PTCS_INSTANCEID, 515711512);
  assert.equal(ran.tables.PSPTCS_MAPFLDS, undefined, 'no parameter, no mapping row');
  // The classic page keeps the tombstones of earlier removals when it configures it again [em08, 8.62.09].
  assert.ok(!plan.statements.some((st) => st.sql.startsWith('DELETE FROM PSPTCSSRVCFGDEL')));
});

test('nothing changed: nothing written', { skip: !have && 'captures' }, () => {
  const before = states().get('em05-fluid-page-record-edit')!;
  const s = stored(before);
  const plan = planConfigurationSave(s, configRowsOf(s), { operatorId: 'JARED', lastupddttm: 'x', counters: { SCNFM: 4, RCSCM: 3, RCSDM: 7, SYS: 1 }, context: context() });
  assert.ok(plan.empty);
});

test('what the page refuses, and what it would not let change', () => {
  const ok: EventMappingConfigRow = { level: 'C', event: 'POST', serviceId: SVC, processing: 'POST', sequence: 1, enabled: true };
  assert.deepEqual(validateConfigRows([ok]), []);
  const msgs = (rows: EventMappingConfigRow[]) => validateConfigRows(rows).map((p) => p.message);
  assert.match(msgs([{ ...ok, level: 'R' }])[0], /needs a page/);
  assert.match(msgs([{ ...ok, level: 'F', record: 'X', event: 'RFCH' }])[0], /needs a field/);
  assert.match(msgs([{ ...ok, event: 'RINI' }])[0], /not a Component event/);
  assert.match(msgs([{ ...ok, level: 'P', record: 'X', event: 'PACT' }])[0], /not a Record event/);
  assert.match(msgs([{ ...ok, sequence: 1000 }])[0], /0 to 999/);
  assert.match(msgs([ok, { ...ok, sequence: 5 }])[0], /Duplicates row 1/);
  assert.deepEqual(normalizeConfigRow({ ...ok, level: 'p' as never, record: 'zz_x', page: 'IGNORED', parameter: ' abc ' }),
    { level: 'P', record: 'ZZ_X', event: 'POST', serviceId: SVC, processing: 'POST', sequence: 1, enabled: true, parameter: 'ABC' });
});

test('a saved row\'s level and service are locked; an unknown instance is refused', { skip: !have && 'captures' }, () => {
  const s = stored(states().get('em05-fluid-page-record-edit')!);
  const [c] = configRowsOf(s);
  const opts = { operatorId: 'JARED', lastupddttm: 'x', counters: { SCNFM: 4, RCSCM: 3, RCSDM: 7, SYS: 1 }, context: context() };
  assert.throws(() => planConfigurationSave(s, [{ ...c, serviceId: 'OTHER' }], opts), /cannot change/);
  assert.throws(() => planConfigurationSave(s, [{ ...c, instanceId: 42 }], opts), /no configuration 42/);
});

test('instance IDs as the page draws them; the token moves with every save', { skip: !have && 'captures' }, () => {
  assert.equal(newInstanceId(new Set(), randomFor(380061827)), 380061827);
  assert.equal(newInstanceId(new Set([380061827]), randomFor(380061827, 515711512)), 515711512);
  const st = states();
  const a = configurationToken(stored(st.get('em05-fluid-page-record-edit')!));
  const b = configurationToken(stored(st.get('em06-fluid-delete-row')!));
  assert.notEqual(a, b);
  assert.equal(configurationToken(stored({})), 'absent');
});

test('a service defined as the Define Related Content Service page saves it [em01]', { skip: !captureExists('em01-service-create') && 'captures' }, () => {
  const captured = insertedRows('em01-service-create', 'PSPTCSSRVDEFN')[0];
  const plan = planAppClassService(
    { serviceId: 'zz_pcode_lab_emsvc', name: 'ZZ Lab EM Service', packageRoot: 'ZZ_PCODE_LAB_EM', classId: 'Handler', operatorId: 'JARED' },
    { rcsdm: 5, sys: 2785, lastupddttm: '2026-10-12T14:28:10.821538', tracked: new Set(['RCF_SERVICE_DEFINITIONS|PSPTCSSRVDEFN']) });
  const ran = execute(plan.statements, {}, { RCSDM: 5, SYS: 2785 });
  const [row] = ran.tables.PSPTCSSRVDEFN;
  // The page leaves PORTAL_URI_TEXT, the help text, the validity dates and PORTAL_URL_ADM NULL; the writer leaves them out.
  const nulls = Object.keys(captured).filter((k) => captured[k] === null);
  assert.deepEqual(nulls.sort(), ['LASTUPDDTTM', 'PORTAL_URI_TEXT', 'PORTAL_URL_ADM', 'PTCS_SRVHELPTEXT', 'PTCS_VALID_FROM', 'PTCS_VALID_TO'].filter((k) => k !== 'LASTUPDDTTM' || captured[k] === null).sort());
  assert.deepEqual(tableText([row]), tableText([Object.fromEntries(Object.entries(captured).filter(([, v]) => v !== null))]));
  const moved = counterValues('em01-service-create', 'after');
  assert.equal(ran.counters.RCSDM, moved.RCSDM);
  assert.equal(ran.counters.SYS, moved.SYS);
  assert.equal(ran.counters['PSLOCK.RCSDM'], 2, 'PSLOCK RCSDM + 2, as the page moves it');
  assert.ok(plan.statements.some((s) => s.what === 'Tracking PSPTCSSRVDEFN (RCF_SERVICE_DEFINITIONS)'));
  assert.equal(qualifyPath(['Services']), 'Services');
  assert.match(validateServiceRequest({ serviceId: 'X', name: 'A name longer than eighteen', packageRoot: 'P', classId: 'C' })[0], /18 characters/);
  assert.match(serviceClassSource('Handler3'), /class Handler3 extends PT_RCF:ServiceInterface\n   method execute\(\);/);
});
