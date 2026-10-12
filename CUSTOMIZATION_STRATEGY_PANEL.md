# PeopleSoft Studio — Customization Strategy Panel

VS Code UI/UX + MCP Architecture Specification

I recommend implementing the Customization Strategy Panel as a context-aware companion to the existing PeopleSoft Studio editors, rather than building a separate customization application.

When a developer opens a delivered Page, Component, Record, PeopleCode program, or Application Engine, the panel should automatically identify that object and expose its configuration alternatives.

The panel needs to accomplish five things:

1. Identify whether the object is delivered, custom, third-party, or already customized.
2. Discover the configuration mechanisms actually available in the connected PeopleSoft environment.
3. Explain which approaches could fulfill a developer's requirement without modifying delivered definitions.
4. Build an executable implementation plan with dependencies and validation.
5. Enforce approvals and restrictions before allowing delivered-object modifications.

The central principle is the Agent must distinguish what PeopleSoft theoretically supports from what has actually been verified in the target environment.

## 1. Recommended VS Code layout

Use two coordinated surfaces:

- Customization Strategy sidebar: Compact object intelligence, configuration availability, impact warnings and quick actions.
- Customization Plan editor: Full-width workspace for requirements, proposed changes, plan validation, approvals and execution results.

This follows VS Code's recommendation to use native Tree Views for structured navigation and custom Webviews only when richer interfaces are necessary.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://code.visualstudio.com\&sz=32)

Visual Studio Code Extension API

+1



PeopleSoft Studio — HCDEV

Illustrative UI

&#x20;PeopleSoft Explorer

HCDEV · HCM 9.2

&#x20;Components

&#x20;JOB_DATA

&#x20;Pages

&#x20;Records

&#x20;App Engines

&#x20;Customization

Delivered object

Configuration first

Verification pending

JOB_DATA — Designer

Component Structure

JOB_DATA

├─ Pages

├─ Component Records

├─ Field Events

└─ PeopleCode

Existing Page / Component editor

Strategy

JOB_DATA

Delivered

Preferred: Configuration

Capabilities

&#x20;Event Mapping

&#x20;Drop Zones

&#x20;Page Configurator

No discovery results yet

Proposed three-column arrangement. The strategy companion can live in the Secondary Sidebar, while complex plans open as regular editor tabs.

The current PeopleSoft Studio editor should remain the primary editing surface. The new panel augments it rather than competing with it.

## 2. Compact sidebar design

The compact panel should have four collapsible sections: Object Identity, Configuration Capabilities, Dependencies, and Actions.

Below is an interactive layout prototype. Values are illustrative, not live HCDEV discovery results.

CUSTOMIZATION STRATEGY

Active definitionJOB_DATA · Component

Identity unverified

HCDEV

Preferred Strategy

Configuration First

Policy preference, not a determination that a configuration solution is feasible.

Configuration Capabilities

Event Mapping

Component events and custom application classes

Unknown

Drop Zones

Configurable page insertion points

Unknown

Page and Field Configurator

Supported component field behavior

Unknown

Dependencies & Upgrade Impact Preview discovery stateOpen Plan Designer Prototype only. In the actual extension, discovery invokes the local PeopleSoft Studio services/MCP backend.

### How it should react to editor activity

When the developer changes the selected connection or active object, the strategy panel should update its context.

For example, opening `ZZ_PU_OFFER` should not trigger a workflow that assumes the page is Oracle-delivered. The engine first classifies its origin, then determines whether a proposed change would affect delivered definitions, custom definitions, or configuration relationships.

The panel should support pinning an object so developers can inspect related definitions without losing the current customization analysis.

## 3. Capability states: verified versus possible

This is the most important part of the UX.

I would deliberately avoid showing a green check merely because Oracle documentation says a mechanism exists.

Use a small, explicit evidence-state model.

Verified available

A specific eligible capability has been confirmed using current target-environment metadata.

Potential — requires discovery

The framework is documented for this type of requirement, but object-specific eligibility is not established.

Verified unavailable

The target has been examined and a required condition is absent, or the operation is unsupported.

Blocked or indeterminate

Permissions, incomplete metadata, connection failures or other blockers prevented a reliable determination.

Every capability needs an evidence details view showing:

