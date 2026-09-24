import Database from 'better-sqlite3';
import { encodeProgram, ReferenceTraceEvent } from './src/peoplecode/encoder';

const db = new Database('./tools/corpus/hcdev-snapshot.sqlite', { readonly: true });
const row = db.prepare('SELECT source_text, stored_program FROM snapshot_definition WHERE definition_id = ? ORDER BY snapshot_id DESC LIMIT 1').get(1145) as any;
const source = row.source_text as string;

const events: ReferenceTraceEvent[] = [];
const generated = encodeProgram(source, { referenceTrace: (e) => events.push(e) });

for (const e of events) {
  if (e.reference.kind === 'record' && e.reference.recordName === 'ANALYSIS_DB') {
    console.log(e.action, 'idx=', e.reference.index, 'group=', e.controlGroup, 'src=', e.sourceOffset);
  }
}
