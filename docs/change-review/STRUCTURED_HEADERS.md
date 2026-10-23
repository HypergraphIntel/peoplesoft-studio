# Record and Application Engine header adapters — development

These first Oracle adapters support existing-definition description/comments
edits. They do not claim full Record or AE review coverage. Normal
`psft_edit_record` accepts only `set_properties` with description/definition;
`psft_ae_edit` accepts only `set_program` with description/comments on this
staged path. Other edit operations are refused; create/copy/rename/delete
tools retain their existing legacy gates. Plan approval, ownership, writable,
operator, name scope, dirty editor, revision approval and native guards apply.

## Checkpoints and preservation

Record scope `record-header/1` covers PSRECDEFN, PSRECFIELD, PSRECFIELDDB,
PSINDEXDEFN, PSKEYDEFN and PSRECTBLSPC. Only SQL Table and Derived/Work Records
are eligible. The existing writer's unsupported shapes remain refused, including
includers and unsupported referrers. Related Language referrers are explicitly
refused because their version side effects lack a combined checkpoint here.
Field removal, record type changes, view SQL, DDL and application data are outside
this adapter. A retained manual structural change cannot use header reversal.

AE scope `ae-header/1` covers twenty tables: PSAEAPPLDEFN, PSAEAPPLSTATE,
PSAEAPPLTEMPTBL, PSAEAPPLLANG, PSAESECTDEFN, PSAESECTDTLDEFN, PSAESTEPDEFN,
PSAESTMTDEFN, PSAESTEPMSGDEFN, PSSQLDEFN, PSSQLDESCR, PSSQLTEXTDEFN, PSSQLHASH,
PSPCMPROG, PSPCMTXT, PSPCMNAME, PSAEAPPLDEL, PSAESECTDEL, PSSQLDEL and
PSPCMPROGDEL. SQL, source/binary PeopleCode, language rows, unknown columns
and tombstones are preservation evidence, never opaque restore instructions.
No program, section, step, action, SQL or code structure mutation is staged yet.
The existing model/reference/PeopleCode validations still run; a header change
does not bypass an existing definition error.

Catalog-driven reads retain every column. Character LOBs are read in full,
binary values use lossless hex, and dates/timestamps use native nine-digit
text. Unsupported native values, timezone columns, missing columns/tables,
unsafe integers, secret-like data and snapshots above 8 MiB fail explicitly.
Canonical row sorting ignores relational storage order. Content excludes
VERSION/LASTUPDDTTM/LASTUPDOPRID; the token binds **all raw rows including those
stamps**. These are local metadata scopes, not universal dependency closure.

Reads use a consistent read-only transaction. Preparation runs the real existing
writer/verification and captures native images before rollback. Only the header
columns may differ; normalization outside the bounded projection blocks staging.
Validation repeats exact full-image equivalence. Application checks the full
token again under the writer's native lock, uses an exact reviewed-write proof,
and independently verifies the complete committed snapshot. A checkpoint inverse
must pass the same typed-header projection; no raw row replay is available.

Record `dryRun` is an actual rollback preview for existing definitions; new
Record preview is refused. AE's existing public `dryRun` remains plan-only.
The internal snapshot-capture preview executes/verifies DML then rolls back.
Preview failures after DML roll back as well. Normal commit paths retain their
existing native save protocols and counters. Manual saves may record the scoped
observations; recording failure does not block a developer's save.

## Evidence

Transaction tests execute the actual writers over a fixture: rollback/counters,
full before/after capture, normal commit, typed checkpoint inverse, preservation
of unknown columns, after-image failure and unversioned drift checks. Snapshot
tests cover native binary/timestamp fidelity and rejected values. Production
HTTP/UI fixtures exercise stage/review/apply/inverse/timeline, structural refusal
without empty proposals and stale-token refusal for both families.

Installed 0.9.1 native header acceptance also passed on HRDMO: the developer
applied `e419a3b0-1438-41c6-bf4d-af9a90552178` and separately approved/applied
checkpoint inverse `8c52441a-d3b0-48f6-83d3-9712713c46b1`. Record `ZZ_RPT_LINE`
and AE `ZZ_AE_LAB01` description-only edits matched their full six-/twenty-table
after snapshots. The inverse restored each complete original semantic scope
under fresh native tokens. Independent checks verified exact revision approvals,
checkpoints, inverse hashes, reverse dependency order and live timeline matches.
Evidence: `tools/lab/results/structured-review-native-validation.json`.
This certifies those existing header changes, not structural edits, actual AE
execution or native Record/AE Designer reopen. Reference-side effects outside
the supported scopes and broader structured operations remain pending.
Staged dependency overlays and general Record/AE structural reversal remain
separate work.


## Record field structure (V15-1)

Development state as of October 22, 2026: implemented, transaction tested,
production HTTP/UI fixture verified and HRDMO rollback-preview verified;
installed developer-approved apply/inverse/redo passed October 23, 2026
(ZZ_RPT_LINE in Change Set e4f34fc9).

