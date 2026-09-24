import {
  openSnapshotDatabase,
  getLatestCompletedSnapshot,
} from './store';

import {
  listSnapshotDefinitionIds,
} from './reader';

async function main(): Promise<void> {
  const db = openSnapshotDatabase();

  const snapshot =
    getLatestCompletedSnapshot(db);

  if (!snapshot) {
    throw new Error(
      'No completed snapshot exists.',
    );
  }

  const ids =
    listSnapshotDefinitionIds(db);

  console.log('');
  console.log('HCDEV Snapshot Verification');
  console.log('---------------------------');
  console.log(
    `Snapshot ID:       ${snapshot.snapshotId}`,
  );
  console.log(
    `Database:          ${snapshot.databaseName}`,
  );
  console.log(
    `Captured:          ${snapshot.capturedAt}`,
  );
  console.log(
    `Definitions meta:  ${snapshot.definitionCount}`,
  );
  console.log(
    `Definitions rows:  ${ids.length}`,
  );
  console.log(
    `Source rows:       ${snapshot.sourceCount}`,
  );
  console.log(
    `Program rows:      ${snapshot.programCount}`,
  );
  console.log(
    `PSPCMNAME rows:    ${snapshot.nameRowCount}`,
  );

  if (
    ids.length !==
    snapshot.definitionCount
  ) {
    throw new Error(
      'Snapshot definition count mismatch.',
    );
  }

  if (
    snapshot.definitionCount !==
    snapshot.sourceCount
  ) {
    throw new Error(
      'Snapshot source count mismatch.',
    );
  }

  if (
    snapshot.definitionCount !==
    snapshot.programCount
  ) {
    throw new Error(
      'Snapshot PSPCMPROG count mismatch.',
    );
  }

  console.log('');
  console.log('Snapshot integrity: OK');

  db.close();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});