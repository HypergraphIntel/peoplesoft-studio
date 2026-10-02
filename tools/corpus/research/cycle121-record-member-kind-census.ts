/*
 * Cycle 121: how stored PSPCMPROG / PSPCMNAME represent a bare member of
 * a Record value in ordinary programs -- FIELD row, RECORD.FIELD row, or
 * an inline name (research only).
 *
 * For every ordinary program the encoder handles, the stored and the
 * generated programs are decoded and their token streams aligned by
 * opcode (an inline name 0x0A and a reference operand 0x4A align as the
 * same token class). Every generated FIELD operand (and every stored
 * FIELD / RECORD.FIELD operand the encoder writes inline) is one member
 * occurrence; its stored counterpart is classified FIELD (a `FIELD.<name>`
 * row), RECORD.FIELD (a `<REC>.<name>` row), INLINE (0x0A text) or OTHER.
 *
 * The receiver construction is read from the generated tokens before the
 * member's `.`: a variable (0x01), row shorthand (a RECORD operand), or a
 * call `<name>(<args>)` -- GetRecord / GetRow / CreateRecord ..., whose
 * first argument is a RECORD operand (`Record.X`), a number literal, a
 * variable or other; a call reached through a `.` is a method call on the
 * chain before it.
 *
 * Usage: npx tsx tools/corpus/research/cycle121-record-member-kind-census.ts [--taxonomy t.json] <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { snapshotConditionalCompilation } from '../snapshot/toolsRelease';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

type Kind = 'FIELD' | 'RECORD.FIELD' | 'RECORD' | 'INLINE' | 'OTHER';

function receiverOf(tokens: any[], dot: number, kindOf: (t: any) => Kind | string): string {
  const prev = tokens[dot - 1];
  if (prev === undefined) return 'none';
  if (prev.opcode === 0x01) return 'variable';
  if (prev.opcode === 0x4a && kindOf(prev) === 'RECORD') return 'row-shorthand .REC';
  if (prev.opcode === 0x14) {
    let depth = 0, k = dot - 1;
    for (; k >= 0; k--) {
      if (tokens[k].opcode === 0x14) depth++;
      else if (tokens[k].opcode === 0x0b && --depth === 0) break;
    }
    const name = tokens[k - 1];
    const viaDot = tokens[k - 2]?.opcode === 0x05;
    const arg = tokens[k + 1];
    const argKind = arg === undefined ? '?' : arg.opcode === 0x14 ? '()' : arg.opcode === 0x4a ? (kindOf(arg) === 'RECORD' ? 'Record.X' : `ref:${kindOf(arg)}`) : arg.opcode === 0x50 ? 'number' : arg.opcode === 0x01 ? 'variable' : arg.opcode === 0x16 ? 'string' : `op${arg.opcode.toString(16)}`;
    const callName = name?.opcode === 0x0a ? String(name.text) : name?.opcode === 0x01 ? 'variable-index' : name?.opcode === 0x14 ? 'call-result-index' : `op${name?.opcode?.toString(16)}`;
    let chain = '';
    if (viaDot) {
      const before = tokens[k - 3];
      chain = before?.opcode === 0x01 ? '&var.' : before?.opcode === 0x14 ? '(...).' : before?.opcode === 0x4a ? 'REF.' : '?.';
    }
    return `${chain}${callName}(${argKind})`;
  }
  return `op${prev.opcode.toString(16)}`;
}

/** The chain's root token: walk back over `.member`, `(...)` and `[...]` steps. */
function rootOf(tokens: any[], dot: number): any {
  let k = dot - 1;
  while (k >= 0) {
    const t = tokens[k];
    if (t.opcode === 0x14 || t.opcode === 0x1e) {
      let depth = 0;
      for (; k >= 0; k--) {
        if (tokens[k].opcode === 0x14 || tokens[k].opcode === 0x1e) depth++;
        else if ((tokens[k].opcode === 0x0b || tokens[k].opcode === 0x1d) && --depth === 0) break;
      }
      k--;
      continue;
    }
    if (tokens[k - 1]?.opcode === 0x05) { k -= 2; continue; }
    return t;
  }
  return undefined;
}

