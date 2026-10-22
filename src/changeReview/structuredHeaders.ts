import { canonical, differences, type Json } from './model.js';
import type { ObjectDiffProvider } from './semanticDiff.js';
import { structuredSnapshot, type StructuredFamily } from '../providers/structuredSnapshot.js';
import { editStateFor, setRecordProperties, type StoredRecord, type Row, type RecordEditField, type RecordEditState } from '../model/recordEdit.js';
import type { RecordSaveRequest } from '../providers/recordWriter.js';
import type { AeDocument } from '../model/aeDocument.js';

/**
 * Whether one operation is the bounded header edit this adapter stages:
 * the family's set-properties op carrying nothing but description/comments.
 */
export function isHeaderOnlyOperation(family: StructuredFamily, op: Record<string, unknown>): boolean {
    const allowed = family === 'record' ? ['op', 'description', 'definition'] : ['op', 'description', 'comments'];
    return op.op === (family === 'record' ? 'set_properties' : 'set_program') && Object.keys(op).every(k => allowed.includes(k));
}

/**
 * Whether a whole request is stageable here. The caller routes anything else
 * to the legacy per-write confirmation rather than refusing it: this adapter
 * not modelling a structural edit is a reason not to STAGE it, not a reason
 * the edit cannot be made -- creation already takes that legacy path.
 */
export function isHeaderOnlyRequest(family: StructuredFamily, operations: unknown): boolean {
    return Array.isArray(operations) && operations.length > 0
        && operations.every(op => !!op && typeof op === 'object' && isHeaderOnlyOperation(family, op as Record<string, unknown>));
}

/** This first slice excludes structural edits and every side effect outside these header columns. */
export function headerChange(beforeValue: unknown, afterValue: unknown, family: StructuredFamily, name: string) {
    const before = structuredSnapshot(beforeValue, family), after = structuredSnapshot(afterValue, family);
    const table = family === 'record' ? 'PSRECDEFN' : 'PSAEAPPLDEFN', key = family === 'record' ? 'RECNAME' : 'AE_APPLID';
    const columns = family === 'record' ? ['RECDESCR', 'DESCRLONG'] : ['DESCR', 'DESCRLONG'];
    for (const s of [before, after]) {
        const head = s.tables[table];
        if (head.length !== 1 || typeof head[0][key] !== 'string' || String(head[0][key]).trim() !== name) throw new Error('Checkpoint identifies another definition.');
    }
    const strip = (s: typeof before) => ({ ...s, tables: { ...s.tables, [table]: [Object.fromEntries(Object.entries(s.tables[table][0]).filter(([k]) => !columns.includes(k)))] } });
    if (canonical(strip(before)) !== canonical(strip(after))) throw new Error('Only existing-definition description/comments changes are supported by this adapter.');
    const head = after.tables[table][0];
    if (typeof head[columns[0]] !== 'string' || head.DESCRLONG !== null && typeof head.DESCRLONG !== 'string') throw new Error('Header description/comments require native text.');
    return { before, after, head, description: head[columns[0]] as string, comments: head.DESCRLONG as string | null };
}

export function recordHeaderRequest(name: string, beforeValue: unknown, afterValue: unknown, version: number, operatorId: string): RecordSaveRequest {
    const { before, head, description, comments } = headerChange(beforeValue, afterValue, 'record', name), base = before.tables.PSRECDEFN[0];
    if (![0, 2].includes(Number(base.RECTYPE))) throw new Error('Record header review currently supports existing SQL Table and Derived/Work records only.');
    const rows = (rs: typeof before.tables[string]): Row[] => rs.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
        if (v !== null && typeof v !== 'string' && typeof v !== 'number') throw new Error('Record typed projection requires scalar native metadata.');
        return [k, v];
    })));
    const stored: StoredRecord = { recname: name, version, recordType: Number(base.RECTYPE), defn: rows([base])[0],
        fields: rows([...before.tables.PSRECFIELD].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM))), indexes: rows(before.tables.PSINDEXDEFN) };
    const edit = setRecordProperties(editStateFor(stored), {
        ...(head.RECDESCR !== base.RECDESCR ? { description } : {}),
        ...(head.DESCRLONG !== base.DESCRLONG ? { definition: comments ?? '' } : {})
    });
    return { edit, operatorId };
}

/**
 * The Record operations Change Review stages: header description/comments and the field-level structure App Designer's
 * record grid edits (insert/remove/move a field or subrecord, Use, Edits, default, label). Record type, view SQL, other
 * Record Properties and In Memory stay on the legacy per-write confirmation.
 */
const STAGEABLE_RECORD_OPS = ['insert_field', 'insert_subrecord', 'remove_field', 'move_field', 'set_use', 'set_edits', 'set_default', 'set_label'];
export function isStageableRecordOperation(op: Record<string, unknown>): boolean {
    return isHeaderOnlyOperation('record', op) || (STAGEABLE_RECORD_OPS.includes(String(op.op)) && op.inMemory === undefined);
}
export function isStageableRecordRequest(operations: unknown): boolean {
    return Array.isArray(operations) && operations.length > 0 && operations.every(op => !!op && typeof op === 'object' && isStageableRecordOperation(op as Record<string, unknown>));
}

