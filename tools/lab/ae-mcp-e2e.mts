/*
 * End-to-end: an agent's App Engine work through the PeopleSoft Studio MCP
 * server -- the real server (src/mcp/server.ts) over HTTP, as VS Code runs
 * it, on the HRDMO lab -- then the results read back from the database.
 *
 *   1. design and create a program that reads employee data, applies a rule in
 *      PeopleCode, writes a staging (temporary) table and commits at intervals;
 *   2. explain it, read it, preview an edit, edit it, verify it;
 *   3. refuse an invalid edit (SQL and Call Section in one step);
 *   4. copy a delivered complex program and change one step of the copy,
 *      leaving everything else as it was;
 *   5. copy, rename and delete a program.
 *
 * WRITES. HRDMO only, ZZ_AE_* programs only. Writes are "allow" (no VS Code
 * to ask); every write tool is still gated as in VS Code.
 *
 *   npx tsx tools/lab/ae-mcp-e2e.mts [--keep]
 */
import Module, { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const { createStub } = await import(pathToFileURL(join(root, 'scripts', 'vscode-stub.mjs')).href);
const { vscode, settings } = createStub();
const original = (Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'vscode') return vscode;
  return original.call(this, request, parent, isMain);
};
const require = createRequire(join(root, 'package.json'));

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
settings.set('peoplesoft.connections', [{
  name: 'HRDMO-E2E', kind: 'oracle', connectString, user: process.env.PSLAB_ACCESSID, peoplecodeAccess: 'writable',
  peoplesoftOperatorId: process.env.PSLAB_OPERATOR ?? 'JARED'
}]);
const secrets = new Map([['peoplesoft.password.HRDMO-E2E', process.env.PSLAB_ACCESSPSWD]]);
const { Workspace } = require('./src/workspace.ts');
const { startPeopleSoftMcpServer } = require('./src/mcp/server.ts');
const workspace = new Workspace({ get: async (k: string) => secrets.get(k), store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) });
const approvals: string[] = [];
const port = 39000 + Math.floor(Math.random() * 500);
const server = await startPeopleSoftMcpServer(workspace, {
  port,
  writeHost: () => ({
    mode: () => 'allow', confirm: async ({ title }: { title: string }) => { approvals.push(title); return true; },
    hasUnsavedEditor: () => false, saved: () => {}
  })
});

let id = 0;
async function rpc(method: string, params: unknown): Promise<unknown> {
  const res = await fetch(server.url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  });
  const text = await res.text();
  const data = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))!.slice(5));
  if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}
