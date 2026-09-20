// Line-structure metric, for validating whitespace/newline opcodes.
//
// The text-accuracy metric in corpus-validate.mjs normalises whitespace away,
// so it is structurally incapable of telling a correct newline mapping from a
// wrong one. This compares decoded output to real source line by line
// instead: each source line is stripped of indentation (never encoded in the
// bytes) and matched against the decoded lines in order. A correct newline
// opcode should raise the share of source lines that appear as their own
// decoded line; a wrong one should lower it by splitting lines that belong
// together or joining ones that don't.
import { readFileSync } from 'node:fs';
import { decodeProgram, OPCODES, TokenKind } from '../dist-test/peoplecode/decoder.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  .map((e) => ({ ...e, buf: Buffer.from(e.bytes, 'base64') }));

function namesOf(e) {
  const t = new NameTable();
  for (const [n, v] of e.names) t.add(n, v);
  return t;
}

const clean = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();

function measure(label) {
  let srcLines = 0, matched = 0;
  for (const e of corpus) {
    const r = decodeProgram(e.buf, namesOf(e));
    const dec = new Set(
      r.text.split('\n').map(clean).filter((l) => l.length >= 4));
    const lines = e.source.split('\n').map(clean).filter((l) => l.length >= 4);
    for (const l of lines) {
      srcLines++;
      if (dec.has(l)) matched++;
    }
  }
  console.log(`${label} ${matched}/${srcLines} source lines appear as a decoded line ` +
    `(${((matched / srcLines) * 100).toFixed(2)}%)`);
}

measure('baseline        ');
OPCODES.set(0x2d, { kind: TokenKind.Newline, text: '\n' });
measure('+0x2d newline   ');
OPCODES.set(0x4f, { kind: TokenKind.Newline, text: '\n' });
measure('+0x4f newline   ');
OPCODES.set(0x37, { kind: TokenKind.Keyword, text: 'End-Function' });
measure('+0x37 semicolon ');
