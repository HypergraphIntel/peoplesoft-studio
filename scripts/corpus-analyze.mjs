// Reports how well the current decoder does against the paired corpus, and
// ranks the best next calibration targets: short programs whose remaining
// unmapped opcodes are few and distinct.
import { readFileSync } from 'node:fs';
import { decodeProgram } from '../dist-test/peoplecode/decoder.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'));

function namesOf(entry) {
  const t = new NameTable();
  for (const [num, name] of entry.names) t.add(num, name);
  return t;
}

const histogram = new Map();   // opcode -> how many programs contain it unmapped
const occurrences = new Map(); // opcode -> total unmapped occurrences
const results = [];

for (const entry of corpus) {
  const bytes = Buffer.from(entry.bytes, 'base64');
  const result = decodeProgram(bytes, namesOf(entry), { mode: 'auto', isApplicationClass: entry.key.type === 58 });
  const distinct = new Set(result.unknownOpcodes.map((u) => u.opcode));
  for (const op of distinct) histogram.set(op, (histogram.get(op) ?? 0) + 1);
  for (const u of result.unknownOpcodes) {
    occurrences.set(u.opcode, (occurrences.get(u.opcode) ?? 0) + 1);
  }
  results.push({
    name: entry.key.parts.join('.'),
    type: entry.key.type,
    bytes: bytes.length,
    sourceLen: entry.source.length,
    unmapped: result.unknownOpcodes.length,
    distinct: [...distinct].sort((a, b) => a - b),
    source: entry.source
  });
}

const clean = results.filter((r) => r.unmapped === 0);
console.log(`=== ${corpus.length} programs; ${clean.length} already decode with ZERO unmapped ===`);
for (const c of clean) console.log(`  clean: ${c.name} (${c.bytes} bytes)`);

console.log('\n=== most common unmapped opcodes (programs affected / total occurrences) ===');
const ranked = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
for (const [op, progs] of ranked.slice(0, 25)) {
  console.log(`  0x${op.toString(16).padStart(2, '0')}  ${String(progs).padStart(4)} programs  ${String(occurrences.get(op)).padStart(6)} occurrences`);
}

console.log('\n=== best next targets: fewest distinct unmapped opcodes, shortest source ===');
const targets = results
  .filter((r) => r.unmapped > 0)
  .sort((a, b) => (a.distinct.length - b.distinct.length) || (a.sourceLen - b.sourceLen))
  .slice(0, 12);
for (const t of targets) {
  console.log(`\n--- ${t.name} [type ${t.type}] ${t.bytes} bytes, ${t.unmapped} unmapped, ` +
    `distinct: ${t.distinct.map((d) => '0x' + d.toString(16)).join(', ')}`);
  console.log(t.source.split('\n').slice(0, 14).map((l) => '    ' + l).join('\n'));
}
