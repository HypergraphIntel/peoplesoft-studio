import { databaseMigrationTarget, readMigrationAsset } from '../providers/migrationTarget.js';
import { assetRequirements, containedMemberKeys, type MigrationAsset } from '../migrationPackage.js';
import { migrationAdapter, migrationReviewKey, reviewedMigrationAsset, migrationJson, readMigrationProject } from './migration.js';
import type { Snapshot } from './model.js';
import { prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import { pcmProgKeyParts } from '../model/peopleCodeKeys.js';
import { prepareHtmlText, contentTextRefusal } from '../providers/htmlWriter.js';
import { queryDiff } from './semanticDiff.js';
import { querySnapshot, queryView } from './query.js';
import { requestForPageSnapshot, nativePageDiff, pageReversalRefusal } from '../providers/pageSnapshot.js';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { DefinitionType, makeKey, type DefinitionKey } from '../model/definitions.js';
import { decideWrite } from '../model/ownership.js';
import { effectivePolicy, runAsAgent } from '../providers/writeGuard.js';
import { writeScopeRefusal } from '../providers/writeScope.js';
import { prepareSqlText, SQL_TEXT_ROW_LIMIT } from '../providers/sqlWriter.js';
import { processEdit, processToken, validateProcessEdit, type ProcessEdit } from '../model/processEdit.js';
import { hash, type Environment, type Json } from './model.js';
import type { ReviewAdapter, ReviewValidationContext } from './service.js';
import { withReviewedWrite, reviewedPolicyIdentity } from './authorization.js';
import type { McpWriteHost } from '../mcp/writeTools.js';
import { requireProvider } from '../mcp/tools.js';
import { recordStructureRequest, aeHeaderDocument, isHeaderChange, structuredHeaderDiff } from './structuredHeaders.js';
import { aeDocumentFromSnapshot, aeTombstoneProjection } from './aeStructure.js';
import { classKey, type LifecycleScope } from '../providers/classLifecycle.js';
import type { StructuredFamily } from '../providers/structuredSnapshot.js';
import { deepValidate } from '../mcp/appEngineTools.js';
import { ibDefinitionKey } from '../model/ibOperations.js';
import { ibHeaderChange, ibHeaderInput, ibHeaderDiff } from './ibHeaders.js';
import { ibStructuralChange, ibStructuralInput, ibStructuralReversalRefusal } from './ibStructure.js';
import { creationKey, creationRecordEdit, creationAeDocument, proposedAeReferences, proposedProjectMembers } from './structuredCreation.js';
import { projectReviewName, projectCreationItems } from '../providers/projectSnapshot.js';
import type { IbReviewKind } from '../providers/ibSnapshot.js';
import { ibLifecycleIdentity, type IbLifecycleKey } from '../providers/ibLifecycle.js';
import { textDefinitionData, type TextDefinitionKind } from '../providers/textDefinitionWriter.js';
export function databaseReviewAdapters(workspace: Workspace, host: () => McpWriteHost | undefined) {
    async function provider(environment: Environment): Promise<DatabaseProvider> {
        const p = await workspace.require(environment.connection);
        if (!(p instanceof DatabaseProvider) || !p.isConnected)
            throw new Error('A connected database is required.');
        if (await p.changeReviewIdentity() !== environment.identity)
            throw new Error('Review target changed.');
        return p;
    }
    async function authorize(e: Environment, key: DefinitionKey): Promise<{
        p: DatabaseProvider;
        operator: string;
        policyIdentity: string;
    }> {
        const p = await provider(e), h = host();
        if (!h || h.mode() === 'off' || !workspace.isWritable(p.id))
            throw new Error('Reviewed writes are disabled or the connection is read-only.');
        const operator = workspace.configFor(p.id)?.peoplesoftOperatorId?.trim();
        if (!operator)
            throw new Error('A configured Operator ID is required.');
        if ([DefinitionType.SqlDefinition, DefinitionType.HtmlDefinition, DefinitionType.StyleSheet].includes(key.type) && !workspace.isSqlWritable(p.id, key))
            throw new Error('SQL definitions cannot be saved on this connection.');
        const scope = writeScopeRefusal(key.type === DefinitionType.ProcessDefinition ? key.parts[1] : key.parts[0]);
        if (scope)
            throw new Error(scope);
        if (h.hasUnsavedEditor(p.id, key))
            throw new Error('An editor has unsaved changes. Save or discard them first.');
        const policy = effectivePolicy(), owned = await p.classifyDefinition(key, policy.prefixes);
        if (decideWrite(owned.classification, policy.agentDeliveredObjectPolicy, owned.evidence.exists).action === 'refuse')
            throw new Error('Delivered-object policy blocks this change.');
        return { p, operator, policyIdentity: reviewedPolicyIdentity(policy, owned.classification, owned.evidence.exists) };
    }
    async function authorizationState(e: Environment, key: DefinitionKey): Promise<string> { const p = await provider(e), policy = effectivePolicy(), owned = await p.classifyDefinition(key, policy.prefixes); return hash({ policyIdentity: reviewedPolicyIdentity(policy, owned.classification, owned.evidence.exists), operator: workspace.configFor(p.id)?.peoplesoftOperatorId?.trim() ?? '', writable: workspace.isWritable(p.id), mode: host()?.mode() ?? 'off' }); }
    async function authorizeReviewed(e: Environment, key: DefinitionKey, baseline: Snapshot) { const gate = await authorize(e, key); if (baseline.authorization && await authorizationState(e, key) !== baseline.authorization)
        throw new Error('Review authorization changed before the native writer.'); return gate; }
    async function warnings(e: Environment, key: DefinitionKey): Promise<string[]> { const p = await provider(e), policy = effectivePolicy(), owned = await p.classifyDefinition(key, policy.prefixes); return ['Ownership: ' + owned.classification.ownership + ' (' + owned.classification.confidence + ')', 'Agent delivered-object policy: ' + policy.agentDeliveredObjectPolicy, 'Preferred strategy: ' + policy.defaultStrategy + '; this is not permission to write.', 'Only explicitly staged dependencies are ordered; complete external dependency coverage is not established.']; }
    const sqlKey = (key: Json) => {
        if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,29}$/.test(key))
            throw new Error('SQL key must be a valid uppercase SQL ID.');
        return makeKey(DefinitionType.SqlDefinition, key, '0');
    };
    const processKey = (key: Json) => {
        if (!Array.isArray(key) || key.length !== 2 || key.some(x => typeof x !== 'string' || !x.trim()))
            throw new Error('Process key is [process type, name].');
        return makeKey(DefinitionType.ProcessDefinition, ...key as string[]);
    };
    const pageKey = (key: Json) => {
        if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_#@$]{0,17}$/.test(key)) throw new Error('Page key must be an uppercase native Page name.');
        return makeKey(DefinitionType.Page, key);
    };
    const page: ReviewAdapter = { id: 'page', diff: nativePageDiff, reversalRefusal: (_key, before, after) => pageReversalRefusal(before, after),
        authorizationState: (e, key) => authorizationState(e, pageKey(key)), warnings: async (e, key) => [...await warnings(e, pageKey(key)), 'Control geometry, labels/use, description/comments, inserted/deleted controls, tab order and Edit Box rebinding. Native writer normalization (ids, tab places, levels, Related Field references) is included in review. Restoration re-inserts only reviewed rows of this Page under their own ids. No Page creation/deletion, Tree restoration or arbitrary row replay.'],
        read: async (e, key) => { const p = await provider(e), read = await p.readPageForReview(pageKey(key).parts[0]); return { value: read.value as unknown as Json, token: read.token }; },
        validate: async (e, key, before, after) => {
            try {
                const k = pageKey(key), { p, operator } = await authorize(e, k), current = await p.readPageForReview(k.parts[0]);
                if (hash(current.value) !== hash(before)) return ['Page baseline changed before native validation.'];
                const request = requestForPageSnapshot(k.parts[0], before, after, current.version, operator);
                const preview = await p.savePage({ ...request, dryRun: true, captureSnapshots: true, expectedSnapshotToken: current.token });
                if (!preview.snapshots || preview.snapshots.before.hash !== hash(before) || preview.snapshots.after.hash !== hash(after))
                    return ['Page proposal is not exactly reproducible by the bounded native writer. Unsupported changes or normalization require a new preview.'];
                return [];
            } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
        },
        authorize: async (e, key) => { await authorize(e, pageKey(key)); },
        write: async (e, key, after, baseline) => {
            const k = pageKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline), live = await p.readPageForReview(k.parts[0]);
            if (live.token !== baseline.token || hash(live.value) !== hash(baseline.value)) throw new Error('Native Page changed before approved application.');
            const request = requestForPageSnapshot(k.parts[0], live.value, after, live.version, operator);
            await withReviewedWrite(p.id, k, () => runAsAgent(() => p.savePage({ ...request, expectedSnapshotToken: baseline.token })), policyIdentity);
            host()!.saved(p.id, k);
        }
    };
    const structuredHeader = (family: StructuredFamily): ReviewAdapter => {
        const keyOf = (key: Json) => {
            if (typeof key !== 'string' || !(family === 'record' ? /^[A-Z][A-Z0-9_]{0,14}$/ : /^[A-Z][A-Z0-9_]{0,11}$/).test(key)) throw new Error('Invalid structured definition key.');
            return makeKey(family === 'record' ? DefinitionType.Record : DefinitionType.AppEngineProgram, key);
        };
        async function request(p: DatabaseProvider, name: string, before: Json, after: Json, version: number, operatorId: string, token: string, preview: boolean) {
            if (family === 'record') return p.saveRecord({ ...recordStructureRequest(name, before, after, version, operatorId), expectedSnapshotToken: token, ...(preview ? { dryRun: true, captureSnapshots: true } : {}) });
            const live = await p.readAppEngineDocument(name);
            if (!live) throw new Error('Application Engine program no longer exists.');
            // A header-only change edits the live document; any other change saves the document the after-image stores.
            const doc = isHeaderChange(before, after, family, name) ? aeHeaderDocument(name, before, after, live.doc) : aeDocumentFromSnapshot(name, after);
            const errors = (await deepValidate(p, doc)).filter(d => d.severity === 'error');
            if (errors.length) throw new Error(errors.map(d => d.path + ': ' + d.message).join('\n'));
            return p.saveAppEngineDocument({ doc, openedToken: live.token, operatorId, expectedSnapshotToken: token, ...(preview ? { dryRun: true, captureSnapshots: true } : {}) });
        }
        return { id: family, diff: structuredHeaderDiff(family), authorizationState: (e, key) => authorizationState(e, keyOf(key)),
            ...(family === 'ae' ? { inverseTarget: async (e: Environment, key: Json, checkpoint: Json, liveValue: Json) => {
                // Undoing an added section, step, SQL or PeopleCode deletes it, and App Designer records each deleted key as a
                // tombstone: the reachable target is the checkpoint plus those records, verified by native preview.
                const k = keyOf(key), { p, operator } = await authorize(e, k), current = await p.readStructuredForReview(family, k.parts[0]);
                if (current.hash !== hash(liveValue)) throw new Error('Live state changed since application; reversal blocked.');
                const result = await request(p, k.parts[0], liveValue, checkpoint, current.version, operator, current.token, true);
                if (!result.snapshots) throw new Error('Native preview did not return the undo target.');
                const after = result.snapshots.after.value as unknown as Json, refusal = aeTombstoneProjection(checkpoint, liveValue, after);
                if (refusal) throw new Error(refusal);
                return after;
            } } : {}),
            warnings: async (e, key) => [...await warnings(e, keyOf(key)), family === 'record'
                ? 'Record metadata only: description/comments and field structure (insert/remove/move fields and subrecords, Use, Edits, default, label). No physical DDL or data: build the table separately; undoing a removal restores the metadata, not dropped column data. Removing a field still used by its PeopleCode, pages, queries or other records is refused.'
                : 'Program, sections, steps and actions as the App Engine document stores them, saved by the shared writer (SQL and PeopleCode compiled and validated as on any save). Undo restores the checkpoint plus the deletion records App Designer writes for removed keys. No program creation/deletion, rename or copy here.'],
            read: async (e, key) => { const p = await provider(e), live = await p.readStructuredForReview(family, keyOf(key).parts[0]); return { value: live.value as unknown as Json, token: live.token }; },
            validate: async (e, key, before, after) => {
                try {
                    const k = keyOf(key), { p, operator } = await authorize(e, k), live = await p.readStructuredForReview(family, k.parts[0]);
                    if (live.hash !== hash(before)) return ['Structured baseline changed before validation.'];
                    const result = await request(p, k.parts[0], before, after, live.version, operator, live.token, true);
                    if (!result.snapshots || result.snapshots.before.hash !== hash(before) || result.snapshots.after.hash !== hash(after)) return ['Bounded native header writer cannot reproduce this complete proposal exactly.'];
                    return [];
                } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
            },
            authorize: async (e, key) => { await authorize(e, keyOf(key)); },
            write: async (e, key, after, baseline) => {
                const k = keyOf(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline), live = await p.readStructuredForReview(family, k.parts[0]);
                if (live.token !== baseline.token || live.hash !== hash(baseline.value)) throw new Error('Structured definition changed before approved application.');
                await withReviewedWrite(p.id, k, () => runAsAgent(() => request(p, k.parts[0], baseline.value, after, live.version, operator, live.token, false)), policyIdentity);
                host()!.saved(p.id, k);
            }
        };
    };
    // Application Class and Package lifecycle: complete scope checkpoints and the calibrated typed writers (classLifecycle.ts).
    const lifecycle = (kind: 'class' | 'package'): ReviewAdapter => {
        const parts = (key: Json): string[] => {
            if (kind === 'class') { const k = classKey(key); return [k.root, ...k.path, k.className]; }
            if (typeof key !== 'string' || !/^[A-Z0-9_]{1,30}$/.test(key)) throw new Error('A package key is its root name.');
            return [key];
        };
        const defn = (key: Json) => kind === 'class' ? makeKey(DefinitionType.ApplicationClassPeopleCode, ...parts(key)) : makeKey(DefinitionType.ApplicationPackage, parts(key)[0]);
        const scope = (value: Json) => value as unknown as LifecycleScope | null;
        return { id: kind === 'class' ? 'app-class' : 'app-package', canDelete: true,
            scope: key => (kind === 'class' ? 'app-class:' : 'app-package:') + parts(key).join(':'),
            authorizationState: (e, key) => authorizationState(e, defn(key)),
            warnings: async (e, key) => [...await warnings(e, defn(key)), kind === 'class'
                ? 'Application Class lifecycle: creating, deleting or saving one class with its PeopleCode, as App Designer does (c04-c06, dl09). A new class\'s subpackages must already exist. Deleting a class leaves a PSPCMPROGDEL marker that re-creating it clears.'
                : 'Application Package lifecycle: creating a root package with its subpackages and properties (c03, c05, pk01), or deleting an empty package (dl04). Classes are their own reviewed objects.'],
            read: async (e, key) => { const p = await provider(e), live = await p.readLifecycleForReview(kind, parts(key)); return { value: live.value as unknown as Json, token: live.token }; },
            validate: async (e, key, before, after) => {
                try {
                    const { p, operator } = await authorize(e, defn(key)), live = await p.readLifecycleForReview(kind, parts(key));
                    if (live.hash !== hash(before)) return ['Package or class baseline changed before validation.'];
                    const preview = await p.runLifecycleChange(kind, parts(key), scope(after), operator, live.token, true);
                    return preview.after.hash === hash(after) ? [] : ['The calibrated package/class writers cannot reproduce this proposal exactly.'];
                } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
            },
            authorize: async (e, key) => { await authorize(e, defn(key)); },
            write: async (e, key, after, baseline) => {
                const k = defn(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline), live = await p.readLifecycleForReview(kind, parts(key));
                if (live.token !== baseline.token || live.hash !== hash(baseline.value)) throw new Error('Package or class changed before approved application.');
                await withReviewedWrite(p.id, k, () => runAsAgent(() => p.runLifecycleChange(kind, parts(key), scope(after), operator, live.token, false)), policyIdentity);
                host()!.saved(p.id, k);
            } };
    };
    const sql: ReviewAdapter = { id: 'sql', scope:key=>'text:sql:'+sqlKey(key).parts[0], authorizationState: (e, key) => authorizationState(e, sqlKey(key)), warnings: (e, key) => warnings(e, sqlKey(key)), normalize: value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' ? { ...value, text: prepareSqlText(value.text) } : value,
        read: async (e, key) => {
            const p = await provider(e), k = sqlKey(key), read = await p.readSqlForEdit(k);
            if (!read && await p.sqlIdTaken(k.parts[0]))
                throw new Error('The ID is not a supported plain SQL definition.');
            return { value: read ? { text: read.text } : null, token: read ? String(read.version) : 'absent' };
        },
        validate: async (_e, key, _before, after) => {
            sqlKey(key);
            if (!after || Array.isArray(after) || typeof after !== 'object' || Object.keys(after).join(',') !== 'text' || typeof after.text !== 'string')
                return ['SQL snapshot must contain text only.'];
            if (prepareSqlText(after.text) !== after.text)
                return ['SQL text must use the native CRLF/trailing-space normalization before review.'];
            return !after.text || after.text.length > SQL_TEXT_ROW_LIMIT ? ['SQL text is empty or exceeds the calibrated row limit.'] : [];
        },
        authorize: async (e, key) => { await authorize(e, sqlKey(key)); },
        write: async (e, key, after, baseline) => {
            const k = sqlKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline);
            if (!after || Array.isArray(after) || typeof after !== 'object' || typeof after.text !== 'string')
                throw new Error('Unsupported SQL proposal.');
            await withReviewedWrite(p.id, k, () => runAsAgent(() => p.saveSqlDefinition({ sqlId: k.parts[0], text: after.text as string, operatorId: operator, ...(baseline.token !== 'absent' ? { openedVersion: Number(baseline.token) } : {}) })), policyIdentity);
            host()!.saved(p.id, k);
        }
    };
    const content = (id: 'html' | 'stylesheet', type: DefinitionType): ReviewAdapter => {
        const keyOf = (key: Json) => {
            if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,29}$/.test(key))
                throw new Error('Invalid text definition name.');
            return makeKey(type, key, ...(type === DefinitionType.HtmlDefinition ? ['4'] : []));
        };
        return { id, scope:key=>'text:content:'+keyOf(key).parts[0], authorizationState: (e, key) => authorizationState(e, keyOf(key)), warnings: (e, key) => warnings(e, keyOf(key)), normalize: value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' ? { ...value, text: prepareHtmlText(value.text), ...(typeof value.description === 'string' ? { description: value.description.trimEnd() } : {}) } : value,
            read: async (e, key) => { const p = await provider(e), read = await p.readReviewContent(keyOf(key)); return { value: read ? { text: read.text, description: read.description } : null, token: read ? String(read.version) : 'absent' }; },
            validate: async (_e, key, _before, after) => {
                keyOf(key);
                if (!after || Array.isArray(after) || typeof after !== 'object' || Object.keys(after).some(k => !['text', 'description'].includes(k)) || typeof after.text !== 'string' || typeof after.description !== 'string' || after.description.length > 30)
                    return ['Text snapshot requires text and description (at most 30 characters).'];
                const refusal = contentTextRefusal(after.text);
                return refusal ? [refusal] : [];
            },
            authorize: async (e, key) => { await authorize(e, keyOf(key)); },
            write: async (e, key, after, baseline) => {
                const k = keyOf(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline);
                if (!after || typeof after !== 'object' || Array.isArray(after) || typeof after.text !== 'string' || typeof after.description !== 'string')
                    throw new Error('Invalid text snapshot.');
                const request = { name: k.parts[0], text: after.text, description: after.description, operatorId: operator, ...(baseline.token === 'absent' ? {} : { openedVersion: Number(baseline.token) }) };
                await withReviewedWrite(p.id, k, () => runAsAgent(() => type === DefinitionType.HtmlDefinition ? p.saveHtmlDefinition(request) : p.saveStyleSheet(request)), policyIdentity);
                host()!.saved(p.id, k);
            }
        };
    };
    const textDefinition = (kind:TextDefinitionKind):ReviewAdapter => {
        const keyOf=(key:Json)=>{if(typeof key!=='string'||!/^[A-Z][A-Z0-9_]{0,29}$/.test(key))throw Error('Invalid complete text-definition key.');return makeKey(kind==='sql'?DefinitionType.SqlDefinition:kind==='html'?DefinitionType.HtmlDefinition:DefinitionType.StyleSheet,key,...(kind==='sql'?['0']:kind==='html'?['4']:[]));};
        return {id:kind+'-definition',canDelete:true,scope:key=>'text:'+(kind==='sql'?'sql':'content')+':'+keyOf(key).parts[0],
            authorizationState:(e,key)=>authorizationState(e,keyOf(key)),
            warnings:async(e,key)=>[...await warnings(e,keyOf(key)),'Complete bounded SQL/HTML/freeform checkpoint, native tombstones and locked token. Project, metadata and stored-source mentions can block deletion, including comments; dynamic references remain unknown. Reviewed recreation clears only its bound native markers. Oracle PeopleTools 8.62 only.'],
            normalize:value=>value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.text==='string'?{...value,text:kind==='sql'?prepareSqlText(value.text):prepareHtmlText(value.text)}:value,
            read:async(e,key)=>{const live=await(await provider(e)).readTextDefinitionForReview(kind,keyOf(key).parts[0],true);return {value:live.value as unknown as Json,token:live.token};},
            authorize:async(e,key)=>{await authorize(e,keyOf(key));},
            validate:async(e,key,before,after,context)=>{try{
                const k=keyOf(key),{p,operator}=await authorize(e,k),live=await p.readTextDefinitionForReview(kind,k.parts[0],true);
                if(hash(live.value)!==hash(before))return ['Complete text baseline changed before validation.'];
                const data=after===null?null:textDefinitionData(kind,k.parts[0],after);
                const dependencies=context?.phase==='proposal'?context.dependencies:[];
                await p.writeTextDefinitionForReview({kind,name:k.parts[0],after:data,operatorId:operator,expectedSnapshotToken:live.token,expectedAfterHash:hash(after),allowDeletedBaseline:true,dryRun:true,
                    proposedProjectDeletions:dependencies.filter(d=>['project-create','migration-project'].includes(d.adapter)&&d.after===null&&typeof d.key==='string').map(d=>d.key as string),
                    // An App Engine program deleted first by the same inverse (created alone or by a migration) no longer uses this text.
                    proposedAeDeletions:dependencies.filter(d=>(d.adapter==='ae-create'&&typeof d.key==='string'||d.adapter==='migration-ae')&&d.after===null).map(d=>typeof d.key==='string'?d.key:migrationReviewKey(d.key).parts[0]),
                    proposedTextDeletions:dependencies.flatMap(d=>{const family=d.adapter.replace(/-definition$/,'').replace(/^migration-/,'');if(d.after!==null||!['sql','html','stylesheet'].includes(family)||!(/-definition$/.test(d.adapter)||d.adapter.startsWith('migration-')))return [];return [{kind:family as TextDefinitionKind,name:typeof d.key==='string'?d.key:migrationReviewKey(d.key).parts[0]}];})});
                return [];
            }catch(error){return [error instanceof Error?error.message:String(error)];}},
            write:async(e,key,after,baseline)=>{
                const k=keyOf(key),{p,operator,policyIdentity}=await authorizeReviewed(e,k,baseline),live=await p.readTextDefinitionForReview(kind,k.parts[0],true);
                if(live.token!==baseline.token||hash(live.value)!==hash(baseline.value))throw Error('Complete text baseline changed before writer.');
                const data=after===null?null:textDefinitionData(kind,k.parts[0],after);
                await withReviewedWrite(p.id,k,()=>runAsAgent(()=>p.writeTextDefinitionForReview({kind,name:k.parts[0],after:data,operatorId:operator,expectedSnapshotToken:baseline.token,expectedAfterHash:hash(after),allowDeletedBaseline:true})),policyIdentity);
                host()!.saved(p.id,k);
            }
        };
    };
    const process: ReviewAdapter = { id: 'process', authorizationState: (e, key) => authorizationState(e, processKey(key)), warnings: (e, key) => warnings(e, processKey(key)), normalize: value => value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.components) && Array.isArray(value.groups) && [...value.components, ...value.groups].every(x => typeof x === 'string') ? { ...value, components: [...value.components].sort(), groups: [...value.groups].sort() } : value,
        read: async (e, key) => { const p = await provider(e), view = await p.readProcessDocument(processKey(key)); return { value: processEdit(view) as unknown as Json, token: processToken(view) }; },
        validate: async (e, key, before, after) => {
            const p = await provider(e), view = await p.readProcessDocument(processKey(key));
            try {
                if (!after || Array.isArray(after) || typeof after !== 'object' || Object.keys(after).some(k => !['properties', 'components', 'groups'].includes(k)))
                    return ['Unsupported Process snapshot properties.'];
                const edit = validateProcessEdit(after, view);
                if (before === null)
                    return ['Process creation is not calibrated.'];
                const b = before as unknown as ProcessEdit;
                if (['OUTDESTTYPE', 'OUTDESTSRC'].some(k => edit.properties[k] !== b.properties[k]))
                    return ['Output-mode normalization needs a dedicated staging adapter; this change is not supported yet.'];
                return [];
            }
            catch (error) {
                return [error instanceof Error ? error.message : String(error)];
            }
        },
        authorize: async (e, key) => { await authorize(e, processKey(key)); },
        write: async (e, key, after, baseline) => { const k = processKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline); await withReviewedWrite(p.id, k, () => runAsAgent(() => p.saveProcessDocument({ key: [...k.parts], edit: after as unknown as ProcessEdit, token: baseline.token, operatorId: operator })), policyIdentity); host()!.saved(p.id, k); }
    };
    const codeKey = (key: Json): DefinitionKey => {
        if (!key || Array.isArray(key) || typeof key !== 'object' || typeof key.type !== 'number' || !Array.isArray(key.parts) || key.parts.some(p => typeof p !== 'string'))
            throw new Error('PeopleCode key requires type and parts.');
        const allowed = [8, 9, 42, 43, 44, 46, 47, 48, 58];
        if (!allowed.includes(key.type))
            throw new Error('Unsupported PeopleCode type.');
        const result = { type: key.type as DefinitionType, parts: (key.parts as string[]).map(p => p.trim()) };
        pcmProgKeyParts(result);
        return result;
    };
    const peoplecode: ReviewAdapter = {
        id: 'peoplecode', authorizationState: (e, key) => authorizationState(e, codeKey(key)), warnings: (e, key) => warnings(e, codeKey(key)),
        canDelete: key => codeKey(key).type !== DefinitionType.ApplicationClassPeopleCode,
        normalize: value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' ? (prepareSourceForSave(value.text) ? { ...value, text: prepareSourceForSave(value.text) } : null) : value,
        read: async (e, key) => {
            const p = await provider(e), k = codeKey(key), read = await p.readPeopleCodeForEdit(k);
            if (!read && await p.hasPeopleCode(k))
                throw new Error('Stored authoritative source is unavailable; no decompiled baseline will be invented.');
            return { value: read ? { text: read.text } : null, token: read?.fingerprint ?? 'absent' };
        },
        validate: async (e, key, before, after) => {
            try {
                const p = await provider(e), k = codeKey(key);
                if (before === null && k.type === DefinitionType.ApplicationClassPeopleCode)
                    return ['New classes need package/class snapshot coverage.'];
                if (after === null)
                    return k.type === DefinitionType.ApplicationClassPeopleCode ? ['Class deletion is not supported.'] : [];
                if (typeof after !== 'object' || Array.isArray(after) || Object.keys(after).join(',') !== 'text' || typeof after.text !== 'string')
                    return ['PeopleCode snapshot must contain source text only.'];
                await p.validateReviewedPeopleCode(k, after.text);
                return [];
            }
            catch (error) {
                return [error instanceof Error ? error.message : String(error)];
            }
        },
        authorize: async (e, key) => {
            const k = codeKey(key), { p } = await authorize(e, k);
            if (!workspace.isPeopleCodeWritable(p.id, k))
                throw new Error('PeopleCode is read-only on this connection.');
            if (workspace.configFor(p.id)?.peoplecodeSaveMode === 'save-only')
                throw new Error('Compile and save mode is required.');
        },
        write: async (e, key, after, baseline) => {
            const k = codeKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline);
            if (!workspace.isPeopleCodeWritable(p.id, k))
                throw new Error('PeopleCode is read-only.');
            const text = after && typeof after === 'object' && !Array.isArray(after) && typeof after.text === 'string' ? after.text : '';
            const result = await withReviewedWrite(p.id, k, () => runAsAgent(() => p.savePeopleCode(k, { source: text, openedFingerprint: baseline.token, operatorId: operator })), policyIdentity);
            host()!.saved(p.id, k, result);
        }
    };
    const queryKey = (key: Json) => {
        if (!Array.isArray(key) || key.length !== 2 || key.some(x => typeof x !== 'string'))
            throw new Error('Query key is [name, owner].');
        return makeKey(DefinitionType.Query, ...(key as string[]).map(p=>p.trim()));
    };
    async function queryAccess(e: Environment, key: Json) {
        const p = await provider(e), k = queryKey(key), operator = workspace.configFor(p.id)?.peoplesoftOperatorId?.trim();
        if (!operator)
            throw new Error('Configure an Operator ID.');
        if ((k.parts[1] ?? '').trim() && (k.parts[1] ?? '').trim() !== operator)
            throw new Error('Only public or own private Queries can be reviewed.');
        return { p, k, operator };
    }
    const query: ReviewAdapter = { id: 'query', canDelete:true,scope:key=>'query:'+JSON.stringify(queryKey(key).parts),
        authorizationState: (e, key) => authorizationState(e, queryKey(key)),
        warnings:async(e,key)=>[...await warnings(e,queryKey(key)),'Oracle 8.62 supports bounded Query creation deletion/redo with full native tokens, owner-specific tombstones and actual rollback preview. Known references/source mentions can block deletion; dynamic references remain unknown. Other releases retain existing create/update gates.'],diff: queryDiff,
        read: async (e, key) => { const { p, k } = await queryAccess(e, key);
            if((await p.readEnvironment()).toolsRelease==='8.62'){const state=await p.readQueryForReview(k.parts[0],k.parts[1]??'',true);return {value:state.value,token:state.token};}
            const read = await p.readQueryDocument(k.parts[0], k.parts[1] ?? ''); return { value: read ? querySnapshot(read.view) : null, token: read?.token ?? 'absent' }; },
        validate: async (e, key, before, after,context) => {
            try {
                const { p, k, operator } = await queryAccess(e, key);
                if((await p.readEnvironment()).toolsRelease==='8.62'){
                    const live=await p.readQueryForReview(k.parts[0],k.parts[1]??'',true);
                    if(hash(live.value)!==hash(before))return ['Complete Query baseline changed.'];
                    await p.writeQueryForReview({name:k.parts[0],owner:k.parts[1]??'',after,operatorId:operator,expectedSnapshotToken:live.token,expectedAfterHash:hash(after),allowDeletedBaseline:true,dryRun:true,
                        proposedProjectDeletions:context?.phase==='proposal'?context.dependencies.filter(d=>['project-create','migration-project'].includes(d.adapter)&&d.after===null&&typeof d.key==='string').map(d=>d.key as string):[]});return [];
                }
                if(after===null)return ['Query deletion is calibrated only for Oracle PeopleTools 8.62.'];
                const view = queryView(after);
                if (String(view.query.QRYNAME).trim() !== k.parts[0] || String(view.query.OPRID).trim() !== (k.parts[1] ?? '').trim())return ['Query key cannot change inside a snapshot.'];
                await p.prepareQuery(view, operator);return [];
            }catch (error) {return [error instanceof Error ? error.message : String(error)];}
        },
        authorize: async (e, key) => { await queryAccess(e, key); await authorize(e, queryKey(key)); },
        write: async (e, key, after, baseline) => {
            const k = queryKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline);await queryAccess(e, key);
            if((await p.readEnvironment()).toolsRelease==='8.62'){
                const live=await p.readQueryForReview(k.parts[0],k.parts[1]??'',true);if(live.token!==baseline.token||hash(live.value)!==hash(baseline.value))throw Error('Complete Query baseline changed before writer.');
                await withReviewedWrite(p.id,k,()=>runAsAgent(()=>p.writeQueryForReview({name:k.parts[0],owner:k.parts[1]??'',after,operatorId:operator,expectedSnapshotToken:baseline.token,expectedAfterHash:hash(after),allowDeletedBaseline:true})),policyIdentity);
            }else{
                if(after===null)throw Error('Query deletion is calibrated only for Oracle PeopleTools 8.62.');
                const proposed = queryView(after), read = await p.readQueryDocument(k.parts[0], k.parts[1] ?? '');if (read)proposed.query = { ...read.view.query, ...proposed.query };
                await withReviewedWrite(p.id, k, () => runAsAgent(() => p.saveQueryDocument({ view: proposed, openedToken: baseline.token, operatorId: operator })), policyIdentity);
            }host()!.saved(p.id, k);
        }
    };
    const ibHeader = (kind: IbReviewKind): ReviewAdapter => {
        const keyOf = (key: Json) => {
            if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,29}$/.test(key)) throw new Error('Invalid IB review name.');
            return ibDefinitionKey(kind, [key]);
        };
        /** Header-only edits keep their original typed path; other edits must be inside the bounded structural contract (ibStructure.ts). */
        const headerOnly = (name: string, before: Json, after: Json) => { try { ibHeaderChange(before, after, kind, name); return true; } catch { return false; } };
        async function request(p: DatabaseProvider, name: string, before: Json, after: Json, operatorId: string, token: string, preview: boolean) {
            const header = headerOnly(name, before, after);
            if (!header) ibStructuralChange(before, after, kind, name);
            const live = await p.readIntegrationBroker(kind, [name]);
            if (!live) throw new Error('IB definition no longer exists.');
            const input = header ? ibHeaderInput(before, after, kind, name, live) : ibStructuralInput(before, after, kind, name, live);
            return p.saveIntegrationBroker({ input, expectedToken: live.token, operatorId, expectedSnapshotToken: token, expectedAfterHash: hash(after), ...(preview ? { dryRun: true, captureSnapshots: true } : {}) });
        }
        return { id: 'ib-' + kind, scope:key=>'ib-'+kind+':'+keyOf(key).parts[0], diff: ibHeaderDiff(kind), authorizationState: (e, key) => authorizationState(e, keyOf(key)),
            reversalRefusal: (key, before, after) => { const name = keyOf(key).parts[0]; return headerOnly(name, before, after) ? undefined : ibStructuralReversalRefusal(before, after, kind, name); },
            warnings: async (e, key) => [...await warnings(e, keyOf(key)), 'Existing service/operation only: description/comments, plus the bounded structure contract (service owner/namespace/application; operation header except service, routing type, REST method, alias and message binding; existing versions, parameters, handlers and class implementations; existing REST URI template text with URI variable dependencies preserved; adding the calibrated ApplicationClass OnRequest handler). Fixed noncredential preservation scope; credentials are never selected or restored and credential freshness is not certified. No definition create/delete or raw row replay. Paired ApplicationClass REQUESTHDLR/RQST removal and tombstone-bound recreation are calibrated on 8.62.09 only; translated handlers, other implementations and routing handler references refuse deletion. Native reviewed apply/inverse verified on HRDMO (8.62) for the recorded standard header and structural trials, and a REST provider handler addition; 8.61 and REST consumer structural application are not certified.'],
            read: async (e, key) => { const p = await provider(e), live = await p.readIbForReview(kind, keyOf(key).parts[0]); return { value: live.value as unknown as Json, token: live.token }; },
            authorize: async (e, key) => { await authorize(e, keyOf(key)); },
            validate: async (e, key, before, after) => {
                try {
                    const k = keyOf(key), { p, operator } = await authorize(e, k), live = await p.readIbForReview(kind, k.parts[0]);
                    if (live.hash !== hash(before)) return ['IB baseline changed before validation.'];
                    const result = await request(p, k.parts[0], before, after, operator, live.token, true);
                    if (!result.snapshots || result.snapshots.before.hash !== hash(before) || result.snapshots.after.hash !== hash(after)) return ['IB writer cannot reproduce this complete proposal exactly.'];
                    return [];
                } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
            },
            write: async (e, key, after, baseline) => {
                const k = keyOf(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline), live = await p.readIbForReview(kind, k.parts[0]);
                if (live.token !== baseline.token || live.hash !== hash(baseline.value)) throw new Error('IB definition changed before approved application.');
                await withReviewedWrite(p.id, k, () => runAsAgent(() => request(p, k.parts[0], baseline.value, after, operator, baseline.token, false)), policyIdentity);
                host()!.saved(p.id, k);
            }
        };
    };
    const ibDefinition=(kind:IbReviewKind):ReviewAdapter=>{
        const identity=(key:Json):IbLifecycleKey=>{
            if(!Array.isArray(key)||key.length!==(kind==='service'?1:2)||key.some(k=>typeof k!=='string'))throw new Error('IB lifecycle key is [name] or [operation, owning service].');
            const k:IbLifecycleKey={kind,name:key[0] as string,...(kind==='operation'?{service:key[1] as string}:{})};ibLifecycleIdentity(k);return k;
        };
        const keys=(key:Json)=>{const k=identity(key);return [ibDefinitionKey(kind,[k.name]),...(k.service?[ibDefinitionKey('service',[k.service])]:[])];};
        const authState=async(e:Environment,key:Json)=>hash(await Promise.all(keys(key).map(k=>authorizationState(e,k))));
        const gates=async(e:Environment,key:Json)=>Promise.all(keys(key).map(k=>authorize(e,k)));
        return {id:'ib-'+kind+'-definition',canDelete:true,
            scopes:key=>{const k=identity(key);return ['ib-'+kind+':'+k.name,...(k.service?['ib-service:'+k.service]:[])];},
            authorizationState:authState,
            warnings:async(e,key)=>[...(await Promise.all(keys(key).map(k=>warnings(e,k)))).flat(),
                'Oracle PeopleTools 8.62.09: typed CREATE/DELETE and reviewed inverse/redo for empty standard or REST services, or single-version synchronous operations with request/response messages and an optional ApplicationClass OnRequest handler; a REST operation includes its URI templates and writer-generated routing (routing tombstone on DELETE, new routing name on CREATE). Native table scope, deletion markers, references, parent service and cache movements are checked. Credentials, manual routings, translations, deployment/runtime rows, other handlers and wider shapes refuse. Owning service must already exist; its mapping and native resave are covered by this operation approval. Parent-overlapping changes require separate Change Sets. Dynamic references require developer assessment.'],
            read:async(e,key)=>{const s=await(await provider(e)).readIbDefinitionForReview(identity(key),true);return {value:s.value,token:s.token};},
            authorize:async(e,key)=>{await gates(e,key);},
            validate:async(e,key,before,after)=>{
                try{const [{p,operator}]=await gates(e,key),k=identity(key),live=await p.readIbDefinitionForReview(k,true);
                    if(live.hash!==hash(before))return ['Complete IB lifecycle baseline changed.'];
                    if(before!==null&&after!==null)return ['Use the existing structural adapter for UPDATE.'];
                    await p.writeIbDefinitionForReview({...k,after,operatorId:operator,expectedSnapshotToken:live.token,expectedAfterHash:hash(after),allowDeletedBaseline:true,dryRun:true});return [];
                }catch(error){return [error instanceof Error?error.message:String(error)];}
            },
            write:async(e,key,after,baseline)=>{
                const all=await gates(e,key),[{p,operator,policyIdentity}]=all,k=identity(key),physical=keys(key);
                if(baseline.authorization&&await authState(e,key)!==baseline.authorization)throw new Error('IB lifecycle or parent authorization changed.');
                const live=await p.readIbDefinitionForReview(k,true);if(live.token!==baseline.token||live.hash!==hash(baseline.value))throw new Error('Complete IB lifecycle baseline changed before application.');
                await withReviewedWrite(p.id,physical[0],()=>runAsAgent(()=>p.writeIbDefinitionForReview({...k,after,operatorId:operator,expectedSnapshotToken:baseline.token,expectedAfterHash:hash(after),allowDeletedBaseline:true})),policyIdentity,physical.slice(1).map((key,i)=>({key,policyIdentity:all[i+1].policyIdentity})));
                for(const key of physical)host()!.saved(p.id,key);
            }
        };
    };
    const structuredCreation = (family: StructuredFamily): ReviewAdapter => {
        const keyOf = (key: Json) => makeKey(family === 'record' ? DefinitionType.Record : DefinitionType.AppEngineProgram, creationKey(family, key));
        return { id: family + '-create', canDelete: true,
            authorizationState: (e, key) => authorizationState(e, keyOf(key)),
            warnings: async (e, key) => [...await warnings(e, keyOf(key)), 'Typed creation and reviewed deletion/recreation only. Full native scope and tombstones are fingerprinted. Known project, state/temp record, static-call and Process references can block deletion; dynamic references still require developer assessment. Native execution is separate.'],
            read: async (e, key) => {
                const live = await (await provider(e)).readStructuredCreationForReview(family, keyOf(key).parts[0], true);
                return { value: live.value as unknown as Json, token: live.token };
            },
            authorize: async (e, key) => { await authorize(e, keyOf(key)); },
            validate: async (e, key, before, after, context) => {
                try {
                    if (after === null) {
                        if (before === null) return ['Cannot delete an absent definition.'];
                        const k = keyOf(key), { p, operator } = await authorize(e, k), live = await p.readStructuredCreationForReview(family, k.parts[0], true);
                        if (hash(live.value) !== hash(before)) return ['Deletion baseline changed.'];
                        if (family === 'record') { creationRecordEdit(before, k.parts[0]); await p.deleteRecord({ recname: k.parts[0], openedVersion: live.version, operatorId: operator, expectedSnapshotToken: live.token, dryRun: true, proposedAeDeletions: context?.phase === 'proposal' ? context.dependencies.filter(d => d.adapter === 'ae-create' && d.after === null && typeof d.key === 'string').map(d => d.key as string) : [] }); }
                        else { creationAeDocument(before, k.parts[0]); const ae = await p.readAppEngineDocument(k.parts[0]); if (!ae) return ['AE no longer exists.']; await p.deleteAppEngineProgram(k.parts[0], ae.token, operator, live.token, true); }
                        return [];
                    }
                    if (before !== null) return ['Creation requires an absent definition; structural UPDATE is unsupported.'];
                    const k = keyOf(key), { p, operator } = await authorize(e, k), live = await p.readStructuredCreationForReview(family, k.parts[0], true);
                    if (live.value !== null) return ['Definition is no longer absent.'];
                    let result;
                    if (family === 'record') result = await p.saveRecord({ edit: creationRecordEdit(after, k.parts[0]), operatorId: operator,
                        dryRun: true, captureSnapshots: true, allowDeletedBaseline: true, expectedSnapshotToken: live.token, expectedAfterHash: hash(after) });
                    else {
                        const doc = creationAeDocument(after, k.parts[0]);
                        const errors = (await deepValidate(p, doc, proposedAeReferences(p.appEngineReferenceLookup(), context))).filter(d => d.severity === 'error');
                        if (errors.length) return errors.map(d => d.path + ': ' + d.message);
                        result = await p.saveAppEngineDocument({ doc, openedToken: 'absent', operatorId: operator,
                            dryRun: true, captureSnapshots: true, allowDeletedBaseline: true, expectedSnapshotToken: live.token, expectedAfterHash: hash(after) });
                    }
                    return result.creationPreview?.before.value === null && result.creationPreview.after.hash === hash(after) ? [] : ['Native creation preview differs from review.'];
                } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
            },
            write: async (e, key, after, baseline) => {
                if (after === null) {
                    if (baseline.value === null) throw new Error('Cannot delete an absent definition.');
                    const k = keyOf(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline), live = await p.readStructuredCreationForReview(family, k.parts[0], true);
                    if (live.token !== baseline.token || hash(live.value) !== hash(baseline.value)) throw new Error('Deletion baseline changed.');
                    await withReviewedWrite(p.id, k, () => runAsAgent(async () => {
                        if (family === 'record') { creationRecordEdit(baseline.value, k.parts[0]); await p.deleteRecord({ recname:k.parts[0], openedVersion:live.version, operatorId:operator, expectedSnapshotToken:live.token }); }
                        else { creationAeDocument(baseline.value, k.parts[0]); const ae = await p.readAppEngineDocument(k.parts[0]); if (!ae) throw new Error('AE no longer exists.'); await p.deleteAppEngineProgram(k.parts[0],ae.token,operator,live.token); }
                    }), policyIdentity);
                    host()!.saved(p.id, k); return;
                }
                if (baseline.value !== null) throw new Error('Creation requires an absent definition.');
                const k = keyOf(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline);
                await withReviewedWrite(p.id, k, () => runAsAgent(async () => {
                    if (family === 'record') await p.saveRecord({ edit: creationRecordEdit(after, k.parts[0]), operatorId: operator,
                        allowDeletedBaseline: true, expectedSnapshotToken: baseline.token, expectedAfterHash: hash(after) });
                    else {
                        const doc = creationAeDocument(after, k.parts[0]);
                        const errors = (await deepValidate(p, doc)).filter(d => d.severity === 'error');
                        if (errors.length) throw new Error(errors.map(d => d.path + ': ' + d.message).join('\n'));
                        await p.saveAppEngineDocument({ doc, openedToken: 'absent', operatorId: operator,
                            allowDeletedBaseline: true, expectedSnapshotToken: baseline.token, expectedAfterHash: hash(after) });
                    }
                }), policyIdentity);
                host()!.saved(p.id, k);
            }
        };
    };
    const projectCreateKey = (key: Json) => makeKey(DefinitionType.Project, projectReviewName(key));
    const projectCreate: ReviewAdapter = { id: 'project-create',canDelete:true,scope:key=>'project:'+projectReviewName(key),
        authorizationState: (e, key) => authorizationState(e, projectCreateKey(key)),
        warnings: async (e, key) => [...await warnings(e, projectCreateKey(key)), 'Calibrated creation/default metadata and typed membership only. Oracle 8.62 creation inverse removes the project header/members, preserving definitions, and redo clears its bound PJM marker. Ancillary references, nondefault metadata or target credentials block deletion.'],
        read: async (e, key) => {const live = await (await provider(e)).readProjectCreationForReview(projectCreateKey(key).parts[0],true);return { value: live.value, token: live.token };},
        authorize: async (e, key) => { await authorize(e, projectCreateKey(key)); },
        validate: async (e, key, before, after, context) => {
            try {
                if(before!==null&&after!==null)return ['This adapter creates/deletes projects; membership removal is not calibrated.'];
                const k = projectCreateKey(key), { p, operator } = await authorize(e, k), live = await p.readProjectCreationForReview(k.parts[0],true);
                if(hash(live.value)!==hash(before))return ['Complete project baseline changed.'];
                const items=after===null?null:projectCreationItems(after,k.parts[0]);
                await p.writeProjectForReview({name:k.parts[0],operatorId:operator,items,mode:'full',dryRun:true,allowDeletedBaseline:true,
                    proposed:proposedProjectMembers(context),expectedSnapshotToken:live.token,expectedAfterHash:hash(after)});return [];
            } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
        },
        write: async (e, key, after, baseline) => {
            if(baseline.value!==null&&after!==null)throw Error('Project creation requires an absent definition.');
            const k = projectCreateKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline),items=after===null?null:projectCreationItems(after,k.parts[0]);
            await withReviewedWrite(p.id,k,()=>runAsAgent(()=>p.writeProjectForReview({name:k.parts[0],operatorId:operator,items,mode:'full',allowDeletedBaseline:true,expectedSnapshotToken:baseline.token,expectedAfterHash:hash(after)})),policyIdentity);host()!.saved(p.id,k);
        }
    };
    async function migrationCodeAccess(e:Environment, asset:MigrationAsset, before:Json) {
        if(asset.kind!=='menu')return;
        const p=await provider(e);
        const previous=before===null?undefined:reviewedMigrationAsset('menu',migrationJson(asset.key),before);
        const docs=[asset.data,...(previous?.kind==='menu'?[previous.data]:[])];
        for(const doc of docs)for(const bar of doc.bars)for(const item of bar.items)if(item.peopleCode) {
            const key=makeKey(DefinitionType.MenuPeopleCode,asset.data.name,bar.name,item.name,'ItemSelected');
            if(!workspace.isPeopleCodeWritable(p.id,key)||workspace.configFor(p.id)?.peoplecodeSaveMode==='save-only')throw Error('Compile and save PeopleCode access is required for menu ItemSelected programs.');
            if(host()?.hasUnsavedEditor(p.id,key))throw Error('An ItemSelected PeopleCode editor has unsaved changes.');
        }
    }
    const migration = (kind: MigrationAsset['kind']): ReviewAdapter => {
        if (kind==='sql'||kind==='html'||kind==='stylesheet') {
            const base=textDefinition(kind);
            const mapped=(key:Json)=>{const k=migrationReviewKey(key),type=kind==='sql'?30:kind==='html'?51:50;
                if(k.type!==type||k.parts.length!==(kind==='stylesheet'?1:2)||(kind==='sql'&&k.parts[1]!=='0')||(kind==='html'&&k.parts[1]!=='4'))throw Error('Invalid complete text migration identity.');return k.parts[0];};
            return {...base,id:migrationAdapter(kind),scope:key=>base.scope!(mapped(key)),
                read:(e,key)=>base.read(e,mapped(key)),authorize:(e,key,op)=>base.authorize(e,mapped(key),op),
                authorizationState:(e,key)=>base.authorizationState!(e,mapped(key)),warnings:(e,key)=>base.warnings!(e,mapped(key)),
                validate:(e,key,before,after,context)=>base.validate(e,mapped(key),before,after,context),
                write:(e,key,after,before)=>base.write(e,mapped(key),after,before)};
        }
        if(kind==='query'){
            const mapped=(key:Json)=>{const k=migrationReviewKey(key);if(k.type!==DefinitionType.Query||k.parts.length>2)throw Error('Invalid Query migration key.');return [k.parts[0],k.parts[1]??''];};
            const value=(key:Json,payload:Json)=>payload===null?null:(reviewedMigrationAsset('query',key,payload).data as {view:Json}).view;
            return {...query,id:'migration-query',scope:key=>query.scope!(mapped(key)),
                read:async(e,key)=>{const k=mapped(key),state=await query.read(e,k);return {value:state.value===null?null:{name:k[0],owner:k[1],view:state.value},token:state.token};},
                authorize:(e,key,op)=>query.authorize(e,mapped(key),op),authorizationState:(e,key)=>query.authorizationState!(e,mapped(key)),warnings:(e,key)=>query.warnings!(e,mapped(key)),
                diff:{id:'migration-query',compare:(before,after)=>queryDiff.compare(before&&typeof before==='object'&&!Array.isArray(before)?before.view??null:null,after&&typeof after==='object'&&!Array.isArray(after)?after.view??null:null)},
                validate:(e,key,before,after,context)=>query.validate(e,mapped(key),value(key,before),value(key,after),context),
                write:(e,key,after,before)=>query.write(e,mapped(key),value(key,after),{value:value(key,before.value),token:before.token})};
        }
        // Undoing a migration creation uses the calibrated deletion writers; process definitions have none yet.
        const deletable = (key: Json) => ['record', 'ae', 'menu', 'peoplecode', 'field', 'page', 'component', 'package', 'channel', 'filelayout'].includes(kind) && !!migrationReviewKey(key);
        async function migrationDelete(p: DatabaseProvider, k: DefinitionKey, operator: string, token: string, dryRun: boolean, context?: ReviewValidationContext) {
            // A rollback preview may assume what the same inverse deletes first (projects before members, Record PeopleCode
            // before its record); application runs each writer's real reference checks after those deletions.
            const deleted = dryRun && context?.phase === 'proposal' ? context.dependencies.filter(d => d.after === null) : [];
            const projects = deleted.filter(d => ['project-create', 'migration-project'].includes(d.adapter) && typeof d.key === 'string').map(d => d.key as string);
            const codes = deleted.filter(d => d.adapter === 'migration-peoplecode').map(d => migrationReviewKey(d.key))
                .filter(c => c.type === DefinitionType.RecordPeopleCode && c.parts[0] === k.parts[0]).map(c => [c.parts[1], c.parts[2]] as const);
            const named = (adapter: string) => deleted.filter(d => d.adapter === adapter).map(d => migrationReviewKey(d.key));
            const proposed = { projects, records: named('migration-record').map(r => r.parts[0]), pages: named('migration-page').map(r => r.parts[0]),
                components: named('migration-component').map(r => [r.parts[0], r.parts[1]] as const), menus: named('migration-menu').map(r => r.parts[0]) };
            const assumptions = dryRun && context?.phase === 'proposal' ? { proposed } : {};
            const listedElsewhere = async () => (await p.projectsListing(k)).filter(n => !projects.includes(n));
            if (kind === 'record') {
                const snapshot = await p.readStructuredCreationForReview('record', k.parts[0], true);
                const programs = named('migration-ae').map(r => r.parts[0]);
                await p.deleteRecord({ recname: k.parts[0], openedVersion: Number(token), operatorId: operator, expectedSnapshotToken: snapshot.token, dryRun,
                    ...(projects.length ? { proposedProjectDeletions: projects } : {}), ...(codes.length ? { proposedPeopleCodeDeletions: codes } : {}),
                    ...(programs.length ? { proposedAeDeletions: programs } : {}),
                    ...(proposed.pages.length ? { proposedPageDeletions: proposed.pages } : {}), ...(proposed.components.length ? { proposedComponentDeletions: proposed.components.map(([n]) => n) } : {}) });
            } else if (kind === 'ae') {
                const snapshot = await p.readStructuredCreationForReview('ae', k.parts[0], true);
                await p.deleteAppEngineProgram(k.parts[0], token, operator, snapshot.token, dryRun, projects);
            } else if (kind === 'menu') {
                const live = await p.readMenuForMigration(k.parts[0]);
                if (!live || live.token !== token) throw new Error('Menu changed before its deletion.');
                // File > Delete also removes the menu's permission-list items; undoing a creation never takes grants with it.
                if (await p.menuGrantCount(k.parts[0])) throw new Error('Permission lists grant this menu; removing those grants needs a wider review.');
                if ((await listedElsewhere()).length) throw new Error('A project still lists this menu.');
                await p.deleteMenuDefinition(k.parts[0], live.writerToken, operator, dryRun);
            } else if (kind === 'channel') {
                const live = await p.readChannelDocument(k.parts[0]);
                if (!live || live.token !== token) throw new Error('Message channel changed before its deletion.');
                // Messages are their own definitions: undoing a channel's creation never leaves them naming nothing.
                if (live.doc.messages.length) throw new Error('Messages still name this channel; deleting it needs a wider review.');
                if ((await listedElsewhere()).length) throw new Error('A project still lists this channel.');
                await p.deleteChannelDefinition(k.parts[0], live.token, operator, dryRun);
            } else if (kind === 'filelayout') {
                const live = await p.readFileLayoutForMigration(k.parts[0]);
                if (!live || live.token !== token) throw new Error('File Layout changed before its deletion.');
                if ((await listedElsewhere()).length) throw new Error('A project still lists this File Layout.');
                await p.deleteFileLayoutDefinition(k.parts[0], live.token, operator, dryRun);
            } else if (kind === 'field') {
                await p.deleteFieldDefinition({ name: k.parts[0], openedVersion: Number(token.split(':')[0]), operatorId: operator, dryRun, ...assumptions });
            } else if (kind === 'page') {
                await p.deletePageFromMigration({ name: k.parts[0], operatorId: operator, expectedToken: token, dryRun, ...assumptions });
            } else if (kind === 'component') {
                await p.deleteComponentFromMigration({ name: k.parts[0], market: k.parts[1], operatorId: operator, expectedToken: token, dryRun, ...assumptions });
            } else if (kind === 'package') {
                const live = await p.readPackageForMigration(k.parts[0]);
                if (!live || live.token !== token) throw new Error('Package changed before its deletion.');
                await p.deletePackageDefinition({ root: k.parts[0], openedVersion: live.version, operatorId: operator, dryRun, ...(dryRun && projects.length ? { proposedProjectDeletions: projects } : {}) });
            } else if (k.type === DefinitionType.ApplicationClassPeopleCode) {
                // A class is deleted from its package as the package editor does (dl09); its package goes afterwards.
                const parts = pcmProgKeyParts(k).slice(0, -1), live = await p.readPackageForMigration(parts[0]);
                if (!live) throw new Error('The class\'s package no longer exists.');
                if ((await listedElsewhere()).length) throw new Error('A project still lists this class.');
                await p.deleteApplicationClass({ root: parts[0], path: parts.slice(1, -1), className: parts.at(-1)!, openedVersion: live.version, operatorId: operator, dryRun });
            } else {
                if ((await listedElsewhere()).length) throw new Error('A project still lists this PeopleCode.');
                if (!dryRun) await p.savePeopleCode(k, { source: '', openedFingerprint: token, operatorId: operator });
            }
        }
        return ({
        id: migrationAdapter(kind),
        canDelete: deletable,
        authorizationState: (e, key) => authorizationState(e, migrationReviewKey(key)),
        warnings: async (e, key) => [...await warnings(e, migrationReviewKey(key)), deletable(key)
            ? 'Complete bounded migration payload. Writers commit independently. Undoing a creation deletes the definition through its calibrated deletion writer (rollback preview first); physical tables and application data are separate.'
            : 'Complete bounded migration payload. Writers commit independently. Creation reversal requires calibrated deletion, which this definition type does not have yet; physical tables and application data are separate.'],
        read: async (e, key) => {
            const k=migrationReviewKey(key);
            const read = await readMigrationAsset(await provider(e), k);
            return { value: read ? migrationJson(read.data) : null, token: read?.token ?? 'absent' };
        },
        validate: async (e, key, _before, after, context) => {
            try {
                if (after === null) {
                    if (!deletable(key) || _before === null) return ['This migration definition cannot be deleted here.'];
                    const k = migrationReviewKey(key), { p, operator } = await authorize(e, k), live = await readMigrationAsset(p, k);
                    if (!live || hash(migrationJson(live.data)) !== hash(_before)) return ['Deletion baseline changed.'];
                    await migrationDelete(p, k, operator, live.token, true, context);
                    return [];
                }
                const k = migrationReviewKey(key), { p, operator } = await authorize(e, k), asset = reviewedMigrationAsset(kind, key, after);
                await migrationCodeAccess(e,asset,_before);
                    const target = await databaseMigrationTarget(p, operator), live = await target.read(asset);
                const proposed: MigrationAsset[] = [asset];
                for (const d of context?.dependencies ?? []) if (d.adapter.startsWith('migration-') && d.adapter !== 'migration-project')
                    proposed.push(reviewedMigrationAsset(d.adapter.slice(10) as MigrationAsset['kind'], d.key, d.after));
                const errors = await target.validate?.(asset, live?.token ?? 'absent', proposed) ?? [];
                for (const dependency of assetRequirements(asset)) {
                    if (!proposed.some(a => hash(a.key) === hash(dependency)) && !await target.exists(dependency)) errors.push('Required definition missing: ' + dependency.parts.join('.'));
                }
                if (kind === 'peoplecode' && (!workspace.isPeopleCodeWritable(p.id, k) || workspace.configFor(p.id)?.peoplecodeSaveMode === 'save-only')) errors.push('Compile and save PeopleCode access is required.');
                return errors;
            } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
        },
        authorize: async (e, key) => {
            const k = migrationReviewKey(key), { p } = await authorize(e, k);
            if (kind === 'peoplecode' && (!workspace.isPeopleCodeWritable(p.id, k) || workspace.configFor(p.id)?.peoplecodeSaveMode === 'save-only')) throw new Error('Compile and save PeopleCode access is required.');
        },
        write: async (e, key, after, baseline) => {
            if (after === null) {
                const k = migrationReviewKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline);
                if (!deletable(key) || baseline.value === null) throw new Error('This migration definition cannot be deleted here.');
                const live = await readMigrationAsset(p, k);
                if (!live || live.token !== baseline.token || hash(migrationJson(live.data)) !== hash(baseline.value)) throw new Error('Deletion baseline changed.');
                await withReviewedWrite(p.id, k, () => runAsAgent(() => migrationDelete(p, k, operator, baseline.token, false)), policyIdentity);
                host()!.saved(p.id, k); return;
            }
            const k = migrationReviewKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline), asset = reviewedMigrationAsset(kind, key, after);
            await migrationCodeAccess(e,asset,baseline.value);
            const target = await databaseMigrationTarget(p, operator), live = await target.read(asset);
            if ((live?.token ?? 'absent') !== baseline.token || hash(live ? migrationJson(live.data) : null) !== hash(baseline.value)) throw new Error('Migration baseline changed before writer.');
            await withReviewedWrite(p.id, k, () => runAsAgent(() => target.write(asset, baseline.token)), policyIdentity);
            host()!.saved(p.id, k);
        }
        });
    };
    const migrationProject: ReviewAdapter = {
        id: 'migration-project',canDelete:true,scope:key=>'project:'+projectReviewName(key),reversalRefusal:()=> 'Removing membership from an existing project needs separate native calibration.', authorizationState: (e, key) => authorizationState(e, projectCreateKey(key)),
        warnings: (e, key) => warnings(e, projectCreateKey(key)),
        read: async (e, key) => readMigrationProject(await provider(e), projectReviewName(key),true),
        validate: async (e, key, before, after,context) => {
            try {
                const name = projectReviewName(key);
                if(before===null||after===null){
                    const {p,operator}=await authorize(e,projectCreateKey(key)),live=await p.readProjectCreationForReview(name,true);
                    // A proposed asset brings its contained members too: an App Engine program's sections and PeopleCode, a menu's ItemSelected programs, a package's subpackages.
                    const proposed=context?.phase==='proposal'?context.dependencies.filter(d=>d.adapter.startsWith('migration-')&&d.adapter!=='migration-project'&&d.after!==null).flatMap(d=>{
                        const asset=reviewedMigrationAsset(d.adapter.slice('migration-'.length) as MigrationAsset['kind'],d.key,d.after as Json);
                        return [migrationReviewKey(d.key),...containedMemberKeys(asset)];
                    }):[];
                    await p.writeProjectForReview({name,operatorId:operator,items:after===null?null:migrationMembers(after,name),mode:'members',expectedSnapshotToken:live.token,expectedAfterHash:hash(after),dryRun:true,allowDeletedBaseline:true,proposed});return [];
                }
                migrationMembers(after, name);
                const existing = before === null ? [] : migrationMembers(before, name);
                const wanted = new Set(migrationMembers(after, name).map(k => hash(k)));
                return existing.some(k => !wanted.has(hash(k))) ? ['Migration cannot remove existing project membership.'] : [];
            } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
        },
        authorize: async (e, key) => { await authorize(e, projectCreateKey(key)); },
        write: async (e, key, after, baseline) => {
            const k = projectCreateKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline), live = await readMigrationProject(p, k.parts[0],true);
            if (live.token !== baseline.token || hash(live.value) !== hash(baseline.value)) throw new Error('Project changed after review.');
            if(after===null||baseline.value===null){
                await withReviewedWrite(p.id,k,()=>runAsAgent(()=>p.writeProjectForReview({name:k.parts[0],items:after===null?null:migrationMembers(after,k.parts[0]),operatorId:operator,mode:'members',expectedSnapshotToken:baseline.token,expectedAfterHash:hash(after),allowDeletedBaseline:true})),policyIdentity);host()!.saved(p.id,k);return;
            }
            const wanted = migrationMembers(after, k.parts[0]);
            await withReviewedWrite(p.id, k, () => runAsAgent(async () => {
                if (baseline.value === null) {
                    await p.createProjectForReview({ project: k.parts[0], operatorId: operator, items: wanted, expectedSnapshotToken: baseline.token });
                } else {
                    const existing = new Set(migrationMembers(baseline.value, k.parts[0]).map(v => hash(v)));
                    await p.saveProject({ project: k.parts[0], operatorId: operator, openedVersion: await p.readProjectVersion(k.parts[0]),
                        add: wanted.filter(v => !existing.has(hash(v))), expectedSnapshotToken: baseline.token });
                }
            }), policyIdentity);
            host()!.saved(p.id, k);
        }
    };
    function migrationMembers(value: Json, name: string): DefinitionKey[] {
        if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'members,name' || value.name !== name || !Array.isArray(value.members)) throw new Error('Invalid migration project payload.');
        const members = value.members.map(migrationReviewKey);
        if (new Set(members.map(v => hash(v))).size !== members.length) throw new Error('Duplicate migration members.');
        return members;
    }
    async function environment(connection: string): Promise<Environment> {
        const p = await requireProvider(workspace, connection);
        if (!(p instanceof DatabaseProvider) || !p.isConnected)
            throw new Error('A connected database is required.');
        return { connection: p.id, label: p.displayName, identity: await p.changeReviewIdentity() };
    }
    return { adapters: [textDefinition('sql'), textDefinition('html'), textDefinition('stylesheet'), migrationProject, ...(['field', 'record', 'sql', 'html', 'stylesheet', 'ae', 'peoplecode', 'query','menu','package','page','component','channel','process','filelayout'] as const).map(migration), sql, content('html', DefinitionType.HtmlDefinition), content('stylesheet', DefinitionType.StyleSheet), process, query, peoplecode, page, structuredHeader('record'), structuredHeader('ae'), structuredCreation('record'), structuredCreation('ae'), projectCreate, ibHeader('service'), ibHeader('operation'),ibDefinition('service'),ibDefinition('operation'), lifecycle('class'), lifecycle('package')], environment, adapterHash: hash };
}
