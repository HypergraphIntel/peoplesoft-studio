// Correctness metric, not just coverage: every text-bearing token the decoder
// produces is checked against the program's known source. Coverage can be
// raised by consuming bytes greedily; this catches that, because greedily
// consumed text stops matching the real source.
import { readFileSync } from 'node:fs';
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
const badSamples = new Map();

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
    else if (badSamples.size < 12) {
      badSamples.set(`${e.key.parts.join('.')}: ${JSON.stringify(raw.slice(0, 60))}`, t.kind);
    }
  }
}

const cov = ((1 - totalUnmapped / totalBytes) * 100).toFixed(2);
const acc = textTokens ? ((textFound / textTokens) * 100).toFixed(2) : 'n/a';
console.log(`coverage:      ${totalBytes - totalUnmapped}/${totalBytes} bytes (${cov}%)`);
console.log(`clean programs: ${clean}/${corpus.length}`);
console.log(`text accuracy:  ${textFound}/${textTokens} decoded text tokens found in real source (${acc}%)`);
if (badSamples.size) {
  console.log('\n  text NOT found in source (possible over-consumption):');
  for (const [s, kind] of badSamples) console.log(`    [${kind}] ${s}`);
}
