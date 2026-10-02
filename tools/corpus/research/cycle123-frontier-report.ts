/*
 * Cycle 123: classify every NONEXACT definition of a frontier census
 * (`cycle123-frontier-census.ts`) by current evidence (research only).
 *
 *   decoder families     -- DECODE_SOURCE_MISMATCH / DECODER_BARE_IDENTIFIER by
 *                           the first differing normalized line: snapshot
 *                           source encoding artefact (`¿` / backtick where the
 *                           stored program has the real character), an empty
 *                           statement after a statement / comment / keyword,
 *                           a comment followed by code on its line, a decoder
 *                           failure, spacing, the dropped `PanelGroup` keyword;
 *   COMPLETE_DOWNSTREAM  -- by the first aligned decoded-token divergence (a
 *                           stored 0x4F the encoder does not write, by what
 *                           precedes it; 0x4E inline comment placement; 0x4A
 *                           reference vs 0x0A inline name; `array` 0x40 vs
 *                           0x0A ...) or, with identical token streams, the
 *                           byte region (Function signature trailer, type-path
 *                           case, text after the end of the program);
 *   error families       -- ENCODE_ERROR / UNSUPPORTED_SYNTAX by message;
 *   reference families   -- the first reference divergence (stored kind /
 *                           generated kind), ordinary / App Class, fallback.
 *
 * Usage: npx tsx tools/corpus/research/cycle123-frontier-report.ts <frontier.jsonl>
 */
import fs from 'node:fs';

interface Row { [key: string]: any }
const rows: Row[] = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(line => JSON.parse(line));
const nonexact = rows.filter(row => row.category !== 'EXACT');

const tally = (list: Row[], key: (row: Row) => string) => {
  const m = new Map<string, Row[]>();
  for (const row of list) { const k = key(row); m.set(k, [...(m.get(k) ?? []), row]); }
  return [...m].sort((a, b) => b[1].length - a[1].length);
};
const print = (title: string, list: Row[], key: (row: Row) => string) => {
  console.log(`\n== ${title} (${list.length})`);
  for (const [k, group] of tally(list, key)) {
    const fwd = group.filter(row => row.forwardExact).length;
    console.log(`  ${String(group.length).padStart(4)}  ${k}${fwd ? `  [forward-exact ${fwd}]` : ''}  e.g. ${group.slice(0, 8).map(row => row.id).join(' ')}`);
  }
};

export function decoderFamily(row: Row): string {
  const fl = row.firstLine ?? {};
  const s: string = fl.source ?? '', d: string = fl.decoded ?? '';
  if (row.category === 'DECODER_BARE_IDENTIFIER') return /\bpanelgroup\b/i.test(s) ? 'PanelGroup keyword dropped by the decoder (0x51)' : 'other bare identifier';
  if (/could not be fully decode/.test(d)) return 'decoder failure (program not fully decoded)';
  if (s.includes('¿') || (s.includes('`') && /[‘’]/.test(d))) return 'snapshot source encoding artefact (¿ / ` for a non-Latin-1 character)';
  const st = s.trimEnd(), dt = d.trimEnd();
  if (/;;+$/.test(st) && !/;;$/.test(dt)) return 'empty statement after a statement (X;;)';
  if (/(\*\/|\+\/);$/.test(st) !== /(\*\/|\+\/);$/.test(dt) && /(\*\/|\+\/);?$/.test(st) && /(\*\/|\+\/);?$/.test(dt)) return 'empty statement after a comment (/* c */;)';
  if (`${st};` === dt || `${dt};` === st) return 'empty statement after a keyword (Else; Then; try; When x;)';
  if (/\*\/\s*\S/.test(s) && dt.endsWith('*/')) return 'comment followed by code on its line';
  if (s.replace(/\s/g, '') === d.replace(/\s/g, '')) return 'spacing';
  return 'other';
}

