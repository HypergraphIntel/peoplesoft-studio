/**
 * Cycle 40: investigates the Application Class declaration-phase
 * dependency prepass that Cycle 39 showed governs method-bearing
 * self-reference rows (metadata-only, never used by an executable
 * operand). Read-only, no encoder changes.
 *
 * For every Application Class definition with a stored self-method
 * row (`recname=PACKAGE, refname=<own class>, appclassmethod<>blank`),
 * this reconstructs the STORED PSPCMNAME stream's own PACKAGE-kind
 * rows in namenum order and classifies each as:
 *   - import-derived (its class/package leaf matches an explicit
 *     `import ROOT:...:Leaf;` statement)
 *   - the self-method row itself
 *   - anything else (body-discovered PACKAGE dependencies: runtime
 *     creates, other classes' method-bearing rows, builtin object
 *     types, etc.)
 *
 * This directly tests whether the self-method row sits in a stable
 * position relative to the import block (Phase 7/13's subpass
 * question) and whether "zero missing (non-imported) declaration
 * dependencies" -- the exact population Cycle 32's own narrow prepass
 * already models -- correlates with row presence (Phase 5/8).
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-dependency-prepass-analysis.ts
 */

import { parseApplicationClassSource, type ApplicationClassMethodMember, type ApplicationClassStorageMember } from '../../../src/peoplecode/applicationClassProgram';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';

const APPLICATION_CLASS_OBJECT_ID = 104;

const SCALAR_DECLARATION_TYPES = new Set([
  'string', 'date', 'any', 'boolean', 'time', 'datetime', 'object', 'integer', 'number', 'exception', 'array'
]);

