/*
 * Cycle 111: which source events open an Application Class PACKAGE row in
 * ORDINARY programs -- Function headers, typed `catch` clauses, `As` casts
 * (research only).
 *
 * Events (qualified class types, as the Cycle 94 allocator sees them):
 *
 *   header  a Function parameter `&p As P:C` or `Returns P:C`; tagged by
 *           what precedes the Function: `leading` (only imports /
 *           declarations), `after-function` (an End-Function), `after-code`
 *           (a top-level executable statement)
 *   catch   `catch P:C &e`
 *   cast    `(&x As P:C)` inside an expression
 *
 * Programs are encoded as the harness encodes them (snapshot type metadata;
 * the Cycle 93 fallback programs, encoded without allocation units, are
 * skipped). Truth is positional (Cycle 94 method): stored and generated
 * rows are aligned on every row that is not PACKAGE.<C>; the event falls in
 * one gap, and the stored / generated PACKAGE.<C> rows in that gap say
 * whether each side opened a row there. A gap is `clean` when it holds no
 * other event or source occurrence of the class.
 *
 * `prevUnitUse`: the class occurs in the source between the previous
 * Function's body start (or the previous top-level statement) and the
 * event -- i.e. the committed allocator would find the class in the
 * header's current unit.
 *
 * Usage: npx tsx tools/corpus/research/cycle111-class-row-event-census.ts <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const clean = (s: string) => {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return s.replace(/<\*[\s\S]*?\*>/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/"(?:[^"]|"")*"/g, m => '"' + blank(m.slice(1, -1)) + '"')
    .replace(/(^|;)(\s*)rem\b[^;]*;/gim, (m, a, b) => a + b + blank(m.slice(a.length + b.length)));
};

function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const table: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) table.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const key = (g: any): string => {
  const up = (v: unknown) => String(v ?? '').toUpperCase();
  switch (g.kind) {
    case 'package': return `PACKAGE.${up(g.packageName)}`;
    case 'scroll': return `SCROLL.${up(g.recordName)}`;
    case 'record': return `RECORD.${up(g.recordName)}`;
    case 'field': return `FIELD.${up(g.fieldName)}`;
    case 'component': return `COMPONENT.${up(g.objectName)}`;
    default: return `${up(g.recordName)}.${up(g.fieldName)}`;
  }
};

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const out = fs.openSync(process.argv[2], 'w');
let events = 0;
for (const def of listSnapshotDefinitions(db) as any[]) {
  if (def.objectid1 === 104) continue;
  const source = String(def.sourceText ?? '');
  if (!/\b(?:As|catch)\s+[A-Za-z_]\w*\s*:/i.test(source)) continue;
  const text = clean(source);
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const ri = ids.findIndex((x: number) => x === 1), fi = ids.findIndex((x: number) => x === 2);
  const owner = { recordName: ri >= 0 ? values[ri] : values[0], fieldName: fi >= 0 ? values[fi] : values[1] };

  /* ---- events ---- */
  interface Event { kind: string; role?: string; context?: string; at: number; leaf: string; path: string }
  const found: Event[] = [];
  const headers: { start: number; open: number; close: number; bodyStart: number }[] = [];
  for (const m of text.matchAll(/\bFunction\s+\w+\s*\(/gi)) {
    if (/declare\s+$/i.test(text.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    const open = m.index! + m[0].length - 1;
    let depth = 0, close = open;
    for (; close < text.length; close++) { if (text[close] === '(') depth++; else if (text[close] === ')' && --depth === 0) break; }
    const rest = /^\s*(Returns\s+[\w:]+)?/i.exec(text.slice(close + 1))!;
    headers.push({ start: m.index!, open, close, bodyStart: close + 1 + rest[0].length });
  }
  const precedingContext = (fnStart: number): string => {
    const before = text.slice(0, fnStart).replace(/\s+$/, '');
    if (/End-Function\s*;?$/i.test(before)) return 'after-function';
    const statements = before.split(';').map(s => s.trim()).filter(Boolean);
    const executable = statements.some(s => !/^(import|Component|Global|Declare|Constant|PanelGroup|ComponentLife|Local)\b/i.test(s) || (/^Local\b/i.test(s) && /=/.test(s)));
    return executable ? 'after-code' : 'leading';
  };
  for (const h of headers) {
    const context = precedingContext(h.start);
    for (const m of text.slice(h.open, h.bodyStart).matchAll(/\b(As|Returns)\s+([A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)+)/gi)) {
      const path = m[2].replace(/\s+/g, '');
      found.push({ kind: 'header', role: /^returns$/i.test(m[1]) ? 'returns' : 'param', context, at: h.open + m.index! + m[0].length - 1, leaf: path.split(':').pop()!.toUpperCase(), path });
    }
  }
  for (const m of text.matchAll(/\bcatch\s+([A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)+)\s+&/gi)) {
    const path = m[1].replace(/\s+/g, '');
    found.push({ kind: 'catch', at: m.index! + m[0].length - 1, leaf: path.split(':').pop()!.toUpperCase(), path });
  }
  for (const m of text.matchAll(/(?:\)|&\w+)\s*As\s+([A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)+)/gi)) {
    if (headers.some(h => m.index! > h.open && m.index! < h.close)) continue;
    if (/Declare\s+Function[^;]*$/i.test(text.slice(Math.max(0, m.index! - 300), m.index!))) continue;
    const path = m[1].replace(/\s+/g, '');
    // what the cast value is used for: a method call on it, a property of it, or assignment / argument
    const after = /^\s*\)\s*\.\s*(\w+)\s*(\()?/.exec(text.slice(m.index! + m[0].length));
    const role = after ? (after[2] ? 'method-call' : 'property') : 'value';
    found.push({ kind: 'cast', role, at: m.index! + m[0].length - 1, leaf: path.split(':').pop()!.toUpperCase(), path });
  }
  if (found.length === 0) continue;

  /* ---- generated (harness context) ---- */
  const generated: { k: string; at: number }[] = [];
  let fallback = false;
  try {
    encodeProgramArtifacts(source, {
      owner, applicationClassTypeMetadata: provider,
      onExternalMetadataFallback: () => { fallback = true; },
      referenceTrace: (e: any) => { if (e.action === 'ALLOC' && e.reference.kind !== 'owner') generated.push({ k: key(e.reference), at: e.sourceOffset }); }
    } as any);
  } catch { continue; }
  if (fallback) continue;
  const stored = [...def.names].sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum)).slice(1)
    .map((r: any) => `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`);

  for (const e of found) {
    const k = `PACKAGE.${e.leaf}`;
    const sIdx = stored.map((_, i) => i).filter(i => stored[i] !== k);
    const gIdx = generated.map((_, i) => i).filter(i => generated[i].k !== k);
    const pairs = lcs(sIdx.map(i => stored[i]), gIdx.map(i => generated[i].k));
    let prev: [number, number] | undefined, next: [number, number] | undefined;
    for (const pair of pairs) { if (generated[gIdx[pair[1]]].at < e.at) prev = pair; else { next = pair; break; } }
    const sFrom = prev ? sIdx[prev[0]] + 1 : 0, sTo = next ? sIdx[next[0]] : stored.length;
    const gFrom = prev ? gIdx[prev[1]] + 1 : 0, gTo = next ? gIdx[next[1]] : generated.length;
    const fromAt = prev ? generated[gIdx[prev[1]]].at : -1;
    const toAt = next ? generated[gIdx[next[1]]].at : text.length;
    const occurrences = [...text.matchAll(new RegExp(`(?<![\\w&])${e.leaf}(?!\\w)`, 'gi'))].map(m => m.index!);
    const otherInGap = occurrences.filter(o => o > fromAt && o < toAt && Math.abs(o - (e.at - e.leaf.length)) > 2).length;
    // previous unit for a header: the source between the previous Function body start / top-level statement and the header
    let prevUnitUse: boolean | undefined;
    if (e.kind === 'header') {
      const h = headers.find(x => e.at > x.open && e.at <= x.bodyStart)!;
      const before = text.slice(0, h.start);
      const prevBody = headers.filter(x => x.bodyStart <= h.start).slice(-1)[0];
      const lastStatement = before.replace(/End-Function\s*;?\s*$/i, '').replace(/\s+$/, '');
      const lastStart = Math.max(lastStatement.lastIndexOf(';', lastStatement.length - 2), prevBody?.bodyStart ?? -1);
      const unitText = e.context === 'leading' ? before : text.slice(lastStart + 1, h.start);
      prevUnitUse = new RegExp(`(?<![\\w&])${e.leaf}(?!\\w)`, 'i').test(unitText);
    }
    // the committed allocator's own event: a row of the class allocated at the type token itself
    const allocatedAtEvent = generated.some(g => g.k === k && g.at >= e.at - e.path.length - 2 && g.at <= e.at + 2);
    fs.writeSync(out, JSON.stringify({
      id: def.definitionId, kind: e.kind, role: e.role, context: e.context, path: e.path, at: e.at, allocatedAtEvent,
      storedInGap: stored.slice(sFrom, sTo).filter(x => x === k).length,
      generatedInGap: generated.slice(gFrom, gTo).filter(x => x.k === k).length,
      storedBefore: stored.slice(0, sFrom).filter(x => x === k).length,
      clean: otherInGap === 0 && stored.slice(sFrom, sTo).every(x => x === k) && generated.slice(gFrom, gTo).every(x => x.k === k),
      prevUnitUse
    }) + '\n');
    events++;
  }
}
fs.closeSync(out);
console.log(`${events} events`);
