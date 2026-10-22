/**
 * Read-only, local: how often Format Document reproduces Application Designer's stored text (PSPCMTXT) on the HCDEV
 * snapshot. For a sample of programs: the stored text must format to itself, and with every line's indentation
 * removed it must format back to the stored text. Prints counts only -- no HCDEV source leaves the snapshot.
 *
 * npx tsx tools/lab/peoplecode-format-corpus.mts [every-nth=10] [offset=0]
 */
import Database from 'better-sqlite3';
import { formatProgramSource } from '../../src/peoplecode/formatProgram.js';

const every = Number(process.argv[2] ?? 10), offset = Number(process.argv[3] ?? 0);
const db = new Database('tools/corpus/hcdev-snapshot.sqlite', { readonly: true });
const rows = db.prepare(`SELECT definition_id, objectid1, objectvalue1, objectid2, objectvalue2, objectid3, objectvalue3, objectid4, objectvalue4,
  objectid5, objectvalue5, objectid6, objectvalue6, objectid7, objectvalue7, source_text FROM snapshot_definition
  WHERE snapshot_id = (SELECT MAX(snapshot_id) FROM snapshot_meta WHERE completed = 1) AND definition_id % ? = ? ORDER BY definition_id`).all(every, offset) as Array<Record<string, string | number>>;
const tally = { programs: 0, refused: 0, fixedPoint: 0, reindented: 0, differs: 0 };
const reasons = new Map<string, number>();
const sampleDiffers: number[] = [], notFixed: number[] = [];
const lf = (t: string) => { const x = t.replace(/\r\n?/g, '\n'); return x.trim() === '' ? '' : x.endsWith('\n') ? x : `${x}\n`; };
for (const r of rows) {
  const source = lf(String(r.source_text));
  if (!source) continue;
  tally.programs++;
  const key = { objectIds: [1, 2, 3, 4, 5, 6, 7].map(i => Number(r[`objectid${i}`])), objectValues: [1, 2, 3, 4, 5, 6, 7].map(i => String(r[`objectvalue${i}`])) };
  const same = formatProgramSource(source, key, '8.61');
  if ('refused' in same) { tally.refused++; const k = same.refused.replace(/: .*/s, ''); reasons.set(k, (reasons.get(k) ?? 0) + 1); continue; }
  if (same.text === source) tally.fixedPoint++;
  else if (notFixed.length < 15) notFixed.push(Number(r.definition_id));
  const flat = formatProgramSource(source.split('\n').map(l => l.trimStart()).join('\n'), key, '8.61');
  if (!('refused' in flat) && flat.text === source) tally.reindented++;
  else { tally.differs++; if (sampleDiffers.length < 15) sampleDiffers.push(Number(r.definition_id)); }
}
console.log(JSON.stringify({ every, offset, ...tally, refusedReasons: Object.fromEntries(reasons), firstNotFixedDefinitionIds: notFixed, firstDifferingDefinitionIds: sampleDiffers }, null, 1));
