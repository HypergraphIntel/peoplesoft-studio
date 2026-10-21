# Approve and apply

Implemented in 0.9.7 development after the developer selected the primary-action
placement on October 20, 2026. See [design decision 3](DESIGN_DECISIONS.md#3-primary-approve-and-apply-action).

## Developer flow

1. Approve the implementation approach separately when a proposal has one.
2. Stage and validate the concrete definitions. Inspect the object list,
   dependencies, exact before/after snapshots and semantic differences.
3. Select **Approve and apply** to approve and apply the displayed eligible
   objects. The page shows how many objects are included and how many rejected
   or dependency-blocked objects are excluded. Deletion still requires the
   separate destructive-operation checkbox.

**Approve only — all eligible** remains under **More actions**. Individual
**Approve object** / **Reject object** controls remain beside the selected
object. Once every eligible object is approved, **Apply approved changes** is
the primary action. A partially approved proposal also offers **Apply already
approved objects only** under **More actions**. No extra modal confirmation is
added by the combined action.

## Exact approval and application

`ReviewService.approveAndApply` acquires one exclusive store lock covering
approval and application. It requires the rendered set revision, a digest of
the complete durable review state, and the exact displayed eligible object IDs.
The digest includes object review/validation state and authorization stamps,
so an intervening approval, rejection or revalidation can invalidate a page
even when the proposal revision did not change. A forged subset, duplicate ID,
newly added object or rejected object cannot be silently included. Rejected
prerequisites exclude their transitive dependents.

The operation persists the existing per-object `APPROVED` decisions and hashes,
records `APPROVE_AND_APPLY_REQUESTED`, and calls the same application path used
by the separate apply action. Environment identity, native baseline tokens,
approved after-images, dependency closure, validation, writability, Operator ID,
ownership/policy, dirty-editor checks and explicit destructive approval retain
their existing contracts. Ordinary apply now also checks the page revision and
rendered state inside the store lock when supplied by the UI.

Checkpoints, per-writer precommit checks, verified readback and application
journaling are unchanged. Duplicate apply clicks are suppressed in the rendered
script and workspace handler; the store lock/lifecycle also prevents a second
writer execution. Cancel still lets the running writer finish and stops later
objects. Failed/uncertain writes retain their normal conflicted/partial recovery
states; they never automatically replay. Durable approval before a process stop
does not authorize automatic restart application.

The UI still lists and opens every object and its native diff. The combined
action does not mean that approach approval approved the definitions. Reversals,
redo and remaining-work proposals require fresh review as before. This does not
introduce package-wide atomicity, new writer coverage or an MCP approval/apply
endpoint.

## Verification

October 20, 2026: `npm run verify` passed with 2,095 tests / one skipped,
compile/bundle, 108-command activation smoke and 17 editor fixture checks.
`npm run test:mcp-workflows` passed all 56 production HTTP/UI checks.

Service tests cover exact approval hashes/checkpoints/dependency order under one
lock, stale revisions, same-revision review changes, forged selections, rejected
dependency exclusions, separate approach approval, missing validation,
destructive approval, drift/validation/policy/identity/authorization refusal,
partial/uncertain outcomes, concurrent duplicate/revision attempts and
cancellation. Existing application, reversal, continuation and recovery tests
continue to run against the shared application path.

Production HTTP/UI fixtures stage SQL through MCP without persistence, render
the primary action and inspectable object differences, execute the actual
rendered click script, reject a same-revision stale page, exclude a rejected
object, suppress duplicate clicks, apply through the exact-key reviewed writer
guard and verify approval/checkpoint/journal/readback. A dirty editor blocks
application without a writer call; MCP still advertises no approval/apply tool.
These are fixture-backed checks, not a new live PeopleSoft approval trial.

The [rendered primary-action preview](../../tools/lab/results/change-review-approve-apply.png)
was visually checked in Chromium using the production page HTML and fixture
definitions with VS Code theme variables. It shows the combined primary action,
separate approach approval, eligible object count and inspectable object list.
It is a page-render preview, not an installed-workbench/native-save capture.
The [browser click report](../../tools/lab/results/change-review-approve-apply-browser.json)
also verifies the real DOM click payload, duplicate-click suppression, immediate
busy/disabled state, and continued access to cancellation and object inspection.
Its VS Code message bridge captures fixture messages without writing PeopleSoft.

Run:

```sh
npm run verify
npm run test:mcp-workflows
```

Set `PSFT_REVIEW_PREVIEW=1` for the MCP workflow command to retain the production
fixture page at `/tmp/psft-review-approve-apply.html` for rendering inspection.
