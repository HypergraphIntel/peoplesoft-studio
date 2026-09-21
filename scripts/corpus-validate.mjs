// Correctness metric, not just coverage: every text-bearing token the decoder
// produces is checked against the program's known source. Coverage can be
// raised by consuming bytes greedily; this catches that, because greedily
// consumed text stops matching the real source.
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeProgram, TokenKind } from '../dist-test/peoplecode/decoder.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  .map((e) => ({ ...e, buf: Buffer.from(e.bytes, 'base64') }));

function namesOf(e) {
  const t = new NameTable();
  for (const [num, name] of e.names) t.add(num, name);
  return t;
}

const TEXTY = new Set([TokenKind.Name, TokenKind.StringLiteral, TokenKind.Comment, TokenKind.Keyword]);

let totalBytes = 0, totalUnmapped = 0, clean = 0;
let textTokens = 0, textFound = 0;
const misses = [];

for (const e of corpus) {
  const result = decodeProgram(e.buf, namesOf(e), { mode: 'auto', isApplicationClass: e.key.type === 58 });
  totalBytes += e.buf.length;
  totalUnmapped += result.unknownOpcodes.length;
  if (result.unknownOpcodes.length === 0) clean++;

  // Normalise whitespace so multi-line comment text compares fairly.
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
  const src = norm(e.source);
  // PeopleCode escapes a literal `"` inside a string literal by doubling it
  // (`""`), same as SQL -- the decoder correctly renders that as one real
  // `"`, so a string literal containing an embedded quote will never
  // literally appear in the source text. Unescape source the same way
  // before falling back, string literals only (comments/keywords have no
  // such escaping convention).
  const srcUnescaped = norm(e.source.replace(/""/g, '"'));
  for (const t of result.tokens) {
    if (!TEXTY.has(t.kind)) continue;
    const raw = t.text.replace(/^"|"$/g, '').replace(/^\/\+ | \+\/$/g, '');
    if (raw.trim().length < 2) continue;
    textTokens++;
    if (src.includes(norm(raw))) textFound++;
    else if (t.kind === TokenKind.StringLiteral && srcUnescaped.includes(norm(raw))) textFound++;
    else misses.push({ program: e.key.parts.join('.'), kind: t.kind, opcode: t.opcode, offset: t.offset, text: raw });
  }
}

const cov = ((1 - totalUnmapped / totalBytes) * 100).toFixed(2);
const acc = textTokens ? ((textFound / textTokens) * 100).toFixed(2) : 'n/a';
console.log(`coverage:      ${totalBytes - totalUnmapped}/${totalBytes} bytes (${cov}%)`);
console.log(`clean programs: ${clean}/${corpus.length}`);
console.log(`text accuracy:  ${textFound}/${textTokens} decoded text tokens found in real source (${acc}%)`);

// A mismatch is a byte we decode *wrongly*, which coverage cannot see, so the
// shape of the tail matters more than a dozen examples: one opcode dominating
// is a systematic bug, a flat spread across programs is a long tail.
const tally = (key) => {
  const m = new Map();
  for (const x of misses) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};
const hex = (n) => `0x${n.toString(16).padStart(2, '0')}`;

if (misses.length) {
  console.log(`\n  text NOT found in source (possible over-consumption): ${misses.length} tokens`);

  console.log('\n  by opcode:');
  for (const [op, n] of tally((x) => `${hex(x.opcode)} ${x.kind}`)) {
    const eg = misses.find((x) => `${hex(x.opcode)} ${x.kind}` === op);
    console.log(`    ${op.padEnd(14)} ${String(n).padStart(5)}  e.g. ${JSON.stringify(eg.text.slice(0, 40))}`);
  }

  const byProgram = tally((x) => x.program);
  console.log(`\n  by program (${byProgram.length} of ${corpus.length} affected, top 15):`);
  for (const [p, n] of byProgram.slice(0, 15)) console.log(`    ${String(n).padStart(5)}  ${p}`);

  console.log('\n  most repeated texts:');
  for (const [t, n] of tally((x) => `${x.kind} ${JSON.stringify(x.text.slice(0, 40))}`).slice(0, 15)) {
    console.log(`    ${String(n).padStart(5)}  ${t}`);
  }
}

// Full per-token detail is far too long to read in a terminal but is exactly
// what a decoder investigation needs, so it goes to a file on request.
if (process.argv[3]) {
  writeFileSync(process.argv[3], JSON.stringify(misses, null, 1));
  console.log(`\n  ${misses.length} mismatches written to ${process.argv[3]}`);
}
