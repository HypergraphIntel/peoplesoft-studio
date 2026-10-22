# 1.0 support contract and qualification

This contract names the qualified bounded 1.0 core. Product status is
**CORE_READY**; the development package remains **0.9.8, unreleased**.
The active evidence tracker is [1.0 progress](releases/1.0/PROGRESS.md).
The shared product model is `src/model/releaseSupport.ts`, surfaced in Settings,
tool-pane descriptions, MCP orientation and operation-level capability entries.

## Platforms and clients

| Profile | Release scope | Evidence boundary |
| --- | --- | --- |
| Oracle / PeopleTools 8.62.09 | Primary qualified 1.0 core | Native HRDMO evidence and installed acceptance bind the supported operations below. Other 8.62 patches are not certified by the family name alone. |
| Linux x64 / Windows x64 / VS Code | Qualified core clients | Installed upgrade, native editing, credentials, drafts/history and reconnect checks pass on Linux VS Code 1.143.0 and Windows VS Code 1.141.0; fresh-profile checks are recorded separately. VS Code's manifest minimum is API compatibility, not installed acceptance on every old version. Record actual tested host versions in release evidence. |
| Oracle / PeopleTools 8.61.15 | Bounded compatibility / preview | Retain the native scopes documented for this release; Query authoring is more limited. No automatic claim of parity with 8.62.09. |
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
  [Query scope](PS_QUERY_WINDOWS.md). Execution is read-only; row-security SQL
  and other unsupported families are refused, not silently approximated.
- Use calibrated Record/field, AE, Page and Process metadata workflows and
  supported Oracle Build operations. Native captures and each writer's
  validations bound the operation; physical DDL/data are not metadata undo.
- Use the current bounded Change Review adapters, history, typed inverse/redo
  and Oracle migration packages. Out-of-adapter saves retain explicit legacy
  confirmations; not every write has Change Review and not every operation
  is reversible. Separate-environment promotion remains preview pending its
  own 1.5 acceptance. Import does not copy application data.

Standalone Menu and Component Record PeopleCode write acceptance remains preview;
Menu migration has separate native evidence. Existing Application Class source
edits and bounded package migration do not qualify standalone class lifecycle
review, which remains a 1.5 expansion.

Core means in the release scope, not blanket native acceptance of every
property or variant. The [coverage matrix](change-review/COVERAGE.md), writer
contracts and final [qualification evidence](releases/1.0/PROGRESS.md) retain
operation-level acceptance and refusal boundaries. An unsupported critical
case must be fixed or explicitly refused; it cannot be silently saved.

## Preview and planned workflows

Run and Monitor remains **Preview**, with native acceptance deferred at Low
priority (RT-L1 through RT-L4). Broader administrative/configuration/security
editors retain their bounded preview scopes; legacy SAML inspection is not
browser SSO. Data Mover Scripts creates local templates and does not execute
them. Data Migration Workbench is **Planned**, not an implemented command.

Structural review expansion, class lifecycle and separate-environment
promotion target 1.5. Production SQL Server/DB2, cross-platform promotion,
Workbench and wider designer/security parity target 2.0. See
[release assignments](RELEASE_PLAN.md); no dates or universal certification are
implied by these targets.
