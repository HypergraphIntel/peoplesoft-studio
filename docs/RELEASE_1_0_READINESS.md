# 1.0 readiness

Assessment as of October 21, 2026: 0.9.7 is released. The next development
version is **0.9.8 — unreleased**; package metadata and
[draft release notes](releases/0.9.8.md) are prepared, with no release date set.
There is meaningful implementation and native verification progress,
but not feature-complete for the project's long-term full Application Designer
parity goal. The developer has directed larger items toward later releases;
[the proposed 1.0 / 1.5 / 2.0 plan](RELEASE_PLAN.md) separates core release gates
from expansions. No 1.0 delivery date or final support matrix has been agreed. A claim
that delivery is on schedule is therefore not supported. Version 0.9.7 does not
mean 97 percent complete.

Keep the long-term completion goal visible while planning staged releases.
This is an evidence inventory across the whole product, not a requirement to
complete every remaining item for 1.0. Use [V1-1 through V1-5](RELEASE_PLAN.md#10--dependable-core-workflows)
as the proposed 1.0 gate; structural review expansion, cross-environment
promotion and broader business/AI handoffs target 1.5, with platform/parity
expansion targeting 2.0. These targets do not certify unsupported paths.
The current source of capability
detail is the [README](../README.md#what-works-now), [roadmap](ROADMAP.md) and
[Change Review coverage](change-review/COVERAGE.md).

| Gate | Evidence in hand | Remaining completion work |
| --- | --- | --- |
| Definition viewing/editing | Native-backed editors and writers for major definition families | Close documented bounded edits, missing operations and Not yet definition types; verify required native reopen/save behavior |
| PeopleCode correctness | Large native corpus comparisons, calibrated compiler/decoder, protected regression baseline | Resolve remaining documented unsupported/literal reconstruction cases without regressions; retain release/platform-specific evidence |
| Requirements to reviewed build | DOCX intake and Claude analysis; actual installed Codex/Claude Build buttons, reviewed Record/SQL/AE/project creation, separately confirmed Process Definitions, native runs 607265/607266 with exact CSVs, Posted to Web with native View Log/Trace; installed write-confirmation timeout outcomes and deferred PENDING progress | Representative production workflows; Windows handoff |
| Change Review and recovery | Primary Approve and apply with revision/rendered-state binding and retained object review (fixture-backed acceptance); fourteen bounded Oracle adapters; native Query, Page, Record/AE, text/PeopleCode and standard IB header cycles; standard IB structural apply/inverse, 8.61 and REST consumer structural apply/inverse, REST URI template text, REST provider handler addition with calibrated undo/redo, and 8.62.09 standard and REST service/operation creation/deletion with typed inverse (installed, October 21); checkpoint inverse, exact-baseline reconciliation and freshly approved continuation; crash/lost-reply reconciliation, continuation undo/redo, creation reversal and undo/redo of every migrated type through App Designer-calibrated deletion writers | Broader structural review and writable cells, 8.61 IB child deletion, other IB definition families, more native adapter/platform acceptance |
| Query authoring | On 8.62.09, Windows Query parity for criteria (every operator, prompts, number/date), joins (standard, left outer, related), aggregates with HAVING and DISTINCT, expression columns, IN/EXISTS subqueries, unions, translates and effective dating: 31 native captures replayed exactly, SQL equal to the SQL tab, and ten Studio-written queries reopened in Windows Query with identical SQL and results; designer editing of all of these; migration of any writer-validated shape; review-only delete and rename (copy plus delete); ten installed VSIX checks of designer editing, displayed result values, consent refusal, rename/delete and exact reviewed undo ([evidence](../tools/lab/results/query-installed-2026-10-21.json)) | Row-security SQL, nested subqueries, 8.61.15 beyond one record and one equal-to criterion (needs HCDEV captures) |
| Build and migration | SQL Table creation; Oracle Create Indexes, Alter Tables (rename and in place) and Create Views matching captured App Designer scripts, with native Alter/index execution on a lab table; reviewed project migration of fields, records (SubRecords, user indexes), SQL, HTML, style sheets, PeopleCode, AE, Query, Menu, packages, pages and components with native HRDMO trials and App Designer checks; project membership/related checks | Uncaptured Alter cases and other platforms, meta-SQL views, the explicit migration refusals, cross-database migration and Data Migration Workbench |
| Runtime and administration | Calibrated metadata/configuration writers and guarded MCP paths | Named runtime/scheduler/integration results where claimed, remaining administrative/security workflows, and documented native boundaries |
| Platform/release support | Native Oracle evidence on named 8.61.15/8.62.09 environments; schema gates for compatible patches | Native acceptance for every platform/release advertised as production supported; SQL Server/DB2 currently remain experimental |
| UX and release reliability | Native approval/history trials, browser/editor fixtures, Node 20/26 checks, CI, packaged artifact checksums | Representative end-to-end user acceptance, upgrade/reload persistence and remaining recovery/error/discoverability cases |

**Completed editor acceptance:** the task to validate and polish the new
PeopleCode editor features is closed, with 13 checks against an unmodified
installed VSIX on VS Code 1.141.0 / HRDMO 8.62.09. Evidence covers record fields,
class members and actual suggestion popups, a real large delivered class,
connection changes, settings changes, close/reopen cleanup and stale-result
rejection. It is removed from the outstanding gates above; see the
[completion audit](PEOPLECODE_EDITOR.md#completion-audit). Broader compiler,
platform and language-tooling development remains separate from this completed
acceptance task.

## Current checkpoint and remaining work

1. Complete: bounded, evidenced 0.9.7 release published. See
   [release notes](releases/0.9.7.md).
2. Complete (October 21, unreleased): IB structural review now has
   per-operation snapshot, dependency, validation and typed inverse contracts,
   with installed developer-approved evidence for 8.61 and REST consumer
   structural apply/inverse, undo/redo of the added REST provider handler and
   8.62.09 standard service/operation CREATE/DELETE. See
   [IB_STRUCTURE.md](change-review/IB_STRUCTURE.md#installed-acceptance-october-21).
   REST service/operation lifecycle passed installed acceptance the same day.
   8.61 child deletion and other IB families remain open.
3. For 1.0, close correctness, safety, core native/installed acceptance,
   upgrade/recovery and exact-artifact release gates within a declared stable
   support matrix. Retain unsupported-operation refusals and explicit preview
   labels. Broader structural review, migration/promotion and business/AI
   workflow expansion target 1.5; platform/parity expansion targets 2.0.
4. Low priority, deferred by the developer: Run and Monitor's gateway TLS
   prerequisite and real installed scheduler, output and persistence acceptance
   ([RT-L1 through RT-L4](PRIORITY_TASKS.md#run-and-monitor--low-priority-follow-up)).
   Local implementation/tests and candidate packaging are complete; native
   runtime acceptance remains unverified and must not be inferred from them.
   Carry forward to the proposed 1.5 plan as Low priority, not a 1.0 gate.
5. Reassess these gates against actual evidence. Establish a 1.0 target only
   after the required feature set, outstanding scope and delivery estimates
   are concrete. Do not substitute passing unit tests for native/runtime results.
