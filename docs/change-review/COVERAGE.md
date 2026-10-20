# Change Review capability and risk matrix

Coverage at 0.9.5, updated for 0.9.6 development (October 19). Each row distinguishes implemented scope, native acceptance
and remaining work. Historical 0.9.1 release evidence remains in
[release readiness](../RELEASE_0_9_1.md). Registration inventory is in
[INVENTORY.md](INVENTORY.md); contracts are in [CONTRACTS.md](CONTRACTS.md).

| Family/path | Current review integration | Snapshot/reversal scope | Verification and missing evidence |
|---|---|---|---|
| Plain SQL | Staged create/update; manual history | Text + native version; update reversal. No calibrated SQL deletion, so reversing CREATE is disabled | Core/production HTTP/UI fixtures and one installed HRDMO reviewed SQL create with independent Build Request readback; CREATE inverse deletion remains unsupported |
| HTML / freeform style sheets | Staged create/update; manual history | Text + native description/version; native normalization before approval; update reversal | HTTP/UI fixtures. Installed developer-approved HRDMO UPDATE of HTML ZZ_PCODE_LAB_HTM2 (text + description; LF stored as CRLF before approval) and freeform style sheet ZZ_PCODE_LAB_CSS3 (`683f4196…`) APPLIED/VERIFIED, and the separately approved typed inverse (`41bf31c5…`) restored both originals (REVERTED); CREATE inverse deletion unsupported |
| Event PeopleCode (8/9/42/43/44/46/47/48) | Staged create/update/delete; manual history | Authoritative PSPCMTXT source and native fingerprint; existing compiler/writer; reviewed inverse/redo | Compiler and HTTP/UI fixture exercise. One installed developer-approved HRDMO UPDATE (AE Export OnExecute, type 43, `af6dd54e…`) APPLIED/VERIFIED with native validation. Record PeopleCode ZZ_PCODE_LAB_R2.ZZ_PCODE_LAB_MCP1.FieldChange (type 8) UPDATE (`683f4196…`) APPLIED/VERIFIED with the decoded PSPCMPROG showing the new literal, and its typed inverse (`41bf31c5…`) restored the original source and program. Page (44), Component (46) and Component Record Field (48) PeopleCode completed a full native apply (`dafc4ed2…`), typed inverse (`be13efe5…`) and redo (`576f5403…`) cycle with PSPCMTXT and decoded PSPCMPROG readback at each step and a continuous MATCHES_PREVIOUS timeline. Other event types (42/47, menu/CI) unverified; no decompiled baseline |
| Existing Application Class source (58) | Staged update; manual source history | Existing authoritative source only | Class/package creation/deletion metadata snapshots are missing; new class staging cannot validate and class deletion is refused |
| PS Query | Staged create/edit/copy; manual history | Existing native query rows minus writer stamps; full native token and access checks; update reversal | HTTP/UI fixtures and one installed developer-approved description update with independent snapshot/token/checkpoint verification. Native description-update inverse and redo also independently verified; remaining scenarios pending; CREATE inverse needs a calibrated delete adapter |
| Process Definitions | Staged existing-definition updates; manual history | Complete editor input and native token; sorted association sets | Core/model tests. Output-mode normalization changes currently refused; reference validation still runs in writer. Installed HRDMO exact-baseline reconciliation and freshly approved continuation UPDATE (`b4266a59…`) APPLIED/VERIFIED with independent full-input/token readback; typed continuation reversal unsupported |
| Pages | Bounded staged existing-control geometry/label/use and description/comments on Oracle; manual history; shared-writer rollback preview | Full scoped native rows/CLOBs, positive persisted IDs, exact rollback-preview equivalence and locked content/version token guard. Typed inverse only when exactly reproducible | Real writer/provider HTTP/UI fixture verified. One native developer-reviewed description apply/inverse verified with full snapshot/token/checkpoint and live timeline checks. Visual overlays are implemented and browser/fixture verified. Corrected Static Text geometry/label and Edit Box use flags passed native apply/inverse plus developer Windows Designer inspection; Native Page redo verified (description: apply `2709920a…`, inverse `3da9bfad…`, redo `2c568d3c…`; the timeline marks the earlier unrecorded external edit as GAP); creation/deletion, inserted/deleted controls, binding/order/other properties and invalid-save override are not staged. See PAGE_ADAPTER.md |
| Records / fields / translates | Record description/comments staged on Oracle; new Derived/Work creation also staged; field/translate, SQL Table creation and deletion remain legacy | Six-table native preservation checkpoint, shared-writer rollback validation and locked full token; existing SQL Table/Derived Work only; Related Language referrers refused | One native Record header description apply/checkpoint inverse passed complete scoped snapshot/token/approval checks. New Derived/Work creation (ZZ_RF_AET, `c1d1298e…`) installed developer-approved APPLIED/VERIFIED; creation undo unsupported. No reviewed field removal, code side effects, type/DDL/data or general structural reversal. See STRUCTURED_HEADERS.md |
| AE | Existing-program description/comments staged on Oracle; new program creation also staged; other existing edits/copy/rename/delete remain legacy | Twenty-table preservation checkpoint including language/SQL/source/binary/tombstones; exact shared-writer rollback equivalence, locked full token and typed header inverse | One native AE header description apply/checkpoint inverse passed complete scoped snapshot/token/approval checks. Existing structural/action edits and combined create/delete/rename recovery remain open. New creation has declared proposed dependency validation and combined HTTP/UI fixture evidence; installed developer-approved HRDMO creation (ZZ_RF_EXPORT in four-object Change Set `c1d1298e…`) is APPLIED/VERIFIED with independent readback. See STRUCTURED_HEADERS.md |
| Menus / CI / channels | Legacy | Existing writer/session models reusable, not yet review adapters | Need complete snapshots and inverse/dependency evidence for create/edit/copy/rename/delete |
| IB services / operations | Existing description/comments and bounded structure staged on Oracle (see IB_STRUCTURE.md); other structural edits and creation remain legacy | Fixed noncredential native scopes (2 service tables, 16 operation tables), exact rollback preview, full scoped token and precommit after-image check; typed inverse/history | Six HRDMO native rollback previews pass for standard and REST provider/consumer shapes. Real-writer transaction tests and production HTTP/UI fixture apply/inverse/timeline pass. One installed developer-approved HRDMO standard service/operation apply/inverse cycle passed complete scoped hash/token/checkpoint/history checks; original states are restored. REST reviewed application remains separate. Bounded structure (service owner/namespace; operation header, existing versions/parameters/handlers, calibrated OnRequest handler addition) has real-writer fixture, HTTP/UI and four native HRDMO rollback-preview passes; installed developer-approved HRDMO application passed for a standard operation (with typed inverse restoring the original) and a REST provider handler addition (whose reversal is refused up front), and an added handler cannot be reversed. Credential freshness, routing-reaching changes, create/delete and automatic dependency closure are outside scope. See IB_HEADERS.md and IB_STRUCTURE.md |
| Other IB / Portal / administration / OAuth | Legacy | Secret-filtered readers/writers exist; not generalized into exact review snapshots | Need per-kind normalization, side-effect/checkpoint scope, ownership/configuration authorization and inverse evidence |
| Event Mapping / PFC / Drop Zones | Legacy | Existing configuration models and previews reusable | Need derived mapping/service side-effect snapshots, zero/new configuration states and dependency-aware reversal coverage |
| Project create and membership | New Oracle project and bounded explicit members staged; existing project edits remain legacy | Fixed noncredential snapshot, same-transaction native create/membership rollback preview and exact after-image guard | Combined creation HTTP/UI fixture passes; installed developer-approved HRDMO creation (ZZ_RF_PRJ, `c1d1298e…`) APPLIED/VERIFIED with five members and zero missing dependencies. No credential freshness, automatic closure or creation undo. See STRUCTURED_CREATION.md |
| Migration import / physical build | Existing UI workflow, not migrated | Existing packages/receipts; independent writer commits | Need review integration for all adapters, database DDL/data boundaries and resumable prerequisite contracts |
| SQL Server / DB2 | Legacy paths retained | Reviewed environment identity not calibrated | Need live identity/read/snapshot/write verification per platform; no claim of reviewed apply support |

