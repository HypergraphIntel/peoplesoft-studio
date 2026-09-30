/*
 * Cycle 100: section-level byte census of Application Class programs
 * (research only).
 *
 * PSPCMPROG layout (`programLayout.ts`): a 37-byte header (statement
 * byte length @5, name-table byte length @13, slot count @21, record
 * count @29, format @33), then the statement section (ending 0x07), the
 * UTF-16LE name table, the 16-byte directory records and the 4-byte
 * dispatch slots. For every definition id given, the stored and
 * generated programs are split into sections and compared section by
 * section and field by field:
 *
 *   header      which of the five header fields differ
 *   statements  equal / differ (+ first differing offset)
 *   names       the decoded name-table entries: equal, or the entries only
 *               on one side / reordered
 *   records     per record, which of the four 32-bit fields differ
 *               (name offset, signature slot offset, flags|low, descriptor)
 *   slots       equal / differ (+ count)
 *
 * It also records class metadata from the source (members by kind,
 * extends / implements, method count) for correlation.
 *
 * Output: JSON lines, one per definition.
 *
 * Usage: npx tsx tools/corpus/research/cycle100-appclass-section-census.ts <ids.json> <out.jsonl>
 *        (ids.json: an array of definition ids, or {"app": [...]})
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { readProgramLayout } from '../../../src/peoplecode/programLayout';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';

function ownerOf(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function sections(bytes: Buffer) {
  const layout = readProgramLayout(bytes);
  const names: string[] = [];
  const nameBytes = bytes.subarray(layout.names.offset, layout.names.offset + layout.names.byteLength).toString('utf16le');
  let start = 0;
  for (let i = 0; i < nameBytes.length; i++) if (nameBytes[i] === '\0') { names.push(nameBytes.slice(start, i)); start = i + 1; }
  const records: number[][] = [];
  for (let r = 0; r < layout.recordCount; r++) {
    const o = layout.records.offset + r * 16;
    records.push([bytes.readUInt32LE(o), bytes.readUInt32LE(o + 4), bytes.readUInt32LE(o + 8), bytes.readUInt32LE(o + 12)]);
  }
  const slots: number[] = [];
  for (let k = 0; k < layout.slotCount; k++) slots.push(bytes.readUInt32LE(layout.slots.offset + k * 4));
  return {
    header: { statementBytes: layout.statements.byteLength, nameBytes: layout.names.byteLength, slotCount: layout.slotCount, recordCount: layout.recordCount, format: layout.format },
    statements: bytes.subarray(layout.statements.offset, layout.statements.offset + layout.statements.byteLength),
    names, records, slots
  };
}

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ids = new Set<number>(Array.isArray(raw) ? raw : raw.app);
const out = fs.openSync(process.argv[3], 'w');
for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  if (!ids.has(def.definitionId)) continue;
  const row: any = { id: def.definitionId, path: [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5].map((v: string) => (v ?? '').trim()).filter(Boolean).join(':') };
  try {
    const generated = encodeProgramArtifacts(def.sourceText, { owner: ownerOf(def) } as any).program as Buffer;
    const s = sections(def.storedProgram), g = sections(generated);
    row.lengths = [def.storedProgram.length, generated.length];
    row.headerDiff = Object.keys(s.header).filter(k => (s.header as any)[k] !== (g.header as any)[k]).map(k => `${k}:${(s.header as any)[k]}/${(g.header as any)[k]}`);
    row.statementsEqual = s.statements.equals(g.statements);
    if (!row.statementsEqual) {
      let i = 0; while (i < Math.min(s.statements.length, g.statements.length) && s.statements[i] === g.statements[i]) i++;
      row.statementsFirstDiff = i;
    }
    row.namesEqual = JSON.stringify(s.names) === JSON.stringify(g.names);
    if (!row.namesEqual) {
      row.namesOnlyStored = s.names.filter(n => !g.names.includes(n));
      row.namesOnlyGenerated = g.names.filter(n => !s.names.includes(n));
      row.namesSameSetReordered = row.namesOnlyStored.length === 0 && row.namesOnlyGenerated.length === 0;
      row.storedNames = s.names; row.generatedNames = g.names;
    }
    row.recordCounts = [s.records.length, g.records.length];
    const fieldNames = ['nameOffset', 'slotOffset', 'flagsLow', 'descriptor'];
    row.recordFieldDiffs = [] as string[];
    if (s.records.length === g.records.length) {
      s.records.forEach((rec, r) => rec.forEach((v, f) => { if (v !== g.records[r][f]) row.recordFieldDiffs.push(`${r}.${fieldNames[f]}:${v.toString(16)}/${g.records[r][f].toString(16)}`); }));
    }
    row.slotsEqual = JSON.stringify(s.slots) === JSON.stringify(g.slots);
    row.slotCounts = [s.slots.length, g.slots.length];
    if (!row.slotsEqual) { row.storedSlots = s.slots.map(v => v.toString(16)); row.generatedSlots = g.slots.map(v => v.toString(16)); }
    row.storedRecords = s.records.map(r => r.map(v => v.toString(16)));
    row.generatedRecords = g.records.map(r => r.map(v => v.toString(16)));
    try {
      const cls: any = parseApplicationClassSource(def.sourceText);
      row.meta = {
        unitKind: cls.unitKind, extendsType: cls.extendsType ?? null, implementsType: cls.implementsType ?? null,
        methods: cls.members.filter((m: any) => m.kind === 'method').length,
        properties: cls.members.filter((m: any) => m.kind === 'property').length,
        instances: cls.members.filter((m: any) => m.kind === 'instance').length,
        constants: cls.members.filter((m: any) => m.kind === 'constant').length,
        implementations: cls.implementations.length
      };
    } catch (e) { row.meta = { parseError: String(e).slice(0, 80) }; }
  } catch (e) { row.error = String(e).slice(0, 160); }
  fs.writeSync(out, JSON.stringify(row) + '\n');
}
fs.closeSync(out);
