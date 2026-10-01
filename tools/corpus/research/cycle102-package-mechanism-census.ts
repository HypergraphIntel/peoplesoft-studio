/*
 * Cycle 102: rerank the PACKAGE reference failures by first true mechanism
 * (research only; drives the next cycle).
 *
 * For every NONEXACT definition in `.claude/nonexact-taxonomy.json` that
 * encodes, compare the stored PSPCMNAME list (row 1 excluded) with the
 * generated reference list, in row order:
 *
 *   PACKAGE-only   the non-PACKAGE rows agree exactly (same keys, same order)
 *                  and the PACKAGE rows do not;
 *   first PACKAGE  the first differing row is a PACKAGE row on either side.
 *
 * The first differing PACKAGE row is classified (s = stored key, g =
 * generated key at that index):
 *
 *   STORED_OPENS_GENERATED_REUSES  s = PACKAGE.X, generated already has X
 *                                  earlier (stored allocates a fresh row)
 *   STORED_REUSES_GENERATED_OPENS  g = PACKAGE.Y, stored already has Y earlier
 *   GENERATED_MISSING_IDENTITY     stored has X, generated never does
 *   GENERATED_EXTRA_IDENTITY       generated has Y, stored never does
 *   ORDERING                       the row exists on the other side, later
 *   WRONG_IDENTITY                 s = PACKAGE.X, g = PACKAGE.Y, X / Y each
 *                                  absent from the other side
 *
 * and the identity at fault (X, else Y) is tagged:
 *
 *   builtin           a BUILTIN_TYPE_REGISTRY type (Record, Rowset, ...)
 *   named-import      `import ...:X;` in the source
 *   wildcard-import   only a wildcard import can supply it, and a snapshot
 *                     Application Class X exists under that package
 *   external          not builtin, not named-imported, and no snapshot
 *                     Application Class X under any wildcard-imported
 *                     package (needs metadata the snapshot lacks)
 *   self              X is the definition's own class
 *   method            the generated row at fault carries a methodName
 *
 * plus whether the definition is an Application Class.
 *
 * Usage: npx tsx tools/corpus/research/cycle102-package-mechanism-census.ts [--taxonomy t.json] [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const ROOT = path.join(__dirname, '../../..');

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

/* BUILTIN_TYPE_REGISTRY is private to the encoder; read its keys from source. */
function builtinTypes(): Set<string> {
  const source = fs.readFileSync(path.join(ROOT, 'src/peoplecode/encoder.ts'), 'utf8');
  const start = source.indexOf('const BUILTIN_TYPE_REGISTRY');
  const block = source.slice(start, source.indexOf('\n);', start));
  return new Set([...block.matchAll(/^\s*\['(\w+)', \[/gm)].map(m => m[1].toUpperCase()));
}

const taxonomyIndex = process.argv.indexOf('--taxonomy');
const taxonomyPath = taxonomyIndex >= 0 ? process.argv[taxonomyIndex + 1] : path.join(ROOT, '.claude/nonexact-taxonomy.json');
const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));
const category = new Map<number, string>(taxonomy.rows.map((r: any) => [r.definitionId, r.primaryCategory]));
const builtins = builtinTypes();

const definitions = listSnapshotDefinitions(openSnapshotDatabase()) as any[];
/* Snapshot Application Classes: class name -> package roots that define it. */
const classPackages = new Map<string, Set<string>>();
for (const def of definitions) {
  if (def.objectid1 !== 104) continue;
  const path_ = context(def).packagePath;
  const name = path_[path_.length - 1]?.toUpperCase();
  if (!name) continue;
  const roots = classPackages.get(name) ?? new Set<string>();
  for (let i = 1; i < path_.length; i++) roots.add(path_.slice(0, i).join(':').toUpperCase());
  classPackages.set(name, roots);
}

const tally = new Map<string, number[]>();
const add = (key: string, id: number) => { const l = tally.get(key) ?? []; l.push(id); tally.set(key, l); };
const rows: any[] = [];
let packageOnly = 0;
let firstPackage = 0;