- The target connection, application/PeopleTools version and inspected object revision.
- What was inspected, such as a registered content reference, specific Drop Zone placeholder, or existing mapping.
- The exact eligibility rule and supporting metadata.
- The time of the most recent inspection.
- Any unverified prerequisites or known restrictions.

A verified Drop Zone means an eligible insertion point exists. It does not mean that a proposed custom subpage, component buffer structure or data persistence implementation has been validated.

The UI therefore needs two independent axes:

| Axis                     | States                                                                      |
| ------------------------ | --------------------------------------------------------------------------- |
| Capability discovery     | Unknown, Potential, Verified Available, Verified Unavailable, Indeterminate |
| Implementation lifecycle | Not Planned, Draft, Validated, Approved, Applied, Tested, Failed            |

This prevents the Agent from confusing an available PeopleSoft extension mechanism with a successfully implemented business change.

Oracle confirms that configurable Drop Zones substitute custom subpages for configured placeholders at runtime, while Event Mapping has registered-component/content-reference prerequisites. These are exactly the kinds of facts discovery must prove rather than assume.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.oracle.com\&sz=32)

Oracle Docs

+1



## 4. Full Customization Plan editor

When the user selects Open Plan Designer, PeopleSoft Studio should open a tab such as:

`Customization Plan: JOB_DATA`

It should use a five-stage workflow with persistent state, similar in discipline to an IDE refactoring preview.

## Customization Plan

JOB_DATA · HCDEV · Configuration First

Draft

Requirement

Discover

Strategy

Validate

Approval

2\. Discover environment capabilities

Drop Zone eligibility — unknown

Event Mapping eligibility — unknown

Page Configurator eligibility — unknown

Actual results must come from PeopleSoft environment inspection. This illustration does not establish any capability.

BackNext&#x20;

Conceptual, navigable prototype. Actual lifecycle transitions must be driven by server-verified results, not the tab selection.

### Strategy comparisons

Once discovery is complete, the planner should provide a side-by-side technical comparison:

| Criterion                           | Configuration-based extension                    | Direct modification                 |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------- |
| Delivered definitions changed       | Normally no                                      | Yes                                 |
| Upgrade retrofit                    | Generally reduced                                | Greater potential                   |
| Dependency testing                  | Required                                         | Required                            |
| Configuration framework eligibility | Must be demonstrated                             | Not applicable                      |
| Approval                            | Normal write policy                              | Additional delivered-object policy  |
| Execution                           | Configuration adapters and custom-object writers | Existing definition writers         |
| Fallback                            | Other valid configuration mechanism              | Explicitly permitted delivered edit |

An important enhancement: allow plans to contain multiple mechanisms.

A requirement might need a Drop Zone to expose a new field, a custom record to persist it, and Event Mapping to validate it. These are not competing strategies; they are parts of one implementation.

### Implementation dependency graph

Example: Configuration-based employee classification

Illustrative dependency order. The real planner should create nodes from validated object and configuration relationships and explicitly identify unresolved prerequisites.

Plans should be saved as versioned, machine-readable artifacts. That lets an Agent generate a plan, a developer review it, and the MCP later execute precisely the same approved plan.

## 5. Approval UI

I recommend a two-level approval model.

Level 1 — Normal development operations: Creating or modifying custom objects under the organization's policy.

Level 2 — Delivered-object modifications: Require explicit authorization when policy is `REQUIRE_APPROVAL`, even if the Agent considers the change trivial.

A delivered-object modification approval dialog should contain:

Delivered Object Modification

Illustrative approval dialog

Environment

HCDEV

Object

JOB_DATA

Change type

Direct definition edit

Authorization

Required

Reason configuration was rejected

Must be populated with evidence from the selected implementation plan. An unverified alternative is not sufficient grounds to declare configuration impossible.

Proposed object changes

Definition diff required before authorization.

Acknowledgments

I have reviewed the exact proposed changes.

I have reviewed the upgrade and retrofit implications.

Reset Copy Review Record

No approval is actually issued from this prototype. In the extension, server authorization and connection permissions are mandatory.

The genuine approval flow needs server-side controls. An Agent should not be able to approve its own modification merely by calling an MCP tool with `approved: true`.

An approval should refer to a cryptographic digest of the plan, the target revision, the effective policy and the connection identity. It should expire and be invalidated by any relevant change.

