/*
 * Cycle 77 Phase 21 direct verification (read-only, no encoder/decoder
 * changes): confirm that decoding with `isApplicationClass: true` (an
 * already-implemented, already-tested decoder option that
 * tools/corpus/validator.ts's own decode call never sets) actually
 * eliminates the "could not be fully decoded" fallback and produces
 * source matching the original, for the objectid1===104 definitions
 * whose FIRST unmapped opcode was found (via /tmp census) to be 0x5a.
 *
 * Usage: npx tsx tools/corpus/research/cycle77-appclass-flag-verify.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';
import { sourcesMatch } from '../../../src/peoplecode/corpus/sourceNormalize';

const IDS = [28700, 28701, 28702, 28703, 28705, 29389];

function buildNames(nameRows: { namenum: number; recname: string; refname: string }[]): NameTable {
  const names = new NameTable();
  for (const row of nameRows) {
    const recname = String(row.recname ?? '').trim();
    const refname = String(row.refname ?? '').trim();
    let name: string;
    if (recname && refname) name = `${recname}.${refname}`;
    else if (refname) name = refname;
    else name = recname;
    names.add(Number(row.namenum), name);
  }
  return names;
}

function main() {
  const db = openSnapshotDatabase();

  for (const id of IDS) {
    const snap = getSnapshotDefinition(db, id);
    const names = buildNames(snap.names as any);

    const withoutFlag = decodeProgram(snap.storedProgram, names, { mode: 'auto' });
    const withFlag = decodeProgram(snap.storedProgram, names, { mode: 'auto', isApplicationClass: true });

    const matchWithout = sourcesMatch(withoutFlag.text, snap.sourceText);
    const matchWith = sourcesMatch(withFlag.text, snap.sourceText);

    console.log(`\n=== ${id} (objectid1=${snap.objectid1}) ===`);
    console.log('  without flag: unmapped=' + withoutFlag.unknownOpcodes.length + ' sourceMatch=' + matchWithout);
    console.log('  with flag:    unmapped=' + withFlag.unknownOpcodes.length + ' sourceMatch=' + matchWith);

    if (withFlag.unknownOpcodes.length > 0) {
      console.log('  remaining unmapped (first 5):', withFlag.unknownOpcodes.slice(0, 5));
    }
    if (!matchWith) {
      const a = withFlag.text;
      const b = snap.sourceText;
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      console.log('  first divergence at char', i);
      console.log('  decoded  :', JSON.stringify(a.slice(Math.max(0, i - 40), i + 60)));
      console.log('  original :', JSON.stringify(b.slice(Math.max(0, i - 40), i + 60)));
    }
  }
}

main();