/**
 * The typed Record edit that reproduces a reviewed change from its native before/after checkpoints: the after-image's
 * fields in FIELDNUM order with their editable settings, an inserted field restored from its own reviewed row, removals
 * by omission, and the header text. Never row replay of arbitrary input: native preview must reproduce the after-image.
 */
export function recordStructureRequest(name: string, beforeValue: unknown, afterValue: unknown, version: number, operatorId: string): RecordSaveRequest {
    const before = structuredSnapshot(beforeValue, 'record'), after = structuredSnapshot(afterValue, 'record');
    for (const s of [before, after]) {
        if (s.tables.PSRECDEFN.length !== 1 || String(s.tables.PSRECDEFN[0].RECNAME ?? '').trim() !== name) throw new Error('Checkpoint identifies another definition.');
    }
    const base = before.tables.PSRECDEFN[0], head = after.tables.PSRECDEFN[0];
    if (![0, 2].includes(Number(base.RECTYPE)) || Number(head.RECTYPE) !== Number(base.RECTYPE)) throw new Error('Record review supports existing SQL Table and Derived/Work records without a type change.');
    if (typeof head.RECDESCR !== 'string' || head.DESCRLONG !== null && typeof head.DESCRLONG !== 'string') throw new Error('Header description/comments require native text.');
    const scalar = (r: Record<string, Json>): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => {
        if (v !== null && typeof v !== 'string' && typeof v !== 'number') throw new Error('Record typed projection requires scalar native metadata.');
        return [k, v];
    }));
    const t = (v: Json | undefined) => String(v ?? '').trim();
    const had = new Set(before.tables.PSRECFIELD.map(r => t(r.FIELDNAME)));
    const rows = [...after.tables.PSRECFIELD].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM));
    if (rows.some((r, i) => Number(r.FIELDNUM) !== i + 1)) throw new Error('Record proposal field order is not a contiguous native FIELDNUM sequence.');
    const fields: RecordEditField[] = rows.map(r => {
        const field: RecordEditField = { name: t(r.FIELDNAME), useEdit: Number(r.USEEDIT), useEdit2: Number(r.USEEDIT2 ?? 0), isNew: !had.has(t(r.FIELDNAME)),
            ...(t(r.SUBRECORD) === 'Y' ? { isSubrecord: true } : {}) };
        if (field.isNew) return { ...field, restore: scalar(r) };
        if (field.isSubrecord) return field;
        return { ...field, editTable: t(r.EDITTABLE), defaultRecord: t(r.DEFRECNAME), defaultField: t(r.DEFFIELDNAME), labelId: t(r.LABEL_ID), pageControl: Number(r.DEFGUICONTROL) };
    });
    const edit: RecordEditState = { recname: name, recordType: Number(base.RECTYPE), openedVersion: version, fields };
    const properties = setRecordProperties(edit, {
        ...(head.RECDESCR !== base.RECDESCR ? { description: head.RECDESCR } : {}),
        ...(head.DESCRLONG !== base.DESCRLONG ? { definition: (head.DESCRLONG as string | null) ?? '' } : {})
    });
    return { edit: properties, operatorId };
}

export function aeHeaderDocument(name: string, beforeValue: unknown, afterValue: unknown, live: AeDocument): AeDocument {
    const { description, comments } = headerChange(beforeValue, afterValue, 'ae', name);
    if (live.name !== name) throw new Error('Application Engine document identifies another program.');
    return { ...live, program: { ...live.program, descr: description.trimEnd(), descrlong: comments } };
}

export function headerProposal(value: Json, family: StructuredFamily, changes: { description?: string; comments?: string }): Json {
    const s = structuredClone(structuredSnapshot(value, family)), table = family === 'record' ? 'PSRECDEFN' : 'PSAEAPPLDEFN';
    if (s.tables[table].length !== 1) throw new Error('Header proposal needs one existing definition.');
    if (changes.description !== undefined) s.tables[table][0][family === 'record' ? 'RECDESCR' : 'DESCR'] = changes.description;
    if (changes.comments !== undefined) s.tables[table][0].DESCRLONG = changes.comments || null;
    return s as unknown as Json;
}

export function structuredHeaderDiff(family: StructuredFamily): ObjectDiffProvider {
    return { id: family + '-native-header', compare(before, after) {
        const a = structuredSnapshot(before, family), b = structuredSnapshot(after, family), header = family === 'record' ? 'PSRECDEFN' : 'PSAEAPPLDEFN';
        return Object.keys(a.tables).flatMap(table => table === header
            ? differences(a.tables[table][0] ?? null, b.tables[table][0] ?? null, '$.tables.' + table)
            : differences(a.tables[table], b.tables[table], '$.tables.' + table));
    } };
}