function dependencyTypeLeaf(typeName: string): string {
  return typeName.replace(/^(?:array\s+of\s+)+/i, '').trim().split(':').at(-1) ?? '';
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) { const k = key(value); result[k] = (result[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
}

interface DefRow {
  definitionId: number;
  className: string;
  hasSelfRow: boolean;
  selfRowNamenum: number | undefined;
  importCount: number;
  packageRowCount: number;
  importDerivedRowCount: number;
  nonImportPackageRowCountBeforeSelfRow: number | undefined;
  selfRowPositionRelativeToImports: 'immediately-after-imports' | 'not-immediately-after-imports' | 'n/a';
  missingDeclarationDependencyCount: number;
  hasAnyOwnThisCall: boolean;
}

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();

  const results: DefRow[] = [];

  for (const definition of definitions) {
    const parsed = parseApplicationClassSource(definition.sourceText);
    if (parsed === undefined) continue;
    const className = parsed.className;
    const classNameLower = className.toLowerCase();

    const hasAnyOwnThisCall = /%This\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/i.test(definition.sourceText);
    if (!hasAnyOwnThisCall) continue;

    // Import-derived leaves, from source text before the class header.
    const importRegion = definition.sourceText.slice(0, parsed.unitStart);
    const importTargets = [...importRegion.matchAll(/\bimport\s+([^;]+);/gi)].map(m => m[1].trim());
    const importedLeaves = new Set(
      importTargets.map(t => t.split(':').at(-1)?.trim() ?? '').filter(l => l !== '' && l !== '*').map(l => l.toLowerCase())
    );
    const importedWildcardRoots = new Set(
      importTargets.filter(t => t.endsWith(':*')).map(t => t.slice(0, -2).split(':')[0].toLowerCase())
    );

    // Declaration-derived types (parameters, returns, property/instance types) --
    // same filter shape as the encoder's own missingDeclarationDependencies.
    const methods = parsed.members.filter((m): m is ApplicationClassMethodMember => m.kind === 'method');
    const storageMembers = parsed.members.filter((m): m is ApplicationClassStorageMember => m.kind === 'property' || m.kind === 'instance');
    const declarationTypes: string[] = [
      parsed.extendsType,
      parsed.implementsType,
      ...methods.flatMap(m => [...m.parameters.map(p => p.type), m.returnType]),
      ...storageMembers.map(s => s.type)
    ].filter((t): t is string => t !== undefined);

    const missingLeaves = new Set<string>();
    for (const typeName of declarationTypes) {
      const normalized = typeName.replace(/^(?:array\s+of\s+)+/i, '').trim();
      const leaf = dependencyTypeLeaf(typeName);
      const root = normalized.split(':')[0].toLowerCase();
      const isRelationship = typeName === parsed.extendsType || typeName === parsed.implementsType;
      if (leaf === '') continue;
      if (SCALAR_DECLARATION_TYPES.has(leaf.toLowerCase())) continue;
      if (importedLeaves.has(leaf.toLowerCase())) continue;
      if (isRelationship && importedWildcardRoots.has(root)) continue;
      missingLeaves.add(leaf.toLowerCase());
    }

    // Stored PACKAGE-kind rows, in namenum order.
    const packageRows = definition.names
      .filter(row => row.recname.trim() === 'PACKAGE')
      .sort((a, b) => a.namenum - b.namenum);
    const selfRow = packageRows.find(row =>
      row.refname.trim().toLowerCase() === classNameLower && row.appclassmethod.trim() !== ''
    );
    const importDerivedRows = packageRows.filter(row => importedLeaves.has(row.refname.trim().toLowerCase()));

    let nonImportBeforeSelfRow: number | undefined;
    let positionRelativeToImports: DefRow['selfRowPositionRelativeToImports'] = 'n/a';
    if (selfRow !== undefined) {
      const rowsBeforeSelf = packageRows.filter(row => row.namenum < selfRow.namenum);
      const nonImportRowsBeforeSelf = rowsBeforeSelf.filter(row => !importedLeaves.has(row.refname.trim().toLowerCase()));
      nonImportBeforeSelfRow = nonImportRowsBeforeSelf.length;
      // "Immediately after imports": every PACKAGE row with a LOWER namenum
      // than the self row is import-derived (i.e. nothing else was
      // interleaved between the last import and the self row).
      positionRelativeToImports = nonImportRowsBeforeSelf.length === 0
        ? 'immediately-after-imports'
        : 'not-immediately-after-imports';
    }

    results.push({
      definitionId: definition.definitionId,
      className,
      hasSelfRow: selfRow !== undefined,
      selfRowNamenum: selfRow?.namenum,
      importCount: importTargets.length,
      packageRowCount: packageRows.length,
      importDerivedRowCount: importDerivedRows.length,
      nonImportPackageRowCountBeforeSelfRow: nonImportBeforeSelfRow,
      selfRowPositionRelativeToImports: positionRelativeToImports,
      missingDeclarationDependencyCount: missingLeaves.size,
      hasAnyOwnThisCall
    });
  }

  const present = results.filter(r => r.hasSelfRow);
  const absent = results.filter(r => !r.hasSelfRow);

  console.log(JSON.stringify({
    population: { total: results.length, present: present.length, absent: absent.length },
    selfRowPositionRelativeToImports: countBy(present, r => r.selfRowPositionRelativeToImports),
    missingDeclarationDependencyCountDistribution: {
      present: countBy(present, r => String(r.missingDeclarationDependencyCount)),
      absent: countBy(absent, r => String(r.missingDeclarationDependencyCount))
    },
    missingDeclarationDependencyCountZero: {
      presentWithZeroMissing: present.filter(r => r.missingDeclarationDependencyCount === 0).length,
      presentTotal: present.length,
      absentWithZeroMissing: absent.filter(r => r.missingDeclarationDependencyCount === 0).length,
      absentTotal: absent.length
    },
    importCountDistribution: {
      present: countBy(present, r => String(r.importCount)),
      absent: countBy(absent, r => String(r.importCount))
    },
    packageRowCountDistribution: {
      present: countBy(present, r => String(r.packageRowCount)),
      absent: countBy(absent, r => String(r.packageRowCount))
    },
    sampleNotImmediatelyAfterImports: present
      .filter(r => r.selfRowPositionRelativeToImports === 'not-immediately-after-imports')
      .slice(0, 15)
  }, null, 2));
}

main();
