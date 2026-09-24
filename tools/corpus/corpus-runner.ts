import childProcess from 'node:child_process';

import {
  CorpusResult
} from './classifications';

import {
  compareAgainstBaseline,
  loadBaseline,
  regressionGatePassed
} from './baseline';

import {
  discoverDefinitions,
  getConnectionConfig,
  openCorpusConnection,
  DiscoveryOptions
} from './discovery';

import {
  CorpusInventory
} from './inventory';

import {
  CorpusReporter
} from './reporter';

import {
  validateDefinition
} from './validator';

import type {
  CorpusDataSource,
  CorpusWorkItem
} from './datasource';

import {
  LocalCorpusDataSource
} from './local-datasource';

import {
  LiveCorpusDataSource
} from './live-datasource';

import {
  listSnapshotDefinitionIds,
  getSnapshotDefinition,
  snapshotToCorpusDefinition
} from './snapshot/reader';

import {
  openSnapshotDatabase
} from './snapshot/store';

export interface CorpusRunOptions
  extends DiscoveryOptions {
  databaseName?: string;

  verbose?: boolean;
  compareBaseline?: boolean;
  failed?: boolean;
  traceRefs?: boolean;
  live?: boolean;

  /**
   * Stable local SQLite definition identity. Resolved to the stored
   * seven-part PeopleSoft key before Oracle access.
   */
  definitionId?: number;
}

function currentGitCommit():
  string | undefined {
  try {
    return childProcess
      .execFileSync(
        'git',
        ['rev-parse', 'HEAD'],
        {
          encoding: 'utf8'
        }
      )
      .trim();
  } catch {
    return undefined;
  }
}

export async function runCorpus(
  options: CorpusRunOptions
): Promise<{
  results: CorpusResult[];
  exitCode: number;
}> {
  const config =
    getConnectionConfig();

  const databaseName =
    options.databaseName ??
    config.connectString;

  const inventory =
    new CorpusInventory();

  const reporter =
    new CorpusReporter();

  const results:
    CorpusResult[] = [];

  let exactCount = 0;
  let failureCount = 0;

  let connection:
    Awaited<
      ReturnType<
        typeof openCorpusConnection
      >
    > | undefined;

  let dataSource:
    CorpusDataSource | undefined;

  try {
    console.log(
      'PeopleCode Corpus Harness'
    );
    console.log(
      '-------------------------'
    );
    console.log(
      `Database: ${databaseName}`
    );
    console.log(
      `Mode:     ${
        options.definitionId !== undefined
          ? 'DEFINITION ID'
          : options.failed
            ? 'FAILED WORK QUEUE'
            : 'DISCOVERY'
      }`
    );
    console.log(
      `Source:   ${
        options.live
          ? 'HCDEV LIVE'
          : 'LOCAL SNAPSHOT'
      }`
    );
    console.log(
      `Limit:    ${options.limit}`
    );
    console.log(
      `Offset:   ${options.offset ?? 0}`
    );
    console.log(
      `Trace:    ${
        options.traceRefs
          ? 'REFERENCES'
          : 'off'
      }`
    );
    console.log('');

    let workItems:
      CorpusWorkItem[];

    if (
      options.definitionId !== undefined
    ) {
      const definition =
        inventory.definitionById(
          options.definitionId
        );

      if (!definition) {
        throw new Error(
          `Definition ID ${options.definitionId} was not found in the corpus inventory.`
        );
      }

      workItems = [
        {
          definitionId:
            options.definitionId,
          definition
        }
      ];

      console.log(
        `Definition ID: ${options.definitionId}`
      );

      console.log(
        `Current offset: ${definition.offset}`
      );

      console.log(
        definition.displayName
      );
    } else if (options.failed) {
      const definitions =
        inventory
          .currentNonExactDefinitions({
            limit:
              options.limit,
            offset:
              options.offset
          });

      workItems =
        definitions.map(
          definition => ({
            definitionId:
              inventory.upsertDefinition(
                definition
              ),
            definition
          })
        );

      console.log(
        `Global inventory: ` +
        `${inventory.inventoryDefinitionCount()} known, ` +
        `${inventory.inventoryFailureCount()} non-EXACT`
      );

      console.log(
        `Selected ${workItems.length} non-EXACT definition(s).`
      );
    } else if (options.live) {
      connection =
        await openCorpusConnection(
          config
        );

      console.log(
        'Connected read-only workflow.'
      );

      const definitions =
        await discoverDefinitions(
          connection,
          options
        );

      workItems =
        definitions.map(
          definition => ({
            definitionId:
              inventory.upsertDefinition(
                definition
              ),
            definition
          })
        );

      console.log(
        `Discovered ` +
        `${workItems.length} ` +
        `definition(s).`
      );
    } else {
      const snapshotDb =
        openSnapshotDatabase();

      try {
        const ids =
          listSnapshotDefinitionIds(
            snapshotDb
          );

        const start =
          options.offset ?? 0;

        const selectedIds =
          options.limit !== undefined
            ? ids.slice(
                start,
                start + options.limit
              )
            : ids.slice(start);

        workItems =
          selectedIds.map(
            (
              definitionId,
              index
            ) => {
              const snapshot =
                getSnapshotDefinition(
                  snapshotDb,
                  definitionId
                );

              return {
                definitionId,

                definition:
                  snapshotToCorpusDefinition(
                    snapshot,
                    start + index
                  )
              };
            }
          );
      } finally {
        snapshotDb.close();
      }

      console.log(
        `Loaded ${workItems.length} definition(s) from local snapshot.`
      );
    }

    if (options.live) {
      if (!connection) {
        connection =
          await openCorpusConnection(
            config
          );

        console.log(
          'Connected read-only workflow.'
        );
      }

      dataSource =
        new LiveCorpusDataSource(
          connection
        );
    } else {
      dataSource =
        new LocalCorpusDataSource();
    }

    const run =
      inventory.beginRun(
        databaseName,
        currentGitCommit()
      );

    for (
      const item
      of workItems
    ) {
      if (!dataSource) {
        throw new Error(
          'Corpus data source is unavailable.'
        );
      }

      const capture =
        await dataSource.capture(
          item
        );

      const result =
        await validateDefinition(
          capture,
          {
            traceRefs:
              options.traceRefs ?? false,
            verbose:
              options.verbose ?? false
          }
        );

      results.push(
        result
      );

      inventory.saveResult(
        run.runId,
        result
      );

      reporter.result(
        result,
        options.verbose ??
        false
      );

      if (
        result.classification ===
        'EXACT'
      ) {
        exactCount++;
      } else {
        failureCount++;
      }
    }

    inventory.finishRun(
      run.runId,
      results.length,
      exactCount,
      failureCount
    );

    reporter.summary();

    if (
      options.compareBaseline
    ) {
      const baseline =
        loadBaseline();

      if (
        baseline === undefined
      ) {
        console.log('');
        console.log(
          'No baseline exists yet.'
        );

        return {
          results,
          exitCode: 0
        };
      }

      const delta =
        compareAgainstBaseline(
          baseline,
          results
        );

      reporter.regression(
        delta
      );

      return {
        results,
        exitCode: regressionGatePassed(
          delta
        )
          ? 0
          : 1
      };
    }

    return {
      results,
      exitCode: 0
    };
  } finally {
    if (dataSource) {
      await dataSource.close();
    } else if (connection) {
      await connection.close();
    }

    inventory.close();
  }
}
