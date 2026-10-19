import type { Workspace } from '../workspace.js';
import { writable, type McpWriteHost } from './writeTools.js';
import { hash, type Json } from '../changeReview/model.js';
import { ibWriteInput, ibDefinitionKey } from '../model/ibOperations.js';
import { isIbHeaderInput, ibHeaderProposal, ibHeaderInput } from '../changeReview/ibHeaders.js';
import { ibStructuralChange, ibStructuralInput } from '../changeReview/ibStructure.js';

export type IbReviewPreparation = { adapter: string; key: string; after: Json; expectedToken: string } | { outside: string };

/**
 * A staged proposal, or `outside` with the reason when the edit is a supported
 * legacy edit that the bounded review contract does not cover -- not permission to
 * attach it to a Change Set. Undefined for families with no review adapter.
 */
export async function prepareIbHeaderReview(workspace: Workspace, host: McpWriteHost | undefined, args: Record<string, unknown>): Promise<IbReviewPreparation | undefined> {
    const input = ibWriteInput.parse(args.input);
    if (input.kind !== 'service' && input.kind !== 'operation') return undefined;
    if (!host) throw new Error('IB review requires a write host.');
    const gate = await writable(workspace, host, String(args.connection), input.key[0]);
    const live = await gate.provider.readIntegrationBroker(input.kind, input.key);
    if (!live || live.token !== args.expectedToken) throw new Error('IB definition changed; read it again before staging.');
    if (host.hasUnsavedEditor(gate.provider.id, ibDefinitionKey(input.kind, input.key))) throw new Error('IB definition has unsaved editor changes.');
    const header = isIbHeaderInput(live, input);
    let before: Awaited<ReturnType<typeof gate.provider.readIbForReview>>;
    try { before = await gate.provider.readIbForReview(input.kind, input.key[0]); } catch (error) {
        // A legacy structural edit must not be blocked by the review checkpoint itself.
        if (!header) return { outside: error instanceof Error ? error.message : String(error) };
        throw error;
    }
    const save = (request: typeof input, expectedAfterHash?: string) => gate.provider.saveIntegrationBroker({ input: request, expectedToken: live.token, operatorId: gate.operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token, ...(expectedAfterHash ? { expectedAfterHash } : {}) });
    if (header) {
        const after = ibHeaderProposal(before.value as unknown as Json, input.kind, input.properties);
        if (before.hash === hash(after)) throw new Error('IB header proposal has no changes.');
        const preview = await save(ibHeaderInput(before.value, after, input.kind, input.key[0], live), hash(after));
        if (!preview.snapshots || preview.snapshots.before.hash !== before.hash || preview.snapshots.after.hash !== hash(after)) throw new Error('IB native rollback preview does not exactly reproduce the header proposal.');
        return { adapter: 'ib-' + input.kind, key: input.key[0], after, expectedToken: before.token };
    }
    // Structural: the writer's own rollback preview defines the after-image. It is
    // staged only when it is inside the contract and a writer input re-derived from
    // the two checkpoints reproduces it exactly (what validation and apply will do).
    // A writer refusal here is reported by the legacy path exactly as before.
    let first: Awaited<ReturnType<typeof save>>;
    try { first = await save(input); } catch (error) { return { outside: error instanceof Error ? error.message : String(error) }; }
    if (!first.snapshots || first.snapshots.before.hash !== before.hash) throw new Error('IB native rollback preview did not start from the reviewed baseline.');
    const after = first.snapshots.after.value as unknown as Json;
    if (first.snapshots.after.hash === before.hash) return { outside: 'the save changes nothing in the review scope' };
    try { ibStructuralChange(before.value, after, input.kind, input.key[0]); } catch (error) { return { outside: error instanceof Error ? error.message : String(error) }; }
    const again = await save(ibStructuralInput(before.value, after, input.kind, input.key[0], live), hash(after));
    if (!again.snapshots || again.snapshots.after.hash !== hash(after)) throw new Error('IB native rollback preview does not reproduce the structural proposal from its checkpoint.');
    return { adapter: 'ib-' + input.kind, key: input.key[0], after, expectedToken: before.token };
}
