/** Independent read-only acceptance. Never approves, stages, applies or submits a process. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DatabaseProvider } from '../../../src/providers/database.js';
import { makeKey, DefinitionType } from '../../../src/model/definitions.js';
import { approvalHash, hash, planHash } from '../../../src/changeReview/model.js';
import { diffSpec } from '../../../src/model/aeSpec.js';
import { processEdit, processToken } from '../../../src/model/processEdit.js';
import { prepareSqlText } from '../../../src/providers/sqlWriter.js';
import { sample } from '../request-file/sample.mjs';

const agent = process.argv[2];
assert.ok(['codex', 'claude'].includes(agent), 'Usage: verify.mts codex|claude [native-process-instance]');
const supplied = process.argv[3], instance = supplied ? Number(supplied) : undefined;
assert.ok(!supplied || Number.isSafeInteger(instance) && instance! > 0, 'The native process instance must be a positive integer.');
const prepared = JSON.parse(await readFile('/tmp/psft-build-handoff-acceptance.json', 'utf8'));
const entry = prepared.requests.find((r: any) => r.agent === agent); assert.ok(entry);
const { requestId, prefix, program, project } = entry;
assert.match(program, /^ZZ_B[CL]_EXPORT$/); assert.equal(project, prefix + 'PRJ');
let sequence = 0;
const endpoint = process.env.PSFT_HANDOFF_MCP_URL ?? 'http://127.0.0.1:7337/mcp';
const endpointUrl = new URL(endpoint);
assert.ok(endpointUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpointUrl.hostname) && endpointUrl.pathname === '/mcp' && !endpointUrl.username && !endpointUrl.password);
async function read(tool: string, args: object): Promise<any> {
  assert.ok(['psft_build_request_get', 'psft_get_change_set', 'psft_get_object_timeline', 'psft_project_related'].includes(tool));
  const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name: tool, arguments: args } }) });
  const text = await response.text(), rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data:'))!.slice(5));
  assert.ok(!rpc.error && !rpc.result?.isError, rpc.error?.message ?? rpc.result?.content?.[0]?.text);
  return JSON.parse(rpc.result.content[0].text);
}
const request = await read('psft_build_request_get', { id: requestId });
const raw = JSON.parse(await readFile(`/home/noodlesploder/.config/Code/User/globalStorage/jarednorris.peoplesoft-studio/build-requests/${requestId}/request.json`, 'utf8'));
const handoff = raw.handoffs.filter((h: any) => h.agent === agent && h.phase === 'build').at(-1);
const blockers: string[] = [];
if (!request.buildAuthorized) blockers.push('Developer spec approval is pending.');
if (!handoff) blockers.push('No installed build-phase handoff has been requested for this client.');
const objects = request.spec.objects.filter((o: any) => o.action !== 'reuse');
for (const o of objects) if (o.progress.status !== 'BUILT') blockers.push(`${o.ref}: ${o.progress.status}`);
const report: Record<string, any> = { checkedAt: new Date().toISOString(), agent, requestId, program, project,
  specRevision: request.spec.revision, buildAuthorized: request.buildAuthorized, handoffRequested: handoff ?? null,
  metadataVerified: false, runtimeVerified: false, postingVerified: false, blockers };
const reportPath = `tools/lab/results/build-handoff-${agent}-native-2026-10-20.json`;
let p: DatabaseProvider | undefined;
try {
  if (blockers.length) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    assert.equal(request.spec.revision, entry.specRevision, 'The native trial must match the prepared reviewed spec.');
    assert.equal(request.spec.hash, entry.specHash);
    const linked = [...new Set(objects.filter((o: any) => o.ref !== 'scheduler').map((o: any) => o.progress.changeSetId))];
    assert.equal(linked.length, 1, 'All four metadata definitions must retain one coherent reviewed Change Set.');
    assert.equal(typeof linked[0], 'string');
    const set = await read('psft_get_change_set', { changeSetId: linked[0] });
    assert.equal(set.status, 'APPLIED'); assert.equal(set.requestKey, requestId); assert.equal(set.environment.connection, 'oracle:HRDMO');
    if (set.plan) { assert.equal(set.plan.review, 'APPROVED'); assert.equal(set.plan.approvedHash, planHash(set)); }
    assert.deepEqual(set.objects.map((c: any) => [c.adapter, c.key]), [['record-create', prefix + 'AET'], ['sql', prefix + 'ROWS'], ['ae-create', program], ['project-create', project]]);
    for (const c of set.objects) {
      assert.equal(c.operation, 'CREATE'); assert.equal(c.review, 'APPROVED'); assert.equal(c.application, 'VERIFIED');
      assert.equal(c.before, hash(null)); assert.equal(c.approvedHash, approvalHash(set, c)); assert.equal(c.verified, c.after);
      assert.equal(set.checkpoint.objects.find((cp: any) => cp.id === c.id)?.snapshot, c.before);
      const timeline = await read('psft_get_object_timeline', { changeSetId: set.id, objectId: c.id, checkLive: true });
      assert.equal(timeline.live.status, 'MATCHES_RECORDED');
      const current = timeline.revisions.find((r: any) => r.id === timeline.live.matched); assert.equal(current?.snapshot, c.after); assert.equal(current?.token, c.verifiedToken);
    }
    p = new DatabaseProvider({ name: 'HRDMO handoff native acceptance', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo',
      user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
    await p.connect();
    const fixture = await sample(), replace = (s: string) => s.replaceAll('ZZ_RF_', prefix);
    const record = await p.readRecordLayout(makeKey(DefinitionType.Record, prefix + 'AET'));
    assert.ok(record); assert.equal(record.recordType, 2); assert.deepEqual(record.fields.map(f => f.name), ['PROCESS_INSTANCE', 'DESCR']);
    const sql = await p.readSqlForMigration(makeKey(DefinitionType.SqlDefinition, prefix + 'ROWS', '0'));
    assert.equal(sql?.data.text, prepareSqlText(replace(fixture.sql)));
    const ae = await p.readAppEngineDocument(program); assert.ok(ae);
    assert.deepEqual(diffSpec(ae.doc, JSON.parse(replace(JSON.stringify(fixture.ae)))), []);
    const closure = await read('psft_project_related', { connection: 'HRDMO', project }); assert.equal(closure.missing, 0);
    const processDoc = await p.readProcessDocument(makeKey(DefinitionType.ProcessDefinition, 'Application Engine', program));
    const edit = processEdit(processDoc);
    assert.equal(edit.properties.DESCR, 'Synthetic handoff CSV'); assert.equal(edit.properties.RESTARTENABLED, '0');
    assert.deepEqual(edit.components, ['AE_REQUEST']); assert.deepEqual(edit.groups, ['TLSALL']);
    for (const name of ['SERVERNAME', 'RECURNAME', 'CMDLINE', 'PARMLIST', 'WORKINGDIR', 'OUTDEST']) assert.equal(edit.properties[name] ?? '', '', name + ' must not introduce a scheduler override.');
    report.metadataVerified = true; report.changeSet = { id: set.id, revision: set.revision, objects: set.objects.map((c: any) => ({ adapter: c.adapter, key: c.key, hash: c.verified, token: c.verifiedToken })) };
    report.process = { token: processToken(processDoc), input: edit }; report.closure = closure;
    if (instance) {
      const run = await p.runReadOnlyQuery(`SELECT PRCSINSTANCE, PRCSNAME, SERVERNAMERUN, RUNSTATUS, PRCSRTNCD, DISTSTATUS, RUNCNTLID FROM PSPRCSQUE WHERE PRCSINSTANCE = ${instance} AND PRCSNAME = '${program}'`);
      assert.equal(run.rows.length, 1); const native = run.rows[0];
      assert.equal(String(native.RUNSTATUS), '9'); assert.equal(Number(native.PRCSRTNCD), 0);
      const labels = await p.runReadOnlyQuery("SELECT FIELDVALUE, XLATLONGNAME FROM PSXLATITEM WHERE FIELDNAME='DISTSTATUS' AND EFF_STATUS='A' ORDER BY EFFDT DESC");
      const label = labels.rows.find(r => String(r.FIELDVALUE).trim() === String(native.DISTSTATUS).trim());
      report.distribution = { value: native.DISTSTATUS, label: label?.XLATLONGNAME };
      report.postingVerified = String(native.DISTSTATUS) === '5';
      if (!report.postingVerified) report.blockers.push(`Report posting incomplete: ${String(label?.XLATLONGNAME ?? native.DISTSTATUS).trim()}.`);
      assert.equal(String(native.SERVERNAMERUN).trim(), 'HCMDMO'); assert.equal(String(native.RUNCNTLID).trim(), prefix + 'ACC01');
      const posted = await p.runReadOnlyQuery(`SELECT CONTENTID, DISTSTATUS, OUTPUTDIR FROM PS_CDM_LIST WHERE PRCSINSTANCE=${instance}`);
      assert.equal(posted.rows.length, 1);
      const row = posted.rows[0], relative = String(row.OUTPUTDIR);
      assert.match(relative, /^HRDMO\/\d{8}\/\d+$/);
      const directory = report.postingVerified ? '/opt/psoft/hcm/ps_cfg_home/' + relative : `/opt/nginx/shared/reports/HCMDMO/AE_${program}_${instance}`;
      if (report.postingVerified) assert.equal(String(row.DISTSTATUS), '5');
      const remote = (filename: string): Promise<Buffer> => new Promise((resolve, reject) => {
        const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'gundam-server-01',
          ...(report.postingVerified ? ['ssh', '-o', 'BatchMode=yes', 'ps_hcm@192.168.122.151'] : []), 'cat', '--', directory + '/' + filename];
        execFile('ssh', args, { encoding: 'buffer', maxBuffer: 2_000_000, timeout: 15000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
      });
      const output = await remote(program + '.csv'), stdout = await remote(`AE_${program}_${instance}.stdout`);
      assert.ok(!output.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(output);
      assert.equal(text.replace(/\r\n/g, '\n'), fixture.expected); assert.ok(!/\r(?!\n)/.test(text));
      assert.ok(stdout.toString('utf8').includes(program + ': accepted=3 rejected=1 total=30.75'));
      assert.match(stdout.toString('utf8'), /ended normally/i);
      const control = await p.runReadOnlyQuery(`SELECT PROCESS_FREQUENCY FROM PS_AEREQUESTTBL WHERE OPRID = 'JARED' AND AE_APPLID = '${program}'`);
      assert.ok(control.rows.length && control.rows.every(r => String(r.PROCESS_FREQUENCY).trim() === 'O'), 'Restore the lab run-control frequency to Once.');
      const checksum = (data: Buffer) => createHash('sha256').update(data).digest('hex');
      report.runtimeVerified = true; report.nativeProcess = native;
      report.output = { directory, file: program + '.csv', bytes: output.length, sha256: checksum(output), matchesExpected: true, utf8WithoutBom: true };
      report.stdout = { sha256: checksum(stdout), expectedSummaryPresent: true, endedNormally: true };
      await writeFile(`tools/lab/results/build-handoff-${agent}-${instance}.csv`, output);
      await writeFile(`tools/lab/results/build-handoff-${agent}-${instance}.stdout`, stdout);
    } else report.blockers.push('Native Process Scheduler execution/output verification is pending.');
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error); throw error;
} finally {
  await mkdir('tools/lab/results', { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); await p?.dispose();
}
