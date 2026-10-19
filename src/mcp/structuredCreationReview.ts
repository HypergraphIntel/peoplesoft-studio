import type { Workspace } from '../workspace.js';
import { writable, type McpWriteHost } from './writeTools.js';
import { makeKey, DefinitionType } from '../model/definitions.js';
import { RecordType } from '../model/record.js';
import { applyRecordOperations, type RecordOperation } from '../model/recordOperations.js';
import { documentFromSpec, type AeProgramSpec } from '../model/aeSpec.js';
import type { StructuredFamily } from '../providers/structuredSnapshot.js';
import type { ReviewValidationContext } from '../changeReview/service.js';
import { creationKey, creationRecordEdit, proposedAeReferences } from '../changeReview/structuredCreation.js';
import type { Json } from '../changeReview/model.js';
import { deepValidate } from './appEngineTools.js';

export async function prepareStructuredCreationReview(workspace: Workspace, host: McpWriteHost | undefined, family: StructuredFamily,
    args: Record<string, unknown>, context?: ReviewValidationContext) {
    if (!host) throw new Error('Creation review requires a write host.');
    const spec = args.spec as AeProgramSpec | undefined;
    const name = creationKey(family, String(family === 'record' ? args.record : spec?.program).trim().toUpperCase());
    const key = makeKey(family === 'record' ? DefinitionType.Record : DefinitionType.AppEngineProgram, name);
    const gate = await writable(workspace, host, String(args.connection), name);
    if (host.hasUnsavedEditor(gate.provider.id, key)) throw new Error('Definition has unsaved editor changes.');
    const before = await gate.provider.readStructuredCreationForReview(family, name);
    if (before.value !== null) throw new Error('Creation requires a vacant native definition scope.');
    let preview;
    if (family === 'record') {
        if (args.recordType !== 'derivedWork' || args.tablespace) throw new Error('Creation review currently supports Derived/Work records only.');
        const edit = applyRecordOperations({ recname: name, recordType: RecordType.DerivedWork, openedVersion: 0, fields: [], isNew: true }, RecordType.DerivedWork, args.operations as RecordOperation[]);
        preview = await gate.provider.saveRecord({ edit, operatorId: gate.operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token });
    } else {
        const doc = documentFromSpec({ ...spec!, program: name });
        const errors = (await deepValidate(gate.provider, doc, proposedAeReferences(gate.provider.appEngineReferenceLookup(), context))).filter(d => d.severity === 'error');
        if (errors.length) throw new Error(errors.map(d => d.path + ': ' + d.message).join('\n'));
        preview = await gate.provider.saveAppEngineDocument({ doc, openedToken: 'absent', operatorId: gate.operatorId, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token });
    }
    if (!preview.creationPreview || preview.creationPreview.before.token !== before.token || preview.creationPreview.before.value !== null)
        throw new Error('Native creation rollback preview is incomplete or stale.');
    const after = preview.creationPreview.after.value as unknown as Json;
    if (family === 'record') creationRecordEdit(after, name);
    return { adapter: family + '-create', key: name, after, expectedToken: before.token };
}
