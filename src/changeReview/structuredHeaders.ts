import { canonical, differences, type Json } from './model.js';
import type { ObjectDiffProvider } from './semanticDiff.js';
import { structuredSnapshot, type StructuredFamily } from '../providers/structuredSnapshot.js';
import { editStateFor, setRecordProperties, type StoredRecord, type Row } from '../model/recordEdit.js';
import type { RecordSaveRequest } from '../providers/recordWriter.js';
import type { AeDocument } from '../model/aeDocument.js';

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
