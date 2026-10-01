/*
 * Cycle 109: `array of <Application Class>` values as method receivers
 * (research only).
 *
 * Every program (ordinary and Application Class). Declarations of an
 * array type -- `Local` / `Component` / `Global` / `ComponentLife`,
 * Function parameters, Application Class method parameters, properties,
 * instances, method `Returns` -- with the declared element type resolved
 * as written in the program (qualified path; named import; a short name
 * unique among the snapshot's classes in a wildcard-imported package or,
 * in an Application Class, its own package), its array depth and its
 * scope. Every later use of the variable (`&x`, `%This.<property>`)
 * counts the index groups applied (`&x [i] [j]`) and what follows: a
 * method call or property on the fully indexed element, an array method
 * (`.Push(...)`, `.Len`) on a partly indexed value, or a bare value.
 *
 * For each method call on a fully indexed element of an Application Class
 * element type, stored truth is positional (Cycle 94 / 108 method): stored
 * and generated rows (committed encoder, with the snapshot type metadata
 * as the harness runs it) are aligned on every row that is not a PACKAGE
 * row of the element class's name; the call falls in one gap, and the
 * stored rows of the class in that gap and before it say whether the call
 * opened a row or reused an earlier one.
 *
 * Output: JSON lines -- `{t: 'decl', ...}` per declaration with its use
 * counts, `{t: 'call', ...}` per fully indexed element call.
 *
 * Usage: npx tsx tools/corpus/research/cycle109-app-class-array-receiver-census.ts <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { listSnapshotApplicationClassDefinitions, snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { canonicalClassKey, type ApplicationClassPath } from '../../../src/peoplecode/applicationClassTypeMetadata';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';

const PRIMITIVE = new Set(['string', 'date', 'any', 'boolean', 'time', 'datetime', 'object', 'integer', 'number', 'float', 'exception']);

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

/** Control depth at an offset (If / For / While / Evaluate / Repeat / try). */
function controlDepthAt(text: string, start: number, offset: number): number {
  let depth = 0;
  const re = /\b(End-If|End-For|End-While|End-Evaluate|end-try|If|For|While|Evaluate|Repeat|Until|try)\b/gi;
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < offset) {
    const before = text[m.index - 1];
    if (before === '&' || before === '.' || before === ':' || before === '%' || before === '-') continue;
    const word = m[0].toLowerCase();
    if (word.startsWith('end-') || word === 'until') depth = Math.max(0, depth - 1); else depth++;
  }
  return depth;
}

function closeBracket(text: string, open: number, o: string, c: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === o) depth++;
    else if (text[i] === c) { depth--; if (depth === 0) return i; }
  }
  return text.length - 1;
}

const db = openSnapshotDatabase();
const classDefinitions = listSnapshotApplicationClassDefinitions(db);
const provider = snapshotApplicationClassTypeMetadata(db);
const classesByLeaf = new Map<string, ApplicationClassPath[]>();
const classKeys = new Set(classDefinitions.map(d => canonicalClassKey(d.path)));
for (const d of classDefinitions) {
  const leaf = d.path[d.path.length - 1].toLowerCase();
  classesByLeaf.set(leaf, [...(classesByLeaf.get(leaf) ?? []), d.path]);
}

const out = fs.openSync(process.argv[2], 'w');
let declarations = 0, calls = 0;

