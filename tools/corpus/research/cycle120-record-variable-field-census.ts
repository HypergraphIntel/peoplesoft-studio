/*
 * Cycle 120: bare members of source-declared Record variables in
 * Application Class programs, by declaration context, against stored and
 * generated FIELD rows (research only).
 *
 * A variable is Record-typed by (first match wins, in this order): the
 * class header (`instance Record &x`, `property Record X` -> `&X`), a
 * `Global` / `Component` / `ComponentLife Record &x` declaration, a method
 * parameter `&x As Record`, a `Local Record &x`, or -- with none of those
 * -- an assignment `&x = CreateRecord(...)`. Each bare member `&x.NAME`
 * in code context (not a call `&x.NAME(`) is one occurrence; stored /
 * generated FIELD rows are looked up by name (FIELD identity is the field
 * name, Cycle 119). Built-in Record members (Name, FieldCount, IsChanged
 * ...) are counted separately.
 *
 * Usage: npx tsx tools/corpus/research/cycle120-record-variable-field-census.ts [--taxonomy t.json] <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { snapshotConditionalCompilation } from '../snapshot/toolsRelease';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

function codeMask(source: string): Uint8Array {
  const n = source.length;
  const code = new Uint8Array(n).fill(1);
  for (let i = 0; i < n;) {
    if (source[i] === '"') {
      const s = i++;
      while (i < n) { if (source[i] === '"') { if (source[i + 1] === '"') { i += 2; continue; } i++; break; } i++; }
      code.fill(0, s, i);
      continue;
    }
    let matched = false;
    for (const [open, close] of [['/*', '*/'], ['<*', '*>'], ['/+', '+/']]) {
      if (source.startsWith(open, i)) {
        const e = source.indexOf(close, i + 2);
        const end = e < 0 ? n : e + 2;
        code.fill(0, i, end);
        i = end;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (/^rem\b/i.test(source.slice(i, i + 4)) && (i === 0 || /[;\s]/.test(source[i - 1]))) {
      const e = source.indexOf(';', i);
      const end = e < 0 ? n : e + 1;
      code.fill(0, i, end);
      i = end;
      continue;
    }
    i++;
  }
  return code;
}

const INTRINSIC = /^(Name|FieldCount|IsChanged|IsDeleted|IsNew|IsEditError|RelLangRecName|ParentRow|DBRecordName|IsSelected|Selected|RowNumber|Visible)$/i;

let taxonomyPath: string | undefined;
const args = process.argv.slice(2);
if (args[0] === '--taxonomy') { taxonomyPath = args[1]; args.splice(0, 2); }
const taxonomy = new Map<number, string>();
if (taxonomyPath) for (const row of JSON.parse(fs.readFileSync(taxonomyPath, 'utf8')).rows) taxonomy.set(row.definitionId, row.primaryCategory);

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const conditionalCompilation = snapshotConditionalCompilation(db);
const out = fs.openSync(args[0], 'w');
const matrix = new Map<string, { variables: Set<string>; occurrences: number; intrinsic: number; storedField: number; generatedField: number; programs: Set<number> }>();
const missingByContext = new Map<string, Set<number>>();

