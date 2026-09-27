/**
 * Cycle 36 Investigation A: does PeopleTools give Application Class
 * built-in object/PACKAGE identities method-wide lifetime across control
 * groups, distinct from ordinary PeopleCode's existing control-group-
 * scoped reuse? Read-only, no encoder changes.
 *
 * Method: for each definition (Application Class or ordinary), find
 * methods/programs where the SAME built-in type is declared via
 * `Local TYPE &var` two or more times, crossing an approximate control-
 * group boundary (a simple If/For/While/Evaluate/Try nesting tracker).
 * For each candidate, compare:
 *   - GENERATED: number of DISTINCT controlGroup values the encoder's
 *     own referenceTrace assigns to that type's PACKAGE allocations
 *     (i.e. how many identities the CURRENT encoder allocates).
 *   - STORED: number of `recname === 'PACKAGE' && refname === TYPE`
 *     rows in the real captured PSPCMNAME table (definition.names).
 * If stored has FEWER rows than generated for a candidate, that is
 * direct, ground-truth evidence PeopleTools reused one identity across
 * the control-group boundary our own encoder split. If stored count
 * matches generated count, current per-control-group-fresh behavior is
 * already correct for that case.
 *
 * Usage:
 *   npx tsx tools/corpus/research/appclass-builtin-lifetime-analysis.ts
 */

import { encodeProgramArtifacts, type ReferenceTraceEvent } from '../../../src/peoplecode/encoder';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const APPLICATION_CLASS_OBJECT_ID = 104;
const BUILTIN_TYPES = [
  'XmlNode', 'XmlDoc', 'Row', 'Rowset', 'Record', 'SQL', 'File', 'ApiObject',
  'Grid', 'ProcessRequest', 'Message', 'JsonObject', 'JsonArray'
];

