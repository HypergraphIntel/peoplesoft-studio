/*
 * Cycle 53 Phases 7/8/9/23/24: corpus-wide census of the self-class-name
 * PACKAGE row (the class's own leaf name allocated as a
 * `PACKAGE|<OWNCLASSNAME>` reference row -- the family targeted by roots
 * 28972, 28975, 30104).
 *
 * For every Application Class definition in the local snapshot: parse the
 * source, check whether stored PSPCMNAME contains a PACKAGE row whose
 * refname equals the class's own leaf name (case-insensitive), and
 * tabulate against candidate predicates:
 *
 *  - hasExplicitSelfType: the class's own name appears as an explicit
 *    declared type (extends/implements/property/instance/parameter/
 *    return) -- this population is ALREADY handled by the existing
 *    Cycle 26/32/52 `missingDeclarationDependencies` mechanism (nothing in
 *    that filter excludes a self-referencing leaf), so it is not part of
 *    the Cycle 53 gap.
 *  - hasOwnThisMethodCall: the source calls `%This.<method>(...)` where
 *    `<method>` is declared by the class itself (Cycle 32/34's own
 *    "modeled" bucket, as opposed to an inherited/external call).
 *  - a "blank self-slot" row: a `PACKAGE` row with an EMPTY refname sitting
 *    at the same declaration-phase position a populated self-row would
 *    occupy -- evidence this is the SAME slot/mechanism, but with a
 *    different (already out-of-scope, "wrong-shape") failure mode. Rows
 *    exhibiting this are excluded from the "true negative" control
 *    population, since they are not genuine self-row-absent cases.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle53-self-class-row-census.ts [--json]
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';

const APPLICATION_CLASS_OBJECT_ID = 104;

function leafOf(typeName: string | undefined): string | undefined {
  if (typeName === undefined) return undefined;
  return typeName.replace(/^(?:array\s+of\s+)+/i, '').trim().split(':').at(-1);
}

interface CensusRow {
  definitionId: number;
  className: string;
  selfRowPresent: boolean;
  hasBlankSelfSlot: boolean;
  hasConstructor: boolean;
  hasExtends: boolean;
  hasImplements: boolean;
  hasAnyDeclarationDependency: boolean;
  hasExplicitSelfType: boolean;
  hasThisMethodCall: boolean;
  hasOwnThisMethodCall: boolean;
  hasUnmodeledThisMethodCall: boolean;
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  const rows: CensusRow[] = [];
  let unparsed = 0;
  const scalarDeclarationTypes = new Set([
    'string', 'date', 'any', 'boolean', 'time', 'datetime', 'object', 'integer', 'number', 'exception', 'array'
  ]);

  for (const def of definitions as any[]) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) { unparsed++; continue; }

    const classNameLower = parsed.className.toLowerCase();
    const names: any[] = def.names ?? [];
    const selfRowPresent = names.some(row =>
      row.recname.trim() === 'PACKAGE' &&
      [row.refname, row.packageroot, row.qualifypath].some((v: string) => v.trim().toLowerCase() === classNameLower)
    );
    // A PACKAGE row with a BLANK refname is a different, already-parked
    // "wrong-shape" failure mode (cf. 29389, 28935) -- not a genuine
    // negative control for THIS question.
    const hasBlankSelfSlot = names.some(row => row.recname.trim() === 'PACKAGE' && row.refname.trim() === '');

    const methods = parsed.members.filter((m: any) => m.kind === 'method');
    const ownMethods = new Set(methods.map((m: any) => m.name.toLowerCase()));
    const hasConstructor = ownMethods.has(classNameLower);
    const hasExtends = parsed.extendsType !== undefined;
    const hasImplements = parsed.implementsType !== undefined;

    const declarationLeaves: (string | undefined)[] = [
      leafOf(parsed.extendsType),
      leafOf(parsed.implementsType),
      ...parsed.statements.flatMap((s: any) => {
        if (s.kind === 'method') return [...s.parameters.map((p: any) => leafOf(p.type)), leafOf(s.returnType)];
        if (s.kind === 'property' || s.kind === 'instance' || s.kind === 'instance-statement') return [leafOf(s.type)];
        return [];
      })
    ];
    const importTargets = [...def.sourceText.slice(0, parsed.unitStart).matchAll(/\bimport\s+([^;]+);/gi)]
      .map((m: any) => m[1].trim());
    const importedClassLeaves = new Set(
      importTargets.map((t: string) => t.split(':').at(-1)?.trim().toLowerCase()).filter((l: string) => l && l !== '*')
    );
    const hasAnyDeclarationDependency = declarationLeaves.some(leaf =>
      leaf !== undefined && leaf !== '' && !scalarDeclarationTypes.has(leaf.toLowerCase()) && !importedClassLeaves.has(leaf.toLowerCase())
    );
    const hasExplicitSelfType = declarationLeaves.some(leaf => leaf?.toLowerCase() === classNameLower);

    const thisMethodCalls = [...(def.sourceText as string).matchAll(/%This\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)]
      .map((m: any) => m[1] as string);
    const hasThisMethodCall = thisMethodCalls.length > 0;
    const hasOwnThisMethodCall = thisMethodCalls.some(c => ownMethods.has(c.toLowerCase()));
    const hasUnmodeledThisMethodCall = thisMethodCalls.some(c => !ownMethods.has(c.toLowerCase()));

    rows.push({
      definitionId: def.definitionId, className: parsed.className,
      selfRowPresent, hasBlankSelfSlot, hasConstructor, hasExtends, hasImplements,
      hasAnyDeclarationDependency, hasExplicitSelfType,
      hasThisMethodCall, hasOwnThisMethodCall, hasUnmodeledThisMethodCall
    });
  }
  db.close();

  if (asJson) { console.log(JSON.stringify({ rows, unparsed }, null, 2)); return; }

  console.log(`Total Application Class definitions in snapshot: ${definitions.length}`);
  console.log(`Parsed successfully: ${rows.length}; unparsed: ${unparsed}`);

  const present = rows.filter(r => r.selfRowPresent);
  // Exclude the blank-self-slot ("wrong-shape") population from the
  // negative-control set -- those are a different, already out-of-scope
  // failure mode, not genuine absence.
  const absentClean = rows.filter(r => !r.selfRowPresent && !r.hasBlankSelfSlot);
  const absentBlankSlot = rows.filter(r => !r.selfRowPresent && r.hasBlankSelfSlot);
  console.log(`\nSelf-row PRESENT: ${present.length}`);
  console.log(`Self-row absent, clean negative: ${absentClean.length}`);
  console.log(`Self-row absent, but blank-refname PACKAGE slot present (excluded as wrong-shape family): ${absentBlankSlot.length}`);

  const rule = (r: CensusRow) => r.hasOwnThisMethodCall || r.hasExplicitSelfType;
  console.log('\n--- Candidate rule: hasOwnThisMethodCall OR hasExplicitSelfType ---');
  console.log('  present & rule TRUE (explained):', present.filter(rule).length, '/', present.length);
  console.log('  present & rule FALSE (unexplained positive):', present.filter(r => !rule(r)).length);
  console.log('  absentClean & rule TRUE (contradiction):', absentClean.filter(rule).length);
  console.log('  absentClean & rule FALSE (correctly predicted absent):', absentClean.filter(r => !rule(r)).length);

  console.log('\n--- Contradictions (absentClean & rule TRUE) -- ground-truth counterexamples ---');
  for (const r of absentClean.filter(rule)) console.log('  ', JSON.stringify(r));

  console.log('\nConclusion: the rule explains the large majority of the population with a small,');
  console.log('irreducible set of genuine ground-truth counterexamples (see above) -- NOT a');
  console.log('zero-contradiction, source-deterministic rule. Per Phase 25 implementation');
  console.log('threshold, this does not clear the bar for a population-wide encoder change.');
}

main();
