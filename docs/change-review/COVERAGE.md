# Change Review capability and risk matrix

Coverage as of October 21: 0.9.7 released. Each row distinguishes implemented scope, native acceptance
and remaining work. Historical 0.9.1 release evidence remains in
[release readiness](../RELEASE_0_9_1.md). Registration inventory is in
[INVENTORY.md](INVENTORY.md); contracts are in [CONTRACTS.md](CONTRACTS.md).

| Family/path | Current review integration | Snapshot/reversal scope | Verification and missing evidence |
|---|---|---|---|
| Plain SQL | Staged create/update/delete and manual history; complete Oracle 8.62 adapter plus retained legacy histories | New complete text/description/comments/owner checkpoints with full native fingerprints and tombstones; typed creation inverse/redo. Legacy text-only creation histories remain nonreversible | Native Windows delete/recreate calibration, actual HRDMO writer and ReviewService recovery/redo trials with exact metadata and cleanup. See TEXT_DELETION.md |
| HTML / freeform style sheets | Staged create/update/delete and manual history; complete Oracle 8.62 adapters plus retained legacy histories | Complete portable text/description, full native chunk/header fingerprints, calibrated single/paired tombstones; creation inverse/redo. Nonportable or legacy partial scopes retain their limits | Native Windows delete/recreate calibration and HRDMO create/delete/redo, dependency-aware HTML-before-CSS inverse, lost reply and fresh remaining approval. Existing installed update/inverse evidence retained; current installed creation recovery recorded in TEXT_DELETION.md |
| Event PeopleCode (8/9/42/43/44/46/47/48) | Staged create/update/delete; manual history | Authoritative PSPCMTXT source and native fingerprint; existing compiler/writer; reviewed inverse/redo | Compiler and HTTP/UI fixture exercise. One installed developer-approved HRDMO UPDATE (AE Export OnExecute, type 43, `af6dd54e…`) APPLIED/VERIFIED with native validation. Record PeopleCode ZZ_PCODE_LAB_R2.ZZ_PCODE_LAB_MCP1.FieldChange (type 8) UPDATE (`683f4196…`) APPLIED/VERIFIED with the decoded PSPCMPROG showing the new literal, and its typed inverse (`41bf31c5…`) restored the original source and program. Page (44), Component (46) and Component Record Field (48) PeopleCode completed a full native apply (`dafc4ed2…`), typed inverse (`be13efe5…`) and redo (`576f5403…`) cycle with PSPCMTXT and decoded PSPCMPROG readback at each step and a continuous MATCHES_PREVIOUS timeline. Other event types (42/47, menu/CI) unverified; no decompiled baseline |
| Existing Application Class source (58) | Staged update; manual source history | Existing authoritative source only | Class/package creation/deletion metadata snapshots are missing; new class staging cannot validate and class deletion is refused |
| PS Query | Staged create/edit/copy; manual history | Existing native query rows minus writer stamps; full native token and access checks; update reversal | HTTP/UI fixtures and one installed developer-approved description update with independent snapshot/token/checkpoint verification. Native description-update inverse and redo also independently verified. Structural edit on ZZ_QRY_LAB02 (select ESTABID as column 2, text heading on DESCR; `b7bc09bc…`) installed developer-approved APPLIED/VERIFIED with readback and generated SQL `SELECT A.DESCR,A.ESTABID ...`, and its typed inverse (`6c504db6…`) restored the original rows and SQL (REVERTED). Criteria/order edit on ZZ_QRY_LAB02 (prompt criterion replaced by constant `A.ESTABID = 'ZZLAB'`, ORDER BY DESCR; `ac56e70a…`) APPLIED/VERIFIED and its typed inverse (`13d7ef06…`) restored the prompt criterion, `:2` expression and use counts (REVERTED). Native reviewed Query creation is now verified in the separate same-database migration trial (PROJECT_MIGRATION.md); current installed staged create/copy remains separate. CREATE inverse still needs a calibrated delete adapter |
| Process Definitions | Staged existing-definition updates; manual history | Complete editor input and native token; sorted association sets | Core/model tests. Output-mode normalization changes currently refused; reference validation still runs in writer. Installed HRDMO exact-baseline reconciliation and freshly approved continuation UPDATE (`b4266a59…`) APPLIED/VERIFIED with independent full-input/token readback; combined continuation reversal now implemented; separate native Record/AE continuation inverse/redo trial passes |
| Pages | Bounded staged existing-control geometry/label/use and description/comments on Oracle; manual history; shared-writer rollback preview | Full scoped native rows/CLOBs, positive persisted IDs, exact rollback-preview equivalence and locked content/version token guard. Typed inverse only when exactly reproducible | Real writer/provider HTTP/UI fixture verified. One native developer-reviewed description apply/inverse verified with full snapshot/token/checkpoint and live timeline checks. Visual overlays are implemented and browser/fixture verified. Corrected Static Text geometry/label and Edit Box use flags passed native apply/inverse plus developer Windows Designer inspection; Native Page redo verified (description: apply `2709920a…`, inverse `3da9bfad…`, redo `2c568d3c…`; the timeline marks the earlier unrecorded external edit as GAP); creation/deletion, inserted/deleted controls, binding/order/other properties and invalid-save override are not staged. See PAGE_ADAPTER.md |
| Records / fields / translates | Record description/comments staged on Oracle; new Derived/Work creation also staged; field/translate, SQL Table creation and deletion remain legacy | Six-table native preservation checkpoint, shared-writer rollback validation and locked full token; existing SQL Table/Derived Work only; Related Language referrers refused | One native Record header description apply/checkpoint inverse passed complete scoped snapshot/token/approval checks. New Derived/Work creation (ZZ_RF_AET, `c1d1298e…`) installed developer-approved APPLIED/VERIFIED; reviewed deletion/recreation now verified in a separate disposable Record/AE service trial. No reviewed field removal, code side effects, type/DDL/data or general structural reversal. See STRUCTURED_HEADERS.md |
| AE | Existing-program description/comments staged on Oracle; new program creation also staged; other existing edits/copy/rename/delete remain legacy | Twenty-table preservation checkpoint including language/SQL/source/binary/tombstones; exact shared-writer rollback equivalence, locked full token and typed header inverse | One native AE header description apply/checkpoint inverse passed complete scoped snapshot/token/approval checks. Existing structural/action edits, copy and rename recovery remain open. Calibrated creation deletion/recreation and continuation inverse/redo have native and installed HRDMO acceptance. New creation has declared proposed dependency validation and combined HTTP/UI fixture evidence; installed developer-approved HRDMO creation (ZZ_RF_EXPORT in four-object Change Set `c1d1298e…`) is APPLIED/VERIFIED with independent readback. See STRUCTURED_HEADERS.md |
| Menus / CI / channels | Legacy | Existing writer/session models reusable, not yet review adapters | Need complete snapshots and inverse/dependency evidence for create/edit/copy/rename/delete |
| IB services / operations | Existing headers/bounded structure; 8.62.09 standard service/operation CREATE/DELETE with separate lifecycle adapters | Existing fixed noncredential scope; complete lifecycle snapshots include native markers, parent service and empty-only ancillary tables. Exact rollback preview, reference/policy/parent scopes, typed inverse/redo and pre/postcommit readback | Existing installed HRDMO header/standard structure and provider handler-addition trials remain recorded in IB_STRUCTURE.md. Added handler deletion/recreation has two exact native replays and a five-check private-review native trial. Definition lifecycle has five exact native capture replays and a seven-check private-review native creation/deletion/inverse/redo trial; original checkpoints restored. All 69 HTTP/UI fixture checks pass, including four 8.61/8.62 REST URI role combinations and lifecycle destructive consent/parent authorization. Installed developer-approved lifecycle DELETE/CREATE, historical handler inverse/redo, 8.61 version-description structure and 8.62 REST-consumer version-description apply/inverse now pass with exact restored checkpoints/live timelines. One postcommit pool-close outcome was reconciled without retrying the writer. HCDEV temporary fixtures removed; reports in tools/lab/results/ib-*-2026-10-21.json. REST lifecycle, credentials, broader ancillary shapes and automatic dependency closure are outside scope. |
| Other IB / Portal / administration / OAuth | Legacy | Secret-filtered readers/writers exist; not generalized into exact review snapshots | Need per-kind normalization, side-effect/checkpoint scope, ownership/configuration authorization and inverse evidence |
| Event Mapping / PFC / Drop Zones | Legacy | Existing configuration models and previews reusable | Need derived mapping/service side-effect snapshots, zero/new configuration states and dependency-aware reversal coverage |
| Project create and membership | New Oracle project and bounded explicit members staged; existing project edits remain legacy | Fixed noncredential snapshot, same-transaction native create/membership rollback preview and exact after-image guard | Combined creation HTTP/UI fixture passes; installed developer-approved HRDMO creation (ZZ_RF_PRJ, `c1d1298e…`) APPLIED/VERIFIED with five members and zero missing dependencies. No credential freshness, automatic closure or creation undo. See STRUCTURED_CREATION.md |
| Migration import / physical build | Supported assets and target project membership stage into durable review | Complete portable payloads, native baseline tokens and explicit dependencies; independent writer transactions | Native text/Record-PC/Query/Menu trials and installed Import/Menu approval/readback pass. Missing asset families and package-wide undo remain open; DDL/data are separate. See PROJECT_MIGRATION.md |
| SQL Server / DB2 | Legacy paths retained | Reviewed environment identity not calibrated | Need live identity/read/snapshot/write verification per platform; no claim of reviewed apply support |

