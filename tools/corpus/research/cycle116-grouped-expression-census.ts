/*
 * Cycle 116: statements whose first token is `(` -- a parenthesized
 * (grouped) expression at statement position, e.g.
 * `(create PT_PAGE_UTILS:Utils()).SetGridAnnouncement(...)` -- in the
 * local snapshot (research only).
 *
 * A lexical scan (strings, block comments, `<* *>` disabled code, `/+ +/`
 * signature comments and REM statements skipped) finds every `(` in code
 * context whose previous significant token ends a statement or opens a
 * statement list: `;`, program start, Then / Else / Do / Repeat / try /
 * When-Other / a directive (`#Then`, `#Else`, `#End-If`), a `method <name>`
 * header line, a `catch <Class> &e` clause, or a `When <value>` / `For ...`
 * / `While ...` line.
 * Any other `(` that starts its line, and any candidate whose group is
 * followed by something other than a postfix step or `;`, is counted
 * separately as a `continuation` (an expression continued from the
 * previous line).
 *
 * Per occurrence: the statement up to its `;` (or the end of its line
 * when no `;` follows on the same nesting level), the grouped (inner)
 * expression and its kind, the nesting depth of leading parentheses, the
 * postfix chain after the closing `)`, and the shape (the statement with
 * names and arguments abstracted).
 *
 * Usage: npx tsx tools/corpus/research/cycle116-grouped-expression-census.ts <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';

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
      atStatementStart = ['then', 'else', 'repeat', 'try', 'do', 'when-other', '#then', '#else', '#end-if'].includes(m[0].toLowerCase());
      i += m[0].length;
      continue;
    }
    atStatementStart = false;
    i++;
  }
  return ctx;
}

/** Index just past the `)` matching the `(` at `open` (code context only). */
function matching(source: string, ctx: Uint8Array, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (ctx[i] !== 0) continue;
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Significant code text before `at`: comments etc. dropped, whitespace collapsed. */
function codeBefore(source: string, ctx: Uint8Array, at: number, max = 200): string {
  let out = '';
  for (let i = at - 1; i >= 0 && out.length < max; i--) {
    if (ctx[i] === 0 || ctx[i] === 1) out = source[i] + out;
    else if (ctx[i] !== 1 && !out.startsWith(' ')) out = ' ' + out;
  }
  return out.replace(/\s+/g, ' ');
}

function startKind(before: string): string | undefined {
  const t = before.trimEnd();
  if (t === '') return 'program-start';
  if (t.endsWith(';')) return 'semicolon';
  const lastWord = /([A-Za-z_#][A-Za-z0-9_\-#]*)$/.exec(t)?.[1]?.toLowerCase();
  if (lastWord && ['then', 'else', 'repeat', 'try', 'do', 'when-other', '#then', '#else', '#end-if'].includes(lastWord)) return lastWord;
  if (/(^|\s)method\s+[A-Za-z_][A-Za-z0-9_]*$/i.test(t)) return 'method-header';
  if (/(^|\s)catch\s+[A-Za-z_%][A-Za-z0-9_:]*\s+&[A-Za-z0-9_]+$/i.test(t)) return 'catch';
  return undefined;
}

function innerKind(inner: string): string {
  const s = inner.trim();
  if (/^\(/.test(s) && matchingText(s) === s.length) return 'grouped';
  if (/\sAs\s+[A-Za-z_%][A-Za-z0-9_:]*$/i.test(s)) return 'cast';
  if (/^create\b/i.test(s)) return /^create\s+[A-Za-z_%][A-Za-z0-9_:]*\s*\([^]*\)$/i.test(s) ? 'create' : 'create-other';
  if (/^&[A-Za-z0-9_]+$/.test(s)) return 'variable';
  if (/^"[^]*"$|^\d+(\.\d+)?$|^(True|False)$/i.test(s)) return 'literal';
  if (/(<>|<=|>=|[=<>+\-*/|]|\bAnd\b|\bOr\b)/i.test(s.replace(/"[^"]*"/g, '""').replace(/\([^()]*\)/g, '()'))) return 'binary';
  if (/^(&|%)[A-Za-z0-9_]+(\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*(\([^()]*\))?)+$/.test(s)) return 'method-call';
  if (/^%?[A-Za-z_][A-Za-z0-9_]*\s*\([^]*\)$/.test(s)) return 'function-call';
  if (/^(&|%)[A-Za-z0-9_]+(\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)+$/.test(s)) return 'property';
  return 'other';
}

function matchingText(s: string): number {
  let depth = 0, inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') inString = !inString;
    if (inString) continue;
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

const abstract = (s: string) => s
  .replace(/"[^"]*"/g, '"s"')
  .replace(/\b[A-Za-z_][A-Za-z0-9_]*(\s*:\s*[A-Za-z_][A-Za-z0-9_]*)+/g, 'P:C')
  .replace(/&[A-Za-z0-9_]+/g, '&v')
  .replace(/\s+/g, ' ');

const db = openSnapshotDatabase();
const out = fs.openSync(process.argv[2], 'w');
const counts = { occurrences: 0, continuation: 0, definitions: new Set<number>(), ordinary: new Set<number>(), app: new Set<number>() };
const byStart = new Map<string, number>();
const byInner = new Map<string, number>();
const byShape = new Map<string, number>();
const byDepth = new Map<number, number>();
const nonCode = new Map<string, number>();
for (const def of listSnapshotDefinitions(db) as any[]) {
  const source = String(def.sourceText ?? '');
  if (!source.includes('(')) continue;
  const ctx = lexicalContexts(source);
  const app = def.objectid1 === 104;
  for (let at = source.indexOf('('); at >= 0; at = source.indexOf('(', at + 1)) {
    const lineStart = source.lastIndexOf('\n', at - 1) + 1;
    const firstOnLine = /^\s*$/.test(source.slice(lineStart, at));
    const before = codeBefore(source, ctx, at);
    let kind = startKind(before);
    // `method Name(...)` in a class declaration is a signature, not a statement.
    if ((kind === 'method-header' || kind === 'catch') && !firstOnLine) kind = undefined;
    if (kind === undefined && firstOnLine) {
      const previousLine = source.slice(source.lastIndexOf('\n', lineStart - 2) + 1, lineStart);
      if (/^\s*When\b/i.test(previousLine) && !/\bThen\s*$/i.test(previousLine)) kind = 'when';
      else if (/^\s*For\b/i.test(previousLine)) kind = 'for';
      else if (/^\s*While\b/i.test(previousLine)) kind = 'while';
      // a previous line ending in an operator continues into this one (5529 `While (...) And <newline> (...)`)
      if (/(\bAnd|\bOr|\bNot|[=<>+\-*/|,(])$/i.test(before.trimEnd())) kind = undefined;
    }
    if (kind === undefined && !firstOnLine) continue;
    if (ctx[at] !== 0) {
      if (kind !== undefined && /^\(\s*create\b/i.test(source.slice(at, at + 20))) {
        const k = ['code', 'string', 'comment', 'disabled', 'rem', 'signature'][ctx[at]];
        nonCode.set(k, (nonCode.get(k) ?? 0) + 1);
      }
      continue;
    }
    if (kind === undefined) { counts.continuation++; continue; }
    const close = matching(source, ctx, at);
    if (close < 0) continue;
    let depth = 0;
    for (let i = at; source[i] === '(' || /\s/.test(source[i]); i++) if (source[i] === '(') depth++;
    let end = close;
    let level = 0;
    while (end < source.length) {
      if (ctx[end] === 0) {
        if (source[end] === '(') level++;
        else if (source[end] === ')') level--;
        else if (source[end] === ';' && level === 0) break;
        else if (level === 0 && /^\s*\n\s*(End-|Else\b|When\b|end-method\b)/i.test(source.slice(end, end + 30))) break;
      }
      end++;
    }
    const statement = source.slice(at, Math.min(end + 1, source.length));
    const inner = source.slice(at + 1, close - 1);
    const postfix = source.slice(close, end).trim();
    /*
     * A statement continues the group with a postfix step (`.`, `[`) or
     * ends at its `;`; anything else (`Then`, `And`, an operator, `)`) means
     * the `(` continues an expression -- a multi-line `If` / `When`
     * condition, or one interrupted by a mid-expression `rem ...;`
     * (28753).
     */
    if (postfix !== '' && !/^[.[]/.test(postfix)) { counts.continuation++; continue; }
    const shape = abstract(`(${innerKind(inner)})${postfix.replace(/\([^]*\)$/, '(...)')}${source[end] === ';' ? ';' : ''}`);
    counts.occurrences++;
    counts.definitions.add(def.definitionId);
    (app ? counts.app : counts.ordinary).add(def.definitionId);
    byStart.set(kind, (byStart.get(kind) ?? 0) + 1);
    byInner.set(innerKind(inner), (byInner.get(innerKind(inner)) ?? 0) + 1);
    byShape.set(shape, (byShape.get(shape) ?? 0) + 1);
    byDepth.set(depth, (byDepth.get(depth) ?? 0) + 1);
    fs.writeSync(out, JSON.stringify({
      id: def.definitionId, app, offset: at, line: source.slice(0, at).split('\n').length, start: kind,
      depth, innerKind: innerKind(inner), inner: inner.trim(), postfix, terminated: source[end] === ';',
      shape, statement: statement.replace(/\s+/g, ' ').slice(0, 300)
    }) + '\n');
  }
}
fs.closeSync(out);
const show = (m: Map<unknown, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join('\n    ');
console.log(`${counts.occurrences} grouped-expression statements in ${counts.definitions.size} definitions (${counts.ordinary.size} ordinary / ${counts.app.size} App Class); ${counts.continuation} line-leading ( are expression continuations`);
console.log(`statement start:\n    ${show(byStart)}`);
console.log(`inner expression:\n    ${show(byInner)}`);
console.log(`leading ( depth:\n    ${show(byDepth)}`);
console.log(`shapes:\n    ${show(byShape)}`);
console.log(`statement-position (create outside code context: ${show(nonCode) || 'none'}`);
