/*
 * Cycle 110: the PACKAGE-only Application Class "external" population of
 * the Cycle 102 rerank, re-examined (research only).
 *
 * Population: every NONEXACT Application Class program whose non-PACKAGE
 * rows agree with stored while its PACKAGE rows do not, and whose first
 * PACKAGE divergence names a row the Cycle 102 rerank tagged `external`
 * (not a built-in in BUILTIN_TYPE_REGISTRY, not named-imported, not the
 * program's own class, no snapshot class of that name under a
 * wildcard-imported package). Each program is encoded twice -- WITHOUT the
 * snapshot type metadata (how the rerank encoded before Cycle 110) and
 * WITH it (how the harness encodes since Cycle 107) -- and the first
 * PACKAGE divergence is reported for both.
 *
 * For the stored row at fault: NAMENUM, PACKAGEROOT, QUALIFYPATH,
 * APPCLASSMETHOD; built-in signature (descriptive stores root a built-in
 * row at the type itself, an Application Class row at its package);
 * whether the name is written in the program as a declared type (Local,
 * Component, Global, parameter `As`, `Returns`, property, instance), only
 * elsewhere (e.g. as a member name), or not at all; and which snapshot
 * classes carry the name.
 *
 * Usage: npx tsx tools/corpus/research/cycle110-app-class-package-only-census.ts [--taxonomy t.json] [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { listSnapshotApplicationClassDefinitions, snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';

const ROOT = path.join(__dirname, '../../..');
const taxonomyIndex = process.argv.indexOf('--taxonomy');
const taxonomy = JSON.parse(fs.readFileSync(taxonomyIndex >= 0 ? process.argv[taxonomyIndex + 1] : path.join(ROOT, '.claude/nonexact-taxonomy.json'), 'utf8'));
const nonexact = new Set<number>(taxonomy.rows.map((r: any) => r.definitionId));

const clean = (s: string) => s
  .replace(/<\*[\s\S]*?\*>/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\+[\s\S]*?\+\//g, ' ')
  .replace(/"(?:[^"]|"")*"/g, '""')
  .replace(/(^|;)\s*rem\b[^;]*;/gim, '$1');

function key(g: any): string {
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

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const classesByLeaf = new Map<string, string[]>();
for (const d of listSnapshotApplicationClassDefinitions(db)) {
  const leaf = d.path[d.path.length - 1].toUpperCase();
  classesByLeaf.set(leaf, [...(classesByLeaf.get(leaf) ?? []), d.path.join(':')]);
}

const records: any[] = [];
for (const def of listSnapshotDefinitions(db) as any[]) {
  if (def.objectid1 !== 104 || !nonexact.has(def.definitionId)) continue;
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const ownPath = values.slice(0, event < 0 ? values.length : event).filter(Boolean);
  const owner = { recordName: values[0], fieldName: values[1], packagePath: ownPath };
  const storedRows = [...def.names].sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum)).slice(1);
  const stored = storedRows.map((r: any) => `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`);
  const text = clean(String(def.sourceText ?? ''));
  const imports = [...text.matchAll(/\bimport\s+([%\w:*]+)\s*;/gi)].map(m => m[1].toUpperCase());

  const divergence = (metadata: boolean) => {
    let generated: string[];
    try {
      generated = encodeProgramArtifacts(def.sourceText, { owner, applicationClassTypeMetadata: metadata ? provider : undefined } as any)
        .references.filter((r: any) => r.kind !== 'owner').map(key);
    } catch { return undefined; }
    const isPackage = (k?: string) => k?.startsWith('PACKAGE.') === true;
    const nonPackage = (l: string[]) => l.filter(k => !isPackage(k)).join('|');
    const packageOnly = stored.filter(isPackage).join('|') !== generated.filter(isPackage).join('|') && nonPackage(stored) === nonPackage(generated);
    let i = 0;
    while (i < Math.max(stored.length, generated.length) && stored[i] === generated[i]) i++;
    const s = stored[i], g = generated[i];
    if (!isPackage(s) && !isPackage(g)) return { packageOnly, namesExact: i >= Math.max(stored.length, generated.length), index: i, identity: undefined as string | undefined, mechanism: 'none' };
    const identity = isPackage(s) ? s : g;
    const mechanism = isPackage(s) && !generated.includes(s) ? 'MISSING'
      : isPackage(g) && !stored.includes(g) ? 'EXTRA'
      : 'ORDERING';
    return { packageOnly, namesExact: false, index: i, identity, mechanism };
  };
  const without = divergence(false);
  if (without === undefined || !without.packageOnly || without.identity === undefined) continue;
  const name = without.identity.slice('PACKAGE.'.length);
  const external = !isBuiltinObjectTypeName(name) &&
    !imports.some(p => p.endsWith(':' + name)) &&
    ownPath[ownPath.length - 1]?.toUpperCase() !== name &&
    !imports.some(p => p.endsWith(':*') && (classesByLeaf.get(name) ?? []).some(c => c.toUpperCase().startsWith(p.slice(0, -1))));
  if (!external) continue;
  const withMetadata = divergence(true)!;

  const atFault = withMetadata.identity ?? without.identity;
  const faultName = atFault.slice('PACKAGE.'.length);
  const row = storedRows.find((r: any) => String(r.recname).trim() === 'PACKAGE' && String(r.refname).trim().toUpperCase() === faultName);
  const declared = [
    ['Local', /\bLocal\s+(?:array\s+of\s+)*NAME\s+&/], ['Component', /\bComponent\s+(?:array\s+of\s+)*NAME\s+&/],
    ['Global', /\bGlobal\s+(?:array\s+of\s+)*NAME\s+&/], ['As', /&\w+\s+As\s+(?:array\s+of\s+)*NAME\b(?!\s*:)/],
    ['Returns', /\bReturns\s+(?:array\s+of\s+)*NAME\b(?!\s*:)/], ['property', /\bproperty\s+(?:array\s+of\s+)*NAME\s+\w/],
    ['instance', /\binstance\s+(?:array\s+of\s+)*NAME\s+&/]
  ].filter(([, re]) => new RegExp((re as RegExp).source.replace('NAME', faultName), 'i').test(text)).map(([c]) => c);
  const written = new RegExp(`(?<![\\w&])${faultName}(?!\\w)`, 'i').test(text);
  const root = String(row?.packageroot ?? '').trim();
  records.push({
    id: def.definitionId, cls: ownPath.join(':'), category: taxonomy.rows.find((r: any) => r.definitionId === def.definitionId)?.primaryCategory,
    withoutMetadata: without, withMetadata,
    row: row && { namenum: Number(row.namenum), root, qualify: String(row.qualifypath ?? '').trim(), method: String(row.appclassmethod ?? '').trim(), name: faultName },
    signature: root === '' ? 'old store' : root.toUpperCase() === faultName ? 'built-in (self-rooted)' : `class (${root})`,
    declaredAs: declared, visibility: declared.length > 0 ? 'declared type' : written ? 'written, not as a type' : 'not in source',
    snapshotClasses: classesByLeaf.get(faultName) ?? [],
    imports: imports.filter(p => p.endsWith(':*')).length > 0 ? 'wildcard' : imports.length > 0 ? 'named only' : 'none'
  });
}
for (const r of records) {
  console.log([
    r.id, r.cls.padEnd(48), (r.withoutMetadata.mechanism + ' ' + r.withoutMetadata.identity).padEnd(38), '->',
    r.withMetadata.namesExact ? 'NAMES-EXACT' : r.withMetadata.packageOnly ? `${r.withMetadata.mechanism} ${r.withMetadata.identity}` : `${r.withMetadata.mechanism} ${r.withMetadata.identity ?? ''} (not package-only)`,
    '|', r.signature, '|', r.visibility, r.declaredAs.join('/'), '|', r.snapshotClasses.length ? r.snapshotClasses.join(',') : 'no snapshot class'
  ].join(' '));
}
console.log(`${records.length} programs; names-exact with metadata: ${records.filter(r => r.withMetadata.namesExact).length}`);
const jsonIndex = process.argv.indexOf('--json');
if (jsonIndex >= 0) fs.writeFileSync(process.argv[jsonIndex + 1], JSON.stringify(records, null, 1));
