# Verification strategy and current evidence

Baseline before code changes: `npm run verify` passed (1,817 tests; 1,816 passed,
one skipped), including typecheck, bundle and activation smoke. The existing
writer/native capture suites remain the regression gate. No encoder/decoder
rules were modified.

Current commands:

```sh
npm run verify
npm run test:mcp-workflows
npx tsx tools/change-review/inventory.mts
```

The 0.9.1 candidate passed full verify (1,915 passed, one skipped), activation
with 103 commands/nine views, navigation coverage and all 36 fixture HTTP/UI
checks. Its MCP handshake version must equal package.json. Release-specific
native gates and the staged/paused/continuation/baseline-restoration harnesses
are tracked in [0.9.1 readiness](../RELEASE_0_9_1.md). Those new harnesses pass
strict standalone TypeScript checks; their native phases are still pending
activation and actual developer approval/application.

`src/test/changeReview.test.ts` drives the real model/store/service with an
explicit fixture adapter; it is not database certification.
`src/test/reviewSemanticDiff.test.ts` exercises model-level Page/AE/Record
identity/order rules. `tools/lab/mcp-workflow-fixture-e2e.mts` starts the actual
HTTP MCP server, staging compatibility wrapper, native adapter wiring and real
review UI handlers over fixture database methods. It exercises the real existing
PeopleCode compiler and delivered-object guard; persistence remains a fixture.
No tests approve a live database write on the developer's behalf.

Object-timeline coverage (October 15, 2026): the service tests distinguish
pending proposals from verified revisions, preserve reversal/manual and
partial-application history, detect continuity gaps and token-only/content
drift, isolate canonical object keys and environments, and retain history after
store reopen. Historical reads do not connect; explicit live checks cannot
read another environment or mutate proposal state. The production HTTP/UI
fixture checks the timeline endpoint, escaped titles, explicit live status,
baseline comparison and rejection of a foreign revision. These remain fixture
checks until the installed developer-reviewed native flow is exercised.

## Required scenario matrix

| Proposal scenario | Current evidence | Remaining controlled-lab evidence |
|---|---|---|
| 1. Single modified object | Service update/reversal tests; delivered SQL HTTP/UI fixture | One developer-approved HRDMO Query description update/readback verified; remaining families pending |
| 2. Single new object | SQL/Query/content/event-code HTTP/UI fixtures | Actual reviewed creation/readback |
| 3. Deleted object | Distinct destructive approval in service; event-code deletion HTTP/UI fixture | Native event-code delete/recreate through review |
| 4. Five dependent objects | Service five-object chain and dependency order | Multi-family native staged prerequisites |
| 5. Rejected dependency | Transitive rejection/eligibility tests | Native review UX acceptance |
| 6. Revision after approval | Approval invalidation and stale UI tests | Native UI acceptance |
| 7. External database modification | Injected live drift/token mismatch | Concurrent App Designer/PIA edit |
| 8. Read-only connection | Adapter/service gate fixtures | Actual configured readonly transition |
| 9. Delivered-object policy | Actual installed guard over fixture provider; changed policy proof refused | Native block/requireApproval policies via review |
| 10. Mid-set failure | Fixture commit-then-error; later writes stop | Controlled native writer failure |
| 11. Restart during review | Store reopen preserves proposal/review | Actual VS Code reload with pending review |
| 12. Restart during apply | Interrupted APPLYING journal + reconciliation | Controlled extension termination around native commit |
| 13. Duplicate MCP retry | Idempotency keys, identical staging and duplicate apply tests | Client disconnect/retry against installed MCP |
| 14. Undo after external modification | Live token/content conflict tests | Concurrent native modification before reverse |
| 15. Redo after undo | Reviewed reverse/forward service tests; UI prepares event-code redo | One developer-reviewed Query update/inverse/redo cycle verified with native snapshot/token/checkpoint and history links; other families pending |
| 16. Interrupted recovery | Corruption, dead/unknown lock, validation restart, uncertain-result tests | Installed crash/recovery paths |
| 17. Multiple environments | Environment identity drift blocks writes; history filters | Two actual environments and no cross-target restoration |
| 18. Manual saves in history | Service manual-history tests; explicit provider hooks for nine adapter families | Native text/custom editor saves and failures |
| 19. Page/AE semantics | Persisted-control/step-order model tests; ambiguous matches explicit | Native fixtures, actual designer views and new-control mapping |
| 20. Full request-to-history flow | Production HTTP -> stage -> real UI -> real guard -> fixture writer -> verified journal | Installed human-reviewed lab workflow |