async function tool(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await rpc('tools/call', { name, arguments: { connection: 'HRDMO-E2E', ...args } }) as { content: { text: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text).join('\n');
  if (r.isError) return { error: text };
  try { return JSON.parse(text); } catch { return text; }
}

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };
const keep = process.argv.includes('--keep');

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ae-e2e', version: '1' } });
  const tools = await rpc('tools/list', {}) as { tools: { name: string }[] };
  const aeTools = tools.tools.map((t) => t.name).filter((n) => n.startsWith('psft_ae_'));
  check('the App Engine tools are listed', aeTools.length >= 11, aeTools.join(', '));
  await workspace.connect(workspace.connections[0]);
  for (const p of ['ZZ_AE_E2E1', 'ZZ_AE_E2E2', 'ZZ_AE_E2E3', 'ZZ_AE_CPLX']) {
    const got = await tool('psft_ae_get', { program: p, includeText: false });
    if (got.token) await tool('psft_ae_delete', { program: p, expectedToken: got.token });
  }

  // 1. Design and create.
  const reference = await tool('psft_ae_reference', {});
  check('the reference explains the runtime', typeof reference === 'string' && reference.includes('Restartable'));
  const spec = {
    program: 'ZZ_AE_E2E1', description: 'Employee staging (E2E)', comments: 'Built by the MCP end-to-end test.',
    stateRecords: [{ record: 'HR_HRWF0006_AET', default: true }], tempTables: ['ZZ_PCODE_TMP'], tempTableInstances: 2,
    sections: [
      {
        name: 'MAIN', description: 'Stage employees',
        steps: [
          { name: 'Init', description: 'Run control', actions: [
            { type: 'SQL', sql: "%Select(IF_FLAG) SELECT 'Y' FROM PS_INSTALLATION", noRows: 'Abort' }] },
          { name: 'Clear', description: 'Empty the staging table', actions: [
            { type: 'SQL', sql: '%TruncateTable(%Table(ZZ_PCODE_TMP))' }] },
          { name: 'Emps', description: 'Each employee', commitAfter: 'Default', frequency: 100, actions: [
            { type: 'Do Select', doSelectType: 'Restartable', sql: '%Select(EMPLID)\nSELECT EMPLID\n  FROM PS_PERSONAL_DATA\n ORDER BY EMPLID' },
            { type: 'PeopleCode', onReturn: 'Skip Step', peopleCode: 'If None(HR_HRWF0006_AET.EMPLID) Then\n   Exit (1);\nEnd-If;\n' },
            { type: 'SQL', sql: "INSERT INTO %Table(ZZ_PCODE_TMP) (ZZ_PCODE_LAB_KEY, ZZ_PCODE_LAB_VAL) VALUES (%Bind(EMPLID), 'Y')", reuse: 'Yes' }] },
          { name: 'Finish', description: 'Finish', actions: [{ type: 'Call Section', section: 'DONE' }] }
        ]
      },
      { name: 'DONE', description: 'Wrap up', steps: [
        { name: 'Log', actions: [{ type: 'Log Message', messageSet: 1000, messageNumber: 25, parameters: '%Bind(RUN_CNTL_ID)' }] }] }
    ]
  };
  const preview = await tool('psft_ae_create', { spec, dryRun: true });
  check('create: dry run plans and writes nothing', preview.saved === false && preview.reason === 'dry run' && !(await tool('psft_ae_get', { program: 'ZZ_AE_E2E1' })).token,
    JSON.stringify(preview.planned?.counters));
  check('create: the dry run validates clean', (preview.validation?.errors ?? ['?']).length === 0, JSON.stringify(preview.validation));
  const created = await tool('psft_ae_create', { spec });
  check('create: saved and read back as specified', created.saved === true && created.verification === 'stored program matches', JSON.stringify(created.verification ?? created.error));
  const verify = await tool('psft_ae_verify', { spec });
  check('verify: the stored program matches the spec', verify.matches === true, JSON.stringify(verify.differences));

  // 2. Explain, read, edit.
  const explained = await tool('psft_ae_explain', { program: 'ZZ_AE_E2E1' });
  check('explain: flow from MAIN reaches DONE', JSON.stringify(explained.flow?.reachable) === '["MAIN","DONE"]', explained.flow?.reachable);
  check('explain: dependencies found', explained.dependencies?.tablesRead?.includes('PERSONAL_DATA') && explained.dependencies?.tablesWritten?.includes('ZZ_PCODE_TMP'),
    JSON.stringify(explained.dependencies));
  const got = await tool('psft_ae_get', { program: 'ZZ_AE_E2E1' });
  check('get: SQL is stored on one line, as App Designer stores it', got.spec.sections[0].steps[2].actions[0].sql === '%Select(EMPLID) SELECT EMPLID  FROM PS_PERSONAL_DATA  ORDER BY EMPLID',
    got.spec.sections[0].steps[2].actions[0].sql);
  const ops = [
    { op: 'add_step', section: 'MAIN', after: 'Emps', name: 'Count', description: 'Count staged rows',
      actions: [{ type: 'SQL', sql: '%Select(IF_FLAG) SELECT CASE WHEN COUNT(*) > 0 THEN \'Y\' ELSE \'N\' END FROM %Table(ZZ_PCODE_TMP)' }] },
    { op: 'set_step', section: 'MAIN', step: 'Emps', frequency: 500 },
    { op: 'rename_step', section: 'MAIN', step: 'Clear', to: 'Truncate' }
  ];
  const editPreview = await tool('psft_ae_edit', { program: 'ZZ_AE_E2E1', operations: ops, expectedToken: got.token, dryRun: true });
  check('edit: dry run plans the moves App Designer makes', editPreview.saved === false && editPreview.planned?.changes?.sqlChanged?.some((s: string) => /Truncate\s*S moved/.test(s)),
    JSON.stringify(editPreview.planned?.changes?.sqlChanged));
  const edited = await tool('psft_ae_edit', { program: 'ZZ_AE_E2E1', operations: ops, expectedToken: got.token });
  check('edit: saved and verified', edited.saved === true && edited.verification === 'stored program matches', JSON.stringify(edited.verification ?? edited.error));
  const stale = await tool('psft_ae_edit', { program: 'ZZ_AE_E2E1', operations: [{ op: 'set_program', description: 'x' }], expectedToken: got.token });
  check('edit: a stale token is refused', typeof stale.error === 'string' && /changed since/.test(stale.error), stale.error);
  const after = await tool('psft_ae_get', { program: 'ZZ_AE_E2E1' });
  const main = after.spec.sections.find((s: any) => s.name === 'MAIN');
  check('edit: only the named changes landed', JSON.stringify(main.steps.map((s: any) => s.name)) === '["Init","Truncate","Emps","Count","Finish"]' &&
    main.steps[2].frequency === 500 && main.steps[1].actions[0].sql === '%TruncateTable(%Table(ZZ_PCODE_TMP))', JSON.stringify(main.steps.map((s: any) => s.name)));

  // 3. An invalid edit is refused before anything is written.
  const invalid = await tool('psft_ae_edit', { program: 'ZZ_AE_E2E1', operations: [{ op: 'add_action', section: 'MAIN', step: 'Finish', type: 'SQL', sql: 'DELETE FROM PS_X' }], expectedToken: after.token });
  check('invalid: SQL with Call Section is refused', typeof invalid.error === 'string' && /both SQL and Call Section/.test(invalid.error), invalid.error);
  const validated = await tool('psft_ae_validate', { program: 'ZZ_AE_E2E1', operations: [{ op: 'set_action', section: 'MAIN', step: 'Finish', type: 'Call Section', callSection: 'MAIN', callProgram: 'NO_SUCH_PGM' }] });
  check('validate: a call to a missing program is an error', (validated.validation?.errors ?? []).some((e: string) => /does not exist/.test(e)), JSON.stringify(validated.validation?.errors));

  // 4. A delivered complex program: copy it, change one step, the rest untouched.
  const copied = await tool('psft_ae_copy', { program: 'TL_CAL_GEN', to: 'ZZ_AE_CPLX' });
  check('complex: TL_CAL_GEN copied', copied.saved === true, JSON.stringify(copied.verification ?? copied.error));
  const c0 = await tool('psft_ae_get', { program: 'ZZ_AE_CPLX' });
  const c1r = await tool('psft_ae_edit', { program: 'ZZ_AE_CPLX', expectedToken: c0.token,
    operations: [{ op: 'set_action', section: 'LOOP', step: 'Step030', type: 'SQL', sql: 'DELETE FROM PS_TL_CALENDAR WHERE PERIOD_ID = %Bind(PERIOD_ID) AND PERIOD_SEQUENCE < %Bind(PERIOD_SEQUENCE)' }] });
  const c1 = await tool('psft_ae_get', { program: 'ZZ_AE_CPLX' });
  const strip = (s: any) => JSON.stringify({ ...s, sections: s.sections.map((x: any) => ({ ...x, steps: x.steps.map((st: any) => (x.name === 'LOOP' && st.name === 'Step030' ? { ...st, actions: st.actions.filter((a: any) => a.type !== 'SQL') } : st)) })) });
  check('complex: one action changed, the rest identical', c1r.saved === true && strip(c0.spec) === strip(c1.spec) &&
    c1.spec.sections.find((s: any) => s.name === 'LOOP').steps.find((s: any) => s.name === 'Step030').actions.find((a: any) => a.type === 'SQL').sql.includes('< %Bind'),
    JSON.stringify(c1r.planned?.changes?.sqlChanged));
  const tl = await tool('psft_ae_get', { program: 'TL_CAL_GEN' });
  check('complex: the delivered program is untouched', !!tl.token && JSON.stringify(tl.spec.sections.map((s: any) => s.name)) === JSON.stringify(c0.spec.sections.map((s: any) => s.name)));

  // 5. Copy, rename, delete.
  const cp = await tool('psft_ae_copy', { program: 'ZZ_AE_E2E1', to: 'ZZ_AE_E2E2' });
  const rn = await tool('psft_ae_rename', { program: 'ZZ_AE_E2E2', to: 'ZZ_AE_E2E3' });
  const e3 = await tool('psft_ae_get', { program: 'ZZ_AE_E2E3' });
  const e2 = await tool('psft_ae_get', { program: 'ZZ_AE_E2E2' });
  check('copy and rename', cp.saved === true && !!rn.renamed && !!e3.token && !!e2.error, JSON.stringify(rn));
  const del = await tool('psft_ae_delete', { program: 'ZZ_AE_E2E3', expectedToken: e3.token });
  check('delete', del.deleted === 'ZZ_AE_E2E3' && !!(await tool('psft_ae_get', { program: 'ZZ_AE_E2E3' })).error);
  check('every write asked for approval (allow mode: none)', approvals.length === 0, String(approvals.length));
  if (!keep) {
    // ZZ_AE_E2E1 and ZZ_AE_CPLX stay for the native check in App Designer.
  }
} catch (e) {
  check('no unexpected error', false, e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  server.dispose();
  for (const p of workspace.activeProviders) await p.dispose();
}
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
