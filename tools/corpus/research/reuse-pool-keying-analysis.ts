/**
 * Cycle 10: population study for the remaining postfix reuse-pool keying.
 *
 * This is read-only research infrastructure. It encodes the completed local
 * HCDEV snapshot with the observational `reusePoolTrace` hook and compares
 * current pool decisions with control-group-scoped, globally-interned, and
 * shared-field-namespace counterfactuals. It never connects to HCDEV.
 *
 * Usage:
 *   tsx tools/corpus/research/reuse-pool-keying-analysis.ts --all
 *   tsx tools/corpus/research/reuse-pool-keying-analysis.ts --definition-ids 437,524,924,9989
 *   tsx tools/corpus/research/reuse-pool-keying-analysis.ts --all --json /tmp/cycle10-pools.json
 */

import fs from 'node:fs';

import {
  encodeProgram,
  ReusePoolTraceEvent
} from '../../../src/peoplecode/encoder';

import {
  openSnapshotDatabase
} from '../snapshot/store';

import {
  getSnapshotDefinition,
  listSnapshotDefinitionIds
} from '../snapshot/reader';

import {
  generateEvidence
} from './reference-lifecycle';

type Pool = ReusePoolTraceEvent['pool'];

interface ParsedArgs {
  ids: number[];
  all: boolean;
  jsonPath?: string;
  quiet: boolean;
}

interface EventRow extends ReusePoolTraceEvent {
  definitionId: number;
  displayName: string;
  exactProgram: boolean;
  source: string;
}

interface Example {
  definitionId: number;
  displayName: string;
  sourceOffset: number;
  source: string;
  detail: string;
}

interface CounterfactualSummary {
  reads: number;
  same: number;
  changed: number;
  exactSame: number;
  exactChanged: number;
  nonExactChanged: number;
  examples: Example[];
}

interface SemanticCase {
  event: EventRow;
  label: string;
  current: string;
  hypothetical: string;
  actualReference?: string;
}

interface SiteStats {
  reads: number;
  hits: number;
  writes: number;
  definitions: Set<number>;
  exactDefinitions: Set<number>;
}

const GLOBAL_POOLS = new Set<Pool>([
  'rowShorthandRecords',
  'typedRowFields'
]);

const FIELD_POOLS = new Set<Pool>([
  'typedRowFields',
  'fieldReferencesByControlGroup',
  'explicitRecordFields',
  'rowShorthandFields',
  'declaredRecordFields'
]);

function parseArgs(argv: string[]): ParsedArgs {
  const ids = new Set<number>();
  let all = false;
  let jsonPath: string | undefined;
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') {
      all = true;
    } else if (argv[i] === '--definition-ids') {
      for (const raw of argv[++i].split(',')) {
        const id = Number(raw.trim());
        if (Number.isInteger(id) && id > 0) ids.add(id);
      }
    } else if (argv[i] === '--json') {
      jsonPath = argv[++i];
    } else if (argv[i] === '--quiet') {
      quiet = true;
    }
  }

  if (!all && ids.size === 0) {
    throw new Error('Use --all or --definition-ids <ids>.');
  }

  return { ids: [...ids], all, jsonPath, quiet };
}

function referenceId(event: ReusePoolTraceEvent | undefined): string | undefined {
  const reference = event?.reference;
  return reference === undefined
    ? undefined
    : `${reference.kind}:${reference.sequence}`;
}

function semanticKey(event: ReusePoolTraceEvent): string {
  if (GLOBAL_POOLS.has(event.pool)) return event.key;
  return event.key.replace(/^\d+:/, '');
}

function fieldName(event: ReusePoolTraceEvent): string {
  const parts = event.key.split(':');
  return parts[parts.length - 1];
}

function sourceExcerpt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineEnd = source.indexOf('\n', offset);
  return source
    .slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 220);
}

function addExample(target: Example[], event: EventRow, detail: string): void {
  if (target.length >= 12) return;
  target.push({
    definitionId: event.definitionId,
    displayName: event.displayName,
    sourceOffset: event.sourceOffset,
    source: sourceExcerpt(event.source, event.sourceOffset),
    detail
  });
}

function emptyCounterfactual(): CounterfactualSummary {
  return {
    reads: 0,
    same: 0,
    changed: 0,
    exactSame: 0,
    exactChanged: 0,
    nonExactChanged: 0,
    examples: []
  };
}

