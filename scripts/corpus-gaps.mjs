// Measures overall decoder coverage across the corpus, then hunts the next
// introducer by looking ONLY at text runs the decoder currently fails to
// consume -- i.e. runs sitting inside still-unmapped byte regions -- and
// histogramming the byte immediately before each, validated against the
// program's known source.
import { readFileSync } from 'node:fs';
import { decodeProgram } from '../dist-test/peoplecode/decoder.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  .map((e) => ({ ...e, buf: Buffer.from(e.bytes, 'base64') }));

function namesOf(e) {
  const t = new NameTable();
  for (const [num, name] of e.names) t.add(num, name);
  return t;
}

function readRun(buf, start) {
  const chars = [];
  let i = start;
  while (i + 1 < buf.length) {
    const lo = buf[i], hi = buf[i + 1];
    if (lo === 0x00 && hi === 0x00) {
      return chars.length > 0 ? { text: chars.join(''), end: i + 2 } : undefined;
    }
    if (hi !== 0x00 || !((lo >= 0x20 && lo <= 0x7e) || lo === 0x09 || lo === 0x0a || lo === 0x0d)) return undefined;
    chars.push(String.fromCharCode(lo));
    i += 2;
  }
  return undefined;
}

let totalBytes = 0, totalUnmapped = 0, clean = 0;
const byPrev = new Map();

for (const e of corpus) {
  const result = decodeProgram(e.buf, namesOf(e));
  totalBytes += e.buf.length;
  totalUnmapped += result.unknownOpcodes.length;
  if (result.unknownOpcodes.length === 0) clean++;

  const unmapped = new Set(result.unknownOpcodes.map((u) => u.offset));
  const upper = e.source.toUpperCase();

  // Every byte of an unconsumed run is reported unmapped, so a run appears
  // once per character, shifted. All those shifted copies share an END
  // offset, so keep only the longest (earliest-starting) run per end.
  const longestByEnd = new Map();
  for (const off of unmapped) {
    const run = readRun(e.buf, off);
    if (!run || run.text.length < 2) continue;
    const prior = longestByEnd.get(run.end);
    if (prior === undefined || off < prior.start) longestByEnd.set(run.end, { start: off, run });
  }

  for (const { start: off, run } of longestByEnd.values()) {
    const prev = e.buf[off - 1];
    const rec = byPrev.get(prev) ?? { hits: 0, misses: 0, samples: new Set(), missSamples: new Set() };
    if (upper.includes(run.text.toUpperCase())) {
      rec.hits++;
      if (rec.samples.size < 5) rec.samples.add(run.text.slice(0, 30));
    } else {
      rec.misses++;
      if (rec.missSamples.size < 3) rec.missSamples.add(run.text.slice(0, 30));
    }
    byPrev.set(prev, rec);
  }
}

const pct = ((1 - totalUnmapped / totalBytes) * 100).toFixed(2);
console.log(`=== coverage: ${totalBytes - totalUnmapped}/${totalBytes} bytes consumed (${pct}%) ===`);
console.log(`=== programs decoding with zero unmapped: ${clean}/${corpus.length} ===`);

console.log('\n=== bytes preceding text runs the decoder STILL misses ===');
const ranked = [...byPrev.entries()]
  .filter(([, r]) => r.hits + r.misses >= 10)
  .sort((a, b) => b[1].hits - a[1].hits);
for (const [prev, r] of ranked.slice(0, 16)) {
  const total = r.hits + r.misses;
  console.log(`\n  prev=0x${prev.toString(16).padStart(2, '0')}  ${r.hits}/${total} (${((r.hits / total) * 100).toFixed(1)}%)`);
  console.log(`      hits: ${[...r.samples].join(' | ')}`);
  if (r.missSamples.size) console.log(`      MISS: ${[...r.missSamples].join(' | ')}`);
}
