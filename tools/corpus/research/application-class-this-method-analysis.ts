/**
 * Cycles 37-38: census of `%This.SomeMethod(...)` calls across the
 * Application Class corpus, where `SomeMethod` is declared on the same
 * class, to determine whether -- and under what conditions -- PeopleTools
 * allocates a method-bearing self-reference
 * (`PACKAGE|<class>|<package>||<METHOD>`, confirmed directly from
 * definition 29542's own raw PSPCMNAME row 10) for such a call.
 * Read-only, no encoder changes.
 *
 * Cycle 37 established: row shape confirmed; reuse semantics solved
 * (100% compilation-unit-wide reuse, zero contradictions); a strict
 * population invariant (0 or 1 distinct method-bearing rows per
 * definition, never 2+). Cycle 38 extends this tool with per-target
 * features (declaration/implementation ordinal, call count, caller
 * count, constructor involvement, return type, parameters, visibility)
 * to test target-selection and class-level firing hypotheses.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-this-method-analysis.ts
 */

import { parseApplicationClassSource, type ApplicationClassMethodMember, type ApplicationClassStorageMember } from '../../../src/peoplecode/applicationClassProgram';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';

const APPLICATION_CLASS_OBJECT_ID = 104;

interface TargetInfo {
  definitionId: number;
  className: string;
  targetMethod: string;
  targetDeclarationOrdinal: number;
  targetImplementationOrdinal: number;
  targetVisibility: string;
  targetAbstract: boolean;
  targetReturnType: string | undefined;
  targetParameterCount: number;
  callCount: number;
  callerMethods: string[];
  callerCount: number;
  calledFromConstructor: boolean;
  isRecursiveSelfCall: boolean;
  isWinner: boolean; // has the stored method-bearing row
  /** [callerImplementationOrdinal, offsetWithinCallerBody] of this
   * target's chronologically FIRST call site, in the order the encoder
   * actually processes fragments (implementation order), for testing
   * "first call site across the whole compilation unit" as distinct
   * from "first target by declaration/implementation ordinal." */
  firstCallOrder: [number, number];
}

interface DefinitionInfo {
  definitionId: number;
  className: string;
  storageMemberCount: number;
  methodCount: number;
  extendsType: string | undefined;
  implementsType: string | undefined;
  hasWildcardImport: boolean;
  hasConstructorImpl: boolean;
  hasSelfMethodRow: boolean;
  selfMethodRowTarget: string | undefined;
  selfMethodRowNamenum: number | undefined;
  distinctTargets: number;
  targets: TargetInfo[];
}

/** Masks comments, disabled `rem`/`<* *>` code, and quoted strings so a
 * `%This.method(` scan never matches text inside disabled code -- three
 * of the Cycle 38 target-selection hypothesis's own apparent
 * contradictions turned out to be `rem`-commented-out calls the raw
 * regex scan wrongly counted as real. */
