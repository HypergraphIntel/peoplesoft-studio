import {
  createBaseline,
  saveBaseline
} from './baseline';

import {
  runCorpus
} from './corpus-runner';

interface CliOptions {
  limit?: number;
  offset?: number;
  definitionId?: number;

  verbose: boolean;
  baseline: boolean;
  compareBaseline: boolean;
  failed: boolean;
  traceRefs: boolean;
}

function parseNumber(
  value: string | undefined,
  option: string
): number {
  if (value === undefined) {
    throw new Error(
      `${option} requires a value`
    );
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    throw new Error(
      `Invalid ${option}: ${value}`
    );
  }

  return parsed;
}

function printHelp(): void {
  console.log(`
PeopleCode corpus harness

Usage:
  tsx tools/corpus/cli.ts [options]

Options:
  --limit <n>          Maximum number of definitions to inspect.
  --offset <n>         Discovery offset, or failure-queue offset with --failed.
  --definition-id <n>  Target one stable SQLite definition by its seven-part key.
  --failed             Re-run the current global non-EXACT work queue.
  --trace-refs         Print encoder PSPCMNAME/reference provenance diagnostics.
  --verbose            Print each definition and diagnostics.
  --baseline           Write this run to the accepted baseline.
  --compare-baseline   Compare this run against the accepted baseline.
  --help, -h           Show this help.

Examples:
  npm run corpus:harness -- --limit 430
  npm run corpus:harness -- --failed
  npm run corpus:harness -- --failed --limit 25
  npm run corpus:harness -- --definition-id 1843 --verbose
  npm run corpus:harness -- --definition-id 1843 --verbose --trace-refs
`);
}

function parseArgs(
  argv: string[]
): CliOptions {
  const options: CliOptions = {
    verbose: false,
    baseline: false,
    compareBaseline: false,
    failed: false,
    traceRefs: false
  };

  for (
    let index = 0;
    index < argv.length;
    index++
  ) {
    switch (argv[index]) {
      case '--limit':
        options.limit =
          parseNumber(
            argv[++index],
            '--limit'
          );

        if (
          options.limit < 1
        ) {
          throw new Error(
            '--limit must be a positive integer'
          );
        }
        break;

      case '--offset':
        options.offset =
          parseNumber(
            argv[++index],
            '--offset'
          );
        break;

      case '--definition-id':
        options.definitionId =
          parseNumber(
            argv[++index],
            '--definition-id'
          );

        if (
          options.definitionId < 1
        ) {
          throw new Error(
            '--definition-id must be a positive integer'
          );
        }
        break;

      case '--failed':
        options.failed = true;
        break;

      case '--trace-refs':
        options.traceRefs = true;
        break;

      case '--verbose':
        options.verbose = true;
        break;

      case '--baseline':
        options.baseline = true;
        break;

      case '--compare-baseline':
        options.compareBaseline = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;

      default:
        throw new Error(
          `Unknown option: ${argv[index]}`
        );
    }
  }

  if (
    options.definitionId !== undefined &&
    options.failed
  ) {
    throw new Error(
      '--definition-id cannot be combined with --failed'
    );
  }

  if (
    options.definitionId !== undefined &&
    options.offset !== undefined
  ) {
    throw new Error(
      '--definition-id cannot be combined with --offset'
    );
  }

  if (
    options.definitionId !== undefined &&
    options.limit !== undefined
  ) {
    throw new Error(
      '--definition-id cannot be combined with --limit'
    );
  }

  return options;
}

async function main():
  Promise<void> {
  const options =
    parseArgs(
      process.argv.slice(2)
    );

  const run =
    await runCorpus({
      databaseName: 'HCDEV',
      limit:
        options.limit,
      offset:
        options.offset,
      definitionId:
        options.definitionId,
      failed:
        options.failed,
      verbose:
        options.verbose,
      traceRefs:
        options.traceRefs,
      compareBaseline:
        options.compareBaseline
    });

  if (options.baseline) {
    const baseline =
      createBaseline(
        'HCDEV',
        run.results
      );

    saveBaseline(
      baseline
    );

    console.log('');
    console.log(
      'Baseline updated: ' +
      'tools/corpus/baselines/hcdev.json'
    );
  }

  process.exitCode =
    run.exitCode;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
