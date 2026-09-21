// Dumps the raw bytes right after TRAILER_MARKER for a fetch-appclass.mjs
// JSON blob: the name run (as decodeDeclarations reads it) and every
// following 16-byte record, unconditionally (no charOffset self-check
// rejection), for by-hand inspection.
import { readFileSync } from 'node:fs';

const e = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const buf = Buffer.from(e.bytes, 'base64');

const MARKER = [0x2d, 0x07];
let markerAt = -1;
for (let i = 0; i < buf.length - 1; i++) {
  if (buf[i] === MARKER[0] && buf[i + 1] === MARKER[1]) { markerAt = i; break; }
}
console.log('trailer marker at', markerAt, 'of', buf.length, 'total bytes');
if (markerAt < 0) process.exit(1);

let i = markerAt + 2;
const runStart = i;
const names = [];
while (true) {
  const nameStart = i;
  let j = i;
  while (j + 1 < buf.length && !(buf[j] === 0x00 && buf[j + 1] === 0x00)) j += 2;
  if (j + 1 >= buf.length) { console.log('ran off end reading name run'); break; }
  const text = buf.toString('utf16le', nameStart, j);
  if (text === '') { i = nameStart; break; }
  i = j + 2;
  names.push({ text, start: nameStart, end: j + 2, charOffset: (nameStart - runStart) / 2 });
}
console.log('name run: ', names.length, 'names');
for (const n of names) console.log(`  charOffset=${n.charOffset}  ${JSON.stringify(n.text)}`);

const tableStart = i;
console.log('\ntable starts at byte offset', tableStart, `(${buf.length - tableStart} bytes remain, ${(buf.length - tableStart) / 16} records if 16 bytes each)`);

let rec = 0;
for (let base = tableStart; base + 16 <= buf.length; base += 16, rec++) {
  const a = buf.readInt32LE(base);
  const b = buf.readInt32LE(base + 4);
  const c = buf.readInt32LE(base + 8);
  const d = buf.readInt32LE(base + 12);
  const name = names.find((n) => n.charOffset === a);
  console.log(`  [${rec}] a(charOffset?)=${a}${name ? ' -> ' + JSON.stringify(name.text) : ''}  b=${b} (0x${(b>>>0).toString(16)})  c=${c} (0x${(c>>>0).toString(16)})  d=${d} (0x${(d>>>0).toString(16)})`);
}