for (const def of listSnapshotDefinitions(db) as any[]) {
  const source = String(def.sourceText ?? '');
  if (!/\barray\s+of\b/i.test(source)) continue;
  const text = clean(source);
  if (!/\barray\s+of\b/i.test(text)) continue;
  const app = def.objectid1 === 104;
  const parsed = app ? parseApplicationClassSource(source) : undefined;
  if (app && parsed === undefined) continue;
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const ownerPath = values.slice(0, event < 0 ? values.length : event).filter(Boolean);
  const ownPackage = app ? ownerPath.slice(0, -1).join(':').toLowerCase() : undefined;

  /* ---- element type resolution as written in this program ---- */
  const named = new Map<string, ApplicationClassPath>();
  const wildcards: string[] = [];
  for (const m of text.slice(0, parsed?.unitStart ?? text.length).matchAll(/\bimport\s+([%A-Za-z0-9_:\s*]+?)\s*;/gi)) {
    const c = m[1].replace(/\s+/g, '').split(':');
    if (c[c.length - 1] === '*') wildcards.push(c.slice(0, -1).join(':').toLowerCase());
    else named.set(c[c.length - 1].toLowerCase(), c);
  }
  const resolve = (written: string): { kind: 'class' | 'builtin' | 'primitive' | 'unknown'; path?: ApplicationClassPath; how: string } => {
    const t = written.replace(/\s+/g, '');
    if (PRIMITIVE.has(t.toLowerCase())) return { kind: 'primitive', how: 'primitive' };
    if (t.includes(':')) return { kind: 'class', path: t.split(':'), how: 'qualified' };
    if (isBuiltinObjectTypeName(t)) return { kind: 'builtin', how: 'builtin' };
    const imported = named.get(t.toLowerCase());
    if (imported !== undefined) return { kind: 'class', path: imported, how: 'named-import' };
    const candidates = (classesByLeaf.get(t.toLowerCase()) ?? []).filter(p => {
      const pkg = p.slice(0, -1).join(':').toLowerCase();
      return wildcards.includes(pkg) || (ownPackage !== undefined && pkg === ownPackage);
    });
    if (candidates.length === 1) return { kind: 'class', path: candidates[0], how: wildcards.includes(candidates[0].slice(0, -1).join(':').toLowerCase()) ? 'wildcard' : 'own-package' };
    return { kind: 'unknown', how: candidates.length > 1 ? 'ambiguous' : 'unresolved' };
  };

  /* ---- scopes ---- */
  const bodies: { start: number; end: number; name: string; kind: string }[] = [];
  if (parsed) {
    for (const impl of parsed.implementations) {
      const start = source.indexOf(impl.body, impl.sourceIndex);
      if (start >= 0) bodies.push({ start, end: start + impl.body.length, name: impl.name, kind: impl.kind });
    }
  }
  const functions: { start: number; end: number; name: string; params: string }[] = [];
  for (const m of text.matchAll(/(?<!Declare\s+)\bFunction\s+(\w+)\s*(\(([^()]*)\))?/gi)) {
    if (/declare\s+$/i.test(text.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    const endMatch = /\bEnd-Function\b/i.exec(text.slice(m.index!));
    functions.push({ start: m.index!, end: endMatch ? m.index! + endMatch.index : text.length, name: m[1], params: m[3] ?? '' });
  }
  const bodyAt = (offset: number) => bodies.findIndex(b => offset >= b.start && offset < b.end);
  const functionAt = (offset: number) => functions.findIndex(f => offset >= f.start && offset < f.end);

  interface Decl {
    name: string; access: 'var' | 'this'; context: string; written: string; depth: number; at: number;
    scopeStart: number; scopeEnd: number; scopes?: { start: number; end: number }[]; nested?: boolean;
  }
  const decls: Decl[] = [];
  const arrayType = /^((?:array\s+of\s+)+)([%A-Za-z_][\w:]*)$/i;
  const addFromType = (name: string, access: Decl['access'], context: string, type: string, at: number, scopeStart: number, scopeEnd: number, scopes?: Decl['scopes']) => {
    const m = arrayType.exec(type.replace(/\s+/g, ' ').trim());
    if (!m) return;
    decls.push({ name: name.toLowerCase(), access, context, written: m[2], depth: (m[1].match(/array/gi) ?? []).length, at, scopeStart, scopeEnd, scopes });
  };
  for (const m of text.matchAll(/\b(Local|Component|Global|ComponentLife)\s+((?:array\s+of\s+)+)([%A-Za-z_][\w:]*)\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) {
    const at = m.index!;
    let scopeStart = at, scopeEnd = text.length, context = m[1];
    if (/^local$/i.test(m[1])) {
      const b = bodyAt(at), f = functionAt(at);
      if (b >= 0) { scopeEnd = bodies[b].end; context = 'Local'; }
      else if (f >= 0) { scopeEnd = functions[f].end; context = 'Local(Function)'; }
    } else scopeStart = 0;
    const b = bodyAt(at);
    const nested = b >= 0 ? controlDepthAt(text, bodies[b].start, at) > 0 : controlDepthAt(text, 0, at) > 0;
    for (const v of m[4].split(',')) {
      decls.push({ name: v.trim().toLowerCase(), access: 'var', context, written: m[3], depth: (m[2].match(/array/gi) ?? []).length, at, scopeStart, scopeEnd, nested });
    }
  }
  for (const f of functions) {
    for (const p of f.params.matchAll(/(&\w+)\s+As\s+((?:array\s+of\s+)+[%A-Za-z_][\w:]*)/gi)) addFromType(p[1], 'var', 'Function parameter', p[2], f.start, f.start, f.end);
  }
  if (parsed) {
    const methods = new Map(parsed.members.filter(m => m.kind === 'method').map(m => [(m as any).name.toLowerCase(), m as any]));
    for (const [i, impl] of parsed.implementations.entries()) {
      if (impl.kind !== 'method' || bodies[i] === undefined) continue;
      for (const p of methods.get(impl.name.toLowerCase())?.parameters ?? []) {
        addFromType(p.name.startsWith('&') ? p.name : '&' + p.name, 'var', 'method parameter', p.type, (methods.get(impl.name.toLowerCase()) as any).sourceIndex ?? 0, bodies[i].start, bodies[i].end);
      }
    }
    for (const member of parsed.members) {
      if (member.kind === 'property') {
        addFromType(member.name, 'this', 'property', member.type, member.sourceIndex, 0, text.length, bodies);
        addFromType('&' + member.name.replace(/^&/, ''), 'var', 'property(&)', member.type, member.sourceIndex, 0, text.length, bodies);
      } else if (member.kind === 'instance') {
        addFromType('&' + member.name.replace(/^&/, ''), 'var', 'instance', member.type, member.sourceIndex, 0, text.length, bodies);
      } else if (member.kind === 'method' && (member as any).returnType) {
        const rt = String((member as any).returnType);
        const m = arrayType.exec(rt.replace(/\s+/g, ' ').trim());
        if (m) decls.push({ name: member.name.toLowerCase(), access: 'this', context: 'Returns', written: m[2], depth: (m[1].match(/array/gi) ?? []).length, at: member.sourceIndex, scopeStart: 0, scopeEnd: text.length, scopes: bodies });
      }
    }
    for (const statement of parsed.statements) {
      if (statement.kind !== 'instance-statement') continue;
      for (const n of statement.names) addFromType('&' + n.replace(/^&/, ''), 'var', 'instance', statement.type, statement.sourceIndex, 0, text.length, bodies);
    }
  }
  if (decls.length === 0) continue;

  /* ---- generated rows (committed encoder with the snapshot metadata) ---- */
  const generated: { key: string; at: number }[] = [];
  let encodeError = false;
  try {
    encodeProgramArtifacts(source, {
      owner: { recordName: values[0], fieldName: values[1], packagePath: ownerPath },
      applicationClassTypeMetadata: provider,
      referenceTrace: (e: any) => { if (e.action === 'ALLOC') generated.push({ key: generatedKeyOf(e.reference), at: e.sourceOffset }); }
    } as any);
  } catch { encodeError = true; }
  const storedRows = [...def.names].sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum)).slice(1)
    .map((r: any) => ({ key: `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`, method: String(r.appclassmethod ?? '').trim().toUpperCase() }));

  /* ---- uses ---- */
  for (const d of decls) {
    const element = resolve(d.written);
    const counts = { uses: 0, indexed: 0, full: 0, fullCall: 0, fullProperty: 0, partialMember: 0, overIndexed: 0, bare: 0 };
    const pattern = d.access === 'var'
      ? new RegExp(`(?<![\\w&.%#])${d.name.replace('&', '&')}(?![\\w#])`, 'gi')
      : new RegExp(`%This\\s*\\.\\s*${d.name}(?!\\w)`, 'gi');
    for (const m of text.matchAll(pattern)) {
      const at = m.index!;
      if (at <= d.at && d.context !== 'property' && d.context !== 'Returns') continue;
      if (at < d.scopeStart || at >= d.scopeEnd) continue;
      if (d.scopes && !d.scopes.some(s => at >= s.start && at < s.end)) continue;
      let p = at + m[0].length;
      if (d.context === 'Returns') {
        while (/\s/.test(text[p] ?? '')) p++;
        if (text[p] !== '(') continue;
        p = closeBracket(text, p, '(', ')') + 1;
      }
      counts.uses++;
      let indices = 0;
      while (true) {
        let q = p;
        while (/\s/.test(text[q] ?? '')) q++;
        if (text[q] !== '[') break;
        const close = closeBracket(text, q, '[', ']');
        indices += 1 + (text.slice(q + 1, close).match(/,/g) ?? []).length;
        p = close + 1;
      }
      if (indices > 0) counts.indexed++;
      let q = p;
      while (/\s/.test(text[q] ?? '')) q++;
      const member = text[q] === '.' ? /^\.\s*([A-Za-z_]\w*)\s*(\()?/.exec(text.slice(q)) : null;
      if (indices > d.depth) counts.overIndexed++;
      else if (indices === d.depth) {
        counts.full++;
        if (member && member[2]) counts.fullCall++;
        else if (member) counts.fullProperty++;
        else counts.bare++;
        if (member && member[2] && element.kind === 'class') {
          const memberAt = q + member[0].indexOf(member[1]);
          const leaf = element.path![element.path!.length - 1].toUpperCase();
          const key = `PACKAGE.${leaf}`;
          const record: any = {
            t: 'call', id: def.definitionId, app, encodeError, context: d.context, name: d.name, depth: d.depth,
            cls: element.path!.join(':'), how: element.how, inSnapshot: classKeys.has(canonicalClassKey(element.path!)),
            method: member[1].toUpperCase(), at: memberAt, body: bodyAt(memberAt)
          };
          if (!encodeError) {
            const sIdx = storedRows.map((_, i) => i).filter(i => storedRows[i].key !== key);
            const gIdx = generated.map((_, i) => i).filter(i => generated[i].key !== key);
            const pairs = lcs(sIdx.map(i => storedRows[i].key), gIdx.map(i => generated[i].key));
            let prev: [number, number] | undefined, next: [number, number] | undefined;
            for (const pair of pairs) { if (generated[gIdx[pair[1]]].at < memberAt) prev = pair; else { next = pair; break; } }
            const sFrom = prev ? sIdx[prev[0]] + 1 : 0, sTo = next ? sIdx[next[0]] : storedRows.length;
            const gFrom = prev ? gIdx[prev[1]] + 1 : 0, gTo = next ? gIdx[next[1]] : generated.length;
            record.storedBefore = storedRows.slice(0, sFrom).filter(r => r.key === key).length;
            record.storedInGap = storedRows.slice(sFrom, sTo).filter(r => r.key === key).map(r => r.method || '-');
            record.generatedBefore = generated.slice(0, gFrom).filter(r => r.key === key).length;
            record.generatedInGap = generated.slice(gFrom, gTo).filter(r => r.key === key).length;
            record.clean = storedRows.slice(sFrom, sTo).every(r => r.key === key) && generated.slice(gFrom, gTo).every(r => r.key === key);
          }
          fs.writeSync(out, JSON.stringify(record) + '\n');
          calls++;
        }
      } else if (member) counts.partialMember++;
      else counts.bare++;
    }
    fs.writeSync(out, JSON.stringify({
      t: 'decl', id: def.definitionId, app, context: d.context, name: d.name, written: d.written, depth: d.depth,
      element: element.kind, how: element.how, cls: element.path?.join(':'), inSnapshot: element.path ? classKeys.has(canonicalClassKey(element.path)) : undefined,
      nested: d.nested, at: d.at, ...counts
    }) + '\n');
    declarations++;
  }
}
fs.closeSync(out);
console.log(`${declarations} array declarations; ${calls} method calls on fully indexed Application Class elements`);
