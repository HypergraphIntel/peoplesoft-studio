/*
 * Cycle 112: the Cycle 93 external-metadata fallback, decomposed
 * (research only).
 *
 * For every ordinary program the harness encodes in the fallback
 * (`onExternalMetadataFallback`), three PSPCMNAME lists:
 *
 *   A  the NORMAL encoding (allocation units, Cycle 93 / 94 rules) --
 *      `suppressExternalMetadataFallback`
 *   B  the FALLBACK encoding (what the harness produces)
 *   C  stored
 *
 * plus forward-exactness of A and B, the Levenshtein distance of each list
 * to C, blank wildcard rows, and the fallback TRIGGERS: every metadata
 * consultation in A that answered undefined on a known receiver
 * (`applicationClassTypeMetadataTrace`), classified --
 *
 *   receiver-absent   the receiver's class is not in the snapshot
 *   ancestor-absent   the member is not declared by the class or any
 *                     available ancestor, and the class chain ends at a
 *                     parent that is not in the snapshot
 *   member-undeclared the available class chain is complete but does not
 *                     declare the member
 *   type-unresolved   the member is declared; its type does not resolve to
 *                     an available class (absent, or ambiguous)
 *
 * Usage: npx tsx tools/corpus/research/cycle112-fallback-census.ts <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { listSnapshotApplicationClassDefinitions, snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { canonicalClassKey } from '../../../src/peoplecode/applicationClassTypeMetadata';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const key = (g: any): string => {
  const up = (v: unknown) => String(v ?? '').toUpperCase();
  switch (g.kind) {
    case 'package': return `PACKAGE.${up(g.packageName)}`;
    case 'scroll': return `SCROLL.${up(g.recordName)}`;
    case 'record': return `RECORD.${up(g.recordName)}`;
    case 'field': return `FIELD.${up(g.fieldName)}`;
    case 'component': return `COMPONENT.${up(g.objectName)}`;
    default: return `${up(g.recordName)}.${up(g.fieldName)}`;
  }
};

function levenshtein(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const classSources = new Map(listSnapshotApplicationClassDefinitions(db).map(d => [canonicalClassKey(d.path), d.source]));
const declares = (path: readonly string[], member: string): boolean => {
  const source = classSources.get(canonicalClassKey(path));
  const parsed = source === undefined ? undefined : parseApplicationClassSource(source);
  return (parsed?.members ?? []).some(m => (m as { name: string }).name.replace(/^&/, '').toLowerCase() === member.toLowerCase()) ||
    (parsed?.statements ?? []).some(s => s.kind === 'instance-statement' && s.names.some(n => n.replace(/^&/, '').toLowerCase() === member.toLowerCase()));
};
const classify = (receiver: readonly string[], member: string): string => {
  if (!classSources.has(canonicalClassKey(receiver))) return 'receiver-absent';
  let current: readonly string[] | undefined = receiver;
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(canonicalClassKey(current))) {
    seen.add(canonicalClassKey(current));
    if (declares(current, member)) return 'type-unresolved';
    const parent = provider.superclassOf(current);
    if (parent === undefined) {
      const source = classSources.get(canonicalClassKey(current));
      const parsed = source === undefined ? undefined : parseApplicationClassSource(source);
      return parsed?.extendsType !== undefined ? 'ancestor-absent' : 'member-undeclared';
    }
    current = parent;
  }
  return 'member-undeclared';
};

const out = fs.openSync(process.argv[2], 'w');
let programs = 0;
for (const def of listSnapshotDefinitions(db) as any[]) {
  if (def.objectid1 === 104) continue;
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const ri = ids.findIndex((x: number) => x === 1), fi = ids.findIndex((x: number) => x === 2);
  const owner = { recordName: ri >= 0 ? values[ri] : values[0], fieldName: fi >= 0 ? values[fi] : values[1] };
  let fallback = false;
  let fallbackArtifacts: any;
  try {
    fallbackArtifacts = encodeProgramArtifacts(def.sourceText, { owner, applicationClassTypeMetadata: provider, onExternalMetadataFallback: () => { fallback = true; } } as any);
  } catch { continue; }
  if (!fallback) continue;
  programs++;
  const triggers: any[] = [];
  const normalArtifacts: any = encodeProgramArtifacts(def.sourceText, {
    owner, applicationClassTypeMetadata: provider, suppressExternalMetadataFallback: true,
    applicationClassTypeMetadataTrace: (e: any) => {
      if (e.result === undefined) triggers.push({ kind: e.kind, receiver: e.receiver.join(':'), member: e.member, at: e.sourceOffset, cause: classify(e.receiver, e.member) });
    }
  } as any);
  const stored = [...def.names].sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum)).slice(1)
    .map((r: any) => `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`);
  const list = (artifacts: any) => artifacts.references.filter((r: any) => r.kind !== 'owner').map(key);
  const A = list(normalArtifacts), B = list(fallbackArtifacts);
  const packages = (l: string[]) => l.filter(k => k.startsWith('PACKAGE.'));
  const blanks = (l: string[]) => l.filter(k => k === 'PACKAGE.').length;
  const source = String(def.sourceText ?? '');
  fs.writeSync(out, JSON.stringify({
    id: def.definitionId,
    wildcards: [...source.matchAll(/^\s*import\s+[\w:]+:\*\s*;/gim)].length,
    blank: { normal: blanks(A), fallback: blanks(B), stored: blanks(stored) },
    exact: { normal: normalArtifacts.program.equals(def.storedProgram), fallback: fallbackArtifacts.program.equals(def.storedProgram) },
    namesExact: { normal: A.join('|') === stored.join('|'), fallback: B.join('|') === stored.join('|') },
    distance: { normal: levenshtein(A, stored), fallback: levenshtein(B, stored) },
    packageDistance: { normal: levenshtein(packages(A), packages(stored)), fallback: levenshtein(packages(B), packages(stored)) },
    nonPackageEqual: { normal: A.filter(k => !k.startsWith('PACKAGE.')).join('|') === stored.filter(k => !k.startsWith('PACKAGE.')).join('|'), fallback: B.filter(k => !k.startsWith('PACKAGE.')).join('|') === stored.filter(k => !k.startsWith('PACKAGE.')).join('|') },
    lists: { normal: packages(A), fallback: packages(B), stored: packages(stored) },
    triggers
  }) + '\n');
}
fs.closeSync(out);
console.log(`${programs} fallback programs`);
