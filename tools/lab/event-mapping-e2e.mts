/*
 * Writing Event Mapping end to end on HRDMO (what psft_event_mapping_save /
 * _remove run): the lab content reference ZZ_PCODE_LAB_CMP_GBL configured,
 * edited, emptied and removed through DatabaseProvider, each save read back
 * against the Configure Event Mapping page's rules (docs/CUSTOMIZATION.md
 * "Writing Event Mapping", captures em01-em08): rows re-saved at the next
 * SCNFM, tombstones, the content reference's own row, EV_PARAM, the Data
 * Migration Workbench tracking rows and their hashes.
 *
 * WRITES. HRDMO only; the lab content reference ZZ_PCODE_LAB_CMP_GBL and the
 * lab services ZZ_PCODE_LAB_EMSVC / ZZ_PCODE_LAB_EMSVC2 only. Leaves the
 * content reference configured with writer-saved rows for the PIA page to
 * open. `--save-only` makes one save from the current state (for a sweep).
 *
 *   npx tsx tools/lab/event-mapping-e2e.mts [--save-only]
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import { adsKeyHash } from '../../src/providers/adsTracking';
import type { EventMappingConfigRow } from '../../src/model/eventMapping';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const CREF = 'ZZ_PCODE_LAB_CMP_GBL';
const SVC = 'ZZ_PCODE_LAB_EMSVC';
const SVC2 = 'ZZ_PCODE_LAB_EMSVC2';
const PORTAL = '_PTCS_PTEVMAP';
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
setWriteNamePrefix('ZZ_');

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const q = async (sql: string, b: Record<string, unknown> = {}) => ((await raw.execute(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Array<Record<string, unknown>>;
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const counters = async () => Object.fromEntries((await q(`SELECT OBJECTTYPENAME T, VERSION V FROM PSVERSION WHERE OBJECTTYPENAME IN ('SCNFM','RCSCM','RCSDM','SYS')`)).map((r) => [t(r.T), Number(r.V)]));
const locks = async () => Object.fromEntries((await q(`SELECT OBJECTTYPENAME T, VERSION V FROM PSLOCK WHERE OBJECTTYPENAME IN ('SCNFM','RCSCM','RCSDM')`)).map((r) => [t(r.T), Number(r.V)]));
const confs = async () => q(`SELECT * FROM PSPTCSSRVCONF WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n ORDER BY VERSION`, { p: PORTAL, n: CREF });
const maps = async () => q(`SELECT * FROM PSPTCS_MAPFLDS WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n`, { p: PORTAL, n: CREF });
const tracked = async (ads: string, rec: string, keys: [string, string | number][]) =>
  (await q(`SELECT LASTUPDOPRID O FROM PSADSTRACKING WHERE PTADSNAME = :a AND RECNAME = :r AND PTKEYHASH = :h`, { a: ads, r: rec, h: adsKeyHash(keys) })).length === 1;
const confKeys = (svc: string, id: number): [string, string | number][] => [['PORTAL_NAME', PORTAL], ['PORTAL_OBJNAME', CREF], ['PTCS_SERVICEID', svc], ['PTCS_INSTANCEID', id]];

async function saveRows(rows: EventMappingConfigRow[], label: string) {
  const before = await p.readEventMappingConfiguration(CREF);
  const preview = await p.saveEventMappingConfiguration({ cref: CREF, rows, openedToken: before.token, operatorId, dryRun: true });
  const c0 = await counters();
  check(`${label}: a dry run writes nothing`, JSON.stringify(c0) === JSON.stringify(await counters()) && (await p.readEventMappingConfiguration(CREF)).token === before.token);
  const result = await p.saveEventMappingConfiguration({ cref: CREF, rows, openedToken: before.token, operatorId });
  console.log(`     ${label}: ${result.plan.summary.changes.join('; ') || '(nothing)'}${result.plan.summary.restamped ? ` -- ${result.plan.summary.restamped} restamped` : ''}`);
  return { before, preview, c0, result, c1: await counters() };
}

try {
  // Reset Event Mapping-only lab state the e2e owns: the services' EV_PARAM on EMSVC2 (so the first mapping adds it).
  const svc2Param = (await q(`SELECT 'X' X FROM PSPTCS_PARAMS WHERE PTCS_SERVICEID = :s AND PTCS_PARAMETERNAME = 'EV_PARAM'`, { s: SVC2 })).length > 0;

  if (process.argv.includes('--create-service')) {
    // A service and its class scaffolded (left unmapped: a service without EV_PARAM for the em09 capture).
    const SVC3 = 'ZZ_PCODE_LAB_EMSVC3';
    const req = { serviceId: SVC3, name: 'ZZ Lab EM Svc 3', packageRoot: 'ZZ_PCODE_LAB_EM', classId: 'Handler4', purpose: 'Lab: scaffolded by event-mapping-e2e', operatorId };
    if ((await q(`SELECT 'X' X FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID = :s`, { s: SVC3 })).length) { console.log(`${SVC3} exists; nothing to do`); process.exit(0); }
    const dry = await p.createEventMappingService({ ...req, dryRun: true });
    check('create service: the dry run plans the class and the service, writes nothing', dry.classCreated && !dry.packageCreated && !dry.service.written
      && !(await q(`SELECT 'X' X FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = 'ZZ_PCODE_LAB_EM' AND APPCLASSID = 'Handler4'`)).length);
    const c0 = await counters();
    const l0 = await locks();
    const r = await p.createEventMappingService(req);
    const c1 = await counters();
    const row = (await q(`SELECT * FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID = :s`, { s: SVC3 }))[0];
    check('create service: the class created', r.classCreated && (await q(`SELECT 'X' X FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = 'ZZ_PCODE_LAB_EM' AND QUALIFYPATH = ':' AND APPCLASSID = 'Handler4'`)).length === 1);
    check('create service: the row as the page writes it [em01]', !!row && t(row.PTCS_SERVICEURLTYP) === 'UAPC' && t(row.PACKAGEROOT) === 'ZZ_PCODE_LAB_EM' && t(row.QUALIFYPATH) === ':'
      && t(row.APPCLASSID) === 'Handler4' && t(row.PC_EVENT_TYPE) === 'FieldFormula' && t(row.PC_FUNCTION_NAME) === 'IScript_' && t(row.PTCS_SRVCATTR) === 'GNRL'
      && Number(row.VERSION) === c1.RCSDM && t(row.LASTUPDOPRID) === operatorId && row.PORTAL_URI_TEXT === null, JSON.stringify(row));
    check('create service: RCSDM +1, PSLOCK RCSDM +2', c1.RCSDM === c0.RCSDM + 1 && (await locks()).RCSDM === l0.RCSDM + 2);
    check('create service: tracked', await tracked('RCF_SERVICE_DEFINITIONS', 'PSPTCSSRVDEFN', [['PTCS_SERVICEID', SVC3]]));
    try { await p.createEventMappingService(req); check('create service: a second create refused', false); } catch (e) { check('create service: a second create refused', /already exists/.test(String((e as Error).message))); }
    process.exit(failed ? 1 : 0);
  }

  if (process.argv.includes('--save-only')) {
    const cur = await p.readEventMappingConfiguration(CREF);
    const { result } = await saveRows([...cur.rows.map((r) => ({ ...r, sequence: (r.sequence + 1) % 1000 })),
      { level: 'F', record: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_N1', event: 'RFED', serviceId: SVC, processing: 'POST', sequence: 7, enabled: true, parameter: 'sweep' }], 'sweep save');
    check('sweep save written', result.written);
    process.exit(failed ? 1 : 0);
  }

  // 1. The content reference as the classic page left it [em08], or as an earlier run left it.
  const start = await p.readEventMappingConfiguration(CREF);
  check('the lab content reference registers ZZ_PCODE_LAB_CMP', start.component?.name === 'ZZ_PCODE_LAB_CMP' && start.component.market === 'GBL', JSON.stringify(start.component));
  if (start.exists) {
    await p.removeEventMappingConfiguration(CREF, start.token, operatorId);
    check('start: the stored configuration removed', !(await p.readEventMappingConfiguration(CREF)).exists);
  }

  // 2. Configure it: a content reference not configured yet [em03's PSPTCS_SRVCFG].
  const tomb0 = (await q(`SELECT COUNT(*) N FROM PSPTCSSRVCFGDEL WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n`, { p: PORTAL, n: CREF }))[0].N;
  const l0 = await locks();
  const s1 = await saveRows([
    { level: 'C', event: 'POST', serviceId: SVC, processing: 'POST', sequence: 1, enabled: true },
    { level: 'F', record: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_N1', event: 'RFCH', serviceId: SVC, processing: 'PRE', sequence: 1, enabled: true, parameter: 'zz_lab_param' },
    { level: 'R', page: 'ZZ_PCODE_LAB_PG', event: 'PACT', serviceId: SVC, processing: 'OVER', sequence: 2, enabled: true },
    { level: 'P', record: 'ZZ_PCODE_LAB_T', event: 'RINI', serviceId: SVC2, processing: 'PRE', sequence: 1, enabled: false }
  ], 'configure');
  const cfg = (await q(`SELECT * FROM PSPTCS_SRVCFG WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n`, { p: PORTAL, n: CREF }))[0];
  check('configure: PSPTCS_SRVCFG as the page adds it', !!cfg && t(cfg.MENUNAME) === 'ZZ_PCODE_LAB_MENU' && t(cfg.PNLGRPNAME) === 'ZZ_PCODE_LAB_CMP'
    && t(cfg.PTCS_EXPANDFRAME) === 'N' && t(cfg.PTCS_RCFRAMELOC) === 'B' && Number(cfg.PTCS_NMINPAGELETS) === 0 && Number(cfg.VERSION) === s1.c1.RCSCM && t(cfg.LASTUPDOPRID) === operatorId,
    JSON.stringify(cfg));
  const r1 = await confs();
  check('configure: four rows at SCNFM+1..+4, stamped', r1.length === 4 && r1.map((r) => Number(r.VERSION)).join(',') === [1, 2, 3, 4].map((i) => s1.c0.SCNFM + i).join(',')
    && r1.every((r) => t(r.LASTUPDOPRID) === operatorId && r.LASTUPDDTTM));
  const byLevel = Object.fromEntries(r1.map((r) => [t(r.PTCS_ISCOMPSERVICE), r]));
  check('configure: the columns per level', t(byLevel.C.PTCS_CMPEVENT) === 'POST' && t(byLevel.C.PTCS_CMPRECEVENT) === '' && t(byLevel.F.RECNAME) === 'ZZ_PCODE_LAB_T'
    && t(byLevel.F.FIELDNAME) === 'ZZ_PCODE_LAB_N1' && t(byLevel.F.PTCS_CMPRECEVENT) === 'RFCH' && t(byLevel.R.PNLNAME) === 'ZZ_PCODE_LAB_PG' && t(byLevel.R.PTCS_PROCSEQ) === 'OVER'
    && t(byLevel.P.PTCS_ENABLE) === 'N' && t(byLevel.P.PTCS_SERVICEID) === SVC2);
  check('configure: new rows blank but IS_DEFAULT N [em04]', r1.every((r) => t(r.IS_DEFAULT) === 'N' && t(r.PTCS_URLTARGET) === '' && t(r.PTCS_INSTANCELBL) === ''));
  check('configure: instance IDs as the page draws them (>= 1,000,000, distinct)', r1.every((r) => Number(r.PTCS_INSTANCEID) >= 1e6) && new Set(r1.map((r) => Number(r.PTCS_INSTANCEID))).size === 4);
  const m1 = await maps();
  check('configure: one mapping, the parameter uppercased [em04]', m1.length === 1 && t(m1[0].PTCS_PNLFLDNAME) === 'ZZ_LAB_PARAM' && Number(m1[0].PTCS_INSTANCEID) === Number(byLevel.F.PTCS_INSTANCEID)
    && t(m1[0].PTCS_MAPFIELDTYPE) === '' && Number(m1[0].PTCS_SEQNUM_FMNU) === 0);
  const ev2 = (await q(`SELECT * FROM PSPTCS_PARAMS WHERE PTCS_SERVICEID = :s AND PTCS_PARAMETERNAME = 'EV_PARAM'`, { s: SVC2 }))[0];
  check('configure: the service mapped first time gets EV_PARAM, its VERSION the next RCSDM', svc2Param
    ? s1.c1.RCSDM === s1.c0.RCSDM
    : !!ev2 && t(ev2.PTCS_DESCR128) === 'For Event Mapping' && s1.c1.RCSDM === s1.c0.RCSDM + 1
      && Number((await q(`SELECT VERSION V FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID = :s`, { s: SVC2 }))[0].V) === s1.c1.RCSDM);
  check('configure: SCNFM +4, RCSCM +1, SYS +5', s1.c1.SCNFM === s1.c0.SCNFM + 4 && s1.c1.RCSCM === s1.c0.RCSCM + 1 && s1.c1.SYS === s1.c0.SYS + 5, `${JSON.stringify(s1.c0)} -> ${JSON.stringify(s1.c1)}`);
  const l1 = await locks();
  check('configure: PSLOCK moved by the same steps', l1.SCNFM - l0.SCNFM === 4 && l1.RCSCM - l0.RCSCM === 1 && l1.RCSDM - l0.RCSDM === s1.c1.RCSDM - s1.c0.RCSDM);
  check('configure: tracking rows, PIA\'s hashes', await tracked('RCF_SERVICES', 'PSPTCS_SRVCFG', [['PORTAL_NAME', PORTAL], ['PORTAL_OBJNAME', CREF]])
    && await tracked('RCF_SERVICE_CREFS', 'PSPTCS_SRVCFG', [['PORTAL_NAME', PORTAL], ['PORTAL_OBJNAME', CREF]])
    && (await Promise.all(r1.map((r) => tracked('RCF_SERVICE_CONFIGURATIONS', 'PSPTCSSRVCONF', confKeys(t(r.PTCS_SERVICEID), Number(r.PTCS_INSTANCEID)))))).every(Boolean));
  check('configure: the tombstones left alone (the page keeps them [em08])', (await q(`SELECT COUNT(*) N FROM PSPTCSSRVCFGDEL WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n`, { p: PORTAL, n: CREF }))[0].N === tomb0);

  // 3. Edit: the page row removed, the parameter changed, the component row disabled, rows reordered not at all.
  const read2 = await p.readEventMappingConfiguration(CREF);
  check('read back: four rows as saved', read2.rows.length === 4 && read2.rows.find((r) => r.level === 'F')?.parameter === 'ZZ_LAB_PARAM');
  const pageRow = read2.rows.find((r) => r.level === 'R')!;
  const s2 = await saveRows(read2.rows.filter((r) => r.level !== 'R').map((r) => r.level === 'F' ? { ...r, parameter: 'second' } : r.level === 'C' ? { ...r, enabled: false } : r), 'edit');
  const r2 = await confs();
  check('edit: three rows re-saved at SCNFM+1..+3, the tombstone at +4 [em06]', r2.length === 3 && r2.map((r) => Number(r.VERSION)).join(',') === [1, 2, 3].map((i) => s2.c0.SCNFM + i).join(',')
    && Number((await q(`SELECT VERSION V FROM PSPTCSSRVCNFDEL WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND PTCS_INSTANCEID = :i`, { p: PORTAL, n: CREF, i: pageRow.instanceId }))[0]?.V) === s2.c0.SCNFM + 4);
  check('edit: the parameter changed, the component row disabled', t((await maps())[0]?.PTCS_PNLFLDNAME) === 'SECOND' && t(r2.find((r) => t(r.PTCS_ISCOMPSERVICE) === 'C')?.PTCS_ENABLE) === 'N');
  check('edit: SCNFM +4, SYS +4, RCSCM and RCSDM unmoved', s2.c1.SCNFM === s2.c0.SCNFM + 4 && s2.c1.SYS === s2.c0.SYS + 4 && s2.c1.RCSCM === s2.c0.RCSCM && s2.c1.RCSDM === s2.c0.RCSDM);
  check('edit: the removed row\'s tracking kept and refreshed [em06]', await tracked('RCF_SERVICE_CONFIGURATIONS', 'PSPTCSSRVCONF', confKeys(SVC, pageRow.instanceId!)));

  // 4. Nothing changed: nothing written.
  const read3 = await p.readEventMappingConfiguration(CREF);
  const s3 = await saveRows(read3.rows, 'unchanged');
  check('unchanged: nothing written', !s3.result.written && JSON.stringify(s3.c0) === JSON.stringify(s3.c1));

  // 5. Refusals: a stale token, an unknown service, a non-Application Class service, a service outside the write scope, a bad event.
  const refused = async (what: string, f: () => Promise<unknown>, re: RegExp) => {
    try { await f(); check(`refused: ${what}`, false, 'it was written'); } catch (e) { check(`refused: ${what}`, re.test(String((e as Error).message)), String((e as Error).message)); }
  };
  await refused('a stale token', () => p.saveEventMappingConfiguration({ cref: CREF, rows: read3.rows, openedToken: read2.token, operatorId }), /changed since/);
  await refused('an unknown service', () => p.saveEventMappingConfiguration({ cref: CREF, rows: [...read3.rows, { level: 'C', event: 'PRE', serviceId: 'ZZ_NO_SUCH_SVC', processing: 'PRE', sequence: 1, enabled: true }], openedToken: read3.token, operatorId }), /no related content service/);
  await refused('a service outside the write scope', () => p.saveEventMappingConfiguration({ cref: CREF, rows: [...read3.rows, { level: 'C', event: 'PRE', serviceId: 'EOCC_MASK_POSTBUILD', processing: 'PRE', sequence: 1, enabled: true }], openedToken: read3.token, operatorId }), /does not start with ZZ_/);
  await refused('a record event at the component level', () => p.saveEventMappingConfiguration({ cref: CREF, rows: [...read3.rows, { level: 'C', event: 'RINI', serviceId: SVC, processing: 'PRE', sequence: 1, enabled: true }], openedToken: read3.token, operatorId }), /not a Component event/);
  await refused('a field the record lacks', () => p.saveEventMappingConfiguration({ cref: CREF, rows: [...read3.rows, { level: 'F', record: 'ZZ_PCODE_LAB_T', field: 'EMPLID', event: 'RFCH', serviceId: SVC, processing: 'PRE', sequence: 1, enabled: true }], openedToken: read3.token, operatorId }), /has no field/);
  const outside = await p.saveEventMappingConfiguration({ cref: CREF, rows: [...read3.rows, { level: 'P', record: 'PSOPRDEFN', event: 'RINI', serviceId: SVC, processing: 'PRE', sequence: 1, enabled: true }], openedToken: read3.token, operatorId, dryRun: true });
  check('a record off the component\'s pages: allowed with a warning (Unrestricted Prompt)', outside.plan.summary.warnings.some((x) => /PSOPRDEFN is not on ZZ_PCODE_LAB_CMP/.test(x)), outside.plan.summary.warnings.join('; '));

  // 6. Remove [em07], then configure again for the PIA page to open.
  const c40 = await counters();
  const before4 = await p.readEventMappingConfiguration(CREF);
  await p.removeEventMappingConfiguration(CREF, before4.token, operatorId);
  const c41 = await counters();
  check('remove: no rows left', (await confs()).length === 0 && (await maps()).length === 0 && !(await p.readEventMappingConfiguration(CREF)).exists);
  check('remove: SCNFM +3 (a tombstone each), RCSCM +1 (the content reference\'s), SYS +4', c41.SCNFM === c40.SCNFM + 3 && c41.RCSCM === c40.RCSCM + 1 && c41.SYS === c40.SYS + 4);
  check('remove: PSPTCSSRVCFGDEL at the new RCSCM', (await q(`SELECT VERSION V FROM PSPTCSSRVCFGDEL WHERE PORTAL_NAME = :p AND PORTAL_OBJNAME = :n AND VERSION = :v`, { p: PORTAL, n: CREF, v: c41.RCSCM })).length === 1);
  check('remove: RCF_SERVICE_CREFS tracking dropped, RCF_SERVICES kept [em07]', !(await tracked('RCF_SERVICE_CREFS', 'PSPTCS_SRVCFG', [['PORTAL_NAME', PORTAL], ['PORTAL_OBJNAME', CREF]]))
    && await tracked('RCF_SERVICES', 'PSPTCS_SRVCFG', [['PORTAL_NAME', PORTAL], ['PORTAL_OBJNAME', CREF]]));
  check('remove: the services keep EV_PARAM', (await q(`SELECT COUNT(*) N FROM PSPTCS_PARAMS WHERE PTCS_SERVICEID IN (:a, :b) AND PTCS_PARAMETERNAME = 'EV_PARAM'`, { a: SVC, b: SVC2 }))[0].N === 2);

  const final = await saveRows([
    { level: 'C', event: 'POST', serviceId: SVC, processing: 'POST', sequence: 1, enabled: true },
    { level: 'F', record: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_N1', event: 'RFCH', serviceId: SVC2, processing: 'PRE', sequence: 1, enabled: true, parameter: 'writer' },
    { level: 'P', record: 'ZZ_PCODE_LAB_T', event: 'RINI', serviceId: SVC, processing: 'OVER', sequence: 2, enabled: false }
  ], 'configure for PIA');
  check('left configured for the PIA page', final.result.written && (await confs()).length === 3);
} catch (e) {
  failed++;
  console.log(`ERROR ${(e as Error).stack ?? e}`);
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await raw.close();
  process.exit(failed ? 1 : 0);
}