Plan approval, operator/policy drift and cancellation tests supplement the
proposal's required scenarios. Fixture success is recorded separately from
native verification. All 15 acceptance criteria still require installed/native
validation and broader adapter coverage before the initiative is complete.

## Native test prerequisites

Prepare a development VSIX, activate it after a developer-controlled reload,
and use only controlled lab definitions. The developer reviews the actual
plan/diffs and applies using the persistent page. Agents may create/stage and
poll status; they must not call internal review/apply methods to impersonate
native human approval. Retain before/after fingerprints, exact applied objects,
checkpoint links and failure outcomes in sanitized reports. Do not rerun the
0.9.0 immediate-save live harness unchanged: migrated tools now return
REVIEW_REQUIRED rather than saved=true.

## Installed Query apply evidence — October 15, 2026

Developer applied Change Set `8cd54e34-9e5e-4322-9da5-f84a997053f4`. The
read-only acceptance harness independently checked native Query snapshot hash,
current token, exact approval hash, checkpoint and the single description diff.

```sh
npx tsx tools/lab/change-review-acceptance.mts 8cd54e34-9e5e-4322-9da5-f84a997053f4
```

It records evidence only after assertions pass, never invokes approval/apply,
and requires the supplied revision to remain the current verified native result.
After a reviewed reversal or redo is applied, pass that new Change Set ID.
Results are in `tools/lab/results/change-review-native-validation.json`.
The subsequent inverse/redo and timeline checks below extend this evidence;
one Query cycle does not certify all 20 scenarios or every object family.

The developer also applied inverse `5c6551dc-46de-4de6-81db-ae0cfe163b3f`.
The same harness passed against that ID: full native semantic snapshot equals
the original before-state checkpoint, current token equals the inverse's
verified readback, and the original set is independently confirmed REVERTED.
This verifies one Query update reversal; the subsequent redo is documented
below. It does not certify deletion/DDL/general restore.

The developer applied redo `523036b4-853a-4f65-a9eb-59b0b55801d7` and the
harness passed: the native semantic snapshot returns to the original reviewed
after-state under a new token and fresh approval. It also verifies the inverse
snapshot chain and REVERTED predecessors/journal backlinks. This completes one
controlled Query description cycle. After reload, the installed timeline also
reports all three continuous verified revisions and MATCHES_RECORDED to the
current redo. UI navigation/comparison, concurrent native drift and crash/recovery
remain separate acceptance tasks.

## Reviewed remaining work (development)

Seven additional service tests cover: commit-then-error reconciliation before
preparation; no replay of verified writes; fresh review and durable schema-2
records; dependency remapping and excluded rejected objects; drift of confirmed
and untouched objects; prerequisite checks after approval, between writers and
at final completion; inherited prerequisites after repeated interruption;
separate plan approval; idempotent preparation and cancelled replacement;
prerequisite-bound approval and refusal of schema-1 continuation downgrade.

The production HTTP/UI fixture simulates a SQL writer that commits B and loses
its response. Preparation is refused before reconciliation; the new proposal
contains only C, while A/B are pinned and excluded from writes. Native-token
drift of A blocks the new apply; after revalidation/fresh approval, C runs
once and repeated preparation returns the same follow-up. The original partial
record remains partial with navigable links to its continuation. These checks
are fixtures, not native fault-injection certification.

## Page rollback-preview groundwork

`pageWriterTransaction.test.ts` drives the actual Page writer with a
transactional fixture. It verifies rollback of both page rows and counters,
normal commit behavior, stale/readback failures and lock release for unchanged
previews. Existing capture-backed Page-plan tests remain intact. The HTTP
workflow harness exercises the actual provider and writer (not a mocked save),
checking that preview skips approval/refresh and post-rollback verification,
retains writable/mode/dirty/stale gates, and preserves normal save approval.
Native snapshot and installed acceptance evidence is recorded below.

## Bounded native-snapshot Page adapter

The transaction suite now also checks full native before/after images captured
before rollback, complete CLOB text beyond 4,000 characters, retained unknown
columns, timestamp precision, canonical row order, token/content separation,
after-image failure rollback and a full token guard under the writer lock.

HTTP/UI fixtures use the real provider/writer over a transactional fixture to
verify Page staging, exact native validation, developer UI apply and checkpoint
inverse. They reject unsupported operations/native-column changes, detect
unversioned control-row drift after approval, and record manual Page saves with
a visible external-change gap in the object timeline. The fixture guard checks
the private exact Page write context. Existing capture-backed native Page-plan
tests remain unchanged. No fixture test impersonates developer approval on a
live database. Installed/native evidence is bounded to the lab checks below.

