import { structuredSnapshot, type NativeRow, type StructuredFamily } from '../providers/structuredSnapshot.js';
import { RecordType } from '../model/record.js';
import { setRecordProperties, type RecordEditState } from '../model/recordEdit.js';
import { documentFromRows } from '../model/aeDocument.js';
import type { AppEngineRows, Row } from '../model/appEngine.js';
import type { ReviewValidationContext } from './service.js';
import type { Json } from './model.js';
import type { AeReferenceLookup } from '../model/aeValidation.js';
import type { AeValidationOverlay } from '../mcp/appEngineTools.js';
import { bindMarkerCount, selectList } from '../model/sqlTypeCheck.js';
import { DefinitionType, makeKey, type DefinitionKey } from '../model/definitions.js';
import { peopleCodeKey } from '../model/aeDocument.js';

/** Typed input projection only. A native rollback preview must reproduce EVERY reviewed row. */
export function creationRecordEdit(value: Json, name: string): RecordEditState {
    const s = structuredSnapshot(value, 'record'), h = s.tables.PSRECDEFN;
    if (h.length !== 1 || String(h[0].RECNAME).trim() !== name || h[0].RECTYPE !== RecordType.DerivedWork)
        throw new Error('Creation review supports one new Derived/Work record only.');
    const fields = [...s.tables.PSRECFIELD].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM));
    if (!fields.length || fields.some(f => String(f.RECNAME).trim() !== name || f.SUBRECORD === 'Y')) throw new Error('Creation review requires existing fields, without subrecords.');
    const edit: RecordEditState = { recname: name, recordType: RecordType.DerivedWork, openedVersion: 0, isNew: true,
        fields: fields.map(f => ({ name: String(f.FIELDNAME).trim(), useEdit: Number(f.USEEDIT), useEdit2: Number(f.USEEDIT2 ?? 0), isNew: true,
            editTable: String(f.EDITTABLE ?? '').trim(), defaultRecord: String(f.DEFRECNAME ?? '').trim(), defaultField: String(f.DEFFIELDNAME ?? '').trim(),
            labelId: String(f.LABEL_ID ?? '').trim(), pageControl: Number(f.DEFGUICONTROL) })) };
    return setRecordProperties(edit, { description: String(h[0].RECDESCR ?? '').trimEnd(), definition: String(h[0].DESCRLONG ?? '') });
}

function rows(rs: NativeRow[]): Row[] {
    return rs.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
        if (v !== null && typeof v !== 'string' && typeof v !== 'number') throw new Error('Typed AE metadata requires scalar columns.');
        return [k, v];
    })));
}

export function creationAeDocument(value: Json, name: string) {
    const s = structuredSnapshot(value, 'ae'), t = s.tables;
    if (t.PSAEAPPLDEFN.length !== 1 || String(t.PSAEAPPLDEFN[0].AE_APPLID).trim() !== name) throw new Error('Creation checkpoint identifies another AE program.');
    const source = new Map<string, string>();
    for (const r of [...t.PSPCMTXT].sort((a, b) => Number(a.PROGSEQ) - Number(b.PROGSEQ))) {
        if (r.OBJECTID1 !== 66 || String(r.OBJECTVALUE1).trim() !== name || typeof r.PCTEXT !== 'string') throw new Error('Invalid AE PeopleCode source scope.');
        const key = [1, 2, 3, 4, 5, 6, 7].map(n => String(r['OBJECTVALUE' + n])).join('|');
        source.set(key, (source.get(key) ?? '') + r.PCTEXT);
    }
    const native: AppEngineRows = { program: rows(t.PSAEAPPLDEFN)[0], states: rows(t.PSAEAPPLSTATE), tempTables: rows(t.PSAEAPPLTEMPTBL),
        languages: rows(t.PSAEAPPLLANG), sections: rows(t.PSAESECTDEFN), variants: rows(t.PSAESECTDTLDEFN), steps: rows(t.PSAESTEPDEFN),
        actions: rows(t.PSAESTMTDEFN), messages: rows(t.PSAESTEPMSGDEFN), sqlText: rows(t.PSSQLTEXTDEFN) };
    return documentFromRows(native, source);
}

