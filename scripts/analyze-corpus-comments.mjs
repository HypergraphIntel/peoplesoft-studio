// Offline comment inventory; samples retain exact keys and byte offsets.
// Usage: node scripts/analyze-corpus-comments.mjs CORPUS.jsonl OUT.json
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { decodeProgram } from '../dist-test/peoplecode/decoder.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';
const result = { programs: 0, comments: 0, groups: {}, payloadMismatches: [], sourceMismatches: [], sourceMismatchCount: 0, placement: {}, inlineHypothesis: { match: 0, mismatch: 0, examples: [] } };
for await (const line of createInterface({ input: createReadStream(process.argv[2]), crlfDelay: Infinity })) {
  const c = JSON.parse(line), b = Buffer.concat(c.programRows.map(r => Buffer.from(r.hex, 'hex')));
  const names = new NameTable();
  for (const n of c.names) names.add(n.NAMENUM, [n.RECNAME.trim(), n.REFNAME.trim()].filter(Boolean).join('.'));
  const decoded = decodeProgram(b, names, { isApplicationClass: c.key.OBJECTID1 === 104 });
  result.programs++;
  let sourceCursor = 0;
  for (let i = 0; i < decoded.tokens.length; i++) {
    const t = decoded.tokens[i];
    if (![0x24, 0x4e, 0x55].includes(t.opcode)) continue;
    result.comments++;
    const sourceAt = c.source.indexOf(t.text, sourceCursor);
    if (sourceAt >= 0) {
      const prefix = c.source.slice(c.source.lastIndexOf('\n', sourceAt - 1) + 1, sourceAt);
      sourceCursor = sourceAt + t.text.length;
      if (t.text.startsWith('/*')) {
        const condition = prefix.trim().length > 0;
        const group = `${t.opcode.toString(16)}:${prefix.trim() ? 'inline' : 'standalone'}:${/;\s*$/.test(prefix) ? 'after-semicolon' : 'other'}`;
        result.placement[group] = (result.placement[group] ?? 0) + 1;
        if (t.opcode === (condition ? 0x4e : 0x24)) result.inlineHypothesis.match++;
        else {
          result.inlineHypothesis.mismatch++;
          if (result.inlineHypothesis.examples.length < 20) result.inlineHypothesis.examples.push({ key:c.key, text:t.text, prefix, opcode:t.opcode, previous:decoded.tokens[i-1]?.opcode });
        }
      }
    }

    const style = t.text.startsWith('/*') ? 'slash-star' : t.text.startsWith('<*') ? 'angle-star' : /^rem\b/i.test(t.text) ? 'rem' : 'other';
    const key = `${style}:0x${t.opcode.toString(16)}`;
    const group = result.groups[key] ??= { count: 0, programs: new Set(), examples: [] };
    group.count++;
    group.programs.add(JSON.stringify(c.key));
    const example = { key: c.key, offset: t.offset, text: t.text, previous: decoded.tokens[i - 1]?.opcode, next: decoded.tokens[i + 1]?.opcode };
    if (group.examples.length < 8) group.examples.push(example);
    const expected = Buffer.from(t.text, 'utf16le');
    if (b.readUInt16LE(t.offset + 1) !== expected.length || !b.subarray(t.offset + 3, t.offset + 3 + expected.length).equals(expected)) result.payloadMismatches.push(example);
    if (!c.source.includes(t.text)) { result.sourceMismatchCount++; if (result.sourceMismatches.length < 20) result.sourceMismatches.push(example); }
  }
}
for (const group of Object.values(result.groups)) group.programs = group.programs.size;
writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
console.log(JSON.stringify({ programs: result.programs, comments: result.comments, groups: Object.fromEntries(Object.entries(result.groups).map(([k,v])=>[k,{count:v.count,programs:v.programs}])), placement: result.placement, inlineHypothesis: result.inlineHypothesis, payloadMismatches: result.payloadMismatches.length, sourceMismatches: result.sourceMismatches.length }, null, 2));
