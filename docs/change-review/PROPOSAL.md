# PeopleSoft Studio — MCP Change Review, Transaction Management, and Version History

## Mission

We need to fundamentally redesign the workflow used by PeopleSoft Studio when an AI agent, through MCP, creates or modifies PeopleSoft objects.

The current workflow relies on repeated pop-up dialogs requesting approval for individual object changes. This becomes disruptive when an agent is building or modifying multiple PeopleSoft definitions.

**Replace this interaction model with a persistent, VS Code-native Change Review workspace that supports before/after comparisons, object-aware differences, change sets, approval management, transactional application, history, undo, and redo.**

This is a major architectural improvement, not a superficial UI modification.

The solution must integrate with the existing PeopleSoft Studio extension, MCP server, object editors, persistence mechanisms, and connection management.

Do not assume the existing codebase supports a capability without inspecting and verifying it.

---

# Phase 1 — Repository and Architecture Investigation

Before implementing anything, inspect the entire relevant codebase.

Find and document:

1. Every MCP tool capable of creating, updating, or deleting PeopleSoft objects.
2. Existing approval dialogs, confirmation pop-ups, notifications, and mutation authorization workflows.
3. Existing object serialization, decoding, encoding, and database-writing mechanisms.
4. Existing object editors, including Page Designer, Record Designer, PeopleCode editor, and Application Engine Designer.
5. Existing snapshot, backup, revision, transaction, rollback, or history mechanisms.
6. Existing settings, connection selection, permissions, and read-only enforcement.
7. Existing extension-to-MCP communication and execution lifecycles.
8. Any existing diff viewers or VS Code virtual document providers.
9. How object dependencies and creation sequences are currently handled.
10. Existing unit tests, integration tests, and validation harnesses.

Produce a factual inventory separating:

- Already implemented and verified.
- Partially implemented.
- Not implemented.
- Unverified or requiring research.

Do not duplicate working functionality.

Preserve backward compatibility where practical.

# Phase 2 — Introduce the Change Set Architecture

The fundamental unit of change should be a **Change Set**.

A Change Set represents one logical development operation, potentially involving numerous PeopleSoft objects.

Example:

User request: "Add an employee certification section to the Employee Details page."

The agent may need to:

- Create a new custom record.
- Add fields.
- Update a page.
- Configure a component.
- Create supporting PeopleCode.
- Configure Event Mapping, Page and Field Configurator, or Drop Zones where appropriate.

These should not generate five separate approval pop-ups.

Instead, all proposed operations should belong to one Change Set.

Implement a durable Change Set model containing:

- Unique Change Set ID.
- Human-readable title and description.
- Creation timestamp.
- Source of change: AI/MCP or manual editor.
- Agent execution or session identifier, where available.
- PeopleSoft connection and environment identity.
- Object identifiers and types.
- Before snapshots.
- Proposed after snapshots.
- Semantic change descriptions.
- Dependencies between objects.
- Validation results.
- Approval decisions.
- Application results.
- Current lifecycle status.
- Reversal and recovery metadata.

Suggested lifecycle:

DRAFT → VALIDATING → READY_FOR_REVIEW → APPROVED → APPLYING → APPLIED

Additional states:

REJECTED, CANCELLED, CONFLICTED, FAILED, PARTIALLY_APPLIED, REVERTED.

Implement explicit state transition rules.

A rejected object must not accidentally be applied.

A cancelled or failed operation must not silently continue.

Change Sets should persist across VS Code restarts.

# Phase 3 — Separate Planning, Staging, and Application

This is the most important architectural requirement.

An MCP mutation request should not automatically write its changes to PeopleSoft.

Introduce a three-stage execution model.

## Stage A — Plan

The MCP/agent determines which PeopleSoft objects need to be created, changed, or removed.

The plan identifies dependencies and preferred customization strategy.

The agent must consider the existing preference for configuration-based customization, including:

- Custom objects.
- Event Mapping.
- Page and Field Configurator.
- Drop Zones.

Direct modification of delivered objects must follow the existing customization policy and any required settings or approval gates.

The organization's configurable custom-object prefix must be respected.

## Stage B — Stage

The MCP creates proposed object definitions without committing them to the target PeopleSoft database.

Capture the existing object definition and construct the proposed definition.

Store both in the Change Set.

Compute their semantic differences.

For new objects, identify them as CREATE operations.

For modified objects, identify them as UPDATE operations.

For deleted objects, identify them as DELETE operations.

Staging must not require the object to already exist in the database.