## Local blockers and exact missing evidence

These affect object adapters, not the generic service. Do not infer inverse
writes or replay opaque rows to get around them.

1. **Creation reversal for Query/projects and legacy partial text histories:**
   Query/project deletion has six native calibration cases (QUERY_PROJECT_DELETION.md); guarded complete writers and reviewed native/installed acceptance remain open.
   Legacy text checkpoints lack the metadata needed for safe creation undo; new
   complete Oracle 8.62 text adapters have separate native evidence.
2. **Application Class creation/deletion:** source alone omits class/package
   metadata and parent version side effects. Need combined metadata snapshots
   and inverse package/class behavior, not an empty-code shortcut.
3. **Page inserted-control identity:** negative staged IDs become assigned native
   IDs, and field/storage order can change. Need verified post-save identity
   mapping and semantic equivalence before allowing review/apply/reversal.
4. **Record/field reversal:** removing fields can remove PeopleCode and alter
   related definitions. Need checkpoints for those effects and explicit DDL/data
   scope; a record row restore is insufficient.
5. **Staged dependent definitions:** existing validators query live prerequisites.
   New Derived/Work/AE/project creation has a bounded declared-dependency overlay,
   fixture evidence and installed developer-approved HRDMO creation/readback
   acceptance (`c1d1298e…`). Broader Page/Record/AE edit overlays remain open.