export function downstreamFamily(row: Row): string {
  const t = row.firstToken;
  if (t === undefined || t === null) {
    if (row.lengthDelta < 0) return 'identical tokens: stored keeps text after the end of the program';
    if (row.firstBodyDiff > 0 && row.app) return 'identical tokens: App Class type-path case';
    return 'identical tokens: Function signature trailer byte (02 vs 01)';
  }
  const so = t.stored.slice(0, 2), go = t.generated.slice(0, 2), prev = t.previous.slice(0, 2);
  if (so === '4f') {
    if (go === '2d') return 'stored 0x4F where the encoder writes 0x2D (marker order)';
    if (prev === '24' || prev === '55') return 'stored 0x4F after a standalone comment / disabled-code run';
    if (prev === '15' && ['56', '62', '63'].includes(go)) return 'stored 0x4F before Constant / instance / method';
    return `stored 0x4F, other (previous ${prev}, generated ${go})`;
  }
  if (so === '2d' && go === '4f') return 'stored 0x2D where the encoder writes 0x4F';
  if (so === '4e') return `stored inline comment 0x4E where the encoder writes ${go}`;
  if (so === '4a' && go === '0a') return 'stored reference operand 0x4A where the encoder writes an inline name';
  if (so === '0a' && go === '4a') return 'stored inline name where the encoder writes a reference operand';
  if (so === '40' && go === '0a') return '`array` stored as keyword 0x40, encoder writes inline name 0x0A';
  return `stored ${so} / generated ${go}`;
}

export function errorFamily(row: Row): string {
  const e: string = row.error ?? '';
  if (/^Unsupported function metadata type|^Unsupported Function parameter/.test(e)) return 'Function metadata type / parameter';
  if (/catch/.test(e)) return 'try / catch grammar (catch as a call name, catch body)';
  return e.replace(/\[DOTTED-STMT\].*/, '[DOTTED-STMT]').slice(0, 70);
}

const kindOf = (key: string | undefined) => {
  if (key === undefined || key === '<end>') return 'none';
  const head = key.split('.')[0];
  return ['PACKAGE', 'RECORD', 'FIELD', 'SCROLL', 'COMPONENT', 'PAGE', 'MENUNAME', 'BARNAME', 'ITEMNAME', 'SQL', 'IMAGE'].includes(head) ? head : 'REC.FIELD';
};

console.log(`${rows.length} records; NONEXACT ${nonexact.length}; forward-exact but not EXACT ${nonexact.filter(r => r.forwardExact).length}; reference-exact ${nonexact.filter(r => r.referencesExact).length}`);
print('categories', nonexact, row => `${row.category}  refsExact ${row.referencesExact ? 'y' : 'n'}`);
print('forward-exact but not EXACT', nonexact.filter(r => r.forwardExact), row => `${row.category}: ${decoderFamily(row)}`);
print('decoder families', nonexact.filter(r => r.category === 'DECODE_SOURCE_MISMATCH' || r.category === 'DECODER_BARE_IDENTIFIER'), row => `${row.category}: ${decoderFamily(row)}`);
print('COMPLETE_DOWNSTREAM', nonexact.filter(r => r.category === 'REFERENCE_COMPLETE_DOWNSTREAM'), row => `${downstreamFamily(row)} [${row.app ? 'App Class' : 'ordinary'}]`);
print('reference-exact behind a decoder category', nonexact.filter(r => r.referencesExact && r.category !== 'REFERENCE_COMPLETE_DOWNSTREAM' && !r.forwardExact), row => `${row.category}: ${row.firstToken ? downstreamFamily(row) : 'no token divergence'}`);
print('encode errors', nonexact.filter(r => r.category === 'ENCODE_ERROR' || r.category === 'UNSUPPORTED_SYNTAX'), row => `${row.category}: ${errorFamily(row)}`);
print('reference families', nonexact.filter(r => /^REFERENCE_ACTIVE|STRUCTURAL_ORDERING/.test(row_category(r))), row => `${row.category}: stored ${kindOf(row.firstReference?.stored)} / generated ${kindOf(row.firstReference?.generated)} [${row.app ? 'App Class' : 'ordinary'}${row.fallback ? ', fallback' : ''}]`);

function row_category(row: Row): string { return row.category; }
