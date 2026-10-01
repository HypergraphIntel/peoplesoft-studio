/*
 * Cycle 108: Application Class method-dependency PACKAGE rows INSIDE
 * Application Class programs -- when a call on a class opens a row, when
 * it reuses one, and what scope bounds the row (research only).
 *
 * Population: every method call in a method / get / set body of every
 * Application Class program (OBJECTID1 104) whose receiver class is known:
 *
 *   source     `&x.M()` on a body Local, a method parameter, a header
 *              instance / property, a Component / Global declaration
 *   self       `%This.M()` (Cycle 82 self row)
 *   super      `%Super.M()`
 *   %Super     `%Super.<property>...M()`
 *   %This      `%This.<property>...M()` (own or inherited property)
 *   typed      `&x.<property>...M()` on a source-typed variable
 *   result     any chain through a method RESULT
 *
 * Property and result steps are typed through the snapshot metadata
 * provider (`snapshotApplicationClassTypeMetadata`); the encoder is run
 * WITHOUT it, so the generated rows are the committed behavior.
 *
 * Truth is positional (Cycle 94 method): stored and generated rows are
 * aligned (LCS) on every row that is NOT a PACKAGE row of the receiver's
 * class; a call falls in one gap between two aligned anchors (generated
 * `referenceTrace` offsets, program-relative since Cycle 108), and the
 * stored PACKAGE.<class> rows inside the gap are the rows that gap's
 * events opened. Stored rows of a class are matched by REFNAME (the leaf);
 * a program where two different classes share a leaf is flagged
 * `ambiguous`. Descriptive stores' PACKAGEROOT / QUALIFYPATH /
 * APPCLASSMETHOD are carried per row.
 *
 * Output: one JSON line per (definition, receiver class) group, with its
 * ordered events -- calls, and the generated rows of the class (`type`:
 * no method name; `method`: a method-dependency row) -- each placed in its
 * gap, and the stored rows of the class per gap. Summarize with
 * `cycle108-app-class-method-row-models.py`.
 *
 * Usage: npx tsx tools/corpus/research/cycle108-app-class-method-row-census.ts <groups.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { listSnapshotApplicationClassDefinitions, snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { canonicalClassKey, type ApplicationClassPath } from '../../../src/peoplecode/applicationClassTypeMetadata';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';

const SCALAR = new Set(['string', 'date', 'any', 'boolean', 'time', 'datetime', 'object', 'integer', 'number', 'exception', 'float']);

/** Blank out comments and string literals, keeping every offset. */
function clean(source: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/<\*[\s\S]*?\*>/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\+[\s\S]*?\+\//g, blank)
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

/** Statement / control scope of every offset of a body. */
function scopeScanner(text: string, start: number, end: number) {
  const marks: { at: number; stmt: number; simple: number; depth: number; innermost: string; path: string }[] = [];
  const stack: { word: string; id: number }[] = [];
  let stmt = 0, simple = 0, nextBlock = 1;
  const push = (at: number) => marks.push({
    at, stmt, simple, depth: stack.length, innermost: stack[stack.length - 1]?.word ?? '-',
    path: stack.map(s => `${s.word}#${s.id}`).join('/')
  });
  push(start);
  const re = /\b(End-If|End-For|End-While|End-Evaluate|end-try|If|For|While|Evaluate|Repeat|Until|try)\b|;/gi;
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < end) {
    const before = text[m.index - 1];
    if (m[0] !== ';' && (before === '&' || before === '.' || before === ':' || before === '%' || before === '-')) continue;
    const word = m[0].toLowerCase();
    if (word === ';') {
      simple++;
      if (stack.length === 0) stmt++;
    } else if (word.startsWith('end-') || word === 'until') {
      stack.pop();
    } else {
      stack.push({ word, id: nextBlock++ });
    }
    push(m.index + m[0].length);
  }
  return (offset: number) => {
    let lo = 0, hi = marks.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (marks[mid].at <= offset) lo = mid; else hi = mid - 1; }
    return marks[lo];
  };
}

