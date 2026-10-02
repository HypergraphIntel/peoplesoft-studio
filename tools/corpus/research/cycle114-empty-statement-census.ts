/*
 * Cycle 114: standalone semicolons -- empty statements -- in PeopleCode
 * source, against stored PSPCMPROG (research only).
 *
 * A `;` is standalone when the previous significant item (block comments,
 * `<* *>` disabled code, `/+ +/` signature comments and REM statements
 * skipped) is another `;` or the program start: an empty statement. A `;`
 * directly after `Then`, `Else` or `try` is reported separately (the
 * encoder already reads it as an optional header separator; its bytes are
 * the same 0x15). Semicolons inside disabled code, comments and strings are
 * masked and counted only as a control.
 *
 * Per occurrence: definition, offset, line, column, program kind, parent
 * construct (approximate keyword stack), previous item, same line or not,
 * an intervening comment, position in a run (`;;;`), next word, whether
 * the current encoder succeeds and whether its error offset is this `;`.
 *
 * Per definition, the stored check: one-0x15-per-empty-statement predicts
 * stored `15 15` pairs for same-line empty statements and `15 <layout> 15`
 * for the rest (comment / newline between); the census compares those
 * counts.
 *
 * Usage: npx tsx tools/corpus/research/cycle114-empty-statement-census.ts <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

interface SemiOccurrence {
  offset: number; line: number; column: number;
  prev: string;            // kind of previous significant item
  prevText: string;
  afterComment: boolean;   // a comment / REM / disabled block sits between the previous item and this `;`
  sameLineAsPrev: boolean;
  run: number;             // 1-based index within a run of consecutive standalone semicolons
  parent: string;          // innermost enclosing construct
  next: string;            // next significant word
}
const isWord = (c: string) => /[A-Za-z0-9_&%#$]/.test(c);
function scanStandaloneSemicolons(source: string): SemiOccurrence[] {
  // mask comments, disabled code, strings, REM statements (keeping positions)
  type Span = { start: number; end: number; kind: 'comment' | 'string' };
  const spans: Span[] = [];
  const n = source.length;
  let i = 0;
  let atStatementStart = true;
  while (i < n) {
    const c = source[i];
    if (c === '"') { const s = i; i++; while (i < n) { if (source[i] === '"') { if (source[i + 1] === '"') { i += 2; continue; } i++; break; } i++; } spans.push({ start: s, end: i, kind: 'string' }); atStatementStart = false; continue; }
    if (source.startsWith('/*', i)) { const e = source.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; spans.push({ start: i, end, kind: 'comment' }); i = end; continue; }
    if (source.startsWith('<*', i)) { const e = source.indexOf('*>', i + 2); const end = e < 0 ? n : e + 2; spans.push({ start: i, end, kind: 'comment' }); i = end; continue; }
    if (source.startsWith('/+', i)) { const e = source.indexOf('+/', i + 2); const end = e < 0 ? n : e + 2; spans.push({ start: i, end, kind: 'comment' }); i = end; continue; }
    if (atStatementStart && /^rem\b/i.test(source.slice(i, i + 4)) && (i === 0 || !isWord(source[i - 1]))) {
      const e = source.indexOf(';', i); const end = e < 0 ? n : e + 1; spans.push({ start: i, end, kind: 'comment' }); i = end; atStatementStart = true; continue;
    }
    if (c === ';') { atStatementStart = true; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    // statement-start keywords that open a body also leave us at a statement start
    const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i, i + 40));
    if (m) { const w = m[0].toLowerCase(); atStatementStart = ['then', 'else', 'repeat', 'try', 'do'].includes(w); i += m[0].length; continue; }
    atStatementStart = false; i++;
  }
  const masked = source.split('');
  for (const sp of spans) for (let k = sp.start; k < sp.end; k++) if (masked[k] !== '\n') masked[k] = ' ';
  const text = masked.join('');
  const commentAt = new Uint8Array(n);
  for (const sp of spans) if (sp.kind === 'comment') for (let k = sp.start; k < sp.end; k++) commentAt[k] = 1;
  // tokenize significant items
  type Tok = { start: number; end: number; text: string };
  const toks: Tok[] = [];
  for (const m of text.matchAll(/[A-Za-z_%&#$][A-Za-z0-9_\-#$]*|;|[^\sA-Za-z_%&#$;]/g)) toks.push({ start: m.index!, end: m.index! + m[0].length, text: m[0] });
  // construct stack
  const stack: string[] = [];
  const out: SemiOccurrence[] = [];
  const lineOf = (o: number) => source.slice(0, o).split('\n').length;
  const colOf = (o: number) => o - source.lastIndexOf('\n', o - 1);
  let run = 0;
  for (let t = 0; t < toks.length; t++) {
    const tok = toks[t];
    const w = tok.text.toLowerCase();
    const prevTok = toks[t - 1];
    const prevW = prevTok?.text.toLowerCase();
    // maintain stack (approximate)
    if (prevW !== 'end' && w !== '-') {
      if (w === 'if') stack.push('If');
      else if (w === 'else') { if (stack[stack.length - 1] === 'If') stack[stack.length - 1] = 'Else'; }
      else if (w === 'end-if') { stack.pop(); }
      else if (w === 'for' && prevW !== 'declare') stack.push('For');
      else if (w === 'end-for') stack.pop();
      else if (w === 'while') stack.push('While');
      else if (w === 'end-while') stack.pop();
      else if (w === 'repeat') stack.push('Repeat');
      else if (w === 'until') stack.pop();
      else if (w === 'evaluate') stack.push('Evaluate');
      else if (w === 'when' || w === 'when-other') { while (stack.length && ['When', 'When-Other'].includes(stack[stack.length - 1])) stack.pop(); stack.push(w === 'when' ? 'When' : 'When-Other'); }
      else if (w === 'end-evaluate') { while (stack.length && ['When', 'When-Other'].includes(stack[stack.length - 1])) stack.pop(); stack.pop(); }
      else if (w === 'try') stack.push('try');
      else if (w === 'catch') { if (stack[stack.length - 1] === 'try' || stack[stack.length - 1] === 'catch') stack[stack.length - 1] = 'catch'; }
      else if (w === 'end-try') stack.pop();
      else if (w === 'function' && prevW !== 'declare' && (t === 0 || toks[t - 1].text === ';' || /\n\s*$/.test(source.slice(0, tok.start)))) stack.push('Function');
      else if (w === 'end-function') stack.pop();
      else if ((w === 'method' || w === 'get' || w === 'set') && /(^|\n)[ \t]*$/.test(source.slice(Math.max(0, tok.start - 200), tok.start)) && stack[stack.length - 1] !== 'class') stack.push(w);
      else if (w === 'end-method' || w === 'end-get' || w === 'end-set') stack.pop();
      else if ((w === 'class' || w === 'interface') && /(^|\n)[ \t]*$/.test(source.slice(Math.max(0, tok.start - 200), tok.start))) stack.push('class');
      else if (w === 'end-class' || w === 'end-interface') stack.pop();
    }
    if (tok.text !== ';') { run = 0; continue; }
    // previous significant token
    const prev = prevTok;
    let kind: string;
    if (!prev) kind = 'program-start';
    else if (prev.text === ';') kind = 'semicolon';
    else if (['then', 'else', 'repeat', 'try'].includes(prevW!)) kind = prevW!;
    else kind = 'other';
    if (kind === 'other') { run = 0; continue; }
    // When-clause / catch / header openers are detected as 'other' -- refine: previous statement ended at a line end with no ';'
    const between = source.slice(prev ? prev.end : 0, tok.start);
    const afterComment = Array.from({ length: tok.start - (prev ? prev.end : 0) }, (_, k) => commentAt[(prev ? prev.end : 0) + k]).some(Boolean);
    run = kind === 'semicolon' && run > 0 ? run + 1 : 1;
    const nextTok = toks[t + 1];
    out.push({
      offset: tok.start, line: lineOf(tok.start), column: colOf(tok.start),
      prev: kind, prevText: source.slice(Math.max(0, (prev?.start ?? 0) - 20), prev ? prev.end : 0).replace(/\s+/g, ' '),
      afterComment, sameLineAsPrev: !between.includes('\n'),
      run, parent: stack[stack.length - 1] ?? 'top', next: nextTok ? nextTok.text : '<eof>'
    });
  }
  return out;
}

const disabledSemicolons = (source: string): number => {
  let count = 0;
  for (const m of source.matchAll(/<\*[\s\S]*?\*>/g)) count += (m[0].match(/;/g) ?? []).length;
  return count;
};

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const out = fs.openSync(process.argv[2], 'w');
const layout = new Set([0x4f, 0x2d, 0x24, 0x4e, 0x55]);
let occurrences = 0, definitions = 0, storedAgree = 0, storedDisagree = 0, disabled = 0;
const parents = new Map<string, number>();
const failing = new Set<number>();
for (const def of listSnapshotDefinitions(db) as any[]) {
  const source = String(def.sourceText ?? '');
  if (!source.includes(';')) continue;
  disabled += disabledSemicolons(source);
  const all = scanStandaloneSemicolons(source);
  const empty = all.filter(o => o.prev === 'semicolon' || o.prev === 'program-start');
  if (empty.length === 0) continue;
  definitions++;
  const app = def.objectid1 === 104;
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const ri = ids.findIndex((x: number) => x === 1), fi = ids.findIndex((x: number) => x === 2);
  const owner = { recordName: ri >= 0 ? values[ri] : values[0], fieldName: fi >= 0 ? values[fi] : values[1], packagePath: values.slice(0, event < 0 ? values.length : event).filter(Boolean) };
  let errorOffset: number | undefined;
  try { encodeProgramArtifacts(source, { owner, applicationClassTypeMetadata: provider }); }
  catch (e: any) { errorOffset = typeof e.offset === 'number' ? e.offset : -1; }
  // stored check
  const names = new NameTable();
  for (const row of def.names) {
    const rec = String(row.recname ?? '').trim(), ref = String(row.refname ?? '').trim();
    names.add(Number(row.namenum), rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  let adjacent = 0, viaLayout = 0;
  try {
    const st = decodeProgram(def.storedProgram, names, { mode: 'auto', isApplicationClass: app } as any).tokens;
    for (let i = 1; i < st.length; i++) {
      if (st[i].opcode !== 0x15) continue;
      if (st[i - 1].opcode === 0x15 || st[i - 1].opcode === 0xa0) { adjacent++; continue; }
      let j = i - 1; while (j >= 0 && layout.has(st[j].opcode)) j--;
      if (j < i - 1 && st[j]?.opcode === 0x15) viaLayout++;
    }
  } catch { /* undecodable */ }
  const sameLine = empty.filter(o => o.sameLineAsPrev && !o.afterComment).length;
  const agrees = adjacent === sameLine && viaLayout >= empty.length - sameLine;
  agrees ? storedAgree++ : storedDisagree++;
  for (const o of empty) {
    occurrences++;
    const key = `${app ? 'app' : 'ord'} ${o.parent}`;
    parents.set(key, (parents.get(key) ?? 0) + 1);
    const failsHere = errorOffset !== undefined && !app && errorOffset === o.offset;
    if (errorOffset !== undefined) failing.add(def.definitionId);
    fs.writeSync(out, JSON.stringify({
      id: def.definitionId, app, ...o, encodes: errorOffset === undefined, failsHere,
      stored: { adjacent, viaLayout, sameLine, agrees },
      context: source.slice(Math.max(0, o.offset - 60), o.offset + 30)
    }) + '\n');
  }
}
fs.closeSync(out);
console.log(`${occurrences} empty statements in ${definitions} definitions; stored agrees ${storedAgree}, disagrees ${storedDisagree}; ${failing.size} definitions fail to encode; ${disabled} semicolons inside disabled code (masked)`);
for (const [k, n] of [...parents].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(6), k);
