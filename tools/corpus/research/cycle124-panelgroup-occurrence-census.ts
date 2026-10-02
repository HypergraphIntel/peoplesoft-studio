/*
 * Cycle 124: every stored opcode 0x51 occurrence (research only).
 *
 * Per occurrence: definition, program kind, token offset, the previous and
 * next decoded tokens, and the source's PanelGroup declarations (in order;
 * the n-th 0x51 is paired with the n-th declaration). Per program: the
 * occurrence count against the source declaration count, harness category
 * (`--taxonomy`) and the harness roundtrip (decode stored -> encode the
 * decoded text -> compare bytes).
 *
 * Usage: npx tsx tools/corpus/research/cycle124-panelgroup-occurrence-census.ts [--taxonomy t.json] [out.jsonl]
 */
import fs from 'node:fs';

import { openHarnessContext, storedNameTable, decodeAsHarness, isApplicationClass, roundtripAsHarness } from './lib/harnessContext';

const args = process.argv.slice(2);
let taxonomyPath: string | undefined;
if (args[0] === '--taxonomy') { taxonomyPath = args[1]; args.splice(0, 2); }
const taxonomy = new Map<number, string>(taxonomyPath ? JSON.parse(fs.readFileSync(taxonomyPath, 'utf8')).rows.map((r: any) => [r.definitionId, r.primaryCategory]) : []);
const out = args[0] ? fs.openSync(args[0], 'w') : undefined;

const ctx = openHarnessContext();
const label = (t: any) => (t === undefined ? '<none>' : `${t.opcode.toString(16).padStart(2, '0')}:${String(t.text ?? '')}`);
let occurrences = 0, programs = 0, matched = 0, app = 0;
const types = new Map<string, number>();
const byCategory = new Map<string, number>();
const roundtrip = { exact: 0, inexact: [] as number[] };
const mismatched: number[] = [];
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  const indexes = tokens.map((t, i) => (t.opcode === 0x51 ? i : -1)).filter(i => i >= 0);
  if (indexes.length === 0) continue;
  programs++;
  if (isApplicationClass(def)) app++;
  const declarations = [...String(def.sourceText).matchAll(/^[ \t]*PanelGroup\s+([A-Za-z_][\w:]*)[^\n;]*/gim)].map(m => ({ type: m[1], text: m[0].trim() }));
  if (declarations.length === indexes.length) matched++; else mismatched.push(def.definitionId);
  const category = taxonomy.get(def.definitionId) ?? 'EXACT';
  byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  const rt = roundtripAsHarness(ctx, def);
  if (rt.exact) roundtrip.exact++; else roundtrip.inexact.push(def.definitionId);
  indexes.forEach((index, n) => {
    occurrences++;
    const type = declarations[n]?.type ?? '?';
    types.set(type.toLowerCase(), (types.get(type.toLowerCase()) ?? 0) + 1);
    if (out !== undefined) fs.writeSync(out, JSON.stringify({
      id: def.definitionId, app: isApplicationClass(def), category, offset: tokens[index].offset,
      previous: label(tokens[index - 1]), next: label(tokens[index + 1]), following: label(tokens[index + 2]),
      declaration: declarations[n]?.text ?? '?', roundtripExact: rt.exact
    }) + '\n');
  });
}
if (out !== undefined) fs.closeSync(out);
console.log(`0x51 occurrences ${occurrences} in ${programs} definitions (App Class ${app}); occurrence count = source PanelGroup declarations in ${matched}${mismatched.length ? `; mismatched: ${mismatched.join(' ')}` : ''}`);
console.log(`declared types: ${[...types].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`categories: ${[...byCategory].map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`roundtrip exact ${roundtrip.exact}; not exact ${roundtrip.inexact.length}: ${roundtrip.inexact.slice(0, 40).join(' ')}`);
