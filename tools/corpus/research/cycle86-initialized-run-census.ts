/*
 * Cycle 86: initialized-Local run census (research only).
 *
 * For every non-App-Class program, find the first Local run before any
 * executable statement in which a plain (uninitialized) Local precedes the
 * first initialized Local. Report, for that position, the stored layout
 * bytes after the last plain Local and the generated ones, split by
 * context:
 *
 *   start   the run is the first item (only comments before it)
 *   afterF  the run follows a top-level Function definition
 *
 * Built on the Cycle 85 item splitter (`topLevelItems`).
 *
 * Usage: npx tsx tools/corpus/research/cycle86-initialized-run-census.ts <start|afterF>
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { NameTable } from '../../../src/peoplecode/progtext';
import { topLevelItems } from './cycle85-function-continuity-census';

function main(): void {
  const context = process.argv[2] ?? 'start';
  const tally = new Map<string, number[]>();
  for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
    if (def.objectid1 === 104) continue;
    const storedNames = new NameTable();
    for (const r of def.names) storedNames.add(Number(r.namenum), 'x');
    let items: any[];
    try { items = topLevelItems(def.storedProgram, storedNames, false); } catch { continue; }
    const firstX = items.findIndex(i => i.kind === 'X');
    const lead = firstX < 0 ? items : items.slice(0, firstX);
    const start = lead.findIndex(i => i.kind.startsWith('L'));
    if (start < 0) continue;
    const prefix = lead.slice(0, start).map(i => i.kind);
    if (context === 'start' && prefix.some(k => k !== 'C')) continue;
    if (context === 'afterF' && !prefix.includes('F')) continue;
    const run: any[] = [];
    for (let i = start; i < lead.length && (lead[i].kind.startsWith('L') || lead[i].kind === 'C'); i++) run.push(lead[i]);
    const locals = run.filter(i => i.kind !== 'C');
    const kinds = locals.map(i => i.kind);
    const firstLi = kinds.indexOf('Li');
    if (firstLi <= 0) continue; // need a plain Local before the first initialized one
    const lastPlainBefore = locals[firstLi - 1];
    let generated = '(encode error)';
    try {
      const artifacts = encodeProgramArtifacts(def.sourceText, {
        owner: { recordName: def.objectvalue1.trim(), fieldName: def.objectvalue2.trim() }
      } as any);
      const generatedNames = new NameTable();
      for (const r of artifacts.references) generatedNames.add(r.sequence, 'x');
      const generatedItems = topLevelItems(artifacts.program, generatedNames, false);
      generated = generatedItems.length === items.length
        ? (generatedItems[items.indexOf(lastPlainBefore)].layoutAfter.trim() || '(none)')
        : '(unaligned)';
    } catch { /* keep marker */ }
    const key = `stored=${lastPlainBefore.layoutAfter.trim() || '(none)'} generated=${generated} ` +
      `laterPlainLocal=${kinds.slice(firstLi + 1).includes('L')}`;
    (tally.get(key) ?? tally.set(key, []).get(key)!).push(def.definitionId);
  }
  for (const [key, ids] of [...tally].sort((a, b) => b[1].length - a[1].length)) {
    console.log(ids.length, key, ids.slice(0, 8).join(','));
  }
}

main();
