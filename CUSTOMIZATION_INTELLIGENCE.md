# PeopleSoft Studio — Customization Intelligence Architecture

> **Status.** Phase 1 -- ownership classification and the delivered-object
> policies at the write gate -- is built, and phase 2: Event Mapping
> discovered (2a) and written as the Configure Event Mapping page writes it
> (2b, through the MCP): see docs/CUSTOMIZATION.md. The Customization
> Strategy view and Plan editor exist as a preview. Naming prefixes are a list
> (bolt-on vendors carry their own; a vendor's prefix is the evidence for
> PARTNER). Next: Event Mapping in the Strategy view, then Drop Zones, Page
> and Field Configurator, AE plug-ins.

Proposed feature: Customization Intelligence Engine

I recommend building a Customization Intelligence Engine (CIE) into PeopleSoft Studio, shared by the VS Code extension and its MCP Server.

This should become one of the foundational capabilities of PeopleSoft Studio. The objective isn't simply to let the AI Agent create or modify PeopleSoft objects. It is to make the Agent understand how PeopleSoft applications are meant to be extended, when delivered objects should remain untouched, and how to implement the same business requirement using upgrade-friendly configuration techniques.

This intelligence should be enforced through the MCP tools themselves, rather than relying exclusively on instructions in an agent prompt.

## 1. Two customization tracks

Track A — Configuration

Preferred

Preserve the delivered definitions and extend behavior using custom objects and PeopleSoft configuration frameworks.

Oracle-delivered object

Configuration framework

ZZ\_ custom definitions

Generally lower upgrade retrofit burden

Track B — Direct Modification

Restricted

Modify delivered records, pages, components, PeopleCode, Application Engines, or other existing delivered definitions.

Oracle-delivered object

Direct definition changes

Upgrade impact assessment

Higher maintenance and retrofit risk

The critical design decision is that Track A is the default, but Track B remains a supported, explicitly authorized capability.

An Agent must never silently modify a delivered object merely because that is the easiest way to satisfy the request.

## 2. Configuration frameworks the MCP must understand

The Agent needs a capability catalog that connects business requirements to the actual PeopleSoft mechanisms.

| Mechanism                   | Appropriate use                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Page and Field Configurator | Modify supported field properties, visibility, labels, required behavior and related configuration without editing page definitions |
| Event Mapping               | Add application-class PeopleCode at supported component, page, record and field events                                              |
| Drop Zones                  | Insert custom subpages into existing delivered drop-zone locations                                                                  |
| Application Engine Plug-ins | Extend eligible delivered Application Engine processing using configured plug-in programs                                           |
| Configurable Search         | Configure supported search behavior without modifying delivered search definitions                                                  |
| Custom definitions          | Build new records, fields, pages, components, application packages and Application Engines with the organization's prefix           |

Oracle documents all these as mechanisms for reducing delivered-object customizations. Its lifecycle reports specifically cover Drop Zones, Event Mapping, AE plug-ins and Configurable Search.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.oracle.com\&sz=32)

Oracle Docs

+2



A few distinctions are especially important:

- Page and Field Configurator is not a general-purpose page designer. It can configure supported properties, but cannot freely restructure arbitrary page layouts.
- Event Mapping is not unrestricted PeopleCode injection. It has specific supported event levels and processing sequences. Its services use application classes implementing `PT_RCF:ServiceInterface`.
- Drop Zones require an available insertion point. Adding a new drop zone directly to an Oracle-delivered page is itself a delivered-object customization.
- Custom objects still have dependencies on delivered structures. Track A minimizes retrofit risk; it does not eliminate upgrade testing or compatibility review.

These constraints are explicitly described in Oracle's documentation.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.oracle.com\&sz=32)

Oracle Docs

+2



I would also design the capability catalog to be extensible. We should not hardcode the assumption that these are the only configuration frameworks PeopleSoft Studio will ever support.

## 3. VS Code settings and policy controls

