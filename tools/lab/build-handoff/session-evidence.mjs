/** Extract a bounded, noncredential audit from the actual interactive CLI sessions. */
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
const window = JSON.parse(await readFile('/tmp/psft-build-handoff-window.json', 'utf8'));
const cases = [
  { agent: 'codex', pid: 2778570, requestId: 'br-b7ed22ea1caa', sessionId: '01a15a3a-80ef-7e23-b965-cde1f1f1da66', file: '/home/noodlesploder/.codex/sessions/2026/10/20/rollout-2026-10-20T11-52-25-01a15a3a-80ef-7e23-b965-cde1f1f1da66.jsonl' },
  { agent: 'claude', pid: 2779962, requestId: 'br-b6a1848629e9', sessionId: 'e1d279af-cfe9-483a-8c6d-7b91cdbe1690', file: '/home/noodlesploder/.claude/projects/-home-noodlesploder-repos-peoplesoft-studio/e1d279af-cfe9-483a-8c6d-7b91cdbe1690.jsonl' }
];
const clients = [];
for (const c of cases) {
  const argv = (await readFile(`/proc/${c.pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  assert.ok(argv.join(' ').includes(c.requestId) && argv.join(' ').includes(window.mcpUrl));
  const rows = (await readFile(c.file, 'utf8')).trim().split('\n').map(JSON.parse);
  let calls = [];
  if (c.agent === 'codex') calls = rows.filter(r => r.type === 'response_item' && r.payload?.type === 'custom_tool_call').map(r => ({ at: r.timestamp, input: r.payload.input }));
  else calls = rows.flatMap(r => Array.isArray(r.message?.content) ? r.message.content.filter(b => b.type === 'tool_use').map(b => ({ at: r.timestamp, input: b.name + '(' + JSON.stringify(b.input) + ')' })) : []);
  const observed = Object.fromEntries(['psft_build_request_get', 'psft_create_change_set', 'psft_set_change_plan', 'psft_stage_object_change', 'psft_validate_change_set', 'psft_build_request_report', 'psft_process_create', 'psft_process_get'].map(name => [name, calls.filter(r => r.input.includes('mcp__peoplesoftStudio__' + name + '(')).map(r => r.at)]));
  assert.ok(observed.psft_build_request_get.length && observed.psft_build_request_report.length && observed.psft_process_create.length);
  const request = JSON.parse(await readFile(`/home/noodlesploder/.config/Code/User/globalStorage/jarednorris.peoplesoft-studio/build-requests/${c.requestId}/request.json`, 'utf8'));
  assert.equal(request.approval.specRevision, 1);
  assert.ok(Object.values(request.progress).filter(p => p.status === 'BUILT').length >= 5);
  clients.push({ agent: c.agent, requestId: c.requestId, pid: c.pid, sessionId: c.sessionId,
    executable: argv[0], endpointOverrideVerified: true, approvedSpecRevision: request.approval.specRevision,
    approvedSpecHash: request.approval.specHash, handoff: request.handoffs.filter(h => h.agent === c.agent && h.phase === 'build').at(-1),
    observedCalls: observed, finalObjects: Object.entries(request.progress).map(([ref,p]) => ({ref,status:p.status,changeSetId:p.changeSetId})) });
}
const report = { checkedAt: new Date().toISOString(), scope: 'Actual installed Build buttons, real interactive CLI processes and request-linked reviewed creation; runtime evidence is in the independent native reports.',
  installedBundleSha256: window.bundleSha256, installedWorkerSha256: window.workerSha256,
  originalWindowReloaded: false, mcpUrl: window.mcpUrl, sharedRequestAndReviewStorage: true, clients };
await writeFile('tools/lab/results/build-handoff-installed-sessions-2026-10-20.json', JSON.stringify(report,null,2)+'\n');
for (const name of ['codex-spec-review','claude-spec-review','both-clients-launched']) await copyFile(window.dir+'/'+name+'.png','tools/lab/results/build-handoff-'+name+'.png');
console.log(JSON.stringify({ clients: clients.map(c => ({agent:c.agent,sessionId:c.sessionId,readCalls:c.observedCalls.psft_build_request_get.length,reportedObjects:c.finalObjects.length})), passed: true }));
