/*
 * Customization Intelligence phase 1 on HRDMO (docs/CUSTOMIZATION.md):
 * ownership classified from the database's evidence -- with no baseline, then
 * with a delivered baseline captured from HRDMO itself (a vanilla demo: only
 * the lab's ZZ_ definitions are not Oracle's) -- and the write guard reached
 * by every DatabaseProvider write before it touches anything: a spy guard
 * refuses each, and PSVERSION shows nothing was written, delivered
 * definitions included.
 *
 * READ ONLY (every write is refused by the spy guard before it starts).
 *
 *   npx tsx tools/lab/customization-e2e.mts [--save-baseline FILE.json.gz]
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseProvider } from '../../src/providers/database';
import { BaselineIndex, setBaselineResolver } from '../../src/providers/ownershipReader';
import { runAsAgent, setWriteGuard, type GuardedWrite } from '../../src/providers/writeGuard';
import { DefinitionType, makeKey, type DefinitionKey } from '../../src/model/definitions';
import type { NamingPrefix } from '../../src/model/ownership';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const q = async (sql: string, b: Record<string, unknown> = {}) => ((await raw.execute(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Array<Record<string, unknown>>;
const ORG: NamingPrefix[] = [{ prefix: 'ZZ_', owner: 'organization', name: 'Acme Corp' }];
const BOLT_ON: NamingPrefix[] = [...ORG, { prefix: 'ZZ_PCODE_LAB_', owner: 'partner', name: 'Lab Bolt-On' }];
const owner = async (key: DefinitionKey, prefixes: NamingPrefix[] = ORG) => (await p.classifyDefinition(key, prefixes)).classification;
const show = (c: { ownership: string; confidence: string }) => `${c.ownership}/${c.confidence}`;

try {
  // A delivered program, and an event the record has no program for.
  const [pc] = await q(`SELECT OBJECTVALUE2 F, OBJECTVALUE3 E FROM PSPCMPROG WHERE OBJECTID1 = 1 AND OBJECTVALUE1 = 'JOB' AND OBJECTID3 = 12 AND PROGSEQ = 0 FETCH FIRST 1 ROWS ONLY`);
  const jobPc = makeKey(DefinitionType.RecordPeopleCode, 'JOB', String(pc.F).trim(), String(pc.E).trim());

  // 1. No baseline: the stamp, delivered projects, the prefixes.
  setBaselineResolver(undefined);
  let c = await owner(makeKey(DefinitionType.Record, 'JOB'));
  check('JOB (record): delivered -- stamped PPLSOFT', c.ownership === 'DELIVERED', show(c));
  c = await owner(makeKey(DefinitionType.Page, 'JOB_DATA1'));
  check('JOB_DATA1 (page): delivered', c.ownership === 'DELIVERED', show(c));
  c = await owner(jobPc);
  check(`${jobPc.parts.join('.')} (PeopleCode): delivered`, c.ownership === 'DELIVERED', show(c));
  c = await owner(makeKey(DefinitionType.RecordPeopleCode, 'JOB', 'EMPLID', 'FieldDefault'));
  check('a new event on JOB: judged by JOB -- adding PeopleCode to a delivered record is a delivered change', c.ownership === 'DELIVERED' && /judged by/.test(c.evidence[0]), c.evidence.join(' | '));
  c = await owner(makeKey(DefinitionType.Record, 'ZZ_PCODE_LAB_T'));
  check('ZZ_PCODE_LAB_T with the organization prefix ZZ_: custom', c.ownership === 'CUSTOM', show(c));
  c = await owner(makeKey(DefinitionType.Record, 'ZZ_PCODE_LAB_R6'), []);
  check('ZZ_PCODE_LAB_R6 with no prefixes configured: unknown, never assumed custom', c.ownership === 'UNKNOWN', show(c));
  c = await owner(makeKey(DefinitionType.Record, 'ZZ_PCODE_LAB_T'), []);
  check('ZZ_PCODE_LAB_T, listed in a PPLSOFT-stamped project, no prefixes: delivered-modified, low -- asked, not assumed custom', c.ownership === 'DELIVERED_MODIFIED' && c.confidence === 'LOW', show(c));
  c = await owner(makeKey(DefinitionType.MessageChannel, 'ZZ_PCODE_LAB_CHN5'), BOLT_ON);
  check('a bolt-on prefix (the longest match) makes it a partner\'s', c.ownership === 'PARTNER', show(c) + ' ' + c.evidence.join(' | '));
  c = await owner(makeKey(DefinitionType.Record, 'ZZ_NOT_THERE'));
  check('a definition not stored: no owner yet', c.ownership === 'UNKNOWN' && /Not stored/.test(c.evidence[0]), show(c));

  // 2. A delivered baseline captured from HRDMO.
  const t0 = Date.now();
  const file = await p.captureDeliveredBaseline();
  const counts = Object.fromEntries(Object.entries(file.kinds).map(([k, v]) => [k, v.length]));
  console.log(`baseline ${file.appRelease} / PT ${file.toolsRelease} in ${Date.now() - t0} ms:`, JSON.stringify(counts));
  // Lab definitions saved as JARED are left out; two early lab records saved while signed in as PPLSOFT are not -- a baseline is
  // only as vanilla as its database (docs/CUSTOMIZATION.md).
  check('baseline: every kind captured, the lab\'s locally-saved definitions left out', counts.PSRECDEFN > 50000 && counts.PSPCMPROG > 100000 &&
    !file.kinds.PSRECDEFN.includes('ZZ_PCODE_LAB_T') && !file.kinds.PSRECDEFN.includes('ZZ_PCODE_LAB_R6') && file.kinds.PSPNLGRPDEFN.includes('JOB_DATA.GBL'),
    `PPLSOFT-stamped lab records in it: ${file.kinds.PSRECDEFN.filter((n) => n.startsWith('ZZ_PCODE_LAB')).join(', ')}`);
  console.log(`note: lab records stamped PPLSOFT, so in this baseline: ${file.kinds.PSRECDEFN.filter((n) => n.startsWith('ZZ_PCODE_LAB')).join(', ') || 'none'}`);
  const gz = gzipSync(Buffer.from(JSON.stringify(file)));
  console.log(`baseline file: ${(gz.length / 1024 / 1024).toFixed(2)} MB gzipped`);
  const saveAt = process.argv.indexOf('--save-baseline');
  if (saveAt > 0) writeFileSync(process.argv[saveAt + 1], gz);
  const index = new BaselineIndex(file);
  setBaselineResolver(async (release) => (release.appRelease === file.appRelease ? index : undefined));
  c = await owner(makeKey(DefinitionType.Record, 'JOB'));
  check('with the baseline: JOB delivered, high confidence', c.ownership === 'DELIVERED' && c.confidence === 'HIGH', show(c));
  c = await owner(jobPc);
  check('with the baseline: its PeopleCode delivered, high', c.ownership === 'DELIVERED' && c.confidence === 'HIGH', show(c));
  c = await owner(makeKey(DefinitionType.Component, 'JOB_DATA', 'GBL'));
  check('with the baseline: JOB_DATA.GBL delivered, high', c.ownership === 'DELIVERED' && c.confidence === 'HIGH', show(c));
  c = await owner(makeKey(DefinitionType.Record, 'ZZ_PCODE_LAB_T'), []);
  check('with the baseline: a lab record, no prefix needed -- not delivered, saved locally: custom', c.ownership === 'CUSTOM' && c.confidence === 'MEDIUM', show(c));
  c = await owner(makeKey(DefinitionType.Record, 'ZZ_PCODE_LAB_T'));
  check('with the baseline and the ZZ_ prefix: custom, high', c.ownership === 'CUSTOM' && c.confidence === 'HIGH', show(c));
  // A delivered definition re-saved locally (simulated: the baseline holds a lab record).
  const doctored = new BaselineIndex({ ...file, kinds: { ...file.kinds, PSRECDEFN: [...file.kinds.PSRECDEFN, 'ZZ_PCODE_LAB_T'] } });
  setBaselineResolver(async () => doctored);
  c = await owner(makeKey(DefinitionType.Record, 'ZZ_PCODE_LAB_T'));
  check('in the baseline but saved by another operator: delivered, modified', c.ownership === 'DELIVERED_MODIFIED' && c.confidence === 'HIGH', show(c));
  setBaselineResolver(async () => index);

  // 3. Every write passes the guard before it touches anything.
  const seen: GuardedWrite[] = [];
  const SENTINEL = 'guard refused (spy)';
  setWriteGuard(async (w) => { seen.push(w); throw new Error(SENTINEL); });
  const [{ V: sysBefore }] = await q(`SELECT SUM(VERSION) V FROM PSVERSION`);
  const op = 'JARED';
  const any = {} as never;
  const calls: [string, DefinitionKey, string, () => Promise<unknown>][] = [
    ['saveRecord', makeKey(DefinitionType.Record, 'JOB'), 'save', () => p.saveRecord({ edit: { recname: 'JOB', isNew: false } as never, operatorId: op })],
    ['deleteRecord', makeKey(DefinitionType.Record, 'JOB'), 'delete', () => p.deleteRecord({ recname: 'JOB', openedVersion: 0, operatorId: op })],
    ['saveTranslate', makeKey(DefinitionType.Field, 'EMPL_STATUS'), 'save', () => p.saveTranslate('EMPL_STATUS', any, op)],
    ['saveField', makeKey(DefinitionType.Field, 'EMPLID'), 'save', () => p.saveField({ name: 'EMPLID', openedVersion: 0, operatorId: op } as never)],
    ['saveSqlDefinition', makeKey(DefinitionType.SqlDefinition, 'HR_JOB_SQL', '0'), 'save', () => p.saveSqlDefinition({ sqlId: 'HR_JOB_SQL', text: '', openedVersion: 0, operatorId: op })],
    ['saveComponent', makeKey(DefinitionType.Component, 'JOB_DATA', 'GBL'), 'save', () => p.saveComponent({ name: 'JOB_DATA', market: 'GBL' } as never)],
    ['savePage', makeKey(DefinitionType.Page, 'JOB_DATA1'), 'save', () => p.savePage({ pnlName: 'JOB_DATA1' } as never)],
    ['saveStyleSheet', makeKey(DefinitionType.StyleSheet, 'PSSTYLEDEF'), 'save', () => p.saveStyleSheet({ name: 'PSSTYLEDEF' } as never)],
    ['saveHtmlDefinition', makeKey(DefinitionType.HtmlDefinition, 'PT_HTML', '4'), 'save', () => p.saveHtmlDefinition({ name: 'PT_HTML' } as never)],
    ['savePeopleCode', jobPc, 'save', () => p.savePeopleCode(jobPc, { source: '' } as never)],
    ['saveAppEngineDocument', makeKey(DefinitionType.AppEngineProgram, 'HR_PROG'), 'save', () => p.saveAppEngineDocument({ doc: { name: 'HR_PROG' }, openedToken: 't', operatorId: op } as never)],
    ['deleteAppEngineProgram', makeKey(DefinitionType.AppEngineProgram, 'HR_PROG'), 'delete', () => p.deleteAppEngineProgram('HR_PROG', 't', op)],
    ['renameAppEngineProgram', makeKey(DefinitionType.AppEngineProgram, 'HR_PROG'), 'rename', () => p.renameAppEngineProgram('HR_PROG', 'ZZ_X', 't', op)],
    ['saveMenuDocument', makeKey(DefinitionType.Menu, 'ADMINISTER_WORKFORCE_(GBL)'), 'save', () => p.saveMenuDocument({ doc: { name: 'ADMINISTER_WORKFORCE_(GBL)' }, openedToken: 't', operatorId: op } as never)],
    ['deleteMenuDefinition', makeKey(DefinitionType.Menu, 'M'), 'delete', () => p.deleteMenuDefinition('M', 't', op)],
    ['renameMenuDefinition', makeKey(DefinitionType.Menu, 'M'), 'rename', () => p.renameMenuDefinition('M', 'ZZ_X', 't', op)],
    ['saveChannelDocument', makeKey(DefinitionType.MessageChannel, 'C'), 'save', () => p.saveChannelDocument({ doc: { name: 'C' }, openedToken: 't', operatorId: op } as never)],
    ['deleteChannelDefinition', makeKey(DefinitionType.MessageChannel, 'C'), 'delete', () => p.deleteChannelDefinition('C', 't', op)],
    ['renameChannelDefinition', makeKey(DefinitionType.MessageChannel, 'C'), 'rename', () => p.renameChannelDefinition('C', 'ZZ_X', 't', op)],
    ['saveCiDocument', makeKey(DefinitionType.ComponentInterface, 'CI_JOB_DATA'), 'save', () => p.saveCiDocument({ doc: { name: 'CI_JOB_DATA' }, openedToken: 't', operatorId: op } as never)],
    ['deleteCiDefinition', makeKey(DefinitionType.ComponentInterface, 'CI'), 'delete', () => p.deleteCiDefinition('CI', 't', op)],
    ['renameCiDefinition', makeKey(DefinitionType.ComponentInterface, 'CI'), 'rename', () => p.renameCiDefinition('CI', 'ZZ_X', 't', op)]
  ];
  for (const [name, key, action, call] of calls) {
    seen.length = 0;
    const err = await call().then(() => 'wrote', (e: Error) => e.message);
    const g = seen[0];
    check(`${name}: guarded first (${action} ${key.parts.join('.')})`, err === SENTINEL && !!g && g.action === action && g.key.type === key.type && g.key.parts.join('.') === key.parts.join('.'),
      `${err}; guard saw ${g ? `${g.action} ${g.key.type} ${g.key.parts.join('.')}` : 'nothing'}`);
  }
  // Who is writing: a person by default, an agent inside an MCP tool call (mcp/agentOrigin.ts wraps every tool).
  seen.length = 0;
  await p.savePage({ pnlName: 'JOB_DATA1' } as never).catch(() => undefined);
  await runAsAgent(() => p.savePage({ pnlName: 'JOB_DATA1' } as never)).catch(() => undefined);
  check('the guard knows a person\'s write from an agent\'s', seen.map((w) => w.origin).join() === 'user,agent', seen.map((w) => w.origin).join());
  // Creates and dry runs are not guarded: a new definition has no owner, a preview writes nothing.
  seen.length = 0;
  await p.saveMenuDocument({ doc: { name: 'ZZ_X' }, openedToken: 'absent', operatorId: op, dryRun: true } as never).catch(() => undefined);
  check('a dry run / create is not guarded', seen.length === 0);
  const [{ V: sysAfter }] = await q(`SELECT SUM(VERSION) V FROM PSVERSION`);
  check('nothing was written: PSVERSION unchanged', Number(sysAfter) === Number(sysBefore), `${sysBefore} -> ${sysAfter}`);
} catch (error) {
  failed++;
  console.log('FAIL (threw)', error);
} finally {
  setWriteGuard(undefined);
}

console.log(`\n${passed} passed, ${failed} failed.`);
await raw.close();
await p.disconnect?.();
process.exit(failed ? 1 : 0);
