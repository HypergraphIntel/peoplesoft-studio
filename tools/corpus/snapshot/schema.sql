PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS snapshot_meta (
    snapshot_id             INTEGER PRIMARY KEY AUTOINCREMENT,

    database_name           TEXT NOT NULL,
    peopletools_release     TEXT,
    captured_at             TEXT NOT NULL,

    definition_count        INTEGER NOT NULL DEFAULT 0,
    source_count            INTEGER NOT NULL DEFAULT 0,
    program_count           INTEGER NOT NULL DEFAULT 0,
    name_row_count          INTEGER NOT NULL DEFAULT 0,

    completed               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS snapshot_definition (
    snapshot_id             INTEGER NOT NULL,
    definition_id           INTEGER NOT NULL,

    objectid1               INTEGER NOT NULL,
    objectvalue1            TEXT NOT NULL,

    objectid2               INTEGER NOT NULL,
    objectvalue2            TEXT NOT NULL,

    objectid3               INTEGER NOT NULL,
    objectvalue3            TEXT NOT NULL,

    objectid4               INTEGER NOT NULL,
    objectvalue4            TEXT NOT NULL,

    objectid5               INTEGER NOT NULL,
    objectvalue5            TEXT NOT NULL,

    objectid6               INTEGER NOT NULL,
    objectvalue6            TEXT NOT NULL,

    objectid7               INTEGER NOT NULL,
    objectvalue7            TEXT NOT NULL,

    display_name            TEXT NOT NULL,

    source_text             TEXT NOT NULL,
    source_sha256           TEXT NOT NULL,

    stored_program          BLOB NOT NULL,
    stored_program_sha256   TEXT NOT NULL,

    PRIMARY KEY (
        snapshot_id,
        definition_id
    ),

    FOREIGN KEY (snapshot_id)
        REFERENCES snapshot_meta(snapshot_id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_name (
    snapshot_id             INTEGER NOT NULL,
    definition_id           INTEGER NOT NULL,
    namenum                 INTEGER NOT NULL,

    recname                 TEXT NOT NULL,
    refname                 TEXT NOT NULL,
    packageroot             TEXT NOT NULL,
    qualifypath             TEXT NOT NULL,
    appclassmethod          TEXT NOT NULL,

    PRIMARY KEY (
        snapshot_id,
        definition_id,
        namenum
    ),

    FOREIGN KEY (
        snapshot_id,
        definition_id
    )
        REFERENCES snapshot_definition(
            snapshot_id,
            definition_id
        )
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_definition_id
    ON snapshot_definition(definition_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_source_sha
    ON snapshot_definition(source_sha256);

CREATE INDEX IF NOT EXISTS idx_snapshot_program_sha
    ON snapshot_definition(stored_program_sha256);

CREATE INDEX IF NOT EXISTS idx_snapshot_name_definition
    ON snapshot_name(snapshot_id, definition_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_completed
    ON snapshot_meta(completed, captured_at);
/*
 * Cycle 167: Application Classes captured as type metadata only -- the
 * compiled program and reference list of classes HCDEV holds no PeopleCode
 * source for (PSPCMTXT), so the corpus has no definition of them. Never
 * encoded, compared or counted; the metadata provider decodes their class
 * headers. Written only by tools/corpus/capture-appclass-metadata.ts.
 */
CREATE TABLE IF NOT EXISTS snapshot_appclass_metadata (
    snapshot_id             INTEGER NOT NULL,
    class_path              TEXT NOT NULL,

    objectid1               INTEGER NOT NULL,
    objectvalue1            TEXT NOT NULL,
    objectid2               INTEGER NOT NULL,
    objectvalue2            TEXT NOT NULL,
    objectid3               INTEGER NOT NULL,
    objectvalue3            TEXT NOT NULL,
    objectid4               INTEGER NOT NULL,
    objectvalue4            TEXT NOT NULL,
    objectid5               INTEGER NOT NULL,
    objectvalue5            TEXT NOT NULL,
    objectid6               INTEGER NOT NULL,
    objectvalue6            TEXT NOT NULL,
    objectid7               INTEGER NOT NULL,
    objectvalue7            TEXT NOT NULL,

    stored_program          BLOB NOT NULL,
    stored_program_sha256   TEXT NOT NULL,

    PRIMARY KEY (
        snapshot_id,
        class_path
    ),

    FOREIGN KEY (snapshot_id)
        REFERENCES snapshot_meta(snapshot_id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_appclass_metadata_name (
    snapshot_id             INTEGER NOT NULL,
    class_path              TEXT NOT NULL,
    namenum                 INTEGER NOT NULL,

    recname                 TEXT NOT NULL,
    refname                 TEXT NOT NULL,
    packageroot             TEXT NOT NULL,
    qualifypath             TEXT NOT NULL,
    appclassmethod          TEXT NOT NULL,

    PRIMARY KEY (
        snapshot_id,
        class_path,
        namenum
    ),

    FOREIGN KEY (
        snapshot_id,
        class_path
    )
        REFERENCES snapshot_appclass_metadata(
            snapshot_id,
            class_path
        )
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_appclass_metadata_capture (
    snapshot_id             INTEGER PRIMARY KEY,
    captured_at             TEXT NOT NULL,
    imported_at             TEXT NOT NULL,
    source                  TEXT NOT NULL,
    class_count             INTEGER NOT NULL,
    name_row_count          INTEGER NOT NULL,
    content_sha256          TEXT NOT NULL,

    FOREIGN KEY (snapshot_id)
        REFERENCES snapshot_meta(snapshot_id)
        ON DELETE CASCADE
);
