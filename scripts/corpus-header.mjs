// Offline audit of a corpus-build.mjs JSON file. No database writes or access.
// Run after npm run compile: node scripts/corpus-header.mjs corpus.json
import { readFileSync } from 'node:fs';
import { readProgramLayout } from '../dist-test/peoplecode/programLayout.js';

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const failures = [];
let checked = 0;
for (const entry of corpus) {
  const bytes = Buffer.from(entry.bytes, 'base64');
  try {
    const layout = readProgramLayout(bytes);
    // Validate UTF-16 name framing independently of the decoder's heuristic
    // trailer detection, and check every record references a name boundary.
    const starts = new Set();
    let pos = layout.names.offset;
    const end = pos + layout.names.byteLength;
    while (pos < end) {
      starts.add((pos - layout.names.offset) / 2);
      while (pos < end && bytes.readUInt16LE(pos) !== 0) pos += 2;
      if (pos === end) throw new Error('unterminated directory name');
      pos += 2;
    }
    for (let i = 0; i < layout.recordCount; i++) {
      const nameOffset = bytes.readUInt32LE(layout.records.offset + i * 16);
      if (!starts.has(nameOffset)) throw new Error(`record ${i} references a non-name offset ${nameOffset}`);
    }
    checked++;
  } catch (error) {
    failures.push({ key: entry.key, error: error.message });
  }
}
console.log(JSON.stringify({ total: corpus.length, checked, failures }, null, 2));
if (failures.length) process.exitCode = 1;
