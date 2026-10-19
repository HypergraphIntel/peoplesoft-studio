import type { Snapshot } from './model.js';
import { prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import { pcmProgKeyParts } from '../model/peopleCodeKeys.js';
import { prepareHtmlText, contentTextRefusal } from '../providers/htmlWriter.js';
import { queryDiff } from './semanticDiff.js';
import { querySnapshot, queryView } from './query.js';
import { requestForPageSnapshot, nativePageDiff } from '../providers/pageSnapshot.js';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { DefinitionType, makeKey, type DefinitionKey } from '../model/definitions.js';
import { decideWrite } from '../model/ownership.js';
import { effectivePolicy, runAsAgent } from '../providers/writeGuard.js';
import { writeScopeRefusal } from '../providers/writeScope.js';
import { prepareSqlText, SQL_TEXT_ROW_LIMIT } from '../providers/sqlWriter.js';
import { processEdit, processToken, validateProcessEdit, type ProcessEdit } from '../model/processEdit.js';
import { hash, type Environment, type Json } from './model.js';
import type { ReviewAdapter } from './service.js';
import { withReviewedWrite, reviewedPolicyIdentity } from './authorization.js';
import type { McpWriteHost } from '../mcp/writeTools.js';
import { requireProvider } from '../mcp/tools.js';
import { recordHeaderRequest, aeHeaderDocument, headerChange, structuredHeaderDiff } from './structuredHeaders.js';
import type { StructuredFamily } from '../providers/structuredSnapshot.js';
import { deepValidate } from '../mcp/appEngineTools.js';
import { ibDefinitionKey } from '../model/ibOperations.js';
import { ibHeaderChange, ibHeaderInput, ibHeaderDiff } from './ibHeaders.js';
import type { IbReviewKind } from '../providers/ibSnapshot.js';
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
    const page: ReviewAdapter = { id: 'page', diff: nativePageDiff,
        authorizationState: (e, key) => authorizationState(e, pageKey(key)), warnings: async (e, key) => [...await warnings(e, pageKey(key)), 'Existing-control geometry, labels/use and description/comments only. Native writer normalization is included in review. No Page creation/deletion, inserted/deleted controls or raw row replay.'],
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
            headerChange(before, after, family, name);
            if (family === 'record') return p.saveRecord({ ...recordHeaderRequest(name, before, after, version, operatorId), expectedSnapshotToken: token, ...(preview ? { dryRun: true, captureSnapshots: true } : {}) });
            const live = await p.readAppEngineDocument(name);
            if (!live) throw new Error('Application Engine program no longer exists.');
            const doc = aeHeaderDocument(name, before, after, live.doc), errors = (await deepValidate(p, doc)).filter(d => d.severity === 'error');
            if (errors.length) throw new Error(errors.map(d => d.path + ': ' + d.message).join('\n'));
            return p.saveAppEngineDocument({ doc, openedToken: live.token, operatorId, expectedSnapshotToken: token, ...(preview ? { dryRun: true, captureSnapshots: true } : {}) });
        }
        return { id: family, diff: structuredHeaderDiff(family), authorizationState: (e, key) => authorizationState(e, keyOf(key)),
            warnings: async (e, key) => [...await warnings(e, keyOf(key)), 'Bounded existing-definition description/comments only. No structural edits, field removal, DDL, code mutation, creation/deletion or raw checkpoint row replay.'],
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
    const sql: ReviewAdapter = { id: 'sql', authorizationState: (e, key) => authorizationState(e, sqlKey(key)), warnings: (e, key) => warnings(e, sqlKey(key)), normalize: value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' ? { ...value, text: prepareSqlText(value.text) } : value,
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
        return { id, authorizationState: (e, key) => authorizationState(e, keyOf(key)), warnings: (e, key) => warnings(e, keyOf(key)), normalize: value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' ? { ...value, text: prepareHtmlText(value.text), ...(typeof value.description === 'string' ? { description: value.description.trimEnd() } : {}) } : value,
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
        return makeKey(DefinitionType.Query, ...key as string[]);
    };
    async function queryAccess(e: Environment, key: Json) {
        const p = await provider(e), k = queryKey(key), operator = workspace.configFor(p.id)?.peoplesoftOperatorId?.trim();
        if (!operator)
            throw new Error('Configure an Operator ID.');
        if ((k.parts[1] ?? '').trim() && (k.parts[1] ?? '').trim() !== operator)
            throw new Error('Only public or own private Queries can be reviewed.');
        return { p, k, operator };
    }
    const query: ReviewAdapter = { id: 'query', authorizationState: (e, key) => authorizationState(e, queryKey(key)), warnings: (e, key) => warnings(e, queryKey(key)), diff: queryDiff,
        read: async (e, key) => { const { p, k } = await queryAccess(e, key), read = await p.readQueryDocument(k.parts[0], k.parts[1] ?? ''); return { value: read ? querySnapshot(read.view) : null, token: read?.token ?? 'absent' }; },
        validate: async (e, key, _before, after) => {
            try {
                const { p, k, operator } = await queryAccess(e, key), view = queryView(after);
                if (String(view.query.QRYNAME).trim() !== k.parts[0] || String(view.query.OPRID).trim() !== (k.parts[1] ?? '').trim())
                    return ['Query key cannot change inside a snapshot.'];
                await p.prepareQuery(view, operator);
                return [];
            }
            catch (error) {
                return [error instanceof Error ? error.message : String(error)];
            }
        },
        authorize: async (e, key) => { await queryAccess(e, key); await authorize(e, queryKey(key)); },
        write: async (e, key, after, baseline) => {
            const k = queryKey(key), { p, operator, policyIdentity } = await authorizeReviewed(e, k, baseline);
            await queryAccess(e, key);
            const proposed = queryView(after), read = await p.readQueryDocument(k.parts[0], k.parts[1] ?? '');
            if (read)
                proposed.query = { ...read.view.query, ...proposed.query };
            await withReviewedWrite(p.id, k, () => runAsAgent(() => p.saveQueryDocument({ view: proposed, openedToken: baseline.token, operatorId: operator })), policyIdentity);
            host()!.saved(p.id, k);
        }
    };
    const ibHeader = (kind: IbReviewKind): ReviewAdapter => {
        const keyOf = (key: Json) => {
            if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,29}$/.test(key)) throw new Error('Invalid IB review name.');
            return ibDefinitionKey(kind, [key]);
        };
        async function request(p: DatabaseProvider, name: string, before: Json, after: Json, operatorId: string, token: string, preview: boolean) {
            ibHeaderChange(before, after, kind, name);
            const live = await p.readIntegrationBroker(kind, [name]);
            if (!live) throw new Error('IB definition no longer exists.');
            return p.saveIntegrationBroker({ input: ibHeaderInput(before, after, kind, name, live), expectedToken: live.token, operatorId, expectedSnapshotToken: token, expectedAfterHash: hash(after), ...(preview ? { dryRun: true, captureSnapshots: true } : {}) });
        }
        return { id: 'ib-' + kind, diff: ibHeaderDiff(kind), authorizationState: (e, key) => authorizationState(e, keyOf(key)),
            warnings: async (e, key) => [...await warnings(e, keyOf(key)), 'Existing service/operation description and comments only. Fixed noncredential preservation scope; credentials are never selected or restored and credential freshness is not certified. No create/delete, structural edits or raw row replay. Native acceptance pending.'],
            read: async (e, key) => { const p = await provider(e), live = await p.readIbForReview(kind, keyOf(key).parts[0]); return { value: live.value as unknown as Json, token: live.token }; },
            authorize: async (e, key) => { await authorize(e, keyOf(key)); },
            validate: async (e, key, before, after) => {
                try {
                    const k = keyOf(key), { p, operator } = await authorize(e, k), live = await p.readIbForReview(kind, k.parts[0]);
                    if (live.hash !== hash(before)) return ['IB baseline changed before validation.'];
                    const result = await request(p, k.parts[0], before, after, operator, live.token, true);
                    if (!result.snapshots || result.snapshots.before.hash !== hash(before) || result.snapshots.after.hash !== hash(after)) return ['IB writer cannot reproduce this complete header proposal exactly.'];
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
    async function environment(connection: string): Promise<Environment> {
        const p = await requireProvider(workspace, connection);
        if (!(p instanceof DatabaseProvider) || !p.isConnected)
            throw new Error('A connected database is required.');
        return { connection: p.id, label: p.displayName, identity: await p.changeReviewIdentity() };
    }
    return { adapters: [sql, content('html', DefinitionType.HtmlDefinition), content('stylesheet', DefinitionType.StyleSheet), process, query, peoplecode, page, structuredHeader('record'), structuredHeader('ae'), ibHeader('service'), ibHeader('operation')], environment, adapterHash: hash };
}