I would introduce a dedicated `peopleSoftStudio.customization` settings namespace.

Proposed settings experience

Naming prefixes (a list)

The organization's prefix and each bolt-on vendor's, with who owns definitions named with it; configurable per workspace or connection; validate using the target PeopleTools object naming rules.

Default customization strategy

Configuration first (recommended)

Allow direct modification where policy permits

Delivered-object modification policy

Block all direct edits

Require explicit approval

Allow with audit record

Policy configuration scope

Workspace settings

Connection-specific settings

Require customization impact analysis before writes

Suggest organization prefix for new definitions

&#x20;Copy example settingsInteractive design mockup; these controls do not modify your extension.

### Important implementation details

The prefix should be a naming convention, not the sole method of determining object ownership.

For example, an object called `ZZ_SOMETHING` may be custom, but an object without `ZZ_` is not necessarily Oracle-delivered. PeopleSoft has partner-created, third-party and historical custom objects.

The classification engine should consider object metadata, object owner IDs, known delivered baselines, version history and project provenance. When provenance cannot be established, report `UNKNOWN`, not `DELIVERED`.

I also recommend that `requireApproval` be the default policy in nonproduction environments, and `block` the default in production. An MCP write operation must enforce the policy even if the Agent ignores the recommendation.

Production restrictions should be independent from delivered-object rules: a custom `ZZ_` object is not automatically safe to change in production.

## 4. MCP architecture

The MCP Server should have a shared planning and policy layer between the Agent and the existing PeopleSoft Studio object tools.

AI Agent / Codex

Business requirement in natural language

MCP Customization Intelligence Engine

Object Classification

Delivered / custom / unknown

Capability Discovery

Configuration options

Strategy Planner

Ranked alternatives

Policy Enforcement

Approval and audit

Configuration Tools

PFC, Event Mapping, Drop Zones, AE Plug-ins

Object Editors

Pages, records, components, PeopleCode, AE

PeopleSoft Environment

Validated changes, dependency tracking and audit history

There should be five core subsystems.

### A. Object Classification Service

Every object the Agent interacts with should have ownership and customization metadata.

Example:

```
{
  "objectType": "PAGE",
  "objectName": "JOB_DATA",
  "ownership": "DELIVERED",
  "ownershipConfidence": "HIGH",
  "classificationEvidence": [
    "Known delivered baseline"
  ],
  "modifiedFromBaseline": false,
  "directModificationAllowed": false,
  "preferredStrategy": "CONFIGURATION_FIRST"
}
```

The important classifications would be:

| Classification       | Meaning                                          |
| -------------------- | ------------------------------------------------ |
| `DELIVERED`          | Verified Oracle-delivered definition             |
| `CUSTOM`             | Verified organization-created definition         |
| `PARTNER`            | Third-party or partner-supplied definition       |
| `UNKNOWN`            | Insufficient provenance information              |
| `DELIVERED_MODIFIED` | Delivered definition with verified local changes |

`DELIVERED_MODIFIED` should retain its delivered ownership; it is not a new custom object.

To classify accurately, compare against a known delivered baseline for the application release/PUM image and PeopleTools version. The prefix and object owner ID are supporting signals, not definitive proof.

### B. Capability Discovery Service

Before recommending any approach, query the target environment.

For a component, the service should be capable of answering:

- Which pages, subpages, records and fields belong to this component?
- Is the component registered to a content reference?
- Which valid Drop Zones exist, and which are already configured?
- Is Page and Field Configurator supported and already configured?
- Which Event Mapping registrations already exist?
- What custom objects are already available for reuse?
- Are there conflicting configurations or execution-order dependencies?
- Which capabilities are supported by the target PeopleTools and application release?

Capability discovery must be environment-specific, not merely a reference to what is theoretically supported by PeopleTools.

For example, the Agent must not propose injecting a `ZZ_` subpage into a Drop Zone until it has verified an actual, usable Drop Zone in the target component.

