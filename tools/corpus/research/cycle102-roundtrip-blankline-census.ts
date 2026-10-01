/*
 * Cycle 102: the last ROUNDTRIP_ONLY definitions -- who owns the line ending
 * before a 0x2D boundary (research only).
 *
 * After Cycle 101 the 10 remaining ROUNDTRIP_ONLY definitions all re-encode
 * with exactly ONE extra 0x4F right after a stored `2d 4f`: the decoder
 * rendered one blank line too many. A 0x2D (NEWLINE_ONCE) always emits a
 * line ending unless something already rendered owns it; three shapes are
 * censused here, each corpus-wide, comparing the stored marker run with the
 * same site's marker run after decode -> re-encode:
 *
 *   A. every statement opened by ComponentLife (0x79) -- the ';' marker run
 *      after it, and whether a 0x4E comment sits right before its ';';
 *   B. every `15 2d` boundary whose closed statement contains a 0x4E
 *      comment: the statement's opening keyword, and whether the comment is
 *      immediately before the ';' (`before;`) or earlier (`mid` -- in
 *      practice the previous statement's trailing comment);
 *   C. every 0x4E comment followed by zero-width 0x41 / 0x42 markers and
 *      then a 0x2D: which header the comment ends.
 *
 * Each line: count, site key, roundtrip key, same / DIFF, whether the whole
 * definition roundtrips, example ids.
 *
 * Usage: npx tsx tools/corpus/research/cycle102-roundtrip-blankline-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgram } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

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

const HEADERS = new Map([[0x25, 'While'], [0x29, 'For'], [0x3c, 'Evaluate'], [0x3d, 'When'], [0x1d, 'If'], [0x32, 'Function'], [0x66, 'catch']]);
const hex = (t: any) => t.opcode.toString(16);
const markerRun = (tokens: any[], from: number) => {
  const run: string[] = [];
  for (let k = from; tokens[k]?.opcode === 0x2d || tokens[k]?.opcode === 0x4f; k++) run.push(hex(tokens[k]));
  return run.join(' ') || '-';
};

/* A: ComponentLife statements. */
function componentLifeSites(tokens: any[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].opcode !== 0x79) continue;
    let j = i + 1;
    while (j < tokens.length && tokens[j].opcode !== 0x15) j++;
    out.push(`ComponentLife ${tokens[j - 1]?.opcode === 0x4e ? 'cmt;' : ';'} ${markerRun(tokens, j + 1)}`);
  }
  return out;
}

/* B: `15 2d` boundaries closing a statement that contains a 0x4E comment. */
function commentedBoundarySites(tokens: any[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].opcode !== 0x2d || tokens[i - 1].opcode !== 0x15) continue;
    let h = i - 2;
    let position = '';
    while (h >= 0 && tokens[h].opcode !== 0x15 && tokens[h].opcode !== 0x24 && tokens[h].kind !== 'header') {
      if (tokens[h].opcode === 0x4e) position = position || (h === i - 2 ? 'before;' : 'mid');
      h--;
    }
    if (!position) continue;
    let opener = h + 1;
    while (tokens[opener] && [0x2d, 0x4f, 0x4e].includes(tokens[opener].opcode)) opener++;
    out.push(`${String(tokens[opener]?.text ?? hex(tokens[opener])).slice(0, 16)} 4e:${position} ; ${markerRun(tokens, i)}`);
  }
  return out;
}

/* C: 0x4E, zero-width 0x41 / 0x42 markers, 0x2D. */
function commentZeroWidthBoundarySites(tokens: any[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].opcode !== 0x4e) continue;
    let j = i + 1;
    while (tokens[j]?.opcode === 0x41 || tokens[j]?.opcode === 0x42) j++;
    if (j === i + 1 || tokens[j]?.opcode !== 0x2d) continue;
    let h = i - 1;
    while (h >= 0 && !HEADERS.has(tokens[h].opcode) && tokens[h].opcode !== 0x15) h--;
    const header = h >= 0 && HEADERS.has(tokens[h].opcode) ? HEADERS.get(tokens[h].opcode) : 'statement';
    out.push(`${header} 4e ${tokens.slice(i + 1, j).map(hex).join(' ')} ${markerRun(tokens, j)}`);
  }
  return out;
}

const censuses = { A: componentLifeSites, B: commentedBoundarySites, C: commentZeroWidthBoundarySites };
const tallies = { A: new Map<string, number[]>(), B: new Map<string, number[]>(), C: new Map<string, number[]>() };

for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  const names = new NameTable();
  for (const r of def.names) names.add(Number(r.namenum), `${String(r.recname ?? '').trim()}.${String(r.refname ?? '').trim()}`);
  const options = { mode: 'auto', isApplicationClass: def.objectid1 === 104 } as const;
  let decoded: any;
  try { decoded = decodeProgram(def.storedProgram, names, options); } catch { continue; }
  const stored = Object.fromEntries(Object.entries(censuses).map(([k, f]) => [k, f(decoded.tokens)]));
  if (Object.values(stored).every(sites => sites.length === 0)) continue;
  let roundtripTokens: any[] = [];
  let roundtripExact = false;
  try {
    const commentOpcodes = decoded.tokens.map((t: any) => t.opcode).filter((o: number) => o === 0x24 || o === 0x4e);
    const bytes = encodeProgram(decoded.text, { owner: context(def), commentOpcodes } as any);
    roundtripExact = bytes.equals(def.storedProgram);
    roundtripTokens = decodeProgram(bytes, names, options).tokens;
  } catch { /* roundtrip unavailable: every site reports '?' */ }
  for (const [k, f] of Object.entries(censuses) as [keyof typeof censuses, (t: any[]) => string[]][]) {
    const roundtrip = f(roundtripTokens);
    stored[k].forEach((site, i) => {
      const key = `${site.padEnd(36)} rt=${(roundtrip[i] ?? '?').padEnd(36)} ${roundtrip[i] === site ? 'same' : 'DIFF'} def=${roundtripExact ? 'roundtrip' : 'fail'}`;
      const list = tallies[k].get(key) ?? [];
      list.push(def.definitionId);
      tallies[k].set(key, list);
    });
  }
}

for (const [k, tally] of Object.entries(tallies)) {
  console.log(`\n== ${k}`);
  for (const [key, ids] of [...tally].sort((a, b) => b[1].length - a[1].length)) {
    console.log(String(ids.length).padStart(6), key, [...new Set(ids)].slice(0, 10).join(','));
  }
}
