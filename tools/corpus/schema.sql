PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS corpus_run (
    run_id              INTEGER PRIMARY KEY AUTOINCREMENT,

    started_at          TEXT NOT NULL,
    completed_at        TEXT,

    database_name       TEXT NOT NULL,
    git_commit          TEXT,

    definitions         INTEGER NOT NULL DEFAULT 0,
    exact_count         INTEGER NOT NULL DEFAULT 0,
    failure_count       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS definition (
    definition_id       INTEGER PRIMARY KEY AUTOINCREMENT,

    objectid1           INTEGER NOT NULL,
    objectvalue1        TEXT NOT NULL,

    objectid2           INTEGER NOT NULL,
    objectvalue2        TEXT NOT NULL,

    objectid3           INTEGER NOT NULL,
    objectvalue3        TEXT NOT NULL,

    objectid4           INTEGER NOT NULL,
    objectvalue4        TEXT NOT NULL,

    objectid5           INTEGER NOT NULL,
    objectvalue5        TEXT NOT NULL,

    objectid6           INTEGER NOT NULL,
    objectvalue6        TEXT NOT NULL,

    objectid7           INTEGER NOT NULL,
    objectvalue7        TEXT NOT NULL,

    display_name        TEXT NOT NULL,

    UNIQUE (
        objectid1, objectvalue1,
        objectid2, objectvalue2,
        objectid3, objectvalue3,
        objectid4, objectvalue4,
        objectid5, objectvalue5,
        objectid6, objectvalue6,
        objectid7, objectvalue7
    )
);

CREATE TABLE IF NOT EXISTS result (
    run_id                   INTEGER NOT NULL,
    definition_id            INTEGER NOT NULL,

    offset                    INTEGER,

    source_chars              INTEGER NOT NULL DEFAULT 0,
    source_sha256             TEXT,

    stored_program_bytes      INTEGER NOT NULL DEFAULT 0,
    generated_program_bytes   INTEGER,

    pscmname_rows             INTEGER NOT NULL DEFAULT 0,

    decode_success            INTEGER NOT NULL DEFAULT 0,
    source_match              INTEGER NOT NULL DEFAULT 0,

    source_encode_success     INTEGER NOT NULL DEFAULT 0,
    source_encode_exact       INTEGER NOT NULL DEFAULT 0,

    roundtrip_success         INTEGER NOT NULL DEFAULT 0,
    roundtrip_exact           INTEGER NOT NULL DEFAULT 0,

    classification            TEXT NOT NULL,

    first_diff_offset         INTEGER,

    construct                 TEXT,
    error_message             TEXT,

    stored_sha256             TEXT,
    generated_sha256          TEXT,

    stored_diff_hex           TEXT,
    generated_diff_hex        TEXT,

    PRIMARY KEY (
        run_id,
        definition_id
    ),

    FOREIGN KEY (run_id)
        REFERENCES corpus_run(run_id)
        ON DELETE CASCADE,

    FOREIGN KEY (definition_id)
        REFERENCES definition(definition_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_result_classification
    ON result(classification);

CREATE INDEX IF NOT EXISTS idx_result_exact
    ON result(
        source_encode_exact,
        roundtrip_exact
    );

CREATE INDEX IF NOT EXISTS idx_result_definition
    ON result(definition_id);

CREATE INDEX IF NOT EXISTS idx_result_run
    ON result(run_id);

CREATE INDEX IF NOT EXISTS idx_result_construct
    ON result(construct);