Where possible, reuse the extension's existing serialization and object-writing logic rather than implementing a separate incompatible writer.

## Stage C — Apply

Only after approval should the Change Set be executed against PeopleSoft.

The extension must:

1. Verify the current connection and target environment.
2. Verify authorization and read-only constraints.
3. Re-read the relevant database objects.
4. Compare their current definitions against the staged baseline snapshots.
5. Detect external modifications made after staging.
6. Block or explicitly resolve conflicts.
7. Revalidate objects and dependencies.
8. Determine the correct application order.
9. Create a recovery checkpoint.
10. Execute approved mutations.
11. Record exactly which operations succeeded.
12. Verify persisted results.
13. Report any failures or partial application.
14. Preserve sufficient information for recovery.

Do not assume that a multi-object PeopleSoft modification is automatically an atomic transaction.

Investigate actual writer behavior, commit boundaries, and database transaction guarantees.

Where full atomicity is unavailable, provide a dependency-aware execution and recovery model.

**Never display a Change Set as successfully applied unless persistence and post-write verification succeeded.**

# Phase 4 — Build a Persistent Change Review Workspace

Create a dedicated PeopleSoft Studio Change Review interface within VS Code.

Use native VS Code patterns where appropriate:

- Webview panels or Webview Views.
- Tree Views.
- Commands.
- Context menus.
- Status indicators.
- Diff editors.
- Virtual documents.

The default interaction should be a normal, persistent editor-style page rather than a modal dialog.

Opening Change Review should not repeatedly steal keyboard focus from the developer.

## Proposed layout

### Left: Change Set Explorer

Display Change Sets grouped by lifecycle status.

For the selected Change Set, display a navigable object tree.

Example:

Change Set #1042 — Employee Details Enhancement

Modified:
- OU_EMPLOYEE_DTL — Page
- OU_EMPLOYEE_REC — Record
- OU_EMPLOYEE_CMP — Component

Created:
- OU_EMP_AUDIT — Record
- OU_EMP_UTIL — Application Class

Each entry should include:

- Object type.
- Operation: Create / Update / Delete.
- Review status.
- Validation status.
- Application status.
- Warning or conflict indicators.

### Center: Object Comparison

Show BEFORE and AFTER views.

The views should support synchronized navigation where appropriate.

Highlight:

- Added elements.
- Removed elements.
- Modified elements.
- Moved or reordered elements.
- Property changes.
- Relationship changes.
- Changes with operational implications.

Use familiar comparison conventions, including additions, deletions, and modifications, while preserving accessibility and not relying exclusively on color.

### Right or Bottom: Change Details

Display:

- Description of the proposed modification.
- Object properties affected.
- Reason for the change.
- Dependencies.
- Validation findings.
- Compatibility concerns.
- Delivered-object customization warnings.
- Approval and rejection controls.

Allow the developer to expand into precise technical details.

### Footer or Toolbar: Change Set Actions

Provide:

- Approve Object.
- Reject Object.
- Approve All Eligible.
- Reject All.
- Apply Approved Changes.
- Refresh and Revalidate.
- Export Change Report.
- View History.

Actions should reflect actual state.

Do not render enabled controls for unsupported operations.

# Phase 5 — Object-Aware Semantic Diff Engine

A generic text comparison is insufficient for PeopleSoft.

Implement a semantic diff abstraction that understands the structure of supported object types.

Create an extensible interface, conceptually:

ObjectDiffProvider

Responsibilities:

- Normalize an object definition.
- Match semantic identities across revisions.
- Compare definitions.
- Identify additions, deletions, modifications, and moves.
- Produce structured diff records.
- Generate human-readable explanations.
- Supply data to object-specific comparison viewers.

Do not compare unstable database identifiers or raw storage ordering as though they necessarily represented functional changes.

Where stable semantic identity is unavailable, mark matches as ambiguous rather than inventing certainty.

## PeopleCode

Support:

- Side-by-side source comparison.
- Line-level and word-level differences.
- Method and function changes.
- Event or application-class context.
- Optional syntax-aware comparison.

Do not represent decompiled output as authoritative source unless fidelity is verified.

## Pages

Use the existing Page Designer infrastructure wherever possible.

Compare:

- Controls.
- Control types.
- Field bindings.
- Record associations.
- Positions and dimensions.
- Scroll levels and occurs levels.
- Grid configuration.
- Group boxes.
- Subpages.
- Secondary pages and relationships.
- Labels.
- Display and interaction properties.
- Hierarchical placement.
- Relevant properties exposed by Application Designer.

