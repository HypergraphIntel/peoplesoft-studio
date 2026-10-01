/*
 * Cycle 104: method-dependency rows for receivers the encoder does not
 * track -- array elements and ComponentLife variables (research only).
 *
 * Cycle 94 established, for ordinary programs, that every use of an
 * Application Class (declaration type, create, cast, method call on a
 * declared instance) reuses the class's row in the current ALLOCATION UNIT
 * or opens one, and that a row a method call opens carries the method name
 * (APPCLASSMETHOD). Its census (`cycle94-method-row-truth-census.ts`)
 * covered direct calls `&v.M(` on Local / Component / Global / parameter /
 * created variables only. This census covers the receiver shapes it left
 * out:
 *
 *   array-element  `&arr [i].M(` (any number of index groups) where &arr is
 *                  declared `array of <Class>` (Local / Component / Global /
 *                  ComponentLife / parameter)
 *   componentlife  `&v.M(` where &v is declared `ComponentLife <Class>`
 *   direct         every other declared receiver (control population)
 *
 * The class is known when the declared type is package-qualified or a short
 * name with a named import. Truth is positional, as in Cycle 94: stored and
 * generated rows are aligned on every row that is not PACKAGE.<class>; the
 * call falls in one gap between two aligned anchors, and the stored rows of
 * the class in that gap are the rows its events opened. A gap is `clean`
 * when the call is the only event of the class in it and no other row is
 * unmatched there.
 *
 * Prediction (the Cycle 94 rule): the call opens a row iff no earlier event
 * of the class -- import, declaration, create, or call of any receiver
 * shape -- lies in the same allocation unit (leading declaration section,
 * closed by executable code, the first initialized declaration, or the
 * first Function; then each top-level statement / outermost control
 * structure; each Function body statement).
 *
 * Programs with a call through a property or method result use the
 * external-metadata fallback (Cycle 93) and are flagged `external`.
 *
 * Usage: npx tsx tools/corpus/research/cycle104-receiver-method-row-census.ts [--json out.jsonl]
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { balanced, maskSource, structureAt } from './cycle103-builtin-package-lifetime-census';

function context(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : values[0],
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function generatedKey(g: any): string {
  const up = (v: unknown) => String(v ?? '').toUpperCase();
  switch (g.kind) {
    case 'package': return `PACKAGE.${up(g.packageName)}`;
    case 'scroll': return `SCROLL.${up(g.recordName)}`;
    case 'record': return `RECORD.${up(g.recordName)}`;
    case 'field': return `FIELD.${up(g.fieldName)}`;
    case 'component': return `COMPONENT.${up(g.objectName)}`;
    default: return `${up(g.recordName)}.${up(g.fieldName)}`;
  }
}

/* Longest common subsequence of two key lists, as index pairs. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

interface Variable { name: string; cls: string; full: string; arrayDepth: number; declarator: string; at: number; functionId: number }
/* `unitAt`: where the event's allocation unit is read -- inside the statement, past its first token. */
interface ClassEvent { at: number; unitAt?: number; tag: string; shape?: string; method?: string }

const jsonIndex = process.argv.indexOf('--json');
const out = jsonIndex >= 0 ? fs.openSync(process.argv[jsonIndex + 1], 'w') : undefined;
const tally = new Map<string, number[]>();
const add = (key: string, id: number) => { const l = tally.get(key) ?? []; l.push(id); tally.set(key, l); };

