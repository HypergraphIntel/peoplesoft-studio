import type oracledb from 'oracledb';

import {
  captureDefinition,
  discoverDefinitions,
  getConnectionConfig,
  openCorpusConnection
} from '../discovery';

import {
  CorpusInventory
} from '../inventory';

import {
  completeSnapshot,
  createSnapshot,
  insertDefinition,
  openSnapshotDatabase
} from './store';

import {
  sha256
} from './hash';

async function main(): Promise<void> {
  console.log('');
  console.log('HCDEV Corpus Snapshot');
  console.log('---------------------');

  const config =
    getConnectionConfig();

  const databaseName =
    config.connectString;

  const snapshotDb =
    openSnapshotDatabase();

  const inventory =
    new CorpusInventory();

  let connection:
    oracledb.Connection | undefined;

  let snapshotId:
    number | undefined;

  try {
    snapshotId =
      createSnapshot(
        snapshotDb,
        databaseName
      );

    console.log(
      `Snapshot ID: ${snapshotId}`
    );

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
        {}
      );

    console.log(
      `Discovered ` +
      `${definitions.length} ` +
      `definition(s).`
    );

    let completed = 0;
    let nameRows = 0;

    for (
      const definition
      of definitions
    ) {
      const definitionId =
        inventory.upsertDefinition(
          definition
        );

      const captured =
        await captureDefinition(
          connection,
          definition
        );

      const names =
        captured.names.map(
          row => ({
            namenum:
              row.NAMENUM,

            recname:
              row.RECNAME ?? '',

            refname:
              row.REFNAME ?? '',

            packageroot:
              row.PACKAGEROOT ?? '',

            qualifypath:
              row.QUALIFYPATH ?? '',

            appclassmethod:
              row.APPCLASSMETHOD ?? ''
          })
        );

      const key =
        definition.key;

      insertDefinition(
        snapshotDb,
        snapshotId,
        {
          definitionId,

          objectid1:
            key.objectId1,

          objectvalue1:
            key.objectValue1,

          objectid2:
            key.objectId2,

          objectvalue2:
            key.objectValue2,

          objectid3:
            key.objectId3,

          objectvalue3:
            key.objectValue3,

          objectid4:
            key.objectId4,

          objectvalue4:
            key.objectValue4,

          objectid5:
            key.objectId5,

          objectvalue5:
            key.objectValue5,

          objectid6:
            key.objectId6,

          objectvalue6:
            key.objectValue6,

          objectid7:
            key.objectId7,

          objectvalue7:
            key.objectValue7,

          displayName:
            definition.displayName,

          sourceText:
            captured.source,

          sourceSha256:
            sha256(
              captured.source
            ),

          storedProgram:
            captured.program,

          storedProgramSha256:
            sha256(
              captured.program
            ),

          names
        }
      );

      completed++;
      nameRows += names.length;

      if (
        completed % 25 === 0 ||
        completed ===
          definitions.length
      ) {
        console.log(
          `[${completed}/${definitions.length}] ` +
          `captured; ` +
          `PSPCMNAME rows=${nameRows}`
        );
      }
    }

    completeSnapshot(
      snapshotDb,
      snapshotId
    );

    console.log('');
    console.log(
      `Snapshot ${snapshotId} COMPLETE`
    );

    console.log(
      `Definitions: ${definitions.length}`
    );

    console.log(
      `PSPCMNAME rows: ${nameRows}`
    );
  } finally {
    if (connection) {
      await connection.close();
    }

    snapshotDb.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});