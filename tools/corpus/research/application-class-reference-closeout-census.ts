/*
 * Cycle 48: fresh, LIVE re-classification of the historically-frozen
 * Application Class reference-identity population (41 IDs, tracked since
 * Cycle 32). Unlike `application-class-reference-analysis.ts` (which reads
 * frozen Cycle 24/28/31 JSON reports and therefore cannot reflect any
 * encoder change made since those reports were captured -- see Cycle 44's
 * own finding that its classifications go stale), this tool re-derives
 * everything directly against the CURRENT encoder for each definition:
 *
 *  - sourceEncodeExact (byte-for-byte forward encode, via the same
 *    `validateDefinition` pipeline the CLI harness uses);
 *  - the body-relative first-difference offset and its position as a
 *    percentage through the program (skipping the fixed 37-byte header);
 *  - a coarse causal tag for the first differing bytes: whether they look
 *    like a reference operand (0x21/0x4A/0x48), a marker byte (0x4F), or
 *    something else -- enough to separate "still genuinely reference-
 *    blocked" from "advanced to a marker/names/other blocker" without
 *    guessing at PSPCMNAME row semantics (which even the frozen analyzer
 *    got wrong once, per Cycle 44).
 *
 * Usage: npx tsx tools/corpus/research/application-class-reference-closeout-census.ts [--json] <id> [<id> ...]
 * With no IDs given, runs the frozen Cycle 32-44 41-root population.
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition, snapshotToCorpusDefinition } from '../snapshot/reader';
import { LocalCorpusDataSource } from '../local-datasource';
import { validateDefinition } from '../validator';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const FROZEN_41_ROOT_IDS = [
  28713, 28745, 28752, 28755, 28801, 28802, 28852, 28862, 28898, 28904,
  28915, 28925, 28935, 28959, 28964, 28972, 28975, 29044, 29087, 29099,
  29107, 29109, 29110, 29113, 29122, 29126, 29134, 29144, 29174, 29182,
  29186, 29191, 29202, 29389, 29452, 29518, 29522, 29542, 29612, 29614,
  30104
];

interface CloseoutRow {
  definitionId: number;
  classification: string;
  sourceEncodeExact: boolean;
  bodyFirstDiffOffset: number;
  bodyLenGenerated: number;
  bodyLenStored: number;
  pctThroughProgram: number;
  firstDiffWindowHex: { stored: string; generated: string };
  causalTag: 'exact' | 'reference-operand' | 'marker-0x4F' | 'other';
}

function ownerContext(snapshot: any) {
  const values = [
    snapshot.objectvalue1, snapshot.objectvalue2, snapshot.objectvalue3,
    snapshot.objectvalue4, snapshot.objectvalue5, snapshot.objectvalue6,
    snapshot.objectvalue7
  ].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return {
    recordName: values[0],
    fieldName: values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function classifyFirstDiff(stored: Buffer, generated: Buffer, offset: number): CloseoutRow['causalTag'] {
  // Look a few bytes back from the differing byte for a reference-operand
  // opcode (0x21/0x4A/0x48) or a marker opcode (0x4F) immediately preceding
  // the point of divergence in EITHER stream -- both streams agree up to
  // `offset`, so this inspects shared context plus each side's own tail.
  const window = 6;
  const storedWindow = stored.slice(Math.max(0, offset - window), offset + 2);
  const generatedWindow = generated.slice(Math.max(0, offset - window), offset + 2);
  const hasRefOpcode = (buf: Buffer) => buf.includes(0x21) || buf.includes(0x4a) || buf.includes(0x48);
  const hasMarkerOpcode = (buf: Buffer) => buf.includes(0x4f);
  if (hasRefOpcode(storedWindow) || hasRefOpcode(generatedWindow)) return 'reference-operand';
  if (hasMarkerOpcode(storedWindow) || hasMarkerOpcode(generatedWindow)) return 'marker-0x4F';
  return 'other';
}

async function censusOne(definitionId: number, dataSource: LocalCorpusDataSource, db: ReturnType<typeof openSnapshotDatabase>): Promise<CloseoutRow> {
  const snapshot = getSnapshotDefinition(db, definitionId);
  const definition = snapshotToCorpusDefinition(snapshot, definitionId);
  const capture = await dataSource.capture({ definitionId, definition });
  const result = await validateDefinition(capture, {});

  const artifacts = encodeProgramArtifacts(snapshot.sourceText, { owner: ownerContext(snapshot) });
  const gen = artifacts.program.slice(37);
  const stored = snapshot.storedProgram.slice(37);
  const minLen = Math.min(gen.length, stored.length);
  let firstDiff = -1;
  for (let i = 0; i < minLen; i++) { if (gen[i] !== stored[i]) { firstDiff = i; break; } }
  const exact = firstDiff === -1 && gen.length === stored.length;
  if (firstDiff === -1 && !exact) firstDiff = minLen;

  const causalTag = exact ? 'exact' : classifyFirstDiff(stored, gen, firstDiff);
  const pct = exact ? 100 : Math.round((firstDiff / Math.max(stored.length, gen.length, 1)) * 1000) / 10;

  return {
    definitionId,
    classification: result.classification,
    sourceEncodeExact: result.sourceEncodeExact,
    bodyFirstDiffOffset: firstDiff,
    bodyLenGenerated: gen.length,
    bodyLenStored: stored.length,
    pctThroughProgram: pct,
    firstDiffWindowHex: {
      stored: stored.slice(Math.max(0, firstDiff - 8), firstDiff + 12).toString('hex'),
      generated: gen.slice(Math.max(0, firstDiff - 8), firstDiff + 12).toString('hex')
    },
    causalTag
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const idArgs = args.filter(a => a !== '--json').map(Number).filter(n => !Number.isNaN(n));
  const ids = idArgs.length > 0 ? idArgs : FROZEN_41_ROOT_IDS;

  const db = openSnapshotDatabase();
  const dataSource = new LocalCorpusDataSource();
  const rows: CloseoutRow[] = [];
  for (const id of ids) {
    rows.push(await censusOne(id, dataSource, db));
  }
  db.close();

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const byTag = new Map<string, number>();
  for (const r of rows) byTag.set(r.causalTag, (byTag.get(r.causalTag) ?? 0) + 1);

  console.log(`Definitions censused: ${rows.length}`);
  console.log('By causal tag of first divergence:');
  for (const [tag, count] of byTag) console.log(`  ${tag}: ${count}`);
  console.log('');
  for (const r of rows) {
    console.log(
      `${r.definitionId}\tsourceEncodeExact=${r.sourceEncodeExact}\tpct=${r.pctThroughProgram}\ttag=${r.causalTag}`
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
