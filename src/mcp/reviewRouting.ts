import { requireProvider } from './tools.js';
import { DatabaseProvider } from '../providers/database.js';
import { makeKey, DefinitionType } from '../model/definitions.js';
import type { Workspace } from '../workspace.js';
import { prepareQueryReview } from './queryTools.js';
import * as z from 'zod/v4';
import { prepareSqlText } from '../providers/sqlWriter.js';
import type { ReviewService } from '../changeReview/service.js';
import type { Json } from '../changeReview/model.js';
import { jsonResult } from './tools.js';
import { preparePageReview } from './pageReview.js';
import type { McpWriteHost } from './writeTools.js';
import { planHash } from '../changeReview/model.js';
import { prepareStructuredHeaderReview } from './structuredHeaderReview.js';
export const REVIEWED_MUTATION_TOOLS = ['psft_save_text_definition', 'psft_process_save', 'psft_query_save', 'psft_query_create', 'psft_query_copy', 'psft_save_peoplecode', 'psft_edit_page', 'psft_edit_record', 'psft_ae_edit'];
/** Compatibility routing only for adapters whose exact after-state is known. */
export function routeReviewedMutations(server: {
    registerTool: unknown;
}, service: ReviewService, workspace: Workspace, host?: () => McpWriteHost | undefined): void {
    const target = server as {
        registerTool: (name: string, config: Record<string, unknown>, callback: (args: Record<string, unknown>, ...rest: unknown[]) => unknown) => unknown;
    };
    const register = target.registerTool.bind(target);
    target.registerTool = (name, config, callback) => {
        if (!REVIEWED_MUTATION_TOOLS.includes(name))
            return register(name, config, callback);
        const schema = config.inputSchema as z.ZodObject;
        const next = { ...config, description: String(config.description) + (name === 'psft_edit_record' || name === 'psft_ae_edit'
                ? ' With Change Review on Oracle, only existing-definition description/comments edits stage full preservation snapshots for developer approval/application. Other operations are refused on this staged path; Record SQL Table/Derived Work only. No creation/deletion, field removal, DDL, SQL/PeopleCode mutation or staged prerequisite overlay is implied. Explicit dryRun retains its documented preview path.'
                : name === 'psft_edit_page'
                ? ' With Change Review on Oracle, only existing-control move/resize, label/use and description/comments changes stage proposals. Other Page operations and saveInvalid are refused for staging. Explicit dryRun keeps the rollback preview path. Proposals require developer approval/application; no Page creation/deletion or control insertion/deletion adapter is implied.'
                : ' With Change Review enabled on Oracle, supported text, PeopleCode, Process and Query mutations stage a durable proposal and return REVIEW_REQUIRED; they do not persist until the developer applies in VS Code. HTML and freeform style sheets use exact text/description snapshots.') + ' Supply changeSetId to group operations. Unsupported platforms retain legacy gates.',
            inputSchema: schema.extend({ changeSetId: z.string().uuid().optional(), dependsOn: z.array(z.string().uuid()).default([]) }) };
        return register(name, next, async (args, ...rest) => {
            if (args.dryRun === true)
                return callback(args, ...rest);
            const requestedProvider = await requireProvider(workspace, String(args.connection));
            if (requestedProvider instanceof DatabaseProvider && requestedProvider.platform !== 'oracle')
                return callback(args, ...rest);
            const connection = String(args.connection), supplied = typeof args.changeSetId === 'string' ? await service.store.get(args.changeSetId) : undefined;
            // A tool cannot attach a request for one connection to another target's set.
            if (supplied && supplied.environment.connection !== requestedProvider.id)
                throw new Error('Change Set connection does not match the tool request.');
            if (supplied?.plan && (supplied.plan.review !== 'APPROVED' || supplied.plan.approvedHash !== planHash(supplied))) throw new Error('The implementation approach requires separate developer plan approval.');
            const preparedPage = name === 'psft_edit_page' ? await preparePageReview(workspace, host?.(), args) : undefined;
            const headerFamily = name === 'psft_edit_record' ? 'record' : name === 'psft_ae_edit' ? 'ae' : undefined;
            const preparedHeader = headerFamily ? await prepareStructuredHeaderReview(workspace, host?.(), headerFamily, args) : undefined;
            const setId = supplied?.id ?? (await service.create('Review ' + name, connection)).id;
            if (headerFamily && preparedHeader) {
                const staged = await service.stage(setId, headerFamily, preparedHeader.key, preparedHeader.after, args.dependsOn as string[], undefined, preparedHeader.expectedToken);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
            }
            if (name === 'psft_edit_page') {
                const proposal = preparedPage!;
                const staged = await service.stage(setId, 'page', proposal.key, proposal.after, args.dependsOn as string[], undefined, proposal.expectedToken);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
            }
            if (name === 'psft_save_peoplecode') {
                const staged = await service.stage(setId, 'peoplecode', { type: Number(args.type), parts: args.parts as string[] }, { text: String(args.source) }, args.dependsOn as string[]);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
            }
            if (name === 'psft_save_text_definition' && args.type !== 30) {
                const p = await requireProvider(workspace, connection);
                if (!(p instanceof DatabaseProvider))
                    throw new Error('A database connection is required.');
                const key = String(args.name).trim().toUpperCase(), native = makeKey(Number(args.type), key, ...(args.type === DefinitionType.HtmlDefinition ? ['4'] : []));
                const before = await p.readReviewContent(native);
                const staged = await service.stage(setId, args.type === DefinitionType.HtmlDefinition ? 'html' : 'stylesheet', key, { text: String(args.text), description: typeof args.description === 'string' ? args.description : before?.description ?? '' }, args.dependsOn as string[]);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
            }
            if (name.startsWith('psft_query_')) {
                const proposal = await prepareQueryReview(workspace, name, args);
                const staged = await service.stage(setId, 'query', proposal.key, proposal.after, args.dependsOn as string[], undefined, proposal.expectedToken);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
            }
            const staged = await service.stage(setId, name === 'psft_process_save' ? 'process' : 'sql', name === 'psft_process_save' ? [String(args.processType), String(args.name)] : String(args.name).trim().toUpperCase(), name === 'psft_process_save' ? args.input as Json : { text: prepareSqlText(String(args.text)) }, args.dependsOn as string[], undefined, name === 'psft_process_save' ? String(args.expectedToken) : undefined);
            return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
        });
    };
}
