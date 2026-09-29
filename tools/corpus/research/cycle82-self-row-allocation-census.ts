/*
 * Cycle 82: self-class PACKAGE row ALLOCATION census (NAMENUM semantics
 * only -- row descriptive content is deliberately ignored; it never
 * reaches PSPCMPROG bytes).
 *
 * For every Application Class definition (OBJECTID1=104) in the LOCAL
 * SNAPSHOT: encode the source with the current encoder, map stored and
 * generated PSPCMNAME rows to RECNAME.REFNAME keys, and compare where the
 * class's own `PACKAGE.<CLASSNAME>` row(s) sit.
 *
 * Position agreement is tested as: the multiset of keys allocated BEFORE
 * the first self row is identical in stored and generated. This isolates
 * the self row's allocation point from unrelated downstream reference
 * mismatches.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle82-self-row-allocation-census.ts [--json out.json] [--ids 1,2,3]
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';

const APPLICATION_CLASS_OBJECT_ID = 104;

function ownerContextOf(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return {
    recordName: values[0],
    fieldName: values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function sKeyOf(row: any): string {
  return `${row.recname.trim().toUpperCase()}.${row.refname.trim().toUpperCase()}`;
}

function gKeyOf(g: any): string {
  switch (g.kind) {
    case 'package': return `PACKAGE.${(g.packageName ?? '').toUpperCase()}`;
    case 'scroll': return `SCROLL.${(g.recordName ?? '').toUpperCase()}`;
    case 'record': return `RECORD.${(g.recordName ?? '').toUpperCase()}`;
    case 'field': return `FIELD.${(g.fieldName ?? '').toUpperCase()}`;
    case 'record-field':
    case 'declare-function':
    case 'quoted-reference':
      return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    case 'component': return `COMPONENT.${(g.objectName ?? '').toUpperCase()}`;
    default: return JSON.stringify(g);
  }
}

function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export interface SelfRowCensusRow {
  positionVerdict: 'AGREE' | 'CONTRADICT' | 'UNDETERMINED' | 'N/A';
  definitionId: number;
  className: string;
  ownThisCallMethods: string[];
  storedSelfNamenums: number[];
  generatedSelfNamenums: number[];
  storedCount: number;
  generatedCount: number;
  namesExact: boolean;
  prefixAgrees: boolean | null;
  storedPrefixOnly: string[];
  generatedPrefixOnly: string[];
  encodeError?: string;
}

function main(): void {
  const jsonIndex = process.argv.indexOf('--json');
  const jsonOut = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;
  const idsIndex = process.argv.indexOf('--ids');
  const onlyIds = idsIndex >= 0 ? new Set(process.argv[idsIndex + 1].split(',').map(Number)) : undefined;

  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db)
    .filter(def => def.objectid1 === APPLICATION_CLASS_OBJECT_ID)
    .filter(def => onlyIds === undefined || onlyIds.has(def.definitionId));

  const rows: SelfRowCensusRow[] = [];
  for (const def of definitions as any[]) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;
    const className = parsed.className.toUpperCase();
    const selfKey = `PACKAGE.${className}`;
    const ownMethods = new Set(parsed.members
      .filter((m: any) => m.kind === 'method')
      .map((m: any) => m.name.toLowerCase()));
    const ownThisCallMethods = [...(def.sourceText as string).matchAll(/%This\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)]
      .map(m => m[1])
      .filter(name => ownMethods.has(name.toLowerCase()));

    const stored: string[] = def.names.slice(1).map(sKeyOf);
    let generated: string[] = [];
    let encodeError: string | undefined;
    try {
      const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContextOf(def) } as any);
      generated = artifacts.references.filter((r: any) => r.kind !== 'owner').map(gKeyOf);
    } catch (error) {
      encodeError = error instanceof Error ? error.message : String(error);
    }

    const storedSelf = stored.flatMap((k, i) => (k === selfKey ? [i + 2] : []));
    const generatedSelf = generated.flatMap((k, i) => (k === selfKey ? [i + 2] : []));
    let prefixAgrees: boolean | null = null;
    let storedPrefixOnly: string[] = [];
    let generatedPrefixOnly: string[] = [];
    if (encodeError === undefined && (storedSelf.length > 0 || generatedSelf.length > 0)) {
      const sPrefix = storedSelf.length > 0 ? stored.slice(0, storedSelf[0] - 2) : stored;
      const gPrefix = generatedSelf.length > 0 ? generated.slice(0, generatedSelf[0] - 2) : generated;
      prefixAgrees = storedSelf.length > 0 && generatedSelf.length > 0 && multisetEqual(sPrefix, gPrefix);
      const gSet = new Set(gPrefix);
      const sSet = new Set(sPrefix);
      storedPrefixOnly = [...sSet].filter(k => !gSet.has(k));
      generatedPrefixOnly = [...gSet].filter(k => !sSet.has(k));
    }

    /*
     * Position verdict: with self rows removed from both lists, count the
     * non-self rows allocated before the first self row (k stored, gk
     * generated). If both lists agree on their first max(k, gk) non-self
     * rows, the self row's position is directly comparable: AGREE when
     * k === gk, else CONTRADICT. Otherwise an unrelated earlier reference
     * mismatch makes the position UNDETERMINED.
     */
    let positionVerdict: 'AGREE' | 'CONTRADICT' | 'UNDETERMINED' | 'N/A' = 'N/A';
    if (encodeError === undefined && storedSelf.length > 0 && generatedSelf.length > 0) {
      const sNo = stored.filter(k => k !== selfKey);
      const gNo = generated.filter(k => k !== selfKey);
      const k = storedSelf[0] - 2;
      const gk = generatedSelf[0] - 2;
      const span = Math.max(k, gk);
      const prefixSame = sNo.length >= span && gNo.length >= span &&
        sNo.slice(0, span).every((key, i) => key === gNo[i]);
      positionVerdict = prefixSame ? (k === gk ? 'AGREE' : 'CONTRADICT') : 'UNDETERMINED';
    }

    rows.push({
      positionVerdict,
      definitionId: def.definitionId,
      className,
      ownThisCallMethods,
      storedSelfNamenums: storedSelf,
      generatedSelfNamenums: generatedSelf,
      storedCount: stored.length,
      generatedCount: generated.length,
      namesExact: encodeError === undefined && stored.length === generated.length && stored.every((k, i) => k === generated[i]),
      prefixAgrees,
      storedPrefixOnly,
      generatedPrefixOnly,
      encodeError
    });
  }
  db.close();

  const bucket = new Map<string, number>();
  const add = (k: string) => bucket.set(k, (bucket.get(k) ?? 0) + 1);
  for (const r of rows) {
    const own = r.ownThisCallMethods.length > 0 ? 'ownThis' : 'noOwnThis';
    const s = r.storedSelfNamenums.length === 0 ? 'S0' : r.storedSelfNamenums.length === 1 ? 'S1' : 'S2+';
    const g = r.generatedSelfNamenums.length === 0 ? 'G0' : r.generatedSelfNamenums.length === 1 ? 'G1' : 'G2+';
    add(`${own} ${s} ${g}`);
    if (r.positionVerdict !== 'N/A') add(`${own} ${s} ${g} position=${r.positionVerdict}`);
    if (r.encodeError !== undefined) add(`${own} ${s} ${g} encodeError`);
  }
  console.log(`Application Class definitions: ${rows.length}`);
  console.log(`Encode errors: ${rows.filter(r => r.encodeError).length}`);
  console.log(`Names-exact (RECNAME.REFNAME list): ${rows.filter(r => r.namesExact).length}`);
  for (const [k, v] of [...bucket.entries()].sort()) console.log(`  ${k.padEnd(48)} ${v}`);

  if (jsonOut !== undefined) {
    fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
    console.log(`Wrote ${jsonOut}`);
  }
}

main();
