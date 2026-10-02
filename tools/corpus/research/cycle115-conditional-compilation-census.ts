/*
 * Cycle 115: PeopleCode conditional compilation (`#If ... #Then ... #Else
 * ... #End-If`) in the local snapshot, against stored PSPCMPROG (research
 * only).
 *
 * Source side: a lexical scan (strings, block comments, `<* *>` disabled
 * code, `/+ +/` signature comments and REM statements skipped) finds every
 * directive token in code context and groups `#If` / `#Then` / `#Else` /
 * `#End-If` into blocks (nesting depth recorded). Per block: offset, line,
 * program kind, the condition text, `#Else` presence, `;` after `#End-If`,
 * text after `#Then` on its line.
 *
 * Stored side: the decoded 0x75 (`#If <condition>`), 0x76 (`#Then`), 0x77
 * (`#Else`) and 0x78 (`#End-If`) records. A branch is LIVE when its keyword
 * record is the bare keyword (its code is compiled after it) and DEAD when
 * the record carries the keyword plus the branch's source text. Per block:
 * the stored condition text vs source, live / dead per branch, and whether
 * the dead text equals the source from the keyword up to the last newline
 * before the next directive line.
 *
 * Release inference: every candidate Tools release (8.50 .. 8.65, patch
 * none / 0 .. 30) is tested against every block's outcome (condition true
 * <=> `#Then` branch live) under numeric dotted comparison at the literal's
 * precision; the consistent candidates are reported.
 *
 * Usage: npx tsx tools/corpus/research/cycle115-conditional-compilation-census.ts <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

/** 0 code, 1 string, 2 block comment, 3 disabled code, 4 REM, 5 signature comment */
function lexicalContexts(source: string): Uint8Array {
  const n = source.length;
  const ctx = new Uint8Array(n);
  let i = 0;
  let atStatementStart = true;
  while (i < n) {
    const c = source[i];
    if (c === '"') {
      const s = i;
      i++;
      while (i < n) { if (source[i] === '"') { if (source[i + 1] === '"') { i += 2; continue; } i++; break; } i++; }
      ctx.fill(1, s, i);
      atStatementStart = false;
      continue;
    }
    const span = (open: string, close: string, kind: number): boolean => {
      if (!source.startsWith(open, i)) return false;
      const e = source.indexOf(close, i + 2);
      const end = e < 0 ? n : e + 2;
      ctx.fill(kind, i, end);
      i = end;
      return true;
    };
    if (span('/*', '*/', 2) || span('<*', '*>', 3) || span('/+', '+/', 5)) continue;
    if (atStatementStart && /^rem\b/i.test(source.slice(i, i + 4)) && (i === 0 || !/[A-Za-z0-9_&%#$]/.test(source[i - 1]))) {
      const e = source.indexOf(';', i);
      const end = e < 0 ? n : e + 1;
      ctx.fill(4, i, end);
      i = end;
      continue;
    }
    if (c === ';') { atStatementStart = true; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    const m = /^[A-Za-z_#][A-Za-z0-9_\-#]*/.exec(source.slice(i, i + 40));
    if (m) {
      atStatementStart = ['then', 'else', 'repeat', 'try', '#then', '#else', '#end-if'].includes(m[0].toLowerCase());
      i += m[0].length;
      continue;
    }
    atStatementStart = false;
    i++;
  }
  return ctx;
}

function compareVersions(release: number[], literal: number[]): number {
  for (let k = 0; k < literal.length; k++) {
    const a = release[k] ?? 0, b = literal[k];
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function evaluate(condition: string, release: number[]): boolean | undefined {
  const tokens = condition.replace(/^#If\b/i, '').match(/#\w+|"[^"]*"|>=|<=|<>|&&|\|\||=|<|>|\S+/g) ?? [];
  const disjuncts: boolean[] = [];
  let conjunct = true;
  for (let t = 0; t < tokens.length;) {
    if (!/^#toolsrel$/i.test(tokens[t])) return undefined;
    const op = tokens[t + 1], lit = tokens[t + 2];
    if (!/^"[\d.]+"$/.test(lit ?? '')) return undefined;
    const c = compareVersions(release, lit.slice(1, -1).split('.').map(Number));
    const value = op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : op === '=' ? c === 0 : op === '<>' ? c !== 0 : undefined;
    if (value === undefined) return undefined;
    conjunct = conjunct && value;
    t += 3;
    if (tokens[t] === '&&') { t++; continue; }
    disjuncts.push(conjunct);
    conjunct = true;
    if (tokens[t] === '||') { t++; continue; }
    if (t < tokens.length) return undefined;
  }
  return disjuncts.some(Boolean);
}

const db = openSnapshotDatabase();
const out = fs.openSync(process.argv[2], 'w');
const blocks: Array<{ id: number; condition: string; thenLive: boolean }> = [];
let definitions = 0, ordinary = 0, app = 0, withElse = 0, maxDepth = 0, deadTexts = 0, deadTextsExact = 0, conditionsExact = 0;
const nonCode = new Map<string, number>();
for (const def of listSnapshotDefinitions(db) as any[]) {
  const source = String(def.sourceText ?? '');
  if (!source.includes('#If')) continue;
  const ctx = lexicalContexts(source);
  for (const m of source.matchAll(/#If\b/g)) {
    if (ctx[m.index!] !== 0) {
      const k = ['code', 'string', 'comment', 'disabled', 'rem', 'signature'][ctx[m.index!]];
      nonCode.set(k, (nonCode.get(k) ?? 0) + 1);
    }
  }
  const directives = [...source.matchAll(/#(If|Then|Else|End-If)\b/g)].filter(m => ctx[m.index!] === 0);
  if (directives.length === 0) continue;
  definitions++;
  def.objectid1 === 104 ? app++ : ordinary++;
  const names = new NameTable();
  for (const row of def.names) {
    const rec = String(row.recname ?? '').trim(), ref = String(row.refname ?? '').trim();
    names.add(Number(row.namenum), rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  const stored = decodeProgram(def.storedProgram, names, { mode: 'auto', isApplicationClass: def.objectid1 === 104 } as any).tokens
    .filter((t: any) => t.opcode >= 0x75 && t.opcode <= 0x78);
  const sourceBlocks: any[] = [];
  const stack: any[] = [];
  for (const m of directives) {
    if (m[1] === 'If') { stack.push({ ifAt: m.index!, depth: stack.length + 1 }); maxDepth = Math.max(maxDepth, stack.length); }
    else if (m[1] === 'Then') stack[stack.length - 1].thenAt = m.index!;
    else if (m[1] === 'Else') stack[stack.length - 1].elseAt = m.index!;
    else { const b = stack.pop(); b.endAt = m.index!; sourceBlocks.push(b); }
  }
  const lastNewlineBefore = (at: number) => source.lastIndexOf('\n', at - 1);
  let s = 0;
  for (const b of sourceBlocks) {
    const condition = source.slice(b.ifAt, b.thenAt).replace(/\s+$/, '');
    const cond = stored[s++], then = stored[s++];
    const els = b.elseAt !== undefined ? stored[s++] : undefined;
    s++; // #End-If
    const thenLive = then?.text === '#Then';
    const elseLive = els === undefined ? undefined : els.text === '#Else';
    const deadThen = thenLive ? undefined : source.slice(b.thenAt, lastNewlineBefore(b.elseAt ?? b.endAt));
    const deadElse = b.elseAt === undefined || elseLive ? undefined : source.slice(b.elseAt, lastNewlineBefore(b.endAt));
    for (const [dead, record] of [[deadThen, then], [deadElse, els]] as const) {
      if (dead === undefined) continue;
      deadTexts++;
      if (record?.text === dead) deadTextsExact++;
    }
    if (cond?.text === condition) conditionsExact++;
    if (b.elseAt !== undefined) withElse++;
    blocks.push({ id: def.definitionId, condition, thenLive });
    fs.writeSync(out, JSON.stringify({
      id: def.definitionId, app: def.objectid1 === 104, offset: b.ifAt,
      line: source.slice(0, b.ifAt).split('\n').length, depth: b.depth, condition,
      storedCondition: cond?.text, hasElse: b.elseAt !== undefined, thenLive, elseLive,
      endIfSemicolon: source[b.endAt + 7] === ';',
      afterThen: source.slice(b.thenAt + 5, source.indexOf('\n', b.thenAt)).trim(),
      deadThenExact: deadThen === undefined ? undefined : then?.text === deadThen,
      deadElseExact: deadElse === undefined ? undefined : els?.text === deadElse,
      storedLength: def.storedProgram.length
    }) + '\n');
  }
}
fs.closeSync(out);
const candidates: string[] = [];
for (let minor = 50; minor <= 65; minor++) {
  for (const patch of [undefined, ...Array.from({ length: 31 }, (_, k) => k)]) {
    const release = patch === undefined ? [8, minor] : [8, minor, patch];
    if (blocks.every(b => evaluate(b.condition, release) === b.thenLive)) candidates.push(release.join('.'));
  }
}
console.log(`${blocks.length} blocks in ${definitions} definitions (${ordinary} ordinary / ${app} App Class); ${withElse} with #Else; max nesting depth ${maxDepth}`);
console.log(`stored condition text equals source (trimmed) in ${conditionsExact}; dead branch text equals source up to the last newline before the next directive in ${deadTextsExact} of ${deadTexts}`);
console.log(`#If outside code context: ${[...nonCode].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
console.log(`releases consistent with every block outcome: ${candidates.length ? `${candidates[0]} .. ${candidates[candidates.length - 1]} (${candidates.length})` : 'none'}`);
