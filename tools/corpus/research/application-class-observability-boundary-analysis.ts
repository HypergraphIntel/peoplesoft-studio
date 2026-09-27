/**
 * Cycle 41: tests whether the Application Class singleton self-method
 * metadata row's firing decision (Cycles 37-40) can be distinguished by
 * ANY combination of currently observable source/local-snapshot
 * features, by partitioning the firing population into exact
 * observable-state equivalence classes and checking whether any class
 * contains BOTH row-present and row-absent definitions (Criterion A).
 * Also cross-references the firing population against the 25 parked
 * Cycle 31 storage-symbol roots (Phase 6) for a hidden-ordering-source
 * correlation check. Read-only, no encoder changes.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-observability-boundary-analysis.ts
 */

import { parseApplicationClassSource, type ApplicationClassMethodMember, type ApplicationClassStorageMember } from '../../../src/peoplecode/applicationClassProgram';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';

const APPLICATION_CLASS_OBJECT_ID = 104;

const SCALAR_DECLARATION_TYPES = new Set([
  'string', 'date', 'any', 'boolean', 'time', 'datetime', 'object', 'integer', 'number', 'exception', 'array'
]);

const PARKED_NAMES_ROOTS = new Set([
  28731, 28827, 29085, 29086, 29095, 29121, 29132, 29133, 29149, 29150,
  29159, 29181, 29189, 29190, 29246, 29363, 29399, 29466, 29497, 29716,
  29726, 29885, 29889, 30171, 30172
]);

