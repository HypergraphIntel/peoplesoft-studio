import childProcess from 'node:child_process';

import {
  CorpusDefinition,
  CorpusResult
} from './classifications';

import {
  compareAgainstBaseline,
  loadBaseline,
  regressionGatePassed
} from './baseline';

import {
  captureDefinition,
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

export interface CorpusRunOptions
  extends DiscoveryOptions {
  databaseName?: string;

  verbose?: boolean;
  compareBaseline?: boolean;
  failed?: boolean;
  traceRefs?: boolean;

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

    let definitions:
      CorpusDefinition[];

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

      definitions = [
        definition
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
      definitions =
        inventory
          .currentNonExactDefinitions({
            limit:
              options.limit,
            offset:
              options.offset
          });

      console.log(
        `Global inventory: ` +
        `${inventory.inventoryDefinitionCount()} known, ` +
        `${inventory.inventoryFailureCount()} non-EXACT`
      );

      console.log(
        `Selected ${definitions.length} non-EXACT definition(s).`
      );
    } else {
      connection =
        await openCorpusConnection(
          config
        );

      console.log(
        'Connected read-only workflow.'
      );

      definitions =
        await discoverDefinitions(
          connection,
          options
        );

      console.log(
        `Discovered ` +
        `${definitions.length} ` +
        `definition(s).`
      );
    }

    const run =
      inventory.beginRun(
        databaseName,
        currentGitCommit()
      );

    if (
      (
        options.failed ||
        options.definitionId !== undefined
      ) &&
      definitions.length > 0
    ) {
      connection =
        await openCorpusConnection(
          config
        );

      console.log(
        'Connected read-only workflow.'
      );
    }

    for (
      const definition
      of definitions
    ) {
      if (!connection) {
        throw new Error(
          'Oracle connection is unavailable.'
        );
      }

      const capture =
        await captureDefinition(
          connection,
          definition
        );

      const result =
        await validateDefinition(
          capture,
          {
            traceRefs:
              options.traceRefs ?? false
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
        exitCode:
          regressionGatePassed(
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
    if (connection) {
      await connection.close();
    }

    inventory.close();
  }
}
