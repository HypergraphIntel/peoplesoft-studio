/** Owned HRDMO REST consumer structure with private durable review and trusted test approval; not installed UI acceptance. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database.js';
import { inputForIb } from '../../src/model/ibOperations.js';
import { hash, type Json } from '../../src/changeReview/model.js';
import { ibStructuralInput } from '../../src/changeReview/ibStructure.js';
import { ReviewStore } from '../../src/changeReview/store.js';
import { ReviewService } from '../../src/changeReview/service.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard, writeOrigin } from '../../src/providers/writeGuard.js';
import { isReviewedWrite } from '../../src/changeReview/authorization.js';
import type { Workspace } from '../../src/workspace.js';

const name = 'ZZ_IB_API_5736828_E', operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const config = { name: 'HRDMO REST consumer structural acceptance', platform: 'oracle' as const,
    connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const p = new DatabaseProvider(config), root = await mkdtemp(join(tmpdir(), 'psft-ib-rest-consumer-'));
setWriteNamePrefix(name);
setWriteGuard(async w => { assert.deepEqual(w.key.parts, [name]); if (writeOrigin() === 'agent') assert.ok(isReviewedWrite(p.id, w.key)); });
const checks: string[] = [], report: Record<string, unknown> = { at: new Date().toISOString(), scope: 'Owned Oracle 8.62.09 REST consumer structure; production providers/adapters and private durable review with trusted service test approval; not installed UI', name, history: root, checks };
const check = async (label: string, fn: () => Promise<void>) => { await fn(); checks.push(label); console.log('ok ' + checks.length + ' - ' + label); };
let original: Awaited<ReturnType<typeof p.readIbForReview>> | undefined;
try {
    await p.connect();
    assert.equal((await p.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL", 1)).rows[0].DB, 'HRDMO');
    const live=(await p.readIntegrationBroker('operation',[name]))!;
    assert.equal(live.serviceKind,'rest');assert.equal(live.restRole,'consumer');assert.equal(live.properties.IB_SERVICENAME,'ZZ_IB_API_5736828_C');
    original=await p.readIbForReview('operation',name);
    const input=inputForIb(live);assert.ok(input.sections.versions.length);input.sections.versions[0].DESCR='REST consumer reviewed';
    const preview=await p.saveIntegrationBroker({input,expectedToken:live.token,operatorId,dryRun:true,captureSnapshots:true,expectedSnapshotToken:original.token});
    const proposed=preview.snapshots!.after.value as unknown as Json;
    await check('Native REST consumer structural rollback restores full baseline token, mappings and routing',async()=>{assert.equal((await p.readIbForReview('operation',name)).token,original!.token);assert.notEqual(hash(proposed),original!.hash);});
    const { createStub } = await import('../../scripts/vscode-stub.mjs'), { vscode } = createStub(), loader = (Module as any)._load;
    (Module as any)._load = function (id: string, parent: unknown, main: boolean) { return id === 'vscode' ? vscode : loader.call(this, id, parent, main); };
    const { databaseReviewAdapters } = await import('../../src/changeReview/adapters.js');
    const workspace = { activeProviders: [p], connections: [], require: async () => p, isWritable: () => true,
        configFor: () => ({ peoplesoftOperatorId: operatorId }) } as unknown as Workspace;
    const registry = databaseReviewAdapters(workspace, () => ({ mode: () => 'confirm', confirm: async () => { throw new Error('No legacy approval fallback.'); }, hasUnsavedEditor: () => false, saved() {} }));
    const service = new ReviewService(new ReviewStore(root), { environment: registry.environment, changed() {} }, registry.adapters);
    const apply = async (id: string) => { let set = await service.validate(id); assert.equal(set.status, 'READY_FOR_REVIEW', JSON.stringify(set.objects.map(c => c.validation))); set = await service.review(id, set.objects.map(c => c.id), 'APPROVED', set.revision); return service.apply(id, false, set.revision); };
    let forward=await service.create('Native REST consumer structure',p.id);
    forward=await service.stage(forward.id,'ib-operation',name,proposed);
    await check('Reviewed REST consumer version structure stages without persistence and applies exact full scope',async()=>{assert.equal((await p.readIbForReview('operation',name)).token,original!.token);assert.equal((await apply(forward.id)).status,'APPLIED');assert.equal((await p.readIbForReview('operation',name)).hash,hash(proposed));});
    const inverse=await service.reverse(forward.id);
    await check('Fresh reviewed REST consumer inverse restores all scoped rows, URI mappings and routing',async()=>{assert.equal((await apply(inverse.id)).status,'APPLIED');assert.equal((await p.readIbForReview('operation',name)).hash,original!.hash);});
    const redo=await service.redo(forward.id);
    await check('Fresh reviewed REST consumer redo reproduces its exact scoped result',async()=>{assert.equal((await apply(redo.id)).status,'APPLIED');assert.equal((await p.readIbForReview('operation',name)).hash,hash(proposed));});
    const restore=await service.reverse(redo.id);assert.equal((await apply(restore.id)).status,'APPLIED');
    report.changeSets = { forward: forward.id, inverse: inverse.id, redo: redo.id }; report.passed = true;
} finally {
    // Preserve the captured native handler content if any test failed after a commit.
    if (original) {
        const current = await p.readIbForReview('operation', name);
        if (current.hash !== original.hash) { const doc = (await p.readIntegrationBroker('operation', [name]))!; await p.saveIntegrationBroker({ input: ibStructuralInput(current.value, original.value, 'operation', name, doc), expectedToken: doc.token, expectedSnapshotToken: current.token, expectedAfterHash: original.hash, operatorId }); }
        report.originalRestored = (await p.readIbForReview('operation', name)).hash === original.hash;
    }
    await writeFile('tools/lab/results/ib-rest-consumer-native-2026-10-21.json', JSON.stringify(report, null, 2) + '\n');
    await p.dispose();
}
