/*
 * Cycle 89: blank-line gaps INSIDE an import section (research only).
 *
 * For every definition, pair the top-level import statements of the stored
 * and the generated program (same order), and for every consecutive
 * import -> import pair record:
 *   - the stored and generated layout/comment tokens between them
 *   - the source's blank-line count between the two import lines
 *   - whether a comment (block / REM) sits in the gap
 *   - program attributes that may gate markers: Application Class
 *     (OBJECTID1 = 104), whether the program has compiled PSPCMNAME
 *     references beyond the owner row.
 *
 * Usage: npx tsx tools/corpus/research/cycle89-import-gap-census.ts [--json out.json]
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

function ownerContextOf(def: any) {
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

/** Gaps (as token labels) after each top-level import statement that is followed by another import. */
function importGaps(bytes: Buffer, names: NameTable, isApplicationClass: boolean): string[] {
  const tokens = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass }).tokens;
  const gaps: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (String(tokens[i].text ?? '').trim() !== 'import') continue;
    let j = i;
    while (j < tokens.length && tokens[j].opcode !== 0x15) j++;
    const gap: string[] = [];
    let k = j + 1;
    for (; k < tokens.length; k++) {
      const op = tokens[k].opcode;
      if (op === 0x2d) gap.push('2D');
      else if (op === 0x4f) gap.push('4F');
      else if (op === 0x24 || op === 0x4e || op === 0x55) {
        const text = String(tokens[k].text ?? '').trim().toLowerCase();
        gap.push(op === 0x55 ? 'DIS' : text.startsWith('rem') ? 'REM' : 'BLOCK');
      } else break;
    }
    if (k < tokens.length && String(tokens[k].text ?? '').trim() === 'import') gaps.push(gap.join(' '));
  }
  return gaps;
}

/** Blank-line counts between consecutive top-level import lines in the source. */
function sourceImportGaps(source: string): number[] {
  const lines = source.split(/\r?\n/);
  const out: number[] = [];
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^import\b/i.test(line)) {
      if (lastImport >= 0) {
        const between = lines.slice(lastImport + 1, i);
        if (between.every(l => l.trim() === '' || /^(rem\b|\/\*|\*)/i.test(l.trim()))) {
          out.push(between.filter(l => l.trim() === '').length);
        } else {
          out.push(-1);
        }
      }
      lastImport = i;
    } else if (line !== '' && lastImport >= 0 && !/^(rem\b|\/\*|\*)/i.test(line)) {
      lastImport = -1;
    }
  }
  return out;
}

function main(): void {
  const jsonIndex = process.argv.indexOf('--json');
  const tally = new Map<string, number[]>();
  const rows: any[] = [];
  for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
    if (!/^\s*import\b/im.test(def.sourceText)) continue;
    const isApplicationClass = def.objectid1 === 104;
    const storedNames = new NameTable();
    for (const r of def.names) storedNames.add(Number(r.namenum), 'x');
    let stored: string[];
    let generated: string[];
    let hasCompiledReferences = false;
    try {
      stored = importGaps(def.storedProgram, storedNames, isApplicationClass);
      const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContextOf(def) } as any);
      const generatedNames = new NameTable();
      for (const r of artifacts.references) generatedNames.add(r.sequence, 'x');
      generated = importGaps(artifacts.program, generatedNames, isApplicationClass);
      hasCompiledReferences = artifacts.references.length > 1 ||
        artifacts.references[0]?.recordName !== undefined || artifacts.references[0]?.fieldName !== undefined;
    } catch { continue; }
    const sourceGaps = sourceImportGaps(def.sourceText);
    for (let i = 0; i < stored.length; i++) {
      const s = stored[i];
      const g = generated[i] ?? '(unaligned)';
      const blank = sourceGaps[i] ?? -2;
      const key = `appClass=${isApplicationClass} refs=${hasCompiledReferences} blankLines=${blank} stored=[${s}] generated=[${g}] ${s === g ? 'match' : 'MISMATCH'}`;
      (tally.get(key) ?? tally.set(key, []).get(key)!).push(def.definitionId);
      rows.push({ id: def.definitionId, isApplicationClass, hasCompiledReferences, blank, stored: s, generated: g });
    }
  }
  for (const [key, ids] of [...tally].sort((a, b) => b[1].length - a[1].length)) {
    console.log(String(ids.length).padStart(5), key, [...new Set(ids)].slice(0, 6).join(','));
  }
  if (jsonIndex >= 0) fs.writeFileSync(process.argv[jsonIndex + 1], JSON.stringify(rows));
}

main();
