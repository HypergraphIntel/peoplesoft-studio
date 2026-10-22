import { canonical, type Json } from './model.js';
import { documentFromRows, type AeDocument } from '../model/aeDocument.js';
import type { AppEngineRows, Row } from '../model/appEngine.js';
import { structuredSnapshot, type StructuredSnapshot } from '../providers/structuredSnapshot.js';

/** The native deletion records App Designer writes for a deleted program, section, SQL or PeopleCode key (APP_ENGINE.md). */
export const AE_TOMBSTONE_TABLES = ['PSAEAPPLDEL', 'PSAESECTDEL', 'PSSQLDEL', 'PSPCMPROGDEL'] as const;

/**
 * The App Engine document a reviewed twenty-table checkpoint stores: its program, sections, variants, steps, actions,
 * messages, SQL text and PeopleCode source, read exactly as the program reader reads them (documentFromRows). The
 * shared writer saves it against the live program; native preview must reproduce the whole checkpoint.
 */
export function aeDocumentFromSnapshot(name: string, value: unknown): AeDocument {
    const t = structuredSnapshot(value, 'ae').tables;
    if (t.PSAEAPPLDEFN.length !== 1 || String(t.PSAEAPPLDEFN[0].AE_APPLID ?? '').trim() !== name) throw new Error('Checkpoint identifies another definition.');
    const rows = (table: string) => t[table] as unknown as Row[];
    const aeRows: AppEngineRows = { program: rows('PSAEAPPLDEFN')[0], states: rows('PSAEAPPLSTATE'), tempTables: rows('PSAEAPPLTEMPTBL'), languages: rows('PSAEAPPLLANG'),
        sections: rows('PSAESECTDEFN'), variants: rows('PSAESECTDTLDEFN'), steps: rows('PSAESTEPDEFN'), actions: rows('PSAESTMTDEFN'),
        messages: rows('PSAESTEPMSGDEFN'), sqlText: rows('PSSQLTEXTDEFN') };
    // PeopleCode source by its seven-part key, its PSPCMTXT chunks in PROGSEQ order.
    const chunks = new Map<string, Array<{ seq: number; text: string }>>();
    for (const r of t.PSPCMTXT) {
        const k = [1, 2, 3, 4, 5, 6, 7].map(n => String(r['OBJECTVALUE' + n] ?? '')).join('|');
        chunks.set(k, [...(chunks.get(k) ?? []), { seq: Number(r.PROGSEQ), text: String(r.PCTEXT ?? '') }]);
    }
    const sources = new Map([...chunks].map(([k, c]) => [k, c.sort((a, b) => a.seq - b.seq).map(x => x.text).join('')]));
    return documentFromRows(aeRows, sources);
}

/**
 * Whether `after` is `checkpoint` with only native deletion records added: every other table exactly the checkpoint's,
 * every checkpoint tombstone kept, and every added tombstone new against `live` (written by this transition).
 */
export function aeTombstoneProjection(checkpointValue: unknown, liveValue: unknown, afterValue: unknown): string | undefined {
    const checkpoint = structuredSnapshot(checkpointValue, 'ae'), live = structuredSnapshot(liveValue, 'ae'), after = structuredSnapshot(afterValue, 'ae');
    const rows = (s: StructuredSnapshot, table: string) => new Set(s.tables[table].map(r => canonical(r as Json)));
    for (const table of Object.keys(checkpoint.tables)) {
        if ((AE_TOMBSTONE_TABLES as readonly string[]).includes(table)) {
            const was = rows(checkpoint, table), now = rows(after, table), before = rows(live, table);
            if ([...was].some(r => !now.has(r))) return `The undo would remove a deletion record the checkpoint holds (${table}).`;
            if ([...now].some(r => !was.has(r) && before.has(r))) return `The undo target carries a deletion record it did not write (${table}).`;
        } else if (canonical(asSaved(checkpoint, after, table) as Json) !== canonical(after.tables[table] as Json)) {
            return `The native writer cannot restore ${table} exactly to the checkpoint.`;
        }
    }
    return undefined;
}

/** A checkpoint table as any save stores it: App Designer sets a program's NULL ASOF_DT to 1900-01-01 on its first re-save [ap01]. */
function asSaved(checkpoint: StructuredSnapshot, after: StructuredSnapshot, table: string) {
    const rows = checkpoint.tables[table];
    if (table !== 'PSAEAPPLDEFN' || rows.length !== 1 || rows[0].ASOF_DT !== null || !String(after.tables[table][0]?.ASOF_DT ?? '').startsWith('1900-01-01')) return rows;
    return [{ ...rows[0], ASOF_DT: after.tables[table][0].ASOF_DT }];
}
