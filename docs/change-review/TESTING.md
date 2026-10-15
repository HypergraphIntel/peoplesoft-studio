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

`src/test/changeReview.test.ts` drives the real model/store/service with an
explicit fixture adapter; it is not database certification.
`src/test/reviewSemanticDiff.test.ts` exercises model-level Page/AE/Record
identity/order rules. `tools/lab/mcp-workflow-fixture-e2e.mts` starts the actual
HTTP MCP server, staging compatibility wrapper, native adapter wiring and real
review UI handlers over fixture database methods. It exercises the real existing
PeopleCode compiler and delivered-object guard; persistence remains a fixture.
No tests approve a live database write on the developer's behalf.

## Required scenario matrix

| Proposal scenario | Current evidence | Remaining controlled-lab evidence |
|---|---|---|
| 1. Single modified object | Service update/reversal tests; delivered SQL HTTP/UI fixture | Actual reviewed update/readback |
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
| 15. Redo after undo | Reviewed reverse/forward service tests; UI prepares event-code redo | Native reviewed undo/redo readback |
| 16. Interrupted recovery | Corruption, dead/unknown lock, validation restart, uncertain-result tests | Installed crash/recovery paths |
| 17. Multiple environments | Environment identity drift blocks writes; history filters | Two actual environments and no cross-target restoration |
| 18. Manual saves in history | Service manual-history tests; explicit provider hooks for six adapter families | Native text/custom editor saves and failures |
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
