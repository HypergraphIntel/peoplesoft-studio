# 1.0 readiness

Assessment at 0.9.6: meaningful implementation and native verification progress,
but not feature-complete for the project's stated full Application Designer
parity goal. No 1.0 delivery date or final feature cut has been agreed. A claim
that delivery is on schedule is therefore not supported. Version 0.9.6 does not
mean 96 percent complete.

Keep the completion goal visible rather than silently narrowing it to match
what already works. This is a readiness inventory, not a newly agreed schedule
or permission to change the supported scope. The current source of capability
detail is the [README](../README.md#what-works-now), [roadmap](ROADMAP.md) and
[Change Review coverage](change-review/COVERAGE.md).

| Gate | Evidence in hand | Remaining completion work |
| --- | --- | --- |
| Definition viewing/editing | Native-backed editors and writers for major definition families | Close documented bounded edits, missing operations and Not yet definition types; verify required native reopen/save behavior |
| PeopleCode correctness | Large native corpus comparisons, calibrated compiler/decoder, protected regression baseline | Resolve remaining documented unsupported/literal reconstruction cases without regressions; retain release/platform-specific evidence |
| Requirements to reviewed build | DOCX intake and Claude analysis handoff; coherent Record/SQL/AE/project creation review; native synthetic CSV instance 607175 Success/Posted with exact expected output after a reviewed syntax correction | Native build-phase terminal handoff, representative production workflows and runtime results; reduce avoidable clarification friction while preserving real business decisions |
| Change Review and recovery | Fourteen bounded adapters; native Query, Page, Record/AE and standard IB header cycles, checkpoint inverse, exact-baseline reconciliation and freshly approved continuation | Broader structural review, create/delete and continuation reversal, more native adapter/REST/platform acceptance, and real crash/lost-response recovery |
| Query authoring | Native Windows Query comparisons for bounded supported shapes | Joins, unions, subqueries, expressions, numeric/date/aggregate/grouped/effective-date/row-security behavior and remaining lifecycle operations |
| Build and migration | SQL Table creation; Oracle Create Indexes, Alter Tables (rename and in place) and Create Views matching captured App Designer scripts, with native Alter/index execution on a lab table; supported package review/export/preview and project membership/related checks | Uncaptured Alter cases and other platforms, meta-SQL views, remaining migration families, reviewed target-specific apply and Data Migration Workbench |
| Runtime and administration | Calibrated metadata/configuration writers and guarded MCP paths | Named runtime/scheduler/integration results where claimed, remaining administrative/security workflows, and documented native boundaries |
| Platform/release support | Native Oracle evidence on named 8.61.15/8.62.09 environments; schema gates for compatible patches | Native acceptance for every platform/release advertised as production supported; SQL Server/DB2 currently remain experimental |
| UX and release reliability | Native approval/history trials, browser/editor fixtures, Node 20/26 checks, CI, packaged artifact checksums | Representative end-to-end user acceptance, upgrade/reload persistence and remaining recovery/error/discoverability cases |

## Next sequence

1. Complete: bounded, evidenced 0.9.6 release published; 0.9.7 development prepared.
2. Broaden IB structural review through explicit per-operation snapshot,
   dependency, validation and typed inverse contracts; retain native approval.
   In 0.9.6: bounded service/operation structure is implemented; installed
   developer-approved HRDMO application passed for a standard operation
   (with typed inverse) and a REST provider handler addition (reversal
   refused). 8.61 and REST consumer structural application remain open.
3. Close native handoff/recovery and remaining adapter acceptance gaps while
   expanding the Query and migration/build workflows.
4. Reassess these gates against actual evidence. Establish a 1.0 target only
   after the required feature set, outstanding scope and delivery estimates
   are concrete. Do not substitute passing unit tests for native/runtime results.
