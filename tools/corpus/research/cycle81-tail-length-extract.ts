/*
 * Cycle 81 Phase 1-9 (population extraction + root-cause verification,
 * read-only against the pre-fix encoder).
 *
 * CORRECTION to the brief's own framing: Cycle 80's closing residual
 * census labelled 15 of the 32 remaining ROUNDTRIP_ONLY definitions
 * "EOF->EOF" (interpreted as "shared body prefix identical, total
 * length differs"). That was a bug in the census script itself -- its
 * byte-diff helper returned `undefined` when two buffers are FULLY
 * IDENTICAL (same length, same bytes), and the script's own display
 * logic then printed 'EOF' for an undefined offset, indistinguishable
 * from a genuine "ran off the end of the shorter buffer" case.
 *
 * Directly re-diffing these 15 definitions' re-encoded (from decoded
 * text) PSPCMPROG against the stored bytes found the HEADER and BODY
 * are BOTH already 100% byte-identical -- there is no length-only or
 * tail-only divergence at all. Yet `roundtripExact` was still false,
 * because `validator.ts`'s real semanticRoundTrip test passes an
 * explicit `commentOpcodes` array (each 0x24/0x4E opcode found in
 * decoder order) that this script's own naive re-encode omitted.
 * Passing it exposed the REAL bug: `encodeApplicationClassProgramV2`
 * encodes several independent fragments (leading prefix, each method
 * body) via a shared `encodeFragment` closure whose `commentOpcodes`
 * default was the WHOLE, unsliced program-level array every time --
 * each fragment's own `encodeFragmentInternal` call starts its local
 * comment index at 0, so every fragment after the first silently
 * re-read entries meant for an earlier fragment (or for comments
 * consumed outside `consumeCommentOpcode` entirely, by the prefix/
 * layout-range comment scanners). This script demonstrates the
 * without-vs-with-commentOpcodes discrepancy directly.
 *
 * Usage: npx tsx tools/corpus/research/cycle81-tail-length-extract.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { encodeProgram } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const OUT_PATH = path.join(__dirname, '../../../.claude/cycle81-length-only.json');

function buildEncodeContext(snap: any) {
  const values = [snap.objectvalue1, snap.objectvalue2, snap.objectvalue3, snap.objectvalue4, snap.objectvalue5, snap.objectvalue6, snap.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const packagePath = values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean);
  return { owner: { recordName: values[0], fieldName: values[1], packagePath } };
}

function buildNames(nameRows: any[]): NameTable {
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

// The 15 definitions Cycle 80 left in ROUNDTRIP_ONLY that this cycle's
// commentOpcodes-index fix resolved (identified directly, since by the
// time this diagnostic runs the current taxonomy.json already reflects
// the post-fix state and no longer lists them under ROUNDTRIP_ONLY).
const TARGET_IDS = [
  28816, 28830, 29061, 29062, 29203, 29205, 29207, 29215,
  29764, 29768, 29769, 29780, 29819, 29821, 29920
];

async function main() {
  const ids = TARGET_IDS;
  console.log(`Target population: ${ids.length}`);

  const db = openSnapshotDatabase();
  const rows: any[] = [];

  for (const id of ids) {
    const snap = getSnapshotDefinition(db, id);
    const eContext = buildEncodeContext(snap);
    const names = buildNames(snap.names as any);
    const isAppClass = snap.objectid1 === 104;

    const decoded = decodeProgram(snap.storedProgram, names, { mode: 'auto', isApplicationClass: isAppClass });
    const decodedCommentOpcodes = decoded.tokens.map(t => t.opcode).filter(op => op === 0x24 || op === 0x4e);

    const withoutProvenance = encodeProgram(decoded.text, eContext);
    const withProvenance = encodeProgram(decoded.text, { ...eContext, commentOpcodes: decodedCommentOpcodes });

    const identicalWithoutProvenance = withoutProvenance.equals(snap.storedProgram);
    const identicalWithProvenance = withProvenance.equals(snap.storedProgram);

    if (identicalWithoutProvenance && !identicalWithProvenance) {
      rows.push({
        definitionId: id,
        appClass: isAppClass,
        commentOpcodeCount: decodedCommentOpcodes.length,
        commentOpcodes: decodedCommentOpcodes.map(o => '0x' + o.toString(16)),
        note: 'body+header fully identical without explicit provenance; explicit commentOpcodes array (matching validator.ts) misaligns and breaks it'
      });
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`commentOpcodes-index-misalignment population: ${rows.length}`);
  const appClassCount = rows.filter(r => r.appClass).length;
  console.log(`App Class: ${appClassCount} / Ordinary: ${rows.length - appClassCount}`);
}

main();
