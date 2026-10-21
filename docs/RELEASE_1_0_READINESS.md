# 1.0 readiness

Assessment as of October 21, 2026: 0.9.7 is released.
There is meaningful implementation and native verification progress,
but not feature-complete for the project's stated full Application Designer
parity goal. No 1.0 delivery date or final feature cut has been agreed. A claim
that delivery is on schedule is therefore not supported. Version 0.9.7 does not
mean 97 percent complete.

Keep the completion goal visible rather than silently narrowing it to match
what already works. This is a readiness inventory, not a newly agreed schedule
or permission to change the supported scope. The current source of capability
detail is the [README](../README.md#what-works-now), [roadmap](ROADMAP.md) and
[Change Review coverage](change-review/COVERAGE.md).

| Gate | Evidence in hand | Remaining completion work |
| --- | --- | --- |
| Definition viewing/editing | Native-backed editors and writers for major definition families | Close documented bounded edits, missing operations and Not yet definition types; verify required native reopen/save behavior |
| PeopleCode correctness | Large native corpus comparisons, calibrated compiler/decoder, protected regression baseline | Resolve remaining documented unsupported/literal reconstruction cases without regressions; retain release/platform-specific evidence |
| Requirements to reviewed build | DOCX intake and Claude analysis; actual installed Codex/Claude Build buttons, reviewed Record/SQL/AE/project creation, separately confirmed Process Definitions, native runs 607265/607266 with exact CSVs, Posted to Web with native View Log/Trace; installed write-confirmation timeout outcomes and deferred PENDING progress | Representative production workflows; Windows handoff |
| Change Review and recovery | Primary Approve and apply with revision/rendered-state binding and retained object review (fixture-backed acceptance); fourteen bounded Oracle adapters; native Query, Page, Record/AE, text/PeopleCode and standard IB header cycles; standard IB structural apply/inverse and REST provider handler addition; checkpoint inverse, exact-baseline reconciliation and freshly approved continuation; crash/lost-reply reconciliation, continuation undo/redo, creation reversal and undo/redo of every migrated type through App Designer-calibrated deletion writers | Broader structural review, IB creation/deletion, more native adapter/REST/platform acceptance; added IB handler reversal remains refused |
| Query authoring | Native Windows Query comparisons for bounded supported shapes | Joins, unions, subqueries, expressions, numeric/date/aggregate/grouped/effective-date/row-security behavior and remaining lifecycle operations |
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
2. Broaden IB structural review through explicit per-operation snapshot,
   dependency, validation and typed inverse contracts; retain native approval.
   In 0.9.6: bounded service/operation structure is implemented; installed
   developer-approved HRDMO application passed for a standard operation
   (with typed inverse) and a REST provider handler addition (reversal
   refused). 8.61 and REST consumer structural application remain open.
3. Close native recovery and remaining adapter acceptance gaps while
   expanding the Query and migration/build workflows. Migration now covers
   every definition type listed in the gate table, with undo/redo; explicit
   refusals and cross-database migration remain. Broader migration and review
   coverage remains completion work, not an agreed release scope or schedule.
4. Reassess these gates against actual evidence. Establish a 1.0 target only
   after the required feature set, outstanding scope and delivery estimates
   are concrete. Do not substitute passing unit tests for native/runtime results.
