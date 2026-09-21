// Rigorous per-occurrence validation for structural (non-text) opcodes.
//
// For each program, splits the decoder's output into a sequence of KNOWN
// segments (already-trusted decoded text) and GAPS (runs of unmapped
// bytes). Locates each known segment in the program's real source in order,
// which pins down exactly what source text falls in each gap between two
// anchors.
//
// A first version of this assumed every known segment appears exactly once,
// in order, in the source -- and broke on 0x21 (record.field reference)
// tokens, which can legitimately appear via a backref (e.g. a function's own
// name, once at its declaration and once via a NAMENUM lookup for its own
// symbol entry) without a second matching occurrence in visible source. This
// version treats those as unreliable anchors: 0x21-sourced tokens can be
// SKIPPED without matching, rather than aborting the whole program, and any
// gap bordered by a skipped anchor is discarded rather than extracted from a
// guessed position.
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

function segment(tokens, unknownOffsets) {
  const segs = [];
  let i = 0;
  while (i < tokens.length) {
    if (unknownOffsets.has(tokens[i].offset)) {
      const start = i;
      while (i < tokens.length && unknownOffsets.has(tokens[i].offset)) i++;
      segs.push({ kind: 'gap', tokens: tokens.slice(start, i) });
    } else {
      const start = i;
      while (i < tokens.length && !unknownOffsets.has(tokens[i].offset)) i++;
      const seg = tokens.slice(start, i);
      const text = seg.map((t) => t.text).join('');
      // A segment sourced entirely from a single 0x21 reference token is not
      // a reliable sequential anchor -- it may be a backref, not a fresh
      // occurrence. Flag it so the caller can skip rather than trust it.
      const unreliable = seg.length === 1 && seg[0].opcode === 0x21;
      if (text.length > 0) segs.push({ kind: 'known', text, unreliable });
    }
  }
  return segs;
}

function buildPattern(needle) {
  return needle
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? '\\s+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
}

/** Returns { start, end } of the first match at/after `from`, or undefined. */
function find(hay, needle, from) {
  if (needle.trim().length === 0) return { start: from, end: from };
  const m = hay.slice(from).match(new RegExp(buildPattern(needle), 'i'));
  if (!m) return undefined;
  return { start: from + m.index, end: from + m.index + m[0].length };
}

const gapEvidence = new Map();
let programsUsed = 0;

for (const e of corpus) {
  const result = decodeProgram(e.buf, namesOf(e), { mode: 'auto', isApplicationClass: e.key.type === 58 });
  const unknownOffsets = new Set(result.unknownOpcodes.map((u) => u.offset));
  const segs = segment(result.tokens, unknownOffsets);

  let cursor = 0;
  let cursorReliable = true; // false right after skipping an unreliable anchor
  let usedAny = false;

  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    if (seg.kind === 'known') {
      if (seg.unreliable) { cursorReliable = false; continue; } // skip, don't move cursor
      const m = find(e.source, seg.text, cursor);
      if (!m) { cursorReliable = false; continue; } // couldn't place it; don't trust cursor for the next gap either
      cursor = m.end;
      cursorReliable = true;
      continue;
    }
    // gap: need a reliable cursor AND a reliable next known anchor.
    if (!cursorReliable) continue;
    const next = segs[s + 1];
    if (!next || next.kind !== 'known' || next.unreliable) continue;
    const m = find(e.source, next.text, cursor);
    if (!m) continue;
    if (m.start - cursor > 200) continue; // implausibly large; likely a stale match
    const gapText = e.source.slice(cursor, m.start);
    const key = seg.tokens.map((t) => t.opcode.toString(16)).join(',');
    const rec = gapEvidence.get(key) ?? { matches: new Map(), total: 0 };
    rec.total++;
    const norm = gapText.replace(/\s+/g, ' ').trim();
    rec.matches.set(norm, (rec.matches.get(norm) ?? 0) + 1);
    gapEvidence.set(key, rec);
    usedAny = true;
  }
  if (usedAny) programsUsed++;
}

console.log(`programs contributing at least one gap: ${programsUsed}/${corpus.length}\n`);
console.log('=== single-opcode gaps: what source text actually fills them ===');
const singleOp = [...gapEvidence.entries()]
  .filter(([k]) => !k.includes(','))
  .filter(([, r]) => r.total >= 10)
  .sort((a, b) => b[1].total - a[1].total);

for (const [op, rec] of singleOp) {
  const sorted = [...rec.matches.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const consistency = ((top[1] / rec.total) * 100).toFixed(1);
  console.log(`\n  0x${op.padStart(2, '0')}  (n=${rec.total})  top: ${JSON.stringify(top[0]).slice(0, 40)} ` +
    `${top[1]}/${rec.total} (${consistency}%)`);
  for (const [txt, count] of sorted.slice(0, 6)) {
    console.log(`      ${String(count).padStart(4)}x  ${JSON.stringify(txt).slice(0, 55)}`);
  }
}
