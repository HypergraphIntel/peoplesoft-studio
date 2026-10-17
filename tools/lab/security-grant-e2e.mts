/*
 * psft_security_grant's writer on HRDMO, as a preview: grant permission list PTPT1000 the pages of lab component
 * ZZ_PCODE_LAB_CMP (registered on ZZ_PCODE_LAB_MENU) and process group HRALL, then roll back (dryRun). Checks the
 * would-be rows -- AUTHORIZEDACTIONS the component's ACTIONS mask, one row per page item -- the version it would
 * stamp (PSVERSION CLM + 1), and that nothing persists: no rows, counters and the permission list unchanged.
 *
 * HRDMO only; nothing is committed.
 *
 *   npx tsx tools/lab/security-grant-e2e.mts
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_PCODE_LAB');
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const q1 = async (sql: string, b: Record<string, unknown> = {}) => ((await raw.execute(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Array<Record<string, unknown>>;
const state = async () => JSON.stringify([
  await q1("SELECT 'V' K, OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('CLM','SYS') UNION ALL SELECT 'L', OBJECTTYPENAME, VERSION FROM PSLOCK WHERE OBJECTTYPENAME='CLM' ORDER BY 1, 2"),
  await q1("SELECT VERSION, LASTUPDOPRID, LASTUPDDTTM FROM PSCLASSDEFN WHERE CLASSID='PTPT1000'"),
  await q1("SELECT COUNT(*) N FROM PSAUTHITEM WHERE CLASSID='PTPT1000'"), await q1("SELECT COUNT(*) N FROM PSAUTHPRCS WHERE CLASSID='PTPT1000'")]);

check('permission list PTPT1000 exists', (await q1("SELECT 1 FROM PSCLASSDEFN WHERE CLASSID='PTPT1000'")).length === 1);
const before = await state();
const [comp] = await q1("SELECT ACTIONS FROM PSPNLGRPDEFN WHERE PNLGRPNAME='ZZ_PCODE_LAB_CMP' AND MARKET='GBL'");
const pageItems = (await q1("SELECT ITEMNAME FROM PSPNLGROUP WHERE PNLGRPNAME='ZZ_PCODE_LAB_CMP' AND MARKET='GBL' ORDER BY SUBITEMNUM")).map((r) => String(r.ITEMNAME).trim());
const [clm] = await q1("SELECT VERSION FROM PSVERSION WHERE OBJECTTYPENAME='CLM'");
const r = await p.grantPermissionListAccess({ classId: 'PTPT1000', components: [{ menu: 'ZZ_PCODE_LAB_MENU', component: 'ZZ_PCODE_LAB_CMP', market: 'GBL' }],
  processGroups: ['HRALL'], operatorId, scopeNames: ['ZZ_PCODE_LAB_CMP'], dryRun: true });
check('one row per page item', JSON.stringify(r.pages.map((x) => x.page)) === JSON.stringify(pageItems), `${r.pages.map((x) => x.page)} vs ${pageItems}`);
check('actions are the component mask (Full Access)', r.pages.every((x) => x.actions === Number(comp.ACTIONS)), `${r.pages.map((x) => x.actions)} vs ${comp.ACTIONS}`);
check('menu item resolved', r.pages.every((x) => x.bar === 'USE' && x.item === 'ZZ_LAB_ITEM'));
check('process group inserted', r.processGroups.length === 1 && r.processGroups[0].group === 'HRALL');
check('would stamp PSVERSION CLM + 1', r.version === Number(clm.VERSION) + 1, `${r.version} vs ${Number(clm.VERSION) + 1}`);
check('nothing persisted (rows, counters, stamp)', (await state()) === before);
await p.dispose?.();
await raw.close();
console.log(JSON.stringify({ contentReferences: r.contentReferences }));
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