If the Agent discovers that a delivered object must be modified after approval was granted for custom objects only, the plan must be reconsidered.

## 6. MCP integration design

The VS Code panel and external Agents must share the same backend services, rather than each independently implementing customization logic.

PeopleSoft Studio Core Services

Policy · Discovery · Planning · Validation · Approval

VS Code Extension

Sidebar, editors, commands

MCP Server

Agent tools and resources

Existing PeopleSoft Definition Services

Metadata readers · Writers · Configuration adapters · Connection management

The sidebar should call the shared application layer directly where possible. The MCP Server should expose that same layer to AI Agents through the MCP protocol.

This avoids needless MCP round trips for ordinary local UI operations, while preserving identical policy enforcement.

### Example MCP discovery response

```
{
  "context": {
    "connectionId": "HCDEV",
    "objectType": "COMPONENT",
    "objectName": "JOB_DATA"
  },
  "ownership": {
    "status": "DELIVERED",
    "verified": true,
    "evidence": ["baseline-match"]
  },
  "capabilities": [
    {
      "framework": "DROP_ZONE",
      "state": "POTENTIAL",
      "evidence": [],
      "missingChecks": [
        "drop-zone-placeholder-discovery",
        "configuration-eligibility"
      ]
    },
    {
      "framework": "EVENT_MAPPING",
      "state": "UNKNOWN",
      "evidence": [],
      "missingChecks": [
        "content-reference-registration",
        "event-compatibility"
      ]
    }
  ],
  "directModification": {
    "policy": "REQUIRE_APPROVAL"
  }
}
```

This example illustrates the schema, not actual HCDEV results.

### Core contracts

I recommend separating the following TypeScript interfaces:

```
interface CustomizationContext {
  connectionId: string;
  objectType: string;
  objectName: string;
  objectRevision?: string;
}

type DiscoveryState =
  | "UNKNOWN"
  | "POTENTIAL"
  | "VERIFIED_AVAILABLE"
  | "VERIFIED_UNAVAILABLE"
  | "INDETERMINATE";

interface CapabilityEvidence {
  source: string;
  ruleId: string;
  observedValue?: unknown;
  inspectedAt: string;
  objectRevision?: string;
}

interface FrameworkCapability {
  framework: string;
  state: DiscoveryState;
  evidence: CapabilityEvidence[];
  missingChecks: string[];
  blockers: string[];
}

interface CustomizationPlan {
  id: string;
  revision: number;
  context: CustomizationContext;
  requirement: string;
  strategy: string;
  status:
    | "DRAFT"
    | "VALIDATED"
    | "APPROVED"
    | "APPLIED"
    | "TESTED"
    | "FAILED";
  operations: PlannedOperation[];
  validationResults: ValidationResult[];
  planDigest?: string;
}
```

`PlannedOperation` and `ValidationResult` should be modeled as discriminated unions in the actual codebase, with framework-specific payload validation.

### Event handling

Use event-driven refresh rather than repeatedly querying the PeopleSoft database.

| Event                           | UI response                                               |
| ------------------------------- | --------------------------------------------------------- |
| Active editor changes           | Update object identity; reuse valid cached discovery      |
| Connection changes              | Invalidate connection-scoped discovery and approval state |
| Object saved                    | Mark impacted capability checks stale                     |
| Configuration metadata changes  | Invalidate dependent plans and discovery                  |
| Agent produces a plan           | Open or update Plan editor                                |
| Agent requests restricted write | Surface approval request                                  |
| Write completes                 | Refresh dependencies and display execution results        |

Cache only immutable or revision-bound findings. A capability that was verified on an earlier revision must not continue to display as currently verified once its assumptions are invalidated.

## 7. Integration with existing PeopleSoft Studio features

The new functionality should build upon the editors already developed.

| Existing functionality      | New customization integration                                |
| --------------------------- | ------------------------------------------------------------ |
| Page Designer               | Discover Drop Zones and preview custom-subpage placements    |
| Record/Field Designer       | Suggest names, verify ownership, assess storage dependencies |
| PeopleCode editor           | Recommend Event Mapping when appropriate                     |
| Application Engine Designer | Identify eligible AE plug-in extension points                |
| Connection selector         | Load environment-specific naming, policy and capabilities    |
| Read-only mode              | Permit discovery/planning but block mutation                 |
| MCP object writers          | Enforce customization policies uniformly                     |

