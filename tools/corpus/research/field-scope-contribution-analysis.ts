/**
 * Cycle 11: observe legacy-pool contribution after the shared scoped FIELD
 * namespace becomes authoritative. This only reads the local snapshot.
 *
 * Usage:
 *   tsx tools/corpus/research/field-scope-contribution-analysis.ts --all
 *   tsx tools/corpus/research/field-scope-contribution-analysis.ts --definition-ids 437,924
 *   tsx tools/corpus/research/field-scope-contribution-analysis.ts --all --json /tmp/cycle11-field-scope.json --quiet
 */

import fs from 'node:fs';

import {
  encodeProgram,
  ReusePoolTraceEvent
} from '../../../src/peoplecode/encoder';
import {
  getSnapshotDefinition,
  listSnapshotDefinitionIds
} from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';

type Pool = ReusePoolTraceEvent['pool'];

interface ParsedArgs {
  all: boolean;
  ids: number[];
  jsonPath?: string;
  quiet: boolean;
}

interface PoolStats {
  reads: number;
  hits: number;
  writes: number;
  definitions: Set<number>;
  hitDefinitions: Set<number>;
  writeDefinitions: Set<number>;
}

interface Example {
  definitionId: number;
  displayName: string;
  pool: Pool;
  fieldName: string;
  controlGroup: number;
  sourceOffset: number;
  source: string;
  reference?: string;
}

const LEGACY_FIELD_POOLS = new Set<Pool>([
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

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--all') all = true;
    else if (arg === '--definition-ids') {
      for (const raw of argv[++index].split(',')) {
        const id = Number(raw.trim());
        if (Number.isInteger(id) && id > 0) ids.add(id);
      }
    } else if (arg === '--json') jsonPath = argv[++index];
    else if (arg === '--quiet') quiet = true;
  }

  if (!all && ids.size === 0) {
    throw new Error('Use --all or --definition-ids <ids>.');
  }

  return { all, ids: [...ids], jsonPath, quiet };
}

function emptyStats(): PoolStats {
  return {
    reads: 0,
    hits: 0,
    writes: 0,
    definitions: new Set(),
    hitDefinitions: new Set(),
    writeDefinitions: new Set()
  };
}

function referenceId(event: ReusePoolTraceEvent): string | undefined {
  return event.reference === undefined
    ? undefined
    : `${event.reference.kind}:${event.reference.sequence}`;
}

function fieldName(event: ReusePoolTraceEvent): string {
  return event.key.split(':').at(-1) ?? event.key;
}

