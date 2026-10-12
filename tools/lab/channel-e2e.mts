/*
 * The message channel path end to end on HRDMO (what the Message Channel
 * window and psft_channel_create / edit / copy / rename / delete run): a
 * channel created with App Designer's defaults and one from a spec, a lab
 * message staged on a channel so its window lists that message's fields,
 * edits by operations, a project item, Save As, Rename (the message and the
 * project item repointed) and Delete -- each saved through DatabaseProvider
 * and read back against App Designer's rules (docs/MESSAGE_CHANNELS.md).
 *
 * WRITES. HRDMO only; channels ZZ_CHNL_E2E*, the staged message
 * ZZ_CHNL_E2E_MSG and project ZZ_PCODE_LAB_MCPPRJ's channel items only.
 * Leaves ZZ_CHNL_E2E0 (App Designer's defaults) and ZZ_CHNL_E2E4 (with the
 * staged message) for App Designer to open; `--cleanup` removes everything.
 *
 *   npx tsx tools/lab/channel-e2e.mts [--cleanup]
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import { applyChannelOperation, diffChannelSpec, documentFromSpec, type ChannelSpec } from '../../src/model/channelOperations';
import { copyChannel, validateChannel } from '../../src/model/channelDocument';
import { DefinitionType, makeKey } from '../../src/model/definitions';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const MSG = 'ZZ_CHNL_E2E_MSG';
const PROJECT = 'ZZ_PCODE_LAB_MCPPRJ';
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB];
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const q = async (sql: string, b: Record<string, unknown> = {}) => ((await raw.execute(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Array<Record<string, unknown>>;
const w = async (sql: string, b: Record<string, unknown> = {}) => { await raw.execute(sql, b, { autoCommit: true }); };
const counters = async () => Object.fromEntries((await q(`SELECT OBJECTTYPENAME T, VERSION V FROM PSVERSION WHERE OBJECTTYPENAME IN ('CHDM','MSDM','PJM','SYS')`)).map((r) => [String(r.T).trim(), Number(r.V)]));
const row = async (name: string) => (await q(`SELECT * FROM PSCHNLDEFN WHERE CHNLNAME = :c`, { c: name }))[0];
const parts = async (name: string) => (await q(`SELECT FIELDNAME F FROM PSSUBCHNL WHERE CHNLNAME = :c ORDER BY FIELDNAME`, { c: name })).map((r) => String(r.F).trim()).join(',');

async function cleanup(): Promise<void> {
  setWriteNamePrefix('ZZ_');
  for (const c of (await q(`SELECT CHNLNAME FROM PSCHNLDEFN WHERE CHNLNAME LIKE 'ZZ\\_CHNL\\_E2E%' ESCAPE '\\'`)).map((r) => String(r.CHNLNAME).trim())) {
    const r = await p.readChannelDocument(c);
    if (r) await p.deleteChannelDefinition(c, r.token, operatorId);
  }
  await w(`DELETE FROM PSCHNLDEL WHERE CHNLNAME LIKE 'ZZ\\_CHNL\\_E2E%' ESCAPE '\\'`);
  for (const t of ['PSMSGREC', 'PSMSGVER', 'PSMSGDEFN']) await w(`DELETE FROM ${t} WHERE MSGNAME = :m`, { m: MSG });
  await w(`DELETE FROM PSPROJECTITEM WHERE PROJECTNAME = :p AND OBJECTTYPE = 36`, { p: PROJECT });
}

await cleanup();
if (process.argv.includes('--cleanup')) { console.log('cleaned up'); process.exit(0); }

try {
  // 1. File > New, saved at once: App Designer's defaults [chn00].
  let c0 = await counters();
  const plain = await p.newChannelDocument('ZZ_CHNL_E2E0');
  const s0 = await p.saveChannelDocument({ doc: plain, openedToken: 'absent', operatorId });
  let c1 = await counters();
  const r0 = await row('ZZ_CHNL_E2E0');
  check('new channel: App Designer\'s defaults', s0.written && [r0.CHNLSTATUS, r0.PUBTIMEOUTMIN, r0.SUBTIMEOUTMIN, r0.PUBRETRYSEC, r0.SUBRETRYSEC, r0.ERRORTHRESHOLD, r0.APMSGARCHIVE, r0.THRUPUTTYPE, r0.QUALITYOFSERVICE].join() === '0,14400,14400,300,300,100,1,0,1'
    && r0.CHNLDISPLAYNAME === 'ZZ_CHNL_E2E0' && r0.DESCR === ' ' && r0.DESCRLONG === null, JSON.stringify(r0));
  check('new channel: CHDM and SYS + 1, VERSION the new CHDM', c1.CHDM === c0.CHDM + 1 && c1.SYS === c0.SYS + 1 && c1.MSDM === c0.MSDM && Number(r0.VERSION) === c1.CHDM, JSON.stringify({ c0, c1, v: r0.VERSION }));
  const lock = (await q(`SELECT VERSION V FROM PSLOCK WHERE OBJECTTYPENAME = 'CHDM'`))[0];
  check('PSLOCK CHDM set to PSVERSION CHDM', Number(lock.V) === c1.CHDM, JSON.stringify(lock));

  // 2. From a spec: properties (Pause, Unordered) and a partition field added.
  const spec: ChannelSpec = { channel: 'ZZ_CHNL_E2E1', description: 'Channel end to end', comments: 'Made by channel-e2e', status: 'pause', unordered: true, partitions: ['emplid'] };
  const fresh = await p.newChannelDocument('ZZ_CHNL_E2E1');
  const doc1 = documentFromSpec(spec, fresh.messages, fresh.partitions.map((x) => x.field));
  check('spec validates', validateChannel(doc1).every((d) => d.severity !== 'error'), JSON.stringify(validateChannel(doc1)));
  await p.saveChannelDocument({ doc: doc1, openedToken: 'absent', operatorId });
  const r1 = await row('ZZ_CHNL_E2E1');
  check('spec channel: status 2, unordered 1, archive 1, comments', [r1.CHNLSTATUS, r1.THRUPUTTYPE, r1.APMSGARCHIVE].join() === '2,1,1' && r1.DESCRLONG === 'Made by channel-e2e', JSON.stringify(r1));
  check('spec channel: partitioned by EMPLID', (await parts('ZZ_CHNL_E2E1')) === 'EMPLID', await parts('ZZ_CHNL_E2E1'));
  let read = (await p.readChannelDocument('ZZ_CHNL_E2E1'))!;
  check('no messages: no fields listed, EMPLID dropped on open (as App Designer)', read.doc.partitions.length === 0 && read.doc.dropped.join() === 'EMPLID', JSON.stringify(read.doc.partitions) + JSON.stringify(read.doc.dropped));

  // 3. A message on the channel: the window lists its level-0 record's fields (Long ones left out), then the standard four.
  await w(`INSERT INTO PSMSGDEFN SELECT :m, VERSION, XMLALIAS, 'ZZ_CHNL_E2E1', DEFAULTVER, MSGSTATUS, NONREPUDIATION, VALIDATESTRUCT, ERRPROCMODE, MENUNAME, BARNAME, BARITEMNAME, PNLITEMNAME,
            ACTIONS, USEEDIT, :m, 'Channel e2e message', OBJECTOWNERID, LASTUPDDTTM, LASTUPDOPRID, DESCRLONG FROM PSMSGDEFN WHERE MSGNAME = 'ZZ_PCODE_LAB_MSG'`, { m: MSG });
  await w(`INSERT INTO PSMSGVER SELECT :m, APMSGVER, IB_MSGTYPE, IB_MSGSCHEMA, IB_PARTS, IB_NOTUPGRADE, IB_PARTDFLTIND, IB_EXCLDESCSCHMA, IB_OCCUROVRD, IB_MESSAGEUSE, IB_INC_NAMESPACE,
            IB_SUPPRESSTAGS, IB_PACKAGEID, IB_SCHEMANAME, IB_VARIANTNAME, IB_ROOTELEMENT, IB_ADS_NAME, IB_LANGCODE FROM PSMSGVER WHERE MSGNAME = 'ZZ_PCODE_LAB_MSG'`, { m: MSG });
  await w(`INSERT INTO PSMSGREC SELECT :m, APMSGVER, 'ZZ_PCODE_LAB_R6', PRNTRECNAME, SEQNO, IB_MSGNAME, IB_MSGVERSION, 'ZZ_PCODE_LAB_R6', IB_SCHEMAMIN, IB_SCHEMAMAX
            FROM PSMSGREC WHERE MSGNAME = 'ZZ_PCODE_LAB_MSG' AND PRNTRECNAME = '--'`, { m: MSG });
  read = (await p.readChannelDocument('ZZ_CHNL_E2E1'))!;
  const listed = read.doc.partitions.map((x) => x.field).join(',');
  const expected = 'ZZ_PCODE_LAB_KEY,ZZ_PCODE_LAB_N1,ZZ_PCODE_LAB_N2,ZZ_PCODE_LAB_N3,ZZ_PCODE_LAB_N4,ZZ_PCODE_LAB_S1,ZZ_PCODE_LAB_S2,ZZ_PCODE_LAB_D1,ZZ_PCODE_LAB_T1,ZZ_PCODE_LAB_DT,ZZ_PCODE_LAB_C08,MSGNAME,MSGNAMEDETAIL,PUBLISHER,PUBPROC';
  check('the window\'s list: R6 fields without L1 / L2, then the standard four (as App Designer listed CHN5)', listed === expected, listed);
  check('the window lists the message', read.doc.messages.join() === MSG, read.doc.messages.join());

  // 4. Edit: Run, archive off, ordered; partition by two listed fields. The dropped EMPLID is deleted, as App Designer's save does.
  let edited = read.doc;
  for (const o of [
    { op: 'set_channel', status: 'run', archive: false, unordered: false } as const,
    { op: 'check_partition', field: 'ZZ_PCODE_LAB_KEY', checked: true } as const,
    { op: 'check_partition', field: 'PUBLISHER', checked: true } as const
  ]) edited = applyChannelOperation(edited, o);
  c0 = await counters();
  const e = await p.saveChannelDocument({ doc: edited, openedToken: read.token, operatorId });
  c1 = await counters();
  const r1e = await row('ZZ_CHNL_E2E1');
  check('edit: status 1, archive 0, ordered 2', [r1e.CHNLSTATUS, r1e.APMSGARCHIVE, r1e.THRUPUTTYPE].join() === '1,0,2', JSON.stringify(r1e));
  check('edit: partitions as checked, EMPLID gone', (await parts('ZZ_CHNL_E2E1')) === 'PUBLISHER,ZZ_PCODE_LAB_KEY', await parts('ZZ_CHNL_E2E1'));
  check('edit: CHDM and SYS + 1', e.plan.increments.CHDM === 1 && c1.CHDM === c0.CHDM + 1 && c1.SYS === c0.SYS + 1 && Number(r1e.VERSION) === c1.CHDM, JSON.stringify({ inc: e.plan.increments, c0, c1 }));
  read = (await p.readChannelDocument('ZZ_CHNL_E2E1'))!;
  check('reads back checked', read.doc.partitions.filter((x) => x.checked).map((x) => x.field).sort().join() === 'PUBLISHER,ZZ_PCODE_LAB_KEY' && read.doc.dropped.length === 0);
  const stale = await p.saveChannelDocument({ doc: edited, openedToken: e.token === read.token ? 'stale-token' : read.token, operatorId }).then(() => 'saved', (err: Error) => err.message);
  check('a stale token is refused', /changed in the database/.test(stale), stale);

  // 5. Project item, then Save As and Rename (the message and the project item repointed), then Delete.
  await p.saveProject({ project: PROJECT, operatorId, add: [makeKey(DefinitionType.MessageChannel, 'ZZ_CHNL_E2E1')] });
  const item = (await q(`SELECT * FROM PSPROJECTITEM WHERE PROJECTNAME = :p AND OBJECTTYPE = 36`, { p: PROJECT }))[0];
  check('project item: 36 / 61 with App Designer\'s statuses [chn16]', !!item && Number(item.OBJECTID1) === 61 && [item.NODETYPE, item.SOURCESTATUS, item.TARGETSTATUS, item.UPGRADEACTION, item.TAKEACTION, item.COPYDONE].join() === '0,0,0,0,1,0', JSON.stringify(item));

  await p.saveChannelDocument({ doc: copyChannel(read.doc, 'ZZ_CHNL_E2E2'), openedToken: 'absent', operatorId });
  const r2 = await row('ZZ_CHNL_E2E2');
  check('Save As: properties and partitions copied', r2.DESCR === 'Channel end to end' && r2.CHNLDISPLAYNAME === 'ZZ_CHNL_E2E2' && (await parts('ZZ_CHNL_E2E2')) === 'PUBLISHER,ZZ_PCODE_LAB_KEY', JSON.stringify(r2));

  c0 = await counters();
  read = (await p.readChannelDocument('ZZ_CHNL_E2E1'))!;
  await p.renameChannelDefinition('ZZ_CHNL_E2E1', 'ZZ_CHNL_E2E4', read.token, operatorId);
  c1 = await counters();
  const r4 = await row('ZZ_CHNL_E2E4');
  const msg = (await q(`SELECT CHNLNAME, VERSION FROM PSMSGDEFN WHERE MSGNAME = :m`, { m: MSG }))[0];
  const moved = (await q(`SELECT OBJECTVALUE1 V FROM PSPROJECTITEM WHERE PROJECTNAME = :p AND OBJECTTYPE = 36`, { p: PROJECT }))[0];
  const proj = (await q(`SELECT VERSION V FROM PSPROJECTDEFN WHERE PROJECTNAME = :p`, { p: PROJECT }))[0];
  check('rename: CHDM MSDM PJM SYS + 1', ['CHDM', 'MSDM', 'PJM', 'SYS'].every((n) => c1[n] === c0[n] + 1), JSON.stringify({ c0, c1 }));
  check('rename: row re-keyed, display name and VERSION', !!r4 && r4.CHNLDISPLAYNAME === 'ZZ_CHNL_E2E4' && Number(r4.VERSION) === c1.CHDM && !(await row('ZZ_CHNL_E2E1')), JSON.stringify(r4));
  check('rename: partitions follow', (await parts('ZZ_CHNL_E2E4')) === 'PUBLISHER,ZZ_PCODE_LAB_KEY');
  check('rename: the message repointed, VERSION the new MSDM [chn17]', String(msg.CHNLNAME).trim() === 'ZZ_CHNL_E2E4' && Number(msg.VERSION) === c1.MSDM, JSON.stringify(msg));
  check('rename: the project item repointed, project VERSION the new PJM [chn17]', String(moved.V).trim() === 'ZZ_CHNL_E2E4' && Number(proj.V) === c1.PJM, JSON.stringify({ moved, proj }));
  check('rename: no tombstone', (await q(`SELECT * FROM PSCHNLDEL WHERE CHNLNAME = 'ZZ_CHNL_E2E1'`)).length === 0);

  c0 = await counters();
  const r2doc = (await p.readChannelDocument('ZZ_CHNL_E2E2'))!;
  await p.deleteChannelDefinition('ZZ_CHNL_E2E2', r2doc.token, operatorId);
  c1 = await counters();
  const tomb = await q(`SELECT VERSION V FROM PSCHNLDEL WHERE CHNLNAME = 'ZZ_CHNL_E2E2'`);
  check('delete: rows gone, PSCHNLDEL at the new CHDM, CHDM and SYS + 1 [chn08]', !(await row('ZZ_CHNL_E2E2')) && (await parts('ZZ_CHNL_E2E2')) === '' &&
    tomb.length === 1 && Number(tomb[0].V) === c1.CHDM && c1.CHDM === c0.CHDM + 1 && c1.SYS === c0.SYS + 1, JSON.stringify({ tomb, c0, c1 }));
  // Recreated under a deleted name: the tombstone goes.
  await p.saveChannelDocument({ doc: await p.newChannelDocument('ZZ_CHNL_E2E2'), openedToken: 'absent', operatorId });
  check('recreate removes PSCHNLDEL', (await q(`SELECT * FROM PSCHNLDEL WHERE CHNLNAME = 'ZZ_CHNL_E2E2'`)).length === 0);
  const r2b = (await p.readChannelDocument('ZZ_CHNL_E2E2'))!;
  await p.deleteChannelDefinition('ZZ_CHNL_E2E2', r2b.token, operatorId);
  const spec4 = diffChannelSpec((await p.readChannelDocument('ZZ_CHNL_E2E4'))!.doc, { channel: 'ZZ_CHNL_E2E4', description: 'Channel end to end', status: 'run', archive: false, unordered: false, partitions: ['ZZ_PCODE_LAB_KEY', 'PUBLISHER'] });
  check('ZZ_CHNL_E2E4 reads back as edited', spec4.length === 0, spec4.join('; '));
} catch (error) {
  failed++;
  console.log('FAIL (threw)', error);
}

console.log(`\n${passed} passed, ${failed} failed. Left for App Designer: ZZ_CHNL_E2E0, ZZ_CHNL_E2E4 (message ${MSG} on it).`);
await raw.close();
await p.disconnect?.();
process.exit(failed ? 1 : 0);