The Page Designer has a particularly interesting opportunity: show Drop Zone overlays directly on the canvas when they are verified in the underlying page definition.

A developer could select a verified insertion point, invoke "Create Custom Subpage," and have PeopleSoft Studio generate a candidate plan using the established Page Designer functionality.

That is much better than building an entirely separate page designer inside the customization panel.

## 8. Implementation handoff for the coding Agent

# PeopleSoft Studio — Implement Customization Strategy UI

## Objective

Design and implement a VS Code-native Customization Strategy interface, integrated with the existing PeopleSoft Studio editors and MCP Server.

This extends our Customization Intelligence Engine initiative.

The objective is to make PeopleSoft Studio aware of the difference between directly customizing delivered PeopleSoft definitions and configuring delivered applications through custom objects and supported frameworks.

The user must be able to discover, compare, plan, validate and authorize customization strategies without leaving VS Code.

## Architecture Requirements

Before implementation, inspect the repository and map:

- Existing VS Code view containers and Tree Views
- Existing Webview and custom editor infrastructure
- Existing page, component, record and AE editors
- Connection selection and status bar infrastructure
- MCP tool registration and service architecture
- Existing read-only and write authorization enforcement
- Current customization intelligence capabilities, if any

Reuse working infrastructure.

Do not duplicate existing PeopleSoft object services.

Implement shared application services that can be consumed by both the VS Code UI and the MCP Server.

## A. Sidebar Panel

Create a view named **Customization Strategy**.

Prefer the existing PeopleSoft Studio view container and support placement in the Secondary Sidebar.

Sections:

1. Object Identity
2. Preferred Customization Strategy
3. Available Configuration Capabilities
4. Dependencies and Upgrade Impact
5. Actions

The view must automatically follow the active PeopleSoft object editor and selected connection.

Allow the developer to pin the current object.

Do not assume all objects lacking an organization prefix are delivered.

Display object ownership, modification status and provenance confidence.

## B. Capability Discovery

Display the following states:

- UNKNOWN
- POTENTIAL
- VERIFIED_AVAILABLE
- VERIFIED_UNAVAILABLE
- INDETERMINATE

These states must be evidence-driven.

POTENTIAL means a framework may support the requirement according to documented rules, but target eligibility has not been established.

VERIFIED_AVAILABLE requires actual target-environment evidence of eligibility.

VERIFIED_UNAVAILABLE requires affirmative evidence that a prerequisite is absent or an operation is unsupported.

INDETERMINATE applies when permissions, connectivity or incomplete inspection prevent a reliable determination.

Never display a capability as available solely because Oracle documents the framework.

Show evidence details, including inspected metadata, rule identifiers, target environment, revision, timestamps and unresolved prerequisites.

Maintain a separate plan lifecycle so capability discovery cannot be mistaken for implementation success.

## C. Plan Editor

Create a full editor tab supporting:

1. Requirement
2. Discovery
3. Strategy
4. Validation
5. Approval and execution

The editor must present configuration-first alternatives and explain the feasibility of each.

Support multi-framework plans.

For example, a single change may require:

- A custom record and field
- A custom subpage
- An existing Drop Zone configuration
- Event Mapping for business validation

The planner must model these as related operations with explicit dependencies.

Display object additions, modifications, configuration registrations and affected delivered definitions.

Provide a dependency graph or expandable execution tree.

Support previewing exact planned definition changes before applying them.

The plan should have a persistent ID, revision and machine-readable representation.

## D. Approval UX

Direct modification of delivered objects must follow the configured policy:

- BLOCK
- REQUIRE_APPROVAL
- ALLOW_WITH_AUDIT

For approval-required operations, display:

- Environment and connection
- Target objects
- Exact proposed changes
- Alternative configuration strategies considered
- Reason direct customization is necessary
- Upgrade and retrofit implications
- Validation outcome
- Approval scope

An Agent cannot authorize its own restricted write.

Approval must be server-issued, scoped to the specific plan, target object revisions and effective policy.

Any relevant plan, object, connection or policy change must invalidate a stale approval.

The UI must clearly separate review acknowledgments from genuine authorization.

## E. MCP Integration

Ensure UI and MCP access the same core services.

Expose or reuse operations for:

