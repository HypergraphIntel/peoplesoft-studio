/*
 * Cycle 183 (research only, LOCAL SNAPSHOT, no encoder change): a complete
 * inventory of the DECODE_SOURCE_MISMATCH residual.
 *
 * For every DSM definition in .claude/nonexact-taxonomy.json:
 * - the stored source (PSPCMTXT, as captured) and the decoded stored
 *   program (PSPCMPROG through the harness decoder), compared after the
 *   harness's own normalization (`sourcesMatch`);
 * - EVERY differing segment (a resynchronizing aligner over code points),
 *   with code points on both sides, the stored character's byte in the
 *   HCDEV database character set (WE8ISO8859P15) when it has one, where it
 *   sits in the decoded program (string literal / comment / code), and the
 *   PSPCMPROG byte offset of the decoded text (its UTF-16LE form);
 * - a mechanism class per segment, from code points and Oracle's own
 *   AL32UTF8 -> WE8ISO8859P15 conversion table (Cycle 183, lab HRDMO);
 * - forward encode (stored source) and re-encode of the decoded source:
 *   program bytes AND the PSPCMNAME rows against the stored ones.
 *
 * Output: .claude/cycle183-source-loss-inventory.json; summary on stdout.
 *
 * Usage: npx tsx tools/corpus/research/cycle183-source-loss-inventory.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { normalizePeopleCodeSource } from '../../../src/peoplecode/corpus/sourceNormalize';
import {
  decodeAsHarness,
  encodeAsHarness,
  generatedReferenceKey,
  openHarnessContext,
  storedNameTable,
  storedReferenceKeys
} from './lib/harnessContext';

const TAXONOMY = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');
const OUT = path.join(__dirname, '../../../.claude/cycle183-source-loss-inventory.json');

/* ISO-8859-15 differs from ISO-8859-1 at eight positions. */
const LATIN9_ADDED = new Map<number, number>([[0x20ac, 0xa4], [0x0160, 0xa6], [0x0161, 0xa8], [0x017d, 0xb4], [0x017e, 0xb8], [0x0152, 0xbc], [0x0153, 0xbd], [0x0178, 0xbe]]);
const LATIN9_REMOVED = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);
/** The WE8ISO8859P15 byte for a code point, or undefined when it has none. */
export function latin9Byte(cp: number): number | undefined {
  if (LATIN9_ADDED.has(cp)) return LATIN9_ADDED.get(cp);
  if (cp <= 0xff && !LATIN9_REMOVED.has(cp)) return cp;
  return undefined;
}

const u = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
const cps = (s: string) => [...s].map(c => c.codePointAt(0)!);

interface Segment { srcAt: number; decAt: number; src: string; dec: string }

/** Differing segments between two strings: walk; on a mismatch, resynchronize on the nearest 24-code-unit common run. */
function alignedDiff(a: string, b: string): Segment[] {
  const out: Segment[] = [];
  let i = 0, j = 0;
  const RUN = 24, WINDOW = 400;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; continue; }
    let found: [number, number] | undefined;
    search: for (let total = 1; total <= 2 * WINDOW; total++) {
      for (let da = Math.max(0, total - WINDOW); da <= Math.min(total, WINDOW); da++) {
        const db = total - da;
        if (i + da > a.length || j + db > b.length) continue;
        const ra = a.slice(i + da, i + da + RUN), rb = b.slice(j + db, j + db + RUN);
        if (ra === rb && (ra.length === RUN || (i + da === a.length && j + db === b.length))) { found = [da, db]; break search; }
      }
    }
    if (found === undefined) { out.push({ srcAt: i, decAt: j, src: a.slice(i), dec: b.slice(j) }); break; }
    out.push({ srcAt: i, decAt: j, src: a.slice(i, i + found[0]), dec: b.slice(j, j + found[1]) });
    i += found[0]; j += found[1];
  }
  return out;
}