function maskNonExecutable(source: string): string {
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
    if (
      source.slice(i, i + 3).toLowerCase() === 'rem' &&
      (i === 0 || !/[A-Za-z0-9_%&]/.test(source[i - 1])) &&
      /[\s:]/.test(source[i + 3] ?? '')
    ) {
      while (i < chars.length && chars[i] !== ';') {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    const pair = `${chars[i] ?? ''}${chars[i + 1] ?? ''}`;
    if (pair === '/*' || pair === '<*') {
      const close = pair === '/*' ? '*/' : '*>';
      chars[i++] = ' ';
      chars[i++] = ' ';
      while (i < chars.length && `${chars[i]}${chars[i + 1] ?? ''}` !== close) {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i++] = ' ';
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    if (pair === '//') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
      continue;
    }
    if (chars[i] === '"') {
      chars[i++] = ' ';
      while (i < chars.length) {
        if (chars[i] === '"') {
          chars[i++] = ' ';
          if (chars[i] === '"') { chars[i++] = ' '; continue; }
          break;
        }
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return chars.join('');
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

  const analyzed: DefinitionInfo[] = [];

  for (const definition of definitions) {
    const parsed = parseApplicationClassSource(definition.sourceText);
    if (parsed === undefined) continue;
    const methods = parsed.members.filter((m): m is ApplicationClassMethodMember => m.kind === 'method');
    if (methods.length === 0) continue;
    const storageMembers = parsed.members.filter((m): m is ApplicationClassStorageMember => m.kind === 'property' || m.kind === 'instance');
    const declaredByName = new Map(methods.map(m => [m.name.toLowerCase(), m]));
    const className = parsed.className;
    const classNameLower = className.toLowerCase();

    const selfMethodRows = definition.names.filter(row =>
      row.recname.trim() === 'PACKAGE' &&
      row.refname.trim().toLowerCase() === classNameLower &&
      row.appclassmethod.trim() !== ''
    );
    const winnerTarget = selfMethodRows[0]?.appclassmethod.trim().toLowerCase();

    // Gather own-method call sites across all method bodies, in the
    // order the encoder actually processes fragments (implementation
    // order among methods, source offset within each method body).
    const perTarget = new Map<string, { callCount: number; callers: Set<string>; firstCallOrder: [number, number] }>();
    let anyOwnCall = false;
    const methodsByImplementationOrder = [...methods].sort((a, b) => a.implementationOrder - b.implementationOrder);
    for (const method of methodsByImplementationOrder) {
      const maskedBody = maskNonExecutable(method.body);
      const calls = [...maskedBody.matchAll(/%This\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)];
      for (const call of calls) {
        const targetKey = call[1].toLowerCase();
        if (!declaredByName.has(targetKey)) continue; // external/unresolved
        const target = declaredByName.get(targetKey)!;
        if (target.abstract) continue; // own-abstract, tracked separately if needed
        anyOwnCall = true;
        const order: [number, number] = [method.implementationOrder, call.index ?? 0];
        const entry = perTarget.get(targetKey) ?? { callCount: 0, callers: new Set<string>(), firstCallOrder: order };
        entry.callCount++;
        entry.callers.add(method.name);
        perTarget.set(targetKey, entry);
      }
    }
    if (!anyOwnCall) continue;

    const constructor = methods.find(m => m.name.toLowerCase() === classNameLower);
    const constructorCallsTarget = (targetKey: string): boolean =>
      constructor !== undefined && perTarget.get(targetKey)?.callers.has(constructor.name) === true;

    const targets: TargetInfo[] = [...perTarget.entries()].map(([targetKey, info]) => {
      const target = declaredByName.get(targetKey)!;
      return {
        definitionId: definition.definitionId,
        className,
        targetMethod: target.name,
        targetDeclarationOrdinal: target.declarationOrdinal,
        targetImplementationOrdinal: target.implementationOrder,
        targetVisibility: target.visibility,
        targetAbstract: target.abstract,
        targetReturnType: target.returnType,
        targetParameterCount: target.parameters.length,
        callCount: info.callCount,
        callerMethods: [...info.callers],
        callerCount: info.callers.size,
        calledFromConstructor: constructorCallsTarget(targetKey),
        isRecursiveSelfCall: info.callers.has(target.name),
        isWinner: targetKey === winnerTarget,
        firstCallOrder: info.firstCallOrder
      };
    });

    analyzed.push({
      definitionId: definition.definitionId,
      className,
      storageMemberCount: storageMembers.length,
      methodCount: methods.length,
      extendsType: parsed.extendsType,
      implementsType: parsed.implementsType,
      hasWildcardImport: /import\s+[^;]+:\*\s*;/i.test(definition.sourceText.slice(0, parsed.unitStart)),
      hasConstructorImpl: constructor !== undefined,
      hasSelfMethodRow: selfMethodRows.length > 0,
      selfMethodRowTarget: selfMethodRows[0]?.appclassmethod.trim(),
      selfMethodRowNamenum: selfMethodRows[0]?.namenum,
      distinctTargets: perTarget.size,
      targets
    });
  }

  const present = analyzed.filter(d => d.hasSelfMethodRow);
  const absent = analyzed.filter(d => !d.hasSelfMethodRow);

  // Phase 4: target-selection hypotheses, evaluated only on present-row definitions
  // with 2+ distinct targets (definitions with exactly 1 target are uninformative --
  // any hypothesis trivially "matches" there).
  const multiTargetPresent = present.filter(d => d.distinctTargets > 1);

  function hypothesisReport(name: string, predicate: (t: TargetInfo, allTargetsInDef: TargetInfo[]) => boolean) {
    let matches = 0;
    let contradictions = 0;
    const contradictionExamples: Array<{ definitionId: number; winner: string; predicted: string[] }> = [];
    for (const def of multiTargetPresent) {
      const winner = def.targets.find(t => t.isWinner);
      if (winner === undefined) continue;
      const predictedWinners = def.targets.filter(t => predicate(t, def.targets));
      const winnerPredicted = predictedWinners.some(t => t.targetMethod === winner.targetMethod);
      const onlyWinnerPredicted = predictedWinners.length === 1 && winnerPredicted;
      if (onlyWinnerPredicted) matches++;
      else {
        contradictions++;
        if (contradictionExamples.length < 5) {
          contradictionExamples.push({
            definitionId: def.definitionId,
            winner: winner.targetMethod,
            predicted: predictedWinners.map(t => t.targetMethod)
          });
        }
      }
    }
    return { name, totalMultiTargetDefinitions: multiTargetPresent.length, matches, contradictions, contradictionExamples };
  }

  const orderKey = (o: [number, number]): number => o[0] * 1_000_000 + o[1];
  const targetHypotheses = [
    hypothesisReport('first call site chronologically (implementation order, then offset)', (t, all) =>
      orderKey(t.firstCallOrder) === Math.min(...all.map(x => orderKey(x.firstCallOrder)))),
    hypothesisReport('last call site chronologically', (t, all) =>
      orderKey(t.firstCallOrder) === Math.max(...all.map(x => orderKey(x.firstCallOrder)))),
    hypothesisReport('first declaration ordinal', (t, all) => t.targetDeclarationOrdinal === Math.min(...all.map(x => x.targetDeclarationOrdinal))),
    hypothesisReport('last declaration ordinal', (t, all) => t.targetDeclarationOrdinal === Math.max(...all.map(x => x.targetDeclarationOrdinal))),
    hypothesisReport('first implementation ordinal', (t, all) => t.targetImplementationOrdinal === Math.min(...all.map(x => x.targetImplementationOrdinal))),
    hypothesisReport('last implementation ordinal', (t, all) => t.targetImplementationOrdinal === Math.max(...all.map(x => x.targetImplementationOrdinal))),
    hypothesisReport('highest call count', (t, all) => t.callCount === Math.max(...all.map(x => x.callCount))),
    hypothesisReport('highest caller count', (t, all) => t.callerCount === Math.max(...all.map(x => x.callerCount))),
    hypothesisReport('called from constructor', (t) => t.calledFromConstructor),
    hypothesisReport('recursive self call', (t) => t.isRecursiveSelfCall),
    hypothesisReport('is public', (t) => t.targetVisibility === 'public'),
    hypothesisReport('is private', (t) => t.targetVisibility === 'private'),
    hypothesisReport('returns object-ish (non-primitive, non-void)', (t) =>
      t.targetReturnType !== undefined && !/^(string|number|integer|boolean|date|datetime|time|any)$/i.test(t.targetReturnType)),
    hypothesisReport('returns void', (t) => t.targetReturnType === undefined),
    hypothesisReport('zero parameters', (t) => t.targetParameterCount === 0),
    hypothesisReport('has parameters', (t) => t.targetParameterCount > 0),
    hypothesisReport('called from 2+ distinct callers', (t) => t.callerCount > 1),
    hypothesisReport('called exactly once total', (t) => t.callCount === 1)
  ];

  function classHypothesis(name: string, predicate: (d: DefinitionInfo) => boolean) {
    const presentMatch = present.filter(predicate).length;
    const absentMatch = absent.filter(predicate).length;
    return {
      name,
      presentTotal: present.length,
      absentTotal: absent.length,
      presentMatch,
      absentMatch,
      presentMatchPct: Math.round((presentMatch / present.length) * 100),
      absentMatchPct: Math.round((absentMatch / absent.length) * 100)
    };
  }

  // Firing hypothesis: the row exists iff the WINNING call's caller is
  // processed (implementation order) BEFORE the target's own
  // implementation -- a forward-reference pattern.
  let forwardRefPresentMatches = 0;
  let forwardRefPresentTotal = 0;
  for (const def of present) {
    const winner = def.targets.find(t => t.isWinner);
    if (winner === undefined) continue;
    forwardRefPresentTotal++;
    if (winner.firstCallOrder[0] < winner.targetImplementationOrdinal) forwardRefPresentMatches++;
  }
  // For absent definitions, check whether EVERY target's first call
  // happens AFTER (or at) its own implementation (i.e. never forward).
  let forwardRefAbsentAnyForward = 0;
  for (const def of absent) {
    if (def.targets.some(t => t.firstCallOrder[0] < t.targetImplementationOrdinal)) forwardRefAbsentAnyForward++;
  }

  const classHypotheses = [
    {
      name: 'forward-reference: winning call precedes target implementation',
      presentMatches: forwardRefPresentMatches,
      presentTotal: forwardRefPresentTotal,
      absentDefinitionsWithAnyForwardCall: forwardRefAbsentAnyForward,
      absentTotal: absent.length
    },
    classHypothesis('extends another Application Class', d => d.extendsType !== undefined),
    classHypothesis('implements an interface', d => d.implementsType !== undefined),
    classHypothesis('has wildcard import', d => d.hasWildcardImport),
    classHypothesis('has constructor implementation', d => d.hasConstructorImpl),
    classHypothesis('storageMemberCount === 0', d => d.storageMemberCount === 0),
    classHypothesis('storageMemberCount === 1', d => d.storageMemberCount === 1),
    classHypothesis('storageMemberCount >= 2', d => d.storageMemberCount >= 2),
    classHypothesis('distinctTargets === 1', d => d.distinctTargets === 1),
    classHypothesis('distinctTargets >= 2', d => d.distinctTargets >= 2),
    classHypothesis('methodCount <= 3', d => d.methodCount <= 3),
    classHypothesis('methodCount >= 10', d => d.methodCount >= 10),
    classHypothesis('any target called from constructor', d => d.targets.some(t => t.calledFromConstructor)),
    classHypothesis('any recursive self call', d => d.targets.some(t => t.isRecursiveSelfCall)),
    classHypothesis('any target called from 2+ distinct callers', d => d.targets.some(t => t.callerCount > 1)),
    classHypothesis('any target called 2+ times total', d => d.targets.some(t => t.callCount > 1)),
    classHypothesis('winner/first-target called from 2+ callers', d => {
      const winner = d.targets.find(t => t.isWinner);
      const first = [...d.targets].sort((a, b) => (a.firstCallOrder[0] - b.firstCallOrder[0]) || (a.firstCallOrder[1] - b.firstCallOrder[1]))[0];
      const check = winner ?? first;
      return check !== undefined && check.callerCount > 1;
    })
  ];

  console.log(JSON.stringify({
    population: { totalDefinitionsWithOwnCalls: analyzed.length, present: present.length, absent: absent.length },
    storageMemberDistribution: {
      present: countBy(present, d => String(d.storageMemberCount)),
      absent: countBy(absent, d => String(d.storageMemberCount))
    },
    methodCountDistribution: {
      present: countBy(present, d => String(d.methodCount)),
      absent: countBy(absent, d => String(d.methodCount))
    },
    distinctTargetsDistribution: {
      present: countBy(present, d => String(d.distinctTargets)),
      absent: countBy(absent, d => String(d.distinctTargets))
    },
    classHypotheses,
    targetHypotheses,
    sampleContradictionsForFirstImplementationOrdinal: targetHypotheses.find(h => h.name === 'first implementation ordinal')?.contradictionExamples
  }, null, 2));
}

main();
