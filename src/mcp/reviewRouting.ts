import { requireProvider } from './tools.js';
import { DatabaseProvider } from '../providers/database.js';
import { prepareHtmlText } from '../providers/htmlWriter.js';
import { makeKey, DefinitionType } from '../model/definitions.js';
import type { Workspace } from '../workspace.js';
import { prepareQueryLifecycleReview, prepareQueryReview } from './queryTools.js';
import * as z from 'zod/v4';
import { prepareSqlText } from '../providers/sqlWriter.js';
import type { ReviewService } from '../changeReview/service.js';
import type { Json } from '../changeReview/model.js';
import { jsonResult } from './tools.js';
import { preparePageReview } from './pageReview.js';
import type { McpWriteHost } from './writeTools.js';
import { planHash } from '../changeReview/model.js';
import { prepareStructuredHeaderReview } from './structuredHeaderReview.js';
import { isStageableRecordRequest } from '../changeReview/structuredHeaders.js';
import { isStageablePageRequest } from '../model/pageOperations.js';
import { prepareStructuredCreationReview } from './structuredCreationReview.js';
import { prepareProjectCreationReview } from './projectCreationReview.js';
import { prepareIbHeaderReview } from './ibHeaderReview.js';
import { prepareIbDefinitionReview } from './ibDefinitionReview.js';
export const REVIEWED_MUTATION_TOOLS = ['psft_save_text_definition', 'psft_process_save', 'psft_query_save', 'psft_query_create', 'psft_query_copy', 'psft_query_delete', 'psft_query_rename', 'psft_save_peoplecode', 'psft_edit_page', 'psft_edit_record', 'psft_ae_edit', 'psft_ib_save','psft_ib_create','psft_ib_delete', 'psft_create_record', 'psft_ae_create', 'psft_create_project'];
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
        const next = { ...config, description: String(config.description) + (name === 'psft_create_record' || name === 'psft_ae_create' || name === 'psft_create_project'
                ? ' On Oracle with Change Review, new Derived/Work records (existing fields, no subrecords), App Engine programs, and new projects with explicit bounded membership stage exact native rollback previews. Declare dependsOn for proposed Record/SQL/AE prerequisites in the same Change Set. No persistence before developer approval/application. Bounded Record/AE and Oracle 8.62 project creation support reviewed deletion/recreation; project reversal removes only its header and memberships, preserving contained definitions. Nondefault project metadata, credentials and ancillary references refuse deletion. Other Record types retain legacy confirmation outside a Change Set.'
                : name === 'psft_ib_create'||name === 'psft_ib_delete'
                ? ' With Oracle Change Review on 8.62.09, bounded standard or REST service and synchronous operation lifecycle stages exact complete checkpoints; a REST operation includes its URI templates and writer-generated routing. Operation approval covers its existing owning service mapping/resave. Deletion is review-only. Other creations retain legacy confirmation outside an explicit Change Set.'
                : name === 'psft_ib_save'
                ? ' With Change Review on Oracle, existing service/operation edits stage fixed noncredential preservation snapshots when they stay inside the bounded contract: description/comments; service owner, namespace, application and app server group; operation header except owning service, routing type, REST method, alias and message binding; existing versions, parameters (not message binding), handlers (not type/event) and application class rows; existing REST URI template text preserving ordered URI variables and mappings; and ApplicationClass REQUESTHDLR/OnRequest addition. Paired removal of that handler and its class row, with native tombstones and typed inverse/redo, is calibrated only on 8.62.09. Other child removal and out-of-contract edits keep legacy confirmation and cannot be attached to a Change Set. For bounded 8.62.09 standard and REST definition lifecycle use psft_ib_create / psft_ib_delete and psft_ib_definition_get.'
                : name === 'psft_edit_record'
                ? ' With Change Review on Oracle, SQL Table/Derived Work description/comments and field structure (insert_field, insert_subrecord, remove_field, move_field, set_use, set_edits, set_default, set_label) stage full six-table metadata checkpoints for developer approval/application, with exact typed inverse/redo (a removed field is restored from its own reviewed row). Physical DDL and data are not reviewed: build separately; undo restores metadata, not dropped column data. Removing a field still used by its PeopleCode, pages, queries or other records is refused. set_type, other Record Properties and In Memory are not staged: they save through the legacy per-write confirmation. Explicit dryRun retains its documented preview path.'
                : name === 'psft_ae_edit'
                ? ' With Change Review on Oracle, every operation (program properties, state records, temporary tables, sections, steps and actions with their SQL and PeopleCode) stages the shared writer\'s full twenty-table rollback after-image for developer approval/application; the program document rebuilt from it must reproduce it exactly. Undo restores the checkpoint plus the deletion records App Designer writes for removed keys; redo restores the reviewed after-image. Program creation, copy, rename and deletion keep their own tools. Explicit dryRun retains its documented preview path.'
                : name === 'psft_edit_page'
                ? ' With Change Review on Oracle, move/resize, label/use, description/comments, inserted and deleted controls (not a Tree insert), set_order and Edit Box set_binding stage exact native proposals; the writer assigns the new controls\' ids and tab places and renumbers Related Field references, and the reviewed after-image is applied exactly. Reversal restores deleted controls under their own ids and returns MAXPNLFLDID after removing added ones; deletes of controls named by translations or configurator rows are refused. Other properties and saveInvalid are not staged: they save through the legacy per-write confirmation. Explicit dryRun keeps the rollback preview path. No Page creation/deletion adapter is implied.'
                : ' With Change Review enabled on Oracle, supported text, PeopleCode, Process and Query mutations stage a durable proposal and return REVIEW_REQUIRED; they do not persist until the developer applies in VS Code. On Oracle 8.62, portable SQL/HTML/freeform saves use complete metadata checkpoints with guarded creation inverse/redo. Older or nonportable existing edits retain their legacy history scope. A new Application Class is not staged: it saves through the legacy per-write confirmation.') + ' Supply changeSetId to group operations. Unsupported platforms retain legacy gates.',
            inputSchema: schema.extend({ changeSetId: z.string().uuid().optional(), dependsOn: z.array(z.string().uuid()).default([]) }) };
        return register(name, next, async (args, ...rest) => {
            if (args.dryRun === true)
                return callback(args, ...rest);
            const requestedProvider = await requireProvider(workspace, String(args.connection));
            if (requestedProvider instanceof DatabaseProvider && requestedProvider.platform !== 'oracle') {
                if (args.changeSetId || (args.dependsOn as string[]).length) throw new Error('Change Set grouping requires Oracle review adapters; no legacy write was performed.');
                return callback(args, ...rest);
            }
            const connection = String(args.connection), supplied = typeof args.changeSetId === 'string' ? await service.store.get(args.changeSetId) : undefined;
            // A tool cannot attach a request for one connection to another target's set.
            if (supplied && supplied.environment.connection !== requestedProvider.id)
                throw new Error('Change Set connection does not match the tool request.');
            if (supplied?.plan && (supplied.plan.review !== 'APPROVED' || supplied.plan.approvedHash !== planHash(supplied))) throw new Error('The implementation approach requires separate developer plan approval.');
            // A fall-through writes immediately, outside any Change Set. Refuse when the
            // caller named one: silently writing work the developer believes is staged
            // would leave it out of the set they review, apply and can revert.
            const refuseOutsideSet = (what: string) => {
                if (typeof args.changeSetId === 'string' || (Array.isArray(args.dependsOn) && args.dependsOn.length > 0))
                    throw new Error(`${what} It cannot be grouped into a Change Set: retry without changeSetId / dependsOn to write it through the per-write confirmation.`);
            };
            // A new Application Class has no review adapter (no package/class snapshot), so it keeps the legacy
            // confirmation gate; staging it would leave a proposal that can never apply.
            if (name === 'psft_save_peoplecode' && Number(args.type) === DefinitionType.ApplicationClassPeopleCode && requestedProvider instanceof DatabaseProvider
                && !(await requestedProvider.hasPeopleCode({ type: DefinitionType.ApplicationClassPeopleCode, parts: (args.parts as string[]).map(p => p.trim()) }))) {
                refuseOutsideSet('A new Application Class is not staged; it saves through the legacy per-write confirmation.');
                return callback(args, ...rest);
            }
            // Inserting or deleting a Page control is not stageable; it takes the legacy
            // per-write confirmation rather than being refused, as creation does.
            if (name === 'psft_edit_page' && !isStageablePageRequest(args.operations, args.saveInvalid)) {
                refuseOutsideSet('This Page operation (other properties, a Tree insert or saveInvalid) is not staged; it saves through the legacy per-write confirmation.');
                return callback(args, ...rest);
            }
            if (name === 'psft_create_project') {
                if (!supplied && (args.dependsOn as string[]).length) throw new Error('dependsOn requires its Change Set.');
                const context = supplied ? await service.proposedDependencies(supplied.id, args.dependsOn as string[]) : undefined;
                const proposal = await prepareProjectCreationReview(workspace, host?.(), args, context);
                const setId = supplied?.id ?? (await service.create('Review ' + name, connection)).id;
                const staged = await service.stage(setId, 'project-create', proposal.key, proposal.after, args.dependsOn as string[], undefined, proposal.expectedToken);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
            }
            if(name==='psft_ib_create'||name==='psft_ib_delete'){
                if(!supplied&&(args.dependsOn as string[]).length)throw new Error('dependsOn requires its Change Set.');
                const proposal=await prepareIbDefinitionReview(workspace,host?.(),name,args);
                if('outside' in proposal){refuseOutsideSet('This IB creation is outside lifecycle review ('+proposal.outside+').');return callback(args,...rest);}
                const setId=supplied?.id??(await service.create('Review '+name,connection)).id;
                const staged=await service.stage(setId,proposal.adapter,proposal.key,proposal.after,args.dependsOn as string[],undefined,proposal.expectedToken);
                return jsonResult({status:'REVIEW_REQUIRED',changeSetId:staged.id,revision:staged.revision,persisted:false,command:'psft.changeReview.open'});
            }
            const creationFamily = name === 'psft_create_record' ? 'record' : name === 'psft_ae_create' ? 'ae' : undefined;
            if (creationFamily) {
                if (creationFamily === 'record' && args.recordType !== 'derivedWork') {
                    refuseOutsideSet('SQL Table creation review is not supported yet.');
                    return callback(args, ...rest);
                }
                if (!supplied && (args.dependsOn as string[]).length) throw new Error('dependsOn requires its Change Set.');
                const context = supplied ? await service.proposedDependencies(supplied.id, args.dependsOn as string[]) : undefined;
                const proposal = await prepareStructuredCreationReview(workspace, host?.(), creationFamily, args, context);
                const setId = supplied?.id ?? (await service.create('Review ' + name, connection)).id;
                const staged = await service.stage(setId, proposal.adapter, proposal.key, proposal.after, args.dependsOn as string[], undefined, proposal.expectedToken);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
            }
            const preparedPage = name === 'psft_edit_page' ? await preparePageReview(workspace, host?.(), args) : undefined;
            const headerFamily = name === 'psft_edit_record' ? 'record' : name === 'psft_ae_edit' ? 'ae' : undefined;
            // A structural Record or App Engine edit has no review adapter, so -- like a
            // new Application Class -- it keeps the legacy
            // per-write confirmation instead of being refused. Refusing it left the edit
            // with no route at all: staging cannot carry it and nothing else was offered.
            if (headerFamily && !(headerFamily === 'record' ? isStageableRecordRequest(args.operations) : Array.isArray(args.operations) && args.operations.length > 0)) {
                refuseOutsideSet('This Record or App Engine operation is not staged; it saves through the legacy per-write confirmation.');
                return callback(args, ...rest);
            }
            const preparedHeader = headerFamily ? await prepareStructuredHeaderReview(workspace, host?.(), headerFamily, args) : undefined;
            const ibPreparation = name === 'psft_ib_save' ? await prepareIbHeaderReview(workspace, host?.(), args) : undefined;
            if (name === 'psft_ib_save' && (!ibPreparation || 'outside' in ibPreparation)) {
                refuseOutsideSet(`This IB edit is outside the bounded service/operation review contract${ibPreparation ? ` (${ibPreparation.outside})` : ''}.`);
                return callback(args, ...rest);
            }
            const preparedIb = ibPreparation && !('outside' in ibPreparation) ? ibPreparation : undefined;
            const setId = supplied?.id ?? (await service.create('Review ' + name, connection)).id;
            if (preparedIb) {
                const staged = await service.stage(setId, preparedIb.adapter, preparedIb.key, preparedIb.after, args.dependsOn as string[], undefined, preparedIb.expectedToken);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged.id, revision: staged.revision, persisted: false, command: 'psft.changeReview.open' });
            }
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
            if (name === 'psft_save_text_definition') {
                const p=await requireProvider(workspace,connection);
                if(p instanceof DatabaseProvider && (await p.readEnvironment()).toolsRelease==='8.62') {
                    const kind=args.type===30?'sql':args.type===51?'html':'stylesheet',key=String(args.name).trim().toUpperCase();
                    const prior=supplied?.objects.find(c=>[kind,kind+'-definition','migration-'+kind].includes(c.adapter)&&
                        (c.key===key||c.key&&typeof c.key==='object'&&!Array.isArray(c.key)&&Array.isArray(c.key.parts)&&c.key.parts[0]===key));
                    if(!prior||prior.adapter!==kind){
                        const native=makeKey(Number(args.type),key,...(kind==='sql'?['0']:kind==='html'?['4']:[]));
                        const legacy=kind==='sql'?await p.readSqlForEdit(native):await p.readReviewContent(native);
                        let full;
                        if(!legacy||prior)full=await p.readTextDefinitionForReview(kind,key);
                        else {try{full=await p.readTextDefinitionForReview(kind,key);}catch{/* Existing nonportable updates retain their legacy history contract. */}}
                        if(full){
                            // A text-only revision must keep metadata already proposed in
                            // this set, rather than silently resetting it to the database.
                            const proposed=prior?await service.store.readBlob(prior.after):null;
                            const old=proposed&&typeof proposed==='object'&&!Array.isArray(proposed)?proposed:full.value;
                            const after={...(old??(kind==='sql'?{name:key,description:'',definition:'',ownerId:''}:{name:key,description:''})),
                                text:kind==='sql'?prepareSqlText(String(args.text)):prepareHtmlText(String(args.text)),
                                description:kind==='sql'?old?.description??'':typeof args.description==='string'?args.description:old?.description??''};
                            const staged=await service.stage(setId,prior?.adapter??kind+'-definition',prior?.key??key,after,args.dependsOn as string[],undefined,full.token);
                            return jsonResult({status:'REVIEW_REQUIRED',changeSetId:staged.id,revision:staged.revision,persisted:false,command:'psft.changeReview.open'});
                        }
                    }
                }
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
            if (name === 'psft_query_delete' || name === 'psft_query_rename') {
                const proposals = await prepareQueryLifecycleReview(workspace, name, args);
                let staged;
                for (const proposal of proposals) staged = await service.stage(setId, 'query', proposal.key, proposal.after, args.dependsOn as string[], undefined, proposal.expectedToken);
                return jsonResult({ status: 'REVIEW_REQUIRED', changeSetId: staged!.id, revision: staged!.revision, persisted: false, command: 'psft.changeReview.open' });
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
