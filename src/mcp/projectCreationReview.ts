import type { Workspace } from '../workspace.js';
import { writable, type McpWriteHost } from './writeTools.js';
import { makeKey, DefinitionType, type DefinitionKey } from '../model/definitions.js';
import type { ReviewValidationContext } from '../changeReview/service.js';
import { proposedProjectMembers } from '../changeReview/structuredCreation.js';
import { projectCreationItems, projectReviewName } from '../providers/projectSnapshot.js';

export async function prepareProjectCreationReview(workspace: Workspace, host: McpWriteHost | undefined, args: Record<string, unknown>, context?: ReviewValidationContext) {
    if (!host) throw new Error('Project creation review requires a write host.');
    const name = projectReviewName(String(args.project).trim().toUpperCase()), key = makeKey(DefinitionType.Project, name);
    const gate = await writable(workspace, host, String(args.connection), name);
    if (host.hasUnsavedEditor(gate.provider.id, key)) throw new Error('Project has unsaved editor changes.');
    const before = await gate.provider.readProjectCreationForReview(name);
    if (before.value !== null) throw new Error('Project creation requires a vacant scope.');
    const preview = await gate.provider.createProjectForReview({ project: name, operatorId: gate.operatorId, items: args.items as DefinitionKey[],
        dryRun: true, proposed: proposedProjectMembers(context), expectedSnapshotToken: before.token });
    if (preview.before.token !== before.token || preview.after.value === null) throw new Error('Project creation preview is incomplete or stale.');
    projectCreationItems(preview.after.value, name);
    return { key: name, after: preview.after.value, expectedToken: before.token };
}