function updateCounterfactual(
  summary: CounterfactualSummary,
  event: EventRow,
  current: string,
  hypothetical: string,
  label: string
): void {
  summary.reads++;
  const same = current === hypothetical;

  if (same) {
    summary.same++;
    if (event.exactProgram) summary.exactSame++;
    return;
  }

  summary.changed++;
  if (event.exactProgram) summary.exactChanged++;
  else summary.nonExactChanged++;

  addExample(
    summary.examples,
    event,
    `${label}: current=${current}, hypothetical=${hypothetical}, group=${event.controlGroup}, key=${event.key}, site=${event.site}`
  );
}

function decisionToken(
  reads: readonly EventRow[]
): string {
  const hit = reads.find(event => event.hit === true);
  return hit === undefined
    ? 'ALLOC'
    : referenceId(hit) ?? 'ALLOC';
}

function candidateToken(event: EventRow | undefined): string | undefined {
  return event === undefined ? undefined : referenceId(event);
}

function mapIncrement(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function siteStatsFor(map: Map<string, SiteStats>, key: string): SiteStats {
  let stats = map.get(key);
  if (stats === undefined) {
    stats = {
      reads: 0,
      hits: 0,
      writes: 0,
      definitions: new Set(),
      exactDefinitions: new Set()
    };
    map.set(key, stats);
  }
  return stats;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const db = openSnapshotDatabase();
  const ids = args.all ? listSnapshotDefinitionIds(db) : args.ids;

  const rows: EventRow[] = [];
  const encodeErrors: Array<{ definitionId: number; displayName: string; error: string }> = [];
  let exactPrograms = 0;
  let encoded = 0;

  for (const definitionId of ids) {
    const definition = getSnapshotDefinition(db, definitionId);
    const events: ReusePoolTraceEvent[] = [];

    try {
      const generated = encodeProgram(definition.sourceText, {
        owner: {
          recordName: definition.objectvalue1.trim(),
          fieldName: definition.objectvalue2.trim()
        },
        reusePoolTrace: event => events.push(event)
      });
      const exactProgram = generated.equals(definition.storedProgram);
      if (exactProgram) exactPrograms++;
      encoded++;

      for (const event of events) {
        rows.push({
          ...event,
          definitionId,
          displayName: definition.displayName,
          exactProgram,
          source: definition.sourceText
        });
      }
    } catch (error) {
      encodeErrors.push({
        definitionId,
        displayName: definition.displayName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  db.close();

  const siteStats = new Map<string, SiteStats>();
  const definitionsWithEvents = new Set<number>();
  const exactDefinitionsWithEvents = new Set<number>();
  const writesByPoolIdentity = new Map<string, EventRow[]>();
  const scopedAlternative = emptyCounterfactual();
  const globalAlternative = emptyCounterfactual();
  const sharedGroupFieldAlternative = emptyCounterfactual();
  const sharedGroupFirstFieldAlternative = emptyCounterfactual();
  const sharedGlobalFieldAlternative = emptyCounterfactual();
  const scopedAlternativeByPool = new Map<Pool, CounterfactualSummary>();
  const globalAlternativeByPool = new Map<Pool, CounterfactualSummary>();
  const crossSiteBridges = new Map<string, number>();
  const crossSiteExamples = new Map<string, Example[]>();
  const changedScopedCases: SemanticCase[] = [];
  const changedSharedGroupCases: SemanticCase[] = [];
  const changedSharedGroupFirstCases: SemanticCase[] = [];

  for (const event of rows) {
    definitionsWithEvents.add(event.definitionId);
    if (event.exactProgram) exactDefinitionsWithEvents.add(event.definitionId);

    const stats = siteStatsFor(siteStats, `${event.pool}|${event.site}`);
    stats.definitions.add(event.definitionId);
    if (event.exactProgram) stats.exactDefinitions.add(event.definitionId);

    const poolIdentity =
      `${event.definitionId}|${event.pool}|${semanticKey(event)}`;
    const priorPoolWrites = writesByPoolIdentity.get(poolIdentity) ?? [];

    if (event.action === 'READ') {
      stats.reads++;
      if (event.hit) stats.hits++;

      if (FIELD_POOLS.has(event.pool)) {
        if (event.hit && priorPoolWrites.length > 0) {
          const origin = [...priorPoolWrites]
            .reverse()
            .find(write => referenceId(write) === referenceId(event));
          if (origin !== undefined && origin.site !== event.site) {
            const bridge = `${origin.site} -> ${event.site}`;
            mapIncrement(crossSiteBridges, bridge);
            const examples = crossSiteExamples.get(bridge) ?? [];
            addExample(examples, event, `reused ${referenceId(event)} first written by ${origin.site}`);
            crossSiteExamples.set(bridge, examples);
          }
        }
      }
    } else {
      stats.writes++;
      priorPoolWrites.push(event);
      writesByPoolIdentity.set(poolIdentity, priorPoolWrites);
    }
  }

  /*
   * Pool reads are fallback chains, so compare counterfactuals at the whole
   * member-decision level rather than treating an expected first-pool miss
   * as a final allocation decision. All events for one member share the
   * same source offset and are emitted contiguously.
   */
  const decisions: EventRow[][] = [];
  for (const event of rows) {
    const current = decisions[decisions.length - 1];
    if (
      current !== undefined &&
      current[0].definitionId === event.definitionId &&
      current[0].sourceOffset === event.sourceOffset
    ) {
      current.push(event);
    } else {
      decisions.push([event]);
    }
  }

  const decisionPoolWrites = new Map<string, EventRow[]>();
  const decisionFieldWritesByGroup = new Map<string, EventRow[]>();
  const decisionFieldWritesGlobal = new Map<string, EventRow[]>();

  for (const decision of decisions) {
    const reads = decision.filter(event => event.action === 'READ');
    const writes = decision.filter(event => event.action === 'WRITE');
    const first = reads[0] ?? writes[0];
    if (first === undefined) continue;

    if (reads.length > 0) {
      const current = decisionToken(reads);
      const actualEvent = reads.find(event => event.hit === true) ?? writes[0];
      const actualReference = referenceId(actualEvent);
      const pools = new Set(reads.map(event => event.pool));

      for (const pool of pools) {
        const isGlobal = GLOBAL_POOLS.has(pool);
        const summary = isGlobal
          ? (scopedAlternativeByPool.get(pool) ?? emptyCounterfactual())
          : (globalAlternativeByPool.get(pool) ?? emptyCounterfactual());

        let hypotheticalReference: string | undefined;
        for (const read of reads) {
          if (read.pool !== pool) {
            if (read.hit) {
              hypotheticalReference = referenceId(read);
              break;
            }
            continue;
          }

          const identity =
            `${read.definitionId}|${read.pool}|${semanticKey(read)}`;
          const prior = decisionPoolWrites.get(identity) ?? [];
          const candidate = isGlobal
            ? [...prior].reverse().find(
                write => write.controlGroup === read.controlGroup
              )
            : prior[prior.length - 1];
          const token = candidateToken(candidate);
          if (token !== undefined) {
            hypotheticalReference = token;
            break;
          }
        }

        const hypothetical = hypotheticalReference ?? 'ALLOC';
        updateCounterfactual(
          summary,
          first,
          current,
          hypothetical,
          isGlobal
            ? `${pool} with control-group scoping`
            : `${pool} with global interning`
        );

        if (isGlobal) {
          scopedAlternativeByPool.set(pool, summary);
          updateCounterfactual(
            scopedAlternative,
            first,
            current,
            hypothetical,
            `${pool} with control-group scoping`
          );
          if (current !== hypothetical) {
            changedScopedCases.push({
              event: first,
              label: pool,
              current,
              hypothetical,
              actualReference
            });
          }
        } else {
          globalAlternativeByPool.set(pool, summary);
          updateCounterfactual(
            globalAlternative,
            first,
            current,
            hypothetical,
            `${pool} with global interning`
          );
        }
      }

      if (reads.some(event => FIELD_POOLS.has(event.pool))) {
        const name = fieldName(first);
        const groupKey =
          `${first.definitionId}:${first.controlGroup}:${name}`;
        const globalKey = `${first.definitionId}:${name}`;
        const groupWrites = decisionFieldWritesByGroup.get(groupKey) ?? [];
        const globalWrites = decisionFieldWritesGlobal.get(globalKey) ?? [];
        const groupCandidate = candidateToken(groupWrites[groupWrites.length - 1]);
        const groupFirstCandidate = candidateToken(groupWrites[0]);
        const globalCandidate = candidateToken(globalWrites[globalWrites.length - 1]);
        const noCandidate = 'ALLOC';

        updateCounterfactual(
          sharedGroupFieldAlternative,
          first,
          current,
          groupCandidate ?? noCandidate,
          'one shared control-group FIELD namespace'
        );
        updateCounterfactual(
          sharedGroupFirstFieldAlternative,
          first,
          current,
          groupFirstCandidate ?? noCandidate,
          'one shared control-group FIELD namespace, first identity retained'
        );
        updateCounterfactual(
          sharedGlobalFieldAlternative,
          first,
          current,
          globalCandidate ?? noCandidate,
          'one shared global FIELD namespace'
        );
        const groupHypothetical = groupCandidate ?? noCandidate;
        if (current !== groupHypothetical) {
          changedSharedGroupCases.push({
            event: first,
            label: 'shared-control-group-field-namespace',
            current,
            hypothetical: groupHypothetical,
            actualReference
          });
        }
        const groupFirstHypothetical = groupFirstCandidate ?? noCandidate;
        if (current !== groupFirstHypothetical) {
          changedSharedGroupFirstCases.push({
            event: first,
            label: 'shared-control-group-first-field-namespace',
            current,
            hypothetical: groupFirstHypothetical,
            actualReference
          });
        }
      }
    }

    for (const write of writes) {
      const identity =
        `${write.definitionId}|${write.pool}|${semanticKey(write)}`;
      const poolWrites = decisionPoolWrites.get(identity) ?? [];
      poolWrites.push(write);
      decisionPoolWrites.set(identity, poolWrites);

      if (FIELD_POOLS.has(write.pool)) {
        const name = fieldName(write);
        const groupKey =
          `${write.definitionId}:${write.controlGroup}:${name}`;
        const globalKey = `${write.definitionId}:${name}`;
        const groupWrites = decisionFieldWritesByGroup.get(groupKey) ?? [];
        groupWrites.push(write);
        decisionFieldWritesByGroup.set(groupKey, groupWrites);
        const globalWrites = decisionFieldWritesGlobal.get(globalKey) ?? [];
        globalWrites.push(write);
        decisionFieldWritesGlobal.set(globalKey, globalWrites);
      }
    }
  }

  const evidenceDb = openSnapshotDatabase();
  const evidenceCache = new Map<number, ReturnType<typeof generateEvidence> | undefined>();

  const analyzeStoredCases = (cases: readonly SemanticCase[]) => {
    const summary = {
      changedCases: cases.length,
      matchedOccurrence: 0,
      aligned: 0,
      alignmentLost: 0,
      storedSupportsCurrent: 0,
      storedSupportsAlternative: 0,
      ambiguous: 0,
      examplesCurrent: [] as Example[],
      examplesAlternative: [] as Example[],
      examplesLost: [] as Example[]
    };

    for (const item of cases) {
      let evidence = evidenceCache.get(item.event.definitionId);
      if (!evidenceCache.has(item.event.definitionId)) {
        try {
          const definition = getSnapshotDefinition(
            evidenceDb,
            item.event.definitionId
          );
          evidence = generateEvidence(item.event.definitionId, definition);
        } catch {
          evidence = undefined;
        }
        evidenceCache.set(item.event.definitionId, evidence);
      }

      if (evidence === undefined) {
        summary.ambiguous++;
        continue;
      }

      const name = fieldName(item.event).toLowerCase();
      const expectedEnd = item.event.sourceOffset + name.length;
      const actualSequence = item.actualReference === undefined
        ? undefined
        : Number(item.actualReference.split(':')[1]);
      const candidates = evidence.rows
        .filter(row => {
          const generated = row.generated;
          if (generated === undefined) return false;
          const generatedName =
            (generated.fieldName ?? generated.recordName ?? '').toLowerCase();
          return (
            (actualSequence === undefined || generated.sequence === actualSequence) &&
            generatedName === name
          );
        })
        .sort((a, b) =>
          Math.abs(a.generated!.sourceOffset - expectedEnd) -
          Math.abs(b.generated!.sourceOffset - expectedEnd)
        );
      const row = candidates[0];

      if (
        row === undefined ||
        Math.abs(row.generated!.sourceOffset - expectedEnd) > 80
      ) {
        summary.ambiguous++;
        continue;
      }

      summary.matchedOccurrence++;
      if (row.alignmentTrust !== 'aligned') {
        summary.alignmentLost++;
        addExample(
          summary.examplesLost,
          item.event,
          `${item.label}: target occurrence follows the first reference-sequence disagreement`
        );
        continue;
      }

      summary.aligned++;
      const stored = row.stored;
      const currentSequence = Number(item.current.split(':')[1]);
      const alternativeSequence = Number(item.hypothetical.split(':')[1]);
      const currentMatches = item.current === 'ALLOC'
        ? stored?.decision === 'ALLOC'
        : stored?.decision === 'REUSE' && stored.nameNum === currentSequence;
      const alternativeMatches = item.hypothetical === 'ALLOC'
        ? stored?.decision === 'ALLOC'
        : stored?.decision === 'REUSE' && stored.nameNum === alternativeSequence;

      if (currentMatches && !alternativeMatches) {
        summary.storedSupportsCurrent++;
        addExample(
          summary.examplesCurrent,
          item.event,
          `${item.label}: stored=${stored?.decision} nameNum=${stored?.nameNum}, current=${item.current}, alternative=${item.hypothetical}`
        );
      } else if (alternativeMatches && !currentMatches) {
        summary.storedSupportsAlternative++;
        addExample(
          summary.examplesAlternative,
          item.event,
          `${item.label}: stored=${stored?.decision} nameNum=${stored?.nameNum}, current=${item.current}, alternative=${item.hypothetical}`
        );
      } else {
        summary.ambiguous++;
      }
    }

    return summary;
  };

  const storedScopedEvidence = analyzeStoredCases(changedScopedCases);
  const storedSharedGroupFieldEvidence =
    analyzeStoredCases(changedSharedGroupCases);
  const storedSharedGroupFirstFieldEvidence =
    analyzeStoredCases(changedSharedGroupFirstCases);
  evidenceDb.close();

  const byPool = new Map<string, { reads: number; hits: number; writes: number; definitions: Set<number>; exactDefinitions: Set<number> }>();
  for (const [key, value] of siteStats) {
    const pool = key.split('|')[0];
    const total = byPool.get(pool) ?? {
      reads: 0,
      hits: 0,
      writes: 0,
      definitions: new Set<number>(),
      exactDefinitions: new Set<number>()
    };
    total.reads += value.reads;
    total.hits += value.hits;
    total.writes += value.writes;
    for (const id of value.definitions) total.definitions.add(id);
    for (const id of value.exactDefinitions) total.exactDefinitions.add(id);
    byPool.set(pool, total);
  }

  const serializable = {
    population: {
      requested: ids.length,
      encoded,
      encodeErrors: encodeErrors.length,
      exactPrograms,
      definitionsWithEvents: definitionsWithEvents.size,
      exactDefinitionsWithEvents: exactDefinitionsWithEvents.size,
      events: rows.length
    },
    byPool: Object.fromEntries(
      [...byPool.entries()].map(([pool, stats]) => [pool, {
        reads: stats.reads,
        hits: stats.hits,
        writes: stats.writes,
        definitions: stats.definitions.size,
        exactDefinitions: stats.exactDefinitions.size
      }])
    ),
    bySite: Object.fromEntries(
      [...siteStats.entries()].map(([site, stats]) => [site, {
        reads: stats.reads,
        hits: stats.hits,
        writes: stats.writes,
        definitions: stats.definitions.size,
        exactDefinitions: stats.exactDefinitions.size
      }])
    ),
    counterfactuals: {
      scopedAlternative,
      scopedAlternativeByPool: Object.fromEntries(scopedAlternativeByPool),
      globalAlternative,
      globalAlternativeByPool: Object.fromEntries(globalAlternativeByPool),
      sharedGroupFieldAlternative,
      sharedGroupFirstFieldAlternative,
      sharedGlobalFieldAlternative,
      storedScopedEvidence,
      storedSharedGroupFieldEvidence,
      storedSharedGroupFirstFieldEvidence
    },
    crossSiteBridges: Object.fromEntries(
      [...crossSiteBridges.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([bridge, count]) => [bridge, {
          count,
          examples: crossSiteExamples.get(bridge) ?? []
        }])
    ),
    encodeErrors: encodeErrors.slice(0, 50)
  };

  if (args.jsonPath !== undefined) {
    fs.writeFileSync(args.jsonPath, `${JSON.stringify(serializable, null, 2)}\n`);
  }

  if (!args.quiet) {
    console.log(JSON.stringify(serializable, null, 2));
  }
}

main();
