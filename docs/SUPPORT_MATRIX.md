# 1.0 support contract and qualification

This contract names the qualified bounded 1.0 core. Product status is
**CORE_READY**; the qualified core ships in release **0.9.8** and later.
Release **0.9.9** adds the accepted 1.5 workflows outside this core (see
[Accepted 1.5 workflows](#accepted-15-workflows-099)).
The active evidence tracker is [1.0 progress](releases/1.0/PROGRESS.md).
The shared product model is `src/model/releaseSupport.ts`, surfaced in Settings,
tool-pane descriptions, MCP orientation and operation-level capability entries.

## Platforms and clients

| Profile | Release scope | Evidence boundary |
| --- | --- | --- |
| Oracle / PeopleTools 8.62.09 | Primary qualified 1.0 core | Native HRDMO evidence and installed acceptance bind the supported operations below. Other 8.62 patches are not certified by the family name alone. |
| Linux x64 / Windows x64 / VS Code | Qualified core clients | Installed upgrade, native editing, credentials, drafts/history and reconnect checks pass on Linux VS Code 1.143.0 and Windows VS Code 1.141.0; fresh-profile checks are recorded separately. VS Code's manifest minimum is API compatibility, not installed acceptance on every old version. Record actual tested host versions in release evidence. |
| Oracle / PeopleTools 8.61.15 | Bounded compatibility / preview | Retain the native scopes documented for this release. Query authoring matches 8.62.09, calibrated family by family against Windows Query on 8.61.15 (0.9.9). No automatic claim of parity with 8.62.09 elsewhere. |
| SQL Server / DB2 | Experimental / 2.0 production target | Fixture-backed platform comparisons do not certify native PeopleSoft writes or reviewed recovery on these platforms. |
| macOS, other client architectures or unqualified PeopleTools patches | Unqualified / preview | Existing compatibility is not a native/installed certification. |
| App Designer project export | Read-only core workflow | Project-scoped file reads; no database writes and no inferred database release. |

CI checks Linux and Windows on Node 22/24. This validates repository code and
fixtures, separately from VS Code's embedded runtime and native client checks.
Node 20's historical results remain evidence for those older artifacts, rather
than the current CI runtime promise.

## Core workflow boundaries

- Connect/search/open implemented definitions and project exports.
- Edit authoritative stored-source PeopleCode, use the supported compiler,
  completion/navigation and diagnostics. Protected binary calibration remains
  evidence-based; unsupported programs stay read-only/refuse writes.
- Edit bounded SQL, HTML and freeform CSS using native readback and current
  approval/concurrency gates. Classic/nonportable sheets keep their limits.
- Author and execute bounded Oracle 8.62 Query shapes as documented in
  [Query scope](PS_QUERY_WINDOWS.md). Execution is read-only; unsupported
  shapes are refused, not silently approximated.
- Use calibrated Record/field, AE, Page and Process metadata workflows and
  supported Oracle Build operations. Native captures and each writer's
  validations bound the operation; physical DDL/data are not metadata undo.
- Use the current bounded Change Review adapters, history, typed inverse/redo
  and Oracle migration packages. Out-of-adapter saves retain explicit legacy
  confirmations; not every write has Change Review and not every operation
  is reversible. Separate-environment promotion is an accepted 1.5 workflow
  outside the core (below). Import does not copy application data.

Standalone Menu and Component Record PeopleCode write acceptance remains preview;
Menu migration has separate native evidence.

Core means in the release scope, not blanket native acceptance of every
property or variant. The [coverage matrix](change-review/COVERAGE.md), writer
contracts and final [qualification evidence](releases/1.0/PROGRESS.md) retain
operation-level acceptance and refusal boundaries. An unsupported critical
case must be fixed or explicitly refused; it cannot be silently saved.

## Accepted 1.5 workflows (0.9.9)

These passed native and installed acceptance on the Oracle lab environments
and ship in [0.9.9](releases/0.9.9.md). They are outside the qualified 1.0
core: the product labels them Preview, and the 1.0 exact-artifact
qualification does not cover them.

- Structural Change Review for Page controls, Record field structure and
  App Engine edits; Application Package and class creation and deletion with
  exact undo/redo. Stage a new package before its new class.
- Promotion between separate Oracle environments, including prerequisites,
  conflicts, partial failure and undo/redo. A promotion that creates a process
  definition cannot be undone; subpackage/class metadata does not migrate.
- Run and Monitor (Application Engine, existing run controls, run now,
  WEB/TXT) on Oracle 8.62.09: RT-L1 to RT-L4 passed. Native lost-response
  recovery is fixture-tested only.
- Every PS Query family on 8.61.15, and the Windows AI Build handoff.

## Preview and planned workflows

Broader administrative/configuration/security editors retain their bounded
preview scopes; legacy SAML inspection is not browser SSO. Data Mover Scripts creates local templates and does not execute
them. Data Migration Workbench is **Planned**, not an implemented command.

Production SQL Server/DB2, cross-platform promotion, Workbench and wider
designer/security parity target 2.0. See
[release assignments](RELEASE_PLAN.md); no dates or universal certification are
implied by these targets.
