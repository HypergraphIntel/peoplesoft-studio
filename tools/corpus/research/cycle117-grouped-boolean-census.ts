/*
 * Cycle 117: parenthesized (grouping) expressions whose content is a
 * comparison or a boolean expression, and the grammar the encoder
 * currently chooses for them (research only).
 *
 * The encoder reaches a grouping `(` on one of two paths:
 *
 *   booleanUnary   -- an operand of If / While / Until (booleanExpression),
 *                     And / Or / Not, a group nested in such a group, or
 *                     an Evaluate `When (...)` selector, or a `Local
 *                     boolean &b = (...)` initializer: always
 *                     parenthesized(booleanExpression), with no postfix
 *                     chain after the group;
 *   primary        -- every value-expression position (Return, assignment
 *                     right side, call / method argument, comparison right
 *                     side, arithmetic operand): five source-shape regexes
 *                     choose booleanExpression, otherwise expression().
 *
 * expression() parses only arithmetic over cast primaries, so a group
 * routed to it that holds a top-level comparison, And / Or or a leading
 * Not stops at that operator with "expected )".
 *
 * For every grouping `(` in code context (a `(` not directly after a name,
 * `)` or `]` -- those are call / index parentheses) the tool records the
 * outer context, the path, the regex decision, the first top-level
 * operator, the left / right operand of the first comparison, and the
 * nesting depth of grouping parentheses. MISROUTED marks a group on the
 * primary path whose regex decision is expression() although it holds a
 * top-level comparison / And / Or / leading Not. Per definition, the
 * harness taxonomy's first failure (`--taxonomy`) is joined: for ordinary
 * programs the failing offset is checked against the misrouted group.
 *
 * Usage: npx tsx tools/corpus/research/cycle117-grouped-boolean-census.ts --taxonomy t.json <out.jsonl>
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

/** The encoder's current regex decision for a group at `source.slice(at)` reached through primary(). */
function primaryRegexChoosesBoolean(tail: string): boolean {
  return /^\(\s*Not\b/i.test(tail) ||
    /^\(\s*&[A-Za-z0-9_]+#?(?:\s*\([^()]*\))?(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*\s*(?:<>|<=|>=|=|<|>)/.test(tail) ||
    /^\(\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*\s*(?:\([^()]*\))?\s*(?:<>|<=|>=|=|<|>)/.test(tail) ||
    /^\(\s*%[A-Za-z_][A-Za-z0-9_]*\s*(?:<>|<=|>=|=|<|>)/.test(tail) ||
    /^\(\s*&(?:[A-Za-z_][A-Za-z0-9_]*|\d+)(?:\s*\([^()]*\))?(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*\s*(?:And|Or)\b/i.test(tail);
}

interface Scan { close: number; operators: Array<{ at: number; op: string }>; innerGroups: number; }

/** Top-level operators of the group opened at `open` and its matching `)`. */
function scanGroup(source: string, ctx: Uint8Array, open: number): Scan | undefined {
  let depth = 0;
  const operators: Array<{ at: number; op: string }> = [];
  let innerGroups = 0;
  for (let i = open; i < source.length; i++) {
    if (ctx[i] !== 0) continue;
    const c = source[i];
    if (c === '(') { depth++; if (depth === 2 && isGrouping(source, ctx, i)) innerGroups++; continue; }
    if (c === ')') { if (--depth === 0) return { close: i, operators, innerGroups }; continue; }
    if (c === ';') return undefined;
    if (depth !== 1) continue;
    const two = source.slice(i, i + 2);
    if (['<>', '<=', '>='].includes(two)) { operators.push({ at: i, op: two }); i++; continue; }
    if ('=<>'.includes(c)) { operators.push({ at: i, op: c }); continue; }
    const word = /^(And|Or|Not)\b/i.exec(source.slice(i, i + 4));
    if (word && !/[A-Za-z0-9_&%.#]/.test(source[i - 1] ?? '')) { operators.push({ at: i, op: word[1][0].toUpperCase() + word[1].slice(1).toLowerCase() }); i += word[1].length - 1; }
  }
  return undefined;
}

/** Previous significant code character / word before `at`. */
function previousToken(source: string, ctx: Uint8Array, at: number): { text: string; at: number } {
  let i = at - 1;
  while (i >= 0 && (ctx[i] === 2 || ctx[i] === 3 || ctx[i] === 5 || /\s/.test(source[i]))) i--;
  if (i < 0) return { text: '', at: -1 };
  if (ctx[i] === 1) return { text: '"', at: i };
  if (/[A-Za-z0-9_&%#\-]/.test(source[i])) {
    let s = i;
    while (s > 0 && /[A-Za-z0-9_&%#\-]/.test(source[s - 1])) s--;
    return { text: source.slice(s, i + 1), at: s };
  }
  const two = source.slice(i - 1, i + 1);
  if (['<>', '<=', '>='].includes(two)) return { text: two, at: i - 1 };
  return { text: source[i], at: i };
}

function isGrouping(source: string, ctx: Uint8Array, at: number): boolean {
  const p = previousToken(source, ctx, at);
  if (p.text === ')' || p.text === ']' || p.text === '"') return false;
  if (/^[A-Za-z_%&#][A-Za-z0-9_#\-]*$/.test(p.text) && !/^(If|While|Until|And|Or|Not|Return|When|Then|Else|Do|To|Step|Error|Warning|throw|create|Evaluate)$/i.test(p.text)) return false;
  return true;
}

function outerContext(source: string, ctx: Uint8Array, at: number): string {
  const p = previousToken(source, ctx, at);
  const t = p.text;
  if (/^(If|While|Until|And|Or|Not|Return|When|Evaluate|Error|Warning|To|Step)$/i.test(t)) return t[0].toUpperCase() + t.slice(1).toLowerCase();
  if (t === ',') return 'argument';
  if (t === '(') return isGrouping(source, ctx, p.at) ? 'nested-group' : 'argument';
  if (t === '=') {
    // assignment when `=` follows a statement-start target; otherwise a comparison
    let s = p.at - 1;
    while (s >= 0 && !(ctx[s] === 0 && /[;\n]/.test(source[s]))) s--;
    const target = source.slice(s + 1, p.at).trim();
    // `Local boolean &b = (...)` parses its group with booleanExpression (declaration path)
    if (/^Local\s+boolean\s+&\w+#?$/i.test(target)) return 'Local-boolean';
    if (/^(Local\s+\S+\s+)?[&%A-Za-z_][\w.&%#]*(\s*\([^()]*\))?(\s*\.\s*\w+(\s*\([^()]*\))?)*(\s*\[[^\]]*\])?$/i.test(target)) return 'assignment';
    return 'comparison-right';
  }
  if (['<>', '<=', '>=', '<', '>'].includes(t)) return 'comparison-right';
  if (['+', '-', '*', '/', '|'].includes(t)) return 'arithmetic';
  if (t === '[') return 'index';
  return `other:${t}`;
}

function operandKind(text: string): string {
  const s = text.trim();
  if (s === '') return 'empty';
  if (/^\(/.test(s)) return 'nested-group';
  if (/^"[^]*"$|^\d+(\.\d+)?$/.test(s)) return 'literal';
  if (/^(True|False)$/i.test(s)) return 'boolean-literal';
  if (/^Null$/i.test(s)) return 'null';
  if (/^%This\b/i.test(s)) return /\)$/.test(s) ? '%This-method-result' : /^%This\s*\./i.test(s) ? '%This-property-chain' : '%This';
  if (/^%Super\b/i.test(s)) return '%Super-chain';
  if (/^%[A-Za-z_]\w*$/.test(s)) return 'system-variable';
  if (/^&\w+#?$/.test(s)) return 'variable';
  if (/^&\w+#?\s*\[/.test(s)) return 'array-element';
  if (/^&\w+#?.*\bGetRow\s*\(/i.test(s) || /^GetRow\s*\(/i.test(s) || /^GetRecord\s*\(/i.test(s)) return 'GetRow/GetRecord-chain';
  if (/^&\w+#?\s*\(/.test(s)) return 'indexed-variable-chain';
  if (/^&\w+#?\s*\./.test(s)) return /\)$/.test(s) ? 'method-result' : 'property-chain';
  if (/^[A-Za-z_]\w*\s*\(/.test(s)) return /^[A-Za-z_]\w*\s*\([^]*\)$/.test(s) && !/\)\s*\./.test(s) ? 'function-result' : 'function-result-chain';
  if (/^Record\s*\./i.test(s)) return 'Record.X';
  if (/^[A-Za-z_]\w*\s*\.\s*[A-Za-z_]\w*/.test(s)) return 'Record.Field';
  if (/^[A-Za-z_]\w*$/.test(s)) return 'bare-name';
  return 'other';
}

let taxonomyPath: string | undefined;
const args = process.argv.slice(2);
if (args[0] === '--taxonomy') { taxonomyPath = args[1]; args.splice(0, 2); }
const taxonomy = new Map<number, any>();
if (taxonomyPath) for (const row of JSON.parse(fs.readFileSync(taxonomyPath, 'utf8')).rows) taxonomy.set(row.definitionId, row);

const db = openSnapshotDatabase();
const out = fs.openSync(args[0], 'w');
const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const misroutedBy = { context: new Map<string, number>(), op: new Map<string, number>(), shape: new Map<string, number>(), left: new Map<string, number>(), right: new Map<string, number>(), depth: new Map<string, number>() };
const controlsBy = { context: new Map<string, number>(), left: new Map<string, number>(), op: new Map<string, number>() };
const misroutedDefs = new Set<number>(), controlDefs = new Set<number>();
let groups = 0, booleanGroups = 0;
const firstFailure = { expectedParen: new Set<number>(), explained: new Set<number>(), appClass: new Set<number>() };
for (const def of listSnapshotDefinitions(db) as any[]) {
  const source = String(def.sourceText ?? '');
  if (!source.includes('(')) continue;
  const ctx = lexicalContexts(source);
  const app = def.objectid1 === 104;
  const row = taxonomy.get(def.definitionId);
  const failure = /source offset (\d+): expected \)$/.exec(row?.errorMessage ?? '');
  if (failure) firstFailure.expectedParen.add(def.definitionId);
  const depthAt = new Map<number, number>();
  for (let at = source.indexOf('('); at >= 0; at = source.indexOf('(', at + 1)) {
    if (ctx[at] !== 0 || !isGrouping(source, ctx, at)) continue;
    const scan = scanGroup(source, ctx, at);
    if (scan === undefined) continue;
    groups++;
    const context = outerContext(source, ctx, at);
    // grouping depth: enclosing grouping parens
    let depth = 1;
    for (const [open, close] of depthAt) if (open < at && close > at) depth++;
    depthAt.set(at, scan.close);
    if (scan.operators.length === 0) continue;
    // When's selector group is parenthesized(booleanExpression) directly
    const viaBooleanUnary = ['If', 'While', 'Until', 'And', 'Or', 'Not', 'When', 'nested-group', 'Local-boolean'].includes(context);
    const regexBoolean = primaryRegexChoosesBoolean(source.slice(at));
    const comparison = scan.operators.find(o => !['And', 'Or', 'Not'].includes(o.op));
    const first = scan.operators[0];
    const logical = scan.operators.filter(o => ['And', 'Or'].includes(o.op)).map(o => o.op);
    const leadingNot = /^\(\s*Not\b/i.test(source.slice(at));
    const shape = `${leadingNot ? 'Not ' : ''}${comparison ? 'comparison' : 'value'}${logical.length ? ' ' + [...new Set(logical)].join('/') + ' ...' : ''}`;
    // left / right operands of the first top-level comparison
    const opStart = comparison?.at ?? first.at;
    const segmentStart = (() => { const before = scan.operators.filter(o => ['And', 'Or', 'Not'].includes(o.op) && o.at < opStart).pop(); return before ? before.at + before.op.length : at + 1; })();
    const left = comparison ? source.slice(segmentStart, comparison.at) : '';
    const rightEnd = scan.operators.find(o => o.at > opStart && ['And', 'Or'].includes(o.op))?.at ?? scan.close;
    const right = comparison ? source.slice(comparison.at + comparison.op.length, rightEnd) : '';
    booleanGroups++;
    const misrouted = !viaBooleanUnary && !regexBoolean;
    const record = {
      id: def.definitionId, app, offset: at, line: source.slice(0, at).split('\n').length, context,
      path: viaBooleanUnary ? 'booleanUnary' : regexBoolean ? 'primary:regex-boolean' : 'primary:expression',
      misrouted, firstOperator: first.op, shape, left: left.trim().replace(/\s+/g, ' ').slice(0, 120), leftKind: operandKind(left),
      right: right.trim().replace(/\s+/g, ' ').slice(0, 120), rightKind: comparison ? operandKind(right) : '', depth,
      text: source.slice(at, scan.close + 1).replace(/\s+/g, ' ').slice(0, 240)
    };
    fs.writeSync(out, JSON.stringify(record) + '\n');
    if (misrouted) {
      misroutedDefs.add(def.definitionId);
      count(misroutedBy.context, context); count(misroutedBy.op, first.op); count(misroutedBy.shape, shape);
      count(misroutedBy.left, record.leftKind); if (comparison) count(misroutedBy.right, record.rightKind); count(misroutedBy.depth, String(depth));
      if (failure && !app && Number(failure[1]) > at && Number(failure[1]) <= scan.close) firstFailure.explained.add(def.definitionId);
      if (failure && app) firstFailure.appClass.add(def.definitionId);
    } else if (!viaBooleanUnary) {
      controlDefs.add(def.definitionId);
      count(controlsBy.context, context); count(controlsBy.left, record.leftKind); count(controlsBy.op, first.op);
    }
  }
}
fs.closeSync(out);
const show = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join('\n    ');
console.log(`${groups} grouping parentheses in code context; ${booleanGroups} hold a top-level comparison / And / Or / Not`);
console.log(`MISROUTED (primary path, regex chooses expression()): ${[...misroutedBy.op.values()].reduce((a, b) => a + b, 0)} groups in ${misroutedDefs.size} definitions`);
console.log(`  outer context:\n    ${show(misroutedBy.context)}`);
console.log(`  first top-level operator:\n    ${show(misroutedBy.op)}`);
console.log(`  shape:\n    ${show(misroutedBy.shape)}`);
console.log(`  left operand of the first comparison:\n    ${show(misroutedBy.left)}`);
console.log(`  right operand:\n    ${show(misroutedBy.right)}`);
console.log(`  grouping depth:\n    ${show(misroutedBy.depth)}`);
console.log(`controls (primary path, regex chooses booleanExpression): ${[...controlsBy.op.values()].reduce((a, b) => a + b, 0)} groups in ${controlDefs.size} definitions`);
console.log(`  outer context:\n    ${show(controlsBy.context)}`);
console.log(`  left operand:\n    ${show(controlsBy.left)}`);
console.log(`  first operator:\n    ${show(controlsBy.op)}`);
if (taxonomyPath) {
  const unexplainedOrdinary = [...firstFailure.expectedParen].filter(id => !firstFailure.explained.has(id) && !firstFailure.appClass.has(id));
  console.log(`first failure "expected )": ${firstFailure.expectedParen.size} definitions; ordinary with the failing offset inside a misrouted group ${firstFailure.explained.size}; App Class with a misrouted group ${firstFailure.appClass.size}; neither ${unexplainedOrdinary.length}: ${unexplainedOrdinary.join(', ')}`);
}
