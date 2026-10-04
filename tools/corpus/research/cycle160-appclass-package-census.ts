/*
 * Cycle 160: App Class PACKAGE mechanisms, Row properties, `%This` result
 * typing and DECODE_SOURCE_MISMATCH partition (research only).
 *
 * Sections (all by default, or one with `--section <name>`):
 *   partition  App Class programs whose first list difference is
 *              PACKAGE/PACKAGE: full-list LCS comparison (missing / extra /
 *              mixed / duplicate lifetime) with the rows only one side has;
 *   exception  App Class header members typed `Exception` (parameter,
 *              return, property, instance) vs `extends Exception` only:
 *              does stored hold a PACKAGE.EXCEPTION row;
 *   cast       App Class body `As <Class>` casts of a class used nowhere
 *              else, by whether the cast's result receives a method call;
 *   imports    named imports repeated by class leaf (same / different
 *              path): stored plain rows of the leaf;
 *   this       `%This.<ownMethod>(...)` whose own header declares the
 *              return type, by type and what follows (bare member, call,
 *              index): stored FIELD / RECORD row of a bare member;
 *   record     generated RECORD rows whose name no stored list has;
 *   dsm        DECODE_SOURCE_MISMATCH: every token difference a one-for-one
 *              character substitution by the source export's placeholder
 *              (`¿` or a backtick: lossy snapshot source) vs other
 *              differences (first one found).
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle160-appclass-package-census.ts --taxonomy t.json [--section <name>]
 */
import fs from 'node:fs';

