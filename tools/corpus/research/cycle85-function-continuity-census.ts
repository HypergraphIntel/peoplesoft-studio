/*
 * Cycle 85: declaration-phase continuity across top-level Function
 * definitions -- source-shape census over ALL definitions (EXACT ones are
 * negative controls). Research only.
 *
 * For every definition, the STORED program is decoded and split into
 * top-level items at depth 0 (a `Function ... End-Function;` definition is
 * one item; its body is not inspected). Items are classified:
 *
 *   F  Function definition        L  Local           Li  initialized Local
 *   La Local of an App Class type D  Global/Component/Constant/PanelGroup/Declare
 *   I  import                     C  standalone comment (0x24/0x4E/0x55)
 *   X  executable statement
 *
 * The layout bytes (0x2D / 0x4F) stored between consecutive items are kept.
 * The census target is every definition whose leading items (before the
 * first X) contain an F followed later by a Local run. It records:
 *   - the shape (item letters up to and including the first X, or EOF)
 *   - the stored bytes at the close of that post-Function Local run
 *   - whether the generated program matches the stored bytes (forward exact)
 *
 * Usage: npx tsx tools/corpus/research/cycle85-function-continuity-census.ts --out <file.json>
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

interface Item { kind: string; layoutAfter: string }

const COMMENT_OPS = new Set([0x24, 0x4e, 0x55]);

export function topLevelItems(bytes: Buffer, names: NameTable, isApplicationClass: boolean): Item[] {
  const tokens = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass }).tokens;
  const items: Item[] = [];
  let depth = 0;
  let current: string[] | undefined;
  const finish = (kind: string) => { items.push({ kind, layoutAfter: '' }); current = undefined; };
  for (const token of tokens) {
    const text = String(token.text ?? '').trim();
    const op = token.opcode;
    if (op === 0x2d || op === 0x4f) {
      if (depth === 0 && current === undefined && items.length > 0) {
        items[items.length - 1].layoutAfter += op === 0x2d ? '2D ' : '4F ';
      }
      continue;
    }
    if (op === 0x07) break; // trailer
    if (op === 0xa0 && text === '') continue; // program header token
    if (depth === 0 && current === undefined && COMMENT_OPS.has(op)) {
      finish('C');
      continue;
    }
    if (text === 'Function' && token.nameNum === undefined) {
      if (depth === 0) current = ['Function'];
      depth++;
      continue;
    }
    if (text === 'End-Function') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        current = ['F'];
      }
      continue;
    }
    if (depth > 0) continue;
    if (current === undefined) current = [];
    if (op === 0x15) {
      const first = current[0] ?? '';
      let kind = 'X';
      if (first === 'F') kind = 'F';
      else if (first === 'Local') {
        const joined = current.join(' ');
        kind = current.includes('=') ? 'Li' : /Local \S+ :/.test(joined) ? 'La' : 'L';
      } else if (/^(Global|Component|Constant|PanelGroup|Declare Function|ComponentLife)$/.test(first)) kind = 'D';
      else if (first === 'import') kind = 'I';
      finish(kind);
      continue;
    }
    if (current.length < 8) current.push(op === 0x06 ? '=' : op === 0x57 ? ':' : text);
  }
  if (current !== undefined && current.length > 0) finish(current[0] === 'F' ? 'F' : 'X');
  return items;
}

function main(): void {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  const db = openSnapshotDatabase();
  const rows: any[] = [];
  for (const def of listSnapshotDefinitions(db) as any[]) {
    const isApplicationClass = def.objectid1 === 104;
    if (isApplicationClass) continue; // App Class bodies are fragments without a top-level Function phase
    const names = new NameTable();
    for (const r of def.names) names.add(Number(r.namenum), `${String(r.recname).trim()}.${String(r.refname).trim()}`);
    let items: Item[];
    try { items = topLevelItems(def.storedProgram, names, false); } catch { continue; }
    const firstX = items.findIndex(item => item.kind === 'X');
    const lead = firstX < 0 ? items : items.slice(0, firstX);
    const fIndex = lead.findIndex(item => item.kind === 'F');
    if (fIndex < 0) continue;
    // first Local run after the first Function, still before any executable
    let runStart = -1;
    for (let i = fIndex + 1; i < lead.length; i++) {
      if (lead[i].kind.startsWith('L')) { runStart = i; break; }
    }
    const shape = items.slice(0, firstX < 0 ? items.length : firstX + 1).map(i => i.kind).join(' ') + (firstX < 0 ? ' EOF' : '');
    let runEnd = -1;
    if (runStart >= 0) {
      // A Local run continues across interleaved standalone comments; its
      // close is measured after the LAST Local before the terminating item.
      runEnd = runStart;
      for (let i = runStart + 1; i < lead.length; i++) {
        if (lead[i].kind.startsWith('L')) runEnd = i;
        else if (lead[i].kind !== 'C') break;
      }
    }
    let forwardExact = false;
    let generatedItems: Item[] | undefined;
    try {
      const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContextOf(def) } as any);
      forwardExact = artifacts.program.equals(def.storedProgram);
      const generatedNames = new NameTable();
      for (const r of artifacts.references) generatedNames.add(r.sequence, `N${r.sequence}`);
      generatedItems = topLevelItems(artifacts.program, generatedNames, false);
    } catch { /* encode/decode error */ }
    // Every Local run (Locals, spanning interleaved comments) before the
    // first executable statement, with its stored and generated close bytes.
    const runs: any[] = [];
    for (let i = 0; i < lead.length; i++) {
      if (!lead[i].kind.startsWith('L')) continue;
      let end = i;
      for (let j = i + 1; j < lead.length; j++) {
        if (lead[j].kind.startsWith('L')) end = j;
        else if (lead[j].kind !== 'C') break;
      }
      const kinds = lead.slice(i, end + 1).map(x => x.kind).filter(k => k !== 'C');
      const sameItemsGenerated = generatedItems !== undefined &&
        generatedItems.length === items.length &&
        generatedItems.every((g, k) => g.kind === items[k].kind);
      runs.push({
        afterFunction: lead.slice(0, i).some(x => x.kind === 'F'),
        initialized: kinds.includes('Li'),
        after: lead[end + 1]?.kind ?? (firstX < 0 ? 'EOF' : 'X'),
        stored: lead[end].layoutAfter.trim() || '(none)',
        generated: sameItemsGenerated ? (generatedItems![end].layoutAfter.trim() || '(none)') : '(unaligned)'
      });
      i = end;
    }
    rows.push({
      id: def.definitionId,
      shape,
      hasLocalRunAfterFunction: runStart >= 0,
      functionsBeforeRun: runStart >= 0 ? lead.slice(0, runStart).filter(i => i.kind === 'F').length : lead.filter(i => i.kind === 'F').length,
      localsBeforeFirstFunction: lead.slice(0, fIndex).some(i => i.kind.startsWith('L')),
      runKinds: runStart >= 0 ? lead.slice(runStart, runEnd + 1).map(i => i.kind).filter(k => k !== 'C').join(',') : '',
      afterRun: runStart >= 0 ? (lead[runEnd + 1]?.kind ?? (firstX < 0 ? 'EOF' : 'X')) : '',
      storedCloseBytes: runStart >= 0 ? lead[runEnd].layoutAfter.trim() || '(none)' : '',
      betweenFunctionAndRun: runStart >= 0 ? lead.slice(fIndex + 1, runStart).map(i => i.kind).join(' ') : '',
      forwardExact,
      runs
    });
  }
  db.close();
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(rows));
  console.log(`definitions with a top-level Function before the first executable statement: ${rows.length}`);
  console.log(`  of which a Local run follows a Function (target shape): ${rows.filter(r => r.hasLocalRunAfterFunction).length}`);
}

if (require.main === module) main();