## Local blockers and exact missing evidence

These affect object adapters, not the generic service. Do not infer inverse
writes or replay opaque rows to get around them.

1. **Creation reversal for SQL/HTML/style/Query:** no calibrated delete pathway
   exists in the released writer. Need native delete/recreate captures, dependent
   object handling, counter/tombstone controls, writer tests and native reopen.
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
   New Derived/Work/AE/project creation now has a bounded declared-dependency overlay with fixture evidence. Native creation acceptance and broader Page/Record/AE edit overlays remain open.
6. **Live review acceptance:** existing writer lab evidence does not prove this
   new user/MCP flow. Need the development build activated and actual developer
   plan/object approval, apply/readback, history and reversal on controlled lab
   definitions. Fixture approval is not native human-review certification.

## Cross-cutting limits

- Explicit dependency graphs only; no complete dynamic SQL/PeopleCode closure.
- Per-writer transactions, no atomic multi-object application or automatic restore.
  Trusted UI can deliberately apply one object and pause after verified readback;
  remaining work then requires a fresh continuation and approval. One native Record → AE pause/continuation/restoration is verified; this does
  not certify crash/lost-response behavior.
- Partial/uncertain results stop. Reviewed remaining-work proposals are fixture
  verified for reconciled ordinary partial applications, with pinned verified
  prerequisites and fresh approval. One native deliberate pause and freshly approved AE-only continuation are
  independently verified; actual crash/lost-response acceptance remains open. Partial reversals/manual failures and reversal of continued work need
  combined recovery semantics and remain unsupported.
- File storage has checksums, schema checks, private files and fsync/rename on the
  development platform. Windows crash durability, retention and large-history
  indexing need verification. No shared history service exists.
- Secret scanning is heuristic and may refuse sensitive/manual source snapshots;
  it is not a universal secret detector.
- The object timeline has fixture-verified history navigation, baseline comparison
  and explicit live hash/token checks. Installed visual/native acceptance,
  native Page/AE comparison and every manual mutation pathway remain incomplete.
