/*
 * Cycle 56 Phase 1/2/3: reconstruct definition 28726 fresh -- full source,
 * stored PSPCMNAME rows, generated references, and executable operand
 * mapping -- without trusting Cycle 55's own end-of-cycle characterization.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle56-28726-reconstruction.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

function ownerContext(snapshot: any) {
  const values = [snapshot.objectvalue1, snapshot.objectvalue2, snapshot.objectvalue3, snapshot.objectvalue4, snapshot.objectvalue5, snapshot.objectvalue6, snapshot.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

const db = openSnapshotDatabase();
const snap = getSnapshotDefinition(db, 28726);
const parsed = parseApplicationClassSource(snap.sourceText)!;

console.log('className:', parsed.className);
console.log('extendsType:', parsed.extendsType);
console.log('methods:', parsed.members.filter((m: any) => m.kind === 'method').map((m: any) => m.name));

console.log('\n--- full source ---');
console.log(snap.sourceText);

console.log('\n--- stored PSPCMNAME rows ---');
for (const r of snap.names) {
  console.log(`  ${r.namenum}: recname=${JSON.stringify(r.recname.trim())} refname=${JSON.stringify(r.refname.trim())} packageroot=${JSON.stringify(r.packageroot.trim())} qualifypath=${JSON.stringify(r.qualifypath.trim())} appclassmethod=${JSON.stringify(r.appclassmethod.trim())}`);
}

const artifacts = encodeProgramArtifacts(snap.sourceText, { owner: ownerContext(snap) });
console.log('\n--- generated references ---');
for (const r of artifacts.references) console.log('  ', JSON.stringify(r));

console.log('\n--- byte comparison ---');
const gen = artifacts.program;
const stored = snap.storedProgram;
console.log('generated length:', gen.length, 'stored length:', stored.length);
const minLen = Math.min(gen.length, stored.length);
let firstDiff = -1;
for (let i = 0; i < minLen; i++) { if (gen[i] !== stored[i]) { firstDiff = i; break; } }
console.log('first diff offset:', firstDiff, 'pct:', firstDiff < 0 ? 100 : Math.round((firstDiff / Math.max(gen.length, stored.length)) * 1000) / 10);

// Operand usage of ADSRelationship-family namenums.
const names = new NameTable();
for (const row of snap.names) {
  const name = row.recname.trim() && row.refname.trim() ? `${row.recname.trim()}.${row.refname.trim()}` : (row.refname.trim() || row.recname.trim());
  names.add(row.namenum, name);
}
try {
  const decoded = decodeProgram(snap.storedProgram, names, { mode: 'auto' });
  const targetRows = snap.names.filter(r => r.refname.trim().toUpperCase() === 'ADSRELATIONSHIP');
  console.log('\n--- stored rows matching ADSRELATIONSHIP ---');
  for (const r of targetRows) {
    const used = decoded.tokens.filter((t: any) => t.nameNum === r.namenum);
    console.log(`  namenum=${r.namenum} operand-uses=${used.length}`);
  }
} catch (error) {
  console.log('decode failed:', error instanceof Error ? error.message : String(error));
}

db.close();