/** The caller supplies only exact stored dependency blobs, never an arbitrary agent catalogue. */
export function proposedAeReferences(live: AeReferenceLookup, context?: ReviewValidationContext): AeValidationOverlay | undefined {
    if (!context || context.phase === 'live') return undefined;
    const records = new Map<string, readonly string[]>(), sql = new Map<string, { binds: number; columns: number }>();
    const programs = new Map<string, { name: string; isPublic: boolean }[]>();
    const put = <T>(map: Map<string, T>, key: string, value: T) => {
        if (map.has(key)) throw new Error('Ambiguous proposed dependency identity: ' + key);
        map.set(key, value);
    };
    for (const d of context.dependencies) {
        if (typeof d.key !== 'string') continue;
        if (d.adapter === 'record-create') {
            const edit = creationRecordEdit(d.after, d.key);
            put(records, d.key, edit.fields.map(f => f.name));
        } else if (d.adapter === 'sql' && d.after && typeof d.after === 'object' && !Array.isArray(d.after) && typeof d.after.text === 'string') {
            put(sql, d.key, { binds: bindMarkerCount(d.after.text), columns: selectList(d.after.text)?.length ?? 0 });
        } else if (d.adapter === 'ae-create') {
            const doc = creationAeDocument(d.after, d.key);
            put(programs, d.key, doc.sections.map(s => ({ name: s.name, isPublic: s.isPublic })));
        }
    }
    return { records, sql, references: { ...live,
        recordType: async name => records.has(name) ? RecordType.DerivedWork : live.recordType(name),
        recordFields: async name => records.has(name) ? [...records.get(name)!] : live.recordFields(name),
        programSections: async name => programs.get(name) ?? live.programSections(name) } };
}

export function creationKey(family: StructuredFamily, key: Json): string {
    if (typeof key !== 'string' || !(family === 'record' ? /^[A-Z][A-Z0-9_]{0,14}$/ : /^[A-Z][A-Z0-9_]{0,11}$/).test(key)) throw new Error('Invalid creation review key.');
    return key;
}

/** Definition-existence assumptions are usable only by a rolled-back project preview. */
export function proposedProjectMembers(context?: ReviewValidationContext): DefinitionKey[] {
    if (!context || context.phase === 'live') return [];
    const keys: DefinitionKey[] = [];
    for (const d of context.dependencies) {
        if (typeof d.key !== 'string') continue;
        if (d.adapter === 'record-create') {
            creationRecordEdit(d.after, d.key);
            keys.push(makeKey(DefinitionType.Record, d.key));
        } else if (d.adapter === 'sql' && d.after !== null) keys.push(makeKey(DefinitionType.SqlDefinition, d.key, '0'));
        else if (d.adapter === 'ae-create') {
            const doc = creationAeDocument(d.after, d.key), native = structuredSnapshot(d.after, 'ae');
            keys.push(makeKey(DefinitionType.AppEngineProgram, d.key));
            for (const s of doc.sections) {
                keys.push(makeKey(DefinitionType.AppEngineSection, d.key, s.name));
                for (const v of s.variants) for (const st of v.steps) if (st.actions.some(a => a.type === 'P')) {
                    const parts = peopleCodeKey(d.key, s.name, v, st.name);
                    if (!parts) throw new Error('AE action has an invalid project PeopleCode key.');
                    keys.push(makeKey(DefinitionType.AppEnginePeopleCode, ...parts));
                }
            }
            for (const sql of native.tables.PSSQLDEFN) keys.push(makeKey(DefinitionType.SqlDefinition, String(sql.SQLID), String(sql.SQLTYPE)));
        }
    }
    return keys;
}