### C. Strategy Planning Engine

This is where the real intelligence resides.

The Agent supplies a business requirement. The planning engine evaluates available alternatives and returns a structured implementation proposal.

Consider this example:

> Add an Acme Corp Employee Classification field to the delivered Job Data page, store the value, and apply custom validation.

The engine should propose:

Preferred: Configuration-based extension

Conditional on verified capabilities

1. Create or reuse a custom record/field for the classification value.
2. Create a custom `ZZ_` subpage containing the control.
3. Associate it with a verified delivered Drop Zone.
4. Implement supported validation using custom PeopleCode and/or Event Mapping.
5. Test persistence, security, events and component processing.

Fallback: Direct customization

Requires policy approval

Modify the delivered page or component only if the configuration approach cannot satisfy the requirement. Record the reason and the expected retrofit impact.

A special concern is that the first option is not automatically feasible. Drop Zone record design, component buffer relationships, persistence, update keys and event behavior all require verification.

The planner must be allowed to return `NO_VALID_CONFIGURATION_PATH` rather than inventing a working implementation.

### D. Policy Enforcement Service

This service mediates all mutations, including existing direct editor and MCP write tools.

The rules should be:

1. Read operations are always permitted subject to ordinary access controls.
2. New custom-object creation is permitted when environment policy and naming validation allow it.
3. Existing custom-object modifications require the normal write authorization.
4. Delivered-object edits are rejected or require approval according to policy.
5. An approval is bound to the exact object, change plan, connection and current object revision.
6. Changes outside the approved plan must be reevaluated.

Crucially, the approval cannot just be a Boolean submitted by the Agent. The server must issue and verify the authorization.

### E. Customization Registry and Upgrade Intelligence

The extension should maintain a registry of the relationships between delivered objects and custom configurations.

Example:

```
{
  "target": {
    "type": "COMPONENT",
    "name": "JOB_DATA"
  },
  "strategy": "EVENT_MAPPING",
  "extensions": [
    {
      "type": "APPLICATION_CLASS",
      "name": "ZZ_JOB_EXT:Validator"
    }
  ],
  "configurationStatus": "VERIFIED",
  "deliveredDefinitionChanged": false,
  "upgradeReviewRequired": true
}
```

The registry should support dependency analysis and answer questions such as:

- Which customizations depend on `JOB_DATA`?
- What would be affected if Oracle changes a field or record?
- Which Event Mappings run before or after delivered PeopleCode?
- Which Drop Zone configurations reference a given subpage?
- What could break when an Application Engine step is changed during a PUM update?

That makes the feature valuable beyond code generation.

## 5. MCP tools to implement

I would not expose everything as one oversized MCP tool. Use a small set of planning/discovery operations and domain-specific execution operations.

| MCP tool                      | Purpose                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `ps_customization_get_policy` | Return effective organization, workspace, connection and environment rules |
| `ps_object_classify`          | Classify ownership and customization status                                |
| `ps_customization_discover`   | Discover applicable configuration features and existing dependencies       |
| `ps_customization_plan`       | Convert a requirement into ranked implementation strategies                |
| `ps_customization_validate`   | Check feasibility, prerequisites and policy without writing                |
| `ps_customization_apply`      | Execute or dispatch an approved, supported plan                            |
| `ps_customization_impact`     | Analyze upgrade and dependency risks                                       |
| `ps_customization_inventory`  | Inventory customizations and configuration relationships                   |

The planning response should be structured enough for any MCP-compatible Agent to interpret deterministically.

For example:

```
{
  "recommendation": "CONFIGURATION",
  "framework": "EVENT_MAPPING",
  "status": "FEASIBLE",
  "confidence": "HIGH",
  "targetObject": "JOB_DATA",
  "deliveredObjectModification": false,
  "requiresApproval": false,
  "newObjects": [
    "ZZ_JOB_EXT"
  ],
  "prerequisites": [
    "Registered content reference",
    "Valid Event Mapping service"
  ],
  "steps": [
    "Create custom application class",
    "Implement required service interface",
    "Register Event Mapping",
    "Test event execution order"
  ],
  "alternatives": [
    "DIRECT_CUSTOMIZATION"
  ]
}
```