for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  if (def.objectid1 === 104) continue;
  const source = String(def.sourceText ?? '');
  if (!/&\w+\s*(?:\[|\.)/.test(source) || !balanced(source)) continue;
  const masked = maskSource(source);
  const at = structureAt(masked);

  const named = new Map<string, string>();
  let wildcard = false;
  const imports: { at: number; full: string }[] = [];
  for (const m of masked.matchAll(/\bimport\s+([\w:]+?):(\*|\w+)\s*;/gi)) {
    if (m[2] === '*') { wildcard = true; continue; }
    const full = `${m[1]}:${m[2]}`.toLowerCase();
    named.set(m[2].toLowerCase(), full);
    imports.push({ at: m.index!, full });
  }
  const resolveType = (type: string): { cls: string; full: string } | undefined => {
    if (type.includes(':')) return { cls: type.split(':').pop()!.toUpperCase(), full: type.toLowerCase() };
    const full = named.get(type.toLowerCase());
    return full === undefined ? undefined : { cls: type.toUpperCase(), full };
  };

  const variables: Variable[] = [];
  for (const m of masked.matchAll(/\b(Local|Global|ComponentLife|Component)\s+((?:array\s+of\s+)*)([A-Za-z_][\w:]*)\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) {
    const t = resolveType(m[3]);
    if (!t) continue;
    const depth = (m[2].match(/array/gi) ?? []).length;
    const typeAt = m.index! + m[0].indexOf(m[3], m[1].length);
    for (const name of m[4].split(',')) variables.push({ name: name.trim().toLowerCase(), ...t, arrayDepth: depth, declarator: m[1].toLowerCase(), at: typeAt, functionId: at(typeAt).functionId });
  }
  for (const m of masked.matchAll(/(&\w+)\s+As\s+((?:array\s+of\s+)*)([A-Za-z_][\w:]*)/gi)) {
    const t = resolveType(m[3]);
    if (!t) continue;
    variables.push({ name: m[1].toLowerCase(), ...t, arrayDepth: (m[2].match(/array/gi) ?? []).length, declarator: 'parameter', at: m.index!, functionId: at(m.index! + m[0].length).functionId });
  }
  if (variables.length === 0) continue;
  const resolve = (name: string, offset: number): Variable | undefined => {
    const fid = at(offset).functionId;
    const visible = variables.filter(v => v.name === name.toLowerCase() && v.at <= offset && (v.functionId === 0 || v.functionId === fid));
    const local = visible.filter(v => v.functionId !== 0);
    return (local.length ? local : visible).slice(-1)[0];
  };

  // calls through a property or method result: external class metadata (Cycle 93)
  const external = [...masked.matchAll(/(&\w+)(?:\s*\[[^\]]*\])*\s*\.\s*\w+\s*(?:\((?:[^()]|\([^()]*\))*\)\s*)?\.\s*\w+\s*\(/g)]
    .some(m => resolve(m[1], m.index!) !== undefined);

  // class events
  const events = new Map<string, ClassEvent[]>();
  const push = (cls: string, e: ClassEvent) => { const l = events.get(cls) ?? []; l.push(e); events.set(cls, l); };
  for (const i of imports) push(i.full.split(':').pop()!.toUpperCase(), { at: i.at, tag: 'I' });
  for (const v of variables) if (v.declarator !== 'parameter') push(v.cls, { at: v.at, tag: 'D' });
  for (const m of masked.matchAll(/\bcreate\s+([A-Za-z_][\w:]*)\s*\(/gi)) {
    const t = resolveType(m[1]);
    if (t) push(t.cls, { at: m.index!, tag: 'C' });
  }
  for (const m of masked.matchAll(/(&\w+)((?:\s*\[(?:[^\[\]]|\[[^\[\]]*\])*\])*)\s*\.\s*(\w+)\s*\(/g)) {
    const v = resolve(m[1], m.index!);
    if (!v) continue;
    const groups = (m[2].match(/\[/g) ?? []).length - (m[2].match(/\[[^\[\]]*\[/g) ?? []).length;
    const unitAt = m.index! + m[0].lastIndexOf(m[3]);
    if (v.arrayDepth === 0 && m[2] === '') push(v.cls, { at: m.index!, unitAt, tag: 'M', shape: v.declarator === 'componentlife' ? 'componentlife' : 'direct', method: m[3].toUpperCase() });
    else if (v.arrayDepth > 0 && groups === v.arrayDepth) push(v.cls, { at: m.index!, unitAt, tag: 'M', shape: 'array-element', method: m[3].toUpperCase() });
  }
  const interesting = [...events.values()].some(l => l.some(e => e.shape === 'array-element' || e.shape === 'componentlife'));
  if (!interesting) continue;

  const generated: { key: string; at: number }[] = [];
  try {
    encodeProgramArtifacts(source, {
      owner: context(def),
      referenceTrace: (e: any) => { if (e.action === 'ALLOC') generated.push({ key: generatedKey(e.reference), at: e.sourceOffset }); }
    } as any);
  } catch { continue; }
  const stored = def.names.slice(1).map((r: any) => ({
    key: `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`,
    method: String(r.appclassmethod ?? '').trim().toUpperCase()
  }));
  if (stored.length > 900 || generated.length > 900) continue;

  const unitOf = (offset: number): string => {
    const s = at(offset);
    if (s.functionId === 0) {
      if (!s.leadingClosed && s.functionsBefore === 0 && s.controlDepth === 0) return 'lead';
      return s.controlDepth > 0 ? `S${s.structure}` : `T${s.statement}`;
    }
    return s.controlDepth > 0 ? `F${s.functionId}S${s.structure}` : `F${s.functionId}T${s.statement}`;
  };

  for (const [cls, list] of events) {
    list.sort((a, b) => a.at - b.at);
    const key = `PACKAGE.${cls}`;
    const sIdx = stored.map((_: any, i: number) => i).filter((i: number) => stored[i].key !== key);
    const gIdx = generated.map((_, i) => i).filter(i => generated[i].key !== key);
    const pairs = lcs(sIdx.map((i: number) => stored[i].key), gIdx.map(i => generated[i].key));
    const gapOf = (offset: number) => {
      let prev: [number, number] | undefined, next: [number, number] | undefined;
      for (const p of pairs) { if (generated[gIdx[p[1]]].at < offset) prev = p; else { next = p; break; } }
      return {
        sFrom: prev ? sIdx[prev[0]] + 1 : 0, sTo: next ? sIdx[next[0]] : stored.length,
        gFrom: prev ? gIdx[prev[1]] + 1 : 0, gTo: next ? gIdx[next[1]] : generated.length
      };
    };
    const seenUnits = new Set<string>();
    const importMode = named.has(cls.toLowerCase()) ? 'named' : wildcard ? 'wildcard' : 'none';
    const gaps = new Map<string, { events: (ClassEvent & { predicted: string })[]; g: ReturnType<typeof gapOf> }>();
    for (const e of list) {
      const unit = e.tag === 'I' ? 'lead' : unitOf(e.unitAt ?? e.at);
      const predicted = seenUnits.has(unit) ? 'reuse' : 'open';
      seenUnits.add(unit);
      const g = gapOf(e.at);
      const k = `${g.sFrom}:${g.sTo}`;
      const entry = gaps.get(k) ?? { events: [], g };
      entry.events.push({ ...e, predicted });
      gaps.set(k, entry);
    }
    for (const { events: gapEvents, g } of gaps.values()) {
      const target = gapEvents.filter(e => e.shape === 'array-element' || e.shape === 'componentlife');
      if (target.length === 0) continue;
      const storedRows = stored.slice(g.sFrom, g.sTo).filter((r: any) => r.key === key);
      const generatedRows = generated.slice(g.gFrom, g.gTo).filter(r => r.key === key).length;
      const aligned = stored.slice(g.sFrom, g.sTo).every((r: any) => r.key === key) && generated.slice(g.gFrom, g.gTo).every(r => r.key === key);
      const predictedOpens = gapEvents.filter(e => e.predicted === 'open' && e.tag !== 'I').length + gapEvents.filter(e => e.tag === 'I').length;
      const shapes = [...new Set(target.map(e => e.shape))].join('+');
      const signature = gapEvents.map(e => e.tag === 'M' ? `M:${e.shape}:${e.predicted}` : `${e.tag}:${e.predicted}`).join(' ');
      const record = {
        id: def.definitionId, cls, importMode, external, aligned, shapes, signature,
        predictedOpens, storedRows: storedRows.length, storedLabels: storedRows.map((r: any) => r.method || '-'), generatedRows,
        methods: target.map(e => e.method)
      };
      if (out !== undefined) fs.writeSync(out, JSON.stringify(record) + '\n');
      const verdict = external ? 'external' : !aligned ? 'unaligned' : predictedOpens === storedRows.length ? 'MODEL=STORED' : 'MODEL!=STORED';
      add(`${shapes.padEnd(14)} ${importMode.padEnd(8)} ${verdict.padEnd(13)} generated ${generatedRows === storedRows.length ? '=' : '!'}= stored`, def.definitionId);
    }
  }
}
if (out !== undefined) fs.closeSync(out);
console.log('gaps holding array-element / componentlife calls: receiver shape, import, Cycle 94 model vs stored, generated vs stored');
for (const [k, ids] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) console.log(String(ids.length).padStart(6), k, [...new Set(ids)].slice(0, 8).join(','));