Provide a semantic control tree and, where feasible, a visual before/after Page Designer view.

New controls should be highlighted.

Deleted controls should remain visible in the BEFORE view.

Moved controls should be identified as moved rather than incorrectly reported as a delete plus an addition.

Preserve the existing editor's serialization and control mapping semantics.

## Records and Fields

Compare:

- Record type.
- Field additions and removals.
- Field order.
- Field definitions.
- Field properties.
- Keys and search keys.
- Required/edit characteristics.
- Defaults where applicable.
- SQL-related definitions and relationships.
- Relevant database structure implications.

Distinguish metadata changes from changes requiring physical database alterations.

## Application Engines

Compare:

- Sections.
- Steps.
- Actions.
- Action types.
- Execution order.
- SQL definitions.
- PeopleCode.
- State record relationships.
- Restart and commit settings.
- Temp table settings.
- Program properties.

Reuse existing Application Engine Designer components and data models when verified.

Identify meaningful execution-order changes.

## Components and Other Objects

Develop comparison providers for all other supported object types.

Start with verified capabilities and expand iteratively.

Unsupported types must remain clearly labeled rather than displaying misleading comparisons.

## New Objects

Display:

NEW OBJECT — DOES NOT EXIST IN TARGET ENVIRONMENT.

Show the entire proposed definition as an addition.

Do not manufacture an artificial before version.

## Deleted Objects

Display:

DELETE OBJECT.

Show the full existing definition and the consequences or known dependencies.

Deletion should require a distinct destructive-operation gate.

# Phase 6 — Approval Workflow

Support approvals at two levels:

1. Individual object.
2. Entire Change Set.

A developer should be able to inspect every affected object before applying changes.

Approval should bind to an exact staged revision or content hash.

If the agent changes a proposed definition after approval, invalidate the affected approval and require re-review.

Rejecting one object must trigger dependency analysis.

For example, a page should not be applied if it references a newly proposed record that was rejected.

Implement dependency-aware eligibility checks.

Support clear workflows for:

- Approving all eligible objects.
- Rejecting individual objects.
- Returning selected objects to the agent for revision.
- Revalidating a revised Change Set.
- Applying an approved dependency-complete subset, when safe.
- Cancelling an entire Change Set.

The agent must not reinterpret approval for one revision as permission to apply a later revision.

# Phase 7 — Version History, Undo, and Redo

Implement durable change history as a core feature.

The history must record both AI-driven and manual edits performed through PeopleSoft Studio, where those edits use supported mutation pathways.

Each successful application should create a revision containing:

- Change Set ID.
- Object type and identifier.
- Connection/environment identity.
- Previous definition.
- Resulting definition.
- Timestamp.
- Originating operation.
- Validation result.
- Verified application result.
- Object content hashes.
- Relevant dependency metadata.

Create a dedicated **History** interface.

Developers should be able to:

- Browse Change Sets chronologically.
- Filter by object or environment.
- Open historical definitions.
- Compare any two retained revisions.
- Inspect who or what initiated a change.
- Revert a specific change.
- Undo a Change Set when supported.
- Redo a previously undone change.
- View conflicts before restoration.

## Undo

Undo must not blindly overwrite current PeopleSoft objects.

Before reversal:

1. Read the current live definition.
2. Verify it matches the expected post-change revision.
3. Detect modifications by other developers or tools.
4. Build a reverse Change Set.
5. Show the reverse operation in Change Review.
6. Require approval.
7. Apply through the normal validated pipeline.

Undo should be treated as a new, auditable operation.

Where independent changes can be safely preserved through a verified semantic merge, offer that option; otherwise block with a conflict.

## Redo

Redo should reconstruct the original forward change as a new proposed Change Set.

Revalidate against the live environment.

Do not assume the database remains unchanged since undo.

## Partial Changes

Handle partial application and partial rollback explicitly.

Never imply that an entire Change Set was reversed when only some objects were restored.

## History Storage

Investigate suitable storage options:

- Extension-managed persistent storage.
- Workspace-local history.
- An optional centralized history service.

Choose an abstraction that can support local storage initially and shared history later.

Do not depend solely on VS Code workspaceState or globalState for large revision payloads without evaluating size, durability, retention, and multi-workspace behavior.

Consider SQLite or another durable indexed storage mechanism with immutable snapshot blobs.

Ensure schema versioning, migration, retention management, and crash recovery.

History must be isolated by connection and target environment identity.

Do not store credentials or secrets inside snapshots.