function ownerContext(definition: SnapshotDefinition) {
  const values = [
    definition.objectvalue1, definition.objectvalue2, definition.objectvalue3,
    definition.objectvalue4, definition.objectvalue5, definition.objectvalue6,
    definition.objectvalue7
  ].map(value => value.trim());
  const eventIndex = values.findIndex(value => value.toLowerCase() === 'onexecute');
  return {
    recordName: values[0],
    fieldName: values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

/** Approximate nesting-depth tracker: +1 per control-opener keyword line,
 * -1 per matching closer. Good enough for population-scale candidate
 * detection, not meant to be a real parser. */
function nestingDepthAtEachOffset(body: string): Map<number, number> {
  const depths = new Map<number, number>();
  let depth = 0;
  const opener = /\b(If|For|While|Evaluate|Try)\b/gi;
  const closer = /\b(End-If|End-For|End-While|End-Evaluate|Catch|End-Try)\b/gi;
  const events: Array<{ index: number; delta: number }> = [];
  for (const m of body.matchAll(opener)) events.push({ index: m.index ?? 0, delta: 1 });
  for (const m of body.matchAll(closer)) events.push({ index: m.index ?? 0, delta: -1 });
  events.sort((a, b) => a.index - b.index);
  let cursor = 0;
  for (const event of events) {
    depths.set(cursor, depth);
    if (event.delta > 0) depth++;
    else depth = Math.max(0, depth - 1);
    cursor = event.index;
  }
  depths.set(cursor, depth);
  depths.set(body.length, depth);
  return depths;
}

function depthAt(depths: Map<number, number>, offset: number): number {
  let best = 0;
  let bestOffset = -1;
  for (const [off, depth] of depths) {
    if (off <= offset && off > bestOffset) { best = depth; bestOffset = off; }
  }
  return best;
}

interface Candidate {
  definitionId: number;
  isAppClass: boolean;
  methodName: string;
  type: string;
  declarationCount: number;
  depths: number[];
  generatedDistinctIdentities: number;
  storedRowCount: number;
}

function findCandidatesInBody(body: string): Map<string, number[]> {
  const depths = nestingDepthAtEachOffset(body);
  const byType = new Map<string, number[]>();
  for (const type of BUILTIN_TYPES) {
    const pattern = new RegExp(`\\bLocal\\s+(?:array\\s+of\\s+)?${type}\\s+&`, 'gi');
    const offsets = [...body.matchAll(pattern)].map(m => m.index ?? 0);
    if (offsets.length < 2) continue;
    const ds = offsets.map(offset => depthAt(depths, offset));
    if (new Set(ds).size < 2) continue; // must cross a nesting boundary
    byType.set(type, ds);
  }
  return byType;
}

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db);
  db.close();

  const candidates: Candidate[] = [];
  let appClassScanned = 0;
  let ordinaryScanned = 0;

  for (const definition of definitions) {
    const isAppClass = definition.objectid1 === APPLICATION_CLASS_OBJECT_ID;

    if (isAppClass) {
      const parsed = parseApplicationClassSource(definition.sourceText);
      if (parsed === undefined) continue;
      appClassScanned++;
      const methods = parsed.members.filter((m): m is any => m.kind === 'method');
      if (methods.length === 0) continue;

      const trace: ReferenceTraceEvent[] = [];
      let artifacts;
      try {
        artifacts = encodeProgramArtifacts(definition.sourceText, {
          owner: ownerContext(definition),
          referenceTrace: event => trace.push(event)
        });
      } catch { continue; }
      void artifacts;

      for (const method of methods) {
        const byType = findCandidatesInBody(method.body);
        for (const [type, ds] of byType) {
          const upper = type.toUpperCase();
          const generatedDistinct = new Set(
            trace
              .filter(e => e.action === 'ALLOC' && e.reference.kind === 'package' && (e.reference as any).packageName === upper)
              .map(e => e.controlGroup)
          ).size;
          if (generatedDistinct < 2) continue; // encoder only produced one identity anyway; not informative
          const storedRowCount = definition.names.filter(row => row.recname.trim() === 'PACKAGE' && row.refname.trim() === upper).length;
          candidates.push({
            definitionId: definition.definitionId,
            isAppClass: true,
            methodName: method.name,
            type,
            declarationCount: ds.length,
            depths: ds,
            generatedDistinctIdentities: generatedDistinct,
            storedRowCount
          });
        }
      }
    } else {
      ordinaryScanned++;
      const byType = findCandidatesInBody(definition.sourceText);
      if (byType.size === 0) continue;

      const trace: ReferenceTraceEvent[] = [];
      try {
        encodeProgramArtifacts(definition.sourceText, {
          owner: ownerContext(definition),
          referenceTrace: event => trace.push(event)
        });
      } catch { continue; }

      for (const [type, ds] of byType) {
        const upper = type.toUpperCase();
        const generatedDistinct = new Set(
          trace
            .filter(e => e.action === 'ALLOC' && e.reference.kind === 'package' && (e.reference as any).packageName === upper)
            .map(e => e.controlGroup)
        ).size;
        if (generatedDistinct < 2) continue;
        const storedRowCount = definition.names.filter(row => row.recname.trim() === 'PACKAGE' && row.refname.trim() === upper).length;
        candidates.push({
          definitionId: definition.definitionId,
          isAppClass: false,
          methodName: '(top-level)',
          type,
          declarationCount: ds.length,
          depths: ds,
          generatedDistinctIdentities: generatedDistinct,
          storedRowCount
        });
      }
    }
  }

  const appClassCandidates = candidates.filter(c => c.isAppClass);
  const ordinaryCandidates = candidates.filter(c => !c.isAppClass);

  const summarize = (list: Candidate[]) => ({
    total: list.length,
    storedReusesAcrossBoundary: list.filter(c => c.storedRowCount < c.generatedDistinctIdentities).length,
    storedMatchesGenerated: list.filter(c => c.storedRowCount === c.generatedDistinctIdentities).length,
    storedMoreThanGenerated: list.filter(c => c.storedRowCount > c.generatedDistinctIdentities).length,
    byType: Object.fromEntries(
      [...new Set(list.map(c => c.type))].map(type => {
        const subset = list.filter(c => c.type === type);
        return [type, {
          total: subset.length,
          storedReusesAcrossBoundary: subset.filter(c => c.storedRowCount < c.generatedDistinctIdentities).length,
          storedMatchesGenerated: subset.filter(c => c.storedRowCount === c.generatedDistinctIdentities).length
        }];
      })
    )
  });

  console.log(JSON.stringify({
    population: { appClassScanned, ordinaryScanned },
    appClass: summarize(appClassCandidates),
    ordinary: summarize(ordinaryCandidates),
    appClassRows: appClassCandidates,
    ordinaryRows: ordinaryCandidates
  }, null, 2));
}

main();
