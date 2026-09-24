import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import type {
  SnapshotDefinition,
  SnapshotMeta,
} from './types';

export const SNAPSHOT_DB =
  path.resolve('tools/corpus/hcdev-snapshot.sqlite');

const SNAPSHOT_SCHEMA =
  path.resolve('tools/corpus/snapshot/schema.sql');

export function openSnapshotDatabase(): Database.Database {
  const db = new Database(SNAPSHOT_DB);

  const schema = fs.readFileSync(
    SNAPSHOT_SCHEMA,
    'utf8',
  );

  db.exec(schema);

  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  return db;
}

export function createSnapshot(
  db: Database.Database,
  databaseName: string,
  peopleToolsRelease?: string,
): number {
  const stmt = db.prepare(`
    INSERT INTO snapshot_meta (
      database_name,
      peopletools_release,
      captured_at,
      completed
    )
    VALUES (?, ?, ?, 0)
  `);

  const result = stmt.run(
    databaseName,
    peopleToolsRelease ?? null,
    new Date().toISOString(),
  );

  return Number(result.lastInsertRowid);
}

export function insertDefinition(
  db: Database.Database,
  snapshotId: number,
  def: SnapshotDefinition,
): void {
  const insertDefinitionStmt = db.prepare(`
    INSERT INTO snapshot_definition (
      snapshot_id,
      definition_id,

      objectid1,
      objectvalue1,

      objectid2,
      objectvalue2,

      objectid3,
      objectvalue3,

      objectid4,
      objectvalue4,

      objectid5,
      objectvalue5,

      objectid6,
      objectvalue6,

      objectid7,
      objectvalue7,

      display_name,

      source_text,
      source_sha256,

      stored_program,
      stored_program_sha256
    )
    VALUES (
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?,
      ?, ?,
      ?, ?
    )
  `);

  const insertNameStmt = db.prepare(`
    INSERT INTO snapshot_name (
      snapshot_id,
      definition_id,
      namenum,
      recname,
      refname,
      packageroot,
      qualifypath,
      appclassmethod
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertDefinitionStmt.run(
      snapshotId,
      def.definitionId,

      def.objectid1,
      def.objectvalue1,

      def.objectid2,
      def.objectvalue2,

      def.objectid3,
      def.objectvalue3,

      def.objectid4,
      def.objectvalue4,

      def.objectid5,
      def.objectvalue5,

      def.objectid6,
      def.objectvalue6,

      def.objectid7,
      def.objectvalue7,

      def.displayName,

      def.sourceText,
      def.sourceSha256,

      def.storedProgram,
      def.storedProgramSha256,
    );

    for (const row of def.names) {
      insertNameStmt.run(
        snapshotId,
        def.definitionId,
        row.namenum,
        row.recname,
        row.refname,
        row.packageroot,
        row.qualifypath,
        row.appclassmethod,
      );
    }
  });

  tx();
}

export function completeSnapshot(
  db: Database.Database,
  snapshotId: number,
): void {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS definition_count,
      COUNT(*) AS source_count,
      COUNT(*) AS program_count
    FROM snapshot_definition
    WHERE snapshot_id = ?
  `).get(snapshotId) as {
    definition_count: number;
    source_count: number;
    program_count: number;
  };

  const names = db.prepare(`
    SELECT COUNT(*) AS name_row_count
    FROM snapshot_name
    WHERE snapshot_id = ?
  `).get(snapshotId) as {
    name_row_count: number;
  };

  db.prepare(`
    UPDATE snapshot_meta
    SET
      definition_count = ?,
      source_count = ?,
      program_count = ?,
      name_row_count = ?,
      completed = 1
    WHERE snapshot_id = ?
  `).run(
    counts.definition_count,
    counts.source_count,
    counts.program_count,
    names.name_row_count,
    snapshotId,
  );
}

export function getLatestCompletedSnapshot(
  db: Database.Database,
): SnapshotMeta | undefined {
  const row = db.prepare(`
    SELECT
      snapshot_id,
      database_name,
      peopletools_release,
      captured_at,
      definition_count,
      source_count,
      program_count,
      name_row_count,
      completed
    FROM snapshot_meta
    WHERE completed = 1
    ORDER BY snapshot_id DESC
    LIMIT 1
  `).get() as
    | {
        snapshot_id: number;
        database_name: string;
        peopletools_release: string | null;
        captured_at: string;
        definition_count: number;
        source_count: number;
        program_count: number;
        name_row_count: number;
        completed: number;
      }
    | undefined;

  if (!row) {
    return undefined;
  }

  return {
    snapshotId: row.snapshot_id,
    databaseName: row.database_name,
    peopleToolsRelease:
      row.peopletools_release ?? undefined,
    capturedAt: row.captured_at,

    definitionCount: row.definition_count,
    sourceCount: row.source_count,
    programCount: row.program_count,
    nameRowCount: row.name_row_count,

    completed: row.completed === 1,
  };
}