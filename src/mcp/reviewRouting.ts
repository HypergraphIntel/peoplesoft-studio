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
export const REVIEWED_MUTATION_TOOLS = ['psft_save_text_definition', 'psft_process_save', 'psft_query_save', 'psft_query_create', 'psft_query_copy', 'psft_save_peoplecode'];
/** Compatibility routing only for adapters whose exact after-state is known. */
export function routeReviewedMutations(server: {
    registerTool: unknown;
}, service: ReviewService, workspace: Workspace): void {
    const target = server as {
        registerTool: (name: string, config: Record<string, unknown>, callback: (args: Record<string, unknown>, ...rest: unknown[]) => unknown) => unknown;
    };
    const register = target.registerTool.bind(target);
    target.registerTool = (name, config, callback) => {
        if (!REVIEWED_MUTATION_TOOLS.includes(name))
            return register(name, config, callback);
        const schema = config.inputSchema as z.ZodObject;
        const next = { ...config, description: String(config.description) + ' With Change Review enabled on Oracle, supported text, PeopleCode, Process and Query mutations stage a durable proposal and return REVIEW_REQUIRED; they do not persist until the developer applies in VS Code. Supply changeSetId to group operations. HTML and freeform style sheets use exact text/description snapshots. Unsupported platforms retain legacy gates.',
            inputSchema: schema.extend({ changeSetId: z.string().uuid().optional(), dependsOn: z.array(z.string().uuid()).default([]) }) };
        return register(name, next, async (args, ...rest) => {
            if (args.dryRun === true)
                return callback(args, ...rest);
            const requestedProvider = await requireProvider(workspace, String(args.connection));
            if (requestedProvider instanceof DatabaseProvider && requestedProvider.platform !== 'oracle')
                return callback(args, ...rest);
            const connection = String(args.connection), setId = typeof args.changeSetId === 'string' ? args.changeSetId : (await service.create('Review ' + name, connection)).id;
            const set = await service.store.get(setId);
            // A tool cannot attach a request for one connection to another target's set.
            if (set.environment.connection !== connection && set.environment.label !== connection)
                throw new Error('Change Set connection does not match the tool request.');
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
