/*
 * Cycle 168: App Class property chains and metadata method results
 * (research only).
 *
 * Sections (all by default, or one with `--section <name>`):
 *   superclass  corpus App Classes whose `extends` class the metadata
 *               provider cannot resolve (`superclassOf` undefined) --
 *               `%Super.<prop>` is then never looked up, and never traced;
 *   named       class paths written in corpus code (comments / strings
 *               masked, wildcard imports and %-paths excluded) that are
 *               neither corpus nor captured classes;
 *   chains      `%Super.P.M()`, `%Super.P.Q`, `%This.P.P.M()` programs;
 *   results     members after a call whose result the provider types
 *               Row / Record / Rowset / Field: bare member, intrinsic,
 *               method, none; stored row of the member's name.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle168-chain-census.ts --taxonomy t.json [--section <name>]
 */
import fs from 'node:fs';

import { maskNonCode, parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { listSnapshotApplicationClassDefinitions, snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { listSnapshotCapturedApplicationClasses } from '../snapshot/capturedApplicationClasses';
import { openSnapshotDatabase } from '../snapshot/store';
import { openHarnessContext, encodeAsHarness, isApplicationClass, storedReferenceKeys } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const nonexact = new Set<number>(taxonomyRows.map(r => r.definitionId));
const sectionArg = args.indexOf('--section');
const only = sectionArg >= 0 ? args[sectionArg + 1] : undefined;
const run = (name: string) => only === undefined || only === name;
const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const known = new Set([
  ...listSnapshotApplicationClassDefinitions(db).map(d => d.path.join(':').toLowerCase()),
  ...listSnapshotCapturedApplicationClasses(db).map(c => c.path.join(':').toLowerCase())
]);
const ctx = openHarnessContext();
let section = '';
const tally = new Map<string, Set<number>[]>();
const add = (label: string, id: number) => {
  const key = `${section}\u0000${label}`;
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[nonexact.has(id) ? 1 : 0].add(id);
};
const flush = (name: string, title: string) => {
  console.log(`== ${name}: ${title}`);
  for (const [key, [exact, non]] of [...tally].sort((a, b) => b[1][1].size - a[1][1].size || (a[0] < b[0] ? -1 : 1))) {
    const [owner, label] = key.split('\u0000'); if (owner !== name) continue;
    console.log(`  ${label.padEnd(78)} EXACT ${String(exact.size).padStart(4)}  non ${String(non.size).padStart(3)}  e.g. ${[...exact].slice(0, 4).join(' ')}${non.size ? ` | non ${[...non].slice(0, 10).join(' ')}` : ''}`);
  }
};
const classPath = (def: any) => {
  const values = [1, 2, 3, 4, 5, 6, 7].map(n => String(def[`objectvalue${n}`] ?? '').trim());
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  return values.slice(0, event < 0 ? values.length : event).filter(Boolean);
};
const INTRINSIC = /^(Value|Name|RowNumber|IsChanged|ActiveRowCount|ParentRow|ParentRowset|Visible|Selected|IsNew|IsDeleted|FieldCount|RecordCount)$/i;

for (const def of ctx.definitions as any[]) {
  const appClass = isApplicationClass(def);
  const code = maskNonCode(def.sourceText);
  section = 'superclass';
  if (run('superclass') && appClass) {
    const base = parseApplicationClassSource(def.sourceText)?.extendsType?.trim();
    if (base && base.includes(':') && provider.superclassOf(classPath(def)) === undefined) add(base, def.definitionId);
  }
  section = 'named';
  if (run('named')) {
    const text = code.replace(/"(?:[^"\n]|"")*"/g, m => ' '.repeat(m.length));
    for (const m of text.matchAll(/(?<![%\w:.&])([A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)+)(?![\w:]|\s*:\s*\*)/g)) {
      const path = m[1].replace(/\s+/g, '');
      if (!known.has(path.toLowerCase())) add(path, def.definitionId);
    }
  }
  section = 'chains';
  if (run('chains') && appClass) {
    for (const [label, re] of [['%Super.P.M()', /%Super\s*\.\s*\w+\s*\.\s*\w+\s*\(/i], ['%Super.P.Q', /%Super\s*\.\s*\w+\s*\.\s*\w+(?!\s*\()/i], ['%This.P.P.M()', /%This\s*\.\s*\w+\s*\.\s*\w+\s*\.\s*\w+\s*\(/i]] as const) {
      if ((re as RegExp).test(code)) add(label, def.definitionId);
    }
  }
  section = 'results';
  if (run('results')) {
    const types = new Map<string, string>();
    encodeAsHarness(ctx, def, {
      applicationClassTypeMetadataTrace: (e: any) => {
        if (e.kind === 'method-result' && e.result?.kind === 'other') types.set(e.member.toLowerCase(), e.result.type.trim());
      }
    } as any);
    const stored = storedReferenceKeys(def);
    for (const [member, type] of types) {
      if (!/^(Row|Record|Rowset|Field)$/i.test(type)) continue;
      for (const x of code.matchAll(new RegExp(`\\.\\s*${member}\\s*\\(`, 'gi'))) {
        let i = x.index! + x[0].length - 1, depth = 0;
        for (; i < code.length; i++) { if (code[i] === '(') depth++; else if (code[i] === ')' && --depth === 0) break; }
        const m = /^\s*\.\s*(\w+)\s*(\()?/.exec(code.slice(i + 1));
        const scope = appClass ? 'App Class' : 'ordinary';
        if (!m) { add(`${scope} | returns ${type} | no member`, def.definitionId); continue; }
        const name = m[1].toUpperCase();
        const row = /^row$/i.test(type) ? stored.includes(`RECORD.${name}`) : /^record$/i.test(type) ? stored.includes(`FIELD.${name}`) : stored.some(k => k.endsWith(`.${name}`));
        const shape = m[2] ? 'method' : INTRINSIC.test(name) ? `intrinsic .${name}` : 'bare member';
        add(`${scope} | returns ${type} | ${shape} | stored row of the name: ${row}`, def.definitionId);
      }
    }
  }
}
if (run('superclass')) flush('superclass', 'App Classes whose superclass the provider cannot resolve');
if (run('named')) flush('named', 'class paths in corpus code unknown to the provider');
if (run('chains')) flush('chains', '%Super / %This property chains');
if (run('results')) flush('results', 'members after a metadata-typed built-in method result');