import { maskNonCode, parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import {
  openHarnessContext, encodeAsHarness, isApplicationClass, storedReferenceKeys, generatedReferenceKey,
  referenceKeyKind, storedNameTable, generatedNameTable, decodeAsHarness
} from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const nonexact = new Set<number>(taxonomyRows.map(r => r.definitionId));
const sectionArg = args.indexOf('--section');
const only = sectionArg >= 0 ? args[sectionArg + 1] : undefined;
const run = (name: string) => only === undefined || only === name;
const ctx = openHarnessContext();
const tally = new Map<string, Set<number>[]>();
const add = (key: string, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[nonexact.has(id) ? 1 : 0].add(id);
};
const flush = (title: string) => {
  console.log(`== ${title}`);
  for (const [k, [exact, non]] of [...tally].sort()) {
    console.log(`  ${k.padEnd(44)} EXACT ${String(exact.size).padStart(4)}  non ${String(non.size).padStart(3)}  e.g. ${[...exact].slice(0, 4).join(' ')}${non.size ? ` | non ${[...non].join(' ')}` : ''}`);
  }
  tally.clear();
};
const storedRows = (def: any) => [...def.names].map((r: any) => ({
  rec: String(r.recname).trim().toUpperCase(), ref: String(r.refname).trim().toUpperCase(), root: String(r.packageroot).trim(), method: String(r.appclassmethod).trim()
}));
const lcs = (s: string[], g: string[]) => {
  const L = Array.from({ length: s.length + 1 }, () => new Int32Array(g.length + 1));
  for (let i = s.length - 1; i >= 0; i--) for (let j = g.length - 1; j >= 0; j--) L[i][j] = s[i] === g[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  return L[0][0];
};
const multisetMinus = (a: string[], b: string[]) => {
  const left = new Map<string, number>(); for (const k of b) left.set(k, (left.get(k) ?? 0) + 1);
  return a.filter(k => { const n = left.get(k) ?? 0; if (n > 0) { left.set(k, n - 1); return false; } return true; });
};

if (run('partition')) {
  console.log('== partition: App Class, first list difference PACKAGE/PACKAGE');
  for (const def of ctx.definitions as any[]) {
    if (!nonexact.has(def.definitionId) || !isApplicationClass(def)) continue;
    const r = encodeAsHarness(ctx, def); if (r.fallback || !r.artifacts) continue;
    const s = storedReferenceKeys(def), g = r.artifacts.references.map(generatedReferenceKey);
    let i = 0; while (i < Math.max(s.length, g.length) && s[i] === g[i]) i++;
    if (referenceKeyKind(s[i]) !== 'PACKAGE' || referenceKeyKind(g[i]) !== 'PACKAGE') continue;
    const onlyStored = multisetMinus(s, g), onlyGenerated = multisetMinus(g, s);
    const kind = onlyStored.length >= 10 ? 'duplicate lifetime' : onlyStored.length && onlyGenerated.length ? 'mixed' : onlyStored.length ? 'missing' : onlyGenerated.length ? 'extra' : 'order';
    console.log(`  ${def.definitionId} ${kind.padEnd(18)} row ${i + 1} stored ${s[i]} / generated ${g[i]}; stored ${s.length} generated ${g.length} LCS ${lcs(s, g)}; only stored [${onlyStored.slice(0, 6).join(' ')}${onlyStored.length > 6 ? ' ...' : ''}] only generated [${onlyGenerated.slice(0, 6).join(' ')}]`);
  }
}

for (const def of ctx.definitions as any[]) {
  if (!isApplicationClass(def)) continue;
  const parsed = parseApplicationClassSource(def.sourceText); if (!parsed) continue;
  const code = maskNonCode(def.sourceText);
  const rows = storedRows(def);
  if (run('exception')) {
    const contexts = new Set<string>();
    for (const s of parsed.statements as any[]) {
      if (s.kind === 'method') {
        if (s.parameters.some((p: any) => /^exception$/i.test(p.type.trim()))) contexts.add('parameter');
        if (/^exception$/i.test(String(s.returnType ?? '').trim())) contexts.add('return');
      } else if (/^exception$/i.test(String(s.type ?? '').trim())) contexts.add(s.kind === 'instance-statement' ? 'instance' : s.kind);
    }
    const extendsException = /^exception$/i.test(String(parsed.extendsType ?? '').trim());
    if (contexts.size || extendsException) {
      const row = rows.some(r => r.rec === 'PACKAGE' && r.ref === 'EXCEPTION' && (r.root === '' || /^exception$/i.test(r.root)));
      add(`exception ${contexts.size ? [...contexts].sort().join('+') : 'extends only'}${extendsException && contexts.size ? ' (+extends)' : ''} row=${row}`, def.definitionId);
    }
  }
  if (run('cast')) {
    const byLeaf = new Map<string, string[]>();
    for (const m of code.matchAll(/\bAs\s+([A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)+)(\s*\)\s*\.\s*\w+\s*(\()?)?/gi)) {
      if ((m.index ?? 0) < parsed.unitEnd) continue;
      const leaf = m[1].split(':').at(-1)!.trim().toLowerCase();
      byLeaf.set(leaf, [...(byLeaf.get(leaf) ?? []), m[3] ? 'call' : m[2] ? 'property' : 'argument/value']);
    }
    for (const [leaf, kinds] of byLeaf) {
      const mentions = (code.match(new RegExp(`\\b${leaf}\\b`, 'gi')) ?? []).length;
      const row = rows.some(r => r.rec === 'PACKAGE' && r.ref === leaf.toUpperCase());
      add(`cast ${mentions === kinds.length ? 'cast-only' : 'also-used'} ${kinds.includes('call') ? 'call on result' : 'no call'} row=${row}`, def.definitionId);
    }
  }
  if (run('this')) {
    const returns = new Map<string, string>();
    for (const m of parsed.members as any[]) if (m.kind === 'method' && m.returnType) returns.set(m.name.toLowerCase(), m.returnType.trim());
    for (const m of code.matchAll(/%This\s*\.\s*(\w+)\s*\(/gi)) {
      const type = returns.get(m[1].toLowerCase()); if (!type) continue;
      let i = (m.index ?? 0) + m[0].length, depth = 1;
      while (i < code.length && depth > 0) { if (code[i] === '(') depth++; else if (code[i] === ')') depth--; i++; }
      const next = /^\s*(\(|\.\s*(\w+)\s*(\()?)/.exec(code.slice(i)); if (!next) continue;
      const shape = next[1] === '(' ? 'index' : next[3] ? 'call' : 'bare';
      const kind = /^(Record|Row|Rowset|Field)$/i.test(type) ? type.toLowerCase() : type.includes(':') ? 'class' : 'other';
      const row = shape !== 'bare' ? '' : rows.some(r => r.rec === 'FIELD' && r.ref === next[2].toUpperCase()) ? ' FIELD row' : rows.some(r => r.rec === 'RECORD' && r.ref === next[2].toUpperCase()) ? ' RECORD row' : ' no row';
      add(`%This Returns ${kind} ${shape}${row}`, def.definitionId);
    }
  }
}
if (run('exception')) flush('exception: App Class header Exception types');
if (run('cast')) flush('cast: App Class body casts, per class leaf');
if (run('this')) flush('this: %This own-method results (sites grouped per program)');

if (run('imports')) {
  for (const def of ctx.definitions as any[]) {
    const imports = [...maskNonCode(def.sourceText).matchAll(/\bimport\s+([^;*]+?)\s*;/gi)].map(m => m[1].replace(/\s+/g, '').toLowerCase());
    const byLeaf = new Map<string, string[]>();
    for (const path of imports) { const leaf = path.split(':').at(-1)!; byLeaf.set(leaf, [...(byLeaf.get(leaf) ?? []), path]); }
    for (const [leaf, paths] of byLeaf) {
      if (paths.length < 2) continue;
      const plain = storedRows(def).filter(r => r.rec === 'PACKAGE' && r.ref.toLowerCase() === leaf && r.method === '').length;
      add(`${isApplicationClass(def) ? 'App Class' : 'ordinary'} ${new Set(paths).size === 1 ? 'same path' : 'different paths'} x${paths.length} stored rows ${plain}`, def.definitionId);
    }
  }
  flush('imports: named imports repeated by class leaf');
}

if (run('record')) {
  const stored = new Set<string>();
  for (const def of ctx.definitions as any[]) for (const r of storedRows(def)) if (r.rec === 'RECORD') stored.add(r.ref);
  for (const def of ctx.definitions as any[]) {
    const r = encodeAsHarness(ctx, def);
    for (const g of (r.artifacts?.references ?? []) as any[]) {
      if (g.kind === 'record' && !stored.has(String(g.recordName).toUpperCase())) add(`RECORD.${String(g.recordName).toUpperCase()}`, def.definitionId);
    }
  }
  flush('record: generated RECORD names absent from every stored list');
}

if (run('dsm')) {
  const substitutions = new Map<string, number>();
  for (const row of taxonomyRows.filter(r => r.primaryCategory === 'DECODE_SOURCE_MISMATCH')) {
    const def = ctx.definitions.find(d => d.definitionId === row.definitionId)! as any;
    const r = encodeAsHarness(ctx, def);
    const st = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens;
    const gt = decodeAsHarness(def, r.artifacts!.program, generatedNameTable(r.artifacts!.references)).tokens;
    let verdict = st.length === gt.length ? 'lossy source (one-for-one)' : 'token count differs';
    for (let k = 0; verdict.startsWith('lossy') && k < st.length; k++) {
      const s = String(st[k].text ?? ''), g = String(gt[k].text ?? '');
      if (st[k].opcode !== gt[k].opcode) { verdict = `opcode ${st[k].opcode.toString(16)}/${gt[k].opcode.toString(16)}`; break; }
      if (s === g) continue;
      if (s.length !== g.length) { verdict = 'text length differs'; break; }
      for (let i = 0; i < s.length; i++) {
        if (s[i] === g[i]) continue;
        // the snapshot source holds the export's placeholder for the stored character
        if (g[i] !== '¿' && g[i] !== '`') { verdict = 'text differs'; break; }
        const key = `U+${s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')} -> ${JSON.stringify(g[i])}`;
        substitutions.set(key, (substitutions.get(key) ?? 0) + 1);
      }
    }
    add(verdict, def.definitionId);
  }
  flush('dsm: DECODE_SOURCE_MISMATCH');
  for (const [k, n] of [...substitutions].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)} ${k}`);
}