/** End of the balanced parenthesized group opening at `open`. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return text.length - 1;
}

const db = openSnapshotDatabase();
const classDefinitions = listSnapshotApplicationClassDefinitions(db);
const provider = snapshotApplicationClassTypeMetadata(db);
const classesByLeaf = new Map<string, ApplicationClassPath[]>();
for (const d of classDefinitions) {
  const leaf = d.path[d.path.length - 1].toLowerCase();
  classesByLeaf.set(leaf, [...(classesByLeaf.get(leaf) ?? []), d.path]);
}
const ownMemberCache = new Map<string, Set<string>>();
const ownMembers = (path: ApplicationClassPath): Set<string> => {
  const key = canonicalClassKey(path);
  let set = ownMemberCache.get(key);
  if (set === undefined) {
    const definition = classDefinitions.find(d => canonicalClassKey(d.path) === key);
    const parsed = definition === undefined ? undefined : parseApplicationClassSource(definition.source);
    set = new Set((parsed?.members ?? []).map(m => (m as { name: string }).name.replace(/^&/, '').toLowerCase())
      .concat((parsed?.statements ?? []).flatMap(s => s.kind === 'instance-statement' ? s.names.map(n => n.replace(/^&/, '').toLowerCase()) : [])));
    ownMemberCache.set(key, set);
  }
  return set;
};

const out = fs.openSync(process.argv[2], 'w');
let programs = 0, groupsWritten = 0, callCount = 0;

for (const def of listSnapshotDefinitions(db) as any[]) {
  if (def.objectid1 !== 104) continue;
  const source = String(def.sourceText ?? '');
  const parsed = parseApplicationClassSource(source);
  if (parsed === undefined) continue;
  programs++;
  const text = clean(source);
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const selfPath = values.slice(0, event < 0 ? values.length : event).filter(Boolean);
  const ownPackage = selfPath.slice(0, -1).map(c => c.toLowerCase()).join(':');

  /* ---- type resolution as written in THIS program ---- */
  const named = new Map<string, ApplicationClassPath>();
  const wildcards: string[] = [];
  for (const m of text.slice(0, parsed.unitStart).matchAll(/\bimport\s+([%A-Za-z0-9_:\s]+?)\s*;/gi)) {
    const c = m[1].replace(/\s+/g, '').split(':');
    if (c[c.length - 1] === '*') wildcards.push(c.slice(0, -1).join(':').toLowerCase());
    else named.set(c[c.length - 1].toLowerCase(), c);
  }
  const resolve = (written: string | undefined): ApplicationClassPath | undefined => {
    if (written === undefined) return undefined;
    const t = written.replace(/\s+/g, '');
    if (t === '' || /^array/i.test(t) || SCALAR.has(t.toLowerCase())) return undefined;
    if (t.includes(':')) return t.split(':');
    if (isBuiltinObjectTypeName(t)) return undefined;
    const imported = named.get(t.toLowerCase());
    if (imported !== undefined) return imported;
    const candidates = (classesByLeaf.get(t.toLowerCase()) ?? [])
      .filter(p => { const pkg = p.slice(0, -1).join(':').toLowerCase(); return pkg === ownPackage || wildcards.includes(pkg); });
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  const superPath = resolve(parsed.extendsType);

  /* ---- program-level variables: header instances / properties, Component / Global ---- */
  const programVariables = new Map<string, { path: ApplicationClassPath; base: string }>();
  for (const member of parsed.members) {
    if (member.kind !== 'property' && member.kind !== 'instance') continue;
    const path = resolve(member.type);
    if (path) programVariables.set('&' + member.name.replace(/^&/, '').toLowerCase(), { path, base: member.kind });
  }
  for (const statement of parsed.statements) {
    if (statement.kind !== 'instance-statement') continue;
    const path = resolve(statement.type);
    if (path) for (const n of statement.names) programVariables.set('&' + n.replace(/^&/, '').toLowerCase(), { path, base: 'instance' });
  }
  const firstImplementation = parsed.implementations[0]?.sourceIndex ?? source.length;
  for (const m of text.slice(0, firstImplementation).matchAll(/\b(Component|Global)\s+([%A-Za-z_][\w:]*)\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) {
    const path = resolve(m[2]);
    if (path) for (const v of m[3].split(',')) programVariables.set(v.trim().toLowerCase(), { path, base: m[1].toLowerCase() });
  }
  const methodsByName = new Map(parsed.members.filter(m => m.kind === 'method').map(m => [(m as any).name.toLowerCase(), m as any]));

  /* ---- calls ---- */
  interface Call {
    t: 'call'; at: number; cls: ApplicationClassPath; method: string; family: string; steps: string;
    impl: number; implName: string; implKind: string; stmt: number; simple: number; depth: number; innermost: string; block: string;
  }
  const calls: Call[] = [];
  const implementationRanges: { start: number; end: number }[] = [];
  for (const [implIndex, impl] of parsed.implementations.entries()) {
    const bodyStart = source.indexOf(impl.body, impl.sourceIndex);
    if (bodyStart < 0) continue;
    const bodyEnd = bodyStart + impl.body.length;
    implementationRanges.push({ start: bodyStart, end: bodyEnd });
    const scopeAt = scopeScanner(text, bodyStart, bodyEnd);
    const locals: { name: string; path?: ApplicationClassPath; at: number }[] = [];
    for (const m of text.slice(bodyStart, bodyEnd).matchAll(/\bLocal\s+((?:array\s+of\s+)*)([%A-Za-z_][\w:]*)\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) {
      const path = m[1] ? undefined : resolve(m[2]);
      for (const v of m[3].split(',')) locals.push({ name: v.trim().toLowerCase(), path, at: bodyStart + m.index! });
    }
    const parameters = new Map<string, ApplicationClassPath | undefined>();
    if (impl.kind === 'method') {
      for (const p of methodsByName.get(impl.name.toLowerCase())?.parameters ?? []) {
        parameters.set(p.name.toLowerCase().startsWith('&') ? p.name.toLowerCase() : '&' + p.name.toLowerCase(), resolve(p.type));
      }
    }
    const body = text.slice(bodyStart, bodyEnd);
    for (const m of body.matchAll(/(?<![\w.&%#])(&\w+|%This\b|%Super\b)/gi)) {
      const baseAt = bodyStart + m.index!;
      const base = m[1].toLowerCase();
      let current: ApplicationClassPath | undefined;
      let baseKind: string;
      if (base === '%this') { current = selfPath; baseKind = '%This'; }
      else if (base === '%super') { current = superPath; baseKind = '%Super'; }
      else {
        const local = locals.filter(l => l.name === base && l.at <= baseAt).slice(-1)[0];
        if (local !== undefined) { current = local.path; baseKind = 'local'; }
        else if (parameters.has(base)) { current = parameters.get(base); baseKind = 'param'; }
        else if (programVariables.has(base)) { current = programVariables.get(base)!.path; baseKind = programVariables.get(base)!.base; }
        else continue;
      }
      if (current === undefined) continue;
      let p = baseAt + m[1].length;
      const steps: string[] = [];
      let first = true;
      while (current !== undefined) {
        while (/\s/.test(text[p] ?? '')) p++;
        if (text[p] !== '.') break;
        p++;
        while (/\s/.test(text[p] ?? '')) p++;
        const name = /^[A-Za-z_]\w*/.exec(text.slice(p))?.[0];
        if (name === undefined) break;
        const memberAt = p;
        p += name.length;
        let q = p;
        while (/\s/.test(text[q] ?? '')) q++;
        if (text[q] === '(' && !(first && base !== '%this' && base !== '%super' && false)) {
          const scope = scopeAt(memberAt);
          let family: string;
          if (steps.length === 0) family = baseKind === '%This' ? 'self' : baseKind === '%Super' ? 'super' : 'source';
          else if (steps.some(s => s.startsWith('result'))) family = 'result';
          else family = baseKind === '%This' ? '%This' : baseKind === '%Super' ? '%Super' : 'typed';
          calls.push({
            t: 'call', at: memberAt, cls: current, method: name.toUpperCase(), family, steps: [baseKind, ...steps].join('>'),
            impl: implIndex, implName: impl.name, implKind: impl.kind,
            stmt: scope.stmt, simple: scope.simple, depth: scope.depth, innermost: scope.innermost, block: scope.path
          });
          const result = provider.methodReturnType(current, name);
          current = result?.kind === 'class' ? result.path : undefined;
          steps.push('result');
          p = closeParen(text, q) + 1;
        } else {
          const result = provider.memberType(current, name);
          const where = ownMembers(current).has(name.toLowerCase()) ? 'own' : 'inherited';
          current = result?.kind === 'class' ? result.path : undefined;
          steps.push(`prop(${where})`);
        }
        first = false;
      }
    }
  }
  if (calls.length === 0) continue;
  callCount += calls.length;
  const implementationOf = (offset: number) => implementationRanges.findIndex(r => offset >= r.start && offset < r.end);

  /* ---- generated rows (committed encoder, no provider) ---- */
  const generated: { key: string; at: number; methodName?: string; path?: string }[] = [];
  let exact = false;
  let encodeError = false;
  try {
    const artifacts = encodeProgramArtifacts(source, {
      owner: { recordName: values[0], fieldName: values[1], packagePath: selfPath },
      referenceTrace: (e: any) => {
        if (e.action !== 'ALLOC') return;
        generated.push({
          key: generatedKeyOf(e.reference), at: e.sourceOffset, methodName: e.reference.methodName,
          path: e.reference.kind === 'package' && e.reference.packagePath ? [...e.reference.packagePath, e.reference.className ?? e.reference.packageName].join(':').toLowerCase() : undefined
        });
      }
    } as any);
    exact = artifacts.program.equals(def.storedProgram);
  } catch {
    encodeError = true;
  }
  const storedRows = [...def.names]
    .sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum))
    .slice(1)
    .map((r: any) => ({
      key: `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`,
      root: String(r.packageroot ?? '').trim(), qualify: String(r.qualifypath ?? '').trim(),
      method: String(r.appclassmethod ?? '').trim().toUpperCase(), namenum: Number(r.namenum)
    }));
  const descriptive = storedRows.some(r => r.key.startsWith('PACKAGE.') && r.root !== '');

  /* ---- one group per receiver class ---- */
  const byClass = new Map<string, Call[]>();
  for (const c of calls) byClass.set(canonicalClassKey(c.cls), [...(byClass.get(canonicalClassKey(c.cls)) ?? []), c]);
  const leafPaths = new Map<string, Set<string>>();
  for (const k of byClass.keys()) { const leaf = k.split(':').pop()!; leafPaths.set(leaf, new Set([...(leafPaths.get(leaf) ?? []), k])); }
  for (const g of generated) if (g.path) { const leaf = g.path.split(':').pop()!; if (leafPaths.has(leaf)) leafPaths.get(leaf)!.add(g.path); }

  for (const [classKey, classCalls] of byClass) {
    const leaf = classKey.split(':').pop()!.toUpperCase();
    const key = `PACKAGE.${leaf}`;
    const ambiguous = (leafPaths.get(leaf.toLowerCase())?.size ?? 0) > 1;
    const record: any = {
      id: def.definitionId, exact, descriptive, encodeError, ambiguous, cls: classKey, self: canonicalClassKey(selfPath) === classKey,
      superclass: superPath !== undefined && canonicalClassKey(superPath) === classKey,
      implementations: parsed.implementations.map(i => i.name),
      stored: storedRows.filter(r => r.key === key).map(r => ({ namenum: r.namenum, root: r.root, qualify: r.qualify, method: r.method })),
      generated: generated.filter(r => r.key === key).map(r => ({ at: r.at, method: r.methodName ?? '' })),
      sourceMentions: [...text.matchAll(new RegExp(`(?<![\\w&])${leaf}(?!\\w)`, 'gi'))].map(m => m.index!)
    };
    if (!encodeError) {
      const sIdx = storedRows.map((_, i) => i).filter(i => storedRows[i].key !== key);
      const gIdx = generated.map((_, i) => i).filter(i => generated[i].key !== key);
      const pairs = lcs(sIdx.map(i => storedRows[i].key), gIdx.map(i => generated[i].key));
      const gapOf = (offset: number) => {
        let prev: [number, number] | undefined, next: [number, number] | undefined;
        for (const pair of pairs) {
          if (generated[gIdx[pair[1]]].at < offset) prev = pair; else { next = pair; break; }
        }
        return {
          sFrom: prev ? sIdx[prev[0]] + 1 : 0, sTo: next ? sIdx[next[0]] : storedRows.length,
          gFrom: prev ? gIdx[prev[1]] + 1 : 0, gTo: next ? gIdx[next[1]] : generated.length
        };
      };
      const events: any[] = [
        ...classCalls.map(c => ({ ...c, cls: undefined })),
        ...generated.map((g, i) => ({ g, i })).filter(({ g }) => g.key === key).map(({ g, i }) => ({
          t: g.methodName ? 'gmethod' : 'gtype', at: g.at, method: g.methodName ?? '', gi: i, impl: implementationOf(g.at),
          // allocated by a call of this group itself (a Cycle 82 self row, or a method row): right after its member name
          byCall: classCalls.some(c => g.at >= c.at + c.method.length && g.at <= c.at + c.method.length + 4)
        }))
      ].sort((a, b) => a.at - b.at || (a.t === 'call' ? 1 : -1));
      const gaps = new Map<string, { stored: any[]; unmatchedStored: number; unmatchedGenerated: number }>();
      for (const e of events) {
        const gap = e.t === 'call' ? gapOf(e.at) : gapOf(e.at + 0.5);
        if (e.t !== 'call') {
          // a generated row sits between its own neighbors in generated order
          let prev: [number, number] | undefined, next: [number, number] | undefined;
          for (const pair of pairs) { if (gIdx[pair[1]] < e.gi) prev = pair; else { next = pair; break; } }
          gap.sFrom = prev ? sIdx[prev[0]] + 1 : 0; gap.sTo = next ? sIdx[next[0]] : storedRows.length;
          gap.gFrom = prev ? gIdx[prev[1]] + 1 : 0; gap.gTo = next ? gIdx[next[1]] : generated.length;
        }
        e.gap = `${gap.sFrom}:${gap.sTo}`;
        if (!gaps.has(e.gap)) {
          gaps.set(e.gap, {
            stored: storedRows.slice(gap.sFrom, gap.sTo).filter(r => r.key === key).map(r => ({ namenum: r.namenum, root: r.root, qualify: r.qualify, method: r.method })),
            unmatchedStored: storedRows.slice(gap.sFrom, gap.sTo).filter(r => r.key !== key).length,
            unmatchedGenerated: generated.slice(gap.gFrom, gap.gTo).filter(r => r.key !== key).length
          });
        }
      }
      record.events = events;
      record.gaps = Object.fromEntries(gaps);
      record.storedOutsideGaps = storedRows.filter(r => r.key === key).length -
        [...gaps.values()].reduce((n, g) => n + g.stored.length, 0);
    } else {
      record.events = classCalls.map(c => ({ ...c, cls: undefined }));
    }
    fs.writeSync(out, JSON.stringify(record) + '\n');
    groupsWritten++;
  }
}
fs.closeSync(out);
console.log(`${programs} Application Class programs parsed; ${callCount} typed calls; ${groupsWritten} (program, class) groups`);
