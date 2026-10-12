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

ZZ_

Other organizations may use a different prefix.

Implement configurable prefix conventions with target PeopleTools naming validation.

The settings must support workspace or connection-specific configuration.

The default should be configurable and should not assume every PeopleSoft installation uses ZZ_.

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