/** Where an offset of a decoded program text sits: string literal, comment, or code. */
function regionAt(text: string, at: number): 'string' | 'comment' | 'code' {
  let i = 0;
  while (i < text.length && i <= at) {
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
      if (at >= i && at <= j) return 'string';
      i = j + 1;
    } else if (text.startsWith('/*', i) || text.startsWith('<*', i)) {
      const close = text.indexOf(text[i] === '/' ? '*/' : '*>', i + 2);
      const j = close < 0 ? text.length : close + 2;
      if (at >= i && at < j) return 'comment';
      i = j;
    } else if (/^REM\b/i.test(text.slice(i, i + 4)) && (i === 0 || /[\s;]/.test(text[i - 1]))) {
      const j = text.indexOf(';', i);
      const end = j < 0 ? text.length : j + 1;
      if (at >= i && at < end) return 'comment';
      i = end;
    } else i++;
  }
  return 'code';
}

/* Oracle's own AL32UTF8 -> WE8ISO8859P15 table (cycle183-we8iso8859p15-conversion.json): the listed code points, everything else 0xBF. */
const CONVERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../.claude/cycle183-we8iso8859p15-conversion.json'), 'utf8'));
const NON_REPLACEMENT = new Map<number, number>(Object.entries(CONVERSION.nonReplacementMappings as Record<string, string>).map(([k, v]) => [parseInt(k.slice(2), 16), parseInt(v.slice(2), 16)]));
const oracleImage = (cp: number): number | undefined => (cp > 0xffff || (cp >= 0xd800 && cp <= 0xdfff) ? undefined : NON_REPLACEMENT.get(cp) ?? 0xbf);

/** Per differing character: the stored byte is Oracle's conversion image of the program's character (replacement 0xBF, or a best-fit byte). */
function mechanism(seg: Segment): string {
  const s = cps(seg.src), d = cps(seg.dec);
  if (s.length === d.length && s.length > 0) {
    const kinds = new Set<string>();
    for (let k = 0; k < s.length; k++) {
      if (s[k] === d[k]) continue;
      const image = oracleImage(d[k]);
      if (image === undefined || latin9Byte(s[k]) !== image) { kinds.clear(); kinds.add('X'); break; }
      kinds.add(image === 0xbf ? 'ORACLE_REPLACEMENT_0xBF' : 'ORACLE_BEST_FIT');
    }
    if (!kinds.has('X') && kinds.size > 0) return [...kinds].sort().join('+');
  }
  if (/^\s*$/.test(seg.src) && /^\s*$/.test(seg.dec)) return /[\r\n]/.test(seg.src + seg.dec) ? 'LINE_BREAK_OR_WHITESPACE' : 'WHITESPACE';
  if (seg.src.toLowerCase() === seg.dec.toLowerCase()) return 'CASE_ONLY';
  return 'OTHER';
}

function utf16Offset(program: Buffer, needle: string): number {
  if (needle.length === 0) return -1;
  return program.indexOf(Buffer.from(needle, 'utf16le'));
}

