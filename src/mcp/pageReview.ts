import type { Workspace } from '../workspace.js';
import { applyPageOperations, type PageOperation } from '../model/pageOperations.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { writable, type McpWriteHost } from './writeTools.js';
import type { Json } from '../changeReview/model.js';
import type { EditedControl } from '../providers/pageWriter.js';
import { requestForPageSnapshot } from '../providers/pageSnapshot.js';

export async function preparePageReview(workspace: Workspace, host: McpWriteHost | undefined, args: Record<string, unknown>) {
    if (!host) throw new Error('Page review requires an enabled write host.');
    if (args.includeSnapshots) throw new Error('includeSnapshots requires explicit dryRun.');
    if (args.saveInvalid) throw new Error('Saving an invalid Page is not supported through staged review.');
    const operations = args.operations as PageOperation[];
    for (const op of operations) {
        if (!['move', 'resize', 'set_label', 'set_use', 'set_properties'].includes(op.op)) throw new Error('Page staging currently supports existing-control geometry, labels/use and description/comments only.');
        if (op.op === 'set_properties' && Object.keys(op).some(k => !['op', 'description', 'comments'].includes(k))) throw new Error('Other Page property changes are not staged yet.');
    }
    const name = String(args.page).trim().toUpperCase(), key = makeKey(DefinitionType.Page, name), gate = await writable(workspace, host, String(args.connection), name);
    if (host.hasUnsavedEditor(gate.provider.id, key)) throw new Error('Page has unsaved editor changes.');
    const { layout } = await gate.provider.readPageLayout(key);
    if (args.expectedVersion !== undefined && layout.version !== args.expectedVersion) throw new Error('Stale Page version; read the Page again.');
    const edited = applyPageOperations(layout, operations);
    // Send only the bounded editor fields; the writer derives all native side effects.
    const controls: EditedControl[] = edited.controls.map(c => ({ pnlFldId: c.pnlFldId,
        fieldLeft: c.fieldLeft, fieldTop: c.fieldTop, fieldRight: c.fieldRight, fieldBottom: c.fieldBottom,
        editLblLeft: c.editLblLeft, editLblTop: c.editLblTop, editLblRight: c.editLblRight, editLblBottom: c.editLblBottom,
        fieldSizeType: c.fieldSizeType, lblType: c.lblType, lblText: c.lblText, fieldUse: c.fieldUse, secureInvisible: c.secureInvisible }));
    const preview = await gate.provider.savePage({ pnlName: name, openedVersion: layout.version, operatorId: gate.operatorId, controls,
        properties: { description: edited.properties.description, comments: edited.properties.comments }, dryRun: true, captureSnapshots: true });
    if (!preview.snapshots) throw new Error('Native Page preview did not return complete snapshots.');
    requestForPageSnapshot(name, preview.snapshots.before.value, preview.snapshots.after.value, layout.version, gate.operatorId);
    if (preview.snapshots.before.hash === preview.snapshots.after.hash) throw new Error('Page proposal has no changes.');
    return { key: name, after: preview.snapshots.after.value as unknown as Json, expectedToken: preview.snapshots.before.token };
}
