import { canonical, type Json } from './model.js';
import { ibSnapshot, type IbReviewKind, type IbSnapshot } from '../providers/ibSnapshot.js';
import { IB_SECTIONS, inputForIb, type IbWriteInput } from '../model/ibOperations.js';
import type { IbDocument } from '../model/ibDocument.js';

/*
 * Structural review of an EXISTING IB service or operation, bounded to what the
 * calibrated writer does natively and what the fixed checkpoint scope can see.
 *
 * The before/after values are the same full noncredential checkpoints the header
 * adapter uses (2 service tables, 16 operation tables). The after-image is never
 * computed here: it is the writer's own rollback-preview result, and staging,
 * validation and application each require the writer to reproduce it exactly.
 * This module only decides whether a before -> after difference is inside the
 * contract, and turns it back into a writer input.
 *
 * Contract (anything else stays on the legacy per-write path):
 *  - Service: PSSERVICE DESCR/DESCRLONG/OBJECTOWNERID/IB_NAMESPACE/PTIBAPPLNAME/
 *    PTIB_APPSRVGRP. Alias, token/credential columns and kind flags are refused.
 *  - Operation header: any writer-editable PSOPERATION column except the service
 *    (move), routing type, REST method, alias and message binding, whose effects
 *    reach routings outside this scope.
 *  - Existing versions, parameters (not their message/version binding), handlers
 *    (not type/event) and application class handler implementations.
 *  - Adding exactly the PIA-calibrated handler: ApplicationClass REQUESTHDLR on
 *    RQST (OnRequest) with its PSOPERATIONAC row (8.61.15 and 8.62.09 captures).
 *  - No row is ever removed (child deletion is not calibrated), no key changes,
 *    and the other checkpoint tables (routings, roots, generated routing
 *    parameters, service mappings, other handler kinds, REST URI/content/queue
 *    rows) must be unchanged.
 * A typed inverse exists only when no row was added: reversing an added handler
 * would need the uncalibrated deletion.
 */

type Row = Record<string, Json>;
const SERVICE_COLUMNS = new Set(['DESCR', 'DESCRLONG', 'OBJECTOWNERID', 'IB_NAMESPACE', 'PTIBAPPLNAME', 'PTIB_APPSRVGRP']);
const OPERATION_REFUSED = new Set(['IB_SERVICENAME', 'RTNGTYPE', 'IB_RESTMETHOD', 'IB_ALIASNAME', 'IB_REST_SERVICE', 'MSGNAME', 'IB_MSGVERSION']);
const head = (kind: IbReviewKind) => kind === 'service' ? 'PSSERVICE' : 'PSOPERATION';
const parentKey = (kind: IbReviewKind) => kind === 'service' ? 'IB_SERVICENAME' : 'IB_OPERATIONNAME';
const text = (v: Json | undefined) => typeof v === 'string' ? v.trim() : v;

/** Editable operation child tables: section name, key columns, refused non-key columns. */
const CHILDREN: Record<string, { section: string; refused: Set<string> }> = {
    PSOPRVERDFN: { section: 'versions', refused: new Set() },
    PSOPRVERDFNPARM: { section: 'parameters', refused: new Set(['MSGNAME', 'IB_MSGVERSION']) },
    PSOPRHDLR: { section: 'handlers', refused: new Set(['HANDLERTYPE', 'HANDLERID']) },
    PSOPERATIONAC: { section: 'applicationClassHandlers', refused: new Set() }
};
const keysOf = (table: string) => Object.values(IB_SECTIONS.operation).find(t => t.table === table)!.keys;
const rowKey = (keys: string[], row: Row) => JSON.stringify(keys.map(k => text(row[k]) ?? null));

export interface IbStructuralChange {
    /** Human-readable summary, one line per changed cell or added row. */
    changes: string[];
    /** Rows added (only the calibrated OnRequest handler); these block a typed inverse. */
    added: string[];
}

function changedColumns(before: Row, after: Row): string[] {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => canonical(before[k] ?? null) !== canonical(after[k] ?? null)).sort();
}

