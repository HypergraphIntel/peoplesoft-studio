/**
 * Cycle 37: census of `%This.SomeMethod(...)` calls across the Application
 * Class corpus, where `SomeMethod` is declared on the same class, to
 * determine whether -- and under what conditions -- PeopleTools allocates
 * a method-bearing self-reference (`PACKAGE|<class>|<package>||<METHOD>`,
 * confirmed directly from definition 29542's own raw PSPCMNAME row 10)
 * for such a call. Read-only, no encoder changes.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-this-method-analysis.ts
 */

import { parseApplicationClassSource, type ApplicationClassMethodMember } from '../../../src/peoplecode/applicationClassProgram';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const APPLICATION_CLASS_OBJECT_ID = 104;

interface CallSite {
  definitionId: number;
  className: string;
  callerMethod: string;
  targetMethod: string;
  targetKind: 'own-concrete' | 'own-abstract' | 'external-or-unresolved';
  occurrenceIndexForTarget: number; // 0 = first call to this target anywhere in the class
  callerIsAlsoTarget: boolean; // recursive self-call
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) { const k = key(value); result[k] = (result[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
}

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();

  const callSites: CallSite[] = [];
  let definitionsWithOwnCalls = 0;
  let definitionsScanned = 0;

  interface StoredEvidence {
    definitionId: number;
    className: string;
    callerMethod: string;
    targetMethod: string;
    occurrenceIndexForTarget: number;
    storedMethodBearingRowPresent: boolean;
    storedNamenum?: number;
  }
  const storedEvidence: StoredEvidence[] = [];

  for (const definition of definitions) {
    const parsed = parseApplicationClassSource(definition.sourceText);
    if (parsed === undefined) continue;
    definitionsScanned++;
    const methods = parsed.members.filter((m): m is ApplicationClassMethodMember => m.kind === 'method');
    if (methods.length === 0) continue;
    const declaredByName = new Map(methods.map(m => [m.name.toLowerCase(), m]));

    const targetOccurrence = new Map<string, number>();
    let anyOwnCall = false;

    for (const method of methods) {
      const calls = [...method.body.matchAll(/%This\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)];
      for (const call of calls) {
        const targetName = call[1];
        const targetKey = targetName.toLowerCase();
        const target = declaredByName.get(targetKey);
        const targetKind: CallSite['targetKind'] =
          target === undefined ? 'external-or-unresolved'
            : target.abstract ? 'own-abstract'
            : 'own-concrete';

        const occurrenceIndex = targetOccurrence.get(targetKey) ?? 0;
        targetOccurrence.set(targetKey, occurrenceIndex + 1);

        callSites.push({
          definitionId: definition.definitionId,
          className: parsed.className,
          callerMethod: method.name,
          targetMethod: targetName,
          targetKind,
          occurrenceIndexForTarget: occurrenceIndex,
          callerIsAlsoTarget: method.name.toLowerCase() === targetKey
        });

        if (targetKind === 'own-concrete') {
          anyOwnCall = true;
          const storedRow = definition.names.find(row =>
            row.recname.trim() === 'PACKAGE' &&
            row.refname.trim().toLowerCase() === parsed.className.toLowerCase() &&
            row.appclassmethod.trim().toLowerCase() === targetKey
          );
          storedEvidence.push({
            definitionId: definition.definitionId,
            className: parsed.className,
            callerMethod: method.name,
            targetMethod: targetName,
            occurrenceIndexForTarget: occurrenceIndex,
            storedMethodBearingRowPresent: storedRow !== undefined,
            storedNamenum: storedRow?.namenum
          });
        }
      }
    }

    if (anyOwnCall) definitionsWithOwnCalls++;
  }

  const ownConcrete = callSites.filter(c => c.targetKind === 'own-concrete');
  const ownAbstract = callSites.filter(c => c.targetKind === 'own-abstract');
  const external = callSites.filter(c => c.targetKind === 'external-or-unresolved');
  const firstCalls = storedEvidence.filter(e => e.occurrenceIndexForTarget === 0);
  const repeatCalls = storedEvidence.filter(e => e.occurrenceIndexForTarget > 0);

  // Per (definitionId, targetMethod), does EVERY occurrence resolve to the SAME stored namenum (i.e. one shared row reused)?
  const byDefinitionTarget = new Map<string, StoredEvidence[]>();
  for (const e of storedEvidence) {
    const key = `${e.definitionId}:${e.targetMethod.toLowerCase()}`;
    byDefinitionTarget.set(key, [...(byDefinitionTarget.get(key) ?? []), e]);
  }
  const multiCallTargets = [...byDefinitionTarget.values()].filter(list => list.length > 1);
  const multiCallSameNamenum = multiCallTargets.filter(list => new Set(list.map(e => e.storedNamenum)).size === 1);
  const multiCallDifferentNamenum = multiCallTargets.filter(list => new Set(list.map(e => e.storedNamenum)).size > 1);

  // Cross-caller reuse: for a given (definitionId, targetMethod), are calls from DIFFERENT caller methods present, and do they share the same stored namenum?
  const crossCallerTargets = multiCallTargets.filter(list => new Set(list.map(e => e.callerMethod.toLowerCase())).size > 1);
  const crossCallerSameNamenum = crossCallerTargets.filter(list => new Set(list.map(e => e.storedNamenum)).size === 1);

  console.log(JSON.stringify({
    population: { definitionsScanned, definitionsWithOwnCalls },
    callSiteCounts: {
      totalCallSites: callSites.length,
      ownConcrete: ownConcrete.length,
      ownAbstract: ownAbstract.length,
      externalOrUnresolved: external.length,
      recursiveSelfCalls: callSites.filter(c => c.callerIsAlsoTarget).length
    },
    storedMethodBearingRow: {
      totalOwnConcreteCalls: storedEvidence.length,
      withStoredRow: storedEvidence.filter(e => e.storedMethodBearingRowPresent).length,
      withoutStoredRow: storedEvidence.filter(e => !e.storedMethodBearingRowPresent).length,
      firstCallsWithRow: firstCalls.filter(e => e.storedMethodBearingRowPresent).length,
      firstCallsWithoutRow: firstCalls.filter(e => !e.storedMethodBearingRowPresent).length,
      repeatCallsWithRow: repeatCalls.filter(e => e.storedMethodBearingRowPresent).length,
      repeatCallsWithoutRow: repeatCalls.filter(e => !e.storedMethodBearingRowPresent).length
    },
    reuseAcrossCalls: {
      multiCallTargetsTotal: multiCallTargets.length,
      multiCallSameNamenum: multiCallSameNamenum.length,
      multiCallDifferentNamenum: multiCallDifferentNamenum.length,
      crossCallerTargetsTotal: crossCallerTargets.length,
      crossCallerSameNamenum: crossCallerSameNamenum.length
    },
    targetKindBreakdown: countBy(callSites, c => c.targetKind),
    sampleWithoutStoredRow: storedEvidence.filter(e => !e.storedMethodBearingRowPresent).slice(0, 15),
    sampleWithStoredRow: storedEvidence.filter(e => e.storedMethodBearingRowPresent).slice(0, 15),
    sampleMultiCallDifferentNamenum: multiCallDifferentNamenum.slice(0, 10),
    sampleExternal: external.slice(0, 15)
  }, null, 2));
}

main();
