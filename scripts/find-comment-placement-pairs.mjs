// Find naturally repeated comment text encoded both standalone and inline.
// Usage: node scripts/find-comment-placement-pairs.mjs CORPUS.jsonl OUT.json
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { decodeProgram } from '../dist-test/peoplecode/decoder.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';
const pairs = [];
for await (const line of createInterface({ input: createReadStream(process.argv[2]), crlfDelay: Infinity })) {
  const capture = JSON.parse(line), bytes = Buffer.concat(capture.programRows.map(r => Buffer.from(r.hex, 'hex')));
  const names = new NameTable();
  for (const n of capture.names) names.add(n.NAMENUM, [n.RECNAME.trim(), n.REFNAME.trim()].filter(Boolean).join('.'));
  const decoded = decodeProgram(bytes, names, { isApplicationClass: capture.key.OBJECTID1 === 104 });
  const texts = new Map();
  let cursor = 0;
  for (const token of decoded.tokens) {
    if (![0x24, 0x4e].includes(token.opcode) || !token.text.startsWith('/*')) continue;
    const at = capture.source.indexOf(token.text, cursor);
    if (at < 0) continue;
    cursor = at + token.text.length;
    const prefix = capture.source.slice(capture.source.lastIndexOf('\n', at - 1) + 1, at);
    const occurrences = texts.get(token.text) ?? {};
    occurrences[token.opcode] ??= { sourceOffset: at, offset: token.offset, opcode: token.opcode, prefix };
    texts.set(token.text, occurrences);
  }
  for (const [text, occurrences] of texts) if (occurrences[0x24] && occurrences[0x4e]) pairs.push({ capture, text, occurrences });
}
pairs.sort((a, b) => a.capture.source.length - b.capture.source.length);
writeFileSync(process.argv[3], JSON.stringify({ totalPairs: pairs.length, pairs: pairs.slice(0,12) }, null, 2));
console.log(`${pairs.length} same-program, same-text comment pairs have both opcodes`);
