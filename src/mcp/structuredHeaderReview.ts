import type { Workspace } from '../workspace.js';
import { writable, type McpWriteHost } from './writeTools.js';
import { makeKey, DefinitionType } from '../model/definitions.js';
import { hash, type Json } from '../changeReview/model.js';
import { headerProposal, recordStructureRequest, aeHeaderDocument, isHeaderOnlyOperation, isHeaderOnlyRequest, isStageableRecordRequest } from '../changeReview/structuredHeaders.js';
import { applyRecordOperations, type RecordOperation } from '../model/recordOperations.js';
import type { StructuredFamily } from '../providers/structuredSnapshot.js';
import { deepValidate } from './appEngineTools.js';

export async function prepareStructuredHeaderReview(workspace: Workspace, host: McpWriteHost | undefined, family: StructuredFamily, args: Record<string, unknown>) {
    if (!host) throw new Error('Structured review requires an enabled write host.');
    if (args.includeSnapshots) throw new Error('includeSnapshots requires explicit dryRun.');
    const operations = args.operations as Record<string, unknown>[];
    if (family === 'record' && !isHeaderOnlyRequest('record', operations)) return prepareRecordStructureReview(workspace, host, args);
    const changes: { description?: string; comments?: string } = {};
    for (const op of operations) {
        if (!isHeaderOnlyOperation(family, op))
            throw new Error('This review adapter supports existing-definition description/comments only; structural operations are not staged yet.');
        if (typeof op.description === 'string') changes.description = op.description.trim();
        const text = op[family === 'record' ? 'definition' : 'comments'];
        if (typeof text === 'string') changes.comments = family === 'record' ? text.trimEnd() : text;
    }
    const name = String(args[family === 'record' ? 'record' : 'program']).trim().toUpperCase();
    const key = makeKey(family === 'record' ? DefinitionType.Record : DefinitionType.AppEngineProgram, name), gate = await writable(workspace, host, String(args.connection), name);
    if (host.hasUnsavedEditor(gate.provider.id, key)) throw new Error('Definition has unsaved editor changes.');
    const before = await gate.provider.readStructuredForReview(family, name);
    if (family === 'record' && args.expectedVersion !== undefined && args.expectedVersion !== before.version) throw new Error('Stale Record version; read the definition again.');
    const after = headerProposal(before.value as unknown as Json, family, changes);
    if (hash(after) === before.hash) throw new Error('Header proposal has no changes.');
    let preview;
    if (family === 'record') preview = await gate.provider.saveRecord({ ...recordStructureRequest(name, before.value, after, before.version, gate.operatorId), dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token });
    else {
        const current = await gate.provider.readAppEngineDocument(name);
        if (!current) throw new Error('Application Engine program no longer exists.');
        if (args.expectedToken !== undefined && args.expectedToken !== current.token) throw new Error('Stale Application Engine token; read the program again.');
        const doc = aeHeaderDocument(name, before.value, after, current.doc), errors = (await deepValidate(gate.provider, doc)).filter(d => d.severity === 'error');
        if (errors.length) throw new Error(errors.map(d => d.path + ': ' + d.message).join('\n'));
        preview = await gate.provider.saveAppEngineDocument({ doc, openedToken: current.token, operatorId: gate.operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token });
    }
    if (!preview.snapshots || preview.snapshots.before.hash !== before.hash || preview.snapshots.after.hash !== hash(after)) throw new Error('Native rollback preview does not exactly reproduce the bounded header proposal.');
    return { key: name, after, expectedToken: before.token };
}

/**
 * A Record's field structure: the editor's operations applied as the legacy tool applies them, executed by the shared
 * writer in rollback with full checkpoints. The proposal is that native after-image; validation rebuilds the typed edit.
 */
async function prepareRecordStructureReview(workspace: Workspace, host: McpWriteHost, args: Record<string, unknown>) {
    const operations = args.operations as Record<string, unknown>[];
    if (!isStageableRecordRequest(operations)) throw new Error('Record staging supports description/comments and field structure only; other operations are not staged.');
    const name = String(args.record).trim().toUpperCase(), key = makeKey(DefinitionType.Record, name), gate = await writable(workspace, host, String(args.connection), name);
    if (host.hasUnsavedEditor(gate.provider.id, key)) throw new Error('Definition has unsaved editor changes.');
    const layout = await gate.provider.readRecordLayout(key);
    if (!layout) throw new Error(`There is no record named ${name}.`);
    const before = await gate.provider.readStructuredForReview('record', name);
    if (args.expectedVersion !== undefined && args.expectedVersion !== before.version) throw new Error('Stale Record version; read the definition again.');
    const edit = applyRecordOperations({ recname: layout.name, recordType: layout.recordType, openedVersion: layout.version,
        fields: layout.fields.map((f) => ({ name: f.name, useEdit: f.useEdit, useEdit2: f.useEdit2 ?? 0, isNew: false, ...(f.isSubrecord ? { isSubrecord: true } : {}) })) },
        layout.recordType, operations as unknown as RecordOperation[]);
    const preview = await gate.provider.saveRecord({ edit, operatorId: gate.operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token });
    if (!preview.snapshots || preview.snapshots.before.hash !== before.hash) throw new Error('Native Record preview did not return complete matching snapshots.');
    if (preview.snapshots.after.hash === before.hash) throw new Error('Record proposal has no changes.');
    const after = preview.snapshots.after.value as unknown as Json;
    recordStructureRequest(name, before.value, after, before.version, gate.operatorId);
    return { key: name, after, expectedToken: before.token };
}