- Object classification
- Capability discovery
- Customization planning
- Plan validation
- Approval requests
- Authorized execution
- Upgrade impact analysis
- Customization inventory

Where appropriate, the UI should use the shared services directly rather than invoking its own MCP endpoint.

The MCP must be capable of returning structured plans that the UI can open and review.

MCP write tools must enforce policy independently of the UI.

## F. Existing Editor Integration

Page Designer:

- Show verified Drop Zone insertion points.
- Offer planning of compatible custom subpages.
- Do not assume all pages have Drop Zones.

PeopleCode:

- Discover applicable Event Mapping possibilities.
- Explain registration and event compatibility constraints.

Application Engine:

- Discover eligible plug-in extension points.
- Do not confuse AE Action Plug-ins with arbitrary insertion of new delivered steps or sections.

Record/Field Designer:

- Apply configurable custom naming conventions.
- Assess storage and component buffer dependencies.

Connection Management:

- Refresh policy and capabilities when connections change.
- Respect current read-only state.

## G. State and Performance

Use event-driven updates.

Do not continually scan the full PeopleSoft database on editor selection.

Provide targeted, lazy capability discovery.

Cache results using connection, object identity, revision and relevant environment version.

Invalidate findings when dependent definitions or configuration metadata change.

Support cancellation of discovery and planning tasks.

Handle disconnected environments without fabricating results.

## H. Security

Use VS Code APIs appropriately.

Keep privileged PeopleSoft database and write operations in the extension/backend, not in Webview JavaScript.

Use safe message passing and appropriate Webview content security policies.

Do not expose database credentials or approval tokens to untrusted UI content.

Preserve all existing read-only protections.

## I. Tests

Implement automated tests for:

1. Editor-driven context changes
2. Connection changes
3. Unknown object ownership
4. Potential versus verified capability distinctions
5. Invalidated discovery evidence
6. Missing Drop Zones
7. Ineligible Event Mapping
8. Multi-framework dependency plans
9. Plan validation failures
10. Restricted delivered-object writes
11. Stale approval rejection
12. Agent-generated plan rendering
13. Read-only behavior
14. Existing editor regressions

Mock discovery and plan data may be used for UI tests, but must not be displayed as real environment findings.

## J. Implementation Order

Phase 1: Inspect architecture and document the integration points.

Phase 2: Implement panel layout, object context and evidence-state model.

Phase 3: Connect read-only classification and capability discovery.

Phase 4: Implement the full Plan editor and dependency visualization.

Phase 5: Connect validation, policy and approval workflows.

Phase 6: Integrate supported configuration adapters and existing object writers.

Phase 7: Test the end-to-end workflow against available PeopleSoft lab environments.

Produce small, reviewable commits and preserve existing working functionality.

Do not invent Oracle metadata definitions, supported events or runtime execution semantics.

Document any unverified PeopleSoft mechanisms as limitations rather than claiming completeness.

## Definition of Done

A developer can open a PeopleSoft definition and immediately determine:

1. What kind of object this is and where it originated.
2. Whether direct modification is permitted.
3. Which configuration alternatives are documented.
4. Which alternatives have been verified for this exact target.
5. What custom objects and configuration operations are necessary.
6. What the MCP Agent intends to change.
7. Whether the plan is valid and authorized.
8. What was actually applied and tested.

The Agent and the VS Code interface must share the same evidence and policy model.

Do not describe a capability as implemented until its actual functionality and integration tests pass.

## Recommended delivery sequence

Milestone 1 — Context and evidence

Build the sidebar, connect it to active-object selection and implement the five evidence states. Everything remains read-only.

Milestone 2 — Intelligent planning

Add the full Plan editor, ranked alternatives, combined-framework strategies, dependency tracking and validation.

Milestone 3 — Controlled execution

Add scoped approvals, connection-safe execution, adapter integration, revision checking and verification reporting.

The architectural choice I consider most important: customization intelligence should be a first-class PeopleSoft Studio service, not logic embedded in the sidebar or a collection of extra MCP prompt instructions. That ensures an Agent using MCP, a developer using the Page Designer, and a developer invoking a command directly all receive the same recommendations and operate under the same rules.

That is how the extension can eventually become an upgrade-conscious PeopleSoft development platform rather than only an Application Designer replacement.