One important rule: the MCP must distinguish `DISCOVERED`, `FEASIBLE`, `IMPLEMENTED` and `TESTED`.

A planned Event Mapping is not an installed Event Mapping. A configuration successfully saved to metadata is not necessarily proven to execute correctly at runtime.

### MCP resources for agent education

Alongside tools, expose version-aware reference resources:

```
peoplesoft://customization/policy
peoplesoft://customization/frameworks
peoplesoft://customization/event-mapping
peoplesoft://customization/drop-zones
peoplesoft://customization/page-field-configurator
peoplesoft://customization/ae-plugins
peoplesoft://customization/naming
```

These should contain the actual technical constraints, prerequisites, supported object types, known platform limitations and verified execution mechanisms.

This gives an Agent two things: a way to learn the PeopleSoft-specific rules and a way to ask the server to verify them against the real environment.

## 6. Implementation roadmap for the development Agent

I would divide this into six phases, deliberately avoiding attempts to implement all PeopleSoft configuration frameworks simultaneously.

| Phase | Deliverable                | Completion criteria                                                  |
| ----- | -------------------------- | -------------------------------------------------------------------- |
| 1     | Policy and ownership model | Prefix settings, ownership classification and write guards           |
| 2     | Customization discovery    | Inspect existing configuration and relevant delivered metadata       |
| 3     | Strategy planner           | Agent receives accurate, ranked configuration alternatives           |
| 4     | Configuration adapters     | Implement read, validate and write support for individual frameworks |
| 5     | Agent integration          | MCP tools, resources, structured plans and approval workflow         |
| 6     | Upgrade intelligence       | Dependency graph, inventory and impact assessment                    |

For Phase 4, I would prioritize Event Mapping, then Drop Zones, then Page and Field Configurator, followed by Application Engine Plug-ins.

Event Mapping and Drop Zones are particularly relevant to the page and PeopleCode work already being developed. AE Plug-ins can then build upon the Application Engine editing capability.

Oracle's AE plug-in framework supports before, after and replace behavior for eligible actions, but it does not provide unrestricted creation of new steps or sections in the delivered program. This should be built directly into the planner's eligibility rules.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.oracle.com\&sz=32)

Oracle Docs



## 7. Handoff prompt for the PeopleSoft Studio Agent

Here is the implementation directive I would give the Agent. It requires the Agent to inspect the existing architecture, preserve completed functionality and implement the feature incrementally.

# PeopleSoft Studio — Customization Intelligence Engine

## Mission

Implement a Customization Intelligence Engine (CIE) within PeopleSoft Studio and its MCP Server.

PeopleSoft Studio is intended to provide Application Designer-equivalent development capabilities inside VS Code, with an MCP Server that enables AI Agents to inspect, understand, create, modify and validate PeopleSoft definitions.

We must now make the MCP Server knowledgeable about **PeopleSoft customization versus configuration**, including Oracle-supported mechanisms for extending delivered functionality without modifying delivered definitions.

The MCP must do more than expose object manipulation tools. It must help an Agent choose the correct architectural approach for a business requirement, understand available alternatives, evaluate their technical feasibility, and enforce organization policies.

The key principle is:

**Prefer configuring delivered applications through custom definitions and supported PeopleSoft configuration frameworks. Modify delivered definitions directly only when justified and explicitly permitted.**

## 1. Inspect Existing Architecture First

Before implementing anything:

