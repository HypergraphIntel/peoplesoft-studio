/*
 * Cycle 93: wildcard-import PACKAGE row census (research only).
 *
 * `import PKG:*;` stores a PSPCMNAME row RECNAME=PACKAGE with a BLANK
 * REFNAME. For every definition this counts the wildcard imports in the
 * source (comments stripped) and the stored blank-REFNAME PACKAGE rows,
 * split by whether the definition is an Application Class, and lists the
 * position of each blank row among the stored rows. It also counts named
 * imports whose class name repeats under different package paths against
 * the stored PACKAGE rows for that class name.
 *
 * Usage: npx tsx tools/corpus/research/cycle93-wildcard-import-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';

function stripComments(source: string): string {
  return source
    .replace(/<\*[\s\S]*?\*>/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*rem\b[^;]*;/gim, ' ')
    .replace(/"(?:[^"]|"")*"/g, '""');
}

const tally = new Map<string, number[]>();
const add = (key: string, id: number) => {
  const list = tally.get(key) ?? [];
  list.push(id);
  tally.set(key, list);
};

for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  const source = stripComments(String(def.sourceText ?? ''));
  const imports = [...source.matchAll(/\bimport\s+([A-Za-z0-9_:]+?):(\*|[A-Za-z0-9_]+)\s*;/gi)];
  const wildcards = imports.filter(m => m[2] === '*');
  if (wildcards.length === 0) continue;
  const rows = [...def.names].sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum));
  const blankRows = rows.filter((r: any) => String(r.recname).trim().toUpperCase() === 'PACKAGE' && String(r.refname ?? '').trim() === '');
  const distinctPackages = new Set(wildcards.map(m => m[1].toUpperCase())).size;
  const kind = def.objectid1 === 104 ? 'appclass' : 'other';
  const named = imports.length - wildcards.length;
  add(`${kind} wildcardImports=${Math.min(wildcards.length, 4)}${wildcards.length > 4 ? '+' : ''} distinct=${Math.min(distinctPackages, 4)} storedBlankRows=${blankRows.length} firstBlankAt=${blankRows.length ? blankRows.map((r: any) => Number(r.namenum)).slice(0, 3).join('/') : '-'} namedImports=${named > 0 ? 'y' : 'n'} firstImportIsWildcard=${imports[0][2] === '*'}`, def.definitionId);
}
for (const [key, ids] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(String(ids.length).padStart(6), key, ids.slice(0, 6).join(','));
}
