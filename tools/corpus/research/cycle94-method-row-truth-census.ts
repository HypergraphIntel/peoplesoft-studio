/*
 * Cycle 94: per-call ground truth for Application Class method-dependency
 * rows in ordinary programs (research only).
 *
 * For every direct method call `&var.Method(` on a variable whose class the
 * SOURCE itself names (Local / Component / Global declaration, Function
 * parameter, or `&var = create PKG:Class(`), decide from STORED PSPCMNAME
 * whether PeopleTools opened a new PACKAGE row at the call or reused an
 * existing one, and record the features a discriminator could depend on.
 *
 * Truth is positional, not content based. The generated allocation
 * sequence (encoder `referenceTrace`, with source offsets) and the stored
 * rows are aligned on every row that is NOT a PACKAGE row of the receiver
 * class; the call falls into one gap between two aligned anchors, and the
 * stored PACKAGE.<class> rows inside that gap are the rows the call(s) in
 * it opened. A gap is `clean` when no declaration or create of the class
 * lies in it. Stored APPCLASSMETHOD labels are carried as supporting
 * evidence only.
 *
 * Programs with a method call through a property or method result are
 * flagged `external` (UNRESOLVED_EXTERNAL_CLASS_METADATA) and must not be
 * used as evidence.
 *
 * Output: JSON lines, one per call. Summarize with
 * `cycle94-method-row-matrix.py`.
 *
 * With a second path it also writes one record per (class, gap): the ordered
 * declaration / create / call events between two anchors and the stored
 * PACKAGE.<class> rows (with labels) found there.
 *
 * Usage: npx tsx tools/corpus/research/cycle94-method-row-truth-census.ts <calls.jsonl> [<gaps.jsonl>]
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

function ownerOf(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  return { recordName: recordIndex >= 0 ? values[recordIndex] : values[0], fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1] };
}

function generatedKeyOf(g: any): string {
  switch (g.kind) {
    case 'package': return `PACKAGE.${(g.packageName ?? '').toUpperCase()}`;
    case 'scroll': return `SCROLL.${(g.recordName ?? '').toUpperCase()}`;
    case 'record': return `RECORD.${(g.recordName ?? '').toUpperCase()}`;
    case 'field': return `FIELD.${(g.fieldName ?? '').toUpperCase()}`;
    case 'component': return `COMPONENT.${(g.objectName ?? '').toUpperCase()}`;
    default: return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
  }
}

/** Blank out comments and string literals, keeping every offset. */
function clean(source: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/<\*[\s\S]*?\*>/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/"(?:[^"]|"")*"/g, m => '"' + blank(m.slice(1, -1)) + '"')
    .replace(/(^|;)(\s*)rem\b[^;]*;/gim, (m, a, b) => a + b + blank(m.slice(a.length + b.length)));
}