function sourceExcerpt(source: string, offset: number): string {
  const start = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const end = source.indexOf('\n', offset);
  return source
    .slice(start, end === -1 ? source.length : end)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 220);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const db = openSnapshotDatabase();
  const ids = args.all ? listSnapshotDefinitionIds(db) : args.ids;
  const byPool = new Map<Pool, PoolStats>();
  const uniqueLegacyHits = new Map<Pool, Example[]>();
  const unmirroredLegacyWrites = new Map<Pool, Example[]>();
  const uniqueLegacyHitCounts = new Map<Pool, number>();
  const unmirroredLegacyWriteCounts = new Map<Pool, number>();
  const scopedHitDefinitions = new Set<number>();
  const scopedWriteDefinitions = new Set<number>();
  const scopedIdentities = new Set<string>();
  const scopedFieldNames = new Map<string, number>();
  const predictedChangeDefinitions = new Set<number>();
  const predictedChangeIdentities = new Set<string>();
  const predictedChangeFieldNames = new Map<string, number>();
  const predictedChangeExamples: Array<Example & {
    previous: string;
    current: string;
  }> = [];
  const errors: Array<{ definitionId: number; displayName: string; error: string }> = [];
  let encoded = 0;
  let exactPrograms = 0;

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
      encoded++;
      if (generated.equals(definition.storedProgram)) exactPrograms++;
    } catch (error) {
      errors.push({
        definitionId,
        displayName: definition.displayName,
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    const sharedWrites = events.filter(event =>
      event.pool === 'scopedFieldReferences' && event.action === 'WRITE'
    );
    const authoritativeHitOffsets = new Set(
      events
        .filter(event =>
          event.action === 'READ' &&
          event.hit &&
          (
            event.pool === 'recordVariableFields' ||
            event.pool === 'scopedFieldReferences'
          )
        )
        .map(event => event.sourceOffset)
    );
    const readsByOffset = new Map<number, ReusePoolTraceEvent[]>();
    for (const event of events) {
      if (event.action !== 'READ') continue;
      const reads = readsByOffset.get(event.sourceOffset) ?? [];
      reads.push(event);
      readsByOffset.set(event.sourceOffset, reads);
    }

    for (const [sourceOffset, reads] of readsByOffset) {
      const receiver = reads.find(event =>
        event.pool === 'recordVariableFields' && event.hit
      );
      if (receiver !== undefined) continue;

      const scoped = reads.find(event =>
        event.pool === 'scopedFieldReferences' && event.hit
      );
      const legacy = reads.find(event =>
        LEGACY_FIELD_POOLS.has(event.pool) && event.hit
      );
      if (
        scoped === undefined &&
        legacy === undefined
      ) continue;

      const current = scoped === undefined
        ? 'ALLOC'
        : referenceId(scoped) ?? 'ALLOC';
      const previous = legacy === undefined
        ? 'ALLOC'
        : referenceId(legacy) ?? 'ALLOC';
      if (current === previous) continue;

      const exemplar = scoped ?? legacy!;
      const name = fieldName(exemplar);
      predictedChangeDefinitions.add(definitionId);
      predictedChangeIdentities.add(
        `${definitionId}:${exemplar.controlGroup}:${name}`
      );
      predictedChangeFieldNames.set(
        name,
        (predictedChangeFieldNames.get(name) ?? 0) + 1
      );
      if (predictedChangeExamples.length < 50) {
        predictedChangeExamples.push({
          definitionId,
          displayName: definition.displayName,
          pool: exemplar.pool,
          fieldName: name,
          controlGroup: exemplar.controlGroup,
          sourceOffset,
          source: sourceExcerpt(definition.sourceText, sourceOffset),
          reference: referenceId(exemplar),
          previous,
          current
        });
      }
    }

    for (const event of events) {
      const stats = byPool.get(event.pool) ?? emptyStats();
      stats.definitions.add(definitionId);
      if (event.action === 'READ') {
        stats.reads++;
        if (event.hit) {
          stats.hits++;
          stats.hitDefinitions.add(definitionId);
        }
      } else {
        stats.writes++;
        stats.writeDefinitions.add(definitionId);
      }
      byPool.set(event.pool, stats);

      const name = fieldName(event);
      const example: Example = {
        definitionId,
        displayName: definition.displayName,
        pool: event.pool,
        fieldName: name,
        controlGroup: event.controlGroup,
        sourceOffset: event.sourceOffset,
        source: sourceExcerpt(definition.sourceText, event.sourceOffset),
        reference: referenceId(event)
      };

      if (event.pool === 'scopedFieldReferences') {
        const identity = `${definitionId}:${event.controlGroup}:${name}`;
        scopedIdentities.add(identity);
        if (event.action === 'READ' && event.hit) {
          scopedHitDefinitions.add(definitionId);
          scopedFieldNames.set(name, (scopedFieldNames.get(name) ?? 0) + 1);
        } else if (event.action === 'WRITE') {
          scopedWriteDefinitions.add(definitionId);
        }
      }

      if (
        LEGACY_FIELD_POOLS.has(event.pool) &&
        event.action === 'READ' &&
        event.hit &&
        !authoritativeHitOffsets.has(event.sourceOffset)
      ) {
        uniqueLegacyHitCounts.set(
          event.pool,
          (uniqueLegacyHitCounts.get(event.pool) ?? 0) + 1
        );
        const examples = uniqueLegacyHits.get(event.pool) ?? [];
        if (examples.length < 12) examples.push(example);
        uniqueLegacyHits.set(event.pool, examples);
      }

      if (
        LEGACY_FIELD_POOLS.has(event.pool) &&
        event.action === 'WRITE'
      ) {
        const mirrored = sharedWrites.some(write =>
          write.sourceOffset === event.sourceOffset &&
          write.controlGroup === event.controlGroup &&
          fieldName(write) === name &&
          referenceId(write) === referenceId(event)
        );
        if (!mirrored) {
          unmirroredLegacyWriteCounts.set(
            event.pool,
            (unmirroredLegacyWriteCounts.get(event.pool) ?? 0) + 1
          );
          const examples = unmirroredLegacyWrites.get(event.pool) ?? [];
          if (examples.length < 12) examples.push(example);
          unmirroredLegacyWrites.set(event.pool, examples);
        }
      }
    }
  }

  db.close();

  const poolStats = Object.fromEntries(
    [...byPool.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([pool, stats]) => [pool, {
        reads: stats.reads,
        hits: stats.hits,
        writes: stats.writes,
        definitions: stats.definitions.size,
        hitDefinitions: stats.hitDefinitions.size,
        writeDefinitions: stats.writeDefinitions.size
      }])
  );

  const legacyContribution = Object.fromEntries(
    [...LEGACY_FIELD_POOLS].map(pool => [pool, {
      uniqueHits: uniqueLegacyHitCounts.get(pool) ?? 0,
      uniqueHitExamples: uniqueLegacyHits.get(pool) ?? [],
      unmirroredWrites: unmirroredLegacyWriteCounts.get(pool) ?? 0,
      unmirroredWriteExamples: unmirroredLegacyWrites.get(pool) ?? []
    }])
  );

  const report = {
    population: {
      requested: ids.length,
      encoded,
      encodeErrors: errors.length,
      exactPrograms
    },
    scopedNamespace: {
      identities: scopedIdentities.size,
      hitDefinitions: scopedHitDefinitions.size,
      writeDefinitions: scopedWriteDefinitions.size,
      hitDefinitionIds: [...scopedHitDefinitions].sort((a, b) => a - b),
      mostFrequentHitFieldNames: [...scopedFieldNames.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 50)
        .map(([name, hits]) => ({ name, hits }))
    },
    predictedSemanticChanges: {
      definitions: predictedChangeDefinitions.size,
      identities: predictedChangeIdentities.size,
      definitionIds: [...predictedChangeDefinitions].sort((a, b) => a - b),
      fieldNames: [...predictedChangeFieldNames.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([name, changes]) => ({ name, changes })),
      examples: predictedChangeExamples
    },
    poolStats,
    legacyContribution,
    interpretation: {
      uniqueLegacyHit:
        'A legacy FIELD shadow read hit after the authoritative paths missed. It is observed but cannot affect generated output.',
      unmirroredWrite:
        'A legacy FIELD write had no same-occurrence scoped write of the same reference; removing that write could lose state.',
      rowShorthandRecords:
        'This RECORD pool is reported in poolStats only and remains outside the FIELD semantic change.',
      recordVariableFields:
        'This receiver-specific pool remains before the shared scoped lookup; its hits remain intentional first-choice bindings.',
      predictedSemanticChange:
        'The receiver-specific path missed and the authoritative scoped result differs from the first result the prior legacy fallback order would have selected.'
    },
    errors: errors.slice(0, 50)
  };

  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.jsonPath !== undefined) fs.writeFileSync(args.jsonPath, output);
  if (!args.quiet) process.stdout.write(output);
}

main();
