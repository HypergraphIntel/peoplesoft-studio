/*
 * Cycle 118: Application Class metadata results of a built-in object type
 * (`property Record ObjectRecord;`, `method GetRec() Returns Record;`) and
 * the member that follows them in a postfix chain (research only).
 *
 * The type-metadata provider (`snapshotApplicationClassTypeMetadata`)
 * answers `{ kind: 'other', type }` for a property / method result that is
 * not an Application Class. The encoder's three consumers (%This
 * property, %Super property, a property / method step on a typed App
 * Class receiver) act only on `class` / `array` results, so a built-in
 * result ends the chain's typing and the next member is never a
 * reference -- whereas a source-declared `Local Record &r` makes
 * `&r.FIELD` a FIELD row.
 *
 * Independent of the encoder: every `%This.` / `%Super.` / `&var.` chain
 * in code context is walked through the provider (root types: the
 * program's own class, its parent, an `&var` declared `Local` / `Global`
 * / `Component` / `instance` / `property` / a method parameter with an
 * App Class type); each step resolves a property (`memberType`) or a
 * method result (`methodReturnType`). When a step's result is a built-in
 * type, the next member is recorded with whether stored PSPCMNAME holds
 * a FIELD row (and a RECORD row) of that name and whether the harness
 * encode currently generates one.
 *
 * Usage: npx tsx tools/corpus/research/cycle118-builtin-metadata-receiver-census.ts [--taxonomy t.json] <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { snapshotConditionalCompilation } from '../snapshot/toolsRelease';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

/** Code context: false inside strings, comments, disabled code, signature comments. */
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
    if (!matched) i++;
  }
  return code;
}

let taxonomyPath: string | undefined;
const args = process.argv.slice(2);
if (args[0] === '--taxonomy') { taxonomyPath = args[1]; args.splice(0, 2); }
const taxonomy = new Map<number, string>();
if (taxonomyPath) for (const row of JSON.parse(fs.readFileSync(taxonomyPath, 'utf8')).rows) taxonomy.set(row.definitionId, row.primaryCategory);

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const conditionalCompilation = snapshotConditionalCompilation(db);
const out = fs.openSync(args[0], 'w');
const byType = new Map<string, number>();
const byTypeNext = new Map<string, { n: number; storedField: number; storedRecord: number; generatedField: number; defs: Set<number> }>();
const missingFieldDefs = new Map<number, string>();
const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

