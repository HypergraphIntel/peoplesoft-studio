/*
 * Cycle 101: where an Application Class roundtrip loses information
 * (research only).
 *
 * The corpus roundtrip (validator TEST B) is: stored PSPCMPROG -> decoder ->
 * PeopleCode text -> encoder -> PSPCMPROG. The decoder renders SOURCE TEXT
 * from the statement section; the name table, directory and slots are
 * re-derived by the encoder from that text. For every definition id given
 * this tool performs the same roundtrip and the direct source encode, and
 * reports for the roundtrip bytes versus stored:
 *
 *   - which sections differ (header fields, statements, names, records,
 *     slots) -- as `cycle100-appclass-section-census.ts` does for the
 *     direct encode;
 *   - the first differing line between the ORIGINAL source and the DECODED
 *     text (whitespace-normalized), which is where the information that
 *     the encoder needs was lost;
 *   - the class metadata parsed from both texts (member counts, and the
 *     first member whose kind / mode / type / name differs);
 *   - the first TOKEN divergence between the stored program and the
 *     roundtrip bytes, both decoded (`opcode:text`, four tokens either
 *     side). The text diff above is blank-line-blind; this is not, and it
 *     is what located the Cycle 101 mechanism: every one of the 102
 *     ROUNDTRIP_ONLY definitions diverges by one 0x4F blank-line marker
 *     (lost after `private` / `protected`, or added after `end-get;` /
 *     `end-set;`, a declaration, or a `While` header's trailing comment).
 *
 * Output: JSON lines.
 *
 * Usage: npx tsx tools/corpus/research/cycle101-roundtrip-section-census.ts <ids.json> <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgram } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';
import { readProgramLayout } from '../../../src/peoplecode/programLayout';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';

function context(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : values[0],
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function sections(bytes: Buffer) {
  const layout = readProgramLayout(bytes);
  const text = bytes.subarray(layout.names.offset, layout.names.offset + layout.names.byteLength).toString('utf16le');
  return {
    header: [layout.statements.byteLength, layout.names.byteLength, layout.slotCount, layout.recordCount],
    statements: bytes.subarray(layout.statements.offset, layout.statements.offset + layout.statements.byteLength),
    names: text.split('\0').slice(0, -1),
    records: bytes.subarray(layout.records.offset, layout.records.offset + layout.records.byteLength),
    slots: bytes.subarray(layout.slots.offset, layout.slots.offset + layout.slots.byteLength)
  };
}

function members(source: string) {
  try {
    const parsed: any = parseApplicationClassSource(source);
    if (!parsed) return undefined;
    return parsed.members.map((m: any) => `${m.kind}:${m.mode ?? ''}:${m.visibility ?? ''}:${m.name}:${m.type ?? m.returnType ?? ''}:${(m.parameters ?? []).map((p: any) => p.type).join(',')}`);
  } catch { return undefined; }
}

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ids = new Set<number>(Array.isArray(raw) ? raw : [...(raw.app ?? []), ...(raw.other ?? [])]);
const out = fs.openSync(process.argv[3], 'w');
for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  if (!ids.has(def.definitionId)) continue;
  const row: any = { id: def.definitionId, app: def.objectid1 === 104 };
  try {
    const names = new NameTable();
    for (const r of def.names) names.add(Number(r.namenum), `${String(r.recname ?? '').trim()}.${String(r.refname ?? '').trim()}`);
    const decoded = decodeProgram(def.storedProgram, names, { mode: 'auto', isApplicationClass: def.objectid1 === 104 });
    const commentOpcodes = decoded.tokens.map((t: any) => t.opcode).filter((o: number) => o === 0x24 || o === 0x4e);
    const roundtrip = encodeProgram(decoded.text, { owner: context(def), commentOpcodes } as any);
    row.roundtripExact = roundtrip.equals(def.storedProgram);
    if (!row.roundtripExact) {
      const signature = (t: any) => `${t.opcode.toString(16)}:${String(t.text ?? '').slice(0, 50)}`;
      const options = { mode: 'auto', isApplicationClass: def.objectid1 === 104 } as const;
      const a = decoded.tokens.map(signature);
      const b = decodeProgram(roundtrip, names, options).tokens.map(signature);
      let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      row.tokenFirstDiff = { index: i, stored: a.slice(Math.max(0, i - 4), i + 4), roundtrip: b.slice(Math.max(0, i - 4), i + 4) };
    }
    if (row.app) {
      const s = sections(def.storedProgram), r = sections(roundtrip);
      row.diff = [
        ...(['statementBytes', 'nameBytes', 'slotCount', 'recordCount'].filter((_, i) => s.header[i] !== r.header[i]).map(k => 'header.' + k)),
        ...(s.statements.equals(r.statements) ? [] : ['statements']),
        ...(JSON.stringify(s.names) === JSON.stringify(r.names) ? [] : ['names']),
        ...(s.records.equals(r.records) ? [] : ['records']),
        ...(s.slots.equals(r.slots) ? [] : ['slots'])
      ];
      if (!s.statements.equals(r.statements)) {
        let i = 0; while (i < Math.min(s.statements.length, r.statements.length) && s.statements[i] === r.statements[i]) i++;
        row.statementsFirstDiff = i;
      }
      if (JSON.stringify(s.names) !== JSON.stringify(r.names)) {
        row.namesOnlyStored = s.names.filter(n => !r.names.includes(n)).slice(0, 6);
        row.namesOnlyRoundtrip = r.names.filter(n => !s.names.includes(n)).slice(0, 6);
      }
      const original = members(def.sourceText), fromDecoded = members(decoded.text);
      if (original && fromDecoded) {
        const k = original.findIndex((m: string, i: number) => m.toLowerCase() !== (fromDecoded[i] ?? '').toLowerCase());
        row.memberDiff = k < 0 && original.length === fromDecoded.length ? null : { index: k, original: original[k] ?? null, decoded: fromDecoded[k] ?? null, counts: [original.length, fromDecoded.length] };
      } else row.memberDiff = { parse: [!!original, !!fromDecoded] };
    }
    const norm = (t: string) => t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const a = norm(def.sourceText), b = norm(decoded.text);
    const k = a.findIndex((l, i) => l.toLowerCase().replace(/\s+/g, ' ') !== (b[i] ?? '').toLowerCase().replace(/\s+/g, ' '));
    row.textFirstDiff = k < 0 ? null : { line: k, original: a[k]?.slice(0, 120), decoded: b[k]?.slice(0, 120) };
  } catch (e) { row.error = String(e).slice(0, 200); }
  fs.writeSync(out, JSON.stringify(row) + '\n');
}
fs.closeSync(out);
