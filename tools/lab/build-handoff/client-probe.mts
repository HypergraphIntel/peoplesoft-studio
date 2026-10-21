/** Real configured CLI clients, read-only RPC proxy, installed request data. Not installed-button/build/runtime acceptance. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentLaunch } from '../../../src/buildRequest/handoff.js';
import { newRequest } from '../../../src/buildRequest/model.js';

const prepared = JSON.parse(await readFile('/tmp/psft-build-handoff-acceptance.json', 'utf8'));
const selected = process.argv[2];
assert.ok(!selected || ['codex', 'claude'].includes(selected), 'Optional argument: codex | claude.');
const reportPath = 'tools/lab/results/build-handoff-clients-2026-10-20.json';
const directory = await mkdtemp(path.join(tmpdir(), 'psft-handoff-client-'));
const allowedIds = new Set(prepared.requests.map((r: { requestId: string }) => r.requestId));
const reads: { id: string; buildAuthorized: boolean; at: string }[] = [];
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    let text = ''; for await (const data of request) text += data;
    const rpc = JSON.parse(text);
    const allowed = ['initialize', 'notifications/initialized', 'ping', 'tools/list'].includes(rpc.method)
      || rpc.method === 'tools/call' && rpc.params?.name === 'psft_build_request_get' && allowedIds.has(rpc.params?.arguments?.id);
    if (!allowed) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Read-only launch probe permits only the prepared request get tool.' } })); return; }
    const upstream = await fetch('http://127.0.0.1:7337/mcp', { method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: text });
    const body = await upstream.text();
    if (!body) { response.writeHead(upstream.status); response.end(); return; }
    const result = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data:'))!.slice(5));
    if (rpc.method === 'tools/list') result.result.tools = result.result.tools.filter((t: { name: string }) => t.name === 'psft_build_request_get');
    if (rpc.method === 'tools/call' && !result.result?.isError) {
      const r = JSON.parse(result.result.content[0].text); reads.push({ id: r.id, buildAuthorized: r.buildAuthorized, at: new Date().toISOString() });
    }
    response.writeHead(upstream.status, { 'content-type': 'application/json' }); response.end(JSON.stringify(result));
  } catch { response.writeHead(502); response.end('Read-only probe could not reach the installed Studio server.'); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address === 'object');
const endpoint = `http://127.0.0.1:${address.port}/mcp`;
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (key.startsWith('CODEX_') || key.startsWith('VSCODE_') || key === 'ELECTRON_RUN_AS_NODE') delete environment[key];
const report: { checkedAt: string; scope: string; clients: object[]; passed?: boolean } = {
  checkedAt: new Date().toISOString(), scope: 'Real installed CLI routing/read-only approval refusal using a per-session endpoint override; no installed button, review application or runtime claim', clients: [] };
if (selected) {
  const prior = JSON.parse(await readFile(reportPath, 'utf8').catch(() => '{"clients":[]}'));
  report.clients = prior.clients.filter((client: any) => client.agent !== selected);
}
try {
  for (const entry of prepared.requests.filter((entry: any) => !selected || entry.agent === selected)) {
    const r = newRequest(entry.requestId, new Date().toISOString());
    const launch = agentLaunch(r, 'build', entry.agent, endpoint);
    launch.args[launch.args.length - 1] += ' This is a read-only launch probe. Call that get tool once, report whether buildAuthorized is false, then stop. Do not analyze, propose, ask questions, write files or change PeopleSoft.';
    const args = entry.agent === 'codex'
      ? ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--config', 'mcp_servers.node_repl.enabled=false', ...launch.args]
      : ['--print', '--verbose', '--output-format', 'stream-json', '--strict-mcp-config', '--allowedTools', 'mcp__peoplesoftStudio__psft_build_request_get', ...launch.args];
    console.log('Starting configured ' + entry.agent + ' read-only CLI routing probe.');
    const child = spawn(launch.command, args, { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { error += String(data); });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    await writeFile(path.join(directory, entry.agent + '.jsonl'), output, { mode: 0o600 });
    await writeFile(path.join(directory, entry.agent + '.stderr'), error, { mode: 0o600 });
    const received = reads.filter(read => read.id === entry.requestId);
    const passed = code === 0 && received.length > 0 && received.every(read => read.buildAuthorized === false);
    report.clients.push({ agent: entry.agent, requestId: entry.requestId, exitCode: code, observedGetCalls: received.length,
      buildAuthorized: received[0]?.buildAuthorized ?? null, observedAt: received.at(-1)?.at ?? null, passed, privateTranscript: path.join(directory, entry.agent + '.jsonl') });
    console.log(JSON.stringify(report.clients.at(-1)));
  }
  report.passed = report.clients.every((client: any) => client.passed);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await mkdir('tools/lab/results', { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
assert.equal(report.passed, true, 'A configured CLI probe failed; inspect only its private transcript and preserve the unapproved requests.');
