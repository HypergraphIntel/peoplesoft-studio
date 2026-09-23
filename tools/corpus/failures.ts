import {
  CorpusInventory
} from './inventory';

interface CliOptions {
  classification?: string;
  construct?: string;
  limit?: number;

  summary: boolean;
  verbose: boolean;
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
    Number.parseInt(
      value,
      10
    );

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

function printHelp(): void {
  console.log(`
PeopleCode current failure inventory

This command uses the newest completed result for every known
PeopleCode definition, so chunked inventory runs are merged.

Usage:
  tsx tools/corpus/failures.ts [options]

Options:
  --classification <name>  Filter by classification.
  --construct <name>       Filter by failure construct.
  --limit <n>              Maximum failure rows to display.
  --summary                Show family counts only.
  --verbose                Include stored/generated binary diagnostics.
  --help, -h               Show this help.

Examples:
  npm run corpus:failures
  npm run corpus:failures -- --summary
  npm run corpus:failures -- --classification ENCODE_ERROR
  npm run corpus:failures -- --construct EOF
  npm run corpus:failures -- --limit 25 --verbose
`);
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
    switch (argv[index]) {
      case '--classification':
        options.classification =
          argv[++index];

        if (
          !options.classification
        ) {
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
          `Unknown option: ${argv[index]}`
        );
    }
  }

  return options;
}

function printSummary(
  inventory: CorpusInventory,
  options: CliOptions
): void {
  const families =
    inventory
      .currentFailureFamilies()
      .filter(
        family =>
          (
            !options.classification ||
            family.classification ===
              options.classification
          ) &&
          (
            !options.construct ||
            (family.construct ?? '') ===
              options.construct
          )
      );

  console.log('');
  console.log(
    'Failure Summary'
  );
  console.log(
    '---------------'
  );

  if (
    families.length === 0
  ) {
    console.log(
      'No non-EXACT definitions.'
    );
    return;
  }

  for (
    const family of families
  ) {
    console.log(
      `${family.classification.padEnd(30)} ` +
      `${String(
        family.construct ??
        '(none)'
      ).padEnd(24)} ` +
      `${family.count}`
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
    const total =
      inventory
        .inventoryDefinitionCount();

    const exact =
      inventory
        .inventoryExactCount();

    const failed =
      inventory
        .inventoryFailureCount();

    console.log(
      'PeopleCode Current Inventory'
    );
    console.log(
      '----------------------------'
    );
    console.log(
      `Definitions known: ${total}`
    );
    console.log(
      `EXACT:             ${exact}`
    );
    console.log(
      `Non-EXACT:         ${failed}`
    );

    printSummary(
      inventory,
      options
    );

    if (options.summary) {
      return;
    }

    const definitions =
      inventory
        .currentNonExactDefinitions({
          limit:
            options.limit,
          classification:
            options.classification,
          construct:
            options.construct
        });

    console.log('');
    console.log(
      'Failures'
    );
    console.log(
      '--------'
    );

    if (
      definitions.length === 0
    ) {
      console.log(
        'No matching non-EXACT definitions.'
      );
      return;
    }

    const db =
      inventory.rawDatabase();

    for (
      let index = 0;
      index < definitions.length;
      index++
    ) {
      const definition =
        definitions[index];

      const key =
        definition.key;

      const row =
        db.prepare(`
          WITH latest_result AS (
            SELECT
              r.definition_id,
              MAX(r.run_id) AS run_id
            FROM result r
            JOIN corpus_run cr
              ON cr.run_id = r.run_id
             AND cr.completed_at IS NOT NULL
            GROUP BY r.definition_id
          )

          SELECT
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

          FROM definition d

          JOIN latest_result lr
            ON lr.definition_id =
               d.definition_id

          JOIN result r
            ON r.definition_id =
               lr.definition_id
           AND r.run_id =
               lr.run_id

          WHERE
            d.objectid1 = @objectId1
            AND d.objectvalue1 = @objectValue1
            AND d.objectid2 = @objectId2
            AND d.objectvalue2 = @objectValue2
            AND d.objectid3 = @objectId3
            AND d.objectvalue3 = @objectValue3
            AND d.objectid4 = @objectId4
            AND d.objectvalue4 = @objectValue4
            AND d.objectid5 = @objectId5
            AND d.objectvalue5 = @objectValue5
            AND d.objectid6 = @objectId6
            AND d.objectvalue6 = @objectValue6
            AND d.objectid7 = @objectId7
            AND d.objectvalue7 = @objectValue7
        `).get(key) as
          | {
              classification: string;
              first_diff_offset:
                number | null;
              construct:
                string | null;
              error_message:
                string | null;
              source_chars: number;
              stored_program_bytes:
                number;
              generated_program_bytes:
                number | null;
              pscmname_rows: number;
              stored_diff_hex:
                string | null;
              generated_diff_hex:
                string | null;
            }
          | undefined;

      if (!row) {
        continue;
      }

      console.log(
        `[${index + 1}/${definitions.length}] ` +
        `offset=${definition.offset} ` +
        `${row.classification}`
      );

      console.log(
        `  ${definition.displayName}`
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

      if (options.verbose) {
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

        if (
          row.generated_diff_hex
        ) {
          console.log(
            `  generated: ${row.generated_diff_hex}`
          );
        }
      }

      console.log('');
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