Make snapshot integrity verifiable.

# Phase 8 — MCP Protocol and Tool Integration

Redesign the MCP mutation execution flow around the Change Set lifecycle.

Conceptual tool responsibilities include:

- create_change_set
- stage_object_change
- get_change_set
- list_change_sets
- validate_change_set
- get_object_diff
- revise_staged_change
- request_change_review
- apply_approved_change_set
- get_change_history
- prepare_revert
- prepare_redo

These are proposed capabilities, not assumed existing tools.

Inspect the current MCP architecture before selecting final tool names.

Prefer compatibility adapters rather than abruptly breaking existing tools.

Important distinctions:

- The MCP server proposes or stages changes.
- The developer reviews and authorizes changes in VS Code.
- The trusted extension-side workflow enforces authorization and application rules.
- Existing database writers execute only through approved and supported pathways.

Do not rely on model instructions alone to enforce authorization.

Authorization must be enforced at the actual mutation boundary.

A staging operation must never bypass permission checks by calling a lower-level writer directly.

If the MCP server operates out of process, investigate a durable, authenticated, session-aware mechanism for communicating Change Sets and review results to the extension.

Do not assume arbitrary MCP clients can display or control VS Code webviews.

Define what happens when the extension is unavailable, disconnected, or restarted.

Agents should receive structured statuses such as:

- REVIEW_REQUIRED
- REVIEW_PENDING
- APPROVED
- REJECTED
- CONFLICTED
- APPLIED
- FAILED

Prefer resumable status polling or supported event-driven notifications over keeping an MCP tool call blocked indefinitely.

The agent should be able to continue unrelated analysis while a Change Set awaits review, but never proceed with dependent mutations without authorization.

# Phase 9 — Integrate With the Customization Orchestrator

The Change Review system must integrate with the existing PeopleSoft Customization Orchestrator design.

The complete workflow should become:

USER REQUEST
→ OBJECT DISCOVERY
→ CUSTOMIZATION STRATEGY
→ PLAN
→ USER PLAN APPROVAL
→ STAGE DEFINITIONS
→ GENERATE DIFFS
→ VALIDATE
→ CHANGE REVIEW
→ USER CHANGE APPROVAL
→ APPLY
→ VERIFY
→ RECORD HISTORY

Keep planning approval and concrete mutation approval conceptually distinct.

The planning stage approves the intended implementation approach.

The Change Review stage approves the actual resulting object definitions.

The implementation should prefer configuration-based modifications of delivered objects when supported and appropriate.

Any direct delivered-object modification should be clearly identified and subject to the configured customization policy.

# Phase 10 — UX and VS Code Integration

The Change Review experience must feel like a native part of VS Code.

Add commands such as:

- PeopleSoft Studio: Open Change Review
- PeopleSoft Studio: Show Pending Changes
- PeopleSoft Studio: Open Change History
- PeopleSoft Studio: Compare Object Revisions
- PeopleSoft Studio: Apply Approved Change Set
- PeopleSoft Studio: Revert Change Set

Use native VS Code comparison editors where they provide a superior experience, especially for PeopleCode.

For structured objects, use semantic comparison views or existing object designers.

Provide concise status-bar or Activity Bar indicators for pending work.

Use notifications only for genuinely important lifecycle events or errors, not as repeated object-level approval dialogs.

A new Change Set should appear in the persistent review interface without interrupting typing.

Consider keyboard navigation, accessibility, large Change Sets, search, filtering, and responsive panel layouts.

The developer should be able to review a Change Set with dozens of objects efficiently.

# Phase 11 — Correctness, Safety, and Failure Recovery

Protect against:

- Stale snapshots.
- Concurrent modifications.
- Cross-environment application.
- Read-only connection bypass.
- Unauthorized delivered-object changes.
- Changes applied without approval.
- Approvals reused after revision.
- Broken dependencies.
- Incomplete object serialization.
- Unavailable write capabilities.
- Half-written definitions.
- VS Code shutdown during application.
- Duplicate requests or retries.
- Corrupt history storage.
- Unsafe undo.
- Invalid redo.
- Background agent modifications after review.
- Lost communication between MCP and VS Code.

Implement durable application journaling, explicit idempotency semantics, and restart recovery.

For errors, preserve the last known verified state and report exactly what is known and unknown.

Do not use an optimistic UI state to imply that a PeopleSoft database write succeeded.

Test with real, controlled lab objects before claiming production readiness.

# Phase 12 — Implementation Strategy

Do not attempt to implement the entire system in one unverified pass.

