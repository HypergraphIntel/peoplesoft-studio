import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  CorpusDefinition,
  CorpusDefinitionKey,
  CorpusResult
} from './classifications';

export interface CorpusRunInfo {
  runId: number;
  startedAt: string;
  databaseName: string;
  gitCommit?: string;
}

export interface PreviousResult {
  definitionId: number;
  classification: string;
  sourceSha256?: string;
  storedSha256?: string;
}

export class CorpusInventory {
  private readonly db: Database.Database;

  public constructor(
    databasePath = path.resolve(
      process.cwd(),
      'tools/corpus/corpus-results.sqlite'
    )
  ) {
    this.db = new Database(databasePath);

    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    const schemaPath = path.resolve(
      process.cwd(),
      'tools/corpus/schema.sql'
    );

    const schema = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schema);
  }

  public close(): void {
    this.db.close();
  }

  public beginRun(
    databaseName: string,
    gitCommit?: string
  ): CorpusRunInfo {
    const startedAt = new Date().toISOString();

    const statement = this.db.prepare(`
      INSERT INTO corpus_run (
        started_at,
        database_name,
        git_commit
      )
      VALUES (
        @startedAt,
        @databaseName,
        @gitCommit
      )
    `);

    const result = statement.run({
      startedAt,
      databaseName,
      gitCommit: gitCommit ?? null
    });

    return {
      runId: Number(result.lastInsertRowid),
      startedAt,
      databaseName,
      gitCommit
    };
  }

  public finishRun(
    runId: number,
    definitions: number,
    exactCount: number,
    failureCount: number
  ): void {
    this.db.prepare(`
      UPDATE corpus_run
         SET completed_at = @completedAt,
             definitions = @definitions,
             exact_count = @exactCount,
             failure_count = @failureCount
       WHERE run_id = @runId
    `).run({
      runId,
      completedAt: new Date().toISOString(),
      definitions,
      exactCount,
      failureCount
    });
  }

  private findDefinitionId(
    key: CorpusDefinitionKey
  ): number | undefined {
    const row = this.db.prepare(`
      SELECT definition_id
        FROM definition
       WHERE objectid1 = @objectId1
         AND objectvalue1 = @objectValue1
         AND objectid2 = @objectId2
         AND objectvalue2 = @objectValue2
         AND objectid3 = @objectId3
         AND objectvalue3 = @objectValue3
         AND objectid4 = @objectId4
         AND objectvalue4 = @objectValue4
         AND objectid5 = @objectId5
         AND objectvalue5 = @objectValue5
         AND objectid6 = @objectId6
         AND objectvalue6 = @objectValue6
         AND objectid7 = @objectId7
         AND objectvalue7 = @objectValue7
    `).get(key) as
      | { definition_id: number }
      | undefined;

    return row?.definition_id;
  }

  public upsertDefinition(
    definition: CorpusDefinition
  ): number {
    const existing =
      this.findDefinitionId(definition.key);

    if (existing !== undefined) {
      this.db.prepare(`
        UPDATE definition
           SET display_name = @displayName
         WHERE definition_id = @definitionId
      `).run({
        displayName: definition.displayName,
        definitionId: existing
      });

      return existing;
    }

    const key = definition.key;

    const result = this.db.prepare(`
      INSERT INTO definition (
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
        display_name
      )
      VALUES (
        @objectId1,
        @objectValue1,
        @objectId2,
        @objectValue2,
        @objectId3,
        @objectValue3,
        @objectId4,
        @objectValue4,
        @objectId5,
        @objectValue5,
        @objectId6,
        @objectValue6,
        @objectId7,
        @objectValue7,
        @displayName
      )
    `).run({
      ...key,
      displayName: definition.displayName
    });

    return Number(result.lastInsertRowid);
  }

  public saveResult(
    runId: number,
    result: CorpusResult
  ): void {
    const definitionId =
      this.upsertDefinition(result.definition);

    this.db.prepare(`
      INSERT OR REPLACE INTO result (
        run_id,
        definition_id,
        offset,

        source_chars,
        source_sha256,

        stored_program_bytes,
        generated_program_bytes,

        pscmname_rows,

        decode_success,
        source_match,

        source_encode_success,
        source_encode_exact,

        roundtrip_success,
        roundtrip_exact,

        classification,

        first_diff_offset,

        construct,
        error_message,

        stored_sha256,
        generated_sha256,

        stored_diff_hex,
        generated_diff_hex
      )
      VALUES (
        @runId,
        @definitionId,
        @offset,

        @sourceChars,
        @sourceSha256,

        @storedProgramBytes,
        @generatedProgramBytes,

        @pscmnameRows,

        @decodeSuccess,
        @sourceMatch,

        @sourceEncodeSuccess,
        @sourceEncodeExact,

        @roundtripSuccess,
        @roundtripExact,

        @classification,

        @firstDiffOffset,

        @construct,
        @errorMessage,

        @storedSha256,
        @generatedSha256,

        @storedDiffHex,
        @generatedDiffHex
      )
    `).run({
      runId,
      definitionId,

      offset: result.definition.offset,

      sourceChars: result.sourceChars,
      sourceSha256: result.sourceSha256 ?? null,

      storedProgramBytes:
        result.storedProgramBytes,

      generatedProgramBytes:
        result.generatedProgramBytes ?? null,

      pscmnameRows:
        result.pscmnameRows,

      decodeSuccess:
        result.decodeSuccess ? 1 : 0,

      sourceMatch:
        result.sourceMatch ? 1 : 0,

      sourceEncodeSuccess:
        result.sourceEncodeSuccess ? 1 : 0,

      sourceEncodeExact:
        result.sourceEncodeExact ? 1 : 0,

      roundtripSuccess:
        result.roundtripSuccess ? 1 : 0,

      roundtripExact:
        result.roundtripExact ? 1 : 0,

      classification:
        result.classification,

      firstDiffOffset:
        result.firstDiffOffset ?? null,

      construct:
        result.construct ?? null,

      errorMessage:
        result.errorMessage ?? null,

      storedSha256:
        result.storedSha256 ?? null,

      generatedSha256:
        result.generatedSha256 ?? null,

      storedDiffHex:
        result.storedDiffHex ?? null,

      generatedDiffHex:
        result.generatedDiffHex ?? null
    });
  }

  public latestCompletedRunId():
    number | undefined {
    const row = this.db.prepare(`
      SELECT run_id
        FROM corpus_run
       WHERE completed_at IS NOT NULL
       ORDER BY run_id DESC
       LIMIT 1
    `).get() as
      | { run_id: number }
      | undefined;

    return row?.run_id;
  }

  public nonExactDefinitionIds(
    runId?: number
  ): number[] {
    const resolvedRun =
      runId ?? this.latestCompletedRunId();

    if (resolvedRun === undefined) {
      return [];
    }

    const rows = this.db.prepare(`
      SELECT definition_id
        FROM result
       WHERE run_id = ?
         AND classification <> 'EXACT'
       ORDER BY offset
    `).all(resolvedRun) as Array<{
      definition_id: number;
    }>;

    return rows.map(
      row => row.definition_id
    );
  }

  public resultsForRun(
    runId: number
  ): Array<{
    definitionId: number;
    displayName: string;
    offset: number;
    classification: string;
    sourceSha256?: string;
    storedSha256?: string;
  }> {
    return this.db.prepare(`
      SELECT
        d.definition_id AS definitionId,
        d.display_name AS displayName,
        r.offset AS offset,
        r.classification AS classification,
        r.source_sha256 AS sourceSha256,
        r.stored_sha256 AS storedSha256
      FROM result r
      JOIN definition d
        ON d.definition_id = r.definition_id
      WHERE r.run_id = ?
      ORDER BY r.offset
    `).all(runId) as Array<{
      definitionId: number;
      displayName: string;
      offset: number;
      classification: string;
      sourceSha256?: string;
      storedSha256?: string;
    }>;
  }

  public rawDatabase(): Database.Database {
    return this.db;
  }
}