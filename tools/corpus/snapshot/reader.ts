import type Database from 'better-sqlite3';

import {
  getLatestCompletedSnapshot,
} from './store';

import type {
  SnapshotDefinition,
  SnapshotNameRow,
} from './types';

export function getSnapshotDefinition(
  db: Database.Database,
  definitionId: number,
): SnapshotDefinition {
  const snapshot = getLatestCompletedSnapshot(db);

  if (!snapshot) {
    throw new Error(
      'No completed HCDEV corpus snapshot exists.',
    );
  }

  const row = db.prepare(`
    SELECT *
    FROM snapshot_definition
    WHERE
      snapshot_id = ?
      AND definition_id = ?
  `).get(
    snapshot.snapshotId,
    definitionId,
  ) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(
      `Definition ${definitionId} is not present in snapshot ${snapshot.snapshotId}.`,
    );
  }

  const nameRows = db.prepare(`
    SELECT
      namenum,
      recname,
      refname,
      packageroot,
      qualifypath,
      appclassmethod
    FROM snapshot_name
    WHERE
      snapshot_id = ?
      AND definition_id = ?
    ORDER BY namenum
  `).all(
    snapshot.snapshotId,
    definitionId,
  ) as SnapshotNameRow[];

  return {
    definitionId: Number(row.definition_id),

    objectid1: Number(row.objectid1),
    objectvalue1: String(row.objectvalue1),

    objectid2: Number(row.objectid2),
    objectvalue2: String(row.objectvalue2),

    objectid3: Number(row.objectid3),
    objectvalue3: String(row.objectvalue3),

    objectid4: Number(row.objectid4),
    objectvalue4: String(row.objectvalue4),

    objectid5: Number(row.objectid5),
    objectvalue5: String(row.objectvalue5),

    objectid6: Number(row.objectid6),
    objectvalue6: String(row.objectvalue6),

    objectid7: Number(row.objectid7),
    objectvalue7: String(row.objectvalue7),

    displayName: String(row.display_name),

    sourceText: String(row.source_text),
    sourceSha256: String(row.source_sha256),

    storedProgram: Buffer.from(
      row.stored_program as Buffer,
    ),

    storedProgramSha256:
      String(row.stored_program_sha256),

    names: nameRows,
  };
}

export function listSnapshotDefinitionIds(
  db: Database.Database,
): number[] {
  const snapshot = getLatestCompletedSnapshot(db);

  if (!snapshot) {
    throw new Error(
      'No completed HCDEV corpus snapshot exists.',
    );
  }

  const rows = db.prepare(`
    SELECT definition_id
    FROM snapshot_definition
    WHERE snapshot_id = ?
    ORDER BY definition_id
  `).all(snapshot.snapshotId) as Array<{
    definition_id: number;
  }>;

  return rows.map(
    row => row.definition_id,
  );
}