Deliver incrementally.

## Milestone 1 — Architecture and Inventory

- Repository investigation.
- Existing mutation path map.
- Architecture decision records.
- Data contracts.
- UX plan.
- Capability and risk matrix.
- Baseline tests.

## Milestone 2 — Change Set Foundation

- Durable Change Set model.
- Staging interface.
- Lifecycle state machine.
- Snapshot storage.
- Approval revision binding.
- Tests.

## Milestone 3 — Change Review Interface

- Persistent VS Code review page.
- Change Set Explorer.
- Before/after comparison.
- New/deleted object handling.
- Approve/reject workflow.
- Initial semantic diff providers.

## Milestone 4 — MCP Integration

- Route supported mutation tools through staging.
- Eliminate sequential approval pop-ups for migrated paths.
- Preserve compatibility where necessary.
- Enforce authorization at the write boundary.
- Integration tests.

## Milestone 5 — Safe Application

- Preflight validation.
- Drift and conflict detection.
- Dependency ordering.
- Durable execution journal.
- Verified write results.
- Failure and restart recovery.

## Milestone 6 — History and Reversal

- Immutable snapshots.
- History viewer.
- Historical comparisons.
- Undo through reverse Change Sets.
- Redo through forward Change Sets.
- Conflict handling.

## Milestone 7 — Full Object Coverage

Expand structured comparison and integrated editing to every verified, writable PeopleSoft object type.

Reuse Page Designer and Application Engine Designer infrastructure.

Avoid creating competing serialization implementations.

# Required Tests

Create unit tests, integration tests, and controlled lab tests for at least:

1. A single modified object.
2. A single new object.
3. A deleted object.
4. A five-object dependent Change Set.
5. A rejected dependency.
6. A revised object after approval.
7. A concurrent external database change.
8. A read-only connection.
9. A direct delivered-object modification blocked by policy.
10. A failed write midway through a Change Set.
11. A VS Code restart during review.
12. A restart during application.
13. A duplicate MCP retry.
14. Undo after an unrelated external modification.
15. Redo after a successful undo.
16. Recovery from an interrupted application.
17. Change history across multiple environments.
18. Manual editor changes flowing through the same history model.
19. Semantic diff fidelity for Page controls and Application Engine execution order.
20. A complete user-request-to-MCP-to-review-to-apply-to-history workflow.

# Required Documentation

Maintain documentation in the repository so subsequent agent sessions can resume accurately.

Include:

- Architecture overview.
- Change Set schema.
- State transition model.
- MCP tool contracts.
- Snapshot and diff contracts.
- Approval and authorization model.
- Execution and recovery model.
- Version history design.
- VS Code UI design.
- Supported object capability matrix.
- Testing strategy.
- Implementation progress and known limitations.

Clearly distinguish verified implementation from proposed future capabilities.

# Acceptance Criteria

The solution is successful when:

1. An AI agent can propose a multi-object PeopleSoft modification without triggering a sequence of approval pop-ups.
2. The developer sees one cohesive Change Set in a persistent VS Code interface.
3. Existing objects have accurate before/after comparisons.
4. New objects are clearly shown as newly created.
5. Structured PeopleSoft differences are understandable without manually inspecting database records.
6. Object and Change Set approval is supported.
7. Changed proposals invalidate stale approvals.
8. Dependency and authorization rules are enforced.
9. No proposed mutation is persisted before the appropriate approval.
10. Application results are verified against PeopleSoft.
11. The developer can browse durable history.
12. Previously applied changes can be safely reverted through reviewed operations.
13. Redo is supported through a newly validated forward operation.
14. Failed and partial operations remain recoverable and auditable.
15. Existing object designers and current functionality continue working.

# Execution Instructions

Begin by inspecting the repository and determining how its current MCP approval and mutation mechanisms actually operate.

First produce:

1. The current-state architecture.
2. The recommended target architecture.
3. The exact files/modules requiring changes.
4. The staged implementation plan.
5. Major technical risks and unresolved questions.

Store these findings in repository documentation.

Then proceed with implementation in small, verifiable milestones, starting with the Change Set model and a basic persistent Change Review interface.

Run appropriate tests after each milestone.

Do not claim a feature is complete merely because its UI exists.

Do not introduce mock implementations that are silently represented as functioning PeopleSoft persistence.

Make the ultimate objective a cohesive, reliable, professional development workflow comparable to the change-review experience of a modern IDE, but specifically adapted to PeopleSoft's object metadata, runtime behavior, and development lifecycle.