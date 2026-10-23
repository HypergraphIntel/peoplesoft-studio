/**
 * Promotion between environments with one active connection (V15-2). Activating the target disposes the source, so
 * the source must be read through a temporary provider (Workspace.readFromConnection). Found on ps-win-client
 * 2026-10-23: "Promote Project failed: HRDMO is not connected". Fixture providers only; no database.
 */
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import os from 'node:os';
const root = process.cwd();
const { createStub } = await import(pathToFileURL(join(root, 'scripts/vscode-stub.mjs')).href);
const { vscode } = createStub();
const loader = (Module as any)._load;
(Module as any)._load = function(name: string, parent: unknown, main: boolean) { return name === 'vscode' ? vscode : loader.call(this, name, parent, main); };
const require = createRequire(join(root, 'package.json'));
const { DatabaseProvider } = require('./src/providers/database.ts');
const { registerPromotionTool } = require('./src/mcp/changeReviewTools.ts');
const { ProcessRuntimeController } = require('./src/processRuntime/controller.ts');

// Both fingerprints agree, so promotion stops at its first read: the same-environment refusal proves the temporary
// source answered, where the disposed one says "HRDMO is not connected".
const db = (name: string, state: { connected: boolean }) => {
  const provider = new DatabaseProvider({ name, platform: 'oracle', connectString: 'fixture', user: 'fixture', password: '' });
  Object.defineProperty(provider, 'isConnected', { get: () => state.connected });
  provider.environmentFingerprint = async () => { if (!state.connected) throw new Error(`${name} is not connected.`); return 'same'; };
  return provider;
};
const connections = [{ kind: 'oracle', name: 'HRDMO', peoplesoftOperatorId: 'JARED' }, { kind: 'oracle', name: 'HRDEV', peoplesoftOperatorId: 'JARED' }];
const live = { HRDMO: { connected: true }, HRDEV: { connected: false } };
const source = db('HRDMO', live.HRDMO), target = db('HRDEV', live.HRDEV);
const reads: string[] = [];
const workspace: any = {
  connections,
  get activeProviders() { return [source, target].filter((p) => p.isConnected); },
  configFor: (id: string) => connections.find((c) => `${c.kind}:${c.name}` === id),
  isWritable: () => true,
  // As Workspace.connect: activating one connection disposes the others.
  async require(id: string) {
    const name = id.split(':')[1] as 'HRDMO' | 'HRDEV';
    for (const key of Object.keys(live) as Array<'HRDMO' | 'HRDEV'>) live[key].connected = key === name;
    return name === 'HRDEV' ? target : source;
  },
  async readFromConnection(config: { name: string }, read: (p: unknown) => Promise<unknown>) {
    reads.push(config.name);
    return read(db(config.name, { connected: true }));
  }
};
const host: any = { mode: () => 'confirm', hasUnsavedEditor: () => false, saved: () => {}, confirm: async () => true };
let tool: ((input: Record<string, string>) => Promise<unknown>) | undefined;
registerPromotionTool({ registerTool(_name: string, _config: unknown, callback: typeof tool) { tool = callback; } } as any, {} as any, workspace, () => host);

await assert.rejects(tool!({ sourceConnection: 'HRDMO', project: 'ZZ_BENELIG_PROJ', targetConnection: 'HRDEV' }), /HRDMO and HRDEV are the same environment/);
assert.deepEqual(reads, ['HRDMO']);
assert.equal(live.HRDEV.connected, true, 'the target is the active connection');

// Run and Monitor's background refresh of a running request on HRDMO must not reconnect HRDMO while HRDEV is active
// (found the same day: the reconnect closed the promotion target's pool, NJS-064).
const runtime = new ProcessRuntimeController({ globalStorageUri: { fsPath: join(os.tmpdir(), 'psft-promotion-fixture') }, globalState: { get: () => undefined }, secrets: { get: async () => undefined } } as any, workspace, () => host);
const listed: string[] = [];
(runtime as any).service.list = async (connection: string) => { listed.push(connection); return []; };
(runtime as any).panels.set('oracle:HRDMO', { panel: { visible: true, dispose: () => {} }, connection: 'oracle:HRDMO', selected: 'request', queue: Promise.resolve(), disposed: false });
await (runtime as any).poll();
assert.deepEqual(listed, [], 'a background poll leaves an inactive connection alone');
assert.equal(live.HRDEV.connected, true);
runtime.dispose();
console.log('promotion fixture: PASS (source read through a temporary provider; target active; background polls never reconnect)');
process.exit(0);