`psft_edit_record` stages, besides description/comments, the record grid's
field structure on existing SQL Table and Derived/Work records:
`insert_field`, `insert_subrecord`, `remove_field`, `move_field`, `set_use`
(except In Memory), `set_edits`, `set_default` and `set_label`. `set_type`,
other Record Properties and In Memory keep the legacy per-write confirmation.

- **Proposal:** the editor's operations run through the shared writer in
  rollback with the six-table checkpoints; the after-image is the proposal,
  including native derivations (PSRECFIELDDB expansion, key and alternate
  search key indexes, counts).
- **Typed reconstruction** (`recordStructureRequest`): the after-image's fields
  in FIELDNUM order with their editable settings; a field absent from the
  baseline is restored from its own reviewed PSRECFIELD row (stamps excluded)
  instead of App Designer's new-row values, so undoing a removal returns the
  field's own non-default columns. Removals are omissions. A restored row is
  accepted only by a snapshot-guarded (reviewed) save.
- **Refusals:** a reviewed removal of a field still used by its Record Field
  PeopleCode, page controls, queries or other records' defaults
  (`removedFieldReferences`): those are outside the checkpoint and could not be
  restored with it. Related Language referrers remain refused.
- **Physical scope:** metadata only. DDL is never run; building the table is a
  separate, explicitly confirmed operation. Undoing a removal restores the
  definition, not column data a later build dropped.

Evidence: `reviewStructuredHeaders.test.ts` (insert, exact replay, removal of
a field with a non-default column, exact inverse restoring it, inverse of the
insert, unreviewed restore refused); the HTTP/UI fixture (insert
stage/apply/inverse/redo through the rendered review); HRDMO rollback previews
(`tools/lab/record-structure-native-preview.mts`,
`tools/lab/results/record-structure-native-preview.json`): ZZ_RPT_LINE
insert/move/removal and ZZ_FL_REC_A insert/removal/list-box change each
reproduced exactly by the rebuilt edit; removals refused for ZZ_PCODE_LAB_R2
(Record Field PeopleCode) and ZZ_PCODE_LAB_R7 (page controls); all tokens
unchanged. In one rolled-back native transaction
(`tools/lab/structural-cycle-native.mts`), ZZ_RPT_LINE insert DESCR first +
remove ZZ_RPT_COUNT, the rebuilt inverse (ZZ_RPT_COUNT from its own row) equals
the checkpoint exactly and redo equals the after-image; nothing persisted.


## App Engine structure (V15-1)

Development state as of October 22, 2026: implemented, unit tested, production
HTTP/UI fixture verified and HRDMO native verified (rollback previews and one
rolled-back apply/inverse/redo transaction); installed developer-approved
apply/inverse/redo passed October 23, 2026 (ZZ_AE_LAB01 in Change Set e4f34fc9).

Every `psft_ae_edit` operation now stages: program properties, state records,
temporary tables, sections, steps and actions with their SQL and PeopleCode.
Program creation, copy, rename and deletion keep their own tools.

- **Proposal:** the operations applied to the live document, validated
  (`deepValidate`) and executed by the shared writer in rollback with the
  twenty-table checkpoints; the after-image is the proposal. Staging also
  requires that the document rebuilt from that after-image reproduces it.
- **Typed reconstruction** (`aeDocumentFromSnapshot`): the checkpoint read as
  the program reader reads it (`documentFromRows`), with PeopleCode source from
  PSPCMTXT. The writer compiles and saves it like any edit; preview must
  reproduce the proposal exactly.
- **Inverse target** (`inverseTarget`, new service hook): undoing an added
  section, step, SQL or PeopleCode deletes it, and App Designer records each
  deleted key (PSAESECTDEL, PSSQLDEL, PSPCMPROGDEL). The inverse's after-image
  is the native preview of the checkpoint document, accepted only when every
  other table equals the checkpoint and the only additions are deletion records
  new to this transition (`aeTombstoneProjection`); App Designer's first-save
  ASOF_DT NULL → 1900-01-01 [ap01] is the one other allowed difference. The
  proposal carries `projectedFrom` and a warning naming the projection. Redo
  re-creates the keys, and their tombstones go as App Designer removes them.

Evidence: `reviewAeStructure.test.ts` (rebuilt document equals the reader's;
projection accepts only the transition's own deletion records and the ASOF_DT
normalization); HTTP/UI fixture (step edit stage/apply/inverse through the
rendered review); `tools/lab/ae-structure-native.mts`
(`tools/lab/results/ae-structure-native.json`): all 20 saveable ZZ_ App Engine
programs on HRDMO save their rebuilt document exactly as their own (the other
eight fail the writer's existing program validation and cannot be saved at
all); on ZZ_AE_LAB01 in one rolled-back transaction, adding a SQL step and a
PeopleCode step and renaming a step, then the inverse, reaches the checkpoint
plus one PSSQLDEL and one PSPCMPROGDEL record, and redo reaches the reviewed
after-image exactly. Nothing persisted.
