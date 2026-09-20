import { readFileSync } from 'node:fs';
import { decodeProgram } from '../dist-test/peoplecode/decoder.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  .map((e) => ({ ...e, buf: Buffer.from(e.bytes, 'base64') }));
const e = corpus.find((x) => x.key.parts.join('.').includes(process.argv[3]));
if (!e) { console.log('not found'); process.exit(1); }
const names = new NameTable();
for (const [n, v] of e.names) names.add(n, v);
const r = decodeProgram(e.buf, names);
console.log('######## REAL SOURCE ########');
console.log(e.source);
console.log('######## DECODED ########');
console.log(r.text);
console.log(`######## ${r.unknownOpcodes.length} unmapped of ${e.buf.length} bytes ########`);
