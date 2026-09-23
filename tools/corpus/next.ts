import {
  CorpusInventory
} from './inventory';

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

    const next =
      inventory
        .nextFailureDefinition();

    if (!next) {
      console.log(
        'No unresolved definitions.'
      );
      return;
    }

    console.log(
      'Largest failure family'
    );
    console.log(
      '----------------------'
    );

    console.log(
      `Classification: ${next.classification}`
    );

    console.log(
      `Construct:      ${next.construct ?? '(none)'}`
    );

    console.log(
      `Count:          ${next.familyCount}`
    );

    console.log('');
    console.log(
      'Representative'
    );
    console.log(
      '--------------'
    );

    console.log(
      `Offset: ${next.definition.offset}`
    );

    console.log(
      next.definition.displayName
    );

    console.log('');
    console.log(
      'Run:'
    );

    console.log(
      `npm run corpus:harness -- --offset ` +
      `${next.definition.offset} --limit 1 --verbose`
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