for (const def of definitions) {
  if (!category.has(def.definitionId)) continue;
  let artifacts: any;
  try { artifacts = encodeProgramArtifacts(def.sourceText, { owner: context(def) } as any); } catch { continue; }
  const generatedRows = artifacts.references.filter((r: any) => r.kind !== 'owner');
  const generated = generatedRows.map(generatedKey);
  const stored = def.names.slice(1).map((r: any) => `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`);
  const isPackage = (k: string | undefined) => k?.startsWith('PACKAGE.') === true;

  const nonPackage = (list: string[]) => list.filter(k => !isPackage(k)).join('|');
  const packageRowsDiffer = stored.filter(isPackage).join('|') !== generated.filter(isPackage).join('|');
  const onlyPackage = packageRowsDiffer && nonPackage(stored) === nonPackage(generated);
  if (onlyPackage) packageOnly++;

  let i = 0;
  while (i < Math.max(stored.length, generated.length) && stored[i] === generated[i]) i++;
  const s = stored[i], g = generated[i];
  if (!isPackage(s) && !isPackage(g)) continue;
  firstPackage++;

  let mechanism: string;
  let identity: string;
  let generatedAtFault: any;
  if (isPackage(s) && isPackage(g)) {
    identity = s;
    const sLater = generated.indexOf(s, i) > i, gLater = stored.indexOf(g, i) > i;
    mechanism = sLater || gLater ? 'ORDERING' : 'WRONG_IDENTITY';
    generatedAtFault = generatedRows[i];
  } else if (isPackage(s)) {
    identity = s;
    mechanism = generated.slice(0, i).includes(s) ? 'STORED_OPENS_GENERATED_REUSES'
      : generated.indexOf(s, i) > i ? 'ORDERING' : 'GENERATED_MISSING_IDENTITY';
    generatedAtFault = generatedRows[generated.lastIndexOf(s, i)];
  } else {
    identity = g;
    mechanism = stored.slice(0, i).includes(g) ? 'STORED_REUSES_GENERATED_OPENS'
      : stored.indexOf(g, i) > i ? 'ORDERING' : 'GENERATED_EXTRA_IDENTITY';
    generatedAtFault = generatedRows[i];
  }

  const name = identity.slice('PACKAGE.'.length);
  const imports = [...String(def.sourceText).matchAll(/^\s*import\s+([\w:*]+)\s*;/gim)].map(m => m[1].toUpperCase());
  const ownPath = context(def).packagePath;
  let source: string;
  if (builtins.has(name)) source = 'builtin';
  else if (def.objectid1 === 104 && ownPath[ownPath.length - 1]?.toUpperCase() === name) source = 'self';
  else if (imports.some(p => p.endsWith(':' + name))) source = 'named-import';
  else if (imports.some(p => p.endsWith(':*') && classPackages.get(name)?.has(p.slice(0, -2)))) source = 'wildcard-import';
  else source = 'external';
  const tags = [source, generatedAtFault?.methodName ? 'method' : '', def.objectid1 === 104 ? 'app' : 'ordinary'].filter(Boolean).join(' ');

  add(`${mechanism.padEnd(31)} ${tags.padEnd(30)} ${onlyPackage ? 'package-only' : 'mixed'} ${category.get(def.definitionId)}`, def.definitionId);
  rows.push({ id: def.definitionId, category: category.get(def.definitionId), mechanism, identity, source, method: !!generatedAtFault?.methodName, app: def.objectid1 === 104, packageOnly: onlyPackage });
}

console.log(`NONEXACT ${category.size}; PACKAGE-only ${packageOnly}; first divergence is a PACKAGE row ${firstPackage}`);
const by = (f: (r: any) => string) => {
  const c = new Map<string, number>();
  for (const r of rows) c.set(f(r), (c.get(f(r)) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(5)} ${k}`).join('\n');
};
console.log('\n-- by mechanism\n' + by(r => r.mechanism));
console.log('\n-- by identity source\n' + by(r => r.source + (r.method ? ' method' : '')));
console.log('\n-- by mechanism x source\n' + by(r => `${r.mechanism} / ${r.source}${r.method ? ' method' : ''} / ${r.app ? 'app' : 'ordinary'}`));
console.log('\n-- detail');
for (const [key, ids] of [...tally].sort((a, b) => b[1].length - a[1].length)) console.log(String(ids.length).padStart(5), key, ids.slice(0, 8).join(','));
const jsonIndex = process.argv.indexOf('--json');
if (jsonIndex >= 0) fs.writeFileSync(process.argv[jsonIndex + 1], JSON.stringify(rows));