Controlled native preview harness (requires the newly activated build):

```sh
npx tsx tools/lab/page-review-native-preview.mts --check-capabilities
npx tsx tools/lab/page-review-native-preview.mts --page=ZZ_PCODE_LAB_PG
```

It checks the actual tools/list schema before any Page writer call, so older
servers cannot silently discard unknown dryRun fields and take a save path.
The capability-only run refused the old loaded host (dryRun absent) without
calling the Page writer. Once active, preview runs compare native scoped
before hashes/tokens across rollback transactions and store sanitized evidence.
It never stages, approves or applies. Installed previews passed on HRDMO's
ZZ_PCODE_LAB_PG, preserving all eleven scoped table images, token and version.
Global counter readback and native visual reopen remain separate evidence.

The developer approved/applied the description proposal and its separate
checkpoint inverse. The read-only acceptance harness passed after each:

```sh
npx tsx tools/lab/page-review-acceptance.mts ba4a466c-fbf6-4190-9f64-aa423d53edda
# After the separately reviewed inverse is applied, use its ID instead:
npx tsx tools/lab/page-review-acceptance.mts dd4967c1-8835-4691-b6d2-05dec76ad072
```

Each command requires its supplied set to remain the current APPLIED revision.
Checks include exact approval hash, checkpoint, before/after snapshot hashes,
single description diff, current native full-snapshot/token timeline match and
reversal ancestry/backlinks. The inverse restores original scoped content,
description `Lab Page Edited`, 23 controls, new version 561 and a new token.
Original set is REVERTED; timeline has two continuous verified revisions.
Evidence: `tools/lab/results/page-review-native-validation.json`. This does not
certify native geometry/label/use edits, native Page redo, visual reopen, global
counter readback or all Page operations.

## Visual Page review and control-type acceptance

Five Page visual tests cover shared designer geometry, persisted identity,
move/resize/label/use summaries, source escaping/no active HTML, snapshot
immutability, independent before/history namespaces, unknown after-states and
explicit native-property review. HTTP/UI checks cover selected Page rendering
and retained-baseline comparison without writes. Chromium rendered the actual
lab Page rollback images; fit/zoom and paired selection/red outlines passed DOM
assertions and screenshot inspection. Installed native navigation still needs
developer acceptance; a local browser check is not Application Designer parity.

The static-text control-21 trial passed native persistence/readback but FAILED
native type validity: developer inspection reported Display Only/Invisible are
not supported for Static Text. Developer-applied inverse restored the original
full checkpoint at version 563. Evidence is explicitly labeled in
`page-control-review-native-validation.json`. Shared operation/writer/copy guards
now refuse these flags and permit clearing them. Targeted tests also cover the
agent capability note and retain the native capture-backed Page tests. Re-run
flags on a valid field control; do not certify the earlier invalid combination.

## Bounded Record/AE headers and deliberate pause

`reviewStructuredHeaders.test.ts` uses the real Record/AE writers over a narrow
transactional fixture, testing full preservation, actual rollback previews,
committing saves, typed inverse, after-image failure, unversioned drift, schema
and native value refusal, binary/timestamp fidelity, Related Language exclusions
and preservation of AE's existing public plan-only dryRun behavior. HTTP/UI
checks exercise both staged paths, exact approval/application, verified inverse,
history and structural refusal without empty proposals.

Two service tests and a production HTTP/UI scenario check deliberate one-object
application: all preflight checks run, one writer/readback is verified, journal
records a deliberate pause, no pending writer runs, and remaining work needs
fresh pinned-prerequisite review. Partial reversal application is refused. These
are fixture checks; native pause/continuation and true crash/lost-response
certification remain separate tasks.


## 0.9.1 structured native apply/inverse

The developer selected the normal full Apply action on the initial three-object
trial, so the pause-specific harness correctly refused to classify it as a
partial application. Developer confirmation distinguishes the selected action
from a pause-control defect. The full native acceptance mode verified all three
objects and the separately reviewed inverse, including complete original scopes,
fresh tokens and approvals, checkpoints, reversed dependencies and exact current
live matches. Windows Application Designer matched the corrected Page controls
before reversal. A separate two-header trial is used for native pause/continuation;
no pause or crash success is inferred from the full-application cycle.


Native two-header pause/continuation and baseline restoration now pass. Evidence
is in `header-pause-native-validation.json`; final all-lab read-only verification
and queue classification are in `release-0.9.1-readiness.json`. The original
partial outcome is preserved. Source logic moves only its provably completed
direct continuation into History; foreign/uncertain/incomplete cases stay
pending. This is not native crash or lost-response certification.