for (const def of listSnapshotDefinitions(db) as any[]) {
  if (def.objectid1 !== 104) continue;
  const source = String(def.sourceText ?? '');
  if (!/\bRecord\b/i.test(source)) continue;
  const code = codeMask(source);
  const contexts = new Map<string, string>();
  const declare = (name: string, context: string) => { const key = name.toLowerCase(); if (!contexts.has(key)) contexts.set(key, context); };
  const header = /\bclass\s+\w+[\s\S]*?\bend-class\b/i.exec(source);
  if (header) {
    const h = header[0], base = header.index;
    for (const m of h.matchAll(/\binstance\s+Record\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) if (code[base + m.index!]) for (const v of m[1].split(',')) declare(v.trim(), 'instance');
    for (const m of h.matchAll(/\bproperty\s+Record\s+(\w+)/gi)) if (code[base + m.index!]) declare(`&${m[1]}`, 'property');
  }
  for (const [re, ctx] of [[/\bComponentLife\s+Record\s+(&\w+(?:\s*,\s*&\w+)*)/gi, 'ComponentLife'], [/\bGlobal\s+Record\s+(&\w+(?:\s*,\s*&\w+)*)/gi, 'Global'], [/\bComponent\s+Record\s+(&\w+(?:\s*,\s*&\w+)*)/gi, 'Component']] as const) {
    for (const m of source.matchAll(re)) if (code[m.index!]) for (const v of m[1].split(',')) declare(v.trim(), ctx);
  }
  for (const m of source.matchAll(/(&\w+)\s+As\s+Record\b/gi)) if (code[m.index!]) declare(m[1], 'parameter');
  for (const m of source.matchAll(/\bLocal\s+Record\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) if (code[m.index!]) for (const v of m[1].split(',')) declare(v.trim(), 'Local');
  for (const m of source.matchAll(/(&\w+)\s*=\s*CreateRecord\s*\(/gi)) if (code[m.index!]) declare(m[1], 'CreateRecord-assigned');
  if (contexts.size === 0) continue;

  const storedFields = new Set<string>();
  for (const row of def.names) if (String(row.recname ?? '').trim().toUpperCase() === 'FIELD') storedFields.add(String(row.refname ?? '').trim().toUpperCase());
  let generatedFields: Set<string> | undefined;
  const generated = () => {
    if (generatedFields) return generatedFields;
    generatedFields = new Set();
    try {
      const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
      const ev = values.findIndex(v => v.toLowerCase() === 'onexecute');
      const artifacts = encodeProgramArtifacts(source, { owner: { recordName: values[0], fieldName: values[1], packagePath: ev > 0 ? values.slice(0, ev) : undefined }, applicationClassTypeMetadata: provider, conditionalCompilation } as any);
      for (const r of artifacts.references as any[]) if (r.kind === 'field') generatedFields.add(String(r.fieldName).toUpperCase());
    } catch { /* not encodable */ }
    return generatedFields;
  };

  for (const m of source.matchAll(/(&\w+)\s*\.\s*(\w+)(\s*\()?/g)) {
    if (!code[m.index!]) continue;
    const context = contexts.get(m[1].toLowerCase());
    if (context === undefined || m[3] !== undefined) continue;
    const name = m[2].toUpperCase();
    const stat = matrix.get(context) ?? { variables: new Set(), occurrences: 0, intrinsic: 0, storedField: 0, generatedField: 0, programs: new Set() };
    stat.variables.add(`${def.definitionId}:${m[1].toLowerCase()}`);
    stat.programs.add(def.definitionId);
    if (INTRINSIC.test(name)) { stat.intrinsic++; matrix.set(context, stat); continue; }
    stat.occurrences++;
    const storedField = storedFields.has(name), generatedField = generated().has(name);
    if (storedField) stat.storedField++;
    if (generatedField) stat.generatedField++;
    matrix.set(context, stat);
    if (storedField && !generatedField) {
      const set = missingByContext.get(context) ?? new Set();
      set.add(def.definitionId);
      missingByContext.set(context, set);
    }
    fs.writeSync(out, JSON.stringify({ id: def.definitionId, offset: m.index, variable: m[1], context, member: name, storedField, generatedField, category: taxonomy.get(def.definitionId) ?? 'EXACT' }) + '\n');
  }
}
fs.closeSync(out);
console.log('declaration context: variables / programs / bare-member occurrences / stored FIELD / generated FIELD / intrinsic members');
for (const [k, s] of [...matrix].sort((a, b) => b[1].occurrences - a[1].occurrences)) {
  console.log(`    ${k}: ${s.variables.size} / ${s.programs.size} / ${s.occurrences} / ${s.storedField} / ${s.generatedField} / ${s.intrinsic}`);
}
console.log('programs with a stored FIELD row the encoder does not generate, by context:');
for (const [k, set] of missingByContext) console.log(`    ${k}: ${set.size} -- ${[...set].slice(0, 12).join(', ')}`);
