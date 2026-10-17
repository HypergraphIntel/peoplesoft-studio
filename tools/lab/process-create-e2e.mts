/*
 * psft_process_create's writer on HRDMO, as a preview: createProcess's Add-mode row plus the proven save run in one
 * transaction and roll back (dryRun). The would-be row is compared column by column with a delivered Application
 * Engine definition (BDG_ASSIGN, saved through PIA): everything but identity, description, groups and the save
 * stamp must match. Nothing is committed; the script then checks that no row persists.
 *
 * HRDMO only; process ZZ_PRCS_E2E only.
 *
 *   npx tsx tools/lab/process-create-e2e.mts
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_PRCS_E2E');
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const q1 = async (sql: string, b: Record<string, unknown> = {}) => ((await raw.execute(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Array<Record<string, unknown>>;
const counters = async () => JSON.stringify(await q1("SELECT 'V' K, OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('PPC','SYS') UNION ALL SELECT 'L', OBJECTTYPENAME, VERSION FROM PSLOCK WHERE OBJECTTYPENAME='PPC' ORDER BY 1, 2"));

check('no ZZ_PRCS_E2E before', !(await q1("SELECT 1 FROM PS_PRCSDEFN WHERE PRCSNAME='ZZ_PRCS_E2E'")).length);
const before = await counters();
const view = await p.createProcessDocument({ processType: 'Application Engine', name: 'ZZ_PRCS_E2E', properties: { DESCR: 'Studio create preview' },
  components: [], groups: ['HRALL'], operatorId, dryRun: true });
const [delivered] = await q1("SELECT * FROM PS_PRCSDEFN WHERE PRCSTYPE='Application Engine' AND PRCSNAME='BDG_ASSIGN'");
const skip = new Set(['PRCSNAME', 'DESCR', 'DESCRLONG', 'VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID', 'LASTUPD']);
const diffs = Object.keys(delivered).filter((k) => !skip.has(k) && JSON.stringify(view.process[k]) !== JSON.stringify(delivered[k]))
  .map((k) => `${k}: ${JSON.stringify(view.process[k])} vs delivered ${JSON.stringify(delivered[k])}`);
check('preview row matches a delivered AE definition in every non-identity column', diffs.length === 0, diffs.join('; '));
check('preview description and group', view.process.DESCR === 'Studio create preview' && view.groups.map((g) => String(g.PRCSGRP).trim()).join() === 'HRALL');
check('preview stamped by the operator', String(view.process.LASTUPDOPRID).trim() === operatorId);
check('nothing persisted', !(await q1("SELECT 1 FROM PS_PRCSDEFN WHERE PRCSNAME='ZZ_PRCS_E2E' UNION ALL SELECT 1 FROM PS_PRCSDEFNGRP WHERE PRCSNAME='ZZ_PRCS_E2E'")).length);
check('counters unchanged after rollback', (await counters()) === before);
await p.dispose?.();
await raw.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
