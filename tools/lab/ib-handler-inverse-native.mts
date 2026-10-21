/** Owned HRDMO handler inverse/redo with private durable review and trusted service test approval; not installed UI acceptance. */
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

const name = 'ZZ_PCODE_LAB_IBO', operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
const config = { name: 'HRDMO IB handler inverse acceptance', platform: 'oracle' as const,
    connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const p = new DatabaseProvider(config), root = await mkdtemp(join(tmpdir(), 'psft-ib-handler-inverse-'));
setWriteNamePrefix(name);
setWriteGuard(async w => { assert.deepEqual(w.key.parts, [name]); if (writeOrigin() === 'agent') assert.ok(isReviewedWrite(p.id, w.key)); });
const checks: string[] = [], report: Record<string, unknown> = { at: new Date().toISOString(), scope: 'Owned Oracle 8.62.09 handler lifecycle; production providers/adapters and private durable review with trusted service test approval; not installed UI', name, history: root, checks };
const check = async (label: string, fn: () => Promise<void>) => { await fn(); checks.push(label); console.log('ok ' + checks.length + ' - ' + label); };
const marker = async () => (await p.runReadOnlyQuery(`SELECT HANDLERNAME,VERSION FROM PSOPRHDLRDEL WHERE IB_OPERATIONNAME='${name}'`, 20)).rows;
let original: Awaited<ReturnType<typeof p.readIbForReview>> | undefined;
try {
    await p.connect();
    assert.equal((await p.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL", 1)).rows[0].DB, 'HRDMO');
    const live = (await p.readIntegrationBroker('operation', [name]))!;
    assert.equal(live.properties.IB_SERVICENAME, 'ZZ_PCODE_LAB_IBS');
    assert.equal(live.sections.handlers.length, 1); assert.equal(live.sections.handlers[0].ACTIVE_FLAG, 'I');
    assert.equal(live.sections.handlers[0].HANDLERNAME, 'REQUESTHDLR');
    original = await p.readIbForReview('operation', name); assert.equal((await marker()).length, 0);
    const input = inputForIb(live); input.sections.handlers = []; input.sections.applicationClassHandlers = [];
    const request = { input, expectedToken: live.token, operatorId, expectedSnapshotToken: original.token };
    const preview = await p.saveIntegrationBroker({ ...request, dryRun: true, captureSnapshots: true });
    const empty = preview.snapshots!.after.value as unknown as Json;
    await check('Native handler deletion rollback preserves the complete token and all markers', async () => {
        assert.equal((await p.readIbForReview('operation', name)).token, original!.token); assert.equal((await marker()).length, 0);
        assert.deepEqual(preview.plan.increments, { OPRM: 2, SYS: 3, OPRHM: 1, OPRVM: 1 });
    });
    await check('Committed typed deletion reproduces the approved empty-handler checkpoint and marker', async () => {
        await p.saveIntegrationBroker({ ...request, expectedAfterHash: hash(empty) });
        assert.equal((await p.readIbForReview('operation', name)).hash, hash(empty)); assert.equal((await marker()).length, 1);
    });
    const { createStub } = await import('../../scripts/vscode-stub.mjs'), { vscode } = createStub(), loader = (Module as any)._load;
    (Module as any)._load = function (id: string, parent: unknown, main: boolean) { return id === 'vscode' ? vscode : loader.call(this, id, parent, main); };
    const { databaseReviewAdapters } = await import('../../src/changeReview/adapters.js');
    const workspace = { activeProviders: [p], connections: [], require: async () => p, isWritable: () => true,
        configFor: () => ({ peoplesoftOperatorId: operatorId }) } as unknown as Workspace;
    const registry = databaseReviewAdapters(workspace, () => ({ mode: () => 'confirm', confirm: async () => { throw new Error('No legacy approval fallback.'); }, hasUnsavedEditor: () => false, saved() {} }));
    const service = new ReviewService(new ReviewStore(root), { environment: registry.environment, changed() {} }, registry.adapters);
    const apply = async (id: string) => { let set = await service.validate(id); assert.equal(set.status, 'READY_FOR_REVIEW', JSON.stringify(set.objects.map(c => c.validation))); set = await service.review(id, set.objects.map(c => c.id), 'APPROVED', set.revision); return service.apply(id, false, set.revision); };
    let forward = await service.create('Native IB OnRequest handler addition', p.id);
    forward = await service.stage(forward.id, 'ib-operation', name, original.value as unknown as Json);
    await check('Reviewed handler addition stages without persistence, then applies exactly and clears the native marker', async () => {
        assert.equal((await p.readIbForReview('operation', name)).hash, hash(empty));
        assert.equal((await apply(forward.id)).status, 'APPLIED'); assert.equal((await p.readIbForReview('operation', name)).hash, original!.hash); assert.equal((await marker()).length, 0);
    });
    const inverse = await service.reverse(forward.id);
    await check('Added-handler inverse is prepared without writes, requires fresh review and applies the calibrated deletion', async () => {
        await assert.rejects(service.apply(inverse.id, false, inverse.revision), /approved/i);
        assert.equal((await p.readIbForReview('operation', name)).hash, original!.hash);
        assert.equal((await apply(inverse.id)).status, 'APPLIED'); assert.equal((await service.store.get(forward.id)).status, 'REVERTED');
        assert.equal((await p.readIbForReview('operation', name)).hash, hash(empty)); assert.equal((await marker()).length, 1);
    });
    const redo = await service.redo(forward.id);
    await check('Freshly reviewed redo restores the exact native checkpoint and clears its tombstone', async () => {
        assert.equal((await apply(redo.id)).status, 'APPLIED'); assert.equal((await p.readIbForReview('operation', name)).hash, original!.hash); assert.equal((await marker()).length, 0);
    });
    report.changeSets = { forward: forward.id, inverse: inverse.id, redo: redo.id }; report.passed = true;
} finally {
    // Preserve the captured native handler content if any test failed after a commit.
    if (original) {
        const current = await p.readIbForReview('operation', name);
        if (current.hash !== original.hash) { const doc = (await p.readIntegrationBroker('operation', [name]))!; await p.saveIntegrationBroker({ input: ibStructuralInput(current.value, original.value, 'operation', name, doc), expectedToken: doc.token, expectedSnapshotToken: current.token, expectedAfterHash: original.hash, operatorId }); }
        report.originalRestored = (await p.readIbForReview('operation', name)).hash === original.hash;
    }
    await writeFile('tools/lab/results/ib-handler-inverse-native-2026-10-21.json', JSON.stringify(report, null, 2) + '\n');
    await p.dispose();
}