for (const def of listSnapshotDefinitions(db) as any[]) {
  const source = String(def.sourceText ?? '');
  if (!/(%This|%Super|&\w+)\s*\.\s*\w+\s*\.\s*\w+/i.test(source)) continue;
  const app = def.objectid1 === 104;
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ev = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const selfPath = app && ev > 0 ? values.slice(0, ev) : undefined;
  const code = codeMask(source);

  // App Class typed variables declared in the source (any scope; first declaration wins)
  const typed = new Map<string, string[]>();
  for (const m of source.matchAll(/\b(?:Local|Global|Component|instance|private\s+instance)?\s*([A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)+)\s+(&\w+)/g)) {
    if (!code[m.index!]) continue;
    const name = m[2].toLowerCase();
    if (!typed.has(name)) typed.set(name, m[1].split(':').map(s => s.trim()));
  }
  for (const m of source.matchAll(/(&\w+)\s+As\s+([A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)+)/gi)) {
    const name = m[1].toLowerCase();
    if (!typed.has(name)) typed.set(name, m[2].split(':').map(s => s.trim()));
  }

  const storedRows = new Set<string>();
  for (const row of def.names) storedRows.add(`${String(row.recname ?? '').trim().toUpperCase()}.${String(row.refname ?? '').trim().toUpperCase()}`);
  let generatedRows: Set<string> | undefined;
  const generated = () => {
    if (generatedRows !== undefined) return generatedRows;
    generatedRows = new Set();
    try {
      const owner = { recordName: values[0], fieldName: values[1], packagePath: selfPath };
      const artifacts = encodeProgramArtifacts(source, { owner, applicationClassTypeMetadata: provider, conditionalCompilation } as any);
      for (const r of artifacts.references as any[]) {
        if (r.kind === 'field') generatedRows.add(`FIELD.${String(r.fieldName).toUpperCase()}`);
        if (r.kind === 'record') generatedRows.add(`RECORD.${String(r.recordName).toUpperCase()}`);
      }
    } catch { /* not encodable */ }
    return generatedRows;
  };

  for (const m of source.matchAll(/(%This|%Super|&\w+)((?:\s*\.\s*\w+(?:\s*\([^()]*(?:\([^()]*\)[^()]*)*\))?)+)/gi)) {
    if (!code[m.index!]) continue;
    const root = m[1];
    let type: string[] | undefined =
      /^%This$/i.test(root) ? selfPath
        : /^%Super$/i.test(root) ? (selfPath && provider.superclassOf(selfPath) as string[] | undefined)
          : typed.get(root.toLowerCase());
    if (type === undefined) continue;
    // call arguments removed (their own dots are not chain steps)
    let stepText = m[2];
    for (let prev = ''; prev !== stepText;) { prev = stepText; stepText = stepText.replace(/\([^()]*\)/g, '\u0001'); }
    const steps = [...stepText.matchAll(/\.\s*(\w+)(\s*\u0001)?/g)].map(s => ({ name: s[1], call: s[2] !== undefined }));
    const chain: string[] = [];
    for (let k = 0; k < steps.length && type !== undefined; k++) {
      const step = steps[k];
      chain.push(step.name + (step.call ? '()' : ''));
      const result = step.call ? provider.methodReturnType(type, step.name) : provider.memberType(type, step.name);
      if (result === undefined) break;
      if (result.kind === 'class') { type = [...result.path]; continue; }
      if (result.kind === 'array') break;
      const builtin = result.type.trim();
      count(byType, builtin);
      const next = steps[k + 1];
      if (next !== undefined) {
        const key = `${builtin} -> ${next.call ? 'method' : 'member'}`;
        const stat = byTypeNext.get(key) ?? { n: 0, storedField: 0, storedRecord: 0, generatedField: 0, defs: new Set() };
        stat.n++;
        stat.defs.add(def.definitionId);
        const storedField = storedRows.has(`FIELD.${next.name.toUpperCase()}`);
        const storedRecord = storedRows.has(`RECORD.${next.name.toUpperCase()}`);
        const generatedField = generated().has(`FIELD.${next.name.toUpperCase()}`);
        if (storedField) stat.storedField++;
        if (storedRecord) stat.storedRecord++;
        if (generatedField) stat.generatedField++;
        byTypeNext.set(key, stat);
        if (storedField && !generatedField && !next.call) missingFieldDefs.set(def.definitionId, `${root}.${chain.join('.')}.${next.name}`);
        fs.writeSync(out, JSON.stringify({
          id: def.definitionId, app, offset: m.index, root, chain: chain.join('.'), step: step.call ? 'method-result' : 'property',
          builtin, next: next.name, nextIsCall: next.call, storedField, storedRecord, generatedField,
          category: taxonomy.get(def.definitionId) ?? 'EXACT'
        }) + '\n');
      }
      break;
    }
  }
}
fs.closeSync(out);
const show = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join('\n    ');
console.log(`built-in metadata results (any position):\n    ${show(byType)}`);
console.log('built-in result followed by a member (occurrences / stored FIELD row / stored RECORD row / generated FIELD row / definitions):');
for (const [k, s] of [...byTypeNext].sort((a, b) => b[1].n - a[1].n)) console.log(`    ${k}: ${s.n} / ${s.storedField} / ${s.storedRecord} / ${s.generatedField} / ${s.defs.size}`);
console.log(`definitions with a stored FIELD row for a member after a built-in result the encoder does not generate: ${missingFieldDefs.size}`);
for (const [id, expr] of [...missingFieldDefs].sort((a, b) => a[0] - b[0])) console.log(`    ${id} ${taxonomy.get(id) ?? 'EXACT'} ${expr}`);
