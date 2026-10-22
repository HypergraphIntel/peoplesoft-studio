# Release plan: 1.0, 1.5 and 2.0

Planning checkpoint: October 21, 2026; qualification execution: October 22. The developer directed that larger
items from the readiness discussion can move to 1.5 or 2.0. The assignments
below are release targets, not release dates. The selected 1.0 support
matrix is recorded in [the support contract](SUPPORT_MATRIX.md). The current development version remains 0.9.8, unreleased.

Full Application Designer parity remains the long-term goal. It is not the
completion test for the focused 1.0 defined here. Existing functionality stays
available within its recorded limits; moving an expansion to a later target
does not remove its implementation or certify an unverified path.

## 1.0 — dependable core workflows

The release gate is confidence in the supported core, rather than completing
every designer, adapter, platform or runtime feature.

| ID | Required work | Exit evidence |
| --- | --- | --- |
| V1-1 | Declare the stable support matrix and supported operations. Separate stable, experimental/preview and planned capabilities consistently in the UI, MCP catalog and documentation. | Named database/PeopleTools/client profiles and operation-level limits match native/installed evidence. Decide exact profiles before the release candidate; Oracle 8.62 is the proposed primary profile, not a newly certified matrix. |
| V1-2 | Fix correctness, unauthorized-write and data-loss defects in the declared stable paths; preserve existing approval, concurrency and recovery gates. | Native save/readback and refusal evidence for core workflows; no unresolved critical defect in the supported release scope. Broader Change Review adapters can remain future work; existing legacy confirmation paths must remain explicit and guarded. |
| V1-3 | Qualify the supported PeopleCode/compiler scope. | Protected 430-definition baseline has no EXACT regressions; targeted regressions and representative native validation pass for the advertised profiles. Unsupported constructs refuse clearly. Full corpus/language coverage is not a 1.0 requirement. |
| V1-4 | Verify installation, upgrade, core editing and recovery on every client OS advertised as stable. | Fresh install and upgrade preserve credentials, drafts and history; connection loss, reload and interrupted supported saves cannot cause blind replay or silent loss. Windows core acceptance remains a gate if Windows is advertised as stable; Windows AI Build handoff is a separate expansion below. |
| V1-5 | Run representative core journeys against the exact release candidate and publish accurate evidence. | Connect/open/edit/review/save/readback and supported undo/redo pass; declared Query/build workflows pass native checks; clean CI and matching tested/packaged artifact fingerprints. Reconcile stale trackers, freeze/commit the release scope and prepare support/upgrade notes before publication. |

Unverified features can ship as clearly marked preview only when they do not
undermine these gates. Do not claim that every write has Change Review or that
every operation is reversible. Failures in an advertised stable path remain
1.0 work even if a related expansion is targeted later.

## 1.5 — deeper development and delivery workflows

| Target | Work carried forward | Acceptance boundary |
| --- | --- | --- |
| V15-1 | Structural Change Review for Page controls, Record/field changes, AE structural edits and package/class lifecycle. | Stage complete checkpoints and native writer previews; native apply/readback and supported inverse/redo; refuse unsafe DDL/data reversal. Start with Page insert/delete/rebind/order. |
| V15-2 | Promotion between separate Oracle environments, plus broader migration shapes. | Distinct source/target native acceptance, prerequisites, conflicts, partial failure and supported undo/redo. Current same-database evidence does not certify this path. Cross-platform promotion is a separate 2.0 target. |
| V15-3 | Production-style business-request-to-application acceptance and Windows Codex/Claude Build handoff. | Native application behavior and deployment evidence for realistic requirements; retain existing bounded Linux/HRDMO synthetic acceptance. Core Windows installation/editing is not deferred by this item. |
| V15-4 | Broader Query/release support and editor improvements. | Extend 8.61 authoring and additional Query families only with native captures; add language tooling beyond the current supported compiler/editor contract without protected regressions. |
| V15-5 | Run and Monitor native acceptance, when its environment prerequisite is convenient. **Low priority**, carried forward from the developer's earlier direction. | RT-L1 through RT-L4: gateway TLS, one confirmed native run, actual UI log/download verification, installed persistence/refusal/recovery. Remains preview until verified; no server work or scheduler run is authorized to execute automatically by this plan. |

## 2.0 — platform and parity expansion

- Production SQL Server/DB2 support and promotion between database platforms,
  backed by native platform-specific read/write/recovery evidence.
- Data Migration Workbench and broader application/configuration data migration;
  distinguish metadata checkpoints from physical DDL and application data.
- Broader writable administration/security and remaining designer families,
  including the current read-only/unsupported areas, toward full Application
  Designer parity.
- Browser SAML SSO and broader release-specific security/integration workflows,
  subject to the native capabilities of each PeopleTools release.

These are candidate expansion areas. 2.0 is not a promise that complete
Application Designer parity is already scoped or estimated.

## Evidence and task tracking

The [1.0 readiness inventory](RELEASE_1_0_READINESS.md) retains the technical
gaps and evidence. Its broader remaining-work column is not an instruction to
finish every item before 1.0; the release assignments above distinguish
the gate from later expansions. [Priority tasks](PRIORITY_TASKS.md) links the
active release gate and the scheduler's explicitly Low-priority follow-up.
No tag, publication, support certification or version bump follows from this
planning change.