function main(): void {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY, 'utf8'));
  const ids: number[] = taxonomy.rows.filter((r: any) => r.primaryCategory === 'DECODE_SOURCE_MISMATCH').map((r: any) => r.definitionId);
  const ctx = openHarnessContext();
  const byId = new Map(ctx.definitions.map(d => [d.definitionId, d]));
  const rows: any[] = [];
  for (const id of ids) {
    const def = byId.get(id)!;
    const d = def as any;
    const decoded = decodeAsHarness(def, def.storedProgram, storedNameTable(def));
    const srcN = normalizePeopleCodeSource(def.sourceText), decN = normalizePeopleCodeSource(decoded.text);
    const segments = alignedDiff(srcN, decN).map(seg => {
      const m = mechanism(seg);
      const left = decN.slice(Math.max(0, seg.decAt - 8), seg.decAt);
      return {
        normalizedSourceOffset: seg.srcAt,
        normalizedDecodedOffset: seg.decAt,
        stored: seg.src,
        storedCodePoints: cps(seg.src).map(u),
        storedLatin9Bytes: cps(seg.src).map(c => { const b = latin9Byte(c); return b === undefined ? null : `0x${b.toString(16).toUpperCase().padStart(2, '0')}`; }),
        decoded: seg.dec,
        decodedCodePoints: cps(seg.dec).map(u),
        decodedInLatin9: cps(seg.dec).map(c => latin9Byte(c) !== undefined),
        region: regionAt(decN, seg.decAt),
        programByteOffset: utf16Offset(def.storedProgram, left + seg.dec),
        mechanism: m,
        context: { stored: srcN.slice(Math.max(0, seg.srcAt - 30), seg.srcAt + seg.src.length + 30), decoded: decN.slice(Math.max(0, seg.decAt - 30), seg.decAt + seg.dec.length + 30) }
      };
    });
    const forward = encodeAsHarness(ctx, def);
    const commentOpcodes = decoded.tokens.map((t: any) => t.opcode).filter((o: number) => o === 0x24 || o === 0x4e);
    const re = encodeAsHarness(ctx, { ...d, sourceText: decoded.text }, { commentOpcodes });
    const stored = storedReferenceKeys(def);
    const refKeys = (a: typeof re.artifacts) => a === undefined ? undefined : [...a.references].sort((x: any, y: any) => x.sequence - y.sequence).map(generatedReferenceKey);
    const reRefs = refKeys(re.artifacts), fwRefs = refKeys(forward.artifacts);
    rows.push({
      definitionId: id,
      displayName: def.displayName,
      key: [1, 2, 3, 4, 5, 6, 7].map(k => `${d[`objectid${k}`]}=${String(d[`objectvalue${k}`]).trim()}`).join(', '),
      peopleCodeType: d.objectid1 === 104 ? 'Application Class' : `OBJECTID1 ${d.objectid1}`,
      sourceLength: def.sourceText.length,
      decodedLength: decoded.text.length,
      segmentCount: segments.length,
      segments,
      forwardEncode: { programExact: forward.artifacts !== undefined && Buffer.compare(forward.artifacts.program, def.storedProgram) === 0, referencesExact: JSON.stringify(fwRefs) === JSON.stringify(stored), error: forward.error },
      decodedReencode: { programExact: re.artifacts !== undefined && Buffer.compare(re.artifacts.program, def.storedProgram) === 0, referencesExact: JSON.stringify(reRefs) === JSON.stringify(stored), error: re.error },
      mechanisms: [...new Set(segments.flatMap(s => s.mechanism.split('+')))].sort()
    });
  }
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), databaseCharacterSet: 'WE8ISO8859P15', count: rows.length, rows }, null, 1));

  const families = new Map<string, number[]>();
  for (const r of rows) {
    const k = r.mechanisms.join('+');
    families.set(k, [...(families.get(k) ?? []), r.definitionId]);
  }
  console.log(`DSM rows: ${rows.length}; segments: ${rows.reduce((n, r) => n + r.segmentCount, 0)}`);
  console.log(`decoded re-encode: program exact ${rows.filter(r => r.decodedReencode.programExact).length}, PSPCMNAME exact ${rows.filter(r => r.decodedReencode.referencesExact).length}, both ${rows.filter(r => r.decodedReencode.programExact && r.decodedReencode.referencesExact).length}`);
  console.log(`forward encode of stored source: program exact ${rows.filter(r => r.forwardEncode.programExact).length}, PSPCMNAME exact ${rows.filter(r => r.forwardEncode.referencesExact).length}`);
  for (const [k, v] of families) console.log(`family ${k}: ${v.length} ${JSON.stringify(v)}`);
  const pairs = new Map<string, number>();
  for (const r of rows) for (const s of r.segments) {
    const k = `${s.mechanism} | ${s.storedCodePoints.join(' ') || '(none)'} -> ${s.decodedCodePoints.join(' ') || '(none)'} | ${s.region}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  console.log('segment transformations:');
  for (const [k, v] of [...pairs].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
}

main();