function maskNonExecutable(source: string): string {
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
    if (
      source.slice(i, i + 3).toLowerCase() === 'rem' &&
      (i === 0 || !/[A-Za-z0-9_%&]/.test(source[i - 1])) &&
      /[\s:]/.test(source[i + 3] ?? '')
    ) {
      while (i < chars.length && chars[i] !== ';') { if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '; i++; }
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    const pair = `${chars[i] ?? ''}${chars[i + 1] ?? ''}`;
    if (pair === '/*' || pair === '<*') {
      const close = pair === '/*' ? '*/' : '*>';
      chars[i++] = ' '; chars[i++] = ' ';
      while (i < chars.length && `${chars[i]}${chars[i + 1] ?? ''}` !== close) { if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '; i++; }
      if (i < chars.length) chars[i++] = ' ';
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    if (pair === '//') { while (i < chars.length && chars[i] !== '\n') chars[i++] = ' '; continue; }
    if (chars[i] === '"') {
      chars[i++] = ' ';
      while (i < chars.length) {
        if (chars[i] === '"') { chars[i++] = ' '; if (chars[i] === '"') { chars[i++] = ' '; continue; } break; }
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return chars.join('');
}

function dependencyTypeLeaf(typeName: string): string {
  return typeName.replace(/^(?:array\s+of\s+)+/i, '').trim().split(':').at(-1) ?? '';
}

interface Record0 {
  definitionId: number;
  hasSelfRow: boolean;
  vector: (string | number | boolean)[];
  vectorKey: string;
  parkedNamesRoot: boolean;
}

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();

  const records: Record0[] = [];

  for (const definition of definitions) {
    const parsed = parseApplicationClassSource(definition.sourceText);
    if (parsed === undefined) continue;
    const methods = parsed.members.filter((m): m is ApplicationClassMethodMember => m.kind === 'method');
    const storageMembers = parsed.members.filter((m): m is ApplicationClassStorageMember => m.kind === 'property' || m.kind === 'instance');
    const properties = storageMembers.filter(m => m.kind === 'property');
    const instances = storageMembers.filter(m => m.kind === 'instance');
    const declaredByName = new Map(methods.map(m => [m.name.toLowerCase(), m]));
    const className = parsed.className;
    const classNameLower = className.toLowerCase();

    const methodsByImpl = [...methods].sort((a, b) => a.implementationOrder - b.implementationOrder);
    let selected: { method: ApplicationClassMethodMember; target: ApplicationClassMethodMember } | undefined;
    let distinctTargets = new Set<string>();
    let totalCalls = 0;
    for (const method of methodsByImpl) {
      const masked = maskNonExecutable(method.body);
      const calls = [...masked.matchAll(/%This\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)];
      for (const call of calls) {
        const targetKey = call[1].toLowerCase();
        const target = declaredByName.get(targetKey);
        if (target === undefined || target.abstract) continue;
        totalCalls++;
        distinctTargets.add(targetKey);
        if (selected === undefined) selected = { method, target };
      }
    }
    if (selected === undefined) continue;

    const hasSelfRow = definition.names.some(row =>
      row.recname.trim() === 'PACKAGE' && row.refname.trim().toLowerCase() === classNameLower && row.appclassmethod.trim() !== ''
    );

    const importRegion = definition.sourceText.slice(0, parsed.unitStart);
    const importTargets = [...importRegion.matchAll(/\bimport\s+([^;]+);/gi)].map(m => m[1].trim());
    const wildcardImportCount = importTargets.filter(t => t.endsWith(':*')).length;
    const importedLeaves = new Set(importTargets.map(t => t.split(':').at(-1)?.trim() ?? '').filter(l => l !== '' && l !== '*').map(l => l.toLowerCase()));
    const importedWildcardRoots = new Set(importTargets.filter(t => t.endsWith(':*')).map(t => t.slice(0, -2).split(':')[0].toLowerCase()));

    const declarationTypes: string[] = [
      parsed.extendsType, parsed.implementsType,
      ...methods.flatMap(m => [...m.parameters.map(p => p.type), m.returnType]),
      ...storageMembers.map(s => s.type)
    ].filter((t): t is string => t !== undefined);
    const missingLeaves = new Set<string>();
    for (const typeName of declarationTypes) {
      const normalized = typeName.replace(/^(?:array\s+of\s+)+/i, '').trim();
      const leaf = dependencyTypeLeaf(typeName);
      const root = normalized.split(':')[0].toLowerCase();
      const isRelationship = typeName === parsed.extendsType || typeName === parsed.implementsType;
      if (leaf === '' || SCALAR_DECLARATION_TYPES.has(leaf.toLowerCase()) || importedLeaves.has(leaf.toLowerCase())) continue;
      if (isRelationship && importedWildcardRoots.has(root)) continue;
      missingLeaves.add(leaf.toLowerCase());
    }

    const abstractCount = methods.filter(m => m.abstract).length;
    const getterSetterCount = properties.filter(p => p.mode === 'get' || p.mode === 'get-set' || p.mode === 'readonly').length;
    const constructor = methods.find(m => m.name.toLowerCase() === classNameLower);

    const vector: (string | number | boolean)[] = [
      methods.length,
      storageMembers.length,
      properties.length,
      instances.length,
      parsed.extendsType !== undefined,
      parsed.implementsType !== undefined,
      importTargets.length,
      wildcardImportCount,
      abstractCount,
      getterSetterCount,
      constructor !== undefined,
      totalCalls,
      distinctTargets.size,
      selected.target.declarationOrdinal,
      selected.target.implementationOrder,
      selected.target.visibility,
      selected.target.returnType !== undefined,
      selected.target.parameters.length,
      selected.method.name.toLowerCase() === classNameLower, // selected caller is constructor
      selected.method.implementationOrder,
      missingLeaves.size
    ];

    records.push({
      definitionId: definition.definitionId,
      hasSelfRow,
      vector,
      vectorKey: JSON.stringify(vector),
      parkedNamesRoot: PARKED_NAMES_ROOTS.has(definition.definitionId)
    });
  }

  // Phase 3: exact equivalence classes.
  const byKey = new Map<string, Record0[]>();
  for (const r of records) byKey.set(r.vectorKey, [...(byKey.get(r.vectorKey) ?? []), r]);
  const mixedClasses = [...byKey.values()].filter(list => {
    const present = list.filter(r => r.hasSelfRow).length;
    const absent = list.filter(r => !r.hasSelfRow).length;
    return present > 0 && absent > 0;
  });

  // Phase 6: overlap with parked names roots.
  const parkedInPopulation = records.filter(r => r.parkedNamesRoot);

  console.log(JSON.stringify({
    population: { total: records.length, present: records.filter(r => r.hasSelfRow).length, absent: records.filter(r => !r.hasSelfRow).length },
    vectorFieldOrder: [
      'methodCount', 'storageMemberCount', 'propertyCount', 'instanceCount', 'hasExtends', 'hasImplements',
      'importCount', 'wildcardImportCount', 'abstractCount', 'getterSetterCount', 'hasConstructorImpl',
      'totalOwnCalls', 'distinctTargets', 'targetDeclarationOrdinal', 'targetImplementationOrdinal',
      'targetVisibility', 'targetHasReturnType', 'targetParameterCount', 'selectedCallerIsConstructor',
      'selectedCallerImplementationOrdinal', 'missingDeclarationDependencyCount'
    ],
    equivalenceClasses: {
      totalDistinctVectors: byKey.size,
      mixedClassesCount: mixedClasses.length,
      mixedClassExamples: mixedClasses.slice(0, 10).map(list => ({
        vector: JSON.parse(list[0].vectorKey),
        present: list.filter(r => r.hasSelfRow).map(r => r.definitionId),
        absent: list.filter(r => !r.hasSelfRow).map(r => r.definitionId)
      }))
    },
    parkedNamesRootOverlap: {
      totalParkedRoots: PARKED_NAMES_ROOTS.size,
      parkedRootsWithOwnThisCalls: parkedInPopulation.length,
      parkedRootsPresent: parkedInPopulation.filter(r => r.hasSelfRow).map(r => r.definitionId),
      parkedRootsAbsent: parkedInPopulation.filter(r => !r.hasSelfRow).map(r => r.definitionId)
    }
  }, null, 2));
}

main();
