import type { Workspace } from '../workspace.js';
import { writable, type McpWriteHost } from './writeTools.js';
import { hash, type Json } from '../changeReview/model.js';
import { ibWriteInput, ibDefinitionKey } from '../model/ibOperations.js';
import { isIbHeaderInput, ibHeaderProposal, ibHeaderInput } from '../changeReview/ibHeaders.js';

/** Undefined means a supported legacy edit, not permission to attach it to a Change Set. */
export async function prepareIbHeaderReview(workspace: Workspace, host: McpWriteHost | undefined, args: Record<string, unknown>) {
    const input = ibWriteInput.parse(args.input);
    if (input.kind !== 'service' && input.kind !== 'operation') return undefined;
    if (!host) throw new Error('IB review requires a write host.');
    const gate = await writable(workspace, host, String(args.connection), input.key[0]);
    const live = await gate.provider.readIntegrationBroker(input.kind, input.key);
    if (!live || live.token !== args.expectedToken) throw new Error('IB definition changed; read it again before staging.');
    if (!isIbHeaderInput(live, input)) return undefined;
    if (host.hasUnsavedEditor(gate.provider.id, ibDefinitionKey(input.kind, input.key))) throw new Error('IB definition has unsaved editor changes.');
    const before = await gate.provider.readIbForReview(input.kind, input.key[0]), after = ibHeaderProposal(before.value as unknown as Json, input.kind, input.properties);
    if (before.hash === hash(after)) throw new Error('IB header proposal has no changes.');
    const request = ibHeaderInput(before.value, after, input.kind, input.key[0], live);
    const preview = await gate.provider.saveIntegrationBroker({ input: request, expectedToken: live.token, operatorId: gate.operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token, expectedAfterHash: hash(after) });
    if (!preview.snapshots || preview.snapshots.before.hash !== before.hash || preview.snapshots.after.hash !== hash(after)) throw new Error('IB native rollback preview does not exactly reproduce the header proposal.');
    return { adapter: 'ib-' + input.kind, key: input.key[0], after, expectedToken: before.token };
}