/** Longest common subsequence of two key lists -> matched index pairs. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const table: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) table.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const KEYWORDS = /\b(End-If|End-For|End-While|End-Evaluate|End-Function|end-try|Declare\s+Function|If|For|While|Evaluate|Repeat|Until|try|Function)\b/gi;

interface Scope { fn: number; control: number; tries: number; innermost: string }

const out = fs.openSync(process.argv[2], 'w');
const gapOut = process.argv[3] ? fs.openSync(process.argv[3], 'w') : undefined;
let calls = 0;
for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  if (def.objectid1 === 104) continue;
  const source = String(def.sourceText ?? '');
  if (!/:/.test(source) || !/&[A-Za-z0-9_]+\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(source)) continue;
  const text = clean(source);

  // ---- imports -----------------------------------------------------------
  const named = new Set<string>();
  let wildcard = false;
  for (const m of text.matchAll(/\bimport\s+([A-Za-z0-9_:]+?):(\*|[A-Za-z0-9_]+)\s*;/gi)) {
    if (m[2] === '*') wildcard = true; else named.add(`${m[1]}:${m[2]}`.toLowerCase());
  }

  // ---- scopes by offset ----------------------------------------------------
  const marks: { at: number; scope: Scope }[] = [];
  {
    const stack: string[] = [];
    let fn = 0, functionIndex = 0;
    const snapshot = (at: number) => marks.push({ at, scope: {
      fn: fn > 0 ? functionIndex : 0,
      control: stack.filter(s => s !== 'try').length,
      tries: stack.filter(s => s === 'try').length,
      innermost: stack[stack.length - 1] ?? '-'
    } });
    snapshot(0);
    for (const m of text.matchAll(KEYWORDS)) {
      const before = text[m.index! - 1];
      if (before === '&' || before === '.' || before === ':' || before === '%') continue;
      const word = m[1].toLowerCase().replace(/\s+/g, ' ');
      if (word === 'declare function') continue;
      if (word === 'function') {
        // skip the `Function` of a `Declare Function` already consumed above
        if (/declare\s+$/i.test(text.slice(Math.max(0, m.index! - 12), m.index!))) continue;
        fn++; functionIndex++; stack.length = 0;
      } else if (word === 'end-function') { fn = Math.max(0, fn - 1); stack.length = 0; }
      else if (word.startsWith('end-') || word === 'until') stack.pop();
      else stack.push(word);
      snapshot(m.index! + m[0].length);
    }
  }
  const scopeAt = (offset: number): Scope => {
    let lo = 0, hi = marks.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (marks[mid].at <= offset) lo = mid; else hi = mid - 1; }
    return marks[lo].scope;
  };

  // ---- first executable statement (end of the leading declaration phase) ---
  let firstExecutable = text.length;
  {
    let at = 0;
    for (const statement of text.split(';')) {
      const trimmed = statement.trim();
      const start = at + (statement.length - statement.trimStart().length);
      at += statement.length + 1;
      if (trimmed === '') continue;
      if (/^(import|Component|Global|Declare|Constant|PanelGroup|ComponentLife)\b/i.test(trimmed)) continue;
      if (/^Local\b/i.test(trimmed) && !/=/.test(trimmed)) continue;
      firstExecutable = start;
      break;
    }
  }

  // ---- variables -----------------------------------------------------------
  interface Variable { cls: string; full: string; kind: string; at: number; fn: number }
  const variables: Variable[] = [];
  const byName = new Map<string, Variable[]>();
  const declare = (name: string, v: Variable) => {
    variables.push(v);
    const list = byName.get(name.toLowerCase()) ?? [];
    list.push(v);
    byName.set(name.toLowerCase(), list);
  };
  for (const m of text.matchAll(/\b(Local|Component|Global)\s+((?:array\s+of\s+)*)([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)+)\s+(&[A-Za-z0-9_]+(?:\s*,\s*&[A-Za-z0-9_]+)*)\s*(=\s*create\b|=|;)/gi)) {
    if (m[2]) continue; // arrays: element calls are not direct receiver calls
    const full = m[3].toLowerCase();
    const scope = scopeAt(m.index!);
    const init = m[5].startsWith('=') ? (/create/i.test(m[5]) ? 'init-create' : 'init-other') : 'uninit';
    const phase = m[1].toLowerCase() !== 'local' ? 'decl'
      : scope.fn > 0 ? 'function' : scope.control + scope.tries > 0 ? 'nested' : m.index! < firstExecutable || (m.index! === firstExecutable) ? 'leading' : 'late';
    for (const name of m[4].split(',')) {
      declare(name.trim(), { cls: full.split(':').pop()!.toUpperCase(), full, kind: `${m[1]}/${phase}/${init}`, at: m.index!, fn: scope.fn });
    }
  }
  for (const m of text.matchAll(/(&[A-Za-z0-9_]+)\s+As\s+([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)+)/gi)) {
    const scope = scopeAt(m.index! + m[0].length);
    declare(m[1], { cls: m[2].split(':').pop()!.toUpperCase(), full: m[2].toLowerCase(), kind: 'Parameter', at: m.index!, fn: scope.fn || -1 });
  }
  const creates: { v: string; full: string; cls: string; at: number; end: number }[] = [];
  for (const m of text.matchAll(/(?:(&[A-Za-z0-9_]+)\s*=\s*)?create\s+([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)+)\s*\(/gi)) {
    let depth = 0, end = m.index! + m[0].length - 1;
    for (; end < text.length; end++) { if (text[end] === '(') depth++; else if (text[end] === ')') { depth--; if (depth === 0) break; } }
    creates.push({ v: (m[1] ?? '').toLowerCase(), full: m[2].toLowerCase(), cls: m[2].split(':').pop()!.toUpperCase(), at: m.index!, end });
    if (m[1] && !byName.has(m[1].toLowerCase())) {
      declare(m[1], { cls: m[2].split(':').pop()!.toUpperCase(), full: m[2].toLowerCase(), kind: 'Undeclared/create', at: m.index!, fn: 0 });
    }
  }
  if (variables.length === 0) continue;
  const resolve = (name: string, offset: number): Variable | undefined => {
    const list = byName.get(name.toLowerCase());
    if (!list) return undefined;
    const scope = scopeAt(offset);
    const visible = list.filter(v => v.at <= offset && (v.fn === 0 || v.fn === scope.fn || (v.kind === 'Parameter' && v.fn === -1)));
    const local = visible.filter(v => v.fn !== 0);
    return (local.length ? local : visible).slice(-1)[0];
  };

  // ---- external-metadata flag -----------------------------------------------
  let external = false;
  for (const m of text.matchAll(/(&[A-Za-z0-9_]+)\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*(\((?:[^()]|\([^()]*\))*\)\s*)?\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/g)) {
    if (resolve(m[1], m.index!)) { external = true; break; }
  }

  // ---- generated allocation sequence ------------------------------------------
  const generated: { key: string; at: number }[] = [];
  let exact = false;
  try {
    const artifacts = encodeProgramArtifacts(source, {
      owner: ownerOf(def),
      referenceTrace: (event: any) => { if (event.action === 'ALLOC') generated.push({ key: generatedKeyOf(event.reference), at: event.sourceOffset }); }
    } as any);
    exact = artifacts.program.equals(def.storedProgram);
  } catch { continue; }
  const stored = [...def.names]
    .sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum))
    .slice(1)
    .map((r: any) => ({
      key: `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`,
      method: String(r.appclassmethod ?? '').trim().toUpperCase(),
      namenum: Number(r.namenum)
    }));
  if (stored.length > 900 || generated.length > 900) continue;
  const descriptive = def.names.some((r: any) => String(r.recname ?? '').trim() === 'PACKAGE' && String(r.packageroot ?? '').trim() !== '');

  // ---- calls -------------------------------------------------------------------
  interface Call { at: number; v: string; variable: Variable; method: string }
  const callList: Call[] = [];
  for (const m of text.matchAll(/(&[A-Za-z0-9_]+)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const variable = resolve(m[1], m.index!);
    if (variable) callList.push({ at: m.index!, v: m[1].toLowerCase(), variable, method: m[2].toUpperCase() });
  }
  const seenVarMethod = new Map<string, number>();
  const seenClassMethod = new Map<string, number>();
  const seenVar = new Map<string, number>();
  const seenClass = new Map<string, number>();

  const alignments = new Map<string, { pairs: [number, number][]; sIdx: number[]; gIdx: number[] }>();
  const alignmentFor = (cls: string) => {
    let a = alignments.get(cls);
    if (!a) {
      const key = `PACKAGE.${cls}`;
      const sIdx = stored.map((_, i) => i).filter(i => stored[i].key !== key);
      const gIdx = generated.map((_, i) => i).filter(i => generated[i].key !== key);
      a = { pairs: lcs(sIdx.map(i => stored[i].key), gIdx.map(i => generated[i].key)), sIdx, gIdx };
      alignments.set(cls, a);
    }
    return a;
  };

  const records: any[] = [];
  for (const call of callList) {
    const cls = call.variable.cls;
    const key = `PACKAGE.${cls}`;
    const a = alignmentFor(cls);
    // anchors around the call, in generated allocation order by source offset
    let prev: [number, number] | undefined, next: [number, number] | undefined;
    for (const pair of a.pairs) {
      const g = generated[a.gIdx[pair[1]]];
      if (g.at < call.at) prev = pair; else { next = pair; break; }
    }
    const sFrom = prev ? a.sIdx[prev[0]] + 1 : 0;
    const sTo = next ? a.sIdx[next[0]] : stored.length;
    const gFrom = prev ? a.gIdx[prev[1]] + 1 : 0;
    const gTo = next ? a.gIdx[next[1]] : generated.length;
    const fromAt = prev ? generated[a.gIdx[prev[1]]].at : -1;
    const toAt = next ? generated[a.gIdx[next[1]]].at : text.length;
    const storedRows = stored.slice(sFrom, sTo).filter(r => r.key === key);
    const unmatchedStored = stored.slice(sFrom, sTo).filter(r => r.key !== key).length;
    const unmatchedGenerated = generated.slice(gFrom, gTo).filter(r => r.key !== key).length;
    const otherEvents =
      variables.some(v => v.cls === cls && v.kind !== 'Parameter' && v.kind !== 'Undeclared/create' && v.at > fromAt && v.at < toAt) ||
      creates.some(c => c.cls === cls && c.end > fromAt && c.at < toAt);
    const scope = scopeAt(call.at);
    const before = text.slice(0, call.at).trimEnd();
    const bump = (map: Map<string, number>, k: string) => { const n = (map.get(k) ?? 0) + 1; map.set(k, n); return n; };
    records.push({
      id: def.definitionId, exact, external, descriptive,
      cls, method: call.method, v: call.v, at: call.at,
      varKind: call.variable.kind,
      importMode: named.has(call.variable.full) ? 'named' : wildcard ? 'wildcard' : 'none',
      fn: scope.fn > 0, control: scope.control, tries: scope.tries, innermost: scope.innermost,
      statementLevel: /(;|\bThen|\bElse|^)$/i.test(before) || before.endsWith('End-If') || before === '',
      occVarMethod: bump(seenVarMethod, `${scope.fn}:${call.v}.${call.method}`),
      occClassMethod: bump(seenClassMethod, `${cls}.${call.method}`),
      occVar: bump(seenVar, `${scope.fn}:${call.v}`),
      occClass: bump(seenClass, cls),
      varCreatedBefore: creates.some(c => c.v === call.v && c.at < call.at),
      classCreatedBefore: creates.some(c => c.cls === cls && c.at < call.at),
      gap: `${sFrom}:${sTo}`,
      storedRows: storedRows.length,
      storedLabels: storedRows.map(r => r.method),
      generatedRows: generated.slice(gFrom, gTo).filter(r => r.key === key).length,
      clean: !otherEvents && unmatchedStored === 0 && unmatchedGenerated === 0,
      storedClassRowsBefore: stored.slice(0, sFrom).filter(r => r.key === key).map(r => r.method || '-')
    });
  }
  // ---- gap records: every declaration / create / call of a class between two anchors ----
  if (gapOut !== undefined) {
    const classes = new Set(variables.map(v => v.cls));
    for (const cls of classes) {
      const key = `PACKAGE.${cls}`;
      const a = alignmentFor(cls);
      const full = variables.find(v => v.cls === cls)!.full;
      const events: { at: number; tag: string }[] = [];
      const ctx = (offset: number) => { const sc = scopeAt(offset); return sc.fn > 0 ? 'fn' : sc.control > 0 ? 'ctl' : sc.tries > 0 ? 'try' : 'top'; };
      for (const m of text.matchAll(/\bimport\s+([A-Za-z0-9_:]+?):([A-Za-z0-9_]+)\s*;/gi)) if (`${m[1]}:${m[2]}`.toLowerCase() === full) events.push({ at: m.index!, tag: 'I' });
      for (const v of variables) if (v.cls === cls && v.kind !== 'Parameter' && v.kind !== 'Undeclared/create') events.push({ at: v.at, tag: `D(${v.kind})` });
      for (const c of creates) if (c.cls === cls) {
        const localInit = variables.some(v => v.cls === cls && /init-create/.test(v.kind) && v.at < c.at && c.at - v.at < 200 && !/;/.test(text.slice(v.at, c.at)));
        events.push({ at: c.at, tag: `C(${localInit ? 'localinit' : c.v ? 'assign' : 'inline'}/${ctx(c.at)})` });
      }
      for (const call of callList) if (call.variable.cls === cls) events.push({ at: call.at, tag: `M(${ctx(call.at)}/${call.variable.kind.split('/')[0]})` });
      events.sort((x, y) => x.at - y.at);
      // dedupe D entries of multi-variable declarations at the same offset
      const gaps = new Map<string, { tags: string[]; sFrom: number; sTo: number; gFrom: number; gTo: number }>();
      let lastTagAt = -1;
      for (const e of events) {
        if (e.tag.startsWith('D(') && e.at === lastTagAt) continue;
        lastTagAt = e.at;
        let prev: [number, number] | undefined, next: [number, number] | undefined;
        for (const pair of a.pairs) { const g = generated[a.gIdx[pair[1]]]; if (g.at < e.at) prev = pair; else { next = pair; break; } }
        const sFrom = prev ? a.sIdx[prev[0]] + 1 : 0, sTo = next ? a.sIdx[next[0]] : stored.length;
        const gFrom = prev ? a.gIdx[prev[1]] + 1 : 0, gTo = next ? a.gIdx[next[1]] : generated.length;
        const g = gaps.get(`${sFrom}:${sTo}`) ?? { tags: [], sFrom, sTo, gFrom, gTo };
        g.tags.push(e.tag);
        gaps.set(`${sFrom}:${sTo}`, g);
      }
      let index = 0;
      for (const g of [...gaps.values()].sort((x, y) => x.sFrom - y.sFrom)) {
        const rows = stored.slice(g.sFrom, g.sTo);
        fs.writeSync(gapOut, JSON.stringify({
          id: def.definitionId, exact, external, descriptive, cls, index: index++,
          importMode: named.has(full) ? 'named' : wildcard ? 'wildcard' : 'none',
          events: g.tags,
          stored: rows.filter(r => r.key === key).map(r => r.method || '-'),
          generated: generated.slice(g.gFrom, g.gTo).filter(r => r.key === key).length,
          aligned: rows.every(r => r.key === key) && generated.slice(g.gFrom, g.gTo).every(r => r.key === key),
          importRows: [...named].filter(n => n === full).length
        }) + '\n');
      }
    }
  }

  // calls sharing a gap
  const perGap = new Map<string, number>();
  for (const r of records) perGap.set(`${r.cls}|${r.gap}`, (perGap.get(`${r.cls}|${r.gap}`) ?? 0) + 1);
  for (const r of records) {
    r.callsInGap = perGap.get(`${r.cls}|${r.gap}`);
    fs.writeSync(out, JSON.stringify(r) + '\n');
    calls++;
  }
}
fs.closeSync(out);
console.log(`${calls} calls written`);