- Inspect the repository's existing MCP Server architecture, tools, resources and tool registration mechanisms.
- Identify existing PeopleSoft object readers, writers, serializers, dependency resolvers and metadata APIs.
- Identify existing VS Code settings, connection configurations and security restrictions.
- Determine how object ownership and delivered-versus-custom classification are currently represented.
- Determine whether Event Mapping, Drop Zones, Page and Field Configurator, AE Plug-ins or related configuration features have already been implemented.
- Identify opportunities to reuse existing components rather than creating duplicate functionality.

Preserve all existing Application Designer-equivalent functionality.

Do not rewrite working object editors or MCP services unnecessarily.

Document the architectural findings before implementing the new feature.

## 2. Introduce Two Customization Tracks

### Track A — Configuration-Based Extension (Preferred)

Use custom objects and PeopleSoft configuration mechanisms to extend delivered functionality without modifying delivered object definitions.

Supported mechanisms to investigate include:

1. Page and Field Configurator
2. Event Mapping
3. Drop Zones
4. Application Engine Action Plug-ins
5. Configurable Search
6. Additional supported extensibility frameworks discovered during research

These mechanisms have different capabilities, constraints, prerequisites and execution models.

Never treat them as interchangeable.

### Track B — Direct Delivered-Object Customization

Allow modification of delivered PeopleSoft objects using existing Application Designer-equivalent capabilities.

This must be controlled by configuration settings and server-side policy enforcement.

A direct customization must not occur implicitly simply because the Agent has an object-editing tool available.

The MCP must explain the associated upgrade and maintenance implications.

## 3. Organization Naming Policy

Introduce settings supporting organization-specific prefixes.

**Naming prefixes are a list, not a single value.** Organizations often buy
PeopleSoft bolt-ons that carry their own prefixes, alongside their own. Each
configured prefix records who owns definitions named with it:

```json
"peoplesoft.customization.namingPrefixes": [
  { "prefix": "ZZ_",  "owner": "organization", "name": "Acme Corp" },
  { "prefix": "XYZ_", "owner": "partner",      "name": "XYZ Bolt-On Suite" }
]
```

An `organization` prefix is evidence for CUSTOM; a `partner` prefix is the
evidence for PARTNER (a vendor-delivered definition, which carries its own
upgrade and retrofit risk). New definitions are suggested the first
organization prefix. Prefixes stay supporting evidence, never proof on their
own.

For Acme Corp, the normal naming prefix is:

ZZ\_

Other organizations may use a different prefix.

Implement configurable prefix conventions with target PeopleTools naming validation.

The settings must support workspace or connection-specific configuration.

The default should be configurable and should not assume every PeopleSoft installation uses ZZ\_.

Existing third-party or legacy custom objects may not follow the currently configured naming prefix.

Do not classify an object as delivered solely because its name lacks the organization prefix.

Do not classify an object as custom solely because it has that prefix.

Use verified object provenance where available, including delivered baselines, owner metadata and version history.

Support at least these object classifications:

- DELIVERED
- CUSTOM
- PARTNER
- UNKNOWN
- DELIVERED_MODIFIED

Preserve the underlying ownership when identifying an already-modified delivered object.

When evidence is insufficient, report UNKNOWN.

## 4. Customization Policy

Introduce a settings namespace such as:

peopleSoftStudio.customization

Support:

- namingPrefixes (a list: prefix, owner organization | partner, name)
- defaultStrategy
- deliveredObjectPolicy
- requireImpactAnalysis
- suggestPrefixForNewObjects
- environment-specific write restrictions

The delivered-object policies should include:

- BLOCK
- REQUIRE_APPROVAL
- ALLOW_WITH_AUDIT

Default to configuration-first planning.

Production should be protected independently from customization policy.

All mutation paths, including preexisting MCP editing tools, must be subjected to the effective server-side policy.

Do not depend exclusively on an AI Agent obeying system prompts.

Approval must be validated server-side and scoped to a specific operation, object, connection and object revision.

## 5. Build a Capability Knowledge Model

Create a version-aware catalog of supported PeopleSoft configuration frameworks.

The catalog must describe:

- Purpose and supported use cases
- Supported PeopleTools/application versions
- Applicable object types
- Runtime and metadata prerequisites
- Supported events or operations
- Configuration metadata and relationships
- Known limitations
- Implementation and deployment mechanisms
- Required testing
- Upgrade dependencies

Research official Oracle documentation and validate findings against the available PeopleSoft lab.

Do not invent metadata tables, record layouts, APIs, event types or configuration capabilities.

Distinguish documented behavior from experimentally verified behavior.

When a capability cannot be verified, explicitly report it as unverified.

## 6. Build Capability Discovery

For a given PeopleSoft object or business requirement, the MCP must determine what configuration mechanisms are actually available in the connected environment.

For components and pages, investigate:

- Component and page relationships
- Registered content references
- Available Drop Zones
- Existing Drop Zone configurations
- Existing Event Mappings
- Page and Field Configurator eligibility and configurations
- Referenced records, fields and application packages
- Configuration conflicts and relevant execution order

For Application Engines, investigate:

- Program, section, step and action definitions
- Eligible plug-in action points
- Existing plug-in configurations
- Required state records and other dependencies

Avoid recommendations based solely on generic PeopleTools functionality when environment-specific eligibility has not been established.

## 7. Build a Strategy Planning Engine

Implement an MCP planning operation that accepts:

- Target environment
- Target PeopleSoft object
- Requested business change
- Applicable organization policy
- Optional design constraints

The planner must return structured alternatives.

For each alternative include:

- Configuration framework
- Feasibility status
- Evidence supporting feasibility
- Required custom objects
- Required configuration changes
- Any delivered-object changes
- Dependencies
- Implementation steps
- Validation requirements
- Upgrade risk
- Approval requirements
- Unsupported operations or unresolved questions

Prefer valid configuration approaches over direct customization.

If no supported configuration method can satisfy the requirement, report that explicitly.

Never invent a Drop Zone, Event Mapping event, AE plug-in point or unsupported Page and Field Configurator capability.

Rank alternatives based on technical correctness first, then policy compliance, maintainability, upgrade impact and implementation complexity.

## 8. Implement MCP Tools

Design and implement MCP operations equivalent to:

- ps_customization_get_policy
- ps_object_classify
- ps_customization_discover
- ps_customization_plan
- ps_customization_validate
- ps_customization_apply
- ps_customization_impact
- ps_customization_inventory

Adapt naming and interfaces to established repository conventions.

Prefer a shared planning and policy layer over duplicated logic in individual tools.

Expose version-aware MCP resources explaining customization frameworks and their limitations.

Agent-facing responses must clearly distinguish:

DISCOVERED → FEASIBLE → IMPLEMENTED → TESTED

Do not claim successful runtime implementation merely because configuration metadata was written.

## 9. Configuration Execution Adapters

Create a modular adapter architecture for configuration frameworks.

Each adapter should have defined discovery, validation, planning and execution capabilities.

Implement adapters incrementally.

Prioritize:

1. Event Mapping
2. Drop Zones
3. Page and Field Configurator
4. Application Engine Plug-ins

Read-only discovery and planning should precede mutation support.

Do not advertise write functionality for a framework unless the underlying execution mechanism has been implemented and validated.

Where supported PeopleSoft APIs exist, evaluate those before choosing direct metadata modification.

Do not write undocumented configuration tables merely because their layouts can be reverse-engineered.

For Event Mapping, correctly handle service interfaces, registered content references, supported events and execution sequencing.

For Drop Zones, verify the existence and eligibility of delivered insertion points before configuring custom subpages.

For Page and Field Configurator, implement its supported operations rather than treating it as a general-purpose page-definition editor.

For AE Plug-ins, model eligible actions, execution mode, action ordering and relevant program state dependencies.

## 10. Customization Registry and Upgrade Intelligence

Develop a registry representing configuration relationships between delivered and custom definitions.

Track:

- Delivered target objects
- Custom extension objects
- Framework used
- Configuration identifiers
- Relevant PeopleTools/application versions
- Dependencies
- Configuration status
- Baseline changes
- Known upgrade impact

Integrate these relationships with existing dependency or graph capabilities where practical.

Enable impact analysis of delivered object changes and application upgrades.

Configuration-based extensions must still be evaluated for compatibility.

## 11. Testing and Acceptance Criteria

Add unit, integration and environment-specific validation tests.

At minimum, test the following scenarios:

**Scenario A:** Agent requests a new field on a delivered page with a usable Drop Zone. The planner recommends a custom subpage and appropriate configuration instead of immediately editing the delivered page.

**Scenario B:** Agent requests a new field on a delivered page without a usable Drop Zone. The planner must not invent one and must evaluate the remaining feasible alternatives.

**Scenario C:** Agent requests custom validation in a delivered component. The planner investigates Event Mapping eligibility, valid events, services and sequencing.

**Scenario D:** Agent requests modification to delivered PeopleCode while direct edits are blocked. The MCP must reject the mutation, regardless of which write tool is called.

**Scenario E:** Agent requests a custom PeopleSoft definition. The naming policy suggests the organization prefix without falsely treating all nonprefixed objects as delivered.

**Scenario F:** Agent requests a change to a delivered AE program. The planner investigates AE Action Plug-in support before recommending direct modification.

**Scenario G:** An existing delivered object is already customized. The classification correctly reports delivered origin and existing modification status.

**Scenario H:** An object has ambiguous provenance. The engine reports UNKNOWN and does not silently bypass write restrictions.

**Scenario I:** A configuration plan is approved, but the target object changes before execution. The previously issued approval must not authorize the stale plan.

**Scenario J:** A change is made through an older MCP write tool. Policy enforcement must still apply.

Maintain all existing test coverage and avoid regressions.

## 12. Deliverables

Produce:

1. Architecture and dependency assessment
2. Version-aware customization capability model
3. VS Code settings and policy enforcement
4. Object classification service
5. Capability discovery service
6. Strategy planning engine
7. New MCP tools and resources
8. Incremental configuration-framework adapters
9. Upgrade impact model
10. Unit and integration tests
11. Documentation and CHANGELOG updates

## Implementation Discipline

First inspect and map the existing codebase.

Then implement the shared foundations and proceed in testable increments.

Do not claim a framework is supported until discovery and the relevant functionality have been verified.

Prefer established supported interfaces and documented PeopleSoft behavior.

Preserve working Application Designer-equivalent functionality.

The finished capability must allow an AI Agent to answer three questions reliably:

1. **Can I fulfill this requirement without modifying a delivered PeopleSoft object?**
2. **If so, exactly which supported framework, custom definitions and configuration steps are required?**
3. **If not, is direct customization authorized, and what are its upgrade and maintenance implications?**

The goal is to make PeopleSoft Studio an intelligent, upgrade-conscious PeopleSoft development environment—not simply a collection of object editing tools.

## 8. One additional feature I would strongly consider

Once this foundation exists, I would add a Customization Strategy panel to the VS Code extension.

When someone opens a delivered page, component or Application Engine, the extension could expose its configuration capabilities and their discovery status without requiring an Agent conversation.

Customization Strategy

Design concept

JOB_DATA

Component · Delivered

Protected

Possible extension mechanisms

Event Mapping

Registration and events must be verified

Drop Zones

Available insertion points must be discovered

Page & Field Configurator

Field-property support must be evaluated

Design strategy panel&#x20;

This could eventually become a distinctive capability of PeopleSoft Studio: an IDE that understands both the definition you're editing and the supported extension mechanisms available around that definition.

My recommendation is to implement Phases 1–3 first, giving the MCP reliable classification, configuration awareness and planning before enabling automated changes through the new frameworks. That establishes the intelligence layer without destabilizing the existing editors.