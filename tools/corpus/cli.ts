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

  verbose: boolean;

  baseline: boolean;
  compareBaseline: boolean;
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

  const parsed = Number(value);

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

function parseArgs(
  argv: string[]
): CliOptions {
  const options: CliOptions = {
    verbose: false,
    baseline: false,
    compareBaseline: false
  };

  for (
    let index = 0;
    index < argv.length;
    index++
  ) {
    const arg = argv[index];

    switch (arg) {
      case '--limit':
        options.limit =
          parseNumber(
            argv[++index],
            '--limit'
          );
        break;

      case '--offset':
        options.offset =
          parseNumber(
            argv[++index],
            '--offset'
          );
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

      default:
        throw new Error(
          `Unknown option: ${arg}`
        );
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options =
    parseArgs(
      process.argv.slice(2)
    );

  const run =
    await runCorpus({
      databaseName: 'HCDEV',

      limit: options.limit,
      offset: options.offset,

      verbose: options.verbose,

      compareBaseline:
        options.compareBaseline
    });

  if (options.baseline) {
    const baseline =
      createBaseline(
        'HCDEV',
        run.results
      );

    saveBaseline(baseline);

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