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

export interface FailureFamilyRow {
  classification: string;
  construct: string | null;
  count: number;
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

    const schema =
      fs.readFileSync(
        schemaPath,
        'utf8'
      );

    this.db.exec(schema);
  }

  public close(): void {
    this.db.close();
  }

  public beginRun(
    databaseName: string,
    gitCommit?: string
  ): CorpusRunInfo {
    const startedAt =
      new Date().toISOString();

    const statement =
      this.db.prepare(`
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

    const result =
      statement.run({
        startedAt,
        databaseName,
        gitCommit:
          gitCommit ?? null
      });

    return {
      runId:
        Number(
          result.lastInsertRowid
        ),
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
      completedAt:
        new Date().toISOString(),
      definitions,
      exactCount,
      failureCount
    });
  }

  private findDefinitionId(
    key: CorpusDefinitionKey
  ): number | undefined {
    const row =
      this.db.prepare(`
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
        | {
            definition_id: number;
          }
        | undefined;

    return row?.definition_id;
  }

  public upsertDefinition(
    definition: CorpusDefinition
  ): number {
    const existing =
      this.findDefinitionId(
        definition.key
      );

    if (existing !== undefined) {
      this.db.prepare(`
        UPDATE definition
           SET display_name = @displayName
         WHERE definition_id = @definitionId
      `).run({
        displayName:
          definition.displayName,
        definitionId:
          existing
      });

      return existing;
    }

    const key =
      definition.key;

    const result =
      this.db.prepare(`
        INSERT INTO definition (
          objectid1, objectvalue1,
          objectid2, objectvalue2,
          objectid3, objectvalue3,
          objectid4, objectvalue4,
          objectid5, objectvalue5,
          objectid6, objectvalue6,
          objectid7, objectvalue7,
          display_name
        )
        VALUES (
          @objectId1, @objectValue1,
          @objectId2, @objectValue2,
          @objectId3, @objectValue3,
          @objectId4, @objectValue4,
          @objectId5, @objectValue5,
          @objectId6, @objectValue6,
          @objectId7, @objectValue7,
          @displayName
        )
      `).run({
        ...key,
        displayName:
          definition.displayName
      });

    return Number(
      result.lastInsertRowid
    );
  }

  public saveResult(
    runId: number,
    result: CorpusResult
  ): void {
    const definitionId =
      this.upsertDefinition(
        result.definition
      );

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
      offset:
        result.definition.offset,
      sourceChars:
        result.sourceChars,
      sourceSha256:
        result.sourceSha256 ?? null,
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
    const row =
      this.db.prepare(`
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

  /**
   * Return the latest completed result for every definition.
   *
   * IMPORTANT:
   * This is the master inventory query. It deliberately merges chunked,
   * targeted, and failed-only runs by choosing the newest completed result
   * for each definition independently.
   */
  private latestResultCte(): string {
    return `
      WITH latest_result AS (
        SELECT
          r.definition_id,
          MAX(r.run_id) AS run_id
        FROM result r
        JOIN corpus_run cr
          ON cr.run_id = r.run_id
         AND cr.completed_at IS NOT NULL
        GROUP BY
          r.definition_id
      )
    `;
  }

  public inventoryDefinitionCount(): number {
    const row =
      this.db.prepare(`
        ${this.latestResultCte()}
        SELECT COUNT(*) AS count
        FROM latest_result
      `).get() as { count: number };

    return row.count;
  }

  public inventoryExactCount(): number {
    const row =
      this.db.prepare(`
        ${this.latestResultCte()}
        SELECT COUNT(*) AS count
        FROM latest_result lr
        JOIN result r
          ON r.definition_id = lr.definition_id
         AND r.run_id = lr.run_id
        WHERE r.classification = 'EXACT'
      `).get() as { count: number };

    return row.count;
  }

  public inventoryFailureCount(): number {
    const row =
      this.db.prepare(`
        ${this.latestResultCte()}
        SELECT COUNT(*) AS count
        FROM latest_result lr
        JOIN result r
          ON r.definition_id = lr.definition_id
         AND r.run_id = lr.run_id
        WHERE r.classification <> 'EXACT'
      `).get() as { count: number };

    return row.count;
  }

  /**
   * Return the global current non-EXACT work queue.
   *
   * limit/offset apply to the work queue, not Oracle discovery.
   */
  public currentNonExactDefinitions(
    options: {
      limit?: number;
      offset?: number;
      classification?: string;
      construct?: string;
    } = {}
  ): CorpusDefinition[] {
    const where: string[] = [
      `r.classification <> 'EXACT'`
    ];

    const binds: Record<
      string,
      unknown
    > = {};

    if (options.classification) {
      where.push(
        `r.classification = @classification`
      );
      binds.classification =
        options.classification;
    }

    if (options.construct) {
      where.push(
        `COALESCE(r.construct, '') = @construct`
      );
      binds.construct =
        options.construct;
    }

    const limitClause =
      options.limit !== undefined
        ? 'LIMIT @limit'
        : options.offset !== undefined &&
            options.offset > 0
          ? 'LIMIT -1'
          : '';

    const offsetClause =
      options.offset !== undefined &&
      options.offset > 0
        ? 'OFFSET @offset'
        : '';

    if (
      options.limit !== undefined
    ) {
      binds.limit =
        options.limit;
    }

    if (
      options.offset !== undefined &&
      options.offset > 0
    ) {
      binds.offset =
        options.offset;
    }

    const rows =
      this.db.prepare(`
        ${this.latestResultCte()}

        SELECT
          r.offset AS offset,
          d.display_name AS display_name,

          d.objectid1 AS objectid1,
          d.objectvalue1 AS objectvalue1,
          d.objectid2 AS objectid2,
          d.objectvalue2 AS objectvalue2,
          d.objectid3 AS objectid3,
          d.objectvalue3 AS objectvalue3,
          d.objectid4 AS objectid4,
          d.objectvalue4 AS objectvalue4,
          d.objectid5 AS objectid5,
          d.objectvalue5 AS objectvalue5,
          d.objectid6 AS objectid6,
          d.objectvalue6 AS objectvalue6,
          d.objectid7 AS objectid7,
          d.objectvalue7 AS objectvalue7

        FROM latest_result lr

        JOIN result r
          ON r.definition_id = lr.definition_id
         AND r.run_id = lr.run_id

        JOIN definition d
          ON d.definition_id = r.definition_id

        WHERE ${where.join('\n          AND ')}

        ORDER BY
          r.classification,
          COALESCE(r.construct, ''),
          r.offset,
          d.definition_id

        ${limitClause}
        ${offsetClause}
      `).all(
        binds
      ) as Array<{
        offset: number;
        display_name: string;
        objectid1: number;
        objectvalue1: string;
        objectid2: number;
        objectvalue2: string;
        objectid3: number;
        objectvalue3: string;
        objectid4: number;
        objectvalue4: string;
        objectid5: number;
        objectvalue5: string;
        objectid6: number;
        objectvalue6: string;
        objectid7: number;
        objectvalue7: string;
      }>;

    return rows.map(
      row => ({
        offset: row.offset,
        displayName:
          row.display_name,
        key: {
          objectId1:
            row.objectid1,
          objectValue1:
            row.objectvalue1,
          objectId2:
            row.objectid2,
          objectValue2:
            row.objectvalue2,
          objectId3:
            row.objectid3,
          objectValue3:
            row.objectvalue3,
          objectId4:
            row.objectid4,
          objectValue4:
            row.objectvalue4,
          objectId5:
            row.objectid5,
          objectValue5:
            row.objectvalue5,
          objectId6:
            row.objectid6,
          objectValue6:
            row.objectvalue6,
          objectId7:
            row.objectid7,
          objectValue7:
            row.objectvalue7
        }
      })
    );
  }

  public currentFailureFamilies():
    FailureFamilyRow[] {
    return this.db.prepare(`
      ${this.latestResultCte()}

      SELECT
        r.classification AS classification,
        r.construct AS construct,
        COUNT(*) AS count

      FROM latest_result lr

      JOIN result r
        ON r.definition_id = lr.definition_id
       AND r.run_id = lr.run_id

      WHERE r.classification <> 'EXACT'

      GROUP BY
        r.classification,
        r.construct

      ORDER BY
        count DESC,
        r.classification,
        r.construct
    `).all() as FailureFamilyRow[];
  }

  /**
   * One representative definition from the largest unresolved family.
   */
  public nextFailureDefinition():
    {
      definition: CorpusDefinition;
      classification: string;
      construct: string | null;
      familyCount: number;
    } | undefined {
    const row =
      this.db.prepare(`
        ${this.latestResultCte()},

        family AS (
          SELECT
            r.classification,
            r.construct,
            COUNT(*) AS count

          FROM latest_result lr

          JOIN result r
            ON r.definition_id = lr.definition_id
           AND r.run_id = lr.run_id

          WHERE r.classification <> 'EXACT'

          GROUP BY
            r.classification,
            r.construct

          ORDER BY
            count DESC,
            r.classification,
            r.construct

          LIMIT 1
        )

        SELECT
          r.offset AS offset,
          d.display_name AS display_name,

          r.classification AS classification,
          r.construct AS construct,
          family.count AS family_count,

          d.objectid1 AS objectid1,
          d.objectvalue1 AS objectvalue1,
          d.objectid2 AS objectid2,
          d.objectvalue2 AS objectvalue2,
          d.objectid3 AS objectid3,
          d.objectvalue3 AS objectvalue3,
          d.objectid4 AS objectid4,
          d.objectvalue4 AS objectvalue4,
          d.objectid5 AS objectid5,
          d.objectvalue5 AS objectvalue5,
          d.objectid6 AS objectid6,
          d.objectvalue6 AS objectvalue6,
          d.objectid7 AS objectid7,
          d.objectvalue7 AS objectvalue7

        FROM latest_result lr

        JOIN result r
          ON r.definition_id = lr.definition_id
         AND r.run_id = lr.run_id

        JOIN definition d
          ON d.definition_id = r.definition_id

        CROSS JOIN family

        WHERE
          r.classification =
            family.classification
          AND (
            r.construct =
              family.construct
            OR (
              r.construct IS NULL
              AND family.construct IS NULL
            )
          )

        ORDER BY
          r.offset,
          d.definition_id

        LIMIT 1
      `).get() as
        | {
            offset: number;
            display_name: string;
            classification: string;
            construct: string | null;
            family_count: number;
            objectid1: number;
            objectvalue1: string;
            objectid2: number;
            objectvalue2: string;
            objectid3: number;
            objectvalue3: string;
            objectid4: number;
            objectvalue4: string;
            objectid5: number;
            objectvalue5: string;
            objectid6: number;
            objectvalue6: string;
            objectid7: number;
            objectvalue7: string;
          }
        | undefined;

    if (!row) {
      return undefined;
    }

    return {
      classification:
        row.classification,
      construct:
        row.construct,
      familyCount:
        row.family_count,

      definition: {
        offset:
          row.offset,
        displayName:
          row.display_name,

        key: {
          objectId1:
            row.objectid1,
          objectValue1:
            row.objectvalue1,
          objectId2:
            row.objectid2,
          objectValue2:
            row.objectvalue2,
          objectId3:
            row.objectid3,
          objectValue3:
            row.objectvalue3,
          objectId4:
            row.objectid4,
          objectValue4:
            row.objectvalue4,
          objectId5:
            row.objectid5,
          objectValue5:
            row.objectvalue5,
          objectId6:
            row.objectid6,
          objectValue6:
            row.objectvalue6,
          objectId7:
            row.objectid7,
          objectValue7:
            row.objectvalue7
        }
      }
    };
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
        ON d.definition_id =
           r.definition_id
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

  public rawDatabase():
    Database.Database {
    return this.db;
  }
}
