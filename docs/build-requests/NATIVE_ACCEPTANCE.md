# Build Requests: installed acceptance

Status as of October 20, 2026: bounded HRDMO metadata build complete. Installed developer spec approval,
SQL Change Review application and all four artifacts' save/readback are verified.
The lab request reports BUILT with no remaining build objects. Subsequent
developer trials verify native request/attachment intake and Claude analysis
handoff, supported by persisted handoff records and MCP analysis results.
The later installed build-phase trial is now verified for both clients. The separate later
[synthetic AE/file trial](AE_FILE_WORKFLOW.md#native-syntax-correction-and-completed-csv-acceptance--october-19)
completed native Process Scheduler instance 607175 Success (report posting not verified) with the
exact expected 123-byte UTF-8/no-BOM CSV. That result belongs to request
`br-60e7196e2b0a`; it does not establish runtime execution of the earlier
`ZZ_BR_ACC` metadata trial below or representative production acceptance.

The October 20 [installed build handoff trial](BUILD_HANDOFF.md) verified actual
Codex/Claude Build-button launches, approved-spec reads, reviewed creation and
new native exact-output runs **607265 / 607266**. Both are Success / Not Posted:
HTTP 900 report transfer remains open. HRDMO DISTSTATUS 4 means Unable to Post;
this corrects the earlier claim that 607175 was Posted. Actual CSV generation
and exact content are independently verified for all three runs.

Request: `br-5a4e9d2c6ffd`, **Build Request native acceptance - read-only batch**.
Spec revision 1 was proposed through the live MCP and approved by the developer
in the installed page; final live MCP readback reports `BUILT` and
`buildAuthorized: true`.
The request and its synthetic attachment were seeded through the store API for
setup; this is not evidence of native creation/file-picker intake or a launched
agent session for that seeded request. Separate developer trials below cover
native intake and analysis handoff. The four approved artifacts have been saved; no business rows
have been written and the program has not been executed.

## Controlled request

Use HRDMO and new `ZZ_BR_` lab names only. The bounded request is a batch App
Engine that reads a constant through reusable SQL into a derived/work state
record. Requirements are synthetic, attached as text, and stay in the request's
private global-storage folder. No business data is inserted, updated or deleted.

Proposed artifact names (subject to read-only availability checks and the
developer's exact spec approval):

| Artifact | Name | Purpose |
| --- | --- | --- |
| Derived/work state record | ZZ_BR_AET | PROCESS_INSTANCE key and DESCR result |
| SQL definition | ZZ_BR_SQL | SELECT 'Build request acceptance' FROM PS_INSTALLATION |
| App Engine | ZZ_BR_ACC | MAIN/Step01 selects that SQL into DESCR |
| Project | ZZ_BR_PRJ | Definition membership and related-object closure |

Reuse delivered field definitions; do not edit them. Staged SQL must be
approved, applied and independently read back before creating an AE that
depends on it. A spec approval is not approval of a Change Review proposal.
Only the developer performs both approval steps. Runtime scheduler execution
is outside this metadata save/readback trial and must be reported separately.
Retain the lab definitions for inspection until cleanup is authorized.

## Historical 0.9.5 metadata and analysis-handoff evidence

Versions, bundle hashes and pending actions below describe this trial's
checkpoints, not the current installed runtime. The released baseline is now
0.9.6 and development is 0.9.7.

- Source baseline `15c6fd0`; its GitHub CI passed 2,009 tests and 42 MCP/editor
  checks before this acceptance work.
- Packaged and installed a 0.9.5 development VSIX. The running MCP still
  reported 0.9.3 at the activation check; a window reload was requested.
- The production page handler could race an unfinished narrative edit against
  Analyze. A deterministic delayed-edit fixture failed on the original source.
  Queuing page messages fixes it; the production HTTP MCP/editor fixture suite
  now passes 45 checks.
- Added fixture coverage for actual attachment storage/extraction, questions,
  UI answers, stale spec refusal, simulated UI approval, terminal handoff and
  approval withdrawal. Fixture approval does not certify native human review.
- Full `npm run verify`: 2,009 tests passed, one skipped, plus compile/bundle
  and activation smoke. All 45 production HTTP MCP/editor checks pass on
  Node 20 and Node 26. The production Build Request browser script also passes
  headless Chromium checks for drafts/focus, agent selection, attachment
  identity, spec approval gates, build handoff and exact Change Set links.
- The corrected candidate was repackaged and installed; its installed bundle
  matches source. VSIX SHA-256:
  `83c71bfe18c87f6b818952d95ef940b63d42811f9a7a5ff54459c5a0ee788fa8`.
  After the developer's window reload, the live MCP handshake reports 0.9.5;
  the installed bundle still matches the tested VSIX and current build.
- Read-only HRDMO preflight confirmed all four new names absent, the reused
  PROCESS_INSTANCE/DESCR field shapes and exactly one PS_INSTALLATION row.
  The installed MCP read the attachment and proposed spec revision 1 with
  four buildable artifacts and no manual artifact routes. A pre-approval
  progress report was refused; pre-approval readback was `buildAuthorized: false`.
- After the developer's page approval, MCP readback reports `APPROVED`, spec
  revision 1, `buildAuthorized: true`, no approval blocker and no open questions.
  This verifies native spec approval; it does not establish terminal handoff.
- The initial post-approval name-availability check could not connect to configured
  HRDMO (`127.0.0.1:15210/HRDMO`, NJS-503). A local socket check found no
  listener on port 15210. No creates, staged SQL or other database writes were
  attempted during that outage.
- After connection recovery, installed MCP confirmed all four lab names absent
  and read the delivered fields and INSTALLATION record. The exact revision 1
  approval remained valid. `psft_create_record` then saved `ZZ_BR_AET` through
  its ordinary writer gate. Independent `psft_get_definition` readback:
  version 278, recordType 2, description `Build request state`, PROCESS_INSTANCE
  first (Number 10, decimal positions 0, USEEDIT 8388609/key), DESCR second
  (Character 30, USEEDIT 8388608). Request progress for `state` is BUILT.
- Created request-linked Change Set `a29e0d12-9b2b-4269-8e92-8681cbaa16a2`,
  **Build Request acceptance: ZZ_BR_SQL**, with an exact SELECT-only creation
  approach. SQL staging was refused: `The implementation approach requires
  separate developer plan approval.` At that point draft revision 1 had zero
  objects and plan review PENDING. SQL progress recorded FAILED with the exact
  refusal and Change Set link, rather than incorrectly claiming STAGED.
- Native Change Review journal now records PLAN_APPROVED. An early validation
  before staging reported `Empty Change Set`; staging then succeeded in the
  same approved Change Set and fresh validation cleared that state. Revision 2
  reached READY_FOR_REVIEW with one CREATE (`sql`, key `ZZ_BR_SQL`, baseline
  token `absent`) and no validation errors. MCP save returned REVIEW_REQUIRED
  and `persisted: false`; progress correctly changed to STAGED at that point.
- Developer approved/applied the SQL in native Change Review. Revision 2 is
  APPLIED; object application VERIFIED, token `204`, after/verified snapshot
  `3953eef4f94721afa10ae1c4c178f8343395d9313266672f54e54a9aadb5e151`.
  Checkpoint captures the absent before-state. Independent MCP readback of
  SQLTYPE 0 exactly equals `SELECT 'Build request acceptance' FROM PS_INSTALLATION`.
  SQL progress changed to BUILT only after that readback.
- With SQL applied/read back and state record rechecked, the exact approved AE
  dry run passed with no errors or warnings. The ordinary create confirmation
  saved `ZZ_BR_ACC`. Independent `psft_ae_verify` returned `matches: true`, no
  differences and no validation errors/warnings. `psft_ae_get` confirms Standard,
  batch-only, restart disabled, default state `ZZ_BR_AET`, section MAIN/GBL/default,
  Step01 SQL `%Select(DESCR) %SQL(ZZ_BR_SQL)` and No Rows Abort. Token:
  `a714312429da2a1001bac4fa0b7fea96`. No program execution occurred.
- Created `ZZ_BR_PRJ` through ordinary confirmation (version 116); adding the
  three top-level definitions with related objects produced version 117. The
  dedicated project reader independently returned five members: state record,
  reusable SQL, AE program, MAIN section and the generated Step01 SQLTYPE 1
  statement. `psft_project_related` returned `missing: 0`, `addable: []`,
  `notAddable: []`. Generic `get_definition` does not expose project text, so
  project evidence comes from the dedicated membership/related readers.
- Final installed MCP request readback is BUILT: state, SQL, AE and project all
  BUILT; no remaining build objects. SQL retains its FAILED -> STAGED -> BUILT
  history and Change Set link. Retain artifacts for inspection; no cleanup,
  migration or runtime execution was performed.
- The developer subsequently created two fresh requests through the installed
  UI, attached DOCX files and launched Claude analysis. Local request records
  retain one DOCX attachment and an `analyze`/`claude` handoff each; MCP exposes
  extracted document text and revision 1 specs with clarification questions.
  This corroborates the developer's native intake/handoff report. Business
  requirements and document contents remain outside the repository.
- The developer declined the resulting lengthy clarification exercise. Stop
  those trials at analysis: do not invent answers, approve their specs or build
  their proposed production interfaces. Their unanswered business questions do
  not invalidate the successful intake/analysis-handoff acceptance. No native
  build-phase terminal handoff or runtime execution is inferred from this.

## Metadata-trial gate results and remaining acceptance

1. Complete for this trial: the installed MCP handshake reported 0.9.5 and its
   bundle matched the tested candidate at acceptance.
2. Complete for analysis: developer-reported native creation, DOCX attachment
   intake and Claude Analyze handoff corroborated by two persisted request
   handoffs, extracted text and MCP-generated specs/questions. The original
   controlled lab request remains explicitly store-seeded.
3. Complete: request/attachment read through MCP and live prerequisites/name
   availability inspected. Recheck prerequisites before each remaining create.
4. Complete: developer approved spec revision 1 in the installed page; MCP
   confirms `buildAuthorized: true`. A new revision must be reviewed again.
5. Complete for database build: SQL reviewed/applied before dependent AE;
   ordinary state/AE/project writer gates honored. Terminal handoff remains
   unverified.
6. Complete: all artifacts, SQL and project membership independently read back;
   native tokens/checkpoint and final BUILT request progress recorded above.
7. Remaining: finish this trial's installed progress/review UI inspection,
   native build-phase terminal handoff and representative production acceptance.
   Runtime success for the separate synthetic AE/file trial is
   recorded above; it does not close those gaps. This metadata trial's program
   was not executed and its lab definitions were retained, as recorded above.