/**
 * How the root variable is typed in the source (the scope is not tracked:
 * a name typed anywhere counts as typed, except that an untyped Function
 * parameter of the same name is reported).
 */
function rootDeclaration(source: string, name: string): string {
  const v = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const untypedParam = new RegExp(`\\bFunction\\s+\\w+\\s*\\([^)]*${v}\\b(?!\\s+As\\b)[^)]*\\)`, 'i').test(source);
  const typedParam = new RegExp(`${v}\\s+As\\s+\\w+`, 'i').test(source);
  const declared = new RegExp(`\\b(Local|Global|Component|ComponentLife|instance)\\s+(?:array\\s+of\\s+)*([\\w:]+)\\s+(?:&\\w+\\s*,\\s*)*${v}\\b`, 'i').exec(source);
  if (untypedParam) return declared ? `untyped Function parameter (shadows ${declared[1]} ${declared[2]})` : 'untyped Function parameter';
  if (declared) return `${declared[1]} ${declared[2]}`.replace(/^(Local|Global|Component|ComponentLife|instance) (Record|Row|Rowset|any|Field)$/i, (_, a, b) => `${a} ${b}`);
  if (typedParam) return 'typed parameter';
  return 'undeclared';
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
const matrix = new Map<string, Map<string, number>>();
const programs = new Map<string, Set<number>>();
const note = (receiver: string, cell: string, id: number) => {
  const row = matrix.get(receiver) ?? new Map();
  row.set(cell, (row.get(cell) ?? 0) + 1);
  matrix.set(receiver, row);
  const p = programs.get(receiver) ?? new Set();
  p.add(id);
  programs.set(receiver, p);
};
const normalizeReceiver = (r: string) => r.replace(/^(&var\.|\(\.\.\.\)\.|REF\.|\?\.)/, m => m).replace(/\b(GetRecord|GetRow|CreateRecord|GetRowset|GetLevel0|GetField)\b/gi, m => m[0].toUpperCase() + m.slice(1));

for (const def of listSnapshotDefinitions(db) as any[]) {
  if (def.objectid1 === 104) continue;
  const storedNames = new Map<number, [string, string]>();
  const names = new NameTable();
  for (const row of def.names) {
    const rec = String(row.recname ?? '').trim(), ref = String(row.refname ?? '').trim();
    storedNames.set(Number(row.namenum), [rec.toUpperCase(), ref.toUpperCase()]);
    names.add(Number(row.namenum), rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  let stored: any[], generated: any[], generatedKinds: Map<number, [string, string]>;
  try {
    stored = decodeProgram(def.storedProgram, names, { mode: 'auto', isApplicationClass: false } as any).tokens;
    const values = [def.objectvalue1, def.objectvalue2].map((v: string) => (v ?? '').trim());
    const artifacts = encodeProgramArtifacts(String(def.sourceText), { owner: { recordName: values[0], fieldName: values[1] }, applicationClassTypeMetadata: provider, conditionalCompilation } as any);
    generatedKinds = new Map();
    const gnames = new NameTable();
    for (const r of artifacts.references as any[]) {
      const pair: [string, string] =
        r.kind === 'field' ? ['FIELD', String(r.fieldName).toUpperCase()]
          : r.kind === 'record' ? ['RECORD', String(r.recordName).toUpperCase()]
            : r.kind === 'record-field' || (r.recordName && r.fieldName) ? [String(r.recordName).toUpperCase(), String(r.fieldName).toUpperCase()]
              : [String(r.kind).toUpperCase(), String(r.packageName ?? r.objectName ?? r.recordName ?? r.fieldName ?? '').toUpperCase()];
      // a generated reference's index is 0-based (the owner row is index 0, NAMENUM 1)
      generatedKinds.set(Number(r.index) + 1, pair);
      gnames.add(Number(r.index) + 1, pair[1] ? `${pair[0]}.${pair[1]}` : pair[0]);
    }
    generated = decodeProgram(artifacts.program, gnames, { mode: 'auto', isApplicationClass: false } as any).tokens;
  } catch { continue; }
  const kindFrom = (map: Map<number, [string, string]>) => (t: any): Kind => {
    if (t.opcode === 0x0a) return 'INLINE';
    if (t.opcode !== 0x4a) return 'OTHER';
    const pair = map.get(t.nameNum);
    if (pair === undefined) return 'OTHER';
    if (pair[0] === 'FIELD') return 'FIELD';
    if (pair[0] === 'RECORD') return 'RECORD';
    if (['PACKAGE', 'SCROLL', 'COMPONENT', 'PAGE', 'MENUNAME', 'SQL', 'IMAGE', 'FUNCLIB'].includes(pair[0])) return 'OTHER';
    return 'RECORD.FIELD';
  };
  const gKind = kindFrom(generatedKinds), sKind = kindFrom(storedNames);
  // align by opcode class (0x0A ~ 0x4A)
  const cls = (t: any) => (t.opcode === 0x4a || t.opcode === 0x0a ? 'N' : t.opcode.toString(16));
  const ga = generated.map(cls), sa = stored.map(cls);
  // simple LCS-free alignment: walk both while classes agree; resync on mismatch by lookahead
  let i = 0, j = 0;
  while (i < generated.length && j < stored.length) {
    if (ga[i] !== sa[j]) {
      let resynced = false;
      for (let d = 1; d <= 6 && !resynced; d++) {
        if (ga[i + d] === sa[j] && ga.slice(i + d, i + d + 4).join() === sa.slice(j, j + 4).join()) { i += d; resynced = true; }
        else if (ga[i] === sa[j + d] && ga.slice(i, i + 4).join() === sa.slice(j + d, j + d + 4).join()) { j += d; resynced = true; }
      }
      if (!resynced) break;
      continue;
    }
    const g = generated[i], s = stored[j];
    if (ga[i] === 'N' && generated[i - 1]?.opcode === 0x05) {
      const gk = gKind(g), sk = sKind(s);
      const interesting = gk === 'FIELD' || sk === 'FIELD' || sk === 'RECORD.FIELD' && gk !== 'RECORD.FIELD';
      if (interesting && !(gk === 'INLINE' && sk === 'INLINE')) {
        const receiver = normalizeReceiver(receiverOf(generated, i - 1, gKind));
        const root = rootOf(generated, i - 1);
        const rootKind = root?.opcode === 0x01 ? rootDeclaration(String(def.sourceText), String(root.text)) : root?.opcode === 0x0a ? `call ${root.text}` : root?.opcode === 0x4a ? 'reference' : `op${root?.opcode?.toString(16)}`;
        note(`ROOT ${rootKind.replace(/ \(shadows.*\)/, ' (shadows a typed variable)').replace(/^(Local|Global|Component|ComponentLife|instance) (?!Record|Row|Rowset|any|Field)\S+$/i, '$1 <other type>')}`, `gen ${gk} / stored ${sk}`, def.definitionId);
        note(receiver, `gen ${gk} / stored ${sk}`, def.definitionId);
        fs.writeSync(out, JSON.stringify({ id: def.definitionId, receiver, root: root?.text, rootKind, member: String(g.text ?? ''), generated: gk, stored: sk, category: taxonomy.get(def.definitionId) ?? 'EXACT' }) + '\n');
      }
    }
    i++; j++;
  }
}
fs.closeSync(out);
console.log('receiver construction: generated kind / stored kind counts (programs)');
for (const [r, cells] of [...matrix].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
  console.log(`  ${r} (${programs.get(r)!.size} programs)`);
  for (const [c, n] of [...cells].sort((a, b) => b[1] - a[1])) console.log(`      ${c}: ${n}`);
}
