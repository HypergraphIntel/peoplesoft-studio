import {
  CorpusInventory,
  FailureFamilyRow
} from './inventory';

interface RankedFamily
  extends FailureFamilyRow {
  classificationWeight: number;
  constructWeight: number;
  score: number;
}

interface RepresentativeRow {
  definition_id: number;
  offset: number;
  display_name: string;
}

function classificationWeight(
  classification: string
): number {
  switch (
    classification.toUpperCase()
  ) {
    case 'UNSUPPORTED_SYNTAX':
      return 1.00;

    case 'ENCODE_ERROR':
      return 0.95;

    case 'SOURCE_REFERENCE_MISMATCH':
      return 0.90;

    case 'ROUNDTRIP_REFERENCE_MISMATCH':
      return 0.85;

    case 'SOURCE_BODY_MISMATCH':
      return 0.85;

    case 'ROUNDTRIP_BODY_MISMATCH':
      return 0.80;

    case 'DECODE_ERROR':
      return 0.80;

    case 'DECODE_SOURCE_MISMATCH':
      return 0.75;

    case 'ROUNDTRIP_ERROR':
      return 0.75;

    case 'UNKNOWN_MISMATCH':
      return 0.50;

    default:
      return 0.60;
  }
}

/**
 * A concrete construct is more actionable than an unclassified bucket.
 *
 * UNKNOWN / (none) is intentionally heavily discounted because it can
 * contain many unrelated root causes despite having a large raw count.
 */
function constructWeight(
  classification: string,
  construct: string | null
): number {
  const normalized =
    construct?.trim() ?? '';

  if (
    normalized.length === 0
  ) {
    return (
      classification.toUpperCase() ===
      'UNKNOWN_MISMATCH'
        ? 0.20
        : 0.55
    );
  }

  if (
    normalized.toUpperCase() ===
    'UNKNOWN'
  ) {
    return 0.45;
  }

  return 1.00;
}

function rankFamily(
  family: FailureFamilyRow
): RankedFamily {
  const classWeight =
    classificationWeight(
      family.classification
    );

  const specificWeight =
    constructWeight(
      family.classification,
      family.construct
    );

  return {
    ...family,

    classificationWeight:
      classWeight,

    constructWeight:
      specificWeight,

    score:
      family.count *
      classWeight *
      specificWeight
  };
}

function compareFamilies(
  a: RankedFamily,
  b: RankedFamily
): number {
  return (
    b.score - a.score ||
    b.count - a.count ||
    a.classification.localeCompare(
      b.classification
    ) ||
    (
      a.construct ?? ''
    ).localeCompare(
      b.construct ?? ''
    )
  );
}

function loadRepresentative(
  inventory: CorpusInventory,
  family: RankedFamily
): RepresentativeRow | undefined {
  const db =
    inventory.rawDatabase();

  /*
   * Use the merged current-inventory semantics:
   * newest result from a completed run for each definition.
   */
  const row =
    db.prepare(`
      WITH latest_result AS (
        SELECT
          r.definition_id,
          MAX(r.run_id) AS run_id

        FROM result r

        JOIN corpus_run cr
          ON cr.run_id =
             r.run_id
         AND cr.completed_at
             IS NOT NULL

        GROUP BY
          r.definition_id
      )

      SELECT
        d.definition_id AS definition_id,
        r.offset AS offset,
        d.display_name AS display_name

      FROM latest_result lr

      JOIN result r
        ON r.definition_id =
           lr.definition_id
       AND r.run_id =
           lr.run_id

      JOIN definition d
        ON d.definition_id =
           r.definition_id

      WHERE
        r.classification =
          @classification

        AND (
          (
            @constructIsNull = 1
            AND r.construct IS NULL
          )
          OR
          (
            @constructIsNull = 0
            AND r.construct =
                @construct
          )
        )

      ORDER BY
        r.offset,
        d.definition_id

      LIMIT 1
    `).get({
      classification:
        family.classification,

      construct:
        family.construct,

      constructIsNull:
        family.construct === null
          ? 1
          : 0
    }) as
      | RepresentativeRow
      | undefined;

  return row;
}

function printFamily(
  title: string,
  family: RankedFamily
): void {
  console.log(title);
  console.log(
    '-'.repeat(title.length)
  );

  console.log(
    `Classification: ${family.classification}`
  );

  console.log(
    `Construct:      ${
      family.construct ??
      '(none)'
    }`
  );

  console.log(
    `Count:          ${family.count}`
  );

  console.log(
    `Priority score: ${family.score.toFixed(2)}`
  );

  console.log(
    `Weights:        classification=${family.classificationWeight.toFixed(2)} ` +
    `construct=${family.constructWeight.toFixed(2)}`
  );
}

function main(): void {
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
      'PeopleCode Next Corpus Target'
    );

    console.log(
      '-----------------------------'
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

    console.log('');

    const families =
      inventory
        .currentFailureFamilies();

    if (
      families.length === 0
    ) {
      console.log(
        'No unresolved definitions.'
      );

      return;
    }

    const ranked =
      families
        .map(rankFamily)
        .sort(compareFamilies);

    /*
     * Raw-largest family is still useful diagnostic context even when it
     * is not the family we should work first.
     */
    const largestRaw =
      [...ranked]
        .sort(
          (a, b) =>
            b.count - a.count ||
            a.classification.localeCompare(
              b.classification
            )
        )[0];

    const highestPriority =
      ranked[0];

    printFamily(
      'Largest raw failure family',
      largestRaw
    );

    console.log('');

    printFamily(
      'Highest-priority actionable family',
      highestPriority
    );

    const representative =
      loadRepresentative(
        inventory,
        highestPriority
      );

    if (!representative) {
      throw new Error(
        'Unable to select a representative definition for the highest-priority family.'
      );
    }

    console.log('');
    console.log(
      'Representative'
    );

    console.log(
      '--------------'
    );

    console.log(
      `Definition ID: ${representative.definition_id}`
    );

    console.log(
      `Current Offset: ${representative.offset}`
    );

    console.log(
      representative.display_name
    );

    console.log('');
    console.log(
      'Run:'
    );

    console.log(
      `npm run corpus:harness -- --definition-id ` +
      `${representative.definition_id} --verbose`
    );

    console.log('');
    console.log(
      'Reference trace:'
    );

    console.log(
      `npm run corpus:harness -- --definition-id ` +
      `${representative.definition_id} --verbose --trace-refs`
    );

    console.log('');
    console.log(
      'Priority model'
    );

    console.log(
      '--------------'
    );

    console.log(
      'score = count × classification weight × construct specificity'
    );

    console.log(
      'Concrete, repeatable constructs are favored over broad catch-all buckets.'
    );
  } finally {
    inventory.close();
  }
}

try {
  main();
} catch (error) {
  console.error('');

  console.error(
    'Unable to select next corpus target.'
  );

  console.error(
    error instanceof Error
      ? error.stack ??
        error.message
      : error
  );

  process.exitCode = 1;
}
