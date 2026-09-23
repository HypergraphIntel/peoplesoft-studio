import {
  CorpusInventory
} from './inventory';

interface CliOptions {
  runId?: number;
  classification?: string;
  construct?: string;
  limit?: number;

  summary: boolean;
  verbose: boolean;
}

interface FailureRow {
  run_id: number;
  definition_id: number;

  offset: number | null;
  display_name: string;

  classification: string;

  first_diff_offset: number | null;

  construct: string | null;
  error_message: string | null;

  source_chars: number;
  stored_program_bytes: number;
  generated_program_bytes: number | null;
  pscmname_rows: number;

  stored_diff_hex: string | null;
  generated_diff_hex: string | null;
}

interface SummaryRow {
  classification: string;
  construct: string | null;
  count: number;
}

function parseInteger(
  value: string | undefined,
  option: string,
  minimum = 0
): number {
  if (value === undefined) {
    throw new Error(
      `${option} requires a value`
    );
  }

  const parsed =
    Number.parseInt(value, 10);

  if (
    !Number.isInteger(parsed) ||
    parsed < minimum
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
    summary: false,
    verbose: false
  };

  for (
    let index = 0;
    index < argv.length;
    index++
  ) {
    const arg = argv[index];

    switch (arg) {
      case '--run-id':
        options.runId =
          parseInteger(
            argv[++index],
            '--run-id',
            1
          );
        break;

      case '--classification':
        options.classification =
          argv[++index];

        if (!options.classification) {
          throw new Error(
            '--classification requires a value'
          );
        }
        break;

      case '--construct':
        options.construct =
          argv[++index];

        if (!options.construct) {
          throw new Error(
            '--construct requires a value'
          );
        }
        break;

      case '--limit':
        options.limit =
          parseInteger(
            argv[++index],
            '--limit',
            1
          );
        break;

      case '--summary':
        options.summary = true;
        break;

      case '--verbose':
        options.verbose = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;

      default:
        throw new Error(
          `Unknown option: ${arg}`
        );
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
PeopleCode corpus failure inventory

Usage:
  tsx tools/corpus/failures.ts [options]

Options:
  --run-id <n>             Inspect a specific completed run.
                           Default: latest completed run.

  --classification <name>  Filter by classification.
                           Example: ENCODE_ERROR

  --construct <name>       Filter by failure construct.
                           Example: EOF

  --limit <n>              Maximum number of failure rows to display.

  --summary                 Show grouped classification/construct counts only.

  --verbose                 Include byte windows and size diagnostics.

  --help, -h                Show this help.

Examples:
  npm run corpus:failures
  npm run corpus:failures -- --summary
  npm run corpus:failures -- --classification ENCODE_ERROR
  npm run corpus:failures -- --construct EOF
  npm run corpus:failures -- --classification ENCODE_ERROR --limit 20 --verbose
`);
}

function pad(
  value: unknown,
  width: number
): string {
  const text =
    value === null ||
    value === undefined
      ? ''
      : String(value);

  return text.padEnd(width);
}

function truncate(
  value: unknown,
  width: number
): string {
  const text =
    value === null ||
    value === undefined
      ? ''
      : String(value);

  if (text.length <= width) {
    return text;
  }

  if (width <= 3) {
    return text.slice(0, width);
  }

  return (
    text.slice(0, width - 3) +
    '...'
  );
}

function resolveRunId(
  inventory: CorpusInventory,
  requestedRunId?: number
): number {
  const db =
    inventory.rawDatabase();

  if (requestedRunId !== undefined) {
    const row = db.prepare(`
      SELECT
        run_id
      FROM corpus_run
      WHERE run_id = ?
        AND completed_at IS NOT NULL
    `).get(
      requestedRunId
    ) as
      | { run_id: number }
      | undefined;

    if (!row) {
      throw new Error(
        `Completed corpus run ${requestedRunId} was not found.`
      );
    }

    return row.run_id;
  }

  const runId =
    inventory.latestCompletedRunId();

  if (runId === undefined) {
    throw new Error(
      'No completed corpus run exists yet.'
    );
  }

  return runId;
}

function loadRunMetadata(
  inventory: CorpusInventory,
  runId: number
): {
  started_at: string;
  completed_at: string;
  database_name: string;
  git_commit: string | null;
  definitions: number;
  exact_count: number;
  failure_count: number;
} {
  const db =
    inventory.rawDatabase();

  const row = db.prepare(`
    SELECT
      started_at,
      completed_at,
      database_name,
      git_commit,
      definitions,
      exact_count,
      failure_count
    FROM corpus_run
    WHERE run_id = ?
  `).get(runId) as
    | {
        started_at: string;
        completed_at: string;
        database_name: string;
        git_commit: string | null;
        definitions: number;
        exact_count: number;
        failure_count: number;
      }
    | undefined;

  if (!row) {
    throw new Error(
      `Corpus run ${runId} was not found.`
    );
  }

  return row;
}

function loadSummary(
  inventory: CorpusInventory,
  runId: number,
  options: CliOptions
): SummaryRow[] {
  const db =
    inventory.rawDatabase();

  const where: string[] = [
    'r.run_id = @runId',
    `r.classification <> 'EXACT'`
  ];

  const binds: Record<
    string,
    unknown
  > = {
    runId
  };

  if (options.classification) {
    where.push(
      'r.classification = @classification'
    );

    binds.classification =
      options.classification;
  }

  if (options.construct) {
    where.push(
      'r.construct = @construct'
    );

    binds.construct =
      options.construct;
  }

  return db.prepare(`
    SELECT
      r.classification AS classification,
      r.construct AS construct,
      COUNT(*) AS count
    FROM result r
    WHERE ${where.join('\n      AND ')}
    GROUP BY
      r.classification,
      r.construct
    ORDER BY
      count DESC,
      r.classification,
      r.construct
  `).all(binds) as SummaryRow[];
}

function loadFailures(
  inventory: CorpusInventory,
  runId: number,
  options: CliOptions
): FailureRow[] {
  const db =
    inventory.rawDatabase();

  const where: string[] = [
    'r.run_id = @runId',
    `r.classification <> 'EXACT'`
  ];

  const binds: Record<
    string,
    unknown
  > = {
    runId
  };

  if (options.classification) {
    where.push(
      'r.classification = @classification'
    );

    binds.classification =
      options.classification;
  }

  if (options.construct) {
    where.push(
      'r.construct = @construct'
    );

    binds.construct =
      options.construct;
  }

  const limitClause =
    options.limit !== undefined
      ? 'LIMIT @limit'
      : '';

  if (options.limit !== undefined) {
    binds.limit =
      options.limit;
  }

  return db.prepare(`
    SELECT
      r.run_id AS run_id,
      d.definition_id AS definition_id,

      r.offset AS offset,
      d.display_name AS display_name,

      r.classification AS classification,

      r.first_diff_offset AS first_diff_offset,

      r.construct AS construct,
      r.error_message AS error_message,

      r.source_chars AS source_chars,
      r.stored_program_bytes AS stored_program_bytes,
      r.generated_program_bytes AS generated_program_bytes,
      r.pscmname_rows AS pscmname_rows,

      r.stored_diff_hex AS stored_diff_hex,
      r.generated_diff_hex AS generated_diff_hex

    FROM result r

    JOIN definition d
      ON d.definition_id =
         r.definition_id

    WHERE ${where.join('\n      AND ')}

    ORDER BY
      r.classification,
      COALESCE(
        r.construct,
        ''
      ),
      r.offset,
      d.definition_id

    ${limitClause}
  `).all(binds) as FailureRow[];
}

function printRunHeader(
  runId: number,
  metadata: ReturnType<
    typeof loadRunMetadata
  >
): void {
  console.log(
    'PeopleCode Corpus Failure Inventory'
  );

  console.log(
    '-------------------------------'
  );

  console.log(
    `Run ID:       ${runId}`
  );

  console.log(
    `Database:     ${metadata.database_name}`
  );

  console.log(
    `Started:      ${metadata.started_at}`
  );

  console.log(
    `Completed:    ${metadata.completed_at}`
  );

  console.log(
    `Git commit:   ${metadata.git_commit ?? 'unknown'}`
  );

  console.log('');

  console.log(
    `Definitions:  ${metadata.definitions}`
  );

  console.log(
    `EXACT:        ${metadata.exact_count}`
  );

  console.log(
    `Non-EXACT:    ${metadata.failure_count}`
  );
}

function printSummary(
  rows: SummaryRow[]
): void {
  console.log('');
  console.log(
    'Failure Summary'
  );

  console.log(
    '---------------'
  );

  if (rows.length === 0) {
    console.log(
      'No non-EXACT definitions.'
    );

    return;
  }

  const classWidth =
    Math.max(
      'Classification'.length,
      ...rows.map(
        row =>
          row.classification.length
      )
    );

  const constructWidth =
    Math.max(
      'Construct'.length,
      ...rows.map(
        row =>
          (
            row.construct ??
            '(none)'
          ).length
      )
    );

  console.log(
    `${pad('Classification', classWidth)}  ` +
    `${pad('Construct', constructWidth)}  ` +
    'Count'
  );

  console.log(
    `${'-'.repeat(classWidth)}  ` +
    `${'-'.repeat(constructWidth)}  ` +
    '-----'
  );

  for (const row of rows) {
    console.log(
      `${pad(row.classification, classWidth)}  ` +
      `${pad(row.construct ?? '(none)', constructWidth)}  ` +
      `${row.count}`
    );
  }
}

function printFailureRows(
  rows: FailureRow[],
  verbose: boolean
): void {
  console.log('');
  console.log(
    'Failures'
  );

  console.log(
    '--------'
  );

  if (rows.length === 0) {
    console.log(
      'No matching non-EXACT definitions.'
    );

    return;
  }

  for (
    let index = 0;
    index < rows.length;
    index++
  ) {
    const row =
      rows[index];

    console.log(
      `[${index + 1}/${rows.length}] ` +
      `offset=${row.offset ?? '?'} ` +
      `${row.classification}`
    );

    console.log(
      `  ${row.display_name}`
    );

    if (row.construct) {
      console.log(
        `  construct: ${row.construct}`
      );
    }

    if (
      row.first_diff_offset !==
      null
    ) {
      console.log(
        `  diff:      ${row.first_diff_offset}`
      );
    }

    if (row.error_message) {
      console.log(
        `  error:     ${row.error_message}`
      );
    }

    if (verbose) {
      console.log(
        `  source:    ${row.source_chars} chars`
      );

      console.log(
        `  program:   stored=${row.stored_program_bytes}` +
        (
          row.generated_program_bytes !==
          null
            ? ` generated=${row.generated_program_bytes}`
            : ''
        )
      );

      console.log(
        `  names:     ${row.pscmname_rows}`
      );

      if (row.stored_diff_hex) {
        console.log(
          `  stored:    ${row.stored_diff_hex}`
        );
      }

      if (row.generated_diff_hex) {
        console.log(
          `  generated: ${row.generated_diff_hex}`
        );
      }
    }

    console.log('');
  }
}

function printTopConstructs(
  rows: SummaryRow[]
): void {
  if (rows.length === 0) {
    return;
  }

  const aggregate =
    new Map<string, number>();

  for (const row of rows) {
    const construct =
      row.construct ??
      '(none)';

    aggregate.set(
      construct,
      (
        aggregate.get(
          construct
        ) ?? 0
      ) + row.count
    );
  }

  const ranked =
    [...aggregate.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1] ||
          a[0].localeCompare(b[0])
      );

  console.log('');
  console.log(
    'Top Failure Constructs'
  );

  console.log(
    '----------------------'
  );

  for (
    const [construct, count]
    of ranked.slice(0, 20)
  ) {
    console.log(
      `${pad(
        truncate(construct, 30),
        30
      )} ${count}`
    );
  }
}

function main(): void {
  const options =
    parseArgs(
      process.argv.slice(2)
    );

  const inventory =
    new CorpusInventory();

  try {
    const runId =
      resolveRunId(
        inventory,
        options.runId
      );

    const metadata =
      loadRunMetadata(
        inventory,
        runId
      );

    const summary =
      loadSummary(
        inventory,
        runId,
        options
      );

    printRunHeader(
      runId,
      metadata
    );

    printSummary(summary);
    printTopConstructs(summary);

    if (!options.summary) {
      const failures =
        loadFailures(
          inventory,
          runId,
          options
        );

      printFailureRows(
        failures,
        options.verbose
      );
    }
  } finally {
    inventory.close();
  }
}

try {
  main();
} catch (error) {
  console.error('');

  console.error(
    'Failure inventory failed.'
  );

  console.error(
    error instanceof Error
      ? error.stack ??
        error.message
      : error
  );

  process.exitCode = 1;
}