6. **Remaining live review acceptance:** existing writer lab evidence does not
   prove every user/MCP path. Operations/adapters without the native evidence
   recorded above still need the relevant build activated and actual developer
   plan/object approval, apply/readback, history and supported reversal on
   controlled lab definitions. Fixture approval is not native human-review
   certification.

## Cross-cutting limits

- Explicit dependency graphs only; no complete dynamic SQL/PeopleCode closure.
- Per-writer transactions, no atomic multi-object application or automatic restore.
  Trusted UI can deliberately apply one object and pause after verified readback;
  remaining work then requires a fresh continuation and approval. One native Record → AE pause/continuation/restoration is verified; this does
  not itself certify crash/lost-response behavior. Separate October 20 native SIGKILL trials now cover before/after an HTML commit without replay.
- Partial/uncertain results stop. Reviewed remaining-work proposals are fixture
  verified for reconciled ordinary partial applications, with pinned verified
  prerequisites and fresh approval. One native deliberate pause and freshly approved AE-only continuation are
  independently verified. Separate native Record/AE combined continuation inverse/redo and actual HTML SIGKILL recovery now pass. The standalone native trials use trusted service test approval. Separate installed rendered approval/pause, continuation, combined destructive inverse and fresh redo now pass with exact Record/AE native checkpoints and cleanup ([evidence](../../tools/lab/results/priority-installed-native-2026-10-20.json)). Interrupted inverse continuation now passes native Record/AE lost-reply, reconciliation, remaining deletion and full redo checks ([evidence](../../tools/lab/results/recovery-inverse-continuation-2026-10-20.json)). That trial injects the lost reply after an actual native commit; the separate HTML trials use actual SIGKILL. Separate installed UI pause/remaining undo/original-source redo and identical-render checkbox retention also pass ([results](../../tools/lab/results/inverse-continuation-installed-2026-10-20.json)); cleanup is verified. Unknown manual failures remain unsupported.
- File storage has checksums, schema checks, private files and fsync/rename on the
  development platform. Windows crash durability, retention and large-history
  indexing need verification. No shared history service exists.
- Secret scanning is heuristic and may refuse sensitive/manual source snapshots;
  it is not a universal secret detector.
- The object timeline has fixture-verified history navigation, baseline comparison
  and explicit live hash/token checks. Bounded installed/native timeline and
  redo trials are recorded for Query, Page and PeopleCode, with live checks on
  other documented adapter trials. Comprehensive visual comparison, AE visual
  acceptance and coverage of every manual mutation pathway remain incomplete.