/** Throws when before -> after leaves the contract; otherwise describes the difference. */
export function ibStructuralChange(beforeValue: unknown, afterValue: unknown, kind: IbReviewKind, name: string): IbStructuralChange {
    const before = ibSnapshot(beforeValue, kind), after = ibSnapshot(afterValue, kind), table = head(kind), key = parentKey(kind);
    for (const s of [before, after]) if (s.tables[table].length !== 1 || String(s.tables[table][0][key]).trim() !== name) throw new Error('IB checkpoint identifies another definition.');
    const out: IbStructuralChange = { changes: [], added: [] };
    for (const column of changedColumns(before.tables[table][0], after.tables[table][0])) {
        const allowed = kind === 'service' ? SERVICE_COLUMNS.has(column) : !OPERATION_REFUSED.has(column) && column !== key;
        if (!allowed) throw new Error(`${table}.${column} is outside reviewed IB structure: ${kind === 'service' ? 'only description, comments, owner, namespace, application and app server group are staged' : 'moving services, routing type, REST method, alias and message binding affect routings outside the review scope'}. Use the legacy per-write path.`);
        out.changes.push(`${table}.${column}`);
    }
    for (const t of Object.keys(before.tables).filter(t => t !== table)) {
        const child = kind === 'operation' ? CHILDREN[t] : undefined;
        if (!child) {
            if (canonical(before.tables[t]) !== canonical(after.tables[t])) throw new Error(`${t} must not change in reviewed IB structure (routings, roots, service mappings, other handler kinds and REST URI/content/queue rows stay on the legacy path).`);
            continue;
        }
        const keys = keysOf(t), was = new Map(before.tables[t].map(r => [rowKey(keys, r), r])), now = new Map(after.tables[t].map(r => [rowKey(keys, r), r]));
        for (const k of was.keys()) if (!now.has(k)) throw new Error(`${t}: removing ${k} needs child deletion, which is not calibrated.`);
        for (const [k, row] of now) {
            const old = was.get(k);
            if (!old) {
                out.added.push(`${t} ${k}`); out.changes.push(`${t} + ${k}`);
                continue;
            }
            for (const column of changedColumns(old, row)) {
                if (child.refused.has(column)) throw new Error(`${t}.${column} cannot change in reviewed IB structure${t === 'PSOPRHDLR' ? ' (handler type/event changes require PIA)' : ' (message binding reaches routings outside the review scope)'}.`);
                out.changes.push(`${t} ${k}.${column}`);
            }
        }
    }
    if (kind === 'operation') {
        // Only the PIA-calibrated handler addition: an ApplicationClass REQUESTHDLR on RQST
        // with its implementation row, and nothing else new.
        const added = (t: string) => after.tables[t].filter(r => !before.tables[t].some(b => rowKey(keysOf(t), b) === rowKey(keysOf(t), r)));
        const handlers = added('PSOPRHDLR'), classes = added('PSOPERATIONAC');
        if (added('PSOPRVERDFN').length || added('PSOPRVERDFNPARM').length) throw new Error('Adding operation versions or parameters is not calibrated for reviewed structure.');
        for (const h of handlers) if (text(h.HANDLERNAME) !== 'REQUESTHDLR' || text(h.HANDLERID) !== 'RQST' || text(h.HANDLERTYPE) !== 'ApplicationClass' || !classes.some(c => text(c.HANDLERNAME) === 'REQUESTHDLR'))
            throw new Error('Only the calibrated ApplicationClass REQUESTHDLR / OnRequest handler (with its implementation row) can be added.');
        if (classes.some(c => !handlers.some(h => text(h.HANDLERNAME) === text(c.HANDLERNAME)))) throw new Error('An application class implementation row can only be added with its new handler.');
    }
    if (!out.changes.length) throw new Error('IB structural proposal has no changes.');
    return out;
}

/** Why reversing before -> after cannot be a typed inverse, or undefined when it can. */
export function ibStructuralReversalRefusal(beforeValue: unknown, afterValue: unknown, kind: IbReviewKind, name: string): string | undefined {
    // An applied change was inside the contract when staged; validation of the inverse
    // still runs, so only the known-impossible case (an added row) is refused here.
    const added = ibStructuralChange(beforeValue, afterValue, kind, name).added;
    return added.length ? `Reversal would delete ${added.join(', ')}; IB child deletion is not calibrated. Deactivate the handler (ACTIVE_FLAG I) as a separate reviewed edit instead.` : undefined;
}

/**
 * The writer input that reproduces after from the live definition: the complete
 * psft_ib_get input with only the checkpoint's changed cells and added rows
 * applied, so every unchanged value keeps its native representation.
 */
export function ibStructuralInput(beforeValue: unknown, afterValue: unknown, kind: IbReviewKind, name: string, live: IbDocument): IbWriteInput {
    if (live.kind !== kind || live.key.length !== 1 || live.key[0] !== name) throw new Error('IB live definition does not match the checkpoint.');
    ibStructuralChange(beforeValue, afterValue, kind, name);
    const before = beforeValue as IbSnapshot, after = afterValue as IbSnapshot, table = head(kind), key = parentKey(kind);
    const input = inputForIb(live);
    for (const column of changedColumns(before.tables[table][0], after.tables[table][0])) input.properties[column] = after.tables[table][0][column] as IbWriteInput['properties'][string];
    if (kind === 'operation') {
        for (const [t, { section }] of Object.entries(CHILDREN)) {
            const keys = keysOf(t), rows = (input.sections[section] ??= []);
            for (const row of after.tables[t]) {
                const old = before.tables[t].find(r => rowKey(keys, r) === rowKey(keys, row));
                const target = rows.find(r => rowKey(keys.filter(k => k !== key), r as Row) === rowKey(keys.filter(k => k !== key), row));
                if (!old) {
                    if (target) throw new Error(`${t} row already in the live input.`);
                    rows.push(Object.fromEntries(Object.entries(row).filter(([k]) => k !== key)) as IbWriteInput['sections'][string][number]);
                    continue;
                }
                const changed = changedColumns(old, row);
                if (!changed.length) continue;
                if (!target) throw new Error(`${t} row is missing from the live input.`);
                for (const column of changed) target[column] = row[column] as IbWriteInput['properties'][string];
            }
        }
    }
    return input;